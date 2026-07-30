## [ERR-20260730-001] PowerShell 并行读取

**Logged**: 2026-07-30T10:15:33+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
并行读取中一个返回非零状态的子命令导致整组结果未返回。

### Error
```
Script error: Exit code: 1
```

### Context
- 使用 `Promise.all` 并行运行多个 PowerShell 只读命令。
- 其中一个可选路径查询返回非零状态，使整个工具脚本提前失败。

### Suggested Fix
对可选文件和检索命令显式处理非零退出码，或拆分为独立工具调用。

### Metadata
- Reproducible: yes
- Related Files: 无

### Resolution
- **Resolved**: 2026-07-30T10:15:33+08:00
- **Notes**: 后续读取命令对可选结果统一返回成功状态。

---

## [ERR-20260730-011] SSH 测试输出终端编码

**Logged**: 2026-07-30T10:46:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
远端命令完成后，本地 Python 以 GBK 输出 Node 测试的 `✔` 字符时报编码异常。

### Error
```
UnicodeEncodeError: 'gbk' codec can't encode character '\u2714'
```

### Context
- 远端命令已结束并返回完整 UTF-8 输出。
- 异常发生在本地打印阶段，服务器部署结果需通过独立只读审计确认。

### Suggested Fix
SSH 客户端启动时把 `sys.stdout/stderr` 重配置为 UTF-8，并在异常后先核对生产状态再决定重试。

### Metadata
- Reproducible: yes
- Related Files: 无

### Resolution
- **Resolved**: 2026-07-30T10:46:00+08:00
- **Notes**: 后续客户端强制 UTF-8 输出，并执行远端哈希与健康检查。

---

## [ERR-20260730-010] PowerShell 管道传递中文 Python 脚本

**Logged**: 2026-07-30T10:46:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
PowerShell 通过标准输入传递内联 Python 时损坏了脚本中的中文路径字面量。

### Error
```
本地部署文件不存在：D:\AI????\...\AI???\server.mjs
```

### Context
- 部署脚本在建立 SSH 连接前完成本地文件检查。
- 中文路径在管道编码转换后变为问号，服务器未发生任何改动。

### Suggested Fix
脚本主体只使用 ASCII，中文本地与远端路径通过 Unicode 环境变量传入。

### Metadata
- Reproducible: yes
- Related Files: AI备课器/server.mjs

### Resolution
- **Resolved**: 2026-07-30T10:46:00+08:00
- **Notes**: 改用环境变量传递中文路径。

---

## [ERR-20260730-009] Python pip 不可用

**Logged**: 2026-07-30T10:42:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
默认 `python` 指向的精简虚拟环境未安装 `pip`。

### Error
```
No module named pip
```

### Context
- 尝试把 SSH 客户端依赖安装到 Git 忽略的本地目标目录。
- 未修改系统 Python 或项目依赖。

### Suggested Fix
使用系统 Python 启动器中自带 `pip` 的解释器。

### Metadata
- Reproducible: yes
- Related Files: 无

### Resolution
- **Resolved**: 2026-07-30T10:42:00+08:00
- **Notes**: 改查 `py` 启动器和系统解释器。

---

## [ERR-20260730-008] Python SSH 客户端依赖

**Logged**: 2026-07-30T10:40:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
本机 Python 环境未安装 `paramiko`。

### Error
```
ModuleNotFoundError: No module named 'paramiko'
```

### Context
- 密码认证部署需要非交互 SSH 客户端。
- 为避免未经确认安装依赖，仅检查现有模块。

### Suggested Fix
优先使用系统现有的 OpenSSH、`sshpass` 或 `expect`。

### Metadata
- Reproducible: yes
- Related Files: 无

### Resolution
- **Resolved**: 2026-07-30T10:40:00+08:00
- **Notes**: 改查系统现有 SSH 工具，不安装新包。

---

## [ERR-20260730-007] web-access CDP 前置检查

**Logged**: 2026-07-30T10:36:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
CDP 前置检查等待 Chrome 远程调试连接并超时。

### Error
```
command timed out after 34064 milliseconds
```

### Context
- 本次联网目标是 Git 和 SSH，不需要浏览器 CDP。
- 本机 Chrome 未提供技能所需的远程调试连接。

### Suggested Fix
浏览器任务需要启用 Chrome 远程调试；非浏览器网络任务使用对应命令行协议工具。

### Metadata
- Reproducible: unknown
- Related Files: 无

### Resolution
- **Resolved**: 2026-07-30T10:36:00+08:00
- **Notes**: 本次部署降级为 Git 与 SSH 命令行工具。

---

## [ERR-20260730-006] web-access Windows 前置脚本

**Logged**: 2026-07-30T10:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
`check-deps.sh` 使用 CRLF 行尾，WSL Bash 直接执行时报语法错误。

### Error
```
$'\r': command not found
syntax error near unexpected token `$'do\r''
```

### Context
- Windows 文件系统中的技能脚本由 WSL Bash 执行。
- 脚本本身未转换为 LF。

### Suggested Fix
通过标准输入临时删除行尾 `\r` 后交给 Bash，不修改技能源文件。

### Metadata
- Reproducible: yes
- Related Files: C:/Users/YearnXu/.codex/skills/web-access/scripts/check-deps.sh

### Resolution
- **Resolved**: 2026-07-30T10:35:00+08:00
- **Notes**: 使用 `sed 's/\r$//' ... | bash` 运行前置检查。

---

## [ERR-20260730-005] Playwright 本地存储 JSON 参数

**Logged**: 2026-07-30T10:28:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
Windows 下 CLI 参数解析剥离了 `localstorage-set` 值中的 JSON 引号。

### Error
```
teacher-prep-ai-settings={provider:compatible,...}
```

### Context
- 应用要求设置值是合法 JSON 字符串。
- CLI 写入后键和值的双引号丢失，应用回退到默认空密钥配置。

### Suggested Fix
通过页面上下文调用 `JSON.stringify` 写入复杂本地存储值。

### Metadata
- Reproducible: yes
- Related Files: src/main.jsx

### Resolution
- **Resolved**: 2026-07-30T10:28:00+08:00
- **Notes**: 改用 Playwright `eval` 在浏览器内生成 JSON。

---

## [ERR-20260730-004] 接口测试服务就绪判断

**Logged**: 2026-07-30T10:24:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
接口测试在缺少前端构建产物时把静态首页 503 误判为服务未启动。

### Error
```
Error: 测试服务启动超时
```

### Context
- `waitForServer` 只接受根路径的 2xx 响应。
- API 已监听，但 `build/index.html` 尚不存在，根路径按设计返回 503。

### Suggested Fix
执行前端构建后再运行现有接口测试，或未来把就绪判断改为任意有效 HTTP 响应。

### Metadata
- Reproducible: yes
- Related Files: tests/generate-invalid-json.test.mjs, server.mjs

### Resolution
- **Resolved**: 2026-07-30T10:24:00+08:00
- **Notes**: 本次先生成构建产物，再执行回归测试。

---

## [ERR-20260730-003] API 健康探测

**Logged**: 2026-07-30T10:21:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
用静态首页响应判断 API 进程状态产生误判，并触发重复启动的端口占用错误。

### Error
```
Error: listen EADDRINUSE: address already in use 0.0.0.0:8787
```

### Context
- 后台 API 进程已启动并占用 8787 端口。
- 首页探测没有成功返回，于是错误地再次前台启动服务。

### Suggested Fix
使用目标业务端点或 TCP 监听状态判断服务健康，不以静态首页为唯一依据。

### Metadata
- Reproducible: yes
- Related Files: server.mjs

### Resolution
- **Resolved**: 2026-07-30T10:21:00+08:00
- **Notes**: 后续改为调用 `/api/generate` 验证服务。

---

## [ERR-20260730-002] 本地调试服务启动

**Logged**: 2026-07-30T10:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
包含两个后台进程和轮询逻辑的复合 `Start-Process` 命令被终端策略拦截。

### Error
```
rejected: blocked by policy
```

### Context
- 尝试在单条 PowerShell 命令中同时启动 API、Vite 并轮询端口。
- 命令未执行，未产生后台进程。

### Suggested Fix
拆分为显式可审计的单进程启动命令，再单独执行端口检查。

### Metadata
- Reproducible: unknown
- Related Files: 无

### Resolution
- **Resolved**: 2026-07-30T10:20:00+08:00
- **Notes**: 改用拆分后的简化启动与探测命令。

---
