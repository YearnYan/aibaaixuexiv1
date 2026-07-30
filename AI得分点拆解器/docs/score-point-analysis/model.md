# API 与数据模型

## 配置模型 `AiConfig`

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| protocol | string | 是 | `responses` 或 `chat-completions` | AI 请求协议 |
| baseUrl | string | 是 | HTTPS；本机开发允许 HTTP | API 根地址，不含末尾 `/` |
| apiKey | string | 是 | 保存时可留空以保留旧值 | 仅加密存储，读取时不返回原文 |
| model | string | 是 | 1-100 字符 | 模型标识 |
| timeoutMs | number | 是 | 10000-180000 | 请求超时毫秒数 |

示例：

```json
{
  "protocol": "responses",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "",
  "model": "gpt-5.6",
  "timeoutMs": 120000
}
```

## 得分点模型 `ScorePoint`

### 富文本约定 `AcademicText`

- 普通叙述保持纯文本，不允许 HTML 或 Markdown HTML。
- 行内公式使用 `\(...\)`，独立公式使用 `\[...\]`。
- 化学式与化学方程式在公式定界符内使用 `\ce{...}`。
- 物理量、单位、上下标、向量、希腊字母、分式、根式、积分、矩阵、集合、遗传组合和地理计算均使用标准 LaTeX 命令。
- 简单且无歧义的中文标点、数字与单位说明可使用 Unicode；不得返回裸露的 `\frac`、`\sqrt`、`\ce` 等命令。
- 公式由服务端统一校验，浏览器以不信任模式渲染。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| id | string | 是 | 页面内唯一 | 服务端可重新编号 |
| category | string | 是 | 六类固定值之一 | `answer_target`、`core_conclusion`、`key_evidence`、`reasoning_steps`、`keywords`、`format` |
| label | string | 是 | 1-20 字符 | 中文得分点名称 |
| score | number | 是 | 0-150 | 分值总和归一到题目总分；0 表示关联评价维度 |
| status | string | 是 | `covered`、`partial`、`missing`、`pending`、`compliant` | 覆盖状态 |
| earnedScore | number | 是 | 0 到 `score` | 当前获得分数 |
| evidence | string | 是 | 可为空字符串 | 学生答案中的对应表达 |
| requirement | string | 是 | 最多 700 字符 | 本题在该维度的评分观察点；指导模式含通用方法与本题应用 |
| analysis | string | 是 | 最多 1000 字符 | 有作答时为针对性诊断；无作答时为本题具体解题指导 |
| suggestion | string | 是 | 最多 700 字符 | 可执行的提分动作，不提供可直接抄写的完整答案 |

## 报告模型 `AnalysisReport`

| 字段 | 类型 | 必需 | 约束 | 备注 |
|---|---|---:|---|---|
| questionPreview | string | 是 | 最多 1200 字符 | 题目摘要，不含无关正文 |
| totalScore | number | 是 | 与请求总分一致 | 题目总分 |
| earnedScore | number | 是 | 0 到总分 | 各项已得分之和 |
| missingScore | number | 是 | 0 到总分 | `totalScore - earnedScore` |
| hasStudentWork | boolean | 是 | 模型识别与请求事实合并 | 任一上传文件中是否存在学生作答 |
| hasStudentAnswer | boolean | 是 | 与 `hasStudentWork` 相同 | 兼容旧前端的别名 |
| studentWorkSource | string | 是 | `question_file`、`answer_file`、`none` | 作答来源 |
| resultState | string | 是 | `guidance`、`needs_improvement`、`full_score` | 服务端根据作答与得失分派生的文案状态 |
| contentFormat | string | 是 | 固定为 `latex-v1` | 报告学科文本格式版本 |
| requiresTeacherReview | boolean | 是 | 布尔值 | 缺少可靠评分标准或开放题时为真 |
| scorePoints | ScorePoint[] | 是 | 1-12 项 | 拆解后的得分点 |
| revisionAdvice | string | 是 | 最多 160 字符 | 一句修改建议 |
| reviewNote | string | 是 | 最多 160 字符 | 教师复核提示 |

## HTTP API

### `GET /api/health`

响应示例：

```json
{"ok":true,"configured":false}
```

### `GET /api/config`

- 远程生产访问需要请求头 `x-admin-password`。
- 返回 `AiConfig`，其中 `apiKey` 替换为 `apiKeyConfigured` 和 `apiKeyMasked`。

响应示例：

```json
{
  "protocol":"responses",
  "baseUrl":"https://api.openai.com/v1",
  "model":"gpt-5.6",
  "timeoutMs":120000,
  "apiKeyConfigured":true,
  "apiKeyMasked":"sk-••••••••1234"
}
```

### `PUT /api/config`

- 请求体：`AiConfig`。
- `apiKey` 为空时保留现有密钥；首次保存时不得为空。
- 响应不返回原始密钥。

### `POST /api/config/test`

- 请求头权限同配置接口。
- 使用请求体中的非空配置；空密钥回退到已保存密钥。

响应示例：

```json
{"ok":true,"message":"AI 连接成功"}
```

### `POST /api/analyze`

- 内容类型：`multipart/form-data`。
- 字段：
  - `subject`：1-30 字符。
  - `totalScore`：1-150。
  - `questionFile`：必需，最大 15 MB。
  - `answerFile`：可选，最大 15 MB。
- 成功响应：`AnalysisReport`。

响应片段示例：

```json
{
  "hasStudentWork": true,
  "hasStudentAnswer": true,
  "studentWorkSource": "question_file",
  "contentFormat": "latex-v1",
  "scorePoints": [{
    "category": "reasoning_steps",
    "label": "推理步骤",
    "score": 4,
    "status": "partial",
    "earnedScore": 2,
    "evidence": "学生写出了旋转前后对应边关系",
    "requirement": "建立旋转后的对应关系并完成面积推导",
    "analysis": "已识别对应点，但缺少由边长关系过渡到面积关系的步骤",
    "suggestion": "补写对应边、底高或面积公式之间的推导链"
  }]
}
```

错误响应示例：

```json
{
  "error": {
    "code": "AI_NOT_CONFIGURED",
    "message": "请先完成 AI 配置"
  }
}
```

## 不变量

- `earnedScore + missingScore = totalScore`。
- `scorePoints[].score` 之和等于 `totalScore`，允许最终项承担浮点校正。
- 任一文件中检测到学生作答时必须逐项评分；仅在所有文件均无作答时，各项 `earnedScore` 为 0、状态为 `pending`。
- 每个得分点的 `requirement`、`analysis`、`suggestion` 均为非空文本；缺失时由服务端按维度补齐安全指导。
- `resultState=guidance` 时，每个得分点的 `requirement`、`analysis`、`suggestion` 均包含通用方法和本题具体应用，不得只返回可复用于任意题目的空泛模板。
- 所有 `AcademicText` 字段中的 LaTeX 定界符必须闭合且表达式可解析；检测到替换字符或裸露公式命令时报告无效并触发兼容重试。
- `resultState=full_score` 时，整体建议和已掌握维度的兜底文案必须为正向保持建议，不得出现补充、缺失或未识别有效表达等冲突语义。
- PDF 与 Word 导出字段必须覆盖题目预览、分数概览、六个得分维度全部详情、整体建议和复核说明。
- PDF 导出的语义块不得跨页拆分；Word 叙述文字必须可编辑，公式媒体必须携带原始 LaTeX 替代说明。
- API 响应、日志和静态资源中不得出现完整 AI 密钥。
