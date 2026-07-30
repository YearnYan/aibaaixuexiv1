import { CheckCircle2, Lightbulb } from 'lucide-react';
import { forwardRef } from 'react';
import ScientificText from './ScientificText.jsx';

const HINT_LABELS = ['一级指导', '二级指导', '三级指导'];

function splitScientificText(source, targetLength = 220) {
  const text = String(source || '').trim();
  if (!text) return [];

  const chunks = [];
  let buffer = '';
  let mathDelimiter = '';

  const flush = () => {
    const value = buffer.trim();
    if (value) chunks.push(value);
    buffer = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const escaped = index > 0 && text[index - 1] === '\\';

    if (character === '$' && !escaped) {
      const delimiter = text[index + 1] === '$' ? '$$' : '$';
      buffer += delimiter;
      if (delimiter === '$$') index += 1;
      mathDelimiter = mathDelimiter ? '' : delimiter;
      continue;
    }

    buffer += character;
    if (mathDelimiter) continue;

    if (character === '\n' && text[index + 1] === '\n') {
      index += 1;
      flush();
      continue;
    }

    if (/[。！？；]/u.test(character) && buffer.length >= 70) {
      flush();
      continue;
    }

    if (/[，、,]/u.test(character) && buffer.length >= targetLength) flush();
  }

  flush();
  return chunks;
}

function formatGeneratedAt(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

const ReportDocument = forwardRef(function ReportDocument({ session }, ref) {
  if (!session) return null;

  const summaryChunks = splitScientificText(session.problemSummary, 260);
  const answerChunks = splitScientificText(session.finalAnswer, 240);

  return (
    <div className="report-staging" aria-hidden="true">
      <article className="export-report" data-export-report ref={ref}>
        <header className="report-cover" data-export-block>
          <div>
            <span className="report-kicker">AI SOLUTION PATH</span>
            <h1>AI 解题步骤报告</h1>
            <p>四步解题指导与完整答案</p>
          </div>
          <time>{formatGeneratedAt(session.generatedAt)}</time>
        </header>

        {summaryChunks.map((chunk, index) => (
          <section className="report-summary" data-export-block key={`summary-${index}`}>
            <span>{index === 0 ? '题目摘要' : '题目摘要（续）'}</span>
            <ScientificText>{chunk}</ScientificText>
          </section>
        ))}

        {session.knowledgePoints?.length > 0 && (
          <section className="report-knowledge" data-export-block>
            <span>涉及知识点</span>
            <div>
              {session.knowledgePoints.map((point) => (
                <ScientificText as="span" key={point}>{point}</ScientificText>
              ))}
            </div>
          </section>
        )}

        {session.steps.map((step) => {
          const guidanceChunks = splitScientificText(step.guidance);
          return (
            <div className="report-step-group" key={step.index}>
              <section className="report-step-intro" data-export-block>
                <header className="report-step-header">
                  <span>{String(step.index + 1).padStart(2, '0')}</span>
                  <div>
                    <small>第 {step.index + 1} / {session.steps.length} 步</small>
                    <h2>{step.title}</h2>
                    <ScientificText>{step.description}</ScientificText>
                  </div>
                </header>
                <div className="report-step-task">
                  <strong>本步重点</strong>
                  <ScientificText>{step.task}</ScientificText>
                </div>
              </section>

              {guidanceChunks.map((chunk, index) => (
                <section className="report-guidance" data-export-block key={`guidance-${step.index}-${index}`}>
                  <CheckCircle2 size={24} aria-hidden="true" />
                  <div>
                    <strong>{index === 0 ? 'AI 解题指导' : 'AI 解题指导（续）'}</strong>
                    <ScientificText>{chunk}</ScientificText>
                  </div>
                </section>
              ))}

              <section className="report-hints" data-export-block>
                {HINT_LABELS.map((label, index) => (
                  <div key={label}>
                    <Lightbulb size={22} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <ScientificText>{step.hints[index]}</ScientificText>
                    </span>
                  </div>
                ))}
              </section>
            </div>
          );
        })}

        <section className="report-step-intro report-final-intro" data-export-block>
          <header className="report-step-header">
            <span>05</span>
            <div>
              <small>第 5 个模块</small>
              <h2>完整答案</h2>
              <p>完整推导、规范作答与最终结论</p>
            </div>
          </header>
        </section>

        {answerChunks.map((chunk, index) => (
          <section className="report-guidance report-final-answer" data-export-block key={`answer-${index}`}>
            <CheckCircle2 size={24} aria-hidden="true" />
            <div>
              <strong>{index === 0 ? '完整解答' : '完整解答（续）'}</strong>
              <ScientificText>{chunk}</ScientificText>
            </div>
          </section>
        ))}

        <footer className="report-footer" data-export-block>
          <strong>解题报告完成</strong>
          <span>公式、单位与学科符号已按规范排版</span>
        </footer>
      </article>
    </div>
  );
});

export default ReportDocument;
