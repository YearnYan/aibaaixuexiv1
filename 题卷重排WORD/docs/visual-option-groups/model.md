# 图形选项组数据契约

## 图形类型

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| `kind` | `diagram \| table \| option-group \| option` | 否 | 缺省为 `diagram` | `option` 表示单个视觉选项；`option-group` 为合并图回退 |
| `pageIndex` | integer | 是 | 必须属于当前识别页面 | 来源页 |
| `bbox` | object | 是 | 归一化坐标且完整位于页面内 | 裁切区域 |
| `optionLabel` | string | `kind=option` 时是 | A-H 或等价选项序号 | 对应选项标签 |
| `caption` | string | 否 | 最长 1000 字符 | 图形选项组缺省为“图形选项（A-D）” |
| `confidence` | number | 否 | 0 到 1 | 识别置信度 |

## 图形选项响应示例

```json
{
  "questions": [
    {
      "id": "q-1",
      "number": "1",
      "pageIndex": 0,
      "stemMarkdown": "下列图案是中心对称图形的是（ ）",
      "options": ["A.", "B.", "C.", "D."],
      "figures": [
        {
          "pageIndex": 0,
          "kind": "option",
          "optionLabel": "A",
          "bbox": { "x": 0.31, "y": 0.24, "width": 0.09, "height": 0.14 },
          "caption": "A选项图",
          "confidence": 0.94
        },
        { "pageIndex": 0, "kind": "option", "optionLabel": "B", "bbox": { "x": 0.43, "y": 0.24, "width": 0.09, "height": 0.14 } },
        { "pageIndex": 0, "kind": "option", "optionLabel": "C", "bbox": { "x": 0.55, "y": 0.24, "width": 0.09, "height": 0.14 } },
        { "pageIndex": 0, "kind": "option", "optionLabel": "D", "bbox": { "x": 0.67, "y": 0.24, "width": 0.09, "height": 0.14 } }
      ]
    }
  ],
  "warnings": []
}
```

## 类型兼容映射

| 上游值或说明 | 规范化类型 |
| --- | --- |
| `option`、`visual-option`、`image-option`，且带选项标签 | `option` |
| `option-group`、`option_group`、`visual-options`、`image-options` | `option-group` |
| “A选项图”“B 选项图片”等带明确标签的说明 | `option` |
| “图形选项”“图片选项”“四个图案选项”“选项组” | `option-group` |
| `table`、`grid`、`tabular` | `table` |
| 其他或缺失 | `diagram` |

## 视觉占位选项

以下内容在有效视觉选项边界存在时视为可替换占位：

- 仅由选项标签和 Markdown/HTML 图片组成，例如 `A. ![](https://...)`。
- 仅包含 `Blank Equation`、`空白公式`、`图片选项` 等失败提示。
- 仅包含 `A.`、`B.` 等标签空壳。

包含实际文字、数字、数学公式或化学式的选项不得删除。

## 不变量

- 每个视觉选项对应一个 `kind=option` 图形和唯一 `optionLabel`。
- 网页和 Word 必须将选项标签与对应图片放在同一选项单元中。
- `option-group` 只用于旧数据或复检失败回退，回退时仍必须显示恢复后的 A/B/C/D 标签。
- 有效视觉选项存在时，网页和 Word 不得输出图片链接或 `Blank Equation`。
- 没有有效图形边界时，服务端不得删除原选项数组。
- 按需复检只合并或替换视觉选项图，不覆盖原题干和有意义选项。
- 历史 `diagram | table` 数据保持向后兼容。
