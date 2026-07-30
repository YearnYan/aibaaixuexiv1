# 十题科学公式训练契约

## 学科文本契约

| 内容 | 类型 | 必需 | 约束 | 展示 |
|---|---|---|---|---|
| 普通文本 | string | 是 | UTF-8 可读文本，不得包含乱码或裸露 LaTeX 命令 | HTML 转义后显示 |
| 行内公式 | string 片段 | 按内容 | 使用 `\(...\)` | KaTeX 行内渲染 |
| 独立公式 | string 片段 | 按内容 | 使用 `\[...\]` | KaTeX 块级渲染 |
| 化学表达 | LaTeX 片段 | 化学内容出现时 | 在公式定界符内使用 `\ce{...}` | KaTeX + mhchem |

公共示例：

```text
函数零点满足 \(x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)。
反应方程式为 \(\ce{2H2 + O2 -> 2H2O}\)。
```

不变量：题干、三组选项和解析全部执行同一套公式校验；不能解析的 LaTeX、公式外 Unicode 运算符、裸化学式及裸公式命令不得进入响应。

## POST /api/training/session

请求：

```json
{
  "gradeId": "j2",
  "gradeLabel": "初二",
  "subject": "物理",
  "knowledgePoint": "浮力"
}
```

响应：

```json
{
  "sessionId": "uuid",
  "ttlMs": 1800000,
  "batchSize": 10
}
```

## POST /api/training/questions

请求：

```json
{
  "sessionId": "uuid",
  "gradeId": "j2",
  "gradeLabel": "初二",
  "subject": "物理",
  "knowledgePoint": "浮力"
}
```

响应：

```json
{
  "batchId": "uuid",
  "batchSize": 10,
  "questions": [
    {
      "questionId": "uuid",
      "question": "物体受到的浮力为 \\(F_{\\text{浮}}=\\rho gV_{\\text{排}}\\)。",
      "difficulty": 3,
      "kp_shuffled": { "items": ["选项1", "选项2", "选项3", "选项4"] },
      "method_shuffled": { "items": ["选项1", "选项2", "选项3", "选项4"] },
      "trap_shuffled": { "items": ["选项1", "选项2", "选项3", "选项4"] }
    }
  ]
}
```

验证规则：

- 服务端固定生成并返回 10 题，不接受客户端改变批次数量。
- `questions` 必须精确为 10 项，每题三组选项必须各有 4 项。
- 会话仍有未提交题目时，再次生成返回 409。
- 公共响应不包含正确答案索引和解析。
- 每次用户点击生成按钮只调用一次该端点；平台据此产生一次计费事件。

## POST /api/training/submit

请求：

```json
{
  "sessionId": "uuid",
  "questionId": "uuid",
  "selected": { "kp": 0, "method": 1, "trap": 2 }
}
```

响应保留现有逐项正确性、选择内容、正确答案和解析字段。每个 `questionId` 只能成功提交一次；提交后从服务端答案库移除。

## 批次状态

- `ready`：十题已全部生成，可开始作答。
- `training`：当前批次仍有未提交题目，禁止生成下一批。
- `complete`：十题均已提交，可点击“继续生成10题”。
