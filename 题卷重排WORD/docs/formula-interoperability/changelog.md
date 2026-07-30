# 公式跨端互操作变更记录

- 日期：2026-07-13
  摘要：建立公式跨端互操作改造的设计、契约和任务记录。
  接触点：`docs/formula-interoperability/`
  行为：明确网页预览与 Word 导出的统一公式规范、逐公式降级和不中断导出要求。

- 日期：2026-07-13
  摘要：实现跨学科公式规范化、Word 逐公式容错和回归验证。
  接触点：`shared/formulaText.ts`、`shared/mathText.ts`、`src/lib/wordExport.ts`、`server/wordExport.ts`、`src/App.tsx`、`scripts/formula-regression.ts`
  行为：清洗 OCR/PDF 控制字符；网页不再裸显不可解析 LaTeX；Word 优先写入结构化 OMML，失败时写入可读 OMML，单条公式不再阻断整份导出。

- 日期：2026-07-13
  摘要：完成自动化验证。
  接触点：`package.json`、`scripts/formula-regression.ts`
  行为：默认测试纳入跨学科公式回归；24 条语料与 810 题混合导出通过，生产构建通过。

- 日期：2026-07-14
  摘要：修复 Word 裸露在线公式图片 Markdown 和粗体向量命令名的问题。
  接触点：`shared/formulaText.ts`、`shared/mathText.ts`、`src/lib/wordExport.ts`、`server/wordExport.ts`、`scripts/formula-regression.ts`
  行为：在线公式图片先解码为原生公式；跨引擎样式命令先归一化；Word 保留粗体数学属性并清理 Markdown 表示层。回归扩展为 25 条跨学科语料，客户端、服务端和 810 题导出均通过。

- 日期：2026-07-14
  摘要：完成最终结构与构建验收。
  接触点：回归 DOCX、`package.json`
  行为：类型检查、后端冒烟、公式回归和生产构建通过；客户端及服务端 DOCX 均有 33 个 OMML 节点、15 个粗体数学节点，不含 Codecogs 链接、Markdown 图片、失效命令或 Unicode 替换字符。
