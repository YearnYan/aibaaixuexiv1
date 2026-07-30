# 题目表格图形化变更记录

- 日期：2026-07-14
  摘要：建立表格作为题图处理的设计和数据契约。
  接触点：`docs/table-figure-extraction/`
  行为：明确表格图形类型、兼容字段、文本去重条件、裁切不变量和回滚方案。

- 日期：2026-07-14
  摘要：实现表格图形识别、按需纠错复检和 Markdown 去重。
  接触点：`server/aiProxy.ts`、`shared/tableText.ts`、`src/types.ts`、`src/lib/api.ts`、`src/App.tsx`、`server/wordExport.ts`
  行为：表格以 `kind=table` 进入题图；首次只有 Markdown 表格时自动复检边界；有效表格题图存在后删除重复文字，并复用现有裁切和导出链路。

- 日期：2026-07-14
  摘要：完成表格图形自动化和浏览器验收。
  接触点：`scripts/smoke-test.mjs`、`scripts/table-figure-regression.ts`、`package.json`
  行为：类型检查、后端冒烟、公式回归、表格回归和生产构建通过；用户截图中的两张表在页面中按顺序显示为题图，可打开实时裁切微调，题干无 Markdown 表格残留。
