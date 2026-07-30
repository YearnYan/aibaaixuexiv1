# 公式可靠性契约

## 内部返修请求

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `path` | string | 是 | 必须来自服务端定位的坏字段集合 | 禁止新增路径 |
| `value` | string | 是 | 非空，只允许修复公式格式 | 必须返回完整字段内容 |

示例：

```json
{
  "repairs": [
    {
      "path": "questions[0].items[5].explanation",
      "value": "由 \\(x+1=2\\)，可得 \\(x=1\\)。"
    }
  ]
}
```

## 生成结果元数据

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `academicIntegrityIssueCount` | integer | 是 | 大于等于 0 | 首次发现的坏字段数 |
| `academicRepairedPaths` | string[] | 是 | 仅包含 AI 成功返修的字段路径 | 不含降级路径 |
| `academicFallbackPaths` | string[] | 是 | 仅包含最终安全降级字段路径 | 空数组表示未降级 |

示例：

```json
{
  "academicIntegrityIssueCount": 2,
  "academicRepairedPaths": ["questions[0].items[5].explanation"],
  "academicFallbackPaths": ["questions[0].items[6].explanation"]
}
```

## 验证不变量

- 每个 `\(` 必须对应 `\)`，每个 `\[` 必须对应 `\]`。
- 行内与独立公式不得交叉、嵌套或混用闭合符。
- 孤立定界符不得进入最终响应。
- 最终降级前后的非定界符正文必须逐字符一致。
- 返修不得改变未列入 `path` 的任何字段。
- 最终响应必须重新通过学术内容完整性校验。

## 兼容性

- 新增元数据字段为向后兼容的附加字段。
- 既有题目、答案、题图和 HTTP 状态结构保持不变。
