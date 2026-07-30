# 题卷重排识别与增量输出契约

## 超时降载约束

- 上游请求超过 180 秒必须中止，不能继续占用识别会话。
- 多页批次超时必须拆分并合并；单页允许原图原提示重放一次，仍超时则返回 `504`。
- 成功结果的 `processedPageIndexes` 必须覆盖本批次全部输入页面，且 `emptyPageIndexes` 必须为空。

## HTTP 契约

现有端点保持不变：

- `POST /api/recognition-sessions`
- `PUT /api/recognition-sessions/:sessionId/pages/:pageIndex`
- `POST /api/recognition-sessions/:sessionId/complete`
- `GET /api/recognition-sessions/:sessionId/status`

成功响应继续使用 `RecognitionResult`；错误码和积分结算语义保持兼容。

## 客户端批次契约

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| selectedPageIndexes | `number[]` | 非负整数、去重、按原始页序排列 | 用户勾选的 PDF/图片页面 |
| batchSize | `number` | 固定为 5 | 每个隐藏识别会话最多处理 5 个选中页面 |
| pageIndexMapping | `Map<number, number>` | 批次本地页码必须映射到原始页码 | 防止分批后裁图引用错误页面 |

识别按钮只启动批次流程，不展示“上传图片”阶段；每个批次的成功结果立即追加到 A4 预览。导出请求允许在批次流程仍运行时读取当前已生成内容。

### 积分结算

- 无 DOCX 的图片/PDF 批次，`sourcePageCount` 等于该批次页数（1 至 5）。
- 混合 DOCX 首批的 `sourcePageCount` 等于首批图片页数加已核验的 DOCX 页数，并携带 `docxImportSessionId`；后续批次只携带图片页数。
- 平台按每个完成请求 `ceil(sourcePageCount / 5)` 预扣；HTTP 2xx 且结果进入 A4 预览视为成功，非 2xx 自动退款。
- 批次之间使用不同且稳定的幂等键；重复连接只复用原会话，不重复调用 AI。

示例：选中 11 页图片时生成 3 个批次（5、5、1），成功扣 3 分；第二批失败时第一、三批保留扣费，第二批自动退款。

### 完成请求响应

- 识别在单次等待窗口内完成：`200 RecognitionResult`。
- 识别仍在后台执行：`409 { code: "session_processing", progress }`；平台保留本次会话预扣，浏览器复用同一幂等键接入同一会话，避免重复扣费和退款竞态。
- 另一个请求正在交付结果：`409 { code: "session_result_delivering" }`。
- 结果已被成功交付：`409 { code: "session_completed" }`；浏览器从状态接口回读已结算结果。

### 状态响应新增字段

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| resultDeliveryState | `available` \| `delivering` \| `delivered` | 否 | 仅结果完成后出现 | 结果计费交付状态 |
| result | RecognitionResult | 否 | 仅 `includeResult=1` 且交付状态为 `delivered` 时出现 | 防止未成功扣分时提前取走结果 |

### 子站配置

| 环境变量 | 类型 | 默认值 | 约束 | 备注 |
|------|------|------|------|------|
| RECOGNITION_COMPLETION_WAIT_MS | 正整数毫秒 | 45000 | 生产为 5000 至 120000 | 单次完成请求的等待窗口，不是整份文件超时 |

## RecognitionSequenceCheckpoint

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| expectedPageCount | 正整数 | 是 | 与会话页数相等 | 防止断点串用 |
| completedBatches | CompletedBatch[] | 是 | pageIndexes 组合唯一 | 已完整完成的外层批次 |
| partialBatches | PartialBatch[] | 否 | pageIndexes 组合唯一 | 已完成主识别或部分复检的批次 |

## PartialBatch

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| pageIndexes | 非负整数数组 | 是 | 顺序与输入批次一致 | 阶段断点键 |
| result | RecognitionResult | 是 | 只允许已通过结构和页码校验的结果 | 不保存残缺响应 |
| completedRecoveryKinds | RecoveryKind[] | 是 | `table`、`option`、`figure` 去重 | 避免重复复检 |

## 主识别失败响应

```json
{
  "code": "invalid_ai_response",
  "message": "AI 返回的识别结构无法解析，本次未采用任何残缺内容。"
}
```

## 不变量

- 断点中只保存通过 `RecognitionResult` 结构和页码约束的结果。
- 外层批次完成前可以保存主结果和复检进度，但不得提前计入完成页进度。
- 结构失败最多执行一次同批纠错，随后按页面缩小；单页耗尽结构尝试后必须返回失败。
- 复检一次只处理一个目标，只发送该目标实际关联的页面。
- 复检结构或传输重试耗尽时添加目标页原图，不能抛出整批错误或重新执行主识别。
- 成功结果的 `processedPageIndexes` 必须与全部上传页精确一致，且不得包含 `preserved-page-*` 占位项。
- 用户重新上传失败会话中的任一页面时，所有完成和阶段断点必须清空。
- 后台 `processing` Promise 在完成请求返回 `session_processing` 后必须继续存在，后续请求只能复用，不能重新启动识别。
- 结果交付权同一时刻最多一个持有者；响应 `finish` 后转为 `delivered`，提前 `close` 必须回到 `available`。

## 兼容性

- HTTP 端点和成功结果结构不变；状态响应只新增可选字段，完成端点新增可自动恢复的 409 业务码。
- `partialBatches` 是服务端内部可选字段；旧的内存断点对象仍可读取。
- 无数据库迁移；新增环境变量有安全默认值，无需生产配置即可运行。
