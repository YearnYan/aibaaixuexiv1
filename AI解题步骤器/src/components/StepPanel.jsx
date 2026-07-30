import {
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  Lightbulb,
} from 'lucide-react';
import ScientificText from './ScientificText.jsx';

const HINT_LABELS = [
  '一级指导',
  '二级指导',
  '三级指导',
];

export default function StepPanel({
  step,
  total,
  isActive,
  onToggle,
}) {
  return (
    <section className={`step-row${isActive ? ' is-active' : ''}`}>
      <button
        className="step-number"
        type="button"
        onClick={onToggle}
        aria-label={`查看第 ${step.index + 1} 步：${step.title}`}
        aria-expanded={isActive}
      >
        {String(step.index + 1).padStart(2, '0')}
      </button>
      <div className="step-content">
        <button
          className="step-heading step-heading-button"
          type="button"
          onClick={onToggle}
          aria-expanded={isActive}
        >
          <div>
            {isActive && <span className="current-step">当前第 {step.index + 1} / {total} 步</span>}
            <h2>{step.title}</h2>
            {!isActive && <ScientificText as="div" className="step-description">{step.description}</ScientificText>}
          </div>
          {isActive ? <ChevronUp size={34} aria-hidden="true" /> : <ChevronRight size={34} aria-hidden="true" />}
        </button>

        {isActive && (
          <div className="step-detail">
            <div className="step-task"><strong>本步重点：</strong><ScientificText as="span">{step.task}</ScientificText></div>

            <div className="ai-guidance">
              <CheckCircle2 size={25} aria-hidden="true" />
              <div>
                <strong>AI 解题指导</strong>
                <ScientificText>{step.guidance}</ScientificText>
              </div>
            </div>

            <div className="hint-grid" aria-label="分级补充指导">
              {HINT_LABELS.map((title, index) => (
                  <div className="hint-item is-revealed" key={title}>
                    <Lightbulb size={34} aria-hidden="true" />
                    <span>
                      <strong>{title}</strong>
                      <ScientificText as="small">{step.hints[index]}</ScientificText>
                    </span>
                  </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
