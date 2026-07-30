# AI 审题训练

这是课程第一课对应的可用网站成品。教师上传题目、试卷或作业后，服务端调用真实 AI 模型，输出任务词、限制条件、关键数据、隐藏条件、干扰信息和作答范围。AI 只负责审题，不输出完整解法与最终答案。

## 本地运行

环境要求：Node.js 22 或更高版本。

```powershell
npm install
npm run dev
```

- 审题页面：`http://localhost:5173/`
- 管理员 AI 配置页面：`http://localhost:5173/config`（用户页面不显示入口）

开发环境下未设置 `CONFIG_PASSWORD` 时，配置页的管理密码可以留空。填写 OpenAI 兼容接口地址、API 密钥和支持图片理解的模型后，先测试连接，再保存配置。

## 生产运行

```powershell
Copy-Item .env.example .env
npm run build
npm start
```

生产环境必须设置 `CONFIG_PASSWORD`，否则配置页只能查看状态，不能测试或保存。也可以直接使用环境变量配置 AI，环境变量优先于配置页：

```text
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=你的密钥
AI_MODEL=gpt-4.1-mini
CONFIG_PASSWORD=高强度管理密码
```

生产地址默认是：

- 审题页面：`http://localhost:8787/`
- 管理员 AI 配置页面：`http://localhost:8787/config`（用户页面不显示入口）

## Docker 部署

```powershell
docker build -t ai-question-review .
docker run -d --name ai-question-review `
  -p 8787:8787 `
  -e CONFIG_PASSWORD="高强度管理密码" `
  -v ai-question-data:/app/.data `
  ai-question-review
```

如果使用环境变量配置 AI，请同时传入 `AI_BASE_URL`、`AI_API_KEY` 和 `AI_MODEL`。公网部署必须使用 HTTPS，避免管理密码和上传资料在传输过程中被窃取。

## 支持的资料

- PDF：提取文档文字；扫描版 PDF 请导出为 PNG/JPG 后上传。
- Word：支持 DOCX；旧版 DOC 会给出转换提示。
- 图片：支持 PNG、JPG、JPEG，需要所选模型具备视觉理解能力。
- 辅助文本：支持 TXT、Markdown。

一次最多上传 5 个文件，单个文件最大 15 MB，总大小最大 30 MB。提取后的总文字不超过 50,000 字。

## 公式与报告导出

- 网页统一使用 KaTeX 和 `mhchem` 渲染 LaTeX，支持数学、物理、化学、生物、地理等学科的公式、单位、电荷、上下标、经纬度和比例尺。
- AI 输出会进行全字段公式校验；发现分隔符不完整、裸露 LaTeX 命令或乱码时自动修复一次，仍不合格则拒绝展示。
- 审题结果右上角可下载完整 PDF 和 Word 报告；PDF 保留网页报告布局，Word 将公式渲染为透明 PNG 嵌入，避免客户端缺少公式字体时丢失。
- PDF/Word 由服务器端 Chromium 生成，Docker 镜像已包含 Chromium 与中文字体。

## 质量检查

```powershell
npm run typecheck
npm test
npm run build
```

AI 输出会在服务端经过运行时 Schema 校验，字段缺失或格式错误时不会把不完整结果展示给用户。教师仍需校验题目识别和标准审题内容。

当前自动化验收包含 12 项测试，并覆盖跨学科公式解析、PDF 二进制生成和 DOCX 二进制生成。
