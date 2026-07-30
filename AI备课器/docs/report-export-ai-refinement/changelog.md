# 实施记录

- 日期：2026-07-21
- 摘要：修复 WPS 中板书 SVG 透明背景导致的文字低对比度
- 接触点：`src/exportDynamicDocx.js`、`tests/word-math.test.mjs`
- 行为：仅在 Word 导出副本中为规范化后的板书 SVG 添加统一深绿色背景，再栅格化为 PNG；普通 SVG、网页和 PDF 均保持原有行为。

- 日期：2026-07-21
- 摘要：全量修复跨学科 SVG 公式显示与重复板书容器
- 接触点：`src/educationalSvg.js`、`src/RichText.jsx`、`src/lessonText.js`、`src/DynamicLessonDocument.jsx`、`src/exportDynamicDocx.js`、`src/styles.css`、`server.mjs`、`tests/`
- 行为：新增共享 SVG 教学文字归一化，统一把数学、物理、化学、生物、地理的 LaTeX、化学式和上下标转为可直接显示的教材符号；板书 SVG 删除全画布背景和整幅装饰框，网页与 Word 共用处理结果；生成提示词禁止 SVG 文字包含 LaTeX 并禁止嵌套黑板。跨学科自动化、生产构建及桌面/手机真实浏览器验收通过。

- 日期：2026-07-21
- 摘要：完成 PDF 颜色兼容与 Word SVG 图形一致性修复
- 接触点：`src/exportPdf.js`、`src/exportDynamicDocx.js`、`server.mjs`、`src/main.jsx`、`tests/`
- 行为：PDF 导出克隆固化 `color(srgb ...)` 为兼容颜色；Word 将独立、内嵌和板书 SVG 按结构指纹转换为高清 PNG；对话增加“图默认 SVG”及位图例外规则；按钮改为“AI继续调整”。38 项测试、生产构建、5 页 PDF 和含 PNG/Office Math 的 DOCX 成品验收通过。

- 日期：2026-07-21
- 摘要：启动全局教案动态重构能力
- 接触点：`docs/report-export-ai-refinement/`、`src/`、`server.mjs`
- 行为：定义动态教案 V3 契约，允许对话提示词增删、改名、重排模块并修改封面、排版、正文、表格和图示。

- 日期：2026-07-21
- 摘要：完成对话优化教案的全局重构实现
- 接触点：`server.mjs`、`src/lessonDocument.js`、`src/DynamicLessonDocument.jsx`、`src/exportDynamicDocx.js`、`src/main.jsx`、`src/styles.css`、`tests/`
- 行为：优化结果不再补回固定模块；网页、复制、Word 和 PDF 按动态模块顺序呈现，支持主题、单双栏、表格、卡片、图片、SVG 和可编辑公式。

- 日期：2026-07-20
- 摘要：建立报告导出、学科公式与 AI 对话优化设计契约
- 接触点：docs/report-export-ai-refinement/
- 行为：明确统一公式标记、PDF 导出、优化接口、布局验收和配置入口隐藏要求。

- 日期：2026-07-20
- 摘要：完成公式渲染、AI 对话优化与报告导出实现
- 接触点：src/RichText.jsx、src/main.jsx、src/styles.css、src/exportDocx.js、src/exportPdf.js、server.mjs
- 行为：所有动态报告字段统一渲染公式，增加完整教案对话更新、Word/PDF 下载、响应式排版修复与普通工作台配置入口隐藏。

- 日期：2026-07-21
- 摘要：修正对话优化记录的生命周期
- 触点：`src/main.jsx`
- 行为：对话记录仅在当前单次备课页面内保留；关闭抽屉不丢失，刷新页面或成功生成新教案时自动重置，不再跨备课轮次累计。

- 日期：2026-07-20
- 摘要：修复 PDF 累计坐标漂移、孤儿标题与卡片残片
- 接触点：src/exportPdf.js、tests/export-pdf-pagination.test.mjs
- 行为：分页坐标改用横向缩放比并补偿 html2canvas 垂直原点偏移，章节、教学环节和卡片切点通过 5 页与 7 页逐页渲染检查。

- 日期：2026-07-20
- 摘要：完成 Word 公式全字段覆盖与最终验收
- 接触点：src/exportDocx.js、output/playwright/、tmp/pdfs/
- 行为：动态标题、环节名称、反思项和页眉全部进入公式管线；成品包含 25 个公式媒体、33 个绘图引用且无原始 LaTeX 标记，桌面与移动端无横向溢出，浏览器控制台无错误。
