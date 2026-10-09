# Hello Site Bot

基于 Node.js + Express 的网站生成机器人，参考 `website-agent-skills` 中的 skill 实现。

## 功能

- **需求门问**：通过对话逐步确认网站需求（业务、客户、卖点、动作、风格）
- **设计检索**：本地 BM25 引擎从 7 个 CSV 设计知识库检索风格、色板、字体、版式
- **流式生成**：通过本地 `/api/chat` 代理调用 LLM API（DeepSeek / Agnes 双 provider），SSE 流式生成 HTML
- **预览/下载/修改/自检**：前端双栏 UI，支持实时预览、代码复制、下载、迭代修改、三层 QA 自检

## LLM Provider 支持

同时支持 **DeepSeek** 和 **Agnes** 两个 provider，按 `.env` 中 key 的优先级自动选择：

| 优先级 | Provider | 触发条件 |
|--------|----------|----------|
| 1 | DeepSeek | `DEEPSEEK_API_KEY` 有值 |
| 2 | Agnes | `DEEPSEEK_API_KEY` 未配置且 `AGNES_API_KEY` 有值 |

两个 provider 均走 OpenAI 兼容 `/chat/completions` 接口，前端代码无需修改。

## 项目结构

```
hello/
├── .env                      # LLM API 配置（双 provider）
├── .gitignore
├── package.json
├── design-data/
│   ├── charts.csv
│   ├── colors.csv
│   ├── landing.csv
│   ├── products.csv
│   ├── styles.csv
│   ├── typography.csv
│   └── ux-guidelines.csv
├── public/
│   ├── app.js                # 前端编排（SSE 解析、对话流程、预览/下载/修改/自检）
│   └── index.html            # 前端 UI（含双 provider key 管理面板）
└── server/
    ├── index.js              # Express 服务器（/api/chat、/api/design、/api/config、/api/key）
    ├── engine.js             # BM25 设计检索引擎
    └── prompts.js            # 提示词常量与构建函数
```

## 快速开始

### Windows PowerShell 启动

```powershell
# 1. 进入项目目录
Set-Location C:\Users\a\Desktop\hello

# 2. 首次运行先安装依赖（已有 node_modules 可跳过）
& "C:\Program Files\nodejs\npm.cmd" install

# 3. 启动服务（前台运行，按 Ctrl+C 停止）
node server/index.js

# 4. 浏览器访问
Start-Process "http://localhost:3000"
```

### 一键启动脚本

双击或运行：

```powershell
& "C:\Users\a\Desktop\hello\start.ps1"
```

## .env 配置

```bash
# ── DeepSeek（推荐优先使用）─────────────────
DEEPSEEK_API_KEY=sk-你的DeepSeekKey
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# ── Agnes（DeepSeek key 未配置时自动回退）─────
AGNES_API_KEY=sk-你的AgnesKey
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
AGNES_MODEL=agnes-2.5-flash

PORT=3000
```

> **获取 DeepSeek Key**：[https://platform.deepseek.com](https://platform.deepseek.com) → 登录 → API Keys → 创建

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | LLM 代理（DeepSeek / Agnes，流式 SSE / 非流式 JSON） |
| `/api/design` | POST | 设计知识库检索（BM25） |
| `/api/config` | GET | 当前 provider、模型、baseUrl、key 状态 |
| `/api/key` | GET | 双 provider key 脱敏状态 |
| `/api/key` | POST | 保存 key 到 `.env`（body: `{provider, apiKey}`） |
| `/api/key/test` | POST | 测试 key 连通性（body: `{provider, apiKey?}`） |

## 前端调用协议

- **流式**（`stream` 不传或 `true`）：服务器透传 SSE 帧（`data: {...}\n\n`），前端 `llmStream` 按 `\n` 分割 buffer，提取 `data:` 行，解析 `choices[0].delta.content` 累积
- **非流式**（`stream: false`）：服务器返回标准 OpenAI JSON，前端 `llmCall` 直接读 `choices[0].message.content`

## 技术要点

- 密钥仅存于 `.env`，前端不暴露
- 支持双 provider（DeepSeek 优先，Agnes 回退），切换 key 后立即生效，无需重启
- 前端可通过 `Authorization: Bearer <key>` header 直接传自己的 key，服务端透传
- 设计数据本地 CSV，无外部依赖
- SSE 解析在前端完成，服务器仅透传
