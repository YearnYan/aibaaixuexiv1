import katex from "katex";
import "katex/contrib/mhchem";
import { tokenizeLatex } from "../../shared/latex";

interface RichTextProps {
  text: string;
  className?: string;
}

const renderedFormulaCache = new Map<string, string>();

function renderFormula(value: string, displayMode: boolean) {
  const cacheKey = `${displayMode ? "block" : "inline"}:${value}`;
  const cached = renderedFormulaCache.get(cacheKey);
  if (cached) return cached;

  const rendered = katex.renderToString(value, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
    errorColor: "#b4232a",
  });
  renderedFormulaCache.set(cacheKey, rendered);
  return rendered;
}

export function RichText({ text, className }: RichTextProps) {
  const segments = tokenizeLatex(text);
  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <span key={`text-${index}`}>{segment.value}</span>
        ) : (
          <span
            className={segment.display ? "latex-formula latex-formula-block" : "latex-formula latex-formula-inline"}
            // KaTeX 在 trust=false 下只生成公式结构，不执行输入中的 HTML。
            dangerouslySetInnerHTML={{ __html: renderFormula(segment.value, segment.display) }}
            key={`formula-${segment.value}-${index}`}
          />
        ),
      )}
    </span>
  );
}
