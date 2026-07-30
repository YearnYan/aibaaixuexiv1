# 变更记录

- 日期：2026-07-18
  - 摘要：从有效内容边界根因修复 PDF 空白尾页误判。
  - 接触点：`shared/pdf-pagination.js`、`src/main.js`、`tests/export-and-continuation.test.js`、浏览器与 Poppler 回归产物
  - 行为：分页 API 显式区分物理画布高度与最后可见正文高度，不再把 A4 最小高度或底部内边距切成新页；逐页空白质量门保留，并在缩略采样不足时执行原始像素条带复核。18 题失败样本由“第 4 页 0 像素并阻止下载”修复为 3 页 A4 成功下载，公式、题图、原子分页和无损压缩标准不变。

- 日期：2026-07-18
  - 摘要：修复服务重启后“继续生成3题”凭证必然失效。
  - 接触点：`shared/continuation-grant.js`、`server/middleware/security.js`、`server/routes/exam.js`、`worker/middleware/security.js`、`worker/routes/exam.js`、`src/main.js`、相关测试
  - 行为：续题授权改为带过期时间的紧凑 HMAC 签名能力凭证，不再保存进程内存；Node/Worker 对称验证并在每次成功追加后续签。真实浏览器在初始生成后重启服务，连续两次各追加 3 题成功，题图与公式错误均为 0。

- 日期：2026-07-17
  - 摘要：在保持 2 倍分辨率和无损像素的前提下修复 PDF 性能与裁剪失效。
  - 接触点：`shared/pdf-lossless-image.js`、`src/main.js`、`tests/pdf-lossless-image.test.js`、`tests/export-and-continuation.test.js`
  - 行为：画布经白底 RGB 合成、Predictor 11 和浏览器原生 Deflate 只嵌入一次，各页复用同一图像并用有效 PDF 裁剪窗口显示安全切片；25 题、175 公式、3 题图导出从 39.81 秒降到 18.39 秒，Poppler 逐页确认无重复、切割或空白页。

- 日期：2026-07-17
  - 摘要：从 OOXML 序列化与目标软件显示根因修复 Word 96% 失败和公式缺失。
  - 接触点：`shared/word-export-quality.js`、`shared/subject-content-contract.js`、`src/word-docx-export.js`、`src/main.js`、相关测试
  - 行为：结构标签、可见文本和 OMML 分层审查；公式文本强制 XML 实体转义；分段公式转换为可拉伸 `<m:d>` 定界符；选项改为一项一行。25 题 Word 在 WPS 中完整显示不等式、分段公式和题图，175 个公式保持可编辑，下载约 1.0 秒。

- 日期：2026-07-17
  - 摘要：从生成边界修复 Word 导出 96% 才发现 LaTeX 源码的问题。
  - 接触点：`shared/subject-content-contract.js`、`shared/word-export-quality.js`、`shared/exam-generation-core.js`、`src/word-docx-export.js`、相关测试
  - 行为：每个公式除 KaTeX/mhchem 编译外，必须通过 MathML→OMML 目标格式验证；不兼容公式携带字段路径和 `WORD_OMML_CONVERSION_FAILED` 进入原批次独立审题，最终 `.docx` 源码、数量和媒体质量门保持不变，不修改模型、题图提示词或质量要求。

- 日期：2026-07-17
  - 摘要：修复继续生成中内容错误反复从零重试的问题。
  - 接触点：`shared/exam-generation-core.js`、`tests/exam-strict-generation.test.js`
  - 行为：可复核内容错误携带坏稿、字段路径和错误码进入独立审题；审核失败只重试当前批次，最多两次后才回到任务级重生成；结构错误和最终质量门保持严格拒绝，不增加字符串修复或兜底。

- 日期：2026-07-17
  - 摘要：Word 改为标准 `.docx` 与可编辑 OMML 公式。
  - 接触点：`package.json`、`src/main.js`、`src/word-docx-export.js`、`shared/word-export-quality.js`、`tests/word-export-quality.test.js`
  - 行为：KaTeX MathML 结构化转换为 OMML；mhchem 幻影上下标还原为真实脚本节点；媒体目录只允许题图 PNG，拒绝公式图片、源码残留、非法样式和数量不一致。

- 日期：2026-07-17
  - 摘要：续题额度改为单次组卷会话契约。
  - 接触点：`server/middleware/security.js`、`server/routes/exam.js`、`worker/middleware/security.js`、`worker/routes/exam.js`、`shared/exam-paper-config.js`、`src/main.js`
  - 行为：初始组卷成功后签发会话绑定续题凭证；同一试卷连续追加不重复扣额度，伪造、跨会话和过期凭证拒绝；真实 Node 路由连续追加两次通过。

- 日期：2026-07-17
  - 摘要：继续生成改为题组级并发事务。
  - 接触点：`src/main.js`、`shared/exam-continuation.js`、`tests/export-and-continuation.test.js`
  - 行为：同组单锁、不同组并行；追加题图使用独立事务，所有质量门通过后按最新题数提交，并按页面题组顺序连续显示题号。

- 日期：2026-07-17
  - 摘要：从根因修复 PDF 组件加载失败与长内容分页。
  - 接触点：`package.json`、`src/app-entry.js`、`src/main.js`、`src/style.css`、`shared/pdf-pagination.js`
  - 行为：本地打包 html2canvas/jsPDF；短题与短答案整块换页，超长父块按直接语义子块分页，错误提示保留真实原因。

- 日期：2026-07-17
  - 摘要：修复 Word 大公式量导出的 LRU 自淘汰。
  - 接触点：`src/main.js`、`shared/export-rendering.js`、`tests/export-and-continuation.test.js`
  - 行为：当前导出使用独立完整结果表，全局 LRU 淘汰不再影响当前文件；233 个唯一公式成品通过数量与源码零残留检查。

- 日期：2026-07-17
  - 摘要：修复 PDF 左偏和跨页切割。
  - 接触点：`src/main.js`、`src/style.css`、`shared/pdf-pagination.js`
  - 行为：使用对称 A4 边框盒；按题目、题组标题和答案条目的实际 DOM 几何范围计算安全切点，过高原子块直接阻止导出。

- 日期：2026-07-17
  - 摘要：在不降低质量的前提下显著加速 Word 下载。
  - 接触点：`src/main.js`、`shared/export-rendering.js`、`tests/export-and-continuation.test.js`
  - 行为：相同公式/题图内容键缓存，公式合并到 4 倍像素画布批量捕获并无损裁切，题图有界并行；完整性与源码残留断言保持不变。

- 日期：2026-07-17
  - 摘要：增加题组级“继续生成3题”。
  - 接触点：`server/routes/exam.js`、`worker/routes/exam.js`、`shared/exam-paper-config.js`、`shared/exam-continuation.js`、`src/main.js`、`src/style.css`
  - 行为：Node/Worker 对称严格接口固定单知识点、单考点、单题型和 3 题；前端校验来源与数量，题图全部通过后原子追加，否则撤销暂存内容。

- 日期：2026-07-16
  - 摘要：从跨层契约根因修复题图持续生成失败。
  - 接触点：`shared/figure-svg-quality.js`、`server/routes/render.js`、`worker/routes/render.js`、`server/services/ai.js`、`worker/services/ai.js`、`src/main.js`
  - 行为：统一 Node、Worker 与浏览器 SVG 质量门，增加响应元数据、机器失败码、缓存复检、失败题串行原子重试和浏览器拒绝后的缓存绕过；模型与提示词保持不变。

- 日期：2026-07-16
  - 摘要：完成题图对抗测试与截图场景真实浏览器验收。
  - 接触点：`tests/render-svg-validation.test.js`、`tests/render-route-recovery.test.js`、`scripts/figure-browser-fixture.js`、`output/playwright/figure-recovery/`
  - 行为：拒绝截断、非法实体、畸形 XML、危险资源、非法路径和伪几何；截图圆与弦题真实 SVG 在 Edge 中以 `280×210` 完整显示，控制台无错误。

- 日期：2026-07-15
  - 摘要：建立多知识点组卷、图形质量和公式渲染的跨模块改造文档。
  - 接触点：`docs/feature/multi-topic-exam/`
  - 行为：定义新版 `topicConfigs` 请求、图形失败阻断和 LaTeX/KaTeX 契约。

- 日期：2026-07-15
  - 摘要：完成多知识点/多考点配置与严格分题型生成。
  - 接触点：`src/index.html`、`src/main.js`、`src/style.css`、`server/routes/exam.js`、`server/services/ai.js`
  - 行为：每个考点独立配置题量、难度和题型计数，响应携带题目来源，旧单知识点请求继续兼容。

- 日期：2026-07-15
  - 摘要：修复图形批量调用并移除图形静态兜底。
  - 接触点：`src/main.js`、`server/routes/render.js`
  - 行为：前端调用 `/figures-batch`，SVG 失败时整题阻断，组卷和导出不会接受缺图题目。

- 日期：2026-07-15
  - 摘要：引入 KaTeX 与 Word MathML 导出。
  - 接触点：`src/app-entry.js`、`src/main.js`、`scripts/build-frontend.js`、`package.json`
  - 行为：题干、选项、答案解析统一渲染标准 LaTeX，PDF 使用渲染 DOM，Word 转换为 MathML 并打包 KaTeX 字体资源。

- 日期：2026-07-15
  - 摘要：增强 AI JSON 解析与跨学科公式支持。
  - 接触点：`server/services/ai.js`、`src/app-entry.js`
  - 行为：忽略推导文本中的 LaTeX 花括号，支持标准 LaTeX 与 mhchem 化学式，解析失败不再静默输出。

- 日期：2026-07-15
  - 摘要：重构多知识点组卷工作台并增加本地连接恢复。
  - 接触点：`src/index.html`、`src/style.css`、`src/main.js`、`src/security-client.js`、`src/app-entry.js`
  - 行为：左侧显示紧凑知识点大纲与组卷汇总，右侧一次编辑一个知识点；本地跨端口自动连接 `5100` API，网络失败显示中文页面内错误并可重试。

- 日期：2026-07-15
  - 摘要：修复成功态题卡、公式 SVG 与图形批量渲染链路。
  - 接触点：`src/main.js`、`server/routes/render.js`、`tests/render-svg-validation.test.js`、`package.json`
  - 行为：成功生成后正确显示题卡，普通文本换行不再污染 KaTeX SVG path，批量图形改用正确接口并经过服务端与浏览器双重校验。

- 日期：2026-07-15
  - 摘要：建立九学科结构化公式契约与任务级严格重新生成。
  - 接触点：`shared/subject-content-contract.js`、`shared/exam-generation-core.js`、`server/services/ai.js`、`worker/routes/exam.js`
  - 行为：AI 只输出普通文本段和公式段，服务端严格解析、编译并添加定界符；任一批次失败时整任务重生成，禁止 JSON 修复和部分试卷输出。

- 日期：2026-07-15
  - 摘要：将图形描述与 SVG 可见文字纳入公式质量门。
  - 接触点：`server/routes/render.js`、`worker/routes/render.js`、`tests/render-svg-validation.test.js`
  - 行为：图形描述经过 LaTeX 编译验证，SVG 拒绝内部传输标记、裸 LaTeX、公式定界符和美元公式，不生成静态或占位兜底图。

- 日期：2026-07-15
  - 摘要：完成九科对抗测试、真实长卷与 PDF/Word 成品验收。
  - 接触点：`tests/subject-content-contract.test.js`、`tests/exam-strict-generation.test.js`、`output/pdf/`、`output/word/`
  - 行为：23 项测试通过；22 题长卷与重启后的双知识点真实生成通过；PDF 非空可读，Word 保留 MathML 和嵌入题图。

- 日期：2026-07-16
  - 摘要：用强制工具调用替换不可靠的 JSON 模式。
  - 接触点：`shared/ai-structured-output.js`、`shared/exam-generation-core.js`、`server/services/ai.js`、`worker/services/ai.js`
  - 行为：生成与审核只接受唯一 `submit_exam` 参数，拒绝 content、额外字段、坏 JSON 和部分试卷输出。

- 日期：2026-07-16
  - 摘要：移除私有公式中间协议并收紧长卷并发。
  - 接触点：`shared/subject-content-contract.js`、`shared/exam-generation-core.js`、`server/routes/exam.js`、`worker/routes/exam.js`
  - 行为：用户可见字段直接传输标准 LaTeX 并严格编译；单任务批次串行、整卷最多并行两个任务。

- 日期：2026-07-16
  - 摘要：修复 PDF 导出误转换 KaTeX 内部 SVG。
  - 接触点：`src/main.js`、`tests/exam-strict-generation.test.js`
  - 行为：PDF 只把真实题图 SVG 转为 Canvas，分数线、括号等 KaTeX 伸缩符号不再被拉伸。

- 日期：2026-07-16
  - 摘要：完成最终 22 题、全图形及 PDF/Word 对抗验收。
  - 接触点：`tests/`、`output/playwright/`、`tmp/pdfs/`
  - 行为：30 项测试、22 题真实 API、22 个 Edge SVG、Word MathML/PNG 与 15 页 PDF 视觉检查全部通过。

- 日期：2026-07-16
  - 摘要：统一题图尺寸并增加全选/取消全选操作。
  - 接触点：`src/index.html`、`src/style.css`、`src/main.js`、`shared/question-selection.js`
  - 行为：不同原始宽度 SVG 均以 `280×210` 显示；全选状态由唯一题目选择集合派生并与无障碍属性同步。

- 日期：2026-07-16
  - 摘要：从根因移除 WPS 不兼容的 Word MathML 导出。
  - 接触点：`src/main.js`、`shared/word-export-quality.js`、`tests/word-export-quality.test.js`
  - 行为：公式以 KaTeX 可见层高分辨率 PNG 导出，题图统一尺寸；任何源码或数量不一致均阻断，选项在 WPS 中保持横向排版。
