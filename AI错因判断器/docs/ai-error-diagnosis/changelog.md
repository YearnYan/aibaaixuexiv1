# AI 错因判断网站变更记录

- 日期：2026-07-17
- 摘要：建立项目计划与接口契约
- 接触点：`docs/ai-error-diagnosis/`、`package.json`、`.env.example`
- 行为：定义输入文件、AI 配置、六模块诊断报告、安全边界和验收方式。

- 日期：2026-07-17
- 摘要：完成真实 AI 分析后端与材料解析
- 接触点：`server/`、`package.json`、`.env.example`
- 行为：新增配置持久化、管理密码保护、PDF/Word/图片解析、视觉输入、结构化报告校验、超时与上游错误处理。

- 日期：2026-07-17
- 摘要：完成参考图复刻与响应式交互
- 接触点：`public/index.html`、`public/settings.html`、`public/assets/`
- 行为：新增桌面端双栏工作台、四步错误链、六模块报告、补充材料、教师复核、AI 配置页及移动端单列布局。

- 日期：2026-07-17
- 摘要：完成自动化与真实浏览器验收
- 接触点：`test/app.test.js`、`output/playwright/`、`README.md`
- 行为：9 项测试全部通过；PDF 与 DOCX 本地样本解析成功；桌面和手机页面无溢出，最终浏览器控制台无错误或警告。

- 日期：2026-07-18
- 摘要：修复长诊断内容无法完整查看
- 接触点：`public/assets/styles.css`、`public/index.html`、`test/app.test.js`
- 行为：桌面端六个报告模块改为标题固定、内容独立滚动；取消纠正动作和自判内容截断；移动端改为随内容自然展开，并隔离图片解析测试与本机 AI 配置。

- 日期：2026-07-18
- 摘要：完成跨学科公式规范与 PDF/Word 报告导出
- 接触点：`server/math-content.js`、`server/report-export.js`、`server/ai-client.js`、`server/app.js`、`public/`、`test/`
- 行为：新增全报告 LaTeX 规范化、KaTeX/mhchem 校验与模型定向修复；网页统一渲染公式；新增 PDF/Word 下载按钮和二进制接口；PDF 使用 A4 整模块换页与固定页脚；Word 保持正文可编辑并嵌入经过像素校验的高清公式图。
- 验证：13 项自动化测试全部通过；PDF 渲染为 2 页 PNG 逐页检查无切割；Word 通过 WPS 转 PDF 逐页检查公式完整；桌面与 390px 手机浏览器无溢出，真实下载文件名和内容类型正确。

- 日期：2026-07-18
- 摘要：将 Word 公式从图片重构为原生可编辑 OMML
- 接触点：`server/math-content.js`、`server/word-math.js`、`server/report-export.js`、`test/app.test.js`、`README.md`
- 行为：统一使用“规范 LaTeX → MathJax MathML → 语义清理 → OMML”链路；删除公式 PNG 生成与 `ImageRun` 注入；使用 XML DOM 将公式写为 `m:oMath`；公式转换失败时整个 Word 导出明确失败，禁止图片降级。
- 验证：14 项自动化测试全部通过；DOCX 内 13 个 `m:oMath`、0 个 `w:drawing`、0 个媒体文件、0 个公式占位符；WPS 能识别、修改、重新排版、保存并重开原生公式，修改后的文档仍为可编辑 OMML。
