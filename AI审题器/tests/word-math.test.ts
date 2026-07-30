import { describe, expect, it } from "vitest";
import { latexToOmmlXml } from "../server/word-math";

describe("Word 原生可编辑公式", () => {
  const cases = [
    {
      subject: "数学",
      latex: String.raw`f(x)=\frac{-b+\sqrt{b^2-4ac}}{2a}`,
      tags: ["<m:f>", "<m:rad>", "<m:sSup>"],
    },
    {
      subject: "物理",
      latex: String.raw`\vec{B}=\frac{\Delta\Phi}{\Delta t}`,
      tags: ["<m:acc>", "<m:f>"],
    },
    {
      subject: "化学",
      latex: String.raw`\ce{2H2 + O2 -> 2H2O}\quad\ce{SO4^2-}`,
      tags: ["<m:sSub>", "<m:sSubSup>"],
    },
    {
      subject: "生物",
      latex: String.raw`X^H X^h+p^2+2pq+q^2=1`,
      tags: ["<m:sSup>"],
    },
    {
      subject: "地理",
      latex: String.raw`30^\circ\mathrm{N},\ i=\frac{\Delta h}{L}\times100\%`,
      tags: ["<m:sSup>", "<m:f>"],
    },
    {
      subject: "高阶结构",
      latex: String.raw`\sum_{i=1}^{n}i^2+\int_0^1x^2\,dx+\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
      tags: ["<m:nary>", "<m:m>"],
    },
  ];

  it.each(cases)("$subject 公式转换为原生 OMML", ({ latex, tags }) => {
    const omml = latexToOmmlXml(latex);
    expect(omml).toContain("<m:oMath");
    expect(omml).toContain("<m:t");
    expect(omml).not.toContain("<w:drawing");
    expect(omml).not.toContain("data:image");
    tags.forEach((tag) => expect(omml).toContain(tag));
  });

  it("无效 LaTeX 不生成伪公式或图片兜底", () => {
    expect(() => latexToOmmlXml(String.raw`\frac{1`)).toThrow();
  });
});
