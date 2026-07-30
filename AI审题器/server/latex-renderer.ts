import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import katex from "katex";
import "katex/contrib/mhchem";
import { findLatexDelimiterIssues, tokenizeLatex } from "../shared/latex.js";
import type { Analysis } from "./schemas.js";

const RAW_LATEX_COMMAND = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|lim|vec|overrightarrow|ce|pu|mathrm|mathbf|mathit|alpha|beta|gamma|delta|theta|lambda|mu|sigma|omega|Omega)(?:\b|\{)/;
const SUSPICIOUS_TEXT = /(�|ï¿½|â€|Ã.|锛|鈥|銆)/;

export interface FormulaValidationIssue {
  text: string;
  formula?: string;
  message: string;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderLatexFormula(value: string, displayMode: boolean, throwOnError = false) {
  return katex.renderToString(value, {
    displayMode,
    throwOnError,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
    errorColor: "#b4232a",
  });
}

export function renderRichTextHtml(text: string) {
  return tokenizeLatex(text)
    .map((segment) => {
      if (segment.kind === "text") return escapeHtml(segment.value).replaceAll("\n", "<br>");
      const className = segment.display ? "formula formula-block" : "formula formula-inline";
      return `<span class="${className}">${renderLatexFormula(segment.value, segment.display)}</span>`;
    })
    .join("");
}

export function analysisTextValues(analysis: Analysis) {
  return [
    analysis.questionText,
    analysis.problemType,
    ...analysis.potentialOmissions,
    ...analysis.taskWords.flatMap((item) => [item.label, item.text]),
    ...analysis.restrictions,
    ...analysis.keyData.flatMap((item) => [item.label, item.value]),
    ...analysis.hiddenConditions,
    ...analysis.distractions,
    analysis.answerScope,
    analysis.paraphrase,
    ...analysis.highlights.map((item) => item.text),
  ];
}

export function validateFormulaTexts(texts: string[]) {
  const issues: FormulaValidationIssue[] = [];
  for (const text of texts) {
    for (const message of findLatexDelimiterIssues(text)) {
      issues.push({ text, message });
    }
    for (const segment of tokenizeLatex(text)) {
      if (segment.kind === "text") {
        if (RAW_LATEX_COMMAND.test(segment.value)) {
          issues.push({ text, message: "LaTeX 命令未放在公式分隔符中" });
        }
        if (SUSPICIOUS_TEXT.test(segment.value)) {
          issues.push({ text, message: "文本包含疑似乱码字符" });
        }
        continue;
      }
      try {
        renderLatexFormula(segment.value, segment.display, true);
      } catch (error) {
        issues.push({
          text,
          formula: segment.value,
          message: error instanceof Error ? error.message : "公式无法渲染",
        });
      }
    }
  }
  return issues;
}

export function validateAnalysisLatex(analysis: Analysis) {
  return validateFormulaTexts(analysisTextValues(analysis));
}

let embeddedKatexCss: string | null = null;
const require = createRequire(import.meta.url);

export function getEmbeddedKatexCss() {
  if (embeddedKatexCss) return embeddedKatexCss;
  const cssPath = require.resolve("katex/dist/katex.min.css");
  const cssDirectory = path.dirname(cssPath);
  const css = readFileSync(cssPath, "utf8");
  embeddedKatexCss = css.replace(/url\((['"]?)(fonts\/[^)'\"]+)\1\)/g, (_match, _quote, relativePath: string) => {
    const fontPath = path.resolve(cssDirectory, relativePath);
    const extension = path.extname(fontPath).slice(1);
    const mime = extension === "woff2" ? "font/woff2" : extension === "woff" ? "font/woff" : "application/octet-stream";
    return `url(data:${mime};base64,${readFileSync(fontPath).toString("base64")})`;
  });
  return embeddedKatexCss;
}
