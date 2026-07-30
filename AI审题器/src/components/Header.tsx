import { ArrowLeft } from "lucide-react";

interface HeaderProps {
  configPage?: boolean;
}

export function Header({ configPage = false }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <h1>{configPage ? "AI配置" : "AI审题训练"}</h1>
        <span className="brand-divider" aria-hidden="true" />
        <p>{configPage ? "连接真实模型，保存后即可开始分析" : "先证明读准，再开始解题"}</p>
      </div>
      {configPage ? (
        <a className="header-icon-button" href="/" title="返回审题训练" aria-label="返回审题训练">
          <ArrowLeft size={22} />
        </a>
      ) : null}
    </header>
  );
}
