# 知识查缺补漏器

单页面 AI 学习诊断网站。用户上传试卷、作业或测验资料后，系统会调用 AI 生成知识点地图、严重程度、优先级、30 天路线和专业完整诊断报告。

## 启动

```bash
npm install
copy .env.example .env
npm start
```

启动后按终端输出访问本地地址，例如 `http://localhost:3000`。

## 环境变量

- `AI_BASE_URL`：AI 网关地址
- `AI_MODEL`：模型名称
- `AI_API_KEY`：AI 接口密钥
- `PORT`：本地端口，端口被占用时会自动顺延
