# 全学科公式内容契约

## HTTP 响应中的试卷字段

适用于 `POST /api/site/exam-variant/exam/generate` 与 `POST /api/site/exam-variant/exam/generate-from-upload` 返回的试卷内容。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `questions[].title` | string | 是 | 普通文字；如含公式须使用公式定界符 | 大题标题 |
| `questions[].items[].stem` | string | 是 | 公式遵守统一 LaTeX 契约 | 题干 |
| `questions[].items[].options[]` | string | 否 | 公式遵守统一 LaTeX 契约 | 选择题选项 |
| `questions[].items[].answer` | string | 是 | 公式遵守统一 LaTeX 契约 | 标准答案 |
| `questions[].items[].explanation` | string | 是 | 公式遵守统一 LaTeX 契约 | 解析 |
| `answers[]` | string | 是 | 必须由规范化后的 `answer` 与 `explanation` 重建 | 展示答案列表 |

## 公式表示规则

| 内容类型 | 规范 |
|----------|------|
| 行内数学、物理、生物、地理公式 | `\(...\)` |
| 独立公式、多行推导、方程组、矩阵 | `\[...\]` |
| 化学式、离子、电子、电荷、方程式 | 定界符内使用 `\ce{...}` |
| 化学物理量与单位 | 定界符内使用 `\pu{...}` 或标准 LaTeX 单位写法 |
| 普通中文 | 保持普通文本，不放入 `\text{}` |

不变量：

- 响应字符串不得包含不可见控制字符（换行与制表符除外）。
- 不得把 `\frac`、`\sqrt`、`\vec`、`\ce` 等命令转换为线性斜杠、Unicode 上下标或删除命令名。
- 公式定界符必须成对。
- 生成 JSON 内的 LaTeX 反斜杠必须正确转义；服务端解析器需兼容 AI 偶发返回的未双写反斜杠。
- `answers[]` 与题目对象中的答案、解析保持一致。

## 最小响应示例

```json
{
  "questions": [
    {
      "type": "calculation",
      "title": "一、计算题",
      "items": [
        {
          "index": 1,
          "stem": "已知 \\(v_0=2\\,\\mathrm{m/s}\\)，求 \\(t=3\\,\\mathrm{s}\\) 时的速度。",
          "answer": "\\(8\\,\\mathrm{m/s}\\)",
          "explanation": "由 \\(v=v_0+at\\) 得 \\(v=8\\,\\mathrm{m/s}\\)。"
        }
      ]
    }
  ],
  "answers": [
    "1. \\(8\\,\\mathrm{m/s}\\) 解析：由 \\(v=v_0+at\\) 得 \\(v=8\\,\\mathrm{m/s}\\)。"
  ]
}
```

## 兼容性说明

- HTTP 字段结构不变。
- 公式字符串从不规范纯文本/Unicode 恢复为标准 LaTeX，是显示行为修复；依赖原始纯文本公式的外部消费者需要按公式定界符处理。
