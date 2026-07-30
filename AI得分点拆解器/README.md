# AI 得分点拆解网站

面向教师和学生的单功能得分点分析工具。上传题目资料后，AI 会把评分要求拆成答题对象、核心结论、关键依据、推理步骤、关键词和格式要求；题目图片或独立答案文件中存在学生作答时逐项诊断，没有作答时提供六维解题指导。

## 功能

- 支持 PDF、Word、PNG、JPG、TXT 和 Markdown 题目资料。
- 学生答案可单独上传，也可直接写在题目图片中；系统会检查全部资料中的作答痕迹。
- 每个维度可展开查看评分观察、针对性分析、提分动作，以及检测到作答时的作答依据。
- 未检测到作答时不显示误导性的零分结论；六维的评分观察、解题指导和解题建议会同时提供通用方法与本题具体应用。
- 输出题目预览、总分、得失分、六类评分诊断和整体修改方向。
- 数学、物理、化学、生物、地理等学科公式统一使用标准 LaTeX 渲染，化学式和化学方程式支持 `\ce{...}`。
- 分析完成后可下载完整 PDF 和 Word 报告；PDF 按语义块分页，Word 正文可编辑并稳定显示公式。
- 支持 OpenAI Responses API 和兼容 Chat Completions 接口。
- 提供独立 AI 配置页面，API 密钥在服务端加密保存。
- 桌面优先，并适配手机纵向操作。

## 本地运行

环境要求：Node.js 20 或更高版本。

```powershell
npm install
npm start
```

打开：

- 主页面：<http://localhost:3000>
- AI 配置：<http://localhost:3000/config>

首次使用先进入 AI 配置页，填写接口协议、API 地址、模型和密钥，点击“测试连接”，成功后保存配置。

## 公式与报告下载

- 行内公式使用 `\(...\)`，独立公式使用 `\[...\]`，化学式使用 `\ce{...}`；AI 返回结果会先经过服务端校验，再在网页中渲染。
- PDF 会包含题目预览、分数概览、六维全部详情、整体建议和复核说明。单个得分维度不会在页尾被切成两段，当前页空间不足时整体移到下一页。
- Word 使用原生段落和表格保存叙述内容，正文可继续编辑；公式由相同 LaTeX 源生成高分辨率对象，并附带原始公式替代说明。
- 下载按钮仅在成功生成报告后启用，避免导出页面中的示例报告。

## AI 配置

### OpenAI Responses API

推荐配置：

```text
接口协议：OpenAI Responses API
API 地址：https://api.openai.com/v1
模型：gpt-5.6
```

该模式会把 PDF、Word 等文件作为 `input_file`，把 PNG/JPG 作为视觉输入，并使用 JSON Schema 约束报告结构。

### 兼容 Chat Completions

用于支持 `/chat/completions` 的兼容服务。图片会作为视觉输入；PDF、DOCX、TXT 和 Markdown 会先在服务端提取文本。旧版 `.doc` 和扫描 PDF 建议转为图片，或改用 Responses API。

## 生产环境

复制 `.env.example` 为 `.env`，至少设置：

```dotenv
NODE_ENV=production
ADMIN_PASSWORD=请设置高强度管理密码
```

可选环境变量：

- `PORT`：服务端口，默认 `3000`。
- `AI_PROTOCOL`：`responses` 或 `chat-completions`。
- `AI_BASE_URL`：AI API 根地址。
- `AI_MODEL`：模型标识。
- `AI_API_KEY`：也可通过环境变量注入密钥。
- `AI_TIMEOUT_MS`：AI 请求超时，范围 10000-180000。
- `CONFIG_ENCRYPTION_KEY`：固定配置加密主密钥。
- `TRUST_PROXY`：仅在可信反向代理之后部署时设置。

生产环境必须使用 HTTPS。配置接口由 `ADMIN_PASSWORD` 保护；浏览器只接收密钥掩码，不会收到原始密钥。

## 数据与安全

- 上传文件使用内存存储，分析完成后释放，不写入项目目录。
- 单文件最大 15 MB，每次最多上传题目资料和学生答案各一份。
- AI 密钥使用 AES-256-GCM 加密，默认保存在 `.data/ai-config.json`。
- 未设置 `CONFIG_ENCRYPTION_KEY` 时，服务会在 `.data/.config-key` 生成本机加密密钥。
- AI 评分用于训练反馈，开放性题目仍需教师复核。

## 质量检查

```powershell
npm run check
npm test
```

测试覆盖报告分值归一化、题面作答识别、无作答具体指导、跨学科 LaTeX 与化学式、公式安全截断、六维详情契约、AI 请求结构、供应商静态资源、密钥加密、配置权限和文件上传主流程。
