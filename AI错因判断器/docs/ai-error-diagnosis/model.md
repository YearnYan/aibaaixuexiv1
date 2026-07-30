# AI 错因判断接口与数据契约

## 配置接口

### `GET /api/config`

返回非敏感配置。`apiKey` 永不返回。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---|---|---|
| provider | string | 是 | 预设提供商或 `custom` | 提供商标识 |
| baseUrl | string | 是 | HTTP/HTTPS URL | OpenAI 兼容 API 根地址 |
| model | string | 是 | 1-100 字符 | 模型名称 |
| temperature | number | 是 | 0-1 | 生成温度 |
| timeoutMs | number | 是 | 10000-180000 | 请求超时 |
| hasApiKey | boolean | 是 | 只读 | 是否已有密钥 |
| requiresAdminPassword | boolean | 是 | 只读 | 配置接口是否受密码保护 |

### `PUT /api/config`

请求示例：

```json
{
  "provider": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4.1-mini",
  "temperature": 0.2,
  "timeoutMs": 90000
}
```

空字符串 `apiKey` 表示保留原密钥；`clearApiKey: true` 表示清除密钥。启用 `ADMIN_PASSWORD` 时，请求必须携带 `X-Admin-Password`。

### `POST /api/config/test`

使用当前已保存配置进行最小模型请求。成功响应示例：

```json
{"ok":true,"message":"模型连接成功","model":"gpt-4.1-mini","latencyMs":680}
```

## 分析接口

### `POST /api/analyze`

内容类型为 `multipart/form-data`。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---|---|---|
| questionFile | file | 是 | PDF/DOC/DOCX/PNG/JPG/JPEG，最大 20MB | 原题与题目材料 |
| subject | string | 是 | 1-30 字符 | 学科 |
| studentAnswer | string | 否 | 最大 12000 字符 | 学生原始答案和过程 |
| correctAnswer | string | 否 | 最大 12000 字符 | 正确答案 |
| standardProcess | string | 否 | 最大 12000 字符 | 标准过程 |
| scoringCriteria | string | 否 | 最大 8000 字符 | 评分标准 |
| selfAssessment | string | 否 | 最大 100 字符 | 学生自判 |

成功响应中的 `report`：

```json
{
  "firstError": {"stepNumber": 2, "stepName": "方法选择", "description": "...", "impact": "..."},
  "evidence": "...",
  "errorType": "方法选择错误",
  "errorTypeReason": "...",
  "timeline": [
    {"stepNumber": 1, "stepName": "题意读取", "status": "正确", "detail": "..."},
    {"stepNumber": 2, "stepName": "方法选择", "status": "首次出错", "detail": "..."},
    {"stepNumber": 3, "stepName": "列式计算", "status": "受影响", "detail": "..."},
    {"stepNumber": 4, "stepName": "最终答案", "status": "受影响", "detail": "..."}
  ],
  "comparison": {"studentJudgment": "运算粗心", "aiJudgment": "方法选择错误", "conclusion": "学生自判与AI判断不一致"},
  "correction": {"action": "...", "rationale": "...", "checklist": ["...", "..."]},
  "needsTeacherReview": true,
  "reviewReason": "...",
  "confidence": 0.82,
  "generatedAt": "2026-07-17T12:00:00.000Z"
}
```

## 不变量与验证规则

- `timeline` 固定为 4 个连续步骤，步骤号为 1 至 4。
- 能够确定错因时，`firstError.stepNumber` 为 1 至 4，且必须指向 `timeline` 中唯一状态为“首次出错”的步骤。
- 信息不足时，`firstError.stepNumber` 必须为 0、`errorType` 必须为“信息不足，无法确定”，时间线不得虚构“首次出错”。
- `errorType` 必须为七类可训练错因之一或“信息不足，无法确定”。
- `needsTeacherReview` 为真时，`reviewReason` 不能为空。
- 所有公式使用 `\(...\)` 或 `\[...\]` 分隔；化学方程式和离子式使用 `\ce{...}`；单位放在 `\mathrm{...}` 中。
- 报告返回前必须通过 KaTeX 公式校验；无法解析的公式触发一次模型纠正，仍失败则返回 502，不返回半渲染报告。
- HTTP 400 表示输入无效，401 表示管理密码错误，413 表示文件过大，422 表示题目无法解析，503 表示 AI 未配置，502/504 表示上游模型失败或超时。

## 报告导出接口

### `POST /api/export/pdf`

### `POST /api/export/docx`

两个端点使用相同的 JSON 请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---|---|---|
| subject | string | 是 | 1-30 字符 | 学科 |
| sourceFilename | string | 否 | 最大 255 字符 | 原题文件名，仅用于报告信息 |
| report | object | 是 | 必须满足分析报告 schema | 完整六模块报告 |

请求示例：

```json
{
  "subject": "化学",
  "sourceFilename": "学生错题.png",
  "report": {
    "firstError": {
      "stepNumber": 2,
      "stepName": "方法选择",
      "description": "未按 \\(n=\\frac{m}{M}\\) 计算物质的量",
      "impact": "后续配比错误"
    },
    "evidence": "学生直接使用质量比",
    "errorType": "方法选择错误",
    "errorTypeReason": "遗漏物质的量换算",
    "timeline": [
      {"stepNumber": 1, "stepName": "题意读取", "status": "正确", "detail": "条件读取完整"},
      {"stepNumber": 2, "stepName": "方法选择", "status": "首次出错", "detail": "换算方法错误"},
      {"stepNumber": 3, "stepName": "列式计算", "status": "受影响", "detail": "比例随之错误"},
      {"stepNumber": 4, "stepName": "最终答案", "status": "受影响", "detail": "结果错误"}
    ],
    "comparison": {"studentJudgment": "运算错误", "aiJudgment": "方法选择错误", "conclusion": "判断不一致"},
    "correction": {"action": "先计算物质的量", "rationale": "按化学计量数比较", "checklist": ["写出 \\(n=\\frac{m}{M}\\)", "代入数据"]},
    "needsTeacherReview": false,
    "reviewReason": "",
    "confidence": 0.91,
    "generatedAt": "2026-07-18T02:00:00.000Z"
  }
}
```

响应：

- PDF：`application/pdf`，A4 报告，模块使用禁止页内切割规则。
- Word：`application/vnd.openxmlformats-officedocument.wordprocessingml.document`，正文为可编辑 `w:t` 文本，公式为可编辑 `m:oMath` 原生 Office 数学对象。
- Word 导出不得包含公式图片、公式媒体关系或公式占位文本；任一公式无法转换为 OMML 时，整个导出请求必须失败并返回明确错误，不得静默降级。
- 文件名通过 `Content-Disposition` 返回，不在服务器持久化。
- HTTP 400 表示导出载荷无效，422 表示公式或文档无法生成，500 表示本机导出引擎不可用。
