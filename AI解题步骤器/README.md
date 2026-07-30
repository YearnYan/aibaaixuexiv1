# AI 解题步骤器

一个面向教师和学生的单功能网站：上传题目材料后，AI 自动识别学科与年级，直接给出“读懂已知、确定方法、列式求解、检验作答”四步指导和第 5 个完整答案模块。用户无需填写步骤答案或等待 AI 判分。

网页使用 KaTeX 渲染数学、物理、化学、生物、地理等学科公式；结果可下载为不切割逻辑内容的 A4 PDF，或包含原生可编辑段落与 Word 数学公式的 DOCX。

## 本地运行

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

- 主工具：`http://127.0.0.1:5173/`
- AI 配置：`http://127.0.0.1:5173/config`

首次使用先进入 AI 配置页，填写 OpenAI 兼容接口地址、密钥与支持当前材料类型的模型，并执行连接测试。

## 生产运行

```powershell
npm run build
$env:ADMIN_PASSWORD='请设置高强度密码'
npm start
```

生产服务默认运行在 `http://127.0.0.1:8787`，同时提供静态页面和 API。公开部署必须设置 `ADMIN_PASSWORD`，建议同时通过平台密钥管理设置 `AI_API_KEY` 与 `CONFIG_ENCRYPTION_KEY`。

## 支持材料

- PDF：提取文本型 PDF 内容；扫描版 PDF 建议转为 PNG/JPG 上传。
- Word：支持 DOCX；旧版 DOC 需先另存为 DOCX。
- 图片：PNG、JPG、JPEG、WEBP，需要配置支持视觉输入的模型。
- 文本：TXT、MD。

单文件最大 10 MB。主页面的学科和年级默认自动识别，无需手动填写。

主页面不会展示 AI 配置入口、模型名称或配置状态。配置页仅供管理员通过直达地址访问。
