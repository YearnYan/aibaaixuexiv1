# AI 错因判断网站

这是《AI 赋能教师提分课》第 4 课的可运行工具。教师或学生上传原题并保留学生原始答案/过程后，系统通过真实 AI 模型定位第一个关键错误，并输出六模块诊断报告。

## 本地运行

环境要求：Node.js 20 或更高版本。

```powershell
npm install
npm start
```

浏览器打开：

- 主页面：`http://localhost:3000/`
- AI 配置：`http://localhost:3000/settings.html`

若 `3000` 端口被占用：

```powershell
$env:PORT=4173
npm start
```

## 首次配置

1. 打开 AI 配置页。
2. 选择提供商，填写 OpenAI 兼容接口地址、模型名称和 API 密钥。
3. 点击“保存并测试”。
4. 测试通过后返回主页面上传题目。

支持 OpenAI、通义千问、Kimi、DeepSeek、Ollama 和自定义 OpenAI 兼容接口。图片材料要求所选模型支持视觉输入；纯文本模型只能分析从 PDF/Word 中提取的文字。

## 输入与报告

输入：

- 学科
- PDF、DOC、DOCX、PNG、JPG 或 JPEG 题目文件，最大 20MB
- 学生原始答案与完整作答过程
- 可选的正确答案、标准过程、评分标准和学生自判

报告：

- 首个错误位置
- 错误证据
- 错因类型
- 后续错误链
- 学生自判与 AI 判断差异
- 下一步纠正动作

信息不足时，系统会返回“信息不足，无法确定”并要求教师复核，不猜测首错。

## 公式与报告下载

- 数学、物理、化学、生物、地理等学科公式统一使用 LaTeX 规范，并在网页中通过 KaTeX/mhchem 渲染。
- AI 返回的公式会先经过服务端规范化和严格校验；无法渲染时自动要求模型修正，不展示半渲染结果。
- 报告生成后可下载 A4 PDF 或 Word 文档。PDF 的六个模块优先整体换页，不在页尾切开；页脚包含状态、页码和置信度。
- Word 正文为可编辑文本，全部公式转换为 Word/WPS 原生 OMML 公式对象，可直接点选、修改和重新排版；导出失败时不会降级为图片。

## 安全配置

- API 密钥保存在服务器的 `data/ai-config.json`，该文件已被 Git 忽略；也可通过 `.env.example` 中的环境变量提供。
- 浏览器无法读取服务器保存的 API 密钥。
- 题目、学生答案和报告不会写入数据库或本地文件。
- 部署到公网时必须设置 `ADMIN_PASSWORD` 并使用 HTTPS。

```powershell
$env:ADMIN_PASSWORD='请替换为高强度密码'
npm start
```

## 验证

```powershell
npm run check
npm test
```

当前自动化测试覆盖导出接口、跨学科公式、PDF 分页规则、Word 原生公式结构、公式数量守恒、零公式图片和转换失败拒绝策略。

详细的实施边界、API 契约与任务记录位于 `docs/ai-error-diagnosis/`。
