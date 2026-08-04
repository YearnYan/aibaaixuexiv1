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

## [ERR-20260804-001] missing-static-assets-after-frontend-build

**Logged**: 2026-08-04T12:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Summary
前端构建脚本清空 `dist` 后未复制导航 CSS、Logo 和共享脚本，导致服务端返回 HTML 代替静态资源。

### Error

```text
Refused to apply style ... aiba-subsite-nav.css because its MIME type ('text/html') is not a supported stylesheet MIME type
```

### Context

- `错题归因追分器`、`错题举一反三`、`AI出题机` 的构建脚本使用 `rm(dist)`。
- 构建后只生成 `assets` 和 `index.html`，没有保留导航依赖。

### Suggested Fix

构建脚本清空产物目录后，应显式复制 `aiba-brand.css`、`aiba-subsite-nav.css`、`aiba-subsite-nav.js`、`aiba-logo.jpg` 与共享脚本。

### Metadata

- Reproducible: yes
- Related Files: `错题归因追分器/scripts/build-frontend.js`, `错题举一反三/scripts/build-frontend.js`, `AI出题机/scripts/build-frontend.js`

### Resolution

- **Resolved**: 2026-08-04T12:10:00+08:00
- **Notes**: 已在三个构建脚本中补齐静态资源复制，并重新构建验证。

---

## [ERR-20260801-008] subsite-navigation-serial-check-timeout

**Logged**: 2026-08-01T21:30:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

逐页串行验证 21 个子站导航时，部分外部资源加载较慢，导致验证命令在 64 秒后超时。

### Context

- 并发验证已覆盖全部 21 个子站，页面均返回 200。
- 首页、注册/登录、积分兑换三个导航地址均已核验为主站地址。
- 5207 子站实测点击“注册/登录”可跳转主站并打开登录窗口。

### Resolution

- **Resolved**: 2026-08-01T21:30:00+08:00
- **Notes**: 判定为验证脚本串行加载耗时问题，不是线上导航故障；已关闭临时 `nav-check` 浏览器会话。

---

## [ERR-20260801-009] playwright-cli-unsupported-option

**Logged**: 2026-08-01T21:32:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

Playwright CLI 不支持传入 `--ignore-https-errors` 参数，导致一次线上冒烟检查命令未启动。

### Error

```text
Unknown option: --ignore-https-errors
```

### Context

- 使用 `npx --package @playwright/cli playwright-cli` 运行 Edge/Chromium 验证。
- 该 CLI 版本不暴露该参数；命令在打开页面前即退出。

### Resolution

- **Resolved**: 2026-08-01T21:32:00+08:00
- **Notes**: 改用 CLI 支持的参数重试，未对线上页面产生影响。

---

## [ERR-20260801-010] playwright-check-workdir-typo

**Logged**: 2026-08-01T21:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

一次 Playwright 快照命令的工作目录少了路径分隔符，命令未执行。

### Error

```text
目录名称无效。
```

### Resolution

- **Resolved**: 2026-08-01T21:35:00+08:00
- **Notes**: 修正工作目录后快照正常完成。

---

## [ERR-20260801-011] temp-askpass-cleanup-policy-blocked

**Logged**: 2026-08-01T21:36:00+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary

删除本轮部署生成的临时 SSH 辅助文件时被本机安全策略拦截。

### Context

- 目标文件：`C:\Users\YearnXu\AppData\Local\Temp\aiba-ssh-askpass.exe`
- `Remove-Item -LiteralPath ... -Force` 未执行，文件仍然存在。
- 未尝试绕过安全策略或修改系统权限。

### Suggested Fix

由用户在本机确认后手动删除该临时文件。

### Resolution

- **Notes**: 当前未删除，待用户手动清理。

---

## [ERR-20260801-003] web-access-windows-bash-path

**Logged**: 2026-08-01T21:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

在 Windows PowerShell 中调用 `web-access` 的 Bash 依赖检查脚本时，直接传入 `C:/...` 路径无法被当前 `/bin/bash` 识别。

### Error

```text
/bin/bash: C:/Users/YearnXu/.codex/skills/web-access/scripts/check-deps.sh: No such file or directory
```

### Context

- 脚本实际位于 Windows 文件系统 `C:\Users\YearnXu\.codex\skills\web-access\scripts\check-deps.sh`。
- 当前 `bash` 使用 WSL 风格路径解析，Windows 盘符路径不能直接作为脚本路径。
- 该错误仅影响浏览器依赖检查，不影响线上网站服务。

### Suggested Fix

在当前 Windows 环境中使用 `/mnt/c/Users/...` 路径调用 Bash 脚本；若 CDP 不可用，则按技能允许的方式使用 `curl` 做公开页面验收。

### Metadata

- Reproducible: yes
- Related Files: `C:/Users/YearnXu/.codex/skills/web-access/scripts/check-deps.sh`
- See Also: ERR-20260730-014

### Resolution

- **Resolved**: 2026-08-01T21:01:00+08:00
- **Notes**: 改用 WSL 路径或公开页面 HTTP 验证继续执行，不再重复使用 Windows 盘符路径调用 Bash。

---

## [ERR-20260801-004] web-access-wsl-runtime-mismatch

**Logged**: 2026-08-01T21:03:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

`web-access` 依赖脚本在 WSL 中先受 CRLF 换行影响，转码后又因 WSL 内没有 Node.js 而无法完成 CDP 检查。

### Error

```text
$'\r': command not found
node: missing — 请安装 Node.js 22+
```

### Context

- Windows 主环境已有 Node.js 24，缺失的是隔离的 WSL Node.js。
- 用户要求使用 Edge 通道，当前会话未暴露 Chrome-use/CDP 插件接口。

### Suggested Fix

Windows 环境优先使用本机 Node.js 与 Playwright CLI 的 `--browser msedge`；不要为一次验收额外改造 WSL 工具链。

### Metadata

- Reproducible: yes
- Related Files: `C:/Users/YearnXu/.codex/skills/web-access/scripts/check-deps.sh`
- See Also: ERR-20260801-003, ERR-20260730-014

### Resolution

- **Resolved**: 2026-08-01T21:05:00+08:00
- **Notes**: 使用真实 Edge 通道完成主站、21 个子站和后台页面验收。

---

## [ERR-20260801-005] playwright-default-session-stale-pipe

**Logged**: 2026-08-01T21:08:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

Playwright CLI 默认会话残留命名管道，导致新守护进程启动时报 `EADDRINUSE`，但默认浏览器又不可复用。

### Error

```text
listen EADDRINUSE: address already in use \\.\pipe\pw-...-default
The browser 'default' is not open
```

### Context

- 该问题只影响默认会话名，不影响 Edge 浏览器本身。
- 初次 `run-code` 还误用了语句形式；当前版本要求传入 `async page => ...` 函数。

### Suggested Fix

为每次验收使用独立命名会话，例如 `-s=aiba-check`，并在结束时显式 `close`。

### Metadata

- Reproducible: yes
- Related Files: `.playwright-cli/`

### Resolution

- **Resolved**: 2026-08-01T21:10:00+08:00
- **Notes**: 命名会话正常运行并已在验收结束后关闭。

---

## [ERR-20260801-006] windows-openssh-askpass-and-quoting

**Logged**: 2026-08-01T21:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary

Windows OpenSSH 不接受 `.cmd` 作为 `SSH_ASKPASS`，且包含空格/中文的可执行路径与远程命令替换容易被本地 PowerShell 提前解析。

### Error

```text
ssh_askpass: posix_spawnp: No such file or directory
readlink : The term 'readlink' is not recognized...
```

### Context

- 服务器只开放公钥/密码认证，本机公钥未授权。
- 远程 `$(readlink ...)` 被本地 PowerShell 当作命令替换解析，实际安装命令未执行。

### Suggested Fix

使用无空格临时目录中的小型 `.exe` 作为 askpass，并把远程路径验证、上传、安装、重启拆成独立命令。

### Metadata

- Reproducible: yes
- Related Files: `scripts/deploy/production.conf`

### Resolution

- **Resolved**: 2026-08-01T21:25:00+08:00
- **Notes**: 受控完成服务器更新；两个 askpass 临时文件已按绝对路径删除。

---

## [ERR-20260801-007] powershell-nonterminating-check-chain

**Logged**: 2026-08-01T21:32:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

在子项目目录使用错误相对路径执行 `node --check`，PowerShell 仍继续执行后续构建，最终退出码掩盖了前序错误；另一次内联 Node 命令也被引号提前截断。

### Error

```text
Cannot find module '...\\考前抢分清单器\\brand\\aiba-hzq-compat.js'
window.HZQ : The term 'window.HZQ' is not recognized...
```

### Context

- Next 生产构建本身成功。
- 出错的是额外的测试辅助命令，不涉及线上代码。

### Suggested Fix

在多步 PowerShell 验证中逐条执行并检查退出码；相对路径以当前 `workdir` 为准，哈希计算优先使用 PowerShell 原生 API。

### Metadata

- Reproducible: yes
- Related Files: `brand/aiba-hzq-compat.js`, `试卷变式机/server/middleware/security.js`

### Resolution

- **Resolved**: 2026-08-01T21:34:00+08:00
- **Notes**: 语法检查、Next 构建和 CSP 哈希均已用独立命令验证通过。

---

## [ERR-20260801-001] powershell-stdin-chinese-encoding

**Logged**: 2026-08-01T20:33:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

通过 PowerShell Here-String 管道向 `node -` 传递包含中文的批量验证脚本时，中文子站名被转码为问号，导致验证请求错误地返回 404。

### Error

```text
中文路径变为 AI%3F%3F...，21 个请求均返回 HTTP 404。
```

### Context

- 线上首个使用预编码 URL 的子站已经验证为 `302 -> 200`。
- 故障只发生在本地测试脚本的标准输入编码阶段，不属于线上服务故障。

### Suggested Fix

Windows 环境批量验证中文 URL 时，优先从 UTF-8 网页或文件中动态解析链接；如果必须内嵌文本，则使用 ASCII 安全的百分号编码或显式 UTF-8 文件输入。

### Metadata

- Reproducible: yes
- Related Files: `platform/index.html`

### Resolution

- **Resolved**: 2026-08-01T20:34:00+08:00
- **Notes**: 改为从线上主页动态解析子站链接，不再通过 PowerShell 标准输入传递中文名称。

---

## [ERR-20260801-002] node-batch-check-syntax

**Logged**: 2026-08-01T20:34:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary

批量子站检查脚本在嵌套 `await fetch()` 表达式中漏写右括号，Node.js 在执行前返回语法错误。

### Error

```text
SyntaxError: missing ) after argument list
```

### Context

- 错误发生在一次性验证脚本，不涉及线上代码。
- 脚本尚未发出任何网络请求，因此没有产生线上副作用。

### Suggested Fix

将网络响应和正文读取拆成两个命名语句，避免难以审查的嵌套 `await`。

### Metadata

- Reproducible: yes
- Related Files: `platform/index.html`

### Resolution

- **Resolved**: 2026-08-01T20:35:00+08:00
- **Notes**: 拆分为 `response` 与 `html` 两步后，21 个子站全部通过验证。

---

## [ERR-20260731-001] background-server-command-policy

**Logged**: 2026-07-31T21:06:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
尝试通过带重定向和复杂 PowerShell 表达式的 `Start-Process` 启动本地服务时被命令策略拦截。

### Error

```text
Script error: ... rejected: blocked by policy
```

### Context

- 目标是后台启动根目录的 `npm run dev`。
- 简化为不带重定向的 `Start-Process npm.cmd -ArgumentList @('run','dev')` 后成功。

### Suggested Fix

后台启动本地服务时优先使用最小化的 `Start-Process` 参数；日志和健康检查分开执行。

### Metadata

- Reproducible: yes
- Related Files: `package.json`, `server.mjs`

### Resolution

- **Resolved**: 2026-07-31T21:07:00+08:00
- **Notes**: 服务已在 4173 端口启动并通过首页 200 响应验证。

---

## [ERR-20260731-002] powershell-pid-variable-collision

**Logged**: 2026-07-31T21:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
重启本地服务的 PowerShell 循环使用了保留变量名 `$PID`，导致重启步骤中断。

### Error

```text
Cannot overwrite variable PID because it is read-only or constant.
```

### Context

- 端口检查已确认 4173 和 5180 仍在正常监听。
- 变量改为 `$procId` 后重新执行。

### Suggested Fix

PowerShell 脚本中的进程 ID 变量使用 `$procId` 等任务专用名称，避免 `$PID` 等系统变量。

### Metadata

- Reproducible: yes
- Related Files: `server.mjs`

### Resolution

- **Resolved**: 2026-07-31T21:25:00+08:00
- **Notes**: 未造成服务中断或文件变更。

---

## [ERR-20260731-003] composite-restart-command-policy

**Logged**: 2026-07-31T21:31:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
把服务重启、端口检查和 HTTP 检查合并为单条 PowerShell 命令时再次被命令策略拦截。

### Error

```text
Script error: ... rejected: blocked by policy
```

### Context

- 命令没有执行，原有服务仍保持运行。
- 后续拆分为独立的停止、启动和健康检查步骤。

### Suggested Fix

涉及后台进程的操作保持命令单一职责，避免在同一条命令中叠加多段管道和网络调用。

### Metadata

- Reproducible: yes
- Related Files: `server.mjs`

### Resolution

- **Resolved**: 2026-07-31T21:32:00+08:00
- **Notes**: 已改为分步执行，未造成服务中断。

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
