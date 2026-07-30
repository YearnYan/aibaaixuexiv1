/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth"],
  // 主站会读取并注入子站 HTML，压缩统一交给主站或外层 Nginx。
  compress: false
};

export default nextConfig;
