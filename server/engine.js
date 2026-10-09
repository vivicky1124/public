/* ============================================================
 * engine.js — Node 服务端设计知识检索引擎
 * 移植自 website-agent-skills bot/engine.js（BM25 + 领域检索）
 * 数据：design-data/*.csv（7 个领域）
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'design-data');

/* ---------- 分词（与 core.py 对齐） ---------- */
const STOPWORDS = new Set([
  'to','in','on','at','is','of','by','or','an','if','no','so',
  'do','be','we','it','as','the','and','for','are','was'
]);

const SYNONYMS = {
  'q&a':'question answer','e-commerce':'ecommerce','dark-mode':'dark',
  'darkmode':'dark','light-mode':'light','lightmode':'light',
  'a11y':'accessibility','nav':'navigation','sign-up':'signup',
  'log-in':'login','colour':'color','colours':'colors',
  'customisation':'customization','organisation':'organization',
  'behaviour':'behavior','ux/ui':'ux ui'
};
const SYNONYM_KEYS = Object.keys(SYNONYMS).sort((a,b)=>b.length-a.length);

function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function normalize(text){
  let s = String(text);
  for(const k of SYNONYM_KEYS){
    s = s.replace(new RegExp('(?<!\\w)'+escapeRegExp(k)+'(?!\\w)','gi'), SYNONYMS[k]);
  }
  return s;
}

function tokenize(text){
  let s = normalize(String(text).toLowerCase());
  s = s.replace(/[^\p{L}\p{N}_\s]+/gu,' ');
  return s.split(/\s+/).filter(w=>w.length>=2 && !STOPWORDS.has(w));
}

/* ---------- BM25 ---------- */
class BM25 {
  constructor(k1=1.5,b=0.75){ this.k1=k1; this.b=b; }
  fit(docs){
    this.corpus = docs.map(d=>tokenize(d));
    this.N = this.corpus.length;
    if(!this.N){ this.avgdl=1; this.idf={}; this.termFreqs=[]; return; }
    this.docLengths = this.corpus.map(d=>d.length);
    this.avgdl = this.docLengths.reduce((a,b)=>a+b,0)/this.N || 1;
    this.termFreqs = this.corpus.map(d=>{
      const m=new Map();
      for(const w of d) m.set(w,(m.get(w)||0)+1);
      return m;
    });
    const docFreqs=new Map();
    for(const tf of this.termFreqs){
      for(const w of tf.keys()) docFreqs.set(w,(docFreqs.get(w)||0)+1);
    }
    this.idf={};
    for(const [w,f] of docFreqs){
      this.idf[w] = Math.log((this.N-f+0.5)/(f+0.5)+1);
    }
  }
  score(query){
    const q=tokenize(query);
    const out=[];
    for(let i=0;i<this.N;i++){
      let s=0;
      const dl=this.docLengths[i], tf=this.termFreqs[i];
      for(const t of q){
        if(!(t in this.idf)) continue;
        const f=tf.get(t)||0;
        if(!f) continue;
        s += this.idf[t]*(f*(this.k1+1))/(f+this.k1*(1-this.b+this.b*dl/this.avgdl));
      }
      out.push([i,s]);
    }
    return out.sort((a,b)=>b[1]-a[1]);
  }
}

/* ---------- CSV 解析 ---------- */
function parseCSV(text){
  const rows=[]; let row=[]; let field=''; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else inQ=false; }
      else field+=c;
    } else {
      if(c==='"') inQ=true;
      else if(c===','){ row.push(field); field=''; }
      else if(c==='\n'){ row.push(field); field=''; rows.push(row); row=[]; }
      else if(c==='\r'){ /* skip */ }
      else field+=c;
    }
  }
  if(field.length>0||row.length>0){ row.push(field); rows.push(row); }
  if(!rows.length) return [];
  const header=(rows.shift()||[]).map(h=>h.trim());
  return rows
    .filter(r=>r.some(x=>String(x).trim()!==''))
    .map(r=>{
      const o={};
      header.forEach((h,idx)=>{ o[h]=r[idx]!==undefined?r[idx]:''; });
      return o;
    });
}

/* ---------- 领域配置 ---------- */
const DOMAIN_CONFIG = {
  product: {
    file: 'products.csv',
    searchCols: ['Product Type','Keywords','Primary Style Recommendation','Key Considerations'],
    rowFilter: null
  },
  style: {
    file: 'styles.csv',
    searchCols: ['Style ID','Style Category','Aliases','Keywords','Best For','Type','AI Prompt Keywords'],
    rowFilter: row => (row['Status']||'active')==='active'
  },
  color: {
    file: 'colors.csv',
    searchCols: ['Product Type','Notes'],
    rowFilter: null
  },
  typography: {
    file: 'typography.csv',
    searchCols: ['Font Pairing Name','Category','Mood/Style Keywords','Best For','Heading Font','Body Font'],
    rowFilter: null
  },
  landing: {
    file: 'landing.csv',
    searchCols: ['Pattern ID','Pattern Name','Aliases','Keywords','Conversion Optimization','Section Order'],
    rowFilter: null
  }
};

const _domainCache = {};

function loadDomain(domain){
  if(_domainCache[domain]) return _domainCache[domain];
  const cfg = DOMAIN_CONFIG[domain];
  if(!cfg) throw new Error('未知检索领域: '+domain);
  const file = path.join(DATA_DIR, cfg.file);
  let text;
  try {
    text = fs.readFileSync(file,'utf8');
  } catch(e){
    throw new Error('设计数据库文件缺失: '+file);
  }
  let rows = parseCSV(text);
  if(cfg.rowFilter) rows = rows.filter(cfg.rowFilter);
  const docs = rows.map(r=>cfg.searchCols.map(c=>r[c]||'').join(' '));
  const bm25 = new BM25();
  bm25.fit(docs);
  return (_domainCache[domain]={rows,bm25});
}

function searchDomain(domain,query,n=2){
  const {rows,bm25}=loadDomain(domain);
  const ranked=bm25.score(query).filter(([i,s])=>s>0).slice(0,n);
  return ranked.map(([i,s])=>({score:Math.round(s*10)/10,row:rows[i]}));
}

/* ---------- 设计系统简报组装 ---------- */
function pick(row,keys){
  if(!row) return {};
  const o={};
  for(const k of keys){
    const v=(row[k]||'').trim();
    if(v) o[k]=v;
  }
  return o;
}

const PALLETTE_KEYS = ['Primary','On Primary','Secondary','On Secondary','Accent','On Accent',
  'Background','Foreground','Card','Card Foreground','Muted','Muted Foreground','Border',
  'Destructive','On Destructive','Ring'];

function buildDesignBrief(brief){
  const industry=(brief.industryEn||'').trim();
  const styleKw=(brief.styleKeywordsEn||[]).join(' ');
  const mood=(brief.moodEn||'').trim();

  const productHits=searchDomain('product',industry+' '+(brief.keywordsEn||''),2);
  const product=productHits[0]||null;

  const userStyleSignal=[styleKw,styleKw,mood].filter(Boolean).join(' ');
  const styleQuery=[userStyleSignal,product?product.row['Primary Style Recommendation']:'',product?product.row['Keywords']:''].filter(Boolean).join(' ');
  const styleHits=searchDomain('style',(styleQuery||industry),2);
  const style=styleHits[0]||null;

  const colorHits=searchDomain('color',[industry,product?product.row['Color Palette Focus']:'',styleKw].filter(Boolean).join(' '),2);
  const color=colorHits[0]||null;

  const typoQuery=[style?style.row['Keywords']:'',mood,styleKw,industry].filter(Boolean).join(' ');
  const typoHits=searchDomain('typography',(typoQuery||'modern clean'),2);
  const typo=typoHits[0]||null;

  const landingHits=searchDomain('landing',[industry,product?product.row['Landing Page Pattern']:''].filter(Boolean).join(' '),2);
  const landing=landingHits[0]||null;

  const p=pick(product&&product.row,['Product Type','Primary Style Recommendation','Secondary Styles','Landing Page Pattern','Color Palette Focus']);
  const s=pick(style&&style.row,['Style ID','Style Category','Keywords','Primary Colors','Effects & Animation','Best For','Light Mode ✓','Dark Mode ✓','AI Prompt Keywords','Design System Variables']);
  const c=pick(color&&color.row,PALLETTE_KEYS.concat(['Notes']));
  const t=pick(typo&&typo.row,['Font Pairing Name','Heading Font','Body Font','Google Fonts URL','CSS Import','Mood/Style Keywords','Best For']);
  const l=pick(landing&&landing.row,['Pattern Name','Section Order','Primary CTA Placement','Color Strategy','Conversion Optimization']);

  const lines=[];
  lines.push('# 设计系统简报（由本地设计数据库检索生成）');
  lines.push('');
  lines.push('## 业务匹配');
  lines.push('- 行业: '+(p['Product Type']||industry||'未指定')+(product?'（数据库命中，相关度 '+product.score+'）':'（未命中数据库）'));
  if(p['Primary Style Recommendation']) lines.push('- 数据库推荐主风格: '+p['Primary Style Recommendation']);
  if(p['Secondary Styles']) lines.push('- 备选风格: '+p['Secondary Styles']);
  if(p['Color Palette Focus']) lines.push('- 色彩方向: '+p['Color Palette Focus']);
  lines.push('');
  lines.push('## 视觉风格');
  if(s['Style ID']){
    lines.push('- 风格: '+s['Style ID']+(s['Style Category']?'（'+s['Style Category']+'）':'')+'（相关度 '+style.score+'）');
    for(const k of ['Keywords','Primary Colors','Effects & Animation','Best For','Light Mode ✓','Dark Mode ✓']){
      if(s[k]) lines.push('- '+k+': '+s[k]);
    }
    if(s['Design System Variables']) lines.push('- 设计变量参考: '+s['Design System Variables'].slice(0,600));
  } else {
    lines.push('- 未命中风格库，使用现代简洁风格：大量留白、清晰层级、单一强调色');
  }
  lines.push('');
  lines.push('## 色板令牌（必须严格使用）');
  if(c['Primary']){
    for(const k of PALLETTE_KEYS) if(c[k]) lines.push('- '+k+': '+c[k]);
    if(c['Notes']) lines.push('- 说明: '+c['Notes']);
  } else {
    lines.push('- 未命中色板库：Primary 用一个贴合行业的饱和色，Background #FAFAF9，Foreground #1C1917，自定 2-3 个中性色');
  }
  lines.push('');
  lines.push('## 字体');
  if(t['Heading Font']){
    lines.push('- 标题字体: '+t['Heading Font']);
    lines.push('- 正文字体: '+t['Body Font']);
    if(t['CSS Import']) lines.push('- 引入方式: '+t['CSS Import']);
    else if(t['Google Fonts URL']) lines.push('- Google Fonts: '+t['Google Fonts URL']);
    if(t['Mood/Style Keywords']) lines.push('- 气质: '+t['Mood/Style Keywords']);
  } else {
    lines.push('- 未命中字体库：中文用 Noto Sans SC，标题可用 Noto Serif SC 或保持无衬线');
  }
  lines.push('');
  lines.push('## 落地页结构');
  if(l['Pattern Name']){
    lines.push('- 版式: '+l['Pattern Name']+'（相关度 '+landing.score+'）');
    if(l['Section Order']) lines.push('- 区块顺序: '+l['Section Order']);
    if(l['Primary CTA Placement']) lines.push('- CTA 位置策略: '+l['Primary CTA Placement']);
    if(l['Color Strategy']) lines.push('- 色彩策略: '+l['Color Strategy']);
    if(l['Conversion Optimization']) lines.push('- 转化要点: '+l['Conversion Optimization']);
  } else {
    lines.push('- 未命中版式库：Hero → 社会证明 → 痛点/方案 → 运作方式 → 异议处理 → 最终 CTA');
  }
  lines.push('');
  lines.push('## 动效强度');
  lines.push('- '+(brief.motionHint||'中等偏克制：入场淡入上移、滚动显现、CTA 微交互；禁用夸张弹跳与全场视差'));

  const meta={product:p,style:s,color:c,typography:t,landing:l,scores:{product:product&&product.score,style:style&&style.score,color:color&&color.score,typography:typo&&typo.score,landing:landing&&landing.score}};
  return {markdown:lines.join('\n'),meta};
}

module.exports={loadDomain,searchDomain,buildDesignBrief,tokenize,parseCSV};
