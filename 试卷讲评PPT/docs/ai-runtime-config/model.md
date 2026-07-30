# AI 运行时配置契约

## 运行时配置

| 字段 | 类型 | 必需 | 约束 | 备注 |
| --- | --- | --- | --- | --- |
| `baseURL` | string | 是 | HTTP/HTTPS URL，最长 2048 字符 | 自动移除末尾 `/chat/completions` |
| `apiKey` | string | 是 | 最长 4096 字符 | 只存在服务端内存，永不返回 |
| `model` | string | 是 | 1–200 字符，不含控制字符 | OpenAI 兼容模型名 |
| `timeoutMs` | integer | 是 | 5000–600000 | 上游请求超时 |
| `maxTokens` | integer | 是 | 256–65536 | 作为单次输出硬上限 |
| `temperature` | number | 是 | 0–2 | 请求未指定时的默认值 |

## GET /api/config

仅允许回环地址访问。响应设置 `Cache-Control: no-store`。

### 响应示例

```json
{
  "scope": "memory",
  "localOnly": true,
  "baseURL": "https://api.example.com/v1",
  "model": "example-model",
  "timeoutMs": 180000,
  "maxTokens": 8192,
  "temperature": 0.2,
  "hasApiKey": false,
  "apiKeySource": "missing"
}
```

## PUT /api/config

仅允许回环地址访问。所有字段可选，但请求必须至少改变一个字段。校验通过后原子替换。

### 请求字段

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `baseURL` | string | 同运行时配置 |
| `model` | string | 同运行时配置 |
| `timeoutMs` | integer | 同运行时配置 |
| `maxTokens` | integer | 同运行时配置 |
| `temperature` | number | 同运行时配置 |
| `apiKey` | string | 非空时替换当前密钥；空字符串保留当前值 |
| `clearApiKey` | boolean | 为 `true` 时清除当前密钥，不得与非空 `apiKey` 同时出现 |

### 响应

与 `GET /api/config` 相同，不包含 `apiKey`。

## POST /api/config/reset

仅允许回环地址访问。恢复服务启动时读取到的环境配置，响应与 `GET /api/config` 相同。

## POST /api/config/test

仅允许回环地址访问。用户主动触发最小聊天请求。

### 成功响应示例

```json
{
  "ok": true,
  "model": "example-model",
  "latencyMs": 420,
  "reply": "连接正常"
}
```

## POST /api/chat 与 POST /api/site/exam-ppt

两个路径共用处理器，请求兼容 OpenAI Chat Completions 的 `messages`、`max_tokens` 与 `temperature` 字段。`messages` 必须是非空数组；请求的 `max_tokens` 超过运行时 `maxTokens` 时按上限截断。响应透传 OpenAI 兼容结构。

## 不变量

- 任何配置响应、错误响应和日志都不得包含 API Key。
- 配置 API 的远程请求统一返回 403。
- 配置 API 拒绝非本地同源的浏览器 Origin，阻断跨站 POST。
- 配置更新失败时，运行时配置保持不变。
- 配置重置只读取服务启动时的快照，不重新读取磁盘。
