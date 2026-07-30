import {
  BarChart3,
  CheckCircle2,
  Crosshair,
  Expand,
  EyeOff,
  FileDown,
  FileText,
  Filter,
  LoaderCircle,
  OctagonAlert,
} from "lucide-react";
import { useState } from "react";
import { AnalysisCard } from "./AnalysisCard";
import { RichText } from "./RichText";
import { downloadReport, type ReportFormat } from "../lib/api";
import type { Analysis, AnalysisMeta, HighlightCategory } from "../types";

interface ResultPanelProps {
  analysis: Analysis;
  meta: AnalysisMeta;
  analyzing: boolean;
  error: string;
}

interface TextSegment {
  text: string;
  category?: HighlightCategory;
}

function highlightSegments(analysis: Analysis): TextSegment[] {
  const highlights = [...analysis.highlights]
    .filter((item) => analysis.questionText.includes(item.text))
    .sort((left, right) => right.text.length - left.text.length);
  const segments: TextSegment[] = [];
  let plainText = "";
  let index = 0;

  const flushPlainText = () => {
    if (plainText) {
      segments.push({ text: plainText });
      plainText = "";
    }
  };

  while (index < analysis.questionText.length) {
    const match = highlights.find((item) => analysis.questionText.startsWith(item.text, index));
    if (match) {
      flushPlainText();
      segments.push({ text: match.text, category: match.category });
      index += match.text.length;
    } else {
      plainText += analysis.questionText[index];
      index += 1;
    }
  }
  flushPlainText();
  return segments;
}

function formatRecognizedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
}

function EmptyList({ text }: { text: string }) {
  return <div className="empty-callout">{text}</div>;
}

const restrictionPattern = /(不超过|不低于|都不会|至少|至多|不得|不能|不会|都会|必须|最多|最少|仅)/g;
const restrictionTokenPattern = /^(不超过|不低于|都不会|至少|至多|不得|不能|不会|都会|必须|最多|最少|仅)$/;

function emphasizeRestriction(text: string) {
  return text.split(restrictionPattern).map((part, index) =>
    restrictionTokenPattern.test(part) ? (
      <span className="restriction-emphasis" key={`${part}-${index}`}>
        <RichText text={part} />
      </span>
    ) : (
      <RichText key={`${part}-${index}`} text={part} />
    ),
  );
}

export function ResultPanel({ analysis, meta, analyzing, error }: ResultPanelProps) {
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [exportError, setExportError] = useState("");
  const warning = exportError || error || analysis.potentialOmissions[0];
  const warningIsError = Boolean(exportError || error);
  const segments = highlightSegments(analysis);

  const handleDownload = async (format: ReportFormat) => {
    setExportError("");
    setExporting(format);
    try {
      await downloadReport(format, analysis, meta);
    } catch (caughtError) {
      setExportError(caughtError instanceof Error ? caughtError.message : "报告生成失败，请稍后重试");
    } finally {
      setExporting(null);
    }
  };

  return (
    <main className="result-panel" aria-live="polite" aria-busy={analyzing}>
      <div className="result-heading-row">
        <h2>审题结果</h2>
        <div className="result-heading-tools">
          <div className="export-actions" aria-label="下载完整报告">
            <button
              type="button"
              disabled={analyzing || exporting !== null}
              onClick={() => void handleDownload("pdf")}
              title="下载完整 PDF 报告"
            >
              {exporting === "pdf" ? <LoaderCircle className="spinning" size={18} /> : <FileDown size={18} />}
              下载PDF
            </button>
            <button
              type="button"
              disabled={analyzing || exporting !== null}
              onClick={() => void handleDownload("word")}
              title="下载完整 Word 报告"
            >
              {exporting === "word" ? <LoaderCircle className="spinning" size={18} /> : <FileText size={18} />}
              下载WORD
            </button>
          </div>
        </div>
      </div>

      <section className="question-preview">
        <div className="corner corner-top-left" aria-hidden="true" />
        <div className="corner corner-top-right" aria-hidden="true" />
        <div className="corner corner-bottom-left" aria-hidden="true" />
        <div className="corner corner-bottom-right" aria-hidden="true" />
        <div className="preview-copy">
          <h3>【题目预览】</h3>
          <p className="question-text">
            {segments.map((segment, index) =>
              segment.category ? (
                <mark className={`highlight-${segment.category}`} key={`${segment.text}-${index}`}>
                  <RichText text={segment.text} />
                </mark>
              ) : (
                <RichText key={`${segment.text}-${index}`} text={segment.text} />
              ),
            )}
          </p>
        </div>
        <dl className="question-meta">
          <div>
            <dt>学科：</dt>
            <dd>{meta.subject}</dd>
          </div>
          <div>
            <dt>年级：</dt>
            <dd>{meta.grade}</dd>
          </div>
          <div>
            <dt>题型：</dt>
            <dd>{analysis.problemType}</dd>
          </div>
          <div>
            <dt>来源：</dt>
            <dd>{meta.source}</dd>
          </div>
          <div>
            <dt>识别时间：</dt>
            <dd>{formatRecognizedAt(meta.recognizedAt)}</dd>
          </div>
          <div>
            <dt>置信度：</dt>
            <dd>{analysis.confidence.toFixed(2)}</dd>
          </div>
        </dl>
      </section>

      {warning ? (
        <div className={`result-alert${warningIsError ? " is-error" : ""}`} role={warningIsError ? "alert" : "status"}>
          <span className="alert-symbol" aria-hidden="true">
            !
          </span>
          <span>{warningIsError ? <RichText text={warning} /> : <><span>可能遗漏：</span><RichText text={warning} /></>}</span>
        </div>
      ) : (
        <div className="result-alert is-success" role="status">
          <CheckCircle2 size={23} aria-hidden="true" />
          <span>关键信息已完整提取</span>
        </div>
      )}

      <div className="analysis-grid">
        <AnalysisCard number="01" title="任务词" icon={Crosshair} footer="明确需要求解的目标量。">
          <div className="task-list">
            {analysis.taskWords.map((item, index) => (
              <div className="task-item" key={`${item.label}-${item.text}-${index}`}>
                <span><RichText text={item.label} /></span>
                <p><RichText text={item.text} /></p>
              </div>
            ))}
          </div>
        </AnalysisCard>

        <AnalysisCard number="02" title="限制条件" icon={Filter} footer="对范围、数量与关系的限定条件。">
          {analysis.restrictions.length ? (
            <ul className="condition-list restriction-list">
              {analysis.restrictions.map((item, index) => (
                <li key={`${item}-${index}`}>{emphasizeRestriction(item)}</li>
              ))}
            </ul>
          ) : (
            <EmptyList text="未识别到额外限制条件。" />
          )}
        </AnalysisCard>

        <AnalysisCard number="03" title="关键数据" icon={BarChart3} footer="用于判断与计算的核心信息。">
          {analysis.keyData.length ? (
            <div className="key-data-grid">
              {analysis.keyData.map((item, index) => (
                <div className="data-chip" key={`${item.label}-${item.value}-${index}`}>
                  <strong><RichText text={item.label} />：</strong>
                  <span><RichText text={item.value} /></span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyList text="题目中没有需要单列的数值。" />
          )}
        </AnalysisCard>

        <AnalysisCard number="04" title="隐藏条件" icon={EyeOff} footer="未直接表述，但影响解题的条件。">
          {analysis.hiddenConditions.length ? (
            <ul className="condition-list">
              {analysis.hiddenConditions.map((item, index) => (
                <li key={`${item}-${index}`}><RichText text={item} /></li>
              ))}
            </ul>
          ) : (
            <EmptyList text="未识别到需要额外推断的隐藏条件。" />
          )}
        </AnalysisCard>

        <AnalysisCard number="05" title="干扰信息" icon={OctagonAlert} footer="题目中与当前任务无关的信息。">
          {analysis.distractions.length ? (
            <ul className="condition-list">
              {analysis.distractions.map((item, index) => (
                <li key={`${item}-${index}`}><RichText text={item} /></li>
              ))}
            </ul>
          ) : (
            <EmptyList text="无明显干扰信息。" />
          )}
        </AnalysisCard>

        <AnalysisCard number="06" title="作答范围" icon={Expand} footer="只回答题目要求的对象、范围与形式。">
          <div className="scope-callout">仅需求解：<RichText text={analysis.answerScope} /></div>
        </AnalysisCard>
      </div>

      <section className="paraphrase-section">
        <span>题意复述</span>
        <p><RichText text={analysis.paraphrase} /></p>
      </section>

      {analyzing ? (
        <div className="analysis-loading-layer">
          <span className="scan-line" aria-hidden="true" />
          <div className="loading-orbit" aria-hidden="true">
            <FileSearchIcon />
          </div>
          <strong>AI 正在读取并拆解题目</strong>
          <p>正在识别任务词、限制条件与隐藏条件…</p>
        </div>
      ) : null}
    </main>
  );
}

function FileSearchIcon() {
  return (
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7" />
      <path d="M14 2v6h6" />
      <path d="m21 21-3.5-3.5" />
      <circle cx="15" cy="15" r="3" />
    </svg>
  );
}
