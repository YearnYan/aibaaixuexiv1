import { afterAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { closeReportBrowser } from "../server/browser";
import { buildReportHtml } from "../server/report-html";
import { generatePdfReport } from "../server/report-pdf";
import { generateWordReport } from "../server/report-word";
import type { ReportRequest } from "../server/schemas";

const report: ReportRequest = {
  analysis: {
    questionText:
      "综合审读：数学 \\(f(x)=x^2\\)，物理 \\(F=ma\\)，化学 \\(\\ce{2H2 + O2 -> 2H2O}\\)，生物 \\(AaBb\\)，地理 \\(30^\\circ\\mathrm{N}\\)。",
    problemType: "跨学科材料题",
    confidence: 0.96,
    potentialOmissions: ["注意单位 \\(\\mathrm{m/s^2}\\) 与方向"],
    taskWords: [{ label: "说明", text: "辨认每个学科表达的对象与范围" }],
    restrictions: ["所有公式必须结合原题语境判断，不直接计算"],
    keyData: [
      { label: "物理关系", value: "\\(F=ma\\)" },
      { label: "化学反应", value: "\\(\\ce{2H2 + O2 -> 2H2O}\\)" },
    ],
    hiddenConditions: ["经纬度 \\(30^\\circ\\mathrm{N}\\) 表示北纬"],
    distractions: [],
    answerScope: "只说明公式、符号和单位所表达的审题信息",
    paraphrase: "先识别 \\(f(x)\\)、\\(F\\)、\\(\\ce{H2O}\\)、\\(AaBb\\) 和经纬度分别属于哪个学科语境。",
    highlights: [],
  },
  meta: {
    subject: "综合科学",
    grade: "高中一年级",
    source: "自动化测试",
    recognizedAt: "2026-07-17T10:30:25.000Z",
    fileNames: ["公式测试题.txt"],
  },
};

afterAll(async () => {
  await closeReportBrowser();
});

describe("完整报告导出", () => {
  it("打印 HTML 包含完整报告与已渲染公式", () => {
    const html = buildReportHtml(report);
    expect(html).toContain("AI审题分析报告");
    expect(html).toContain("任务词");
    expect(html).toContain("作答范围");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("�");
  });

  it("生成可识别的 PDF 与 DOCX 二进制文件", async () => {
    const pdf = await generatePdfReport(report);
    const word = await generateWordReport(report);
    const archive = await JSZip.loadAsync(word);
    const documentXml = await archive.file("word/document.xml")?.async("string");
    const mediaFiles = Object.keys(archive.files).filter((name) => name.startsWith("word/media/") && !archive.files[name].dir);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000);
    expect(word.subarray(0, 2).toString()).toBe("PK");
    expect(word.length).toBeGreaterThan(8_000);
    expect(documentXml).toContain("<m:oMath");
    expect(documentXml).toContain("<m:sSup>");
    expect(documentXml).toContain("<m:sSub>");
    expect(documentXml).not.toContain("<undefined");
    expect(documentXml).not.toContain("<w:drawing");
    expect(mediaFiles).toEqual([]);
  }, 50_000);
});
