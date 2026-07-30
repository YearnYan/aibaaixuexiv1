// 卷后提分已接入主站 Cloudflare Pages Functions。
// 旧版独立 Express/OpenAI 服务端已清除，避免继续读取子站本地 AI API 配置。
// 线上接口统一位于 /api/site/post-exam-boost/*，AI Provider 由管理员后台配置。

throw new Error('卷后提分不再提供独立 server.js，请通过主站 /卷后提分/ 访问。');
