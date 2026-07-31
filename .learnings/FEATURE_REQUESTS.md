## [FEAT-20260731-001] global-ai-and-site-routing

**Logged**: 2026-07-31T21:08:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Requested Capability

AI 配置后台需要提供全局 AI 配置，并允许管理员为每个子站选择全局配置、独立配置或停用。

### User Context

当前页面只显示教辅资料生成器的文本和生图接口池，无法集中管理 21 个子站的 AI 来源。

### Complexity Estimate

medium

### Suggested Implementation

扩展平台 AI 配置契约，增加 `global.entries` 和 `sites[]`，后台提供可编辑界面；主站按子站分配在启动时注入统一 AI 环境变量，同时保留旧版 `rule/image` 配置兼容。

### Metadata

- Frequency: first_time
- Related Features: ai-config-admin

### Resolution

- **Resolved**: 2026-07-31T21:40:00+08:00
- **Notes**: 后台新增全局 AI 与 21 个子站来源选择，后端配置升级到 v2 并兼容旧版 rule/image 字段；主站按子站模式注入平台 AI 环境变量。

---
