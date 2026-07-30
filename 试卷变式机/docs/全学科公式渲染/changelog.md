# 全学科公式渲染变更记录

- 日期：2026-07-25
- 摘要：建立全学科公式渲染修复的设计与契约文档。
- 接触点：`docs/全学科公式渲染/`
- 行为：明确仅作用于试卷变式机的 LaTeX、mhchem、解析、渲染和导出不变量。

- 日期：2026-07-25
- 摘要：新增共享全学科学术内容处理模块。
- 接触点：`shared/academic-content.js`、Node/Worker 试卷生成服务
- 行为：保护 JSON 中的 LaTeX 反斜杠，统一公式定界符，重建答案并拒绝损坏内容；删除 LaTeX 转 Unicode 降级。

- 日期：2026-07-25
- 摘要：前端改为本地完整公式引擎。
- 接触点：`src/main.js`、`src/style.css`、`package.json`、`scripts/build-frontend.js`
- 行为：KaTeX + mhchem 随构建产物发布，网页生成 HTML+MathML，Word 生成 MathML，PDF 保留浏览器排版。

- 日期：2026-07-25
- 摘要：补齐多学科公式回归与真实浏览器验收。
- 接触点：`test/academic-content.test.js`、`output/playwright/exam-variant-formula-audit.png`
- 行为：覆盖数学、物理、化学、生物、地理代表性公式，22 项测试和双构建通过，浏览器公式错误数为 0。
