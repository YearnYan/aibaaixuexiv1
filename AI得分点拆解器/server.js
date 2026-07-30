require("dotenv").config();

const path = require("node:path");
const { createApp } = require("./src/create-app");
const { ConfigStore } = require("./src/config-store");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || process.env.BIND_HOST || "127.0.0.1";
const configStore = new ConfigStore({
  dataDir: path.join(__dirname, ".data"),
  env: process.env,
});

const app = createApp({ configStore, env: process.env });
const server = app.listen(port, host, () => {
  console.log(`AI 得分点拆解网站已启动：http://${host}:${port}`);
  console.log(`AI 配置页面：http://${host}:${port}/config`);
});

function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭服务...`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
