# K12 教辅资料生成器契约

## 配置项

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `PORT` | number | 否 | 1-65535 | 本地服务端口，默认 `5173` |
| `MAT_IMAGE_CONCURRENCY` | number | 否 | 1-4 | 批量生成并发数，默认 `2` |
| `MAT_IMAGE_MAX_ATTEMPTS` | number | 否 | 固定为 `1` | 纯提示词单张生图只执行一次模型操作 |
| `MAT_IMAGE_TIMEOUT_MS` | number | 否 | 120000-1800000 | 纯提示词单张生图本地等待上限，默认 `900000` |
| `MAT_FIXED_LAYOUT_CONCURRENCY` | number | 否 | 1-4 | 固定排版模式下，第 1 张母版之后的后续页并发数，默认 `3` |
| `MAT_IMAGE_REFERENCE_TIMEOUT_MS` | number | 否 | 120000-1800000 | 参考图生成本地等待上限，默认跟随 `MAT_IMAGE_TIMEOUT_MS` |
| `MAT_IMAGE_REFERENCE_MAX_ATTEMPTS` | number | 否 | 固定为 `1` | 参考图单张生图只执行一次模型操作 |
| `RULE_TIMEOUT_MS` | number | 否 | 120000-1800000 | 生成规则确认本地等待上限，默认跟随参考图等待上限 |
| `RULE_MAX_ATTEMPTS` | number | 否 | 1-3 | 生成规则确认最大尝试次数，默认 `2` |

生成成功的图片会先保存到 `public/generated/<batchId>/`，接口返回 `/generated/...` 本地图片地址。

AI 接口配置只保存到 `data/ai-config.json`。当对应接口池为空时，该 AI 功能不可用；`.env` 不承载 URL、MODEL 或 APIKEY。

## `data/app-state.json`

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `version` | number | 是 | 当前为 `1` | 应用状态结构版本 |
| `users` | array | 是 | 本地用户数组 | 保存账号、密码哈希、角色和积分余额 |
| `sessions` | array | 是 | 登录会话数组 | 通过 HTTP-only Cookie 关联用户 |
| `redeemCodes` | array | 是 | 积分兑换卡密数组 | 管理员生成，用户兑换 |
| `pointLogs` | array | 是 | 积分流水数组 | 记录预扣、退款、兑换和管理员调整 |
| `generationBatches` | array | 是 | 生成批次数组 | 记录每次正式生图的扣退结果 |

`users[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `id` | string | 是 | UUID | 用户标识 |
| `username` | string | 是 | 3-40 位 | 登录账号 |
| `passwordHash` | string | 是 | scrypt 哈希 | 不保存明文密码 |
| `salt` | string | 是 | 非空 | 密码哈希盐 |
| `role` | string | 是 | `admin`/`user` | 首个注册用户自动为 `admin` |
| `points` | number | 是 | 非负整数 | 当前积分余额 |
| `createdAt` | string | 是 | ISO 时间 | 创建时间 |
| `updatedAt` | string | 是 | ISO 时间 | 更新时间 |

`generationBatches[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `id` | string | 是 | UUID | 批次标识 |
| `userId` | string | 是 | 已存在用户 | 发起生成的用户 |
| `reservedPoints` | number | 是 | 正整数 | 正式生图前预扣积分 |
| `successCount` | number | 是 | 非负整数 | 成功图片数 |
| `failedCount` | number | 是 | 非负整数 | 未成功图片数 |
| `refundedPoints` | number | 是 | 非负整数 | 已退回积分 |
| `status` | string | 是 | `running`/`done`/`failed`/`canceled` | 批次状态 |
| `type` | string | 是 | `batch`/`retry` | 整批生成或单张重试 |
| `createdAt` | string | 是 | ISO 时间 | 创建时间 |
| `lastActivityAt` | string | 是 | ISO 时间 | 最近生成结果或结算活动时间 |
| `finishedAt` | string | 否 | ISO 时间 | 结算时间 |
| `lastError` | string | 否 | 最多 500 字符 | 最近一张最终失败的真实错误摘要 |

`running` 批次从 `lastActivityAt` 起超过 60 分钟仍未完成时视为孤儿批次。Worker 下一次加载状态时必须将其结算为 `failed`，仅退回未进入 `successIndexes` 的图片积分，并记录自动回收原因。生成队列、取消接口与积分批次必须共享同一个 `batchId`。

`pointLogs[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `id` | string | 是 | UUID | 流水标识 |
| `userId` | string | 是 | 已存在用户 | 积分归属用户 |
| `type` | string | 是 | `generation_reserve`/`generation_refund`/`redeem`/`admin_adjust` | 流水类型 |
| `points` | number | 是 | 非零整数 | 正数增加，负数扣减 |
| `balanceAfter` | number | 是 | 非负整数 | 本次变动后的余额 |
| `batchId` | string | 否 | UUID | 关联生成批次 |
| `imageIndex` | number/null | 否 | 从 0 开始 | 失败退款对应图片序号 |
| `status` | string | 是 | 非空 | 记录状态 |
| `note` | string | 否 | 最多 300 字符 | 说明 |
| `createdAt` | string | 是 | ISO 时间 | 创建时间 |

`redeemCodes[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `id` | string | 是 | UUID | 卡密标识 |
| `code` | string | 是 | 分组大写卡密 | 用户兑换时可忽略横线 |
| `points` | number | 是 | 正整数 | 兑换后增加积分 |
| `status` | string | 是 | `unused`/`used`/`void` | 卡密状态 |
| `createdAt` | string | 是 | ISO 时间 | 创建时间 |
| `usedAt` | string | 否 | ISO 时间 | 使用时间 |
| `usedBy` | string | 否 | 用户 ID | 使用人 |
| `createdBy` | string | 否 | 管理员 ID | 创建人 |

## `data/ai-config.json`

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `version` | number | 是 | 当前为 `1` | 配置结构版本 |
| `rule.entries` | array | 是 | 最多 24 个接口 | 生成规则确认接口池 |
| `image.resolution` | string | 是 | `4k`/`standard` | AI 生图分辨率档位 |
| `image.entries` | array | 是 | 最多 24 个接口 | AI 生图接口池 |

`entries[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `baseUrl` | string | 是 | `http`/`https` URL | OpenAI 兼容接口基础地址，例如 `https://api.example.com/v1` |
| `model` | string | 是 | 非空 | 模型名称 |
| `apiKeys` | array | 是 | 1-60 个字符串 | 同一 URL 下的 KEY 池，服务端轮询使用 |

示例：

```json
{
  "version": 1,
  "rule": {
    "entries": [
      {
        "baseUrl": "https://rule.example.com/v1",
        "model": "gpt-4.1-mini",
        "apiKeys": ["key-a", "key-b"]
      }
    ]
  },
  "image": {
    "resolution": "4k",
    "entries": [
      {
        "baseUrl": "https://image.example.com/v1",
        "model": "gpt-image-2",
        "apiKeys": ["key-a"]
      }
    ]
  }
}
```

## 认证与积分接口

## `POST /api/auth/register`

注册账号。首个注册账号自动成为管理员，其余账号为普通用户。成功后写入 HTTP-only Cookie。

请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `username` | string | 是 | 3-40 位 | 中文、字母、数字、`_`、`@`、`.`、`-` |
| `password` | string | 是 | 6-72 位 | 明文只在请求中出现，服务端保存哈希 |

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 是否成功 |
| `user` | object | 是 | 公共用户对象 | 不包含密码哈希 |
| `setupAdminCreated` | boolean | 是 | - | 本次注册是否创建首个管理员 |

## `POST /api/auth/login`

登录账号，成功后写入 HTTP-only Cookie。请求字段同注册接口。

## `POST /api/auth/logout`

退出当前登录态，清除会话 Cookie。

## `GET /api/auth/me`

读取当前登录状态。

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 是否成功 |
| `authenticated` | boolean | 是 | - | 是否已登录 |
| `setupRequired` | boolean | 是 | - | 是否还没有任何用户 |
| `user` | object/null | 是 | - | 当前用户 |

## `POST /api/points/redeem`

用户兑换积分卡密，需登录。

请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `code` | string | 是 | 非空 | 可带或不带横线 |

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 是否成功 |
| `points` | number | 是 | 非负整数 | 兑换后的余额 |
| `redeemedPoints` | number | 是 | 正整数 | 本次兑换积分 |
| `user` | object | 是 | 公共用户对象 | 最新用户信息 |

## `GET /api/points/logs`

读取当前用户自己的积分流水，需登录。

## `GET /api/admin/points/overview`

管理员读取积分管理后台数据，需管理员登录。响应包含 `summary`、`users`、`logs`、`batches`、`redeemCodes`。

## `POST /api/admin/points/redeem-codes`

管理员生成积分兑换卡密。

请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `points` | number | 是 | 1-100000 | 每张卡密可兑换积分 |
| `count` | number | 是 | 1-200 | 生成数量 |

## `POST /api/admin/points/adjust`

管理员直接调整用户积分。

请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `username` | string | 是 | 已存在用户 | 目标账号 |
| `mode` | string | 是 | `add`/`set` | 增减或设置为固定值 |
| `points` | number | 是 | 整数 | `add` 可为负，`set` 必须非负 |
| `note` | string | 否 | 最多 120 字符 | 管理备注 |

## `GET /api/health`

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 服务是否可响应 |
| `configured` | boolean | 是 | - | 是否已配置图片生成密钥 |
| `model` | string | 是 | 可为空 | 当前 AI 生图模型名称；未配置时为空字符串 |
| `ruleConfigured` | boolean | 是 | - | 是否已配置生成规则确认密钥 |
| `ruleModel` | string | 是 | 可为空 | 当前生成规则确认模型名称；未配置时为空字符串 |
| `imageResolution` | string | 是 | `4k`/`standard` | 当前 AI 生图分辨率档位 |

示例响应：

```json
{
  "ok": true,
  "configured": false,
  "model": "",
  "ruleConfigured": false,
  "ruleModel": "",
  "imageResolution": "4k"
}
```

## `GET /api/admin/ai-config`

读取 AI 配置后台数据，必须使用管理员账号登录。

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 请求是否成功 |
| `config.version` | number | 是 | 当前为 `1` | 配置版本 |
| `config.rule.entries` | array | 是 | 后台保存的接口池 | 生成规则确认唯一接口池 |
| `config.image.resolution` | string | 是 | `4k`/`standard` | 生图分辨率档位 |
| `config.image.entries` | array | 是 | 后台保存的接口池 | AI 生图唯一接口池 |

## `PUT /api/admin/ai-config`

保存 AI 配置后台数据。请求体结构同 `data/ai-config.json`，也允许省略 `version`。空接口池表示对应 AI 功能不可用。

校验规则：

- `baseUrl` 必须是 `http` 或 `https` URL。
- 非空接口必须同时具备 `baseUrl`、`model` 和至少 1 个 `apiKeys`。
- `apiKeys` 会去重、去空行并限制单个接口最多 60 个。
- 保存成功后，后续 AI 请求立即使用新配置。

## `POST /api/generation-rule`

生成规则确认接口，需登录。服务端先读取提示词、知识库文件和参考风格图，返回推荐数量和页面规划，不生成图片，也不扣积分。

请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `prompt` | string | 是 | 1-2000 字符 | 老师输入的核心提示词；仅空内容无效，不设置最少字数 |
| `count` | number | 否 | 1-120 的整数 | 本次希望生成的图片数量；留空时由 AI 自动判断 |
| `materialType` | string | 否 | 最多 40 字符 | 教辅资料类型 |
| `scenario` | string | 否 | 最多 40 字符 | 使用场景 |
| `aspectRatio` | string | 否 | `16:9`/`9:16`/`4:3`/`3:4`/`1:1`/`custom` | 图片比例；前端“与参考图比例一致”会转换为 `custom` |
| `customAspectRatio` | string | 否 | 比例格式 | 自定义图片比例 |
| `options.layoutFixed` | boolean | 否 | - | 是否固定排版 |
| `knowledgeFiles` | array | 否 | 支持的知识库文件 | PDF、Word、图片和文本等 |
| `styleReferenceImages` | array | 否 | 最多 4 张 | 参考风格图对象数组；前端可附带宽高用于比例换算 |

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 请求是否成功 |
| `count` | number | 是 | 1-120 的整数 | 最终确认的生成数量 |
| `rule` | object | 是 | - | 生成规则 |
| `batchItems` | array | 是 | 长度等于 `count` | 后续生图逐张使用的页面规则文本 |

`rule` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `count` | number | 是 | 1-120 的整数 | 最终确认的生成数量 |
| `recommendedCount` | number | 是 | 1-120 的整数 | 推荐生成数量 |
| `countReason` | string | 否 | 非空 | 数量判断理由 |
| `evidence` | object | 是 | 知识库证据结构 | 服务端读取到的内容证据；只用于内容识别和来源定位，不得作为数量硬锚点 |
| `knowledgeBlueprint` | object | 是 | 知识库蓝图结构 | 服务端从知识库证据中抽取的真实内容锚点；正式生图必须按单张锚点接地 |
| `intentAnalysis` | string | 否 | 非空 | AI 对用户任务意图、目标读者、成品类型和覆盖边界的理解 |
| `countStrategy` | string | 否 | 非空 | 从内容簇数量、单张可读性、拆分合并和用户目标推导数量的完整逻辑 |
| `summary` | string | 是 | 非空 | 整体生成意图理解 |
| `contentLogic` | string | 是 | 非空 | 内容拆分、合并、去重和排序逻辑 |
| `contentProductionStrategy` | string | 否 | 非空 | 后续图片如何保留知识库条目并改写成可读内容成品 |
| `layoutLogic` | string | 是 | 非空 | 整批版式组织规则 |
| `styleLogic` | string | 是 | 非空 | 参考风格复刻规则 |
| `styleAdvice` | string | 否 | 非空 | 针对本次资料类型的视觉建议和信息架构建议 |
| `contentInventory` | array | 否 | 最多 120 项 | AI 对知识库内容的全量盘点，按主题层级列出具体内容项 |
| `contentUnits` | array | 否 | 字符串数组 | AI 识别出的章节、知识点、题型或教学任务单元 |
| `contentHierarchy` | array | 否 | 字符串数组 | AI 梳理的一级主题、二级主题、具体内容单元以及生成/合并/舍弃决策 |
| `coverageMap` | array | 否 | 字符串数组 | 用户目标或知识库内容点到具体生成图片的覆盖映射 |
| `coverageChecklist` | array | 否 | 最多 80 项 | 确认知识库内容点已被覆盖的检查清单 |
| `coverageAudit` | array | 否 | 最多 80 项 | 内容盘点项到页面规划的覆盖审计 |
| `riskNotes` | array | 否 | 最多 30 项 | 可能遗漏、合并或不生成的内容说明 |
| `pages` | array | 是 | 长度等于 `count` | 逐张页面规划 |

`rule.knowledgeBlueprint` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `intent` | string | 否 | 最多 800 字符 | 基于用户提示词和知识库证据理解到的本次生成目标 |
| `sourceSummaries` | array | 否 | 最多 40 项 | 知识库文件、页面截图或图片证据摘要 |
| `anchors` | array | 是 | 最多 120 项 | 可用于逐张生图的真实知识库内容锚点 |
| `uncertaintyNotes` | array | 否 | 最多 40 项 | 无法可靠读取或不能确定的内容说明，不得进入确定性生图内容 |

`rule.knowledgeBlueprint.anchors[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `title` | string | 是 | 最多 120 字符 | 内容锚点标题 |
| `content` | string | 是 | 最多 420 字符 | 知识库中真实出现或可从截图可靠转写的具体内容 |
| `mustInclude` | array | 否 | 最多 16 项 | 后续图片必须出现的具体词、题型、数字、步骤或内容项 |
| `source` | string | 否 | 最多 220 字符 | 文件名、页码、截图位置等证据来源；只作定位，不作数量依据 |
| `confidence` | string | 是 | `high`/`medium`/`low` | 对该锚点可读性和真实性的置信度 |

`rule.pages[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `index` | number | 是 | 从 0 开始 | 页面序号 |
| `title` | string | 是 | 非空 | 本张标题方向 |
| `focus` | string | 是 | 非空 | 本张核心内容 |
| `sourceLogic` | string | 否 | - | 内容整理依据；页码只可作为来源证据，不可作为排序依据 |
| `mustInclude` | array | 否 | 字符串数组 | 本张必须包含的信息 |
| `avoid` | array | 否 | 字符串数组 | 本张不要混入的内容 |
| `knowledgeAnchorIndex` | number | 是 | -1 或锚点下标 | 本张绑定的 `knowledgeBlueprint.anchors[]` 下标 |
| `knowledgeAnchor` | object/null | 否 | 同 `anchors[]` 结构 | 本张最终生图必须围绕的知识库真实内容锚点 |

`rule.evidence` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `totalPages` | number | 是 | 非负整数 | 知识库 PDF 来源页数统计；仅作来源定位和读取说明，不参与数量决策 |
| `totalTextChars` | number | 是 | 非负整数 | 从知识库提取的文本字符数 |
| `estimatedContentUnits` | number | 是 | 0-120 | 服务端基于标题、文本密度和显式内容线索估算的兜底参考；不暴露给 AI 作为推荐张数锚点 |
| `knowledgeImageCount` | number | 是 | 非负整数 | 用户上传的图片型知识库数量；只表示内容证据数量 |
| `pdfPageImageCount` | number | 是 | 非负整数 | 规则确认阶段附给 AI 分析的 PDF 页面截图数量；不参与推荐数量 |
| `pdfPageImageLimit` | number | 是 | 当前为 60 | 单次规则确认最多渲染的 PDF 页面截图上限 |
| `files` | array | 是 | 文件证据数组 | 每个知识库文件的文本量、标题线索、截图样本和来源定位摘要 |

`rule.evidence.files[]` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `name` | string | 是 | 非空 | 知识库文件名 |
| `pageCount` | number | 是 | 非负整数 | PDF 来源页数；仅作来源定位 |
| `textChars` | number | 是 | 非负整数 | 该文件提取到的文本字符数 |
| `headingCount` | number | 是 | 非负整数 | 标题、章节或编号线索数量 |
| `estimatedUnits` | number | 是 | 0-120 | 该文件基于文本、标题和显式线索估算的兜底内容线索数；图片型知识库可为 0 |
| `renderedPageCount` | number | 是 | 非负整数 | 规则确认阶段渲染的 PDF 页面截图数量；只用于内容识别 |
| `sampledPages` | array | 是 | 正整数数组 | 被渲染用于分析的 PDF 来源页码；只作来源定位 |
| `note` | string | 否 | 非空 | 人类可读证据摘要 |

## `POST /api/generate`

兼容同步生成接口，需登录。服务端在正式生图前按本次生成张数预扣积分，成功图片会先保存到本地，再汇总返回；失败图片按张退回积分。

请求：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `prompt` | string | 是 | 1-2000 字符 | 老师输入的核心提示词；仅空内容无效，不设置最少字数 |
| `count` | number | 是 | 1-120 的整数 | 本次生成数量 |
| `grade` | string | 否 | 最多 40 字符 | 学段或年级 |
| `subject` | string | 否 | 最多 40 字符 | 学科 |
| `materialType` | string | 否 | 最多 40 字符 | 教辅资料类型 |
| `scenario` | string | 否 | 最多 40 字符 | 使用场景 |
| `size` | string | 否 | 允许值集合 | 图片尺寸 |
| `quality` | string | 否 | `low`/`medium`/`high`/`auto` | 图片质量 |
| `options` | object | 否 | 布尔字段 | 兼容旧请求的显示偏好；默认不再主动强化打印、答案区或低墨量倾向 |
| `referenceImages` | array | 否 | 最多 4 张 | 参考图对象数组 |
| `targetIndex` | number | 否 | 0 到 `count - 1` | 只重新生成指定位置的单张图片 |
| `batchItems` | array | 否 | 长度等于 `count` | 单张重试时沿用的批次内容分配 |
| `layoutReferenceImage` | string | 否 | `/generated/...` | 固定排版后续页单张重试时使用的第 1 张母版图 |
| `generationRule` | object | 否 | `/api/generation-rule` 返回结构 | 已确认的生成规则；包含完整知识库蓝图时可替代正式生成阶段重复上传原始知识库 |
| `styleReferenceProvided` | boolean | 否 | - | 正式生图阶段是否存在已由规则阶段确认的参考风格图 |
| `styleReferenceCount` | number | 否 | 0-4 | 已确认的参考风格图数量 |
| `styleReferenceImages` | array | 否 | 最多 4 张 | 规则确认阶段可携带原图；正式生图已有 `generationRule` 时必须省略原始图片字节 |

前端在用户点击“生成教辅图片”后默认自动调用 `/api/generation-rule` 获得最终数量和页面规则，再把 `generationRule`、`batchItems` 和最终 `count` 传入正式生成请求。规则确认按钮和规则结果不作为默认前端界面展示。未提供规则时，服务端仍保留基于提示词的兜底拆分。

正式生成前，服务端会再次校验知识库接地关系。当前端传回的 `generationRule` 已包含完整 `knowledgeBlueprint`、同等数量的 `pages[].knowledgeAnchor` 和 `batchItems` 时，正式请求允许省略 `knowledgeFiles`，服务端直接复用已确认蓝图进入生图；任一接地字段缺失时，前端必须继续上传原始 `knowledgeFiles`，服务端重新抽取或兜底生成蓝图并绑定每张图。

Cloudflare Worker 与本地 Node 服务在正式生成阶段只接收 `styleReferenceProvided`、`styleReferenceCount` 和已确认规则，不再重复上传参考图 Base64。参考图分析由 `/api/generation-rule` 既有规划请求完成，正式生成直接复用 `layoutLogic`、`styleLogic` 和 `styleAdvice` 注入 `/images/generations`，不得在用户确认后再调用一次规则/视觉模型。

Cloudflare Worker 单张生图请求及完整响应体读取最多等待 15 分钟，与本地 Node 服务默认值一致。带参考风格图和普通无参考图的批次都继续使用并发生成，以充分利用上游多并发能力。

Cloudflare Worker 与本地 Node 服务请求 `/images/generations` 时默认在原 JSON 请求中附加 `stream:true`、`partial_images:1`，并接收 `text/event-stream`：

- `image_generation.partial_image`：中间图片事件；HTTP(S) URL 可以转换为轻量 `preview`；Base64 只作为服务端候选产物，不发送巨型 data URL。
- `image_generation.completed`：最终图片事件，必须包含可识别的 `b64_json` 或图片 URL，作为正式结果保存。
- `[DONE]`、正常结束或异常断流：优先使用 completed；若已有可识别 partial，则使用最后一张 partial 保存并完成本次请求，不得重复整轮模型调用；没有产物时返回可诊断失败。
- 未携带标准事件名、但 `data:` 中包含可识别图片的兼容 SSE 事件，缓存最后一张并等待 `[DONE]` 或 EOF；不得把第一张中间图误当最终结果，也不得因协议字段缺失忽略产物。
- 上游以 `400/422` 明确表示 `stream` 或 `partial_images` 不受支持时，当次请求移除这两个字段并回退同步 JSON；其他 `4xx/5xx/524` 不得借此回退或修改模型参数。

当 `image.resolution` 为 `4k` 时，服务端会按图片比例计算严格 `size`。所有分辨率遇到 `502/503/504/524`、超时、断流或截断响应都属于结果未知，不自动重复模型调用，也不改用 `size:auto`；4K 提示词仍要求高清清晰度。

`referenceImages` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `name` | string | 否 | 最多 120 字符 | 文件名 |
| `mimeType` | string | 是 | `image/png`/`image/jpeg`/`image/webp` | 图片类型 |
| `dataUrl` | string | 是 | base64 data URL | 浏览器压缩后的图片 |
| `width` | number | 否 | 正整数 | 前端记录的图片宽度，用于“与参考图比例一致” |
| `height` | number | 否 | 正整数 | 前端记录的图片高度，用于“与参考图比例一致” |

示例请求：

```json
{
  "prompt": "设计一张三年级语文《荷花》课文预习单，包含词语、朗读和观察任务。",
  "count": 2,
  "grade": "三年级",
  "subject": "语文",
  "materialType": "预习单",
  "scenario": "课前预习",
  "size": "1024x1536",
  "quality": "high",
  "options": {
    "printFriendly": false,
    "answerSpace": false,
    "lowInk": false
  },
  "referenceImages": []
}
```

响应：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `ok` | boolean | 是 | - | 请求是否完成 |
| `results` | array | 是 | 长度等于请求数量 | 每张图的结果 |
| `summary` | object | 是 | - | 成功和失败数量 |

`results` 对象：

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `id` | string | 是 | UUID | 结果标识 |
| `index` | number | 是 | 从 0 开始 | 批次序号 |
| `status` | string | 是 | `ok`/`error` | 单张结果状态 |
| `item` | string | 否 | - | 批量生成中本张专属内容 |
| `image` | string | 否 | `/generated/...` URL | 已保存的生成图片 |
| `storedImage` | string | 否 | `/generated/...` URL | 已持久化图片地址；未保存时为空 |
| `saving` | boolean | 否 | - | 是否仍在持久化 |
| `error` | string | 否 | 非空 | 失败原因 |
| `failureStage` | string | 否 | `image_persistence` 等 | 明确失败阶段 |
| `persistenceFailed` | boolean | 否 | - | 模型已有产物，但图片持久化失败 |
| `preserveLocalPreview` | boolean | 否 | - | 服务端已完成预览下发，前端有本地副本时必须保留 |
| `timing` | object | 否 | 毫秒值非负 | 模型、持久化和总耗时 |

示例响应：

```json
{
  "ok": true,
  "results": [
    {
      "id": "0b8d4a67-1f3d-4d27-8f58-6d3842f113a1",
      "index": 0,
      "status": "ok",
      "item": "",
      "image": "/generated/9d2a.../01-f3c1....png"
    }
  ],
  "summary": {
    "success": 1,
    "failed": 0
  }
}
```

## `POST /api/generate/stream`

前端默认使用的流式生成接口，需登录。服务端在正式生图前按本次生成张数预扣积分；HTTP(S) URL 通过轻量 `preview` 发送，Base64 通过 48 KiB 分块协议在持久化并行期间送达浏览器，浏览器组装临时 Blob 后立即展示；批次结束后按失败张数退回积分。

当请求包含 `targetIndex` 时，接口只生成对应位置的一张图片；前端用该结果替换原失败卡片，不影响其他已成功图片。

长时间生图期间服务端会持续发送 `heartbeat` 事件保持连接，避免本地连接先于图片模型完成而被误判失败。

响应 `Content-Type`：`application/x-ndjson; charset=utf-8`

事件：

| `type` | 字段 | 备注 |
|------|------|------|
| `start` | `count`、`points`、`timing` | 开始生成；不重复发送可能过大的 `batchItems`；`timing.preflightMs` 记录请求进入 Worker 到模型可派发的耗时 |
| `preview` | `result` | 仅用于有限长度的 HTTP(S) 临时 URL；禁止 data URL 和 `b64_json` |
| `preview_start` | `result.id/index/item/mimeType/totalChunks` | 声明一张 Base64 分块预览，`totalChunks` 为正整数 |
| `preview_chunk` | `id`、`index`、`sequence`、`data` | 按 0 基连续序号发送；`data` 最多 48 KiB，且是唯一允许携带 Base64 的事件字段；前端兼容 URL-safe 字符和末块无填充格式，非末块必须四字符对齐 |
| `preview_end` | `id`、`index` | 完成同一图片的分块传输，前端校验完整后创建 Blob URL |
| `result` | `result` | 单张结果，结构同 `/api/generate`；`result.timing` 区分模型耗时和持久化耗时 |
| `heartbeat` | `at` | 长任务保活事件，前端忽略即可 |
| `done` | `summary` | 仅未取消批次的成功终态；实际写入时必须再次检查取消状态，`summary.points` 包含预扣、成功、失败、退款和最新余额 |
| `error` | `message` | 批次级失败或取消终态；已返回的单张结果仍应保留；取消批次不得再发送 `done` |

Base64 分块事件示例：

```ndjson
{"type":"preview_start","result":{"id":"7f...","index":0,"item":"第1张","status":"ok","saving":true,"mimeType":"image/png","totalChunks":1}}
{"type":"preview_chunk","id":"7f...","index":0,"sequence":0,"data":"iVBORw0KGgo..."}
{"type":"preview_end","id":"7f...","index":0}
{"type":"result","result":{"id":"7f...","index":0,"status":"ok","image":"/generated/batch/01.png","storedImage":"/generated/batch/01.png","saving":false}}
```

持久化失败但浏览器已有完整预览时，最终结果保持服务端失败语义并触发退款，前端将其映射为“仅本地”可用结果：

```ndjson
{"type":"result","result":{"id":"7f...","index":0,"status":"error","failureStage":"image_persistence","persistenceFailed":true,"preserveLocalPreview":true,"error":"图片持久化失败"}}
```

## 不变量

- `count` 永远不能超过 120。
- `referenceImages` 永远不能超过 4 张。
- 前端提示词输入框默认值必须为空，占位提示为“请填写你的需求，用大白话即可，越具体效果越好”
- 提示词为生成前必填项；仅在去除首尾空白后为空时阻止流程并提示用户填写，任何非空内容均可继续。
- 生成规则确认阶段必须显示居中遮罩进度层，主文案为“正在智能规划内容，制定出图计划，请稍等”。
- 前端默认 `printFriendly=false`、`answerSpace=false`、`lowInk=false`，不得默认加入练习题、作答区、答案区或固定可打印模板。
- 用户只需点击“生成教辅图片”；前端必须在后台先完成生成规则确认，再正式生图。
- 用户必须登录后才能调用生成规则确认和正式生图接口。
- 生成规则确认阶段不扣积分；正式生图阶段按 1 张图片 1 积分预扣，失败或未返回成功结果的图片必须退回对应积分。
- 用户端不得展示 AI 配置后台入口；AI 配置和积分管理接口必须校验管理员账号。
- 当用户选择“与参考图比例一致”时，前端必须已读取参考风格图宽高，并把比例转换为 `aspectRatio=custom` 与 `customAspectRatio`。
- 生成规则确认返回的 `batchItems` 长度必须等于 `count`。
- 生成规则确认必须先抽取 `knowledgeBlueprint.anchors[]`，再做数量决策和逐张规划；锚点只能来自知识库证据和用户提示词，不得编造外部内容。
- 生成规则确认不得把“不要遗漏”“参考风格一样”等执行要求当成页面主题。
- 生成规则确认的数量决策必须内容优先：必须先理解用户当次任务意图、目标、目标读者、成品类型、知识库整体内容和主题层级，再按章节、知识点、题型、练习组、图表和教学任务决定数量。
- 生成规则确认必须输出可审查的 `contentInventory`、`countStrategy`、`contentProductionStrategy`、`styleAdvice` 和 `coverageAudit`；这些字段要体现先盘点、再拆分合并、再逐张规划的过程。
- 对高密度资料，`recommendedCount` 必须考虑单张图片可读性和记忆负荷；一张源文件页可拆成多张图，多张源文件页也可合并为一个知识簇。
- 原文件页数、PDF 页数、截图数量、上传图片数量、文件数量和抽样页码不得参与 `recommendedCount` 决策，不得作为硬下限，也不得机械一页对应一张图。
- 当 AI 返回有效 `recommendedCount` 或同等长度 `pages[]` 时，服务端不得用本地估算覆盖 AI 的内容规划；只有缺少有效数量或页面规划时才允许按文本、标题和显式内容线索兜底。
- `intentAnalysis`、`contentHierarchy`、`coverageMap`、`contentInventory`、`countStrategy`、`contentProductionStrategy`、`styleAdvice` 和 `coverageAudit` 必须在规则确认响应中保留，用于审计 AI 是否完成全量盘点、数量决策和覆盖检查。
- 正式生图提示词不得把整份知识库全文、全量 `knowledgeBlueprint.anchors[]`、全量 `contentInventory` 或其他页面规划当成当前张取材池；服务端必须只下发当前页规则、当前页知识库锚点、当前页 `mustInclude`、当前页禁混项和必要的全局意图/风格摘要。
- 前端必须保留并回传 `rule.knowledgeBlueprint`、`pages[].knowledgeAnchorIndex` 和 `pages[].knowledgeAnchor`；服务端不得只信任前端载荷，正式生成前仍需执行知识库蓝图接地校验。
- 当前端确认 `rule.knowledgeBlueprint` 和全部 `pages[].knowledgeAnchor` 完整有效时，正式生成请求不得重复上传原始知识库和 PDF 页面截图；接地字段不完整时必须保留原资料作为服务端修复依据。
- 正式生图提示词必须包含“本张知识库蓝图锚点”、当前锚点真实内容和 `mustInclude` 项；如果页面规则与锚点冲突，以知识库蓝图锚点中的真实内容为准。
- 当用户提示词明确要求知识库/资料文字“不修改、不改变、保持不变、一字不改”等原文保真意图时，文本型知识库蓝图必须由服务端直接从可提取原文构建，不得先由规则模型概括或转写。
- 原文保真模式下，规则模型只能规划原文块分页与视觉排版；服务端必须覆盖模型返回的改写、润色、纠错、补写、删减、去重或重排建议，最终可见文字以当前页锁定原文为唯一内容来源。
- 原文保真模式下，正式生图 prompt 必须包含最高优先级保真锁和明确的原文起止边界；参考风格图、固定排版、规则摘要和空间不足都不得成为修改原文的理由。
- 默认情况下，`pages[]` 的顺序必须由教学逻辑、概念依赖和内容板块决定，不得由源文件页码顺序决定；原文保真模式例外，必须按锁定原文块的原始先后顺序分页，不得重排文字顺序。
- 如果逻辑上应进入第 1 张的内容出现在原文件第 2 页或更后面，仍必须规划到第 1 张。
- 用户未手填数量时，服务端必须把可靠的 `knowledgeBlueprint.anchors[]` 数量、AI 返回的 `contentUnits` 数量和明确编号标题线索作为数量下限；当模型返回数量低于这些内容证据时，应上调到内容锚点数量，不能被 PDF 页数、截图数或文件页码压低。
- 正式生成返回结果数量必须与用户填写的 `count` 一致。
- 有参考风格图时，正式生成提示词必须要求复刻参考图的版式、栏目、配色、字体层级、图标/插画位置和留白比例。
- 有参考风格图时，正式生图请求只把参考风格图和必要母版图作为视觉参考；知识库图片不得作为视觉参考混入，以免污染当次参考图样式。
- Cloudflare Worker 线上稳定模式下，有参考风格图时不得默认调用 `/images/edits`；必须复用规则确认阶段已提取的参考图风格说明直接走 `/images/generations`，用户确认后不得再插入规则模型请求。
- 4K 严格尺寸遇到结果未知的网关错误时不得自动重复模型调用，也不得静默降级；只有明确未受理的流式参数错误允许安全协议回退。
- Worker 与本地 Node 服务必须优先使用上游 SSE 流式生图并保留现有并发；切换传输协议不得改变模型配置、4K 尺寸或积分规则。
- 单张最终失败结果应保留错误阶段、HTTP 状态、尝试次数和耗时；前端只做中文清洗，不得把不同错误统一改写成“超时”。
- 超过 60 分钟仍为 `running` 的孤儿批次必须在后续请求加载状态时自动结算并退回未成功图片积分。
- NDJSON 单行必须小于 64 KiB；禁止 data URL 和 `b64_json`，只有 `preview_chunk.data` 可携带最多 48 KiB 的 Base64 分块；最终 `result` 仍返回 `/generated/...` 地址。
- 批量模型并发固定使用既有 2/3 路窗口；模型产物形成后必须立即释放模型槽，图片保存和积分记录在独立完成阶段执行；持久化并发不得超过对应模型窗口，模型工作线程最多额外持有一份待持久化产物。
- 完整预览必须在等待持久化槽之前下发；预览任务必须在任何完成槽/持久化槽等待前登记并与完成任务统一收拢；持久化槽只覆盖图片保存，最终结果事件和积分状态事务不得占用持久化槽。
- 固定排版模式先生成第 1 张母版，后续页面可以并发复用母版参考图。
- 固定排版只能复用版式，后续页必须全量替换章节标题、知识点、例句和练习内容。
- 前端批量生成必须逐张接收并展示，不等待整批全部结束。
- 前端收到 `preview`、完整分块预览或 `result` 时只能更新对应索引的结果卡片，不得清空并重建整个结果区；Blob/HTTP(S) 预览必须保持可见，最终保存地址在约 30 秒有界重试中预加载成功后才替换。
- 收到 `persistenceFailed=true` 且对应预览仍可用时，前端只有在 `<img>` 实际加载成功后才能保留本地副本并允许下载/作为参考图；损坏预览必须转为失败卡片。该结果不计为云端已保存，界面必须明确显示已退款。重新生成失败时恢复原本地副本，清空或新批次后旧回调不得复活结果。
- 固定排版后续页重试只能提交已保存的同源 `/generated/...` 母版；浏览器私有 `blob:` 本地副本不得写入 `layoutReferenceImage`。
- 同一 Worker 实例内的生成状态事务必须串行化；取消信号必须先同步进入本实例取消集合再写 KV，流事件在真正写入时复查，独立取消标记一旦存在，后续单图结果记录和 `done` 结算不得覆盖 `canceled` 终态。Workers KV 的跨节点一致性仍遵循平台的最终一致模型。
- Cloudflare 入口必须使用带发布版本参数的 `/app.js` 地址；每次涉及主前端行为的正式发布都必须更新该参数并核验线上脚本协议标记。
- 单张失败卡片一出现即可点击重新生成本张，即使整批仍在生成中也不得被全局生成状态阻塞。
- 多张失败卡片允许同时重新生成；单张重试不得清空或重跑其他已成功结果。
- 生成器前端不得接收或展示任何模型 APIKEY。
- AI 接口的 URL、MODEL 和 APIKEY 只能来自后台配置，不允许从 `.env` 读取。
- 后台配置文件不得提交到版本控制。
- AI 生图为 `4K` 档时，服务端必须重新计算图片 `size`，不得依赖前端传入固定尺寸。
- 单张失败不得阻断其他批量结果返回。
