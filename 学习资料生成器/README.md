# 学习资料生成器

上传图片、PDF、DOC、DOCX 教材，或直接输入知识点后，通过真实多模态 AI 生成一条从理解、练习到复习的完整学习路径。项目包含文件解析、手动文本输入、结构化 AI 教研、交互练习、阅读进度与任务打卡，以及完整 PDF、Word 报告下载。

## 核心能力

- 图片与扫描型 PDF：压缩并交给多模态模型识别，扫描型 PDF 默认最多识别前 6 页。
- 文字型 PDF 与 Word：在服务端提取正文，不把原文件长期保存到磁盘。
- 分层学习资料：学习目标、学习导航、知识地图、重点精讲、逐段精读、概念词典、图解、易错点、练习和复习计划。
- 学习交互：目录定位、答案展开、完成度打卡、复制提纲、下载完整 PDF 或可编辑 Word。
- 强制真实 AI：未配置或调用失败时返回明确错误，不提供示例内容或本地生成回退。

## 下载完整报告

- `下载 PDF`：服务端使用本机 Chrome 或 Edge 渲染与网页相同的完整讲义 DOM，保留知识图解、练习答案、颜色、分页和打印样式。
- `下载 Word`：生成原生 A4 DOCX，包含中文字体、封面、页眉页码、固定宽度表格、知识地图、图解、完整答案和复习计划，可继续编辑。
- 下载接口：`POST /api/export/pdf` 与 `POST /api/export/docx`，请求体为当前页面的完整 `material` 对象。
- PDF 运行依赖：机器上需安装 Google Chrome 或 Microsoft Edge；如浏览器不在默认位置，可通过 `EXPORT_BROWSER_PATH` 指定可执行文件。

## 本地运行

环境要求：Node.js 22 或更高版本。

```powershell
npm install
npm start
```

浏览器打开：`http://127.0.0.1:5174`

开发时自动重启服务：

```powershell
npm run dev
```

## 启用真实 AI

当前工作区已配置指定 AI 网关与模型。迁移到其他环境时，复制 `.env.example` 为 `.env`，再填写服务端密钥：

```dotenv
PORT=5174
AI_API_KEY=你的服务端密钥
AI_BASE_URL=https://ai.wudi987.com/v1
AI_MODEL=gemini-3.5-flash-low
# 可选：仅在 Chrome 或 Edge 不位于默认安装路径时填写
EXPORT_BROWSER_PATH=
```

AI 服务需兼容 `POST /chat/completions`，并支持图片输入与 JSON 对象输出。密钥只在服务端使用，不会下发到浏览器。

## 验证

```powershell
npm test
node scripts/verify-exports.js
```

测试覆盖健康检查、AI 强制配置、上传边界、图片生成流程、AI 失败处理、模型 JSON 提取、输出结构补齐、内容清理，以及导出文件名、导出校验和 DOCX 中文回读。`verify-exports.js` 会通过正在运行的服务生成 PDF 与 Word 验收文件，分别写入 `output/pdf/` 和 `output/docx/`。

## 主要目录

```text
public/                            前端页面、样式与交互
src/files.js                       图片、PDF、Word 解析
src/ai.js                          AI 请求与结构化生成
src/material.js                    AI 讲义规范化与结构默认值
src/export/                        PDF、Word 完整报告生成
server.js                          HTTP 接口与静态资源服务
scripts/verify-exports.js          双格式下载与文件签名验收
test/                              Node.js 自动化测试
docs/study-material-generator/     方案、契约、任务和变更记录
```

## 使用边界

- 单次最多 8 个文件，单文件不超过 20 MB。
- 上传文件只在当前请求的内存中处理，不做长期保存。
- 长文档会截取主要正文；扫描型长 PDF 会在界面给出页数提示。
- 正式部署前应在网关层补充 HTTPS、请求频率限制、内容审核和模型配额管理。
