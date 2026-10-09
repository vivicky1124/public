/* Hello Site Bot - 前端编排（Node 后端代理版） */
(function(){
'use strict';
const $=s=>document.querySelector(s);
const chatEl=$("#chat"),inputEl=$("#input"),sendBtn=$("#sendBtn"),stopBtn=$("#stopBtn");
const statusEl=$("#statusBar"),previewFrame=$("#previewFrame"),codeEl=$("#codeView");
const tabPreview=$("#tabPreview"),tabCode=$("#tabCode"),downloadBtn=$("#downloadBtn");
const openBtn=$("#openBtn"),copyBtn=$("#copyBtn"),newBtn=$("#newBtn"),qaBtn=$("#qaBtn");
const keyBtn=$("#keyBtn"),keyPanel=$("#keyPanel");
const dsKeyInput=$("#deepseekKeyInput"),dsSaveBtn=$("#deepseekSaveBtn"),dsTestBtn=$("#deepseekTestBtn"),dsKeyStatus=$("#deepseekKeyStatus");
const agKeyInput=$("#agnesKeyInput"),agSaveBtn=$("#agnesSaveBtn"),agTestBtn=$("#agnesTestBtn"),agKeyStatus=$("#agnesKeyStatus");
const P={
DIRECTOR:"你是网站生成机器人的需求顾问。【强制】只输出JSON，不输出任何自然语言、解释或markdown。不足:{\"ready\":false,\"question\":\"问题\"}。足够:{\"ready\":true,\"brief\":{\"projectName\":\"\",\"industryEn\":\"\",\"keywordsEn\":[],\"styleKeywordsEn\":[],\"moodEn\":\"\",\"audience\":\"\",\"primaryAction\":\"\",\"services\":[],\"sellingPoints\":[],\"richness\":\"simple|standard|rich\",\"language\":\"zh\",\"tone\":\"\",\"assumptions\":[]}}。最多3轮。",
GENERATOR:"你是顶级网站工程师。生成完整单页HTML，必须包含：<!DOCTYPE html>、<html>、<head>（含viewport）、<body>（含header/main/footer）、</html>。Tailwind CDN；禁外链图片用CSS渐变/SVG；色板映射config；完整SEO；最多600行。文案具体真实。【硬性要求】只输出纯HTML代码，从<!DOCTYPE html>到</html>，不要任何说明、markdown围栏或自然语言。",
REFINER:"你是网站修改专家。输出修改后完整HTML。只改要求的部分；保留占位符；用户优先；保持响应式。输出：说明+完整HTML。",
QA:"你是网站质检员。三层审查输出JSON:{\"issues\":[{\"severity\":\"high|medium|low\",\"layer\":\"工程|审美|文案\",\"where\":\"\",\"problem\":\"\",\"fix\":\"\"}],\"summary\":\"\"}。最多8条。"
};
const state={phase:"idle",history:[],brief:null,html:null,ctrl:null,userInfo:""};
function esc(s){return String(s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch];});}
function addMsg(r,h,c){const d=document.createElement("div");d.className="msg "+r+(c?" "+c:"");d.innerHTML="<div class=\"bubble\">"+h+"</div>";chatEl.appendChild(d);chatEl.scrollTop=chatEl.scrollHeight;return d.querySelector(".bubble");}
function addCard(k,h){const d=document.createElement("div");d.className="msg assistant";d.innerHTML="<div class=\"card "+k+"\">"+h+"</div>";chatEl.appendChild(d);chatEl.scrollTop=chatEl.scrollHeight;return d.querySelector(".card");}
function setStatus(t,p){statusEl.textContent=t||"";statusEl.className="status "+(p||"");statusEl.style.display=t?"":"none";}
function setKeyStatusText(el,t,p){el.textContent=t||"";el.style.color=p==="error"?"var(--err)":(p==="ok"?"var(--ok)":"var(--ink-3)");}
async function refreshKeyStatus(){
try{
const r=await fetch("/api/key");const d=await r.json();
if(d.deepseek&&d.deepseek.hasKey){setKeyStatusText(dsKeyStatus,"已配置："+(d.deepseek.maskedKey||""),"ok");}
else{setKeyStatusText(dsKeyStatus,"未配置","error");}
if(d.agnes&&d.agnes.hasKey){setKeyStatusText(agKeyStatus,"已配置："+(d.agnes.maskedKey||""),"ok");}
else{setKeyStatusText(agKeyStatus,"未配置","error");}
const active=d.provider==="deepseek"?"DeepSeek":d.provider==="agnes"?"Agnes":"未配置";
keyBtn.textContent="🔑 "+active;
}catch(e){setKeyStatusText(dsKeyStatus,"读取 key 状态失败","error");setKeyStatusText(agKeyStatus,"","error");}
}
async function saveKey(provider,inputEl,statusEl){
const key=inputEl.value.trim();
if(!key){setKeyStatusText(statusEl,provider==="deepseek"?"请输入 DeepSeek API Key":"请输入 Agnes API Key","error");return;}
try{
const r=await fetch("/api/key",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:provider,apiKey:key})});
const d=await r.json();
if(d.ok){setKeyStatusText(statusEl,"已保存并立即生效："+(d.maskedKey||key),"ok");inputEl.value="";}
else{setKeyStatusText(statusEl,d.error||"保存失败","error");}
await refreshKeyStatus();
}catch(e){setKeyStatusText(statusEl,"保存失败："+e.message,"error");}
}
async function testKey(provider,inputEl,statusEl){
const key=inputEl.value.trim();
const body=key?{provider:provider,apiKey:key}:{provider:provider};
try{
const r=await fetch("/api/key/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
const d=await r.json();
if(d.ok){setKeyStatusText(statusEl,"测试成功，key 可用","ok");}
else{setKeyStatusText(statusEl,"测试失败："+(d.error||d.detail||("HTTP "+d.status)),"error");}
}catch(e){setKeyStatusText(statusEl,"测试失败："+e.message,"error");}
}
keyBtn.addEventListener("click",function(){keyPanel.style.display=keyPanel.style.display==="none"?"flex":"none";if(keyPanel.style.display!="none")refreshKeyStatus();});
dsSaveBtn.addEventListener("click",function(){saveKey("deepseek",dsKeyInput,dsKeyStatus);});
dsTestBtn.addEventListener("click",function(){testKey("deepseek",dsKeyInput,dsKeyStatus);});
dsKeyInput.addEventListener("keydown",function(e){if(e.key==="Enter")saveKey("deepseek",dsKeyInput,dsKeyStatus);});
agSaveBtn.addEventListener("click",function(){saveKey("agnes",agKeyInput,agKeyStatus);});
agTestBtn.addEventListener("click",function(){testKey("agnes",agKeyInput,agKeyStatus);});
agKeyInput.addEventListener("keydown",function(e){if(e.key==="Enter")saveKey("agnes",agKeyInput,agKeyStatus);});
function busy(on){sendBtn.style.display=on?"none":"";stopBtn.style.display=on?"":"none";inputEl.disabled=on;if(!on)inputEl.focus();}

/* LLM 流式调用（走本地 /api/chat 代理，解析 SSE） */
async function llmStream(sys,msgs,onDelta){
state.ctrl=new AbortController();
const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({system:sys,messages:msgs}),signal:state.ctrl.signal});
if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||("HTTP "+r.status));}
const reader=r.body.getReader();const dec=new TextDecoder();
let full="",buf="";
while(true){
const{done,value}=await reader.read();
if(done)break;
buf+=dec.decode(value,{stream:true});
const parts=buf.split("\n");
buf=parts.pop()||"";
for(const line of parts){
const t=line.trim();
if(!t.startsWith("data:"))continue;
const payload=t.slice(5).trim();
if(payload==="[DOI]")continue;
try{const j=JSON.parse(payload);
const d=j.choices&&j.choices[0]&&j.choices[0].delta;
if(d&&d.content){full+=d.content;if(onDelta)onDelta(full);}}catch(_){}
}
}
return full;
}

/* 非流式 LLM 调用 */
async function llmCall(sys,msgs){
const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({system:sys,messages:msgs,stream:false})});
if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||("HTTP "+r.status));}
const d=await r.json();return d.choices?d.choices[0].message.content:"";
}
/* 兼容旧版 /api/chat 返回的 OpenAI 标准结构 */

/* 鲁棒提取 JSON：兼容模型在 JSON 前后夹带自然语言/代码块的情况 */
function extractJSON(text) {
if (!text) return null;
// 1. 直接解析
try { return JSON.parse(text); } catch (_) {}
// 2. 去掉 markdown 代码块围栏
var t = text.trim();
var m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
if (m) { try { return JSON.parse(m[1].trim()); } catch (_) {} }
// 3. 提取第一个 { 到最后一个 } 之间的片段
var a = t.indexOf("{"), b = t.lastIndexOf("}");
if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
return null;
}

/* 需求门问 */
async function directorTurn(userMsg){
state.phase="director";state.history.push({role:"user",content:userMsg});
state.history.push({role:"assistant",content:"正在分析需求..."});
const msgs=state.history.slice(0,-1);
try{
const resp=await llmCall(P.DIRECTOR,msgs);
state.history.pop();state.history.push({role:"assistant",content:resp});
const parsed=extractJSON(resp);
if(parsed&&parsed.ready){state.brief=parsed.brief;state.phase="ready";return{ready:true,brief:state.brief};}
if(parsed&&!parsed.ready&&parsed.question){return{ready:false,question:parsed.question};}
// JSON 提取失败：把模型原话作为追问继续对话（避免卡死）
console.warn("[director] JSON 提取失败，回退为自然语言追问。原始返回:",resp);
return{ready:false,question:resp.slice(0,300)||"请补充一下网站的业务类型和目标客户。"};
}catch(e){state.history.pop();console.error("director error",e);return{ready:false,error:e.message};}
}

/* 设计检索 */
async function getDesign(brief){
const r=await fetch("/api/design",{method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify(brief)});
if(!r.ok)throw new Error("HTTP "+r.status);return r.json();
}
/* 生成网站 */
function buildGenPrompt(brief, designMd) {
  var lines = [];
  lines.push("## 需求单", JSON.stringify(brief, null, 2));
  lines.push("", "## 设计系统简报", designMd || "");
  if (brief.richness === "rich") lines.push("", "丰富度：丰富，7-8个区块，视觉层次多，滚动动效。");
  else if (brief.richness === "simple") lines.push("", "丰富度：简洁，3-4个核心区块，大量留白。");
  else lines.push("", "丰富度：标准，5-6个区块，层次清晰。");
  if (state.userInfo && state.userInfo.trim()) {
    lines.push("", "## 用户提供的真实信息（必须原样使用）", state.userInfo);
  }
  lines.push("", "按以上材料生成完整单页网站。色板令牌一字不改，禁外链图片。");
  return lines.join("\n");
}
async function generateSite() {
  state.phase = "generating";
  busy(true);
  var steps = addCard("steps",
    "<div class=\"step\" data-s=\"1\"><span class=\"si\">1</span> 需求确认</div>" +
    "<div class=\"step\" data-s=\"2\"><span class=\"si\">2</span> 检索设计数据库</div>" +
    "<div class=\"step\" data-s=\"3\"><span class=\"si\">3</span> 生成网站</div>" +
    "<div class=\"step\" data-s=\"4\"><span class=\"si\">4</span> 交付</div>");
  function setStep(n, cls) { var el = steps.querySelector("[data-s=\"" + n + "\"]"); if (el) el.className = "step " + cls; }
  setStep(1, "done");
  setStep(2, "active");
  setStatus("正在检索设计数据库...");
  if (!state.brief) {
    addMsg("assistant", "需求单尚未确认，请重新描述一下你想要什么网站。", "error");
    state.phase = "idle";
    return;
  }
  var design;
  try { design = await getDesign(state.brief); }
  catch (err) { setStatus("设计检索失败: " + err.message, "error"); busy(false); return; }
  setStep(2, "done");
  var m = design.meta;
  var styleName = (m.style && m.style["Style ID"]) || "现代简洁";
  addCard("design",
    "<div class=\"card-title\">设计系统 - " + esc(styleName) + "</div>" +
    "<div class=\"tokens\">" +
    "<span class=\"token\"><i style=\"background:" + esc((m.color && m.color["Primary"]) || "#ddd") + "\"></i>" + esc((m.color && m.color["Primary"]) || "未命中") + "</span>" +
    "<span class=\"token\"><i style=\"background:" + esc((m.color && m.color["Background"]) || "#ddd") + "\"></i>" + esc((m.color && m.color["Background"]) || "未命中") + "</span>" +
    "</div>" +
    "<div class=\"note\">字体：" + esc((m.typography && m.typography["Heading Font"] || "—") + " + " + (m.typography && m.typography["Body Font"] || "—")) +
    (m.landing && m.landing["Section Order"] ? " · 结构：" + esc(String(m.landing["Section Order"]).slice(0, 120)) : "") + "</div>");
  setStep(3, "active");
  setStatus("正在生成网站...");
  var card = addCard("gen", "<div class=\"gen-status\">正在生成网站... <span class=\"gen-count\">0</span> 字</div><pre class=\"gen-code\"></pre>");
  var genCount = card.querySelector(".gen-count");
  var genCode = card.querySelector(".gen-code");
  var userPrompt = buildGenPrompt(state.brief, design.markdown);
  // 生成网站：强制纯 HTML 输出，避免模型混入说明文字导致 extractHTML 失败
  userPrompt += "\n\n【硬性要求】只输出完整 HTML 代码（从 <!DOCTYPE html> 到 </html>），不要输出任何说明、解释、markdown 围栏（```）或自然语言。";
  var text;
  try {
    text = await llmStream(P.GENERATOR, [{ role: "user", content: userPrompt }], function(full) {
      genCount.textContent = full.length;
      genCode.textContent = full.slice(-1600);
      genCode.scrollTop = genCode.scrollHeight;
    });
  } catch (err) {
    card.remove(); steps.remove();
    if (err.name === "AbortError") { addMsg("assistant", "已停止生成。"); state.phase = "idle"; }
    else setStatus("生成失败: " + err.message, "error");
    busy(false); return;
  }
  card.remove();
  var html = extractHTML(text);
  setStep(3, "done");
  if (!html) { setStatus("模型没有输出有效 HTML", "error"); busy(false); return; }
  state.html = html;
  setStep(4, "done");
  renderPreview(html);
  setStatus("");
  addMsg("assistant", "网站已生成：" + esc((state.brief && state.brief.projectName) || "新网站") + "。右侧可预览、下载。继续说要改什么。");
  busy(false);
  state.phase = "refine";
}
/* HTML 提取 */
function extractHTML(text) {
  if (!text) return null;
  var body = null;
  var m = text.match(/```(?:html)?\s*\n?([\s\S]*?)(?:```|$)/);
  if (m && /<html|<!DOCTYPE/i.test(m[1])) body = m[1];
  if (!body) { var s = text.search(/<!DOCTYPE html|<html/i); if (s >= 0) body = text.slice(s); }
  if (!body) return null;
  body = body.replace(/```[\s\S]*$/, "").trim();
  if (!/<\/html>\s*$/i.test(body)) {
    if (!/<\/body>/i.test(body)) body += "\n</body>";
    if (!/<\/html>/i.test(body)) body += "\n</html>";
  }
  return body;
}

/* 设计简报格式化（备用） */

/* 修改迭代 */
async function refineTurn(userText) {
  state.phase = "generating";
  busy(true);
  setStatus("正在修改网站...");
  var card = addCard("gen", "<div class=\"gen-status\">正在修改... <span class=\"gen-count\">0</span> 字</div><pre class=\"gen-code\"></pre>");
  var genCount = card.querySelector(".gen-count");
  var genCode = card.querySelector(".gen-code");
  try {
    var userPrompt = "## 当前网站 HTML\n```html\n" + state.html + "\n```\n\n## 修改要求\n" + userText;
    var text = await llmStream(P.REFINER, [{ role: "user", content: userPrompt }], function(full) {
      genCount.textContent = full.length;
      genCode.textContent = full.slice(-1200);
      genCode.scrollTop = genCode.scrollHeight;
    });
    card.remove();
    var html = extractHTML(text);
    if (!html) { addMsg("assistant", "修改没有返回有效 HTML，网站保持原样。换个说法再试。"); }
    else {
      state.html = html;
      renderPreview(html);
      addMsg("assistant", "已更新网站。继续说下一个修改，或下载。");
    }
  } catch (err) {
    card.remove();
    if (err.name === "AbortError") addMsg("assistant", "已停止，网站保持原样。");
    else addMsg("assistant", "修改失败：" + esc(err.message), "error");
  } finally {
    state.phase = "refine";
    busy(false);
    setStatus("");
  }
}

/* 预览与下载 */
function renderPreview(html) {
  previewFrame.srcdoc = html;
  codeEl.value = html;
  downloadBtn.disabled = false;
  openBtn.disabled = false;
  copyBtn.disabled = false;
  qaBtn.disabled = false;
  switchTab("preview");
}

function download() {
  if (!state.html) return;
  var blob = new Blob([state.html], { type: "text/html;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  var name = ((state.brief && state.brief.projectName) || "website").replace(/[\\/:*?"<>|\s]+/g, "-");
  a.download = name + ".html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
}

function openNew() {
  if (!state.html) return;
  var blob = new Blob([state.html], { type: "text/html;charset=utf-8" });
  window.open(URL.createObjectURL(blob), "_blank");
}

async function copyCode() {
  if (!state.html) return;
  try {
    await navigator.clipboard.writeText(state.html);
    copyBtn.textContent = "已复制";
    setTimeout(function() { copyBtn.textContent = "复制代码"; }, 1500);
  } catch (e) { codeEl.select && codeEl.select(); }
}

/* 自检 */
async function runSelfCheck() {
  if (!state.html || state.phase === "generating") return;
  state.phase = "generating";
  busy(true);
  setStatus("自检中...");
  try {
    var out = await llmCall(P.QA, [{ role: "user", content: "请审查这个网站 HTML：\n```html\n" + state.html + "\n```" }]);
    var s = out.trim();
    var f = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (f) s = f[1].trim();
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    var parsed = JSON.parse(s);
    var issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    var card = addCard("brief",
      "<div class=\"card-title\">自检报告 - 共 " + issues.length + " 项</div>" +
      (parsed.summary ? "<div class=\"note\">总评：" + esc(parsed.summary) + "</div>" : "") +
      (issues.length ? "<div>" + issues.map(function(i) {
        var tag = i.severity === "high" ? "[严重]" : i.severity === "medium" ? "[中等]" : "[轻微]";
        return "<div>" + tag + " [" + esc(i.layer || "") + "] " + esc(i.where || "") + "：" + esc(i.problem) + "<br>→ " + esc(i.fix || "") + "</div>";
      }).join("") + "</div>" : "<div>通过，未发现问题</div>"));
    if (issues.length) {
      var btn = document.createElement("button");
      btn.className = "hbtn";
      btn.textContent = "一键修复以上问题";
      btn.addEventListener("click", function() {
        btn.disabled = true;
        var list = issues.map(function(i, idx) { return (idx + 1) + ". [" + (i.layer || "") + "] " + (i.where || "") + "：" + (i.problem || "") + " → " + (i.fix || ""); }).join("\n");
        refineTurn("请按下面这份自检报告逐条修复，其他部分保持不变：\n" + list);
      });
      card.appendChild(btn);
    }
  } catch (err) {
    addMsg("assistant", "自检失败：" + esc(err.message), "error");
  } finally {
    state.phase = "refine";
    busy(false);
    setStatus("");
  }
}
/* UI 事件 */
function switchTab(tab) {
  tabPreview.className = "tab" + (tab === "preview" ? " active" : "");
  tabCode.className = "tab" + (tab === "code" ? " active" : "");
  previewFrame.style.display = tab === "preview" ? "block" : "none";
  codeEl.style.display = tab === "code" ? "block" : "none";
}
tabPreview.addEventListener("click", function() { switchTab("preview"); });
tabCode.addEventListener("click", function() { switchTab("code"); });

function send() {
  var text = inputEl.value.trim();
  if (!text || state.phase === "generating") return;
  inputEl.value = "";
  addMsg("user", esc(text));
  if (state.phase === "refine" && state.html) {
    if (/^(跳过|skip|没有|无|不知道|先不用)/i.test(text)) {
      state.userInfo = "";
      addMsg("assistant", "好，那这部分我用通用表述，生成后你随时可以让我替换成真实信息。现在开始生成。");
      generateSite();
    } else {
      state.userInfo = text;
      addMsg("assistant", "收到，这些信息会原样写进网站。现在开始生成。");
      generateSite();
    }
    return;
  }
  if (state.phase === "idle" || state.phase === "director" || state.phase === "ready") {
    // 需求单已确认（ready 阶段）：用户回复"跳过"或补充信息 → 直接生成
    if (state.phase === "ready") {
      if (/^(跳过|skip|没有|无|不知道|先不用)/i.test(text)) {
        state.userInfo = "";
        addMsg("assistant", "好，那这部分我用通用表述，生成后你随时可以让我替换成真实信息。现在开始生成。");
      } else {
        state.userInfo = text;
        addMsg("assistant", "收到，这些信息会原样写进网站。现在开始生成。");
      }
      generateSite();
      return;
    }
    // 需求门问阶段：继续与模型对话直到需求单确认
    directorTurn(text).then(function(result) {
      if (result.ready) {
        var b = result.brief;
        var asum = (b.assumptions && b.assumptions.length) ? "<div class=\"note\">假设（可让我改）：" + b.assumptions.map(esc).join("；") + "</div>" : "";
        var svc = (b.services && b.services.length) ? "<div class=\"kv\"><span>服务/产品</span>" + esc(b.services.join("、")) + "</div>" : "";
        var sell = (b.sellingPoints && b.sellingPoints.length) ? "<div class=\"kv\"><span>卖点</span>" + esc(b.sellingPoints.join("；")) + "</div>" : "";
        addCard("brief",
          "<div class=\"card-title\">需求单已确认 - " + esc(b.projectName) + "</div>" +
          "<div class=\"kv\"><span>行业</span>" + esc(b.industryEn || "—") + "</div>" +
          "<div class=\"kv\"><span>访客</span>" + esc(b.audience || "—") + "</div>" +
          "<div class=\"kv\"><span>目标动作</span>" + esc(b.primaryAction || "—") + "</div>" +
          "<div class=\"kv\"><span>语气</span>" + esc(b.tone || "—") + "</div>" +
          "<div class=\"kv\"><span>丰富度</span>" + esc({ simple: "简洁", standard: "标准", rich: "丰富" }[b.richness] || "标准") + "</div>" +
          svc + sell + asum);
        addCard("brief",
          "<div class=\"card-title\">最后一步：补充你的真实信息</div>" +
          "<div class=\"note\">下面这些会直接写进网站，有了它们网站才像你自己的：<br>· 联系方式：电话 / 微信 / 邮箱<br>· 地址或服务范围<br>· 价格或服务清单<br>· 其他想强调的（营业时间、资质等）<br>直接把这些发给我即可；没有或暂时不想填，回复 <strong>跳过</strong>。</div>");
        state.phase = "ready";
      } else if (result.question) {
        addMsg("assistant", esc(result.question));
      } else if (result.error) {
        addMsg("assistant", "需求分析失败：" + esc(result.error), "error");
      }
    });
  }
}
sendBtn.addEventListener("click", send);
inputEl.addEventListener("keydown", function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
stopBtn.addEventListener("click", function() { if (state.ctrl) state.ctrl.abort(); });
downloadBtn.addEventListener("click", download);
openBtn.addEventListener("click", openNew);
copyBtn.addEventListener("click", copyCode);
qaBtn.addEventListener("click", runSelfCheck);

newBtn.addEventListener("click", function() {
  state.phase = "idle";
  state.history = [];
  state.brief = null;
  state.html = null;
  state.userInfo = "";
  chatEl.innerHTML = "";
  welcome();
  inputEl.focus();
});

function welcome() {
  addMsg("assistant",
    "你好，我是<strong>网站生成机器人</strong> 🤖<br>" +
    "直接告诉我你想要什么网站就行，比如 <span class=\"example\">帮我做一个咖啡店官网</span><br>" +
    "我会通过对话把需求问清楚（业务、客户、卖点、动作、风格），再请你补充联系方式等真实信息，然后生成完整网站。<br>" +
    "生成后可预览、自检、下载 HTML。");
}

welcome();
refreshKeyStatus();
})();
