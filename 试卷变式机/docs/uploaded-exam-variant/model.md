# 上传原卷变式出卷契约

## POST /api/exam/generate-from-upload

请求体：

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| files | array | 是 | 1 至 60 个文件 | 上传文件列表 |
| files[].name | string | 是 | 非空 | 原始文件名 |
| files[].type | string | 是 | MIME 类型 | 浏览器提供 |
| files[].size | number | 是 | 单文件不超过 18MB | 字节数 |
| files[].dataUrl | string | 是 | `data:` URL | 文件内容 |
| variantDifficulty | number | 否 | 1-10，默认 8 | 变式难度，要求每道生成题匹配该难度级别 |
| variationCoefficient | number | 否 | 1-10，默认 6 | 变式系数，控制每道题的变化幅度；1-5 级偏保守，6-10 级只要求知识点和考点一致，其他维度可大幅变化 |

请求示例：

```json
{
  "files": [
    {
      "name": "数学试卷第一页.png",
      "type": "image/png",
      "size": 1024,
      "dataUrl": "data:image/png;base64,..."
    }
  ],
  "variantDifficulty": 8,
  "variationCoefficient": 6
}
```

响应体沿用现有试卷预览结构：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| title | string | 变式试卷标题 |
| questions | array | 按题型分组的新试卷题目 |
| answers | array | 新试卷答案和解析 |
| analysisSummary | object | AI 内部解析摘要，前端不展示 |
| metadata | object | 文件名、题目数量和生成模式 |
| trialCreditsRemaining | number | 剩余体验次数 |

`metadata` 追加以下可观测字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `figureIntegrityIssueCount` | number | 首次生成后检测到的题图完整性问题数量 |
| `figureRepairedIndexes` | number[] | 已定向修复的题号列表 |

## 不变量

- `metadata.sourceQuestionCount` 必须等于 `metadata.generatedQuestionCount`。
- 每个上传请求至少包含一个支持格式文件。
- 新卷题目按原卷顺序一一对应。
- `variantDifficulty` 和 `variationCoefficient` 会被服务端规整到 1-10。
- 每道新题必须匹配指定 `variantDifficulty`。
- `variationCoefficient` 只控制变式变化幅度，不允许改变原题对应的知识点和考点。
- 当 `variationCoefficient > 5` 时，新题只锁定原题知识点和考点，题型、情境、设问方式、条件组合、表达载体或推理路径均可变化。
- `variationCoefficient` 为 6-7 时，每道题至少改变 4 个维度；为 8-9 时，每道题至少改变 5-6 个维度；为 10 时应接近重构式变体。
- 任何依赖视觉材料的题目必须包含可独立还原的 `figure.type` 与 `figure.description`。
- `figure.description` 不得依赖原卷、题干猜测或“示意图即可”等占位表达。
- 题图无法精确补全时，题干、选项、答案和解析必须整体改写为自包含题，并移除全部视觉引用。
- 定向修复只能修改被题图完整性契约识别的问题题目，不能改变题目数量和顺序。
