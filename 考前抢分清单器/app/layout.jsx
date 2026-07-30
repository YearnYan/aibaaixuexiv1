import "./globals.css";

export const metadata = {
  title: "AI考前抢分清单",
  description: "上传学习资料，生成个性化考前抢分报告"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
