# 实施记录

- 日期：2026-07-13
- 摘要：完成精准自学工作页重做
- 接触点：`public/index.html`、`public/app.js`、`public/styles.css`、`src/material.js`、`src/ai.js`、`docs/study-material-generator/`
- 行为：网页讲义收束为定向、看懂、练会、过关四段；统一标题与正文层级，固定 3 个目标、3 个关键判断、2 个示范、3 个练习、3 个掌握证明，并将资料原文收纳到末尾索引

- 日期：2026-07-13
- 摘要：重构为四阶段自学图谱
- 接触点：`src/material.js`、`src/ai.js`、`public/`、`src/export/docx.js`、`test/`、`docs/study-material-generator/`
- 行为：将讲义一级结构收束为定向、建模、练会、固化；为目标、知识节点、重点、例题、练习和掌握证明定义稳定 ID 与显式路线关联；要求资料证据进入讲解和主动任务，并让 Word 输出每条目标的关键判断、关联内容、示范、练习与掌握证明

- 日期：2026-07-13
- 摘要：定义关键判断诊断闭环
- 接触点：`docs/study-material-generator/`
- 行为：为重点补充先判一题、逻辑核对、常见误判与修复动作；为例题补充看似可行路径的决策分叉；为掌握证明补充可提交的输出骨架，并要求资料锚定、网页渐进展开与 Word 同步导出

- 日期：2026-07-13
- 摘要：启动深度掌握内容升级
- 接触点：`docs/study-material-generator/`、`src/`、`public/`、`test/`
- 行为：定义核心原理、边界判断与高价值策略契约，要求生成内容提供资料锚点、审题触发信号、理由化步骤和得分标准

- 日期：2026-07-13
- 摘要：启动快速掌握内容体系升级
- 接触点：`docs/study-material-generator/`、`src/`、`public/`、`test/`
- 行为：将讲义扩展为 13 个学习模块，定义 5 分钟启动、例题拆解和掌握证明，并建立按学科、年级、学习目标变化的生成规则

- 日期：2026-07-13
- 摘要：启动讲义可读性与手动输入改进
- 接触点：`public/`、`server.js`、`test/`、`docs/study-material-generator/`
- 行为：定义单层结果导航、讲义列内图解、无重叠知识地图，以及文件或手动文本二选一的生成契约

- 日期：2026-07-13
- 摘要：完成讲义布局修复、导航合并与手动输入
- 接触点：`public/`、`server.js`、`src/ai.js`、`test/api.test.js`、`docs/study-material-generator/`
- 行为：手动知识点可直接生成；结果页仅保留单层导航并提供导出菜单；6 节点知识地图和 6 步流程在桌面、手机与 PDF 中均无遮挡；17 项自动化测试、真实 AI 生成、15 页 PDF 和 Word 导出全部通过

- 日期：2026-07-13
- 摘要：启动产品体验、内容质量与价值表达深度改版
- 接触点：`docs/study-material-generator/`、`public/`、`src/ai.js`
- 行为：完成现状审计，确定“学习批注台”视觉方向和贯穿生成前后的学习路径轨道，保持现有 API 与数据契约不变

- 日期：2026-07-13
- 摘要：完成学习路径工作台与内容质量深度改版
- 接触点：`public/`、`src/ai.js`、`server.js`、`src/utils.js`、`test/`
- 行为：重构资料输入、目标设置、等待反馈和结果阅读；新增等待计时、阅读进度、专注模式与任务路径；强化证据、迁移练习和复习规则；修复中文上传文件名乱码；15 项自动化测试与桌面、手机浏览器验收通过

- 日期：2026-07-10
- 摘要：建立学习资料生成器的设计与契约基线
- 接触点：`docs/study-material-generator/`
- 行为：明确文件上传、AI 生成、演示回退、讲义结构与验证边界

- 日期：2026-07-10
- 摘要：完成文件解析、AI 生成和安全回退服务
- 接触点：`server.js`、`src/`、`package.json`
- 行为：支持图片、PDF、DOC、DOCX 上传，提供结构化讲义和无密钥演示模式

- 日期：2026-07-10
- 摘要：完成数字课本工作台与自学讲义界面
- 接触点：`public/index.html`、`public/styles.css`、`public/app.js`
- 行为：新增响应式上传、生成进度、知识图解、练习答案、学习打卡和打印导出

- 日期：2026-07-10
- 摘要：完成自动化测试和多视口浏览器验收
- 接触点：`test/`、`README.md`
- 行为：验证接口边界、图片上传、结构清洗、桌面与移动端交互，修复移动端横向越界

- 日期：2026-07-10
- 摘要：开始切换为强制真实 AI 模式
- 接触点：`.env`、`.env.example`、`docs/study-material-generator/`
- 行为：配置指定 AI 网关与模型，定义未配置和调用失败时的错误契约

- 日期：2026-07-10
- 摘要：完成强制真实 AI 模式切换与验证
- 接触点：`server.js`、`src/ai.js`、`src/material.js`、`public/`、`test/`、`README.md`
- 行为：删除示例入口和本地失败回退，真实网关生成成功，10 项自动化测试全部通过

- 日期：2026-07-10
- 摘要：开始建设 PDF 与 Word 双格式导出
- 接触点：`docs/study-material-generator/`
- 行为：定义完整讲义导出接口、文件响应、中文排版与视觉验收要求

- 日期：2026-07-10
- 摘要：完成 PDF 与 Word 双格式完整报告下载
- 接触点：`server.js`、`src/export/`、`public/`、`scripts/`、`test/`、`README.md`
- 行为：新增双导出接口和双下载按钮；PDF 复用网页完整讲义渲染，Word 生成原生可编辑 A4 DOCX；补充中文文件名、错误处理、导出依赖和自动化测试

- 日期：2026-07-10
- 摘要：完成下载文件的内容、排版和可用性验收
- 接触点：`output/pdf/学习资料完整报告-验收.pdf`、`output/docx/学习资料完整报告-验收.docx`
- 行为：14 项自动化测试全部通过；PDF 15 页逐页渲染检查无乱码、裁切和错位；Word 可被 Microsoft Word 正常打开并完成中文正文、表格和图示检查；浏览器真实点击两种下载均成功

- 日期：2026-07-10
- 摘要：修复本地后台退出后 PDF 与 Word 下载断线
- 接触点：`public/app.js`、`public/styles.css`、本地运行进程
- 行为：将导出服务改为独立后台运行；前端定时刷新健康状态，下载连接中断时显示明确中文恢复提示并同步更新服务状态；修正长内容下“逐段精读”打印列表整块换页造成的空白页

- 日期：2026-07-10
- 摘要：优化首页讲义插画与首屏视觉层级
- 接触点：`public/index.html`、`public/styles.css`
- 行为：将负定位悬浮插画重构为内容流内的“讲义成品预览”区域，消除学习步骤遮挡和底部裁切；针对宽屏、笔记本与手机分别调整尺寸、留白和露出范围

- 日期：2026-07-10
- 摘要：修正首页中文孤行与词组断行
- 接触点：`public/index.html`、`public/styles.css`
- 行为：介绍正文改为两句语义完整的短句，避免“复习。”单独成行或“难点”被拆开；讲义预览标题按语义分成固定两行，避免“学习”被拆开

- 日期：2026-07-13
- 摘要：完成资料证据驱动学习闭环
- 接触点：`src/material.js`、`src/ai.js`、`public/app.js`、`public/styles.css`、`src/export/docx.js`、`test/`、`docs/study-material-generator/`
- 行为：提炼并校验资料证据编号；将学习目标、策略、例题、练习与掌握证明连接为可追溯的学习路径；网页与 Word 同步展示资料证据库，并完成真实数学讲义的桌面和手机验收

- 日期：2026-07-13
- 摘要：收束 Word 为三段自学讲义
- 接触点：`src/export/docx.js`、`test/export.test.js`、`docs/study-material-generator/`
- 行为：Word 改为学习任务、三个关键学习单元、自测与复习；每条路线仅保留关键判断、短解释、示范、独立练、完成标准与资料依据，复用示范不再重复完整题干、步骤和答案

- 日期：2026-07-13
- 摘要：完成课堂学习讲义的内容与视觉收束
- 接触点：`public/index.html`、`public/app.js`、`public/styles.css`、`src/ai.js`、`src/material.js`、`src/export/docx.js`、`test/material.test.js`、`docs/study-material-generator/`
- 行为：标题与全量展示文案统一清理学习方式包装词；网页改为目标、规则、练习、检查四步讲义，加入 ASCII 做题顺序图和单列白话规则解释；导出菜单合并复制提纲；完成桌面、390×844 移动端、PDF 页面渲染与 Word 回读验收

- 日期：2026-07-13
- 摘要：完成关键规则讲解深化与中文排版修复
- 接触点：`src/ai.js`、`src/material.js`、`test/material.test.js`、`public/app.js`、`public/styles.css`、`docs/study-material-generator/`
- 行为：关键规则补齐白话解释、例子、记忆提示和检查动作；网页将补充内容收束为单列短检查；掌握检查强制覆盖旧三栏网格，在桌面与 390×844 宽度下均保持可读、无横向溢出

- 日期：2026-07-13
- 摘要：将精简讲义升级为十栏目完整学习资料册
- 接触点：`public/index.html`、`public/app.js`、`public/styles.css`、`src/ai.js`、`src/material.js`、`src/export/docx.js`、`test/api.test.js`、`test/material.test.js`、`test/export.test.js`、`docs/study-material-generator/`
- 行为：强制生成重点、策略、精读、词典、图解、易错、例题、练习与掌握证明等完整栏目；网页改为十栏目书脊目录和连续单列正文；知识地图改为自然撑高网格；移动目录改为横向滚动；Word 恢复四大完整章节；完成真实 AI 生成、桌面/移动端溢出、答案折叠和 26 项自动化测试验收

- 日期：2026-07-13
- 摘要：完成系统知识完整性、策略排版与 ASCII 图解升级
- 接触点：`src/ai.js`、`src/material.js`、`public/app.js`、`public/styles.css`、`src/export/docx.js`、`test/`、`docs/study-material-generator/`
- 行为：系统性知识节点上限扩展到 16，英语时态强制覆盖 4×4 的 16 种常见时态；新增“图解知识点”栏目和两张等宽 ASCII 图；网页、复制提纲与 Word 同步输出；清理“补充讲解”；修复策略自动网格导致的竖排；完成桌面、手机、Word 回读和 29 项自动化测试验收

- 日期：2026-07-13
- 摘要：将内容完整性升级为适用于任意知识点的通用契约
- 接触点：`src/ai.js`、`src/material.js`、`public/app.js`、`public/styles.css`、`public/index.html`、`src/export/docx.js`、`test/`、`docs/study-material-generator/`
- 行为：新增有限体系、开放体系、单一概念三种覆盖模式；知识节点扩展至 6—32 项并支持分类成员；增加生成后覆盖审计和一次自动修订；网页与 Word 显示覆盖范围和成员；图解卡片桌面左右内缩、手机满宽；真实英语介词结果覆盖 8 类和 65 个常用成员

- 日期：2026-07-14
- 摘要：开始重构结果页为舒适阅读型现代教辅界面
- 接触点：`public/index.html`、`public/app.js`、`public/reader.css`、`docs/study-material-generator/`
- 行为：移除结果页方格展示板视觉；新增冷灰与白纸阅读系统；十栏目目录改为四阶段分组；重构封面路线、章节层级、模块边界与移动端阅读布局

- 日期：2026-07-14
- 摘要：完成结果页舒适阅读视觉重构与多端验收
- 接触点：`public/reader.css`、`public/app.js`、`output/playwright/`、`test/`
- 行为：完成 1440、1024、390 三档真实页面验收；修复目录状态与滚动位置同步；确认 ASCII 仅容器内滚动、答案与导出交互正常、控制台无错误，33 项测试全部通过

- 日期：2026-07-14
- 摘要：开始第一性字号重构与对抗式视觉审查
- 接触点：`public/reader.css`、`docs/study-material-generator/`
- 行为：建立封面、章节、内容标题、正文、说明和标签六级类型比例；收束宋体使用范围，提高卡片内容最小字号并加入长标题平衡换行

- 日期：2026-07-14
- 摘要：完成第一性排版重构和多学科对抗式验收
- 接触点：`public/reader.css`、`output/playwright/`、`test/`、`docs/study-material-generator/`
- 行为：桌面与手机分别形成 46/29/20/15.5 和 31/24/18/15.5 的主要字号层级；数学公式、英文、长题干、图解和答案在三档视口无页面溢出，33 项测试通过

- 日期：2026-07-14
- 摘要：开始修正一级章节层级并重构内容语义包装
- 接触点：`public/app.js`、`public/reader.css`、`docs/study-material-generator/`
- 行为：十个正文栏目改为完整章节封面条；桌面与手机一级标题提升为 40 与 30 像素；目录补齐四阶段完整语义；重点、策略、易错、例题、练习与掌握证明按判断、边界、证据和风险重新包装

- 日期：2026-07-14
- 摘要：完成一级章节层级、语义包装与多端回归验收
- 接触点：`public/app.js`、`public/reader.css`、`output/playwright/`、`test/`、`docs/study-material-generator/`
- 行为：修复章节序号旧底色和手机章节条右侧未铺满问题；验证十个 H2 章节在桌面 40px、手机 30px，四阶段目录同步定位，练习答案与掌握标准语义清楚；三档视口无横向溢出，控制台无错误，33 项测试通过

- 日期：2026-07-14
- 摘要：移除资料索引与全文资料锚点并修复浅色卡片白字
- 接触点：`public/app.js`、`public/reader.css`、`docs/study-material-generator/`、`output/playwright/`
- 行为：网页不再渲染资料索引、资料锚点、本题依据和相关跳转控件；显式重置例题题目、完整答案、自检点和复习计划文字颜色；完成桌面、手机和全页对比度扫描验收

- 日期：2026-07-14
- 摘要：统一产品品牌并重构首页阶段轨道与 Word 完整报告
- 接触点：`public/index.html`、`public/styles.css`、`public/app.js`、`server.js`、`src/export/docx.js`、`test/export.test.js`、`docs/study-material-generator/`
- 行为：产品显示名统一为“学习资料生成器”；首页四阶段改为稳定响应式网格；Word 保留完整栏目并改用浅色语义块、单列长内容、统一字号和独立阶段分页，同时删除可见资料索引与资料锚点；完成三档浏览器验收、29 页 Microsoft Word 逐页渲染检查和 33 项自动化回归

- 日期：2026-07-14
- 摘要：启动 AI JSON 容错与权威学科优先级修复
- 接触点：`src/utils.js`、`src/material.js`、`src/ai.js`、`public/`、`test/`、`docs/study-material-generator/`
- 行为：定义模型 JSON 的本地安全修复与一次格式修复请求，并规定手动选择和用户输入中的明确学科高于模型输出

- 日期：2026-07-14
- 摘要：完成 AI JSON 容错与权威学科锁定
- 接触点：`src/utils.js`、`src/material.js`、`src/ai.js`、`public/index.html`、`public/app.js`、`test/`、`output/playwright/subject-detection/`
- 行为：支持控制字符和尾随逗号本地修复、缺失结构一次 AI 格式修复、失败信息脱敏；自动识别显示确认学科，模型冲突时自动修订且最终不能覆盖用户学科；真实“语文作文”生成与 38 项测试通过
- 日期：2026-07-14
- 摘要：启动全学科公式与符号统一渲染修复
- 接触点：`src/ai.js`、`src/formula.js`、`src/export/`、`public/`、`server.js`、`test/`、`docs/study-material-generator/`
- 行为：建立覆盖全部生成字段的 LaTeX 内容契约、公式审计、网页/PDF 本地 KaTeX 渲染和 Word 公式图片嵌入方案；覆盖数学、物理、化学、生物、地理等学科，不再按知识点维护零散替换规则
- 日期：2026-07-14
- 摘要：完成全学科公式与符号统一渲染及跨端验收
- 接触点：`src/formula.js`、`src/utils.js`、`src/ai.js`、`public/app.js`、`public/index.html`、`public/reader.css`、`public/styles.css`、`src/export/formula-image.js`、`src/export/docx.js`、`src/export/pdf.js`、`server.js`、`test/`、`scripts/verify-formulas.js`
- 行为：生成内容统一采用 LaTeX/mhchem；全字段审计并在归一化后复核；网页和 PDF 使用本地 KaTeX；Word 使用公式透明图片；修复打印竖排、孤立标点、结构编号误报和公式截断；真实物理生成 212 个公式无审计问题，网页 PDF 26 页与 Word PDF 29 页逐页验收通过

- 日期：2026-07-14
- 摘要：启动并实现参考“赛博出卷机”的全学科教学图形链路
- 接触点：`赛博出卷机/`、`.gitignore`、`src/figure-specs.js`、`src/figures.js`、`src/ai.js`、`src/material.js`、`src/formula.js`、`server.js`、`public/app.js`、`public/reader.css`、`src/export/docx.js`、`test/`、`docs/study-material-generator/`
- 行为：严格对照指定参考项目的数据协议、图形规范、AI SVG 渲染、400×300 视口、安全校验、重试缓存、模板兜底、批量加载和 Word 图片转换；新增 `teachingFigures`，把真实学科图形挂到知识图解、例题和练习；53 项自动化测试通过，进入真实浏览器和双格式导出验收

- 日期：2026-07-14
- 摘要：完成参考“赛博出卷机”的全学科教学图形链路与跨端验收
- 接触点：`src/figure-specs.js`、`src/figures.js`、`src/ai.js`、`src/material.js`、`server.js`、`public/app.js`、`public/reader.css`、`src/export/docx.js`、`scripts/verify-teaching-figures.js`、`test/`、`docs/study-material-generator/`
- 行为：核对参考项目 9 个学科规则和 14 个图形类型无缺失；完成桌面/手机 Edge、29 页浏览器 PDF、4 张 Word 高清教学图与 OOXML 版面关系验收；新增 Word SVG 转 PNG 回归，54 项自动化测试全部通过

- 日期：2026-07-15
- 摘要：完成图解知识点 SVG 化与结果页排版修复
- 接触点：`src/figures.js`、`src/ai.js`、`src/material.js`、`public/app.js`、`public/reader.css`、`public/styles.css`、`src/export/docx.js`、`test/ai.test.js`、`test/material.test.js`、`test/figures.test.js`、`test/export.test.js`、`docs/study-material-generator/`
- 行为：移除 knowledgeDiagrams 的 ASCII 契约；D1/D2、V1/V2、E1/E2、P1—P4 默认使用参考项目式 SVG；增加 12 张上限、圆柱等实体语义校验和原位图形更新；修复 KaTeX 逐字竖排与 Word ASCII 深色块；55 项测试、桌面/手机真实页面检查通过

- 日期：2026-07-15
- 摘要：补齐全学科 SVG 回退图并拦截通用占位图
- 接触点：`src/figures.js`、`test/figures.test.js`、`docs/study-material-generator/`
- 行为：为细胞、遗传、生态、句法、经纬网和地形等内容增加学科结构化 SVG 兜底；AI 返回“要素 A / 要素 B / 结果”占位图时自动判定无效并回退到可读教学图；57 项自动化测试、Edge 桌面/手机真实页面和 PDF/Word 图形验收通过

- 日期：2026-07-15
- 摘要：完成图形引用、公式和练习选项的对抗式回归修复
- 接触点：`public/app.js`、`public/reader.css`、`public/styles.css`、`src/figures.js`、`src/ai.js`、`server.js`、`scripts/verify-teaching-figures.js`、`test/figures.test.js`、`docs/study-material-generator/`
- 行为：恢复 KaTeX vlist 原生布局，修复上标/下标纵向拆分；将练习图移动到题干之后、选项之前；收窄选项徽标选择器，避免误伤公式内部 span；所有出现“如图/图中”的重点、策略、精读、易错、例题、练习和掌握模块自动就近补图；服务端拒绝不完整 SVG，浏览器验收新增公式、图形错误、图题顺序和选项布局检查；58 项自动化测试与真实 Edge/PDF/Word 验收通过

- 日期：2026-07-15
- 摘要：修复化学选择题质量复核误报，保持严格生成门槛
- 接触点：`src/formula.js`、`src/ai.js`、`test/formula.test.js`、`test/ai.test.js`、`docs/study-material-generator/`
- 行为：单字母选项 `A/B/C/D` 不再被误判为化学元素，真实“元素 B”“Fe 与酸反应”等化学语境仍强制使用 `\ce{...}`；未降低公式审计、知识覆盖、图形和内容完整性要求，AI 质量复核仍只接受完整结果，不返回讲义兜底内容

- 日期：2026-07-15
- 摘要：将符号审计升级为全学科字段角色与语境判断
- 接触点：`src/formula.js`、`test/formula.test.js`、`docs/study-material-generator/`
- 行为：审计同时识别学科、字段角色和上下文；语文、数学、英语、物理、化学、生物、历史、地理、道德与法治中的选择题标签、答案字母及“选择 B/B 项正确”等表达不再误报；数学公式、物理量与单位、化学式、遗传组合、经纬度、比例尺和百分数等真实未规范表达仍逐项拦截

- 日期：2026-07-15
- 摘要：启动生成成功率与跨学科 SVG 一致性修复
- 接触点：`src/ai.js`、`src/formula.js`、`src/figures.js`、`src/figure-specs.js`、`test/`、`scripts/`、`docs/study-material-generator/`
- 行为：将公式问题从整份 JSON 重写改为字段级精确修订；定义权威学科优先的 SVG 路由、跨学科冲突拒绝与图形视觉质量门槛

- 日期：2026-07-15
- 摘要：完成生成成功率、权威学科图形路由与 SVG 精细度修复
- 接触点：`src/ai.js`、`src/formula.js`、`src/figures.js`、`src/figure-specs.js`、`server.js`、`test/`、`docs/study-material-generator/`
- 行为：修复 `since` 被误判为 `sin`；公式按路径精确修订；主 AI 请求对 429 与 5xx 自动退避重试；图形以 `meta.subject` 为权威学科，使用组合式跨学科冲突证据，拒绝地理细胞图且不误伤合法交叉术语

- 日期：2026-07-15
- 摘要：完成参数化 SVG 计算、标签来源与排版对抗审计
- 接触点：`src/figures.js`、`src/ai.js`、`test/figures.test.js`、`test/ai.test.js`、`output/playwright/`
- 行为：函数、坐标、柱状、折线、扇形和气候图按参数计算；新增图元密度、标签数量、题意外文字、越界、父分组样式继承和重叠审计；真实洋流/二次函数/气候图无错学科与可见碰撞，真实“英语时态”生成返回 200 且公式/图形审计均为 0

- 日期：2026-07-15
- 摘要：修复公式标签污染、跨栏目重复图和图形窄列排版
- 接触点：`src/figures.js`、`src/ai.js`、`server.js`、`public/app.js`、`public/reader.css`、`public/styles.css`、`test/`、`docs/study-material-generator/`
- 行为：移除轮流借用 D1/D2 的自动补图；建立 D/V/E/P 固定图位和 K/S/C/X/M 专属图位；按教学职责和主体几何签名拦截重复图；业务 CSS 不再覆盖 KaTeX 内部布局；内嵌图形统一跨越父网格完整正文列

- 日期：2026-07-15
- 摘要：完成图形上限、无效 refId、审计顺序与最终几何去重闭环
- 接触点：`src/material.js`、`src/figures.js`、`src/ai.js`、`server.js`、`test/`、`docs/study-material-generator/`
- 行为：统一 28 张上限并确保 P4 不被裁掉；模型中文 refId 按栏目局部序号纠正；完整正文先补 placement 再审计；重复主体最多三轮差异化重绘并逐轮验签；真实 13 图请求最终重复签名为 0

- 日期：2026-07-16
- 摘要：启动原子化生成、图形待绘状态与断线恢复改造
- 接触点：`src/figures.js`、`src/ai.js`、`server.js`、`public/app.js`、`public/reader.css`、`test/`、`docs/study-material-generator/`
- 行为：定义未完成图形不携带 SVG、只显示进度画布；内容审计不检查待绘 SVG；生成请求使用任务键复用、自动重连和内部恢复；批量图形限流并逐项隔离

- 日期：2026-07-16
- 摘要：完成原子化生成、图形进度态与首次失败恢复验收
- 接触点：`src/figures.js`、`server.js`、`public/app.js`、`public/reader.css`、`test/ai.test.js`、`test/api.test.js`、`test/figures.test.js`、`test/layout.test.js`、`test/material.test.js`、`docs/study-material-generator/`
- 行为：待绘图不再携带或显示临时 SVG；生成任务按键幂等复用并自动恢复；图形限流、逐项隔离且旧响应无法串入新资料；95 项测试通过，真实物理首帧无重复临时图，最终 15 图无重复签名、接口全 200、桌面与手机无溢出
## 2026-07-16（渐进式无兜底图形流水线启动）

- 根据真实反馈重新审计图形首屏时间，确认整批响应屏障会让已完成图被最后一张慢图阻塞。
- 确认单图三轮固定 80 秒和批量并发 3 会放大尾部延迟。
- 决定改为五路单图原子任务、会话级实时判重和同模型持续质量重绘。
- 明确删除在线与导出生产链路中的本地规则图兜底；模型、图形数量、`max_tokens` 和完整质量门槛保持不变。

## 2026-07-16（渐进式无兜底图形流水线完成）

- 结果页从整批等待改为五路单图原子任务，首图完成即显示，慢图不再阻塞快图。
- 单图请求复用会话 ID，服务端实现进行中任务合并、成品复用、实时几何签名认领和同模型差异化重绘。
- 图形请求使用 40 秒无响应熔断，模型与 5000 token 不变；HTTP 202 表示自动质量恢复，不产生正常流程的资源错误。
- 删除 AI 图形、接口校验、重复图与导出链路中的本地兜底；PDF/Word 只接收全部完成且重新通过语义校验的图形。
- 修复栏目职责与学科关键词冲突：策略路径图等先按教学职责选择信息架构，再在图中呈现真实学科对象。
- 101 项测试通过；真实物理讲义最终 10/10 SVG、几何重复 0、桌面与手机溢出 0，下载门槛正确。

## 2026-07-16（图形加载提示收束）

- 图形生成画布只显示“图形正在生产中”和动态进度条。
- 删除学生无需理解的 SVG 精绘说明、等待/精绘/复核阶段标签及自动恢复轮次；后台质量复核、同模型重试与无障碍状态保持不变。

- 日期：2026-07-16
- 摘要：启动 PDF 与 Word 导出排版重构
- 接触点：`public/`、`src/export/pdf.js`、`src/export/docx.js`、`scripts/`、`test/`、`docs/study-material-generator/`
- 行为：以网页完整报告为 PDF 内容基准，定义单列分页与原子防拆分边界；Word 采用统一 A4 设计令牌、固定表格几何和逐页渲染验收，重点消除重叠、裁切、异常留白和层级混乱

- 日期：2026-07-16
- 摘要：完成 PDF 与 WPS Word 导出排版重构及全页验收
- 接触点：`public/export-print.css`、`public/index.html`、`src/export/pdf.js`、`src/export/docx.js`、`scripts/verify-exports.js`、`test/layout.test.js`、`docs/study-material-generator/`
- 行为：PDF 清除新旧分页属性冲突、跨页空框并新增越界/重叠/空白页导出闸门；Word 统一 A4 几何、固定表格、真实列表和线性标签结构，取消正文机械分页；PDF 31 页和 WPS Word 25 页全页渲染均无空白页，103 项测试通过

- 日期：2026-07-17
- 摘要：启动图形后台任务与公平轮转改造
- 接触点：`server.js`、`public/app.js`、`test/api.test.js`、`test/layout.test.js`、`docs/study-material-generator/`
- 行为：针对慢图占满前端 worker、长连接先于 AI 多轮精绘超时和断线后缺少独立任务状态的问题，定义服务端后台持续生成、HTTP 短轮询、失败任务公平回队和只发布最终合格 SVG 的统一契约；保持原模型、提示词、5000 token 和全部质量审计不变

- 日期：2026-07-17
- 摘要：完成图形后台任务、公平轮转与断线恢复验收
- 接触点：`server.js`、`public/app.js`、`test/api.test.js`、`test/layout.test.js`、`docs/study-material-generator/`、`.learnings/LEARNINGS.md`
- 行为：单图接口改为快速返回 `queued/running/retrying/ready` 状态，AI 生成在会话后台持续执行；服务端五路公平队列与前端按 `nextAttemptAt` 原子轮询共同消除慢图占槽，30 分钟客户端租约避免废弃会话永久消耗资源；106 项测试和真实浏览器失败恢复验收通过，生产模型、提示词、质量参数、语义审计及无兜底约束均未改变

- 日期：2026-07-17
- 摘要：启动图形终态收敛与浏览器发布握手改造
- 接触点：`server.js`、`src/ai.js`、`public/app.js`、`test/`、`docs/study-material-generator/`
- 行为：针对单任务内部多轮差异化长期占槽、上游永久不结束和浏览器拒绝成品后反复读取同一 SVG 的问题，定义单候选原子配额、可中止看门狗、迟到响应隔离及 `renderVersion/rejectedRenderVersion` 发布握手；模型、基础提示词、质量参数和审计门槛保持不变

- 日期：2026-07-17
- 摘要：完成图形终态收敛、发布拒绝重生与长尾对抗验收
- 接触点：`server.js`、`src/ai.js`、`public/app.js`、`test/`、`docs/study-material-generator/`、`.learnings/`
- 行为：差异化精绘按单候选释放并发槽；135 秒看门狗中止上游并隔离迟到响应；浏览器通过内容版本拒收不可解析成品并触发同模型重生；111 项测试及 12 任务浏览器对抗场景全部收敛，最终 8/8 可见图位显示不同 SVG，导出恢复可用

- 日期：2026-07-17
- 摘要：启动 Word 原生可编辑公式改造
- 接触点：`src/export/docx.js`、`src/export/word-math.js`、`test/`、`scripts/`、`docs/study-material-generator/`
- 行为：将 Word 公式契约从 PNG 图片改为原生 Office Math，定义 MathJax 语义树到 OMML 的统一转换、跨学科结构覆盖、导出后 XML 回读和禁止公式图片的质量闸门

- 日期：2026-07-17
- 摘要：完成 Word 原生可编辑公式改造与 WPS 全页验收
- 接触点：`src/export/word-math.js`、`src/export/docx.js`、`scripts/verify-formulas.js`、`package.json`、`test/`、`docs/study-material-generator/`、`.learnings/LEARNINGS.md`
- 行为：数学、物理、化学、生物和地理公式统一转换为 OMML，知识地图改用原生表格并保留节点公式；DOCX 回读闸门禁止公式图片、原始 LaTeX 和空结构；最终文件含 70 个可编辑公式，WPS 26 页逐页通过，115 项测试全部通过
