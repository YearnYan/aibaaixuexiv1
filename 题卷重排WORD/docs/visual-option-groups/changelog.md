# 图形选项组变更记录

- 日期：2026-07-14
  摘要：建立图形选项组的识别、过滤和展示契约。
  接触点：`docs/visual-option-groups/`
  行为：定义 `option-group` 类型、视觉占位选项、按需复检条件和数据保留不变量。

- 日期：2026-07-14
  摘要：实现图形选项组识别、占位过滤和边界复检。
  接触点：`server/aiProxy.ts`、`shared/optionText.ts`、`shared/formulaText.ts`、`src/types.ts`、`src/lib/api.ts`
  行为：纯视觉选项以 `option-group` 返回；有效选项组存在时删除空图片选项；缺失边界时自动复检，失败时保留原数据。

- 日期：2026-07-14
  摘要：优化图形选项页面和 Word 体验并完成验收。
  接触点：`src/App.tsx`、`src/styles.css`、`server/wordExport.ts`、`scripts/smoke-test.mjs`、`scripts/option-figure-regression.ts`
  行为：页面只显示一次完整 A-D 选项图，提供图形选项裁切和实时预览；Word 保留选项组图片且不含 `Blank Equation` 或 Codecogs 链接。

- 日期：2026-07-14
  摘要：根据用户复核修正视觉选项方案。
  接触点：`docs/visual-option-groups/`
  行为：合并选项图降级为兼容回退；正式契约改为四个独立的“选项标签 + 对应图片”，网页与 Word 都必须保留选项结构。

- 日期：2026-07-14
  摘要：完成四个独立视觉选项的全链路实现与验收。
  接触点：`server/aiProxy.ts`、`shared/optionText.ts`、`src/types.ts`、`src/lib/api.ts`、`src/App.tsx`、`src/styles.css`、`src/lib/wordExport.ts`、`server/wordExport.ts`、`scripts/smoke-test.mjs`、`scripts/option-figure-regression.ts`
  行为：识别结果恢复 A/B/C/D 标签并优先复检四个独立 bbox；网页以两列“标签 + 图片”卡片展示且支持单项裁切实时预览；客户端和服务端 Word 均在两列表格中写入四个选项标签与四张对应图片。复检失败时仍保留标签和合并图，不再出现只有图片没有选项的结果。
