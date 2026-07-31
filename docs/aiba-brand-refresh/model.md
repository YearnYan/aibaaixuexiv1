# 艾爸AI学习平台契约

本次重构不变更既有服务端契约。以下是新主站和拆分后台依赖的公共接口清单。

## 用户对象

| 字段 | 类型 | 必需 | 约束 | 备注 |
|------|------|------|------|------|
| `id` | string | 是 | 非空 | 用户标识 |
| `username` | string | 是 | 3-40 位 | 登录账号 |
| `role` | string | 是 | `admin`/`user` | 用户角色 |
| `points` | number | 是 | 非负整数 | 当前积分 |

## 认证接口

- `GET /api/auth/me`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`

注册与登录请求示例：

```json
{
  "username": "parent@example.com",
  "password": "password123"
}
```

登录状态响应示例：

```json
{
  "ok": true,
  "authenticated": true,
  "setupRequired": false,
  "user": {
    "id": "user-id",
    "username": "parent@example.com",
    "role": "user",
    "points": 20
  }
}
```

## 积分接口

- `POST /api/points/redeem`
- `GET /api/points/logs`
- `GET /api/admin/points/overview`
- `POST /api/admin/points/redeem-codes`
- `POST /api/admin/points/adjust`

卡密兑换请求示例：

```json
{
  "code": "ABCD-EFGH"
}
```

积分调整请求示例：

```json
{
  "username": "parent@example.com",
  "mode": "add",
  "points": 10,
  "note": "活动赠送"
}
```

## AI 配置接口

- `GET /api/admin/ai-config`
- `PUT /api/admin/ai-config`

配置请求示例：

```json
{
  "global": {
    "entries": [
      {
        "baseUrl": "https://api.example.com/v1",
        "model": "text-model",
        "apiKeys": ["masked-key"]
      }
    ]
  },
  "sites": [
    {
      "id": "AI丢分诊断器",
      "mode": "global",
      "entries": []
    },
    {
      "id": "AI出题机",
      "mode": "custom",
      "entries": [
        {
          "baseUrl": "https://another.example.com/v1",
          "model": "custom-model",
          "apiKeys": ["masked-key"]
        }
      ]
    }
  ],
  "rule": {
    "entries": [
      {
        "baseUrl": "https://api.example.com/v1",
        "model": "text-model",
        "apiKeys": ["masked-key"]
      }
    ]
  },
  "image": {
    "resolution": "4k",
    "entries": []
  }
}
```

`global.entries` 是子站默认使用的文本 AI 接口池；子站 `mode` 可取
`global`、`custom` 或 `disabled`。`rule` 和 `image` 为教辅资料生成器保留的
兼容字段，其中 `rule` 仍用于生成规则确认，`image` 仍用于生图接口池。旧版
只有 `rule/image` 的配置读取时会自动把 `rule` 作为全局 AI 初始值。

主启动器 `server.mjs` 按子站 ID 解析上述配置：`global` 选择全局接口池，
`custom` 选择该子站的独立接口池，`disabled` 不注入 AI 配置。选中的首个
完整接口会注入 `PLATFORM_AI_*`、`AI_*`、`CCC_*` 和兼容的 `OPENAI_*` 环境变量，
子站无需自行读取配置文件。主启动器同时向 Next.js 子站注入 `AIBA_HOME_URL`，
用于生成返回主页、登录和积分兑换链接。

## 验证规则与不变量

- 首个注册账号仍自动成为管理员，其余账号仍为普通用户。
- 会话仍由 HTTP-only Cookie 维护。
- 积分后台只调用积分与认证接口，不调用 AI 配置接口。
- AI 配置后台只调用 AI 配置与认证接口，不调用积分管理接口。
- `baseUrl` 必须为 HTTP 或 HTTPS URL；非空配置项必须同时包含 URL、模型和至少一个密钥。
- `sites[].mode` 只能是 `global`、`custom` 或 `disabled`；选择 `custom` 时必须至少填写一个完整接口。
- 前端不得展示、记录或持久化服务端未返回的明文密钥。
- 本次变更无用户、积分或会话数据库迁移；AI 配置通过新增字段向后兼容旧版 `rule`。
