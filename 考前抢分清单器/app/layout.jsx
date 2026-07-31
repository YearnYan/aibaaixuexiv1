import "./globals.css";

const homeUrl = process.env.AIBA_HOME_URL || "http://127.0.0.1:4173/";
const loginUrl = `${homeUrl}?login=1`;
const redeemUrl = `${homeUrl}?redeem=1`;
const logoUrl = new URL("assets/logo.jpg", homeUrl).toString();

export const metadata = {
  title: "AI考前抢分清单",
  description: "上传学习资料，生成个性化考前抢分报告"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="site-nav aiba-subsite-nav" aria-label="主导航">
          <a className="brand" href={homeUrl} aria-label="艾爸AI学习首页">
            <img src={logoUrl} alt="艾爸AI学习" />
            <span><strong>艾爸AI学习</strong><small>K12 智能学习工具</small></span>
          </a>
          <div className="nav-actions">
            <a className="nav-button nav-button-light" href={loginUrl}>注册 / 登录</a>
            <a className="nav-button nav-button-solid" href={redeemUrl}>积分兑换</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
