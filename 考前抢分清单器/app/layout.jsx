import "./globals.css";
import { cookies, headers } from "next/headers";

function resolveHomeUrl(requestHeaders) {
  const configured = String(process.env.AIBA_HOME_URL || "").trim();
  if (configured) return new URL(configured).toString();

  const forwardedHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "127.0.0.1:4173";
  const forwardedProto = (requestHeaders.get("x-forwarded-proto") || "http").split(",")[0].trim();
  const host = forwardedHost.split(",")[0].trim();
  const localHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  const targetHost = localHost && !/:(4173|443|80)$/u.test(host)
    ? `${host.replace(/:\d+$/u, "")}:4173`
    : host;
  return `${forwardedProto === "https" ? "https" : "http"}://${targetHost}/`;
}

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI考前抢分清单",
  description: "上传学习资料，生成个性化考前抢分报告"
};

export default async function RootLayout({ children }) {
  const requestHeaders = await headers();
  const homeUrl = resolveHomeUrl(requestHeaders);
  const loginUrl = new URL("?login=1", homeUrl).toString();
  const redeemUrl = new URL("?redeem=1", homeUrl).toString();
  const logoUrl = new URL("assets/logo.jpg", homeUrl).toString();
  const profileCookie = (await cookies()).get("aiba_profile")?.value;
  let profile = null;
  if (profileCookie) {
    try {
      profile = JSON.parse(decodeURIComponent(profileCookie));
    } catch (_error) {
      profile = null;
    }
  }
  const points = Number.isFinite(Number(profile?.points)) ? Number(profile.points) : 0;
  const accountLabel = profile ? `${profile.username} · ${points} 积分` : "注册 / 登录";

  return (
    <html lang="zh-CN">
      <body>
        <nav className="site-nav aiba-subsite-nav" aria-label="主导航">
          <a className="brand" href={homeUrl} aria-label="艾爸AI学习首页">
            <img src={logoUrl} alt="艾爸AI学习" />
            <span><strong>艾爸AI学习</strong><small>K12 智能学习工具</small></span>
          </a>
          <div className="nav-actions">
            <a className="nav-button nav-button-light nav-account-button" href={loginUrl} data-aiba-account-action data-state={profile ? "signed-in" : "signed-out"}>
              {accountLabel}
            </a>
            <a className="nav-button nav-button-solid" href={redeemUrl}>积分兑换</a>
            <a className="nav-button nav-button-light nav-button-purchase" href="https://catfk.com/shop/RJUNDGF1" target="_blank" rel="noreferrer">积分购买</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
