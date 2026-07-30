# 学习资料生成器契约

## 2026-07 关键规则补充展示契约

`keyPoints` 不新增接口字段。网页在每条规则的基础说明之后，按存在的字段依次展示：`example`（举个例子）、`memoryTip`（记住它）与 `retrievalQuestion`（30 秒检查）。短检查展开后的核对要点由同一条规则的使用线索、规则本身与易错边界推导，保证问题与核对内容一致；`diagnostic` 继续由归一化层补齐，仅在缺少检查问题时作为回退。

展示约束：这些内容必须属于当前 `keyPoint`，只在该规则内部纵向出现；不得形成新的一级章节，也不得将中文正文压缩到并排窄列中。`masteryChecks` 的 `deliverable`、`criteria` 与 `ifStuck` 在网页中始终按顺序单列呈现。

## 配置项

| 配置 | 类型 | 必需 | 默认值 | 约束 |
|------|------|------|--------|------|
| `PORT` | number | 否 | `5174` | 1—65535 |
| `AI_API_KEY` | string | 是 | 无 | 仅服务端读取，不允许回传 |
| `AI_BASE_URL` | string | 是 | `https://ai.wudi987.com/v1` | OpenAI 兼容接口根地址 |
| `AI_MODEL` | string | 是 | `gemini-3.5-flash-low` | 支持文本和图片输入 |
| `EXPORT_BROWSER_PATH` | string | 否 | 自动发现 | PDF 导出使用的 Chromium 浏览器路径 |

## `GET /api/health`

响应字段：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | 固定为 `true` | 服务可用状态 |
| `aiConfigured` | boolean | 是 | - | 是否配置 AI 密钥 |
| `maxFileSizeMb` | number | 是 | 固定为 `20` | 单文件上限 |
| `maxFiles` | number | 是 | 固定为 `8` | 文件数量上限 |

示例：

```json
{
  "ok": true,
  "aiConfigured": false,
  "maxFileSizeMb": 20,
  "maxFiles": 8
}
```

## 图形后台任务与公平轮转契约

### 服务端任务状态

`POST /api/render/figure` 是幂等的任务创建兼状态查询接口。同一
`X-Render-Id + figureId + cacheKey` 在会话内只能对应一个任务：

- `queued`：任务已登记，等待会话并发槽。
- `running`：正在调用既有 AI 图形生成与质量审计链路。
- `retrying`：本轮未通过，已按退避时间回到公平队列；响应不含 SVG。
- `ready`：SVG 已通过安全、学科语义、视觉质量和会话内去重审计，可原位发布。

首次请求必须快速返回 `202`，后台任务不依赖 HTTP 连接继续执行。后续轮询仅返回状态，
不得为同一图重复创建模型调用。只有 `ready` 返回 `svg`；其他状态统一返回
`attempt`、`pollAfterMs` 和 `retryable`，不返回临时内容。

### 服务端调度规则

- 每个会话最多同时执行五个 AI 图形任务，保持现有并发规模。
- 每次失败只消耗当前调度配额，任务按 `nextAttemptAt` 和入队顺序回到队尾。
- 新任务与到期重试任务使用同一公平队列；失败任务不得永久占用并发槽。
- 差异化重绘、模型参数、提示词和质量审计继续复用现有生产函数，不降低任何门槛。
- HTTP 断开、页面短暂离线或轮询超时不影响后台任务；相同任务键重连只读取状态。

### 前端发布规则

- 每次 worker 只执行一次短轮询，未完成任务按服务端 `pollAfterMs` 重新排队。
- 初次任务优先于已轮询任务，确保前五张持续重试时，第六张及后续图仍能登记和生成。
- 每张图同时最多一个请求，旧 `figureLoadToken` 的响应不得写入新资料。
- 非 `ready` 状态始终只显示“图形正在生产中”和进度条。
- 所有图均原位发布成功后，PDF 与 Word 下载按钮自动开放。

## 图形终态收敛契约

### 单图状态响应

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `renderStatus` | string | 是 | `queued/running/retrying/ready` | `ready` 以外不得包含 SVG |
| `attempt` | number | 是 | 大于等于 0 | 后台原子候选执行次数 |
| `pollAfterMs` | number | 是 | 0—10000 | 浏览器下一次轮询等待时间 |
| `renderVersion` | string | 条件必需 | `ready` 时必需且稳定 | 当前完整 SVG 的内容版本 |
| `svg` | string | 条件必需 | 仅 `ready` 返回 | 必须通过全部现有审计 |

### 发布拒绝请求

`POST /api/render/figure` 可附带以下字段：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `rejectedRenderVersion` | string | 否 | 必须等于该任务当前 `renderVersion` | 浏览器无法安全解析当前 SVG 时使用 |

当拒绝版本与当前成品一致时，服务端必须原子撤销该成品及其会话内几何签名，
将任务重新置为 `queued` 并绕过旧缓存生成新版本。拒绝请求和非 `ready` 响应均不得返回旧 SVG。

### 执行不变量

- 每个后台并发配额最多调用一次既有 `generateTeachingFigureSvg`；重复图差异化必须释放槽位后再回队。
- 单个候选执行超过任务看门狗时必须中止上游请求、废弃执行令牌并重新排队。
- 已超时执行的迟到结果不得认领签名、写入成品或覆盖后续成功结果。
- `FIGURE_GENERATION_EXHAUSTED` 继续同模型重画；`FIGURE_DUPLICATE_RETRY_REQUIRED` 携带冲突对象进入下一次差异化候选；发布拒绝强制生成新候选。
- 浏览器的单图异常只能重新排队该图，不得停止其他图形。
- 图形描述为空时依次组合标题、用途、题干、图注和约束；不得因此创建替代图或降低质量门槛。

## `POST /api/generate`

请求类型为 `multipart/form-data`。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `files` | File[] | 条件必需 | 1—8 个；单个不超过 20 MB | 与 `manualText` 至少提供一种；图片、PDF、DOC、DOCX |
| `manualText` | string | 条件必需 | 2—12000 字符 | 与 `files` 至少提供一种；纯文本知识点或学习内容 |
| `grade` | string | 是 | 1—30 字符 | 年级或学习阶段 |
| `subject` | string | 是 | 1—30 字符，可为“自动识别” | 学科 |
| `goal` | string | 是 | `understand`、`exam`、`deep` | 学习目标 |
| `depth` | string | 是 | `standard`、`detailed` | 讲解深度 |

成功响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `warnings` | string[] | 是 | 可为空 | 截断、页数限制等提示 |
| `material` | StudyMaterial | 是 | 满足下方不变量 | 学习讲义 |

最小示例：

```json
{
  "warnings": [],
  "material": {
    "meta": {
      "title": "课文学习讲义",
      "subject": "语文",
      "grade": "七年级",
      "estimatedMinutes": 35,
      "difficulty": "适中",
      "summary": "先建立整体理解，再通过精读和练习完成巩固。"
    }
  }
}
```

错误响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `error` | string | 是 | 面向用户的中文说明 | 不包含密钥和堆栈 |
| `code` | string | 是 | 稳定错误码 | 前端用于分类提示 |

输入不变量：

- `files` 与 `manualText` 至少提供一种。
- 同时提供时优先处理 `manualText`，前端不应混合提交两种来源。
- `manualText` 清理 HTML、控制字符与多余空白后参与 AI 生成，不写入磁盘。

## `StudyMaterial`

| 字段 | 类型 | 必需 | 不变量 |
|------|------|------|--------|
| `meta` | object | 是 | 包含标题、学科、年级、时长、难度、摘要 |
| `learningGoals` | object[] | 是 | 固定 3 项；每项具有稳定 `id`，依次服务复述、应用、迁移学习目标 |
| `learningRoute` | object[] | 是 | 固定 3 项且与目标一一对应；每项显式关联知识节点、重点、示范、练习、掌握证明和有效资料编号 |
| `learningGraph` | object | 是 | 输出图谱状态、目标数、路线数和未闭环问题；完整讲义状态为“完整闭环” |
| `sourceAtoms` | object[] | 是 | 1—6 项；由原资料提取的稳定证据单元，不接受模型伪造来源 |
| `sourceEvidence` | object | 是 | 标记资料是否充足，并给出面向学生的资料使用说明 |
| `sourceCoverage` | object | 是 | 输出每条资料证据的讲解与主动任务覆盖情况，以及待补齐编号 |
| `overview` | object | 是 | 包含核心问题、阅读提示和内容概览 |
| `coreModel` | object | 是 | 在学习导航中展示；包含核心命题、3—5 条推理链、2—3 个边界和一个易混对照 |
| `quickStart` | object | 是 | 包含前置检查、3—5 步时间盒路线和首个挑战 |
| `knowledgeMap` | object | 是 | 包含覆盖模式、覆盖范围、覆盖说明，以及 6—32 个具有稳定 `id` 的分类或知识节点 |
| `keyPoints` | object[] | 是 | 至少 3 项；每项具有稳定 `id`，并包含关键判断、机制、资料锚点、边界、识别信号和 `diagnostic` 诊断闭环 |
| `strategyCards` | object[] | 是 | 在重点精讲中展示；至少 3 项，包含触发信号、第一步、理由化路线、得分点、失分、变式和有效资料编号 |
| `workedExamples` | object[] | 是 | 至少 2 例；每项具有稳定 `id`，并包含触发信号、策略、分步推理、答案、自检点、变式和 `decisionFork` 决策分叉 |
| `closeReading` | object[] | 是 | 至少 2 项；包含原文、解释和思考题 |
| `concepts` | object[] | 是 | 至少 3 项 |
| `visuals` | object[] | 是 | 固定 2 项；文字保留流程/对比语义，图形由对应 SVG teachingFigure 呈现 |
| `mistakes` | object[] | 是 | 至少 2 项 |
| `practice` | object[] | 是 | 至少 4 题；每题具有稳定 `id`，并包含答案和解析 |
| `masteryChecks` | object[] | 是 | 固定 3 项；每项具有稳定 `id`，覆盖复述、应用、迁移三个层级，且提供 `outputFrame` 输出骨架 |
| `reviewPlan` | object[] | 是 | 至少 3 个复习节点 |

新增字段结构：

```json
{
  "sourceAtoms": [{
    "id": "S1-2",
    "sourceName": "一次函数.txt",
    "text": "当 k>0 时，y 随 x 增大而增大。",
    "label": "适用条件：k 的正负与增减性",
    "kind": "condition"
  }],
  "sourceEvidence": {
    "status": "ready",
    "message": "重点、例题和练习应回到资料证据，不靠泛化结论记忆。"
  },
  "learningGoals": [
    { "id": "G1", "level": "理解", "text": "能判断 k 的正负与函数增减性" },
    { "id": "G2", "level": "应用", "text": "能在给定图像或式子中说明判断理由" },
    { "id": "G3", "level": "迁移", "text": "能在条件变化时重新判断结论是否成立" }
  ],
  "knowledgeMap": {
    "center": "一次函数的增减性",
    "nodes": [{ "id": "N1", "label": "k 的正负", "detail": "决定增减趋势的条件" }]
  },
  "learningRoute": [{
    "id": "R1",
    "goalId": "G1",
    "goalLevel": "理解",
    "goal": "能判断 k 的正负与函数增减性",
    "knowledgeNodeIds": ["N1"],
    "keyPointIds": ["K1"],
    "exampleIds": ["E1"],
    "practiceIds": ["P1"],
    "masteryCheckIds": ["M1"],
    "focus": "区分 k 与 b 的不同分工",
    "action": "先完成系数判断示范，再独立完成图像走势判断。",
    "proof": "写出决定增减性的系数和理由。",
    "evidenceFocus": "资料中的 k 的正负条件与增减结论",
    "sourceRefs": ["S1-2"],
    "sharedExampleReason": "该示范同时展示系数识别与理由表达，因此可服务理解与应用目标。"
  }],
  "quickStart": {
    "prerequisites": [{ "topic": "前置知识", "check": "可立即执行的检查" }],
    "studyPlan": [{ "minutes": 1, "task": "学习动作", "outcome": "可见产出" }],
    "firstChallenge": "开始精讲前可以尝试的问题"
  },
  "coreModel": {
    "coreClaim": "本主题最关键的可判断命题",
    "reasoningChain": [{ "from": "条件或证据", "because": "为何能推出", "therefore": "结论或动作" }],
    "boundaries": [{ "when": "适用或失效条件", "rule": "此时应怎样判断", "why": "原因或反例" }],
    "confusionPair": { "title": "易混概念或路径", "difference": "关键区别", "decisionRule": "一眼区分的规则" }
  },
  "workedExamples": [{
    "id": "E1",
    "title": "例题标题",
    "problem": "题目或任务",
    "trigger": "题目中需要立即识别的条件或信号",
    "strategy": "为什么采用这个方法",
    "steps": [{ "label": "步骤名称", "explanation": "具体推理", "checkpoint": "这一步检查什么" }],
    "answer": "完整答案",
    "selfCheck": "学生核对过程与结果的检查点",
    "variation": "改变条件后的迁移问题",
    "decisionFork": {
      "temptingMove": "一条看似可以直接采用的路径",
      "whyItFails": "它与题目条件、资料证据或推理规则不一致的原因",
      "recoveryMove": "应回到哪一个触发信号、判断或推理步骤"
    },
    "sourceRefs": ["S1-2"]
  }],
  "keyPoints": [{
    "id": "K1",
    "title": "重点标题",
    "diagnostic": {
      "prompt": "先判一题：学生必须先作出的具体判断",
      "expected": "核对从资料条件到结论的推理逻辑",
      "trap": "最容易出现且与当前资料相关的误判",
      "repair": "回到具体资料证据或前序步骤的修复动作"
    },
    "sourceRefs": ["S1-2"]
  }],
  "strategyCards": [{
    "scenario": "高价值题型或应用情境",
    "trigger": "出现哪些词、条件或结构时调用",
    "firstMove": "下笔前第一步",
    "route": [{ "action": "操作", "reason": "为什么此时这样做" }],
    "scoringPoints": ["可得分的关键表达或步骤"],
    "commonLoss": "常见失分点",
    "variation": "一个改变条件的变式",
    "sourceRefs": ["S1-2"]
  }],
  "practice": [{
    "id": "P1",
    "type": "系数判断练习",
    "question": "根据 k 的正负判断一次函数的增减性，并写出理由。",
    "answer": "答案必须同时写出 k 的符号、增减结论和条件依据。",
    "sourceRefs": ["S1-2"]
  }],
  "masteryChecks": [{
    "id": "M1",
    "level": "复述",
    "task": "不看讲义完成的任务",
    "criteria": "可观察、可判断的通过标准",
    "ifStuck": "未通过时返回的具体内容或动作",
    "outputFrame": ["结论：……", "资料依据：……", "推理或示例：……"],
    "sourceRefs": ["S1-2"]
  }]
}
```

## 学习图谱引用契约

| 实体 | 稳定 ID | 路线引用字段 | 最小数量 |
|------|---------|--------------|----------|
| 学习目标 | `G1`—`G3` | `goalId` | 固定 3 项 |
| 知识节点 | `N1`… | `knowledgeNodeIds` | 每条路线至少 1 项 |
| 重点 | `K1`… | `keyPointIds` | 每条路线至少 1 项 |
| 例题 | `E1`… | `exampleIds` | 每条路线至少 1 项 |
| 练习 | `P1`… | `practiceIds` | 每条路线至少 1 项 |
| 掌握证明 | `M1`—`M3` | `masteryCheckIds` | 每条路线至少 1 项 |

`learningRoute` 项必须具有如下字段：

| 字段 | 类型 | 必需 | 约束 |
|------|------|------|------|
| `id` | string | 是 | 在当前讲义内唯一，格式为 `R1`… |
| `goalId` | string | 是 | 必须引用一个现有 `learningGoals.id` |
| `knowledgeNodeIds` | string[] | 是 | 仅引用现有知识节点 ID，至少 1 项 |
| `keyPointIds` | string[] | 是 | 仅引用现有重点 ID，至少 1 项 |
| `exampleIds` | string[] | 是 | 仅引用现有例题 ID，至少 1 项 |
| `practiceIds` | string[] | 是 | 仅引用现有练习 ID，至少 1 项 |
| `masteryCheckIds` | string[] | 是 | 仅引用现有掌握证明 ID，至少 1 项 |
| `focus` | string | 是 | 可执行的关键判断 |
| `action` | string | 是 | 学生此刻可完成的独立动作 |
| `proof` | string | 是 | 可检查的完成证据 |
| `evidenceFocus` | string | 是 | 面向学生说明本路线应回看的资料依据 |
| `sourceRefs` | string[] | 是 | 仅引用现有 `sourceAtoms.id`，至少 1 项 |
| `sharedExampleReason` | string | 是 | 例题在多条路线复用时为非空中文说明，否则为空字符串 |

Word 导出顺序固定为：

1. `学习导航`：学习目标、核心问题、5 分钟启动、知识地图与完整知识节点。
2. `重点与方法`：核心原理、重点、策略、精读、词典、SVG 图解与 SVG 辅助图。
3. `例题与练习`：例题拆解、易错辨析、分层练习与错后修复。
4. `掌握与复习`：复述、应用、迁移三关及间隔复习计划。

Word 与网页使用同一份完整报告数据，不再压缩栏目。`sourceAtoms` 与 `sourceRefs` 继续服务于生成质量校验，但 Word 可见内容不展示资料索引、资料锚点或内部编号。

示范复用规则：同一个 `exampleId` 第一次关联时输出示范摘要；后续路线只输出复用说明和该路线的独立练，不重复示范题干、步骤和答案。

## `POST /api/export/pdf`

请求类型为 `application/json`。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `material` | StudyMaterial | 是 | 请求体不超过 2 MB | 当前完整讲义 |

成功响应：`200 application/pdf`，响应头包含 UTF-8 文件名的 `Content-Disposition: attachment`。

## `POST /api/export/docx`

请求类型为 `application/json`。

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `material` | StudyMaterial | 是 | 请求体不超过 2 MB | 当前完整讲义 |

成功响应：`200 application/vnd.openxmlformats-officedocument.wordprocessingml.document`，响应头包含 UTF-8 文件名的 `Content-Disposition: attachment`。

导出错误：

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| `400` | `EXPORT_INVALID_MATERIAL` | 请求中缺少有效讲义 |
| `500` | `EXPORT_FAILED` | 文件生成失败，不返回损坏文件 |

## 网页阅读编排契约

网页不新增 API 字段；它只以 `StudyMaterial` 的核心数组组织为四个顺序固定的课堂学习讲义步骤：

| 步骤 | 使用字段 | 数量与呈现约束 |
|------|------|------|
| 本课目标 | `learningGoals`、`overview.coreQuestion`、`quickStart.firstChallenge` | 3 个目标、1 个核心问题、1 个起步任务；若兼容字段是模板占位文案，前端从首个关键规则派生学生化问题与起步任务 |
| 关键规则 | `keyPoints` | 3 个重点；每项依次为一句话规则、意思是、看到什么时用、最容易错在哪儿；做题顺序图由 teachingFigures 的 SVG 呈现 |
| 示范与练习 | `workedExamples`、`practice` | 最多 2 个示范、固定 3 个独立练习；答案默认折叠 |
| 检查掌握 | `masteryChecks`、`reviewPlan` | 固定复述、应用、迁移并安排间隔复习；不展示内部资料索引 |

展示不变量：

- `meta.title` 只表示知识主题；归一化层删除学习方式和文档包装尾缀，所有网页、复制和导出显示使用同一清洗结果。
- 图解不再使用 ASCII；`knowledgeDiagrams`、`visuals`、例题和练习均通过 teachingFigures 关联 SVG，标题和说明仍保留在 `StudyMaterial` 中。
- `sourceAtoms.text` 保持原资料原文；任何禁用词仅在展示层替换，不回写证据数据。

网页正文不直接将 `strategyCards`、`closeReading`、`concepts`、`visuals`、`mistakes`、`diagnostic`、`decisionFork` 或 `outputFrame` 渲染为平行章节。`diagnostic` 仅在缺少 `retrievalQuestion` 时作为所属关键规则内的折叠核对回退；其余字段可继续作为归一化和导出兼容字段存在，但不增加学生的阅读入口。

## 验证规则

- 上传文件扩展名和 MIME 类型必须至少有一项命中允许列表。
- 所有字符串在返回前进行长度限制和纯文本规范化。
- 生成内容与标题不得包含禁用学习方式表述；标题不得附加指南、讲义、工作页、任务单等包装名称。
- 模型返回缺失字段时由服务端补齐安全默认结构。
- `learningGoals`、`knowledgeMap.nodes`、`keyPoints`、`practice`、`masteryChecks` 均固定为 3 项；`workedExamples` 最多 2 项。
- 每个重点都必须有非空的 `principle`、`explanation`、`useWhen`、`boundary`；每个练习都必须有 `solvingPlan`、`answer`、`explanation`、`repairAction`；每个掌握证明都必须有 `task`、`deliverable`、`criteria`、`ifStuck`。
- 资料证据单元的原文必须可在输入资料中找到；输入资料不足时只标记资料较少，不伪造额外原文。
- 重点、例题、练习、掌握证明和学习路径的 `sourceRefs` 不得为空，且只能引用 `sourceAtoms` 中存在的编号；未知编号会被归一化为真实资料锚点。
- `strategyCards`、`closeReading`、`concepts`、`visuals`、`mistakes`、`diagnostic`、`decisionFork` 与 `outputFrame` 为兼容字段，不构成新版网页或模型输出的必填质量门槛。
- 学习目标与学习路径均固定 3 项，按 `goalId` 一一对应；每条路线必须关联至少一个知识节点、重点、例题、练习、掌握证明和资料证据，并包含关键判断、独立动作与完成证据。
- 图谱实体 ID 在当前讲义内必须唯一；路线中的关联 ID 不得悬空。例题被多条路线复用时，相关路线的 `sharedExampleReason` 必须为非空中文说明。
- 每个资料证据至少应出现在一次讲解实体（重点或例题）和一次主动任务（练习或掌握证明）的 `sourceRefs` 中；资料不足时必须输出明确提示，而不是伪造覆盖。
- PDF 可按网页打印样式输出；Word 必须按“学习导航→重点与方法→例题与练习→掌握与复习”输出完整报告，并保留网页全部正式学习栏目。
- 前端只使用 `textContent` 或受控 DOM 构建结果，不插入模型提供的 HTML。
- 导出接口重新规范化讲义数据，文件名移除系统保留字符并限制长度。
- PDF 只加载本站页面并通过受控 DOM 注入讲义，不执行模型提供的脚本或 HTML。
- Word 表格必须使用 DXA 固定宽度；复杂长内容优先单列并允许跨页，短标签信息才能使用两列或三列；知识地图、流程图和 SVG 图解必须保留。
- 未配置 AI 时返回 `503 AI_NOT_CONFIGURED`，不处理文件内容。
- AI 请求失败或响应无效时返回 `502 AI_GENERATION_FAILED`，不返回本地生成内容或半成品。

## 完整资料册内容契约

- `strategyCards`、`closeReading`、`concepts`、`visuals`、`mistakes`、`reviewPlan` 与重点、例题、练习、掌握证明同为正式内容，不再作为可被默认删除的补充字段。
- 归一化层必须从默认讲义补齐缺失栏目，并按统一上限保留：知识节点 6—32、策略 3、精读 2、词典 6、图解 2、易错 4、练习 4、复习计划 4。
- 网页一级栏目固定为十项；复习计划收纳在“掌握证明”结尾。`sourceAtoms` 与 `sourceRefs` 继续用于生成质量和导出追溯，但学生阅读页不显示资料索引、资料锚点或跳转入口。
- Word 使用四大阶段组织相同内容，不压缩为三个关键单元；栏目顺序应保持重点→策略→精读→词典→图解，以及例题→易错→练习。
- 完整不等于堆叠：生成端必须说明每个栏目的独立职责，禁止同一知识点在多个栏目仅做同义改写。

## Word 完整报告视觉契约

- 产品名称统一为“学习资料生成器”，用于封面、文档元数据、页眉与页脚；不得保留其他副品牌。
- A4 正文使用约 20 mm 页边距、10.5 pt 正文字号和稳定行距；一级阶段、二级栏目、正文与辅助说明必须保持清晰层级。
- 每个阶段从新页开始。长表格行和语义卡允许跨页，不得以 `cantSplit` 强制整块跳页形成大面积空白。
- 蓝色浅底表示问题与行动，绿色浅底表示答案与通过，琥珀浅底表示边界与提醒，红色浅底表示错误与失分；除 ASCII 代码图外不使用大面积深底白字。
- 例题决策分叉、掌握证明等长中文内容必须使用单列结构；多列只承载短标签或可预测长度的信息。
- 每次 Word 视觉改版都必须用 Microsoft Word 实际打开并导出 PDF，再逐页检查乱码、重叠、截断、异常空白和分页孤行。

## 系统知识与 SVG 图解最新契约

- `knowledgeMap.scopeType` 必须为 `closed`、`open`、`single` 之一，分别表示有限体系、开放体系和单一概念。
- `knowledgeMap.scope` 必须明确本讲义覆盖的年级、教材或常见使用边界；不能用“主要内容”等模糊表述。
- `knowledgeMap.coverageSummary` 必须说明覆盖了多少标准成员，或多少主流分类与常用成员；未展开的冷僻或超纲范围必须明示。
- `knowledgeMap.coverageDimensions` 为 4—8 项，列出本讲义实际覆盖的维度，例如完整分类、核心规则、典型成员、例外、易混与应用。
- `knowledgeMap.nodes` 必须为 6—32 项；节点数由知识结构决定，不得为了固定数量漏掉必要分支。
- `knowledgeMap.nodes[].members` 为 0—24 项。开放体系使用分类节点承载该类常用成员；有限体系优先逐项建立节点。
- 每个节点至少包含 `id`、`label`、`detail`、`members` 和有效 `sourceRefs`；`detail` 最长 220 字。
- 英语时态系统默认覆盖 4 个时间维度与 4 个动作状态组合形成的 16 种常见时态；每个节点至少说明用途、结构或代表性时间线索中的两项。
- 英语介词等开放体系必须覆盖全部主流功能分类，并在 `members` 中列出年级内常用成员，不能只选择少数介词举例。
- `knowledgeDiagrams` 固定 2 项。每项结构为：`title:string`、`purpose:string`、`explanation:string`、`readingGuide:string[]`、`figureType:string`、`figureHint:string`；不再输出 `ascii`。
- 网页一级栏目中的图解栏目名称固定为“图解知识点”；该栏目直接展示 D1、D2 对应的安全 SVG，辅助图展示 V1、V2 对应的安全 SVG。
- 全部字符串在归一化时删除“补充讲解”及其方括号/书名号包装，不影响原有资料引用关系。

## 结果页章节层级与视觉语义契约

- 网页固定的十个正文栏目全部属于一级章节，栏目标题使用 `<h2>`；栏目内部知识点、例题、词条、图解和练习标题使用 `<h3>` 或更低层级。
- 每个一级章节必须关联一个 `stageGroups` 阶段，并呈现栏目序号、总栏目数、阶段名称、栏目标题、栏目导语和栏目说明。
- 四个阶段固定为“第一阶段 · 先看全局”“第二阶段 · 理解知识”“第三阶段 · 练会应用”“第四阶段 · 检查掌握”；目录与正文使用相同阶段定义，不维护两套文案。
- 语义样式不改变数据含义：判断与步骤使用蓝色语义，条件与边界使用琥珀语义，正确证据与通过标准使用绿色语义，错误路径与失分点使用红色语义。
- 语义不能只依赖颜色；每个区域仍必须保留明确文字标签，并通过边框、背景和位置共同形成区别。

## 学科识别与 AI 内容结构容错契约

学科解析优先级固定为：

1. `options.subject` 为明确学科时，直接锁定该值。
2. `options.subject=自动识别` 时，查找用户输入或资料文本中首次出现的明确学科词。
3. 未出现明确学科词时，按学科特征词推断。
4. 仍不能识别时使用“语文”。

`defaults.meta.subject` 是当前生成请求的权威学科。AI 返回的 `meta.subject` 只能与其一致，不得覆盖；冲突时必须进入一次质量修订，最终归一化仍采用权威学科。

AI 内容解析顺序固定为：直接 JSON 解析 → 提取首个 JSON 对象 → 转义字符串内控制字符并清理尾随逗号 → 一次 AI JSON 格式修复。格式修复只恢复 JSON 结构，不得增删或改写学习内容。全部失败时接口返回 `502 AI_GENERATION_FAILED` 和不含底层位置、堆栈的中文说明。
## 全学科公式数据与渲染契约

### 内容标记

- 行内公式：`$LaTeX$`，用于句子中的量、符号、单位关系和短公式。
- 独立公式：`$$LaTeX$$`，用于推导、方程组、反应式或需要单独阅读的长公式。
- 化学表达：在任一公式定界符内使用 `\ce{...}`，包含分子式、离子、电荷、状态、反应条件与反应箭头。
- 兼容输入：系统解析层同时接受 `\(...\)` 与 `\[...\]`，归一化后的 AI 契约仍以 `$...$`、`$$...$$` 为主。

### 公式审计对象

- 递归检查 `material` 中全部字符串和字符串数组。
- 排除 `sourceAtoms`、`sourceFiles` 等原始资料字段，避免修改用户上传内容。
- 图形 SVG、参数、标签和结构箭头不进入公式审计；普通教学正文中的公式仍必须通过 LaTeX 校验。
- 检查未被公式定界符包围的上标、下标、根号、求和、积分、比较、近似、正负、乘除、无穷、反应箭头、离子电荷与常见乱码。
- 检查所有公式片段是否能被 KaTeX/MathJax 解析；问题以稳定 JSON 路径返回，只修订对应字符串字段，禁止因公式问题重写整份 JSON。

### 跨端渲染状态

- 网页根节点使用 `data-math-render-state="pending|ready|error"` 表示公式渲染状态。
- PDF 导出只在状态为 `ready` 或确认没有公式时继续打印；状态为 `error` 时导出失败并返回明确中文错误。
- Word 公式缓存键由显示模式与 LaTeX 内容共同组成；输出为透明 PNG，行内公式按正文高度缩放，独立公式居中并限制在正文宽度内。

### 学科规范示例

- 数学：`$f(x)=ax^2+bx+c$`、`$$x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$$`
- 物理：`$\vec{F}=m\vec{a}$`、`$v=\frac{\Delta x}{\Delta t}$`、`$9.8\,\mathrm{m\,s^{-2}}$`
- 化学：`$\ce{2H2 + O2 -> 2H2O}$`、`$\ce{SO4^2-}$`
- 生物：`$Aa\times Aa$`、`$3:1$`、`$\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}$`
- 地理：`$1:50\,000$`、`$30^\circ\mathrm{N}$`、`$\text{实际距离}=\frac{\text{图上距离}}{\text{比例尺}}$`

## 全学科教学图形数据与渲染契约

### `teachingFigures[]`

- `id:string`：讲义内唯一且稳定的图形编号，由 `placement.section + placement.refId` 生成，禁止模型重复 ID 导致结果串位。
- `subject:string`：必须与 `meta.subject` 一致。
- `type:string`：`geometry/function/coordinate/numberline/circuit/force/optics/wave/molecule/reaction/timeline/venn/table/chart/diagram` 之一。
- `title:string`：学生可见图形标题。
- `purpose:string`：说明这张图帮助观察什么，不写抽象包装语。
- `description:string`：面向图形渲染器的精确描述，包含对象、位置、大小、方向、连接、标签与已知关系；禁止答案线索。
- `stem:string`：关联知识点或题目文本，用于图形语义核对。
- `placement:{section,refId}`：`section` 为 `knowledgeDiagrams/keyPoints/visuals/workedExamples/practice/strategyCards/closeReading/mistakes/masteryChecks`；`refId` 对应 `D1/D2`、`K1—K3`、`V1/V2`、`E1/E2`、`P1—P4`、`S1—S3`、`C1—C2`、`X1—X4` 或 `M1—M3`。
- `params:object`：坐标范围、关键点、数据序列、元件或结构参数；只允许有限层级的字符串、数字、布尔值与数组。
- `constraints:string[]`：至少两条可检查的学科规律或连接要求。
- `caption:string`：学生可见读图提示。
- `svg:string`：`pending` 时必须为空；只由专用渲染服务生成并在通过校验后写入，不接受讲义模型直接输出。
- `renderStatus:string`：`pending` 表示等待调度，`generating` 表示同一模型正在精绘，`retrying` 表示本轮未通过后正在自动恢复，`ready` 表示最终 SVG 已通过安全、学科、语义与版面校验。
- `hash:string`：最终 SVG 内容哈希，用于缓存与导出图片命名。
- `visualSignature:string`：忽略文字与颜色后由几何元素和关键坐标形成的主体构图签名，用于跨栏目判重。
- `teachingRole:string`：图形的唯一教学职责，例如 `knowledge-overview`、`knowledge-decision`、`visual-contrast`、`example-1` 或 `practice-4`。

### 图形生成状态流

1. 讲义模型输出图形描述，不输出 SVG。
2. 归一化层优先补齐十个基础图位，再识别重点和其他栏目的显式图形引用；每个位置注入专属教学职责，状态设为 `pending` 且不生成临时 SVG。
3. 结果页先显示稳定尺寸的等待画布，再以同一个 `X-Render-Id` 启动最多五个 `/api/render/figure` 原子任务；任意一张完成即原位展示，不等待其余图形。
4. 图形服务注入 `figure-specs` 的通用、学科和类型约束；单次上游无响应在图形专属时限内中断，并继续使用原模型和完整质量参数自动重试。
5. 只有通过完整根节点、400×300 视口、安全元素、权威学科、标签来源、图元密度、文字边界和碰撞检查的 SVG 才能覆盖规则图。
6. 每张图完成后在会话级临界区实时认领主体几何签名；与已完成图重复的结果必须带冲突图 ID 和栏目职责继续使用同一模型重绘，不能只改标题或颜色。
7. 下载按钮等待所有图形进入 `ready`；PDF 使用讲义中的 SVG，Word 使用 Resvg 转成高清 PNG，待绘状态不得进入导出。

### 安全与质量不变量

- 图形必须含真实几何图元，只有 `<text>` 的结果无效。
- 图形主体不得为空、不得缩在角落，标签必须可读，打印保持白底深线。
- SVG 不得包含脚本、可执行事件、`foreignObject` 或外部资源。
- 函数图必须包含曲线或关键点；电路必须闭合且元件关系可辨；受力图必须有接触面和方向明确的力；其他类型遵守 `src/figure-specs.js`。
- 归一化和导出重新验证图形；在线精绘失败、重复或未通过质量复核时只进入同模型自动重试，不得向网页或导出文件写入本地规则图、临时图或错误学科图。

## 原子化生成与恢复契约

### `POST /api/generate`

- 请求头 `X-Generation-Id:string`：客户端单次点击生成的 UUID；同一次自动重连必须复用，新的用户点击必须重新生成。
- 相同任务键的进行中请求复用同一 Promise；成功结果在内存中短期复用，禁止重复扣费或产生两份内容。
- 服务端生成器首次可恢复失败后自动重新执行；质量复核、公式修订和 JSON 修订仍保持各自严格验收。
- 对外错误不得包含字段路径、模型审计列表或上游堆栈；详细原因只写服务端诊断日志。

### 客户端请求恢复

- 网络异常、408、425、429、500、502、503、504 属于可恢复状态，使用同一请求体和任务键有限退避重连。
- 400/401/403/413/422 等输入或权限错误不得重试。
- 只有当前生成令牌可以提交结果；旧响应不能覆盖用户后续生成。

### 图形原子任务

- 同一轮资料的所有单图请求必须复用同一个 `X-Render-Id`，服务端据此完成跨图实时判重和同图幂等复用。
- `id` 必须与请求稳定 ID 一致；同一会话、同一 ID 和同一图形内容的重连复用进行中任务或已完成结果。
- `svg` 必须是完整、可渲染且语义一致的 SVG；成功时 `renderStatus` 固定为 `ready`。
- `source` 只允许 `cache/ai`，仅用于内部诊断，不改变质量门槛。
- 质量不合格、主体构图重复或上游暂时失败时返回 HTTP 202 与 `renderStatus:retrying`；客户端保持该图的生成状态并继续使用同一模型重试，不得返回本地图，也不把正常质量重绘记成浏览器资源错误。
- `/api/render/figures-batch` 只保留兼容用途，逐项返回 `ready/retrying`；结果页不得再依赖整批响应后统一发布。

## 公式字段修订契约

### 内部修订消息

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `repairs` | array | 是 | 1—24 项 | 只包含本轮公式审计指出的字段 |
| `repairs[].path` | string | 是 | 必须与服务端允许路径完全一致 | 例如 `keyPoints[0].diagnostic.prompt` |
| `repairs[].value` | string | 是 | 非空且保留原语义 | 公式使用 `$...$`、`$$...$$` 或 `\ce{...}` |

不变量：

- 服务端只应用当前审计问题中存在的路径，未知路径、对象字段和数组结构一律拒绝。
- 字段级修订不得修改 ID、资料引用、学科、图形位置或栏目结构。
- 每轮修订后重新审计整份讲义；没有减少问题数量的结果不进入下一状态。
- 对外 `POST /api/generate` 请求与成功响应结构不变。

## 图形学科一致性契约

- `meta.subject` 是 `teachingFigures[].subject`、图形类型识别和 SVG 语义校验的权威学科。
- `teachingFigures[].subject` 在归一化时固定为权威学科，模型返回值不能覆盖。
- 正文关键词只允许在权威学科内部选择细分图形；例如地理正文中的“浮游生物”不能触发生物细胞图。
- SVG 出现与权威学科冲突的强特征标签时无效，例如地理图中的“细胞膜/细胞核/细胞质”。
- `reaction` 纳入正式图形类型；`placement.section` 同时支持 `keyPoints`。
- 图形质量至少检查：可见图元数量、文本标签数量、学科冲突、类型核心结构和安全元素。
- 函数、坐标和统计图必须优先使用 `params` 计算范围、刻度、关键点、柱高与折线；不得用固定数据冒充题目数据。
- 中文标签字符必须能追溯到题意、`params`、`constraints` 或受控教学词汇；题意外造词、错字、文字越界和明显重叠均判为无效。
- 跨学科冲突以多个结构标签共同出现为证据，单个交叉学科术语不能直接判错。
- 图形职责固定为：D1 完整全景、D2 判断路径、V1 易混对照、V2 过程变化、E/P 独立题设；K/S/C/X/M 只服务对应栏目。
- 固定十个图位优先级高于额外重点图，任何情况下不得因总量截断丢失 P4。
- `refId` 必须匹配当前 section 的前缀和连续序号；模型返回中文标题或错误前缀时，按该 section 在数组中的局部顺序纠正，禁止保留孤儿图。
- 图形完整性审计使用经过 placement 补齐的临时材料；只补图形契约，不填补空学科、空知识地图或其他正文缺陷。
- 批量接口每次差异化重绘后重新计算 `visualSignature`；最多三轮仍冲突时使用对应 `teachingRole` 的规范结构，最终响应不得含重复签名。

## AI 瞬时错误重试契约

- 主讲义生成、JSON 修复和公式字段修订对网络超时、429、500、502、503、504 最多尝试 3 次。
- 重试间隔按 350ms、700ms 退避；非瞬时错误、鉴权错误和内容质量错误不进入网络重试。
- 图形精绘使用独立的三轮质量反馈重绘，每轮只发起一次网关请求，避免重试次数相乘。
- 所有尝试失败后返回明确错误，不返回本地拼接讲义、示例讲义或缺失栏目结果。

## PDF 与 Word 版面契约

### PDF 打印模型

| 项目 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| 页面 | A4 纵向 | 是 | 统一页边距，正文不得进入页边距 | 由最终导出打印样式控制 |
| 内容来源 | `StudyMaterial` | 是 | 与网页结果页为同一份完整数据 | 不压缩栏目 |
| 阅读流 | 单列文档流 | 是 | 大型模块允许自然跨页 | 避免嵌套网格分页碎片化 |
| 原子块 | 标题首段、短提示块、表格行、图题组合 | 是 | 在单页可容纳时不得拆分 | 超过单页时必须允许自然分页 |
| 交互内容 | 展开后的静态内容 | 是 | 隐藏按钮、目录和工具栏 | 答案与诊断必须可见 |
| 公式与图形 | KaTeX、最终 SVG | 是 | 不裁切、不横向溢出 | 只接收完整状态 |

### Word 文档模型

| 项目 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| 设计预设 | `compact_reference_guide` | 是 | 只允许 A4 学习报告命名覆盖 | 禁止混用其他预设 |
| 页面 | A4 纵向 | 是 | 显式页边距、页眉和页脚距离 | 不依赖 Word 默认值 |
| 正文 | 微软雅黑 10.5pt | 是 | 统一段后距和约 1.45 倍行距 | 长文保持可连续阅读 |
| 一级标题 | 20pt | 是 | 连续文档流，与首段保持 | 四大章节自然续排，封面后单独分页 |
| 二级标题 | 14pt | 是 | 与下一内容保持，不孤立 | 栏目标题使用 |
| 三级标题 | 12pt | 是 | 统一颜色和间距 | 内容单元使用 |
| 列表 | Word 编号定义 | 是 | 显式缩进、悬挂和段距 | 禁止文本字符模拟项目符号 |
| 表格 | 固定 DXA | 是 | `tblW`、`tblInd`、`tblGrid`、`tcW` 一致 | 行不得设置固定高度 |
| 图形 | 4:3 PNG | 是 | 与图题、说明保持，宽度不超过正文 | 来源为最终 SVG |
| 页眉页脚 | 安静型 | 是 | 不与正文竞争，页码可读 | 首页可与后续页一致 |

不变量：

- 两种导出均按“学习导航 → 重点与方法 → 例题与练习 → 掌握与复习”输出完整报告。
- 导出不得包含网页按钮、等待提示、资料索引、内部锚点、旧品牌或生成过程状态。
- 任何模块不得因防拆分规则而覆盖相邻内容；当模块高于单页可用高度时，必须允许内部自然分页。
- PDF 与 Word 的标题、正文、公式、图形和答案顺序必须与网页报告的内容顺序一致。

### Word 原生公式契约

| 输入语义 | DOCX 表示 | 必需 | 验证规则 |
|----------|-----------|------|----------|
| 普通正文 | `w:r/w:t` | 是 | 保持可编辑文本，不包含公式定界符 |
| 行内公式 | `m:oMath` | 是 | 与前后正文处于同一 `w:p`，字符可回读 |
| 独立公式 | `m:oMath` | 是 | 段落居中，结构完整且可编辑 |
| 分式/根式 | `m:f` / `m:rad` | 按内容 | 分子、分母、被开方数与根指数不得丢失 |
| 上下标 | `m:sSub` / `m:sSup` / `m:sSubSup` | 按内容 | 数学指数、化学角标、电荷和单位指数均使用结构节点 |
| 求和/积分 | `m:nary` | 按内容 | 运算符、上下限与主体内容可分别编辑 |
| 极限 | `m:limLow` / `m:limUpp` | 按内容 | 极限条件不得展平成普通图片或丢失 |
| 向量/重音 | `m:acc` | 按内容 | 箭头、横线、帽号与主体绑定 |
| 矩阵/方程组 | `m:m` | 按内容 | 行列数与单元格顺序保持一致 |
| 教学 SVG 图形 | `w:drawing` PNG | 按图形 | 仅图形允许图片；不得与公式混用 |

不变量：

- Word 公式不得使用 `ImageRun`、媒体关系、原始 LaTeX 或公式截图。
- 同一 LaTeX 语义树只生成一个 `m:oMath`；正文前后文本仍为普通可编辑文本。
- 任一公式无法完成结构转换时，整个 DOCX 导出失败并返回可定位的公式错误，不得降级成图片或线性占位文本。
- 数学、物理、化学、生物和地理共用同一转换器，禁止按学科编写孤立替换规则。
- DOCX 导出完成后必须回读 `word/document.xml`，校验公式数量、关键结构和禁用的公式图片路径。

跨学科验收基线：

- 确定性夹具应产生 70 个 `m:oMath`，覆盖分式、根式、上下标、求和、积分、极限、向量、重音、矩阵、分段函数、化学式、电荷和经纬度。
- 含教学图形的验收文件允许存在教学图形媒体；公式本身不得增加任何媒体文件或图片关系。
- 知识地图使用 Word 原生固定表格表达节点关系，节点中的公式继续使用 OMML，不得把知识地图整体栅格化。
- WPS 回读必须支持双击公式进入编辑状态；转换 PDF 后不得出现空公式、问号、原始 LaTeX、裁切或重叠。

### 图形渲染请求示例

```json
{
  "subject": "地理",
  "figureType": "diagram",
  "stem": "寒暖流交汇形成渔场",
  "description": "冷暖洋流交汇、营养盐上涌、浮游生物增加、鱼群聚集",
  "params": {},
  "constraints": ["冷暖流方向清楚", "不得出现其他学科结构图"]
}
```
