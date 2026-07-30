# AI 解题步骤器契约

## 配置模型

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---|---|---|
| providerName | string | 是 | 1-40 字符 | 展示名称 |
| baseUrl | string | 是 | HTTP/HTTPS URL | 默认 OpenAI 兼容根地址 |
| apiKey | string | 保存时条件必需 | 非空 | 服务端加密，读取时只返回掩码 |
| model | string | 是 | 1-100 字符 | 需支持当前输入类型 |
| temperature | number | 是 | 0-1 | 默认 0.2 |
| timeoutMs | integer | 是 | 5,000-120,000 | 默认 60,000 |

示例：

```json
{
  "providerName": "OpenAI 兼容服务",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4.1-mini",
  "temperature": 0.2,
  "timeoutMs": 60000
}
```

## 分步路径模型

| 字段 | 类型 | 必需 | 约束 |
|---|---|---|---|
| problemSummary | string | 是 | 10-800 字符，支持 Markdown + LaTeX |
| knowledgePoints | string[] | 是 | 1-8 项 |
| steps | Step[] | 是 | 固定 4 项 |
| finalAnswer | string | 是 | 20-6000 字符，完整答案，支持 Markdown + LaTeX |

`Step`：

| 字段 | 类型 | 必需 | 约束 |
|---|---|---|---|
| title | string | 是 | 对应读懂已知、确定方法、列式求解、检验作答 |
| description | string | 是 | 当前步骤目标，支持 Markdown + LaTeX |
| task | string | 是 | 本步需要解决的核心问题，支持 Markdown + LaTeX |
| guidance | string | 是 | AI 直接给出的具体步骤指导，支持 Markdown + LaTeX，可包含必要推导和结果 |
| hints | string[] | 是 | 固定 3 项，支持 Markdown + LaTeX，作为三级补充指导直接公开 |

## 科学内容契约

- 行内公式使用 `$...$`，独立公式使用 `$$...$$`，JSON 中的反斜杠必须正确转义。
- 数学与几何示例：`$\angle B = 70^\circ$`。
- 物理与单位示例：`$F=ma$`、`$9.8\,\mathrm{m\,s^{-2}}$`。
- 化学示例：`$\ce{2H2 + O2 -> 2H2O}$`。
- 生物示例：`$X^\mathrm{A}X^\mathrm{a}$`、`$5^\prime\to3^\prime$`。
- 地理示例：`$30^\circ\mathrm{N}$`、`$1:50\,000$`。
- 所有公式节点必须通过 KaTeX 严格编译，化学命令由 `mhchem` 扩展解析。
- 正文不得包含 U+FFFD、私用字符、裸科学符号、裸上下标、裸科学单位、未闭合定界符或未包裹的等式。
- 普通正文不得包含任何裸拉丁字母；变量、点名、线段名、单位、化学式、遗传缩写与方向缩写均必须位于 LaTeX 中。
- AI 首次结果先清理中文句子中的无语义英文冠词噪声；校验失败后，携带字段、原因和违规片段执行最多三轮结构化修复。连续无进展时允许等义重写问题字段，最终仍失败才返回 `422 AI_SCIENTIFIC_NOTATION_INVALID`。

## 结果不变量

- 每次分析固定生成四步，标题顺序固定。
- 每一步都必须包含 `guidance` 和 3 条公开的补充指导。
- 前端不提交步骤答案，也不存在通过、分数、尝试次数和解锁状态。
- 只读结果会话超过 4 小时未访问后失效。
- 会话中保存的是已通过科学内容校验的 Markdown + LaTeX 源文本，网页、PDF 与 Word 使用同一份源文本。
- 所有公开会话响应包含 `contentSchemaVersion: 2`；前端不得展示版本缺失或版本不匹配的旧会话。
- `finalAnswer` 必须通过与四步内容相同的科学内容校验。

## HTTP API

### `GET /api/health`

响应示例：

```json
{"ok":true,"configured":false,"contentSchemaVersion":2}
```

### `GET /api/config/status`

响应示例：

```json
{"configured":true,"providerName":"OpenAI 兼容服务","model":"gpt-4.1-mini"}
```

### `GET /api/config`

请求头：`x-admin-password`。响应不返回明文密钥。

### `PUT /api/config`

请求头：`x-admin-password`。请求体使用配置模型。成功返回公开配置。

### `POST /api/config/test`

请求头：`x-admin-password`。使用请求体中的未保存配置测试最小 AI 调用。

### `POST /api/analyze`

`multipart/form-data` 字段：`subject`、`grade`、`file`。`subject` 和 `grade` 可传“自动识别”。

成功响应示例：

```json
{
  "sessionId": "uuid",
  "problemSummary": "已知……求……",
  "knowledgePoints": ["等腰三角形"],
  "contentSchemaVersion": 2,
  "steps": [
    {
      "index": 0,
      "title": "读懂已知",
      "description": "梳理条件与问题",
      "task": "明确已知条件和所求",
      "guidance": "题目给出……，需要求……",
      "hints": ["方向说明", "方法说明", "具体操作"]
    }
  ],
  "finalAnswer": "完整推导与最终结论"
}
```

### `GET /api/sessions/:sessionId`

返回已生成的同一份只读分步指导，用于页面刷新后恢复结果。

## 错误模型

所有接口使用：

```json
{"error":"面向用户的中文说明","code":"STABLE_ERROR_CODE"}
```

常用状态码：400 输入错误，401 配置页未授权，404 会话不存在，413 文件过大，422 AI 结果不合规，429 请求过频，502 AI 服务失败，503 AI 未配置。
