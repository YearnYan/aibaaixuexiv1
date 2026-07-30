# 试卷讲评 PPT

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

复制 `.env.example` 为 `.env`，并填写：
- `OPENAI_API_KEY`（也可启动后在 AI 配置页中设置）
- `HOST`（可选，默认：`127.0.0.1`）
- `OPENAI_BASE_URL`（默认：`https://api.linapi.net/v1`）
- `OPENAI_MODEL`（默认：`gemini-3-flash-preview`）
- `PORT`（例如 `5270`）
- `REQUEST_BODY_LIMIT`（可选，默认：`80mb`）
- `MAX_CHAT_REQUEST_BYTES`（可选，默认：`8388608`）
- `AI_REQUEST_TIMEOUT_MS`（可选，默认：`180000`）
- `AI_MAX_TOKENS`（可选，默认：`8192`）
- `AI_TEMPERATURE`（可选，默认：`0.2`）

3. 启动服务

```bash
npm run dev
```

访问地址：

```text
http://127.0.0.1:PORT
```

AI 运行时配置页：

```text
http://127.0.0.1:PORT/ai-config/
```

## AI 运行时配置

- 配置仅保存在当前 Node.js 进程内，服务重启后恢复环境变量。
- API Key 不写入 `.env` 或浏览器存储，也不会从配置接口回显。
- 配置接口仅允许从本机回环地址访问。
- “测试连接”只在用户主动点击后发送最小上游请求。

## 跨学科公式渲染

- 数学、物理、化学、生物、地理等学科公式统一使用 LaTeX 与 MathJax SVG 渲染。
- 化学式、离子和反应式使用 mhchem 语法；物理单位按上下文使用正体排版。
- 历史 AI 输出中的 `sqrt()`、裸幂、乘号和 ASCII 反应箭头会先规范化。
- 裸命令、缺参数、未闭合分隔符和程序式表达会被定位到具体题目字段，并进入最多 4 轮的字段级定向修复。
- 修复只允许改动被诊断字段；全量复检通过后才生成。连续未通过时保留当前进度，用户可原地继续修复。
- 单元测试：`npm test`。

## Cloudflare 部署

1. 登录 Cloudflare CLI

```bash
wrangler whoami
```

2. 配置密钥（必填）

```bash
wrangler secret put OPENAI_API_KEY
```

3. 发布

```bash
wrangler deploy
```

说明：
- 静态文件目录：`public/`
- Worker 入口：`worker.js`
- API 路由：`POST /api/chat`、`POST /api/site/exam-ppt`
- 大文件策略：前端会自动压缩、分批、失败后拆批重试，后端会返回明确的 `413` 以触发降载
