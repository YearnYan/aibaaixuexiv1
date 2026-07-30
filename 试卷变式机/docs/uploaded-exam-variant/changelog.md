# 变更记录

- 日期：2026-07-24
- 摘要：修复 PDF 与 Word 上传被错误改名为 TXT 后遭后端拒绝的问题。
- 接触点：`src/main.js`、`src/app-entry.js`、`server/index.js`、`test/uploaded-exam-files.test.js`
- 行为：前端保留 PDF、DOC、DOCX 的原始文件名、MIME 和二进制内容，由 Node 后端统一解析；旧版 DOC 不再被前端拦截；上传数量与服务端 60 文件约束一致；JSON 上限覆盖 48MB 原文件经 Base64 编码后的请求体。

- 日期：2026-06-01
- 摘要：新增上传原卷变式出卷设计和本地文件抽取能力。
- 接触点：`server/services/uploaded-exam-files.js`、`server/services/uploaded-exam-variant.js`、`docs/uploaded-exam-variant/`
- 行为：支持读取 JPG、PNG、PDF、DOC、DOCX，构造逐题对应变式卷生成任务。

- 日期：2026-06-01
- 摘要：接入上传原卷变式出卷主流程。
- 接触点：`server/routes/exam.js`、`server/index.js`、`worker/routes/exam.js`
- 行为：新增 `/api/exam/generate-from-upload`，本地服务支持图片、PDF、DOC、DOCX，Worker 支持图片上传解析。

- 日期：2026-06-01
- 摘要：重做前端左侧入口并自动进入完整试卷预览。
- 接触点：`src/index.html`、`src/app-entry.js`、`src/main.js`、`src/style.css`
- 行为：左侧原设置项替换为大上传框，上传后生成按钮启用，生成结果默认全题组卷并进入 A4 预览。

- 日期：2026-06-01
- 摘要：修复本地服务模块类型和缺失脚本引用。
- 接触点：`server/package.json`、`src/index.html`
- 行为：服务端恢复 CommonJS 启动方式，移除不存在的 `/shared/hzq.js` 引用。

- 日期：2026-06-01
- 摘要：接入 LinAPI OpenAI 兼容网关。
- 接触点：`server/.env`、`server/config/ai.js`、`worker/services/ai.js`
- 行为：使用 OpenAI SDK 调用 `https://api.linapi.net/v1/chat/completions`，默认模型切换为 `gemini-3.5-flash`。

- 日期：2026-06-02
- 摘要：新增上传原卷变式参数控制。
- 接触点：`src/index.html`、`src/main.js`、`src/style.css`、`server/routes/exam.js`、`server/services/uploaded-exam-variant.js`、`worker/routes/exam.js`
- 行为：左侧上传区下方新增变式难度和变式系数滑杆，生成上传变式卷时将两项参数传入提示词，并要求每道题匹配指定难度和变式幅度。

- 日期：2026-06-02
- 摘要：强化变式系数和难度区分规则。
- 接触点：`src/index.html`、`server/services/uploaded-exam-variant.js`、`worker/routes/exam.js`、`docs/uploaded-exam-variant/`
- 行为：变式系数 6 级以上允许题型变化并要求明显变体感；变式难度补充 1-10 级逐级命题标准，提示词要求按步骤数、综合性、隐藏条件和思路创新度拉开难度差异。

- 日期：2026-06-02
- 摘要：收紧高变式系数的题型约束。
- 接触点：`src/index.html`、`server/services/uploaded-exam-variant.js`、`worker/routes/exam.js`、`docs/uploaded-exam-variant/`
- 行为：变式系数 6-10 级不再允许改变题型，改为在题干情境、条件组合、设问角度和推理路径上体现明显变化。

- 日期：2026-06-02
- 摘要：提高高变式系数的变化强度。
- 接触点：`src/index.html`、`server/services/uploaded-exam-variant.js`、`worker/routes/exam.js`、`docs/uploaded-exam-variant/`
- 行为：变式系数 6-10 级增加多维变化下限，要求在题型不变的前提下显著改变情境、条件组合、设问结构、数据关系和推理路径。

- 日期：2026-06-02
- 摘要：放宽高变式系数的可变维度。
- 接触点：`src/index.html`、`server/services/uploaded-exam-variant.js`、`worker/routes/exam.js`、`docs/uploaded-exam-variant/`
- 行为：变式系数 6-10 级改为只锁定知识点和考点，题型、情境、表达载体、条件组合、设问目标、数据关系和推理路径均可大幅变化，并增加反相似题判定。

- 日期：2026-07-23
- 摘要：建立全科题图完整性恢复契约。
- 接触点：`shared/figure-integrity.js`、`server/services/ai.js`、`server/services/uploaded-exam-variant.js`、`worker/routes/exam.js`、`test/figure-integrity.test.js`、`docs/uploaded-exam-variant/`
- 行为：Node 与 Worker 统一识别中英文图形、图表、地图、实验装置、漫画等视觉引用；问题题目先定向补全精准题图，仍不合格时改写为自包含题，保持题量、顺序及其他合格题不变。
