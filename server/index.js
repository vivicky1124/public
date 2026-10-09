/* ============================================================
 * index.js — Node 后端入口
 * 提供：静态文件服务 + LLM API 代理（DeepSeek / Agnes） + 设计检索
 * ============================================================ */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- 配置 ---------- */
/*
 * 支持两个 provider，按优先级自动选择：
 *   1. DeepSeek（DEEPSEEK_API_KEY 有值时优先）
 *   2. Agnes（DEEPSEEK_API_KEY 未配置时回退）
 * 前端 UI 通过 /api/config 拿到当前 provider，提示对应 key。
 * 前端可通过 Bearer header 直接传自己的 key，服务端透传。
 */

/* 默认值（.env 未提供时兜底） */
const DEEPSEEK_BASE_URL_DEFAULT = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL_DEFAULT = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const AGNES_BASE_URL_DEFAULT = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1';
const AGNES_MODEL_DEFAULT = process.env.AGNES_MODEL || 'agnes-2.5-flash';

/*
 * 每次调用时动态读 process.env，这样 /api/key 保存新 key 后立即生效，
 * 无需重启服务。
 */
function currentProvider() {
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.AGNES_API_KEY) return 'agnes';
  return 'none';
}

function currentConfig() {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL_DEFAULT,
      model: process.env.DEEPSEEK_MODEL || DEEPSEEK_MODEL_DEFAULT
    };
  }
  if (process.env.AGNES_API_KEY) {
    return {
      provider: 'agnes',
      apiKey: process.env.AGNES_API_KEY,
      baseUrl: process.env.AGNES_BASE_URL || AGNES_BASE_URL_DEFAULT,
      model: process.env.AGNES_MODEL || AGNES_MODEL_DEFAULT
    };
  }
  return {
    provider: 'none',
    apiKey: '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL_DEFAULT,
    model: process.env.DEEPSEEK_MODEL || DEEPSEEK_MODEL_DEFAULT
  };
}

if (!process.env.DEEPSEEK_API_KEY && !process.env.AGNES_API_KEY) {
  console.warn('[WARN] 未配置任何 API Key。请在 .env 填入 DEEPSEEK_API_KEY 或 AGNES_API_KEY。');
}

app.use(express.json({ limit: '2mb' }));
// 禁用静态资源缓存，前端代码更新后无需手动清浏览器缓存
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: false, lastModified: false, setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store, max-age=0'); } }));

/* ---------- LLM 流式调用（DeepSeek / Agnes 统一走 OpenAI 兼容 /chat/completions） ---------- */
app.post('/api/chat', async (req, res) => {
  const { system, messages, maxTokens } = req.body;
  const useStream = req.body.stream !== false;
  const token = req.headers.authorization;
  const cfg = currentConfig();
  // 支持用户在前端传 Bearer token（覆盖 .env key）；否则用服务端 key
  const apiKey = token ? token.replace(/^Bearer\s+/i, '') : cfg.apiKey;

  if (!apiKey) {
    return res.status(401).json({ error: `未配置 ${cfg.provider === 'deepseek' ? 'DeepSeek' : 'Agnes'} API Key，请在 .env 填入 DEEPSEEK_API_KEY 或 AGNES_API_KEY，或前端传 Bearer token` });
  }

  try {
    const isDeepSeek = cfg.provider === 'deepseek';
    const baseUrl = isDeepSeek
      ? (process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL_DEFAULT)
      : (process.env.AGNES_BASE_URL || AGNES_BASE_URL_DEFAULT);
    // DeepSeek：统一用 deepseek-chat（完整模型），避免 .env 里的 flash 导致长输出截断
    // Agnes：用 .env 配置的模型
    const effectiveModel = isDeepSeek ? 'deepseek-chat' : (cfg.model || AGNES_MODEL_DEFAULT);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [{ role: 'system', content: system }, ...(messages || [])],
        stream: useStream,
        max_tokens: maxTokens || 32768
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      res.status(resp.status).json({
        error: `${cfg.provider === 'deepseek' ? 'DeepSeek' : 'Agnes'} API HTTP ${resp.status}`,
        detail: errText.slice(0, 300)
      });
      return;
    }

    // 非流式：直接返回 JSON
    if (!useStream) {
      const data = await resp.json();
      res.json(data);
      return;
    }

    // 流式透传（SSE）
    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error('[API/chat] error:', err.message);
    res.status(500).json({ error: '内部错误', detail: err.message });
  }
});

/* ---------- 设计检索 ---------- */
const { buildDesignBrief } = require('./engine');

app.post('/api/design', (req, res) => {
  try {
    const brief = req.body;
    if (!brief || !brief.industryEn) {
      return res.status(400).json({ error: '请提供 industryEn 字段' });
    }
    const result = buildDesignBrief(brief);
    res.json(result);
  } catch (err) {
    console.error('[design] error:', err.message);
    res.status(500).json({ error: '设计检索失败', detail: err.message });
  }
});

/* ---------- 模型信息（告知前端当前 provider 与 key 状态） ---------- */
app.get('/api/config', (req, res) => {
  const cfg = currentConfig();
  res.json({
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    hasKey: !!cfg.apiKey
  });
});

/* ---------- 本地 API Key 管理（脱敏展示） ----------
 * 支持两个 key 字段：
 *   POST /api/key  body: { provider: 'deepseek'|'agnes', apiKey: '...' }
 *   前端 UI 按 /api/config 返回的 provider 来决定用哪个 key 面板
 */
function maskKey(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 8) return '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

app.get('/api/key', (req, res) => {
  const cfg = currentConfig();
  res.json({
    provider: cfg.provider,
    hasKey: !!cfg.apiKey,
    maskedKey: maskKey(cfg.apiKey),
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    deepseek: {
      hasKey: !!process.env.DEEPSEEK_API_KEY,
      maskedKey: maskKey(process.env.DEEPSEEK_API_KEY),
      baseUrl: process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL_DEFAULT,
      model: process.env.DEEPSEEK_MODEL || DEEPSEEK_MODEL_DEFAULT
    },
    agnes: {
      hasKey: !!process.env.AGNES_API_KEY,
      maskedKey: maskKey(process.env.AGNES_API_KEY),
      baseUrl: process.env.AGNES_BASE_URL || AGNES_BASE_URL_DEFAULT,
      model: process.env.AGNES_MODEL || AGNES_MODEL_DEFAULT
    }
  });
});

/* 写 .env：先删除所有同名 key 行（含空值行），再追加新 key，确保每行 key 唯一 */
function writeKeyToEnv(provider, key) {
  const envPath = path.join(__dirname, '..', '.env');
  let content = '';
  try { content = fs.readFileSync(envPath, 'utf8'); } catch (e) { content = ''; }
  const lines = content.split(/\r?\n/);
  const keyVar = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'AGNES_API_KEY';
  // 删除所有同名 key 行（含空值行），保留其余行
  const filtered = lines.filter(l => !new RegExp('^' + keyVar + '=').test(l.trim()));
  filtered.push(keyVar + '=' + key);
  fs.writeFileSync(envPath, filtered.join('\n') + '\n', 'utf8');
}

app.post('/api/key', (req, res) => {
  const provider = (req.body && req.body.provider) ? String(req.body.provider) : 'deepseek';
  const key = (req.body && req.body.apiKey) ? String(req.body.apiKey).trim() : '';
  if (!key) return res.status(400).json({ error: 'apiKey is required' });
  try {
    if (provider === 'deepseek') {
      writeKeyToEnv('deepseek', key);
      process.env.DEEPSEEK_API_KEY = key;
    } else {
      writeKeyToEnv('agnes', key);
      process.env.AGNES_API_KEY = key;
    }
    res.json({ ok: true, provider, maskedKey: maskKey(key), note: 'key saved to .env and active in this server process' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to write .env', detail: e.message });
  }
});

app.post('/api/key/test', async (req, res) => {
  const provider = (req.body && req.body.provider) ? String(req.body.provider) : 'deepseek';
  const key = (req.body && req.body.apiKey) ? String(req.body.apiKey).trim()
    : (provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.AGNES_API_KEY);
  const baseUrl = provider === 'deepseek'
    ? (process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL_DEFAULT)
    : (process.env.AGNES_BASE_URL || AGNES_BASE_URL_DEFAULT);
  const model = provider === 'deepseek'
    ? (process.env.DEEPSEEK_MODEL || DEEPSEEK_MODEL_DEFAULT)
    : (process.env.AGNES_MODEL || AGNES_MODEL_DEFAULT);
  if (!key) {
    return res.status(401).json({ ok: false, error: `${provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'AGNES_API_KEY'} is not configured` });
  }
  try {
    // 用 /models 端点做连通性测试（OpenAI 兼容）
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    const ok = resp.status === 200;
    const detail = ok ? '' : await resp.text().catch(() => '');
    res.status(ok ? 200 : resp.status).json({
      ok,
      status: resp.status,
      provider,
      baseUrl,
      model,
      maskedKey: maskKey(key),
      detail: detail ? detail.slice(0, 300) : undefined
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: `${provider === 'deepseek' ? 'DeepSeek' : 'Agnes'} API 连通性测试失败`, detail: err.message });
  }
});

app.listen(PORT, () => {
  const cfg = currentConfig();
  console.log(`\n  🚀 Hello Site Bot 启动：http://localhost:${PORT}\n`);
  console.log(`  当前 provider: ${cfg.provider === 'deepseek' ? 'DeepSeek' : cfg.provider === 'agnes' ? 'Agnes' : '(未配置)'}`);
  console.log(`  模型: ${cfg.model}`);
  console.log(`  API Key: ${cfg.apiKey ? '已配置 ✅' : '未配置 ❌'}`);
  console.log('');
});
