# 跨学科公式渲染变更记录

- 日期：2026-07-16
- 摘要：建立跨学科 LaTeX 内容与渲染契约。
- 接触点：`docs/academic-formula-rendering/`
- 行为：定义公式标记、学科规则、渲染接口、视觉目标和验收范围。

- 日期：2026-07-16
- 摘要：实现跨学科学术文本规范化模块。
- 接触点：`academic-math.js`、`public/academic-math.js`、`tests/academic-math.test.js`
- 行为：规范化历史程序表达式、支持 LaTeX 与 mhchem、提供 Unicode 降级、识别未解决的公式源码。

- 日期：2026-07-16
- 摘要：接入公式数据契约、排版与导出链路。
- 接触点：`app.js`、`public/app.js`、`index.html`、`public/index.html`
- 行为：AI 输出改用规范 LaTeX，全部课件字段通过 MathJax SVG 渲染，版面测量与 1600×900 截图等待公式完成。

- 日期：2026-07-16
- 摘要：重构课堂课件视觉系统。
- 接触点：`styles.css`、`public/styles.css`
- 行为：移除粗重顶栏、模块编号和卡片墙，改为题干主叙事、讲解路径时间线与低噪声考点栏。

- 日期：2026-07-16
- 摘要：新增公式质量闸门与语义重试。
- 接触点：`app.js`、`public/app.js`、`worker.js`
- 行为：兼容表达先规范化；无法解释的 Math.*、pow、**、裸命令等触发一次契约重试，仍不合格返回 422；Cloudflare 同步支持双聊天端点。

- 日期：2026-07-16
- 摘要：完成跨学科对抗验收。
- 接触点：`output/playwright/`、`tests/academic-math.test.js`
- 行为：五科 30 个公式 SVG 全部渲染，无遗留源码与溢出；导出画布为 1600×900，控制台零错误。

- 日期：2026-07-16
- 摘要：设计结构诊断驱动的字段级公式恢复机制。
- 接触点：`docs/academic-formula-rendering/`
- 行为：定义公式问题对象、字段补丁响应、受限合并、全量复检和页面内可恢复状态的不变量。

- 日期：2026-07-16
- 摘要：实现字段级公式恢复与原地续修。
- 接触点：`academic-math.js`、`academic-repair.js`、`app.js`、`public/`
- 行为：诊断裸命令、缺参数、未闭合结构和程序式表达；只合并被请求字段，4 轮未通过后暂停并从当前进度继续。

- 日期：2026-07-16
- 摘要：完成恢复体验和对抗验收。
- 接触点：`index.html`、`styles.css`、`tests/`、`output/playwright/`
- 行为：移除处理失败弹窗；桌面与 390px 移动端无溢出，继续修复按钮可用，控制台零错误零警告，字段漏项、越权和题号错配均被拒绝。
