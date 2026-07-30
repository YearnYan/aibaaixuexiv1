import { BookOpenCheck, ChevronRight, ChevronUp } from 'lucide-react';
import ScientificText from './ScientificText.jsx';

export default function FinalAnswerPanel({ answer, isActive, onToggle }) {
  return (
    <section className={`step-row final-answer-row${isActive ? ' is-active' : ''}`}>
      <button
        className="step-number"
        type="button"
        onClick={onToggle}
        aria-label="查看第 5 个模块：完整答案"
        aria-expanded={isActive}
      >
        05
      </button>
      <div className="step-content">
        <button
          className="step-heading step-heading-button"
          type="button"
          onClick={onToggle}
          aria-expanded={isActive}
        >
          <div>
            {isActive && <span className="current-step">第 5 个模块</span>}
            <h2>完整答案</h2>
            {!isActive && <p>查看完整推导、规范作答与最终结论。</p>}
          </div>
          {isActive ? <ChevronUp size={34} aria-hidden="true" /> : <ChevronRight size={34} aria-hidden="true" />}
        </button>

        {isActive && (
          <div className="final-answer-detail">
            <BookOpenCheck size={28} aria-hidden="true" />
            <div>
              <strong>完整解答</strong>
              <ScientificText>{answer}</ScientificText>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
