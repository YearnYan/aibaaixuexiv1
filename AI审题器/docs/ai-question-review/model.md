# AI 审题网站契约

## API 端点

### `GET /api/health`

响应示例：

```json
{ "ok": true }
```

### `GET /api/config/status`

响应字段：

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| configured | boolean | 是 | - | 是否具备接口地址、模型和密钥 |
| source | string | 是 | `file` / `environment` / `none` | 生效配置来源 |
| baseUrl | string | 是 | URL 或空字符串 | 不含密钥 |
| model | string | 是 | - | 当前模型 |
| hasApiKey | boolean | 是 | - | 仅表示是否存在密钥 |
| temperature | number | 是 | 0 至 1.5 | 采样温度 |
| maxTokens | number | 是 | 400 至 8000 | 最大输出 token |
| customInstructions | string | 是 | 最多 1000 字 | 补充审题要求 |

### `PUT /api/config`

请求头可包含 `x-config-password`。生产环境必须与 `CONFIG_PASSWORD` 一致。

请求示例：

```json
{
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4.1-mini",
  "temperature": 0.2,
  "maxTokens": 2400,
  "customInstructions": "优先识别数量范围和否定词。"
}
```

`apiKey` 为空时保留已保存密钥。响应与 `GET /api/config/status` 相同。

### `POST /api/config/test`

请求体与 `PUT /api/config` 相同；不会持久化。响应示例：

```json
{ "ok": true, "message": "连接成功" }
```

### `POST /api/analyze`

请求为 `multipart/form-data`：

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| subject | string | 是 | 1 至 30 字 | 学科 |
| grade | string | 是 | 1 至 30 字 | 年级 |
| notes | string | 否 | 最多 200 字 | 来源、章节或背景 |
| files | File[] | 条件必需 | 1 至 5 个 | 与文本题目至少一项存在 |

响应示例：

```json
{
  "analysis": {
    "questionText": "某班共有学生48人……",
    "problemType": "集合问题",
    "confidence": 0.97,
    "potentialOmissions": ["“至少”表示数量下限"],
    "taskWords": [{ "label": "问", "text": "两项都不会的有多少人" }],
    "restrictions": ["至少会打篮球的有28人"],
    "keyData": [{ "label": "总人数", "value": "48人" }],
    "hiddenConditions": ["“至少”包含同时会两项的人"],
    "distractions": [],
    "answerScope": "两项都不会的学生人数",
    "paraphrase": "根据总人数与两个项目的参与关系，求两项都不会的人数。",
    "highlights": [{ "text": "至少", "category": "restriction" }]
  },
  "meta": {
    "subject": "数学",
    "grade": "初中二年级",
    "source": "用户上传",
    "recognizedAt": "2026-07-17T10:30:25.000Z",
    "fileNames": ["题目.png"]
  }
}
```

## 不变量

- `confidence` 始终位于 0 至 1。
- 所有数组均返回数组，不以空字符串或 `null` 代替。
- 高亮类别只允许 `task`、`restriction`、`data`、`hidden`、`scope`。
- API 密钥永不出现在状态响应、审题响应或日志中。
- AI 仅执行审题信息提取，不输出完整解答与最终答案。
- 所有专业公式和符号必须位于 LaTeX 分隔符中；普通中文和标点不得包入公式。
- 化学反应式、离子、电荷、同位素和状态使用 `mhchem` 的 `\ce{...}` 语法。
- 网页与导出端对同一 LaTeX 内容的可见语义必须一致。

### `POST /api/export/pdf`

请求体：

```json
{
  "analysis": { "questionText": "设函数 \\(f(x)=x^2\\)……" },
  "meta": {
    "subject": "数学",
    "grade": "高中一年级",
    "source": "用户上传",
    "recognizedAt": "2026-07-17T10:30:25.000Z",
    "fileNames": ["题目.png"]
  }
}
```

响应：`application/pdf` 二进制附件，文件名为 `AI审题分析报告-YYYYMMDD-HHmmss.pdf`。

### `POST /api/export/word`

请求体与 PDF 导出一致。

响应：`application/vnd.openxmlformats-officedocument.wordprocessingml.document` 二进制附件，文件名为 `AI审题分析报告-YYYYMMDD-HHmmss.docx`。公式以原生 Office Math Markup Language（OMML）写入，可在 Microsoft Word/WPS 的公式编辑器中继续修改。

Word 公式不变量：

- 每个 LaTeX 公式对应一个 `m:oMath` 原生数学对象。
- 分式、根式、上下标、上下标组合、求和、积分、重音和矩阵使用对应 OMML 结构。
- 公式不得写成图片、截图、SVG 或裸露 LaTeX 文本。
- 任何公式转换失败时返回导出错误，不生成部分可编辑、部分图片的混合文档。
- 普通文字仍使用 Word 文本运行，可复制、搜索和编辑。

兼容性说明：本变更不修改 HTTP 请求或响应 MIME 类型，但 Word 文档内部公式表示从图片变为原生 OMML。

## 报告请求模型

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| analysis | Analysis | 是 | 与分析响应一致 | 不重新调用 AI |
| meta.subject | string | 是 | 1 至 30 字 | 学科 |
| meta.grade | string | 是 | 1 至 30 字 | 年级 |
| meta.source | string | 是 | 1 至 80 字 | 来源 |
| meta.recognizedAt | string | 是 | 1 至 80 字 | ISO 时间或可读时间 |
| meta.fileNames | string[] | 是 | 最多 5 项 | 来源文件名 |
