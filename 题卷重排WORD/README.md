# 题卷重排 Word

独立部署的资料整理网站。用户可上传 PDF、DOCX、PNG 或 JPG，将标题、正文、
题目、答案、表格、图片等全部可见内容整理为可编辑内容项，人工复核并重排后导出 Word。

平台模式按一次上传中全部 PDF、图片和 DOCX 的总页数计费，固定每 5 页消耗 1 积分；
生成接口失败或中断时，平台会自动退回本次预扣积分，成功返回完整结果后不退款。

普通工作台与管理员 AI 配置页分离：前台只使用本站业务接口，管理员在受保护的
配置页保存兼容 Chat Completions 协议的 AI 接口后，前台的智能识别功能即可生效。

## 本地开发

1. 安装依赖：`npm ci`
2. 复制 `.env.example` 为 `.env`，设置管理员账号和强密码。
3. 启动前后端开发服务：`npm run dev`

开发工作台：`http://127.0.0.1:5173/`

开发 AI 配置页：`http://127.0.0.1:5173/admin.html`

`npm run dev:client` 只启动 Vite 前端开发服务器，`npm run dev:server` 只启动
支持热重载的本地服务端。开发模式下，Vite 根目录为 `src`，根目录的 `public` 会
作为静态资源目录提供。

## 生产部署

```powershell
npm ci
npm run build
npm ci --omit=dev
npm start
```

构建会生成两类产物：

- `dist/`：由 Express 直接托管的前端静态文件。
- `.server-dist/`：由 TypeScript 编译出的 Node.js 服务端和共享模块。

`npm start` 仅通过 Node.js 执行 `.server-dist/server/index.js`，运行时不依赖
`tsx` 或其他开发依赖；未设置时会自动以 `NODE_ENV=production` 启动。生产服务默认
监听 `8791` 端口，可用 `PORT` 修改。

- 工作台：`https://你的域名/`
- AI 配置页：`https://你的域名/admin/ai-settings`

生产环境应通过 HTTPS 提供服务，管理员会话 Cookie 会在生产模式启用 `Secure`
属性。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | 是 | 管理员账号。 |
| `ADMIN_PASSWORD` | 是 | 强管理员密码，同时用于保护本地加密配置。修改后需重新保存 AI 配置。 |
| `PORT` | 否 | 服务端端口，默认 `8791`。 |
| `AI_SETTINGS_FILE` | 否 | 加密配置文件路径，默认 `.ai-config.local.json`。 |
| `UPSTREAM_TIMEOUT_MS` | 否 | 单次上游 AI 请求超时，默认 `180000` 毫秒；多页超时会立即拆分为更小批次。 |
| `RECOGNITION_OPERATION_TIMEOUT_MS` | 否 | 单个识别批次及其拆分重试的总时间上限，默认 `600000` 毫秒；最终失败返回错误并退款。 |
| `RECOVERY_TARGET_TIMEOUT_MS` | 否 | 单个表格或图形复检的时间上限，默认 `20000` 毫秒；超时直接保留原页，不阻塞整卷识别。 |
| `RECOVERY_BATCH_TIMEOUT_MS` | 否 | 单个批次所有增强复检的总时间上限，默认 `12000` 毫秒。 |
| `WORD_RECOGNITION_RECOVERY` | 否 | 是否启用耗时图形复检；生产默认关闭，设为 `1` 后仅作为增强步骤运行。 |
| `DOCX_IMPORT_MAX_BYTES` | 否 | DOCX 原文件页数核验的最大请求体字节数，默认 `536870912`（512MiB）。 |
| `TRUST_PROXY` | 否 | 仅在一个受信任反向代理之后设为 `1`，使限流按转发的客户端 IP 生效；默认 `0`。 |

## 常用命令

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

`npm run preview` 预览已生成的前端 `dist/` 文件；需要调用 AI 接口时，请同时运行
`npm run dev:server` 或已构建的 `npm start` 服务。

## 安全边界

- 前台通过 `/api/recognition-sessions` 会话端点逐页上传并查询进度，通过
  `/api/docx-import-sessions` 核验 Word 文件页数；两类会话都按平台用户隔离，不包含
  上游接口地址、密钥、模型或管理员凭据。
- 管理员会话使用 HttpOnly、SameSite Cookie，AI 配置路由要求服务端鉴权。
- 密钥仅在管理员保存时发送到服务端，并使用 AES-256-GCM 加密写入被 Git 忽略的
  本地文件；接口不会回显密钥。
- 更换接口主机时必须重新填写密钥，不能复用已保存密钥；生产环境仅允许 HTTPS 上游，并
  拒绝本机、私网和链路本地地址。
- 服务端分别限制管理员、登录和会话初始化/完成请求的频率，并逐页校验图片格式、尺寸
  与页码关系；页面上传使用磁盘背压和会话清理，不设置用户可见的固定文件数量、页数或
  整卷请求体上限。
