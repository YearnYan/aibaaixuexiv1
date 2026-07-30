import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface AnalysisCardProps {
  number: string;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  footer: string;
}

export function AnalysisCard({ number, title, icon: Icon, children, footer }: AnalysisCardProps) {
  return (
    <section className="analysis-card">
      <header className="analysis-card-header">
        <span className="card-number">{number}</span>
        <Icon className="card-icon" size={26} strokeWidth={2} aria-hidden="true" />
        <h3>{title}</h3>
        <span className="card-check" aria-label="已完成识别">
          <Check size={18} strokeWidth={3} />
        </span>
      </header>
      <div className="analysis-card-content">{children}</div>
      <p className="analysis-card-footer">{footer}</p>
    </section>
  );
}
