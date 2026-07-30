# 内部视图模型与不变量

## Slide 输入契约

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| id | number | 是 | 正整数 | 原试卷题号 |
| type | string | 是 | 非空 | 题型名称 |
| subject | string | 是 | 非空 | 学科 |
| difficulty | string | 是 | 非空 | 难度标签 |
| score | number | 是 | 大于 0 | 分值 |
| question | string | 是 | 非空 | 题干 |
| options | array | 是 | 可为空 | 选择项 `{letter,text,correct}` |
| answer | string | 否 | 可为空 | 非选择题答案 |
| analysis | string | 是 | 非空 | 解题说明 |
| knowledge | string[] | 是 | 最多 4 项 | 知识点 |
| figure | object | 是 | 见下表 | 图形定位与图片 |

## Figure 输入契约

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| exists | boolean | 是 | — | 是否存在图形 |
| imageDataUrl | string | 否 | data URL 或空串 | 已裁切图形 |
| description | string | 否 | 可为空 | 图形说明 |
| sourceLabel | string | 否 | 可为空 | 文件与页码 |
| bbox / bboxes | object / object[] | 否 | 归一化到 0–1 | AI 定位区域 |

## 派生视图模型

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| layout | string | 是 | `choice` / `figure` / `solution` | 内页版式 |
| density | string | 是 | `regular` / `compact` / `tight` | 仅在必要时逐级压缩 |
| analysisSegments | object[] | 是 | 1–5 段 | `{index,label,text}` |
| figureAspect | string | 是 | `wide` / `tall` / `balanced` / `none` | 图片展示约束 |
| hasVisibleAnswer | boolean | 是 | 受答案开关控制 | 禁止泄露答案 |

## 示例载荷

```json
{
  "id": 8,
  "type": "函数图像题",
  "subject": "数学",
  "difficulty": "中等",
  "score": 8,
  "question": "根据图像判断单调性。",
  "options": [],
  "answer": "OA 递增，AB 递减。",
  "analysis": "先从左向右观察图像，再判断变化趋势。",
  "knowledge": ["函数图像", "单调区间"],
  "figure": {
    "exists": true,
    "imageDataUrl": "data:image/png;base64,...",
    "description": "函数折线图",
    "sourceLabel": "模拟试卷 第2页"
  }
}
```

## 验证规则和不变量

- 版式分类仅依赖已规范化的 slide 数据，不修改原始字段。
- `analysisSegments` 保留原解析语义顺序，不添加未提供的知识或结论。
- 图片始终等比缩放并完整显示。
- 裁切框始终限制在源图 0–1 范围内，输出宽高均为正数。
- `hasVisibleAnswer=false` 时不渲染正确选项标记或答案正文。
