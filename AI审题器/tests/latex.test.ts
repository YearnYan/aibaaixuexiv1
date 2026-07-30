import { describe, expect, it } from "vitest";
import { findLatexDelimiterIssues, tokenizeLatex } from "../shared/latex";
import { validateFormulaTexts } from "../server/latex-renderer";

describe("跨学科 LaTeX 规范", () => {
  const subjectMatrix = [
    "数学：函数 \\(f(x)=\\frac{-b+\\sqrt{b^2-4ac}}{2a}\\)，集合 \\(A\\cap B\\)。",
    "物理：由 \\(F=ma\\) 与 \\(v=\\frac{s}{t}\\) 判断，重力加速度为 \\(9.8\\,\\mathrm{m/s^2}\\)，方向记作 \\(\\vec{B}\\)。",
    "化学：反应式 \\(\\ce{2H2 + O2 -> 2H2O}\\)，离子 \\(\\ce{SO4^2-}\\)，同位素 \\(\\ce{^{14}C}\\)。",
    "生物：基因型 \\(AaBb\\)、伴性遗传 \\(X^H X^h\\)，群体频率 \\(p^2+2pq+q^2=1\\)。",
    "地理：纬度 \\(30^\\circ\\mathrm{N}\\)，经度 \\(120^\\circ\\mathrm{E}\\)，比例尺 \\(1:50000\\)，坡度 \\(i=\\frac{\\Delta h}{L}\\times100\\%\\)。",
  ];

  it("数学、物理、化学、生物和地理公式均可完整渲染", () => {
    expect(validateFormulaTexts(subjectMatrix)).toEqual([]);
  });

  it("同时识别行内公式和独立公式", () => {
    const segments = tokenizeLatex("速度为 \\(v=s/t\\)。\\[E=mc^2\\]");
    expect(segments.filter((item) => item.kind === "formula")).toEqual([
      { kind: "formula", value: "v=s/t", display: false },
      { kind: "formula", value: "E=mc^2", display: true },
    ]);
  });

  it("拒绝未成对分隔符、裸露命令和乱码", () => {
    expect(findLatexDelimiterIssues("公式 \\(x+1")).toContain("行内公式分隔符不成对");
    const issues = validateFormulaTexts(["结果是 \\frac{1}{2}", "出现乱码 �"]);
    expect(issues.map((item) => item.message)).toContain("LaTeX 命令未放在公式分隔符中");
    expect(issues.map((item) => item.message)).toContain("文本包含疑似乱码字符");
  });
});
