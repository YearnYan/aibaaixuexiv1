# 题目表格图形化契约

## 识别图形

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| `pageIndex` | integer | 是 | 必须属于当前请求页面 | 图形来源页 |
| `bbox` | object | 是 | 归一化坐标且完整位于页面内 | 裁切边界 |
| `kind` | `diagram \| table \| option-group` | 否 | 缺省为 `diagram` | `table` 表示原卷表格；`option-group` 表示图形选项组 |
| `caption` | string | 否 | 最长 1000 字符 | 表格默认说明为“题目表格” |
| `confidence` | number | 否 | 0 到 1 | 视觉识别置信度 |

## 兼容输入字段

| 上游字段 | 规范化结果 | 规则 |
| --- | --- | --- |
| `figures`、`images`、`diagrams`、`graphics` | `figures` | 默认类型为 `diagram`，允许对象内显式声明 `kind=table` |
| `tables`、`tableRegions`、`table_regions` | `figures` | 默认类型为 `table` |
| `kind`、`type`、`category`、`contentType` | `kind` | `table`、`grid`、`tabular`、中文“表格”归一为 `table` |

## 示例响应

```json
{
  "questions": [
    {
      "id": "q-15",
      "number": "15",
      "pageIndex": 0,
      "stemMarkdown": "根据下表完成列联表并进行独立性检验。",
      "options": [],
      "figures": [
        {
          "pageIndex": 0,
          "kind": "table",
          "bbox": { "x": 0.28, "y": 0.25, "width": 0.38, "height": 0.31 },
          "caption": "2×2列联表",
          "confidence": 0.96
        }
      ]
    }
  ],
  "warnings": []
}
```

## 验证规则和不变量

- 一个原卷表格对应一个 `kind=table` 图形；同题多个表格必须分别返回。
- 表格 `bbox` 必须覆盖完整表格边框，不得把题干、附注或另一张表包含在内。
- 表格内容不得同时以 Markdown 表格保留在 `stemMarkdown` 或 `options` 中。
- 服务端仅在至少一个有效表格图形存在时删除对应题干 Markdown 表格块。
- 表格图形进入前端后必须具备原页索引和边界，以支持重新裁切及手动微调。
- 缺失 `kind` 的历史图形按 `diagram` 处理，`option-group` 扩展不影响原有表格和普通图形。
