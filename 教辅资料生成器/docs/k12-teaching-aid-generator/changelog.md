# K12 教辅资料生成器实施记录

## 2026-07-26

- 摘要：修复“知识库/资料原文不变”提示未被严格执行
- 接触点：`server.js`、`src/worker.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：本地 Node 与 Cloudflare Worker 新增原文保真意图识别，覆盖“不修改知识库内容”“资料里的内容不改变”“保持原文不变”“一字不改”等表达；文本型知识库在该模式下由服务端直接构建逐字原文锚点，不再先经规则模型转写。
- 行为：规则阶段只允许规划原文块分页和视觉排版，服务端会覆盖模型返回的润色、改写、纠错、删减、去重或重排建议；正式生图 prompt 新增最高优先级“知识库原文逐字保真锁”和明确原文边界，版式空间不足时也不得删改文字。
- 验证：新增对抗式 Worker smoke，覆盖三种用户句式、规则模型故意返回相反改写建议、正式请求省略原始知识库后仍恢复锁定原文，以及最终生图 prompt 不残留相反改写指令。

- 日期：2026-06-16
- 摘要：新增项目文档与本地运行配置
- 接触点：`docs/k12-teaching-aid-generator/`、`.env.example`、`README.md`
- 行为：记录生成器范围、接口契约、任务状态和环境变量配置方式。

- 日期：2026-06-16
- 摘要：实现首版教辅图片生成工作台
- 接触点：`server.js`、`public/index.html`、`public/styles.css`、`public/app.js`
- 行为：新增服务端图片代理、批量生成校验、参考图上传压缩、结果画廊和下载入口。

- 日期：2026-06-16
- 摘要：优化未配置密钥时的提交体验
- 接触点：`public/app.js`
- 行为：前端在提交前根据健康检查拦截生成请求，页面内提示需要配置密钥。

- 日期：2026-06-16
- 摘要：修复图片生成失败排查中发现的参考图通道问题
- 接触点：`server.js`、`public/app.js`、`public/styles.css`
- 行为：将参考图生成改为 MAT 兼容的聊天图像输入路径，新增网关重试和超时保护，前端新增参考图失败后的纯提示词降级入口。

- 日期：2026-06-20
- 摘要：修复成功生图但前端不显示导致重复消耗
- 接触点：`server.js`、`public/app.js`、`.env.example`、`.gitignore`、`docs/k12-teaching-aid-generator/`
- 行为：新增 `/api/generate/stream` 流式接口；模型每成功返回一张图后立即保存到 `public/generated/` 并逐张返回前端；前端成功一张展示一张；默认关闭自动重复生图尝试，失败交给用户重新发起。

- 日期：2026-06-20
- 摘要：优化默认筛选、固定排版速度和破图保护
- 接触点：`server.js`、`public/index.html`、`public/app.js`、`.env.example`、`docs/k12-teaching-aid-generator/`
- 行为：资料类型和使用场景默认改为不限；固定排版模式改为第 1 张母版后并发生成后续页；生成图片保存后增加读回校验；前端图片加载失败时自动重试并转为失败卡片。

- 日期：2026-06-20
- 摘要：支持失败图片单张原位重新生成
- 接触点：`server.js`、`public/app.js`、`public/styles.css`、`docs/k12-teaching-aid-generator/`
- 行为：失败卡片新增“重新生成本张”；前端保留上次生成参数并只请求目标位置；服务端支持 `targetIndex` 单张生成，成功后仍先保存再返回，不影响其他已生成图片。

- 日期：2026-06-20
- 摘要：修复模型后台成功但前端等待超时报错
- 接触点：`server.js`、`.env.example`、`.env`、`docs/k12-teaching-aid-generator/`
- 行为：新增 `MAT_IMAGE_TIMEOUT_MS`，默认把纯提示词和参考图生图本地等待上限延长到 15 分钟；流式接口新增心跳保活，避免本地服务早于模型完成而把已计费成功的图片判为失败。

- 日期：2026-06-20
- 摘要：修复多张教材图章节内容重复
- 接触点：`server.js`、`docs/k12-teaching-aid-generator/`
- 行为：当提示词要求每张图是不同小节但未显式列出小节时，服务端自动生成每张图的章节规划；固定排版后续页只复用母版版式，强制全量替换章节标题、知识点、例句和练习内容。

- 日期：2026-07-05
- 摘要：统一图片生成网关配置
- 接触点：`server.js`、`.env`、`.env.example`、`docs/k12-teaching-aid-generator/`
- 行为：将图片生成基础地址切换为 `https://ai.cangyuansuanli.cn/v1`，模型保持 `gpt-image-2`，真实密钥仅写入本地环境变量。

- 日期：2026-07-05
- 摘要：新增生成规则确认和自填批量数量
- 接触点：`server.js`、`public/index.html`、`public/app.js`、`public/styles.css`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：批量数量改为用户自填数字并提升本地保护上限到 50；新增 `/api/generation-rule`，先结合提示词、知识库和参考风格图生成同数量页面规则，再把确认规则注入正式生图请求。

- 日期：2026-07-05
- 摘要：优化 AI 判定数量、规则展示和风格复刻
- 接触点：`server.js`、`public/index.html`、`public/app.js`、`public/styles.css`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：批量数量允许留空并由规则确认返回推荐数量；规则展示清洗 base64、图片链接和无意义主题；服务端避免把“不要遗漏”等执行要求当作页面主题；正式生图提示词强化参考风格图一比一复刻要求。

- 日期：2026-07-05
- 摘要：增强大文件生成规则确认的证据链
- 接触点：`server.js`、`public/app.js`、`public/styles.css`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：规则确认读取 PDF 总页数、文本量、标题线索和估算内容单元；最多渲染 60 页 PDF 页面截图供 AI 分析扫描型文件；当 AI 返回数量低于证据下限时自动上调；前端展示 PDF 截图数量和抽样页码。

- 日期：2026-07-05
- 摘要：拆分生成规则确认模型通道
- 接触点：`server.js`、`public/app.js`、`.env.example`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：新增 `RULE_API_BASE_URL`、`RULE_MODEL`、`RULE_API_KEY`、`RULE_TIMEOUT_MS`、`RULE_MAX_ATTEMPTS` 配置；`/api/generation-rule` 改用独立规则模型网关，正式生图继续使用原 `MAT_IMAGE_*` 配置。

- 日期：2026-07-05
- 摘要：修复规则确认首次失败和参考风格污染
- 接触点：`server.js`、`public/app.js`、`.env.example`、`docs/k12-teaching-aid-generator/`
- 行为：生成规则确认默认服务端重试 2 次，前端对首次网络失败自动补发一次；正式生图有参考风格图时不再把知识库图片作为视觉参考传入，提示词明确禁止默认模板和历史样式污染当次参考风格图。

- 日期：2026-07-05
- 摘要：切换正式生图模型
- 接触点：`server.js`、`.env.example`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：正式生图模型从 `gpt-image-2` 改为 `gpt-image-2-4k`；生成规则确认模型和接口保持不变。

- 日期：2026-07-05
- 摘要：简化生成入口并支持并发单张重试
- 接触点：`public/index.html`、`public/app.js`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：隐藏生成规则确认按钮和结果面板；点击“生成教辅图片”后自动先确认规则再生图；新增提示词占位提示和“与参考图比例一致”比例选项；失败图片一出现即可单张重试，多个失败重试可并发执行。

- 日期：2026-07-09
- 摘要：强化提示词必填提醒和生成规划进度反馈
- 接触点：`public/index.html`、`public/app.js`、`public/styles.css`、`docs/k12-teaching-aid-generator/`
- 行为：提示词为空时阻止生成并提示填写；规则确认阶段显示居中遮罩进度层，文案为“正在智能规划内容，制定出图计划，请稍等”。

- 日期：2026-07-05
- 摘要：调整生成规则数量决策权重
- 接触点：`server.js`、`public/app.js`、`docs/k12-teaching-aid-generator/`
- 行为：生成规则确认改为先识别章节、知识点、题型和教学任务等内容单元，再推荐生成数量；服务端不再把 PDF 页数作为硬下限，页数仅作为低权重规模参考。

- 日期：2026-07-05
- 摘要：消除源文件页码对逐张内容分配的影响
- 接触点：`server.js`、`docs/k12-teaching-aid-generator/`
- 行为：规则确认提示词要求按教学逻辑和内容板块重排 `pages[]`；服务端兜底规则不再把第 N 张映射到源文件第 N 页，并过滤“第几页内容”这类无效页面规划。

- 日期：2026-07-06
- 摘要：取消默认教辅练习题倾向
- 接触点：`server.js`、`public/app.js`、`public/index.html`、`docs/k12-teaching-aid-generator/`
- 行为：前端默认关闭打印友好和答案区偏好；规则确认和正式生图不再默认加入题目、练习、作答区、答案区或固定工作表模板，图片类型和风格改由用户提示词、知识库和参考图决定。

- 日期：2026-07-06
- 摘要：新增 AI 配置后台和接口池轮询
- 接触点：`server.js`、`public/admin.html`、`public/admin.js`、`public/index.html`、`public/app.js`、`public/styles.css`、`.env.example`、`.gitignore`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：新增 `/admin.html` 和 `/api/admin/ai-config`；生成规则确认和 AI 生图支持后台配置多个 OpenAI 兼容 URL、MODEL 和多 KEY；请求自动轮询可用通道；AI 生图新增 4K 分辨率档位并按 `gpt-image-2` 尺寸约束生成 `size`。

- 日期：2026-07-06
- 摘要：取消 `.env` AI 接口兜底配置
- 接触点：`server.js`、`public/admin.html`、`public/admin.js`、`public/styles.css`、`.env.example`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：生成规则确认和 AI 生图只读取后台配置；`.env.example` 移除 URL、MODEL、APIKEY 和生图分辨率接口配置；后台页面不再展示环境变量兜底状态。

- 日期：2026-07-06
- 摘要：新增用户登录、积分扣退和积分管理后台
- 接触点：`server.js`、`public/index.html`、`public/app.js`、`public/admin.html`、`public/admin.js`、`public/styles.css`、`.gitignore`、`.env.example`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：用户端移除 AI 配置后台入口；新增注册登录、积分展示、卡密兑换、购买积分跳转；正式生图按 1 张图 1 积分预扣，失败图片自动退款；管理员后台新增积分总览、卡密生成、用户积分调整、生成批次和积分流水查看。

- 日期：2026-07-06
- 摘要：支持积分确认阶段更改图片数量
- 接触点：`public/index.html`、`public/app.js`、`public/styles.css`、`docs/k12-teaching-aid-generator/`
- 行为：确认积分扣除弹窗新增“更改图片数量”入口，先提示不建议修改；用户坚持修改后可填写最终数量，并重新调用生成规则确认接口，让 AI 按新数量重新规划页面内容、顺序和生图策略，再重新确认积分扣除。

- 日期：2026-07-06
- 摘要：稳定 Cloudflare Worker 线上参考图生成链路
- 接触点：`src/worker.js`、`wrangler.toml`、`server.js`、`public/app.js`、`package.json`、`scripts/smoke-worker.mjs`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：新增 Cloudflare Worker 部署入口；线上参考图默认先分析风格再走 `/images/generations`，避免默认调用 `/images/edits` 导致 `524`；4K 严格尺寸遇瞬时网关错误自动重试；新增 Worker smoke test 覆盖参考图稳定路径和 4K 重试。

- 日期：2026-07-06
- 摘要：补齐 Cloudflare 静态资源可重复构建流程
- 接触点：`scripts/build-cloudflare-assets.mjs`、`package.json`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：新增 `build:cloudflare`、`deploy:dry` 和 `deploy` 脚本，只复制 `public/` 中的入口静态文件到 `dist/cloudflare-assets/`，避免误上传 `public/generated/` 运行产物并防止部署旧前端资源。

- 日期：2026-07-06
- 摘要：扩展 Worker smoke test 覆盖认证和积分主流程
- 接触点：`scripts/smoke-worker.mjs`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：`npm run smoke:worker` 新增首个管理员注册、普通用户注册、管理员生成卡密、用户兑换积分、积分流水、管理员权限校验和 AI 配置后台读写校验，提升上线前对核心可用性的覆盖。

## 2026-07-06

- 摘要：修复线上 4K 生图 `524` 处理
- 接触点：`src/worker.js`、`server.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：将 `524` 纳入 AI 生图可重试状态；4K 模式下保持严格 4K `size` 自动重试，不再降级到 `size:auto`；前端对旧式 `error code: 524` 做中文兜底提示。

## 2026-07-07

- 摘要：强化生成规则确认的意图理解和内容规划
- 接触点：`server.js`、`src/worker.js`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：规则确认提示词要求先理解用户任务意图、知识库整体内容和主题层级，再决定推荐图片数量和逐张规划；内容单元估算不再按 PDF 页数折算，页数只作为来源定位和截图抽样证据；Worker 与本地服务端同步保留更完整的 AI `pages[]` 规划，并在低于内容规划安全下限时按标题、知识点、题型、主题层级和文本密度保护性上调。

- 摘要：从第一性原理重构生成规则数量决策
- 接触点：`server.js`、`src/worker.js`、`public/app.js`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：规则确认不再向 AI 暴露本地推荐张数锚点；AI 的有效 `recommendedCount`、`pages[]` 和 `batchItems` 规划优先，服务端仅在缺少有效规划时按文本、标题和显式内容线索兜底；正式生图提示词、前端规则面板和确认载荷新增 `intentAnalysis`、`contentHierarchy`、`coverageMap`，并明确页数、截图数、上传图片数和文件数不参与生成数量决策。

- 摘要：升级生成规则确认的内容盘点与出图策略
- 接触点：`server.js`、`src/worker.js`、`public/app.js`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：规则确认新增“全量内容盘点 -> 数量策略 -> 内容生产策略 -> 风格建议 -> 覆盖审计”的通用流程；新增 `contentInventory`、`countStrategy`、`contentProductionStrategy`、`styleAdvice`、`coverageAudit` 字段并注入正式生图提示词；提高覆盖清单和逐张规划容量，要求高密度资料按知识簇和可读性拆分，不按原页塞满图片。

## 2026-07-08

- 摘要：修复生图内容偶发偏离知识库的问题
- 接触点：`src/worker.js`、`server.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：新增知识库蓝图 `knowledgeBlueprint.anchors[]`，规则确认前先抽取真实内容锚点，再将每张 `pages[]` 绑定 `knowledgeAnchor`；正式生图前服务端重新校验并重建锚点，即使前端回传规则丢失蓝图或单张锚点，最终生图 prompt 仍必须包含当前页真实知识库内容、必含词和来源。

- 日期：2026-07-08
- 摘要：收紧正式生图的单张知识库接地
- 接触点：`src/worker.js`、`server.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：正式生图 prompt 不再把整份知识库全文、全量蓝图锚点或其他页面规划作为当前张取材池；服务端改为只下发当前页规则、当前页知识库锚点、当前页必含项和必要全局摘要，并新增 smoke 覆盖非当前页知识点不得泄漏到最终单张 prompt。

- 日期：2026-07-08
- 摘要：用内容锚点数量兜住页数误判
- 接触点：`src/worker.js`、`server.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：当用户未手填数量时，服务端将可靠的 `knowledgeBlueprint.anchors[]` 数量、AI 返回的 `contentUnits` 数量和明确编号标题线索纳入生成数量下限；即使规则模型偶发把 7 页 PDF 误判成 7 张，也会按已识别的 50 个独立内容锚点抬升到 50 张，并新增 50 场景测试素材特征的对抗式 smoke，验证第 50 张 prompt 不泄漏第 1 张内容。

## 2026-07-10

- 摘要：修复 Worker 规则生成被知识库解析异常中断
- 接触点：`src/worker.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：补齐 Worker 知识库解析错误格式化函数；Word 等知识库文件读取失败时保留原始错误备注并继续规则规划，不再被 `formatKnowledgeExtractionError is not defined` 覆盖；新增损坏 DOCX 回归用例。
- 日期：2026-07-11
- 摘要：放宽提示词校验并优化积分不足选择
- 接触点：`public/app.js`、`public/index.html`、`public/styles.css`、`server.js`、`src/worker.js`、`scripts/smoke-worker.mjs`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：提示词仅在去除首尾空白后为空时提醒填写，不再限制最少字符数；AI 推荐生成数量超过当前积分时，用户可选择购买积分，或按当前余额对应的图片数量重新规划后继续生成。

- 日期：2026-07-11
- 摘要：修复 Worker 参考风格批量生图过早超时
- 接触点：`src/worker.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：不调整 AI 模型和后台配置；将 Worker 单张生图等待时间与本地服务统一为 15 分钟，超时保护覆盖完整响应体读取；参考风格批次继续充分使用上游并发能力；响应体中途断开或 JSON 截断时继续执行既有自动重试。

- 日期：2026-07-11
- 摘要：从同步 524 根因重构 Worker 生图传输与批次回收
- 接触点：`src/worker.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：根据生产 KV 中每轮约 130 秒返回 524 的证据，将同一 `/images/generations` 请求改为 SSE 流式传输并保留现有并发；仅在上游明确不支持流式字段时回退同步协议；增加孤儿批次自动退款和真实失败诊断，不调整 AI 模型与配置后台。
- 补充：按标准 SSE `event:` 字段识别完成事件，收到最终图后立即关闭读取；partial 数据行边读取边丢弃，避免 4K 中间图在并发时占用内存；完成无图、partial 后断流会自动重试，`524` 始终保持流式重试。
- 补充：生成队列、取消接口和积分结算统一使用同一个批次 ID；孤儿回收按最近活动时间判定，禁止已丢失的旧批次在结算时重新写回，并确保运行中批次不被历史裁剪。

- 日期：2026-07-11
- 摘要：消除确认到模型调用及模型完成到前端展示的额外等待
- 接触点：`server.js`、`src/worker.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：本地 Node 对齐 Worker 的 SSE 生图，避免同步 524 三轮约 400 秒等待；正式生成复用规则阶段的参考风格说明，完整知识库蓝图不再重复上传原始资料；partial、大 Base64 和同步最终图在保存前立即预览，partial-only 正常流不重复生图；前端改为单卡片增量更新并在本地地址预加载成功后切换，所有既有并发数保持不变。

- 日期：2026-07-11
- 摘要：根据生产 439 秒批次纠正生图链路延迟方案
- 接触点：`server.js`、`src/worker.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：部署与静态资源核验无误后，以真实批次证明上一版性能目标未达成；图片模型的结果未知错误改为单次操作，仅保留明确未受理时的协议回退；有效 partial 在后续断流时直接持久化；兼容无事件名 SSE 图片。
- 行为：下行 NDJSON 禁止 Base64，HTTP(S) URL 才能作为 preview；模型产物与持久化分阶段执行，慢 KV 不再占用既有 2/3 路模型并发槽；正式生图只传参考图存在性和数量，并新增预处理、模型、持久化阶段时序。

- 日期：2026-07-11
- 摘要：消除 KV 保存与传播对首图展示的阻塞
- 接触点：`src/worker.js`、`server.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`README.md`、`docs/k12-teaching-aid-generator/`
- 行为：Base64 图片改用 48 KiB 的 `preview_start/preview_chunk/preview_end` 小事件下发，浏览器在持久化并行期间组装 Blob 立即展示；最终 `/generated/...` 预加载约 30 秒并在成功后释放 Blob；NDJSON 单行保持小于 64 KiB。
- 行为：持久化并发限制为对应模型窗口，模型线程最多额外持有一份产物；取消和异常路径会收拢已启动任务并抑制终态后的成功事件；普通与固定排版模型并发常量仍为 2/3。
- 行为：所有分辨率的结果未知错误均只执行一次模型操作；仅 HTTP 400/422 明确拒绝流式参数时允许协议回退；无类型 SSE 等待结束并采用最后一张图片；Smoke 增加 55 秒硬超时、分块预览、持久化背压、取消竞态和失败退款覆盖。

- 日期：2026-07-11
- 摘要：补齐上线前的预览、持久化失败和取消竞态边界
- 接触点：`src/worker.js`、`server.js`、`public/app.js`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：完整 Base64 预览改为在等待持久化槽之前下发，图片保存完成即释放持久化槽，积分结果写不再反向阻塞模型调度；持久化失败时前端保留可下载的本地副本并显示已退款；同一 Worker 实例内的生成预扣、结果记录、取消和结算有序执行，取消标记阻止迟到结果覆盖取消终态。

- 日期：2026-07-11
- 摘要：完成发布前的取消终态、前端本地副本和静态缓存闭环
- 接触点：`src/worker.js`、`server.js`、`public/app.js`、`public/index.html`、`scripts/smoke-worker.mjs`、`docs/k12-teaching-aid-generator/`
- 行为：同一 Worker 实例先同步发布取消信号，所有预览任务在槽位等待前登记并收拢，`done` 在实际写入时再次复核取消并在被抑制后改发取消 `error`；阻塞取消 marker 与终态写入 smoke 覆盖该竞态。
- 行为：前端只在图片真实加载后认定“仅本地”，损坏 Blob 转失败卡；清空后旧重试不能复活结果，无新预览的成功重试仍可正确释放旧 Blob，固定排版不会提交 `blob:` 母版，URL-safe/无填充 Base64 按严格分块边界解码。
- 行为：Cloudflare 入口为 `/app.js` 增加本次发布版本参数，避免新 Worker 已发布但浏览器继续复用旧前端脚本；浏览器 DOM mock 12/12、Blob 回收 5/5 通过。

- 日期：2026-07-11
- 摘要：正式发布第二轮生图链路性能修复
- 接触点：GitHub `main`、Cloudflare Worker `tlsjf`、`jiaofu.gongtouai.top`
- 行为：提交 `1ced991` 已推送，Cloudflare 版本 `099bb91f-04fd-4e77-abac-b9ac783919c9` 已承载 100% 流量；正式域名首页引用版本化脚本，线上 `app.js` 与本地 SHA-256 完全一致并包含 `preview_start/preview_chunk/preview_end`。健康接口仍保持 4K 配置，本次验收未调用真实生图接口。
