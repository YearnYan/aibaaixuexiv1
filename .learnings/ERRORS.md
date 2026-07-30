# 错误记录

## [ERR-20260730-014] playwright-wrapper-windows-path

**Logged**: 2026-07-30T20:48:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

Playwright 技能包装脚本存在于 Windows 文件系统，但当前 `bash` 无法识别 `C:/...` 路径。

### Error

```text
/bin/bash: C:/Users/YearnXu/.codex/skills/playwright/scripts/playwright_cli.sh: No such file or directory
```

### Context

- `npx` 已安装且可用。
- 包装脚本实际位于 `C:\Users\YearnXu\.codex\skills\playwright\scripts\playwright_cli.sh`。
- 当前 `bash` 为 WSL 风格路径解析环境。

### Suggested Fix

在 PowerShell 中使用技能文档允许的 `npx --package @playwright/cli playwright-cli` 方式运行浏览器验证。

### Metadata

- Reproducible: yes
- Related Files: `C:/Users/YearnXu/.codex/skills/playwright/scripts/playwright_cli.sh`

### Resolution

- **Resolved**: 2026-07-30T20:52:00+08:00
- **Notes**: 使用 `npx --package @playwright/cli playwright-cli` 完成桌面与移动端验证，浏览器会话已正常关闭。

---

## [ERR-20260730-001] imagegen-custom-model-size-validation

**Logged**: 2026-07-30T18:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
图像 CLI 将兼容模型别名识别为旧模型，拒绝标准 `gpt-image-2` 支持的灵活尺寸。

### Error

```text
Error: size must be one of 1024x1024, 1536x1024, 1024x1536, or auto for this GPT Image model.
```

### Context

- 使用用户指定的 OpenAI 兼容接口和模型别名生成网站首屏背景图。
- 模型名包含 `gpt-image-2` 语义，但不等于脚本内置的标准模型名。
- 请求尺寸为 `2048x1152`。

### Suggested Fix

保持用户指定模型不变，使用兼容层明确允许的 `1536x1024` 横图尺寸，并在网页端使用 `object-fit: cover` 适配宽屏。

### Metadata

- Reproducible: yes
- Related Files: `C:/Users/YearnXu/.codex/skills/.system/imagegen/scripts/image_gen.py`

### Resolution

- **Resolved**: 2026-07-30T18:02:00+08:00
- **Notes**: 改用兼容横图规格，不修改技能脚本，也不降级用户指定模型。

---

## [ERR-20260730-011] workspace-secret-scan-timeout

**Logged**: 2026-07-30T20:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
提交前敏感信息扫描遍历了大量已忽略的依赖和构建目录，超过 30 秒超时。

### Error

```text
command timed out after 34137 milliseconds
```

### Context

- 使用 `rg --hidden` 从项目根目录扫描密钥模式。
- 排除规则只覆盖根级目录，未充分剪枝嵌套工作区中的生成目录。

### Suggested Fix

先初始化 Git 并用 `.gitignore` 生成待提交文件清单，再仅扫描该清单；初始化前则按源码目录定向扫描。

### Metadata

- Reproducible: yes
- Related Files: `.gitignore`

### Resolution

- **Resolved**: 2026-07-30T20:24:00+08:00
- **Notes**: 改用递归 glob 排除嵌套依赖和构建目录，7 秒内完成 910 个源码/配置文件扫描，密钥命中数为 0。

---

## [ERR-20260730-012] optional-git-config-nonzero

**Logged**: 2026-07-30T20:31:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary

读取未设置的可选 Git 配置 `core.safecrlf` 返回状态码 1，导致并行审计命令提前结束。

### Error

```text
git config --get core.safecrlf exited with code 1
```

### Context

- `core.autocrlf=true` 已正常读取。
- Git 对不存在的配置项返回 1，这是可预期状态，不代表仓库异常。

### Suggested Fix

读取可选配置时显式捕获退出码并转为布尔结果，避免影响同组检查。

### Metadata

- Reproducible: yes
- Related Files: `.git/config`

### Resolution

- **Resolved**: 2026-07-30T20:32:00+08:00
- **Notes**: 后续命令改为 PowerShell 捕获输出并始终正常退出。

---

## [ERR-20260730-013] sequential-git-config-query-timeout

**Logged**: 2026-07-30T20:33:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary

四次 Git 配置查询串行执行超过了 10 秒命令时限。

### Error

```text
command timed out after 16320 milliseconds
```

### Context

- 查询内容仅为换行配置与提交者身份。
- 单项查询正常，短超时下串行进程启动开销累积导致超限。

### Suggested Fix

用一次 `git config --list --show-origin` 合并读取配置，并将独立身份查询并行执行。

### Metadata

- Reproducible: no
- Related Files: `.git/config`

### Resolution

- **Resolved**: 2026-07-30T20:34:00+08:00
- **Notes**: 合并查询后 1 秒内完成，提交身份与换行配置均已确认。

---

## [ERR-20260730-010] node24-spawn-npm-cmd-einval

**Logged**: 2026-07-30T19:55:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary

Windows Node.js 24 直接使用 `spawn('npm.cmd', ...)` 启动子项目命令时返回 `EINVAL`。

### Error

```text
错题举一反三 执行失败：spawn EINVAL
```

### Context

- 根脚本并发运行各子站 `npm run build`。
- 错误发生在子进程创建阶段，子站构建尚未执行。

### Suggested Fix

优先读取 npm 注入的 `npm_execpath`，通过 `process.execPath npm-cli.js ...` 启动 npm；仅在该路径不可用时回退系统 `npm` 命令。

### Metadata

- Reproducible: yes
- Related Files: `scripts/run-workspaces.mjs`

### Resolution

- **Resolved**: 2026-07-30T19:58:00+08:00
- **Notes**: 已改为通过 `process.execPath` 执行 `npm_execpath`；根级构建成功完成 10 个子项目。

---

## [ERR-20260730-009] relative-commandline-process-filter

**Logged**: 2026-07-30T19:48:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary

按工作区路径过滤 Node 进程时，主站和平台后端使用相对入口启动，命令行不含工作区绝对路径，导致两个进程未被清理。

### Error

```text
4173 和 5180 仍由旧进程监听，新主站进程无法接管端口。
```

### Context

- 子站使用绝对入口路径，能被工作区标记筛选。
- 根 `server.mjs` 与后端 `server.js` 的命令行只有相对文件名。

### Suggested Fix

先按明确端口读取监听 PID 和命令行，确认后精确停止 4173/5180；子站进程仍按绝对工作区路径筛选。

### Metadata

- Reproducible: yes
- Related Files: `server.mjs`

### Resolution

- **Resolved**: 2026-07-30T19:49:00+08:00
- **Notes**: 已改用明确端口 PID 精确重启主站及平台后端。

---

## [ERR-20260730-007] tool-gateway-readiness-failures

**Logged**: 2026-07-30T19:40:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary

21 个子站全量入口巡检中有 6 个未能启动：3 个缺少本地依赖，3 个仍强制读取子站 `.env` 中的 AI 密钥。

### Error

```text
ERR_MODULE_NOT_FOUND / Cannot find module 'express'
缺少 AI_API_KEY / AI_API_KEYS，请在 server/.env 中配置
```

### Context

- 缺依赖：`AI提分空间评测器`、`AI题型提分卡`、`提分行动计划器`。
- 旧式本地 AI 配置：`错题归因追分器`、`错题举一反三`、`试卷变式机`。
- 其余 15 个子站入口均返回 302 并成功加载 200 页面。

### Suggested Fix

按 lockfile 安装三个子站依赖；主站启动器从平台 AI 配置文件读取文本通道，将 URL、模型和密钥仅注入子进程内存环境。

### Metadata

- Reproducible: yes
- Related Files: `server.mjs`, `教辅资料生成器/data/ai-config.json`

### Resolution

- **Resolved**: 2026-07-30T19:50:00+08:00
- **Notes**: 已安装三个缺失依赖；旧服务允许未配置时启动，并在真正调用 AI 时给出明确错误；复测 6 个入口全部 `302 -> 200`。

---

## [ERR-20260730-008] powershell-haskey-expression

**Logged**: 2026-07-30T19:42:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary

脱敏检查 AI 配置时，PowerShell 数组表达式在右括号与 `.Count` 之间出现空格，触发解析错误。

### Error

```text
Unexpected token '.Count' in expression or statement.
```

### Context

- 仅用于输出 URL、模型、密钥数量与是否配置，不应输出密钥内容。

### Suggested Fix

改用 Node.js 读取 JSON，并只序列化非敏感字段和布尔状态。

### Metadata

- Reproducible: yes
- Related Files: `教辅资料生成器/data/ai-config.json`

### Resolution

- **Resolved**: 2026-07-30T19:43:00+08:00
- **Notes**: 已改用 Node.js 脱敏状态检查。

---

## [ERR-20260730-006] powershell-default-encoding-json-parse

**Logged**: 2026-07-30T19:28:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary

Windows PowerShell 按系统默认编码读取 UTF-8 中文 `package.json`，中文末尾被替换字符破坏，导致 `ConvertFrom-Json` 误报 JSON 无效。

### Error

```text
ConvertFrom-Json : Invalid object passed in, ':' or '}' expected.
```

### Context

- 文件可被 npm 和 Node.js 正常解析。
- 错误仅出现在未指定编码的 `Get-Content` 管道中。

### Suggested Fix

读取 UTF-8 项目文件时始终使用 `Get-Content -Encoding UTF8`，或直接使用 Node.js 的 UTF-8 JSON 解析。

### Metadata

- Reproducible: yes
- Related Files: `*/package.json`

### Resolution

- **Resolved**: 2026-07-30T19:29:00+08:00
- **Notes**: 后续盘点命令显式指定 UTF-8，不使用被污染的脚本结果。

---

## [ERR-20260730-005] word-build-parallel-timeout

**Logged**: 2026-07-30T19:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

`题卷重排WORD` 与其他四个生产构建并行执行时超过 60 秒命令超时，被验证工具终止。

### Error

```text
Exit code: 124
command timed out after 64049 milliseconds
```

### Context

- 命令：`npm run build`
- 单元测试 60 秒上限被误用于生产构建。
- 同批次包含多个混淆和 Vite 构建任务，存在明显资源竞争。

### Suggested Fix

单独运行该生产构建并使用 120 秒超时；构建完成后检查产物中的品牌主题引用。

### Metadata

- Reproducible: unknown
- Related Files: `题卷重排WORD/package.json`

### Resolution

- **Resolved**: 2026-07-30T19:22:00+08:00
- **Notes**: 单独构建在约 28 秒内成功，确认并行批次仅因资源竞争触发命令超时。

---

## [ERR-20260730-004] parallel-npm-test-placeholder-script

**Logged**: 2026-07-30T19:10:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

并行执行多个子项目的 `npm test` 时，两个子项目仍使用脚手架默认的失败占位脚本，导致批次结果提前中断。

### Error

```text
Error: no test specified
```

### Context

- 尝试并行验证 `错题举一反三`、`错题归因追分器`、`题卷重排WORD` 和 `题感训练提分器`。
- `错题举一反三` 与 `错题归因追分器` 的 `test` 脚本仅为默认失败占位，不代表实现测试失败。
- `Promise.all` 在首个非零退出码出现后提前结束，未完整汇总其他命令结果。

### Suggested Fix

批量执行前先读取各子项目 `package.json` 的脚本；对无有效测试的项目执行生产构建作为静态集成验证，并采用逐项捕获结果的方式避免单项失败遮蔽其他项目。

### Metadata

- Reproducible: yes
- Related Files: `错题举一反三/package.json`, `错题归因追分器/package.json`

### Resolution

- **Resolved**: 2026-07-30T19:12:00+08:00
- **Notes**: 已识别占位脚本，后续将以生产构建验证这两个项目，并继续运行另外两个项目的真实测试。

---

## [ERR-20260730-003] platform-backend-dependencies-missing

**Logged**: 2026-07-30T18:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
根平台服务器启动成功，但被代理的既有平台后端缺少本地依赖，无法加载 `mammoth`。

### Error

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mammoth' imported from 教辅资料生成器/server.js
```

### Context

- 子项目存在 `package-lock.json`，但不存在可用的 `node_modules`。
- 根站静态资源正常返回，只有认证与积分 API 后端未启动。

### Suggested Fix

在 `教辅资料生成器` 目录执行 `npm ci`，严格按锁文件安装本地依赖，然后重启根平台服务。

### Metadata

- Reproducible: yes
- Related Files: `教辅资料生成器/package-lock.json`, `server.mjs`

### Resolution

- **Resolved**: 2026-07-30T18:33:00+08:00
- **Notes**: 已按锁文件执行本地 `npm ci`，根站与平台后端分别在 4173 和 5180 端口正常运行，健康检查和登录态接口均返回成功。

---

## [ERR-20260730-002] attached-logo-path-mismatch

**Logged**: 2026-07-30T18:10:00+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
对话附件显示的 Logo 路径位于项目根目录，但实际文件保存在项目上一级客户目录。

### Error

```text
Copy-Item : Cannot find path 'logo.jpg' because it does not exist.
```

### Context

- 当前工作目录为 `艾爸AI学习上线版`。
- 实际附件位于其父目录 `艾爸AI学习/logo.jpg`。

### Suggested Fix

附件路径不可读时先在明确的客户项目上级目录按精确文件名做只读查找，再复制到站点资源目录。

### Metadata

- Reproducible: no
- Related Files: `platform/assets/logo.jpg`

### Resolution

- **Resolved**: 2026-07-30T18:11:00+08:00
- **Notes**: 已定位父目录中的原始 Logo，未使用替代图。

---
