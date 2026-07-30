(function initReportExporter(global) {
  const COLORS = {
    ink: "172136",
    muted: "687188",
    violet: "5C52DF",
    green: "2F7D62",
    line: "D9DEEA",
    panel: "F8F9FD",
  };

  const STATUS_LABELS = {
    covered: "已掌握",
    compliant: "书写规范",
    partial: "需要完善",
    missing: "有待补全",
    pending: "解题指导",
  };

  function resultStateOf(report) {
    if (["guidance", "needs_improvement", "full_score"].includes(report.resultState)) return report.resultState;
    if (!report.hasStudentWork && !report.hasStudentAnswer) return "guidance";
    return Number(report.missingScore) === 0 ? "full_score" : "needs_improvement";
  }

  function statusLabel(point, resultState) {
    if (resultState === "guidance") return "解题指导";
    return STATUS_LABELS[point.status] || "待核查";
  }

  function scoreText(value) {
    const number = Number(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
  }

  function fileName(report, extension) {
    const subject = String(report.subject || "学科").replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 20) || "学科";
    const date = new Date().toISOString().slice(0, 10);
    return `${subject}-得分点报告-${date}.${extension}`;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function academicParagraph(className, text) {
    const paragraph = makeElement("p", className);
    global.AcademicRendering.setText(paragraph, text);
    return paragraph;
  }

  function exportField(label, text) {
    const field = makeElement("div", "export-field export-block");
    field.append(makeElement("strong", "export-field-label", label), academicParagraph("export-field-text", text));
    return field;
  }

  function createExportReport(report) {
    const resultState = resultStateOf(report);
    const hasStudentWork = resultState !== "guidance";
    const root = makeElement("article", "export-report");
    const header = makeElement("header", "export-document-header export-block");
    const titleBlock = makeElement("div");
    titleBlock.append(
      makeElement("span", "export-eyebrow", "AI 得分点拆解"),
      makeElement("h1", "", "得分点完整报告"),
    );
    header.append(
      titleBlock,
      makeElement("p", "export-meta", `${report.subject || "未标注学科"} · ${new Date().toLocaleDateString("zh-CN")}`),
    );
    root.append(header);

    const question = makeElement("section", "export-section export-question export-block");
    question.append(makeElement("h2", "", "题目预览"), academicParagraph("", report.questionPreview));
    root.append(question);

    const summary = makeElement("section", "export-summary export-block");
    summary.append(makeElement("div", "export-total", hasStudentWork
      ? `${scoreText(report.earnedScore)} / ${scoreText(report.totalScore)} 分`
      : `题目总分 ${scoreText(report.totalScore)} 分`));
    const split = makeElement("div", "export-summary-split");
    if (hasStudentWork) {
      split.append(
        makeElement("span", "", `已获得 ${scoreText(report.earnedScore)} 分`),
        makeElement("span", resultState === "full_score" ? "is-positive" : "", `${resultState === "full_score" ? "未失分" : "待补充"} ${scoreText(report.missingScore)} 分`),
      );
    } else {
      split.append(makeElement("span", "is-guidance", "分析模式：六维解题指导"));
    }
    summary.append(split);
    root.append(summary);

    const diagnosis = makeElement("section", "export-section export-diagnosis");
    diagnosis.append(makeElement("h2", "", resultState === "guidance" ? "六维解题指导" : "六维评分诊断"));
    report.scorePoints.forEach((point, index) => {
      const pointBlock = makeElement("section", "export-point export-block");
      const pointHeader = makeElement("header", "export-point-header");
      pointHeader.append(
        makeElement("span", "export-point-index", String(index + 1).padStart(2, "0")),
        makeElement("h3", "", point.label),
        makeElement("span", "export-point-score", Number(point.score) > 0 ? `${scoreText(point.score)} 分` : "关联维度"),
        makeElement("span", "export-point-status", statusLabel(point, resultState)),
      );
      const fields = makeElement("div", "export-fields");
      const analysisLabel = resultState === "guidance" ? "解题指导" : resultState === "full_score" ? "表现分析" : "作答诊断";
      const suggestionLabel = resultState === "guidance" ? "解题建议" : resultState === "full_score" ? "保持建议" : "提分动作";
      fields.append(
        exportField("评分观察", point.requirement),
        exportField(analysisLabel, point.analysis),
        exportField(suggestionLabel, point.suggestion),
      );
      if (hasStudentWork) {
        fields.append(exportField(point.evidence ? "作答依据" : "判定说明", point.evidence || "该维度的得分状态已记录，请结合原图复核对应位置。"));
      }
      pointBlock.append(pointHeader, fields);
      diagnosis.append(pointBlock);
    });
    root.append(diagnosis);

    const advice = makeElement("section", "export-advice export-block");
    advice.append(
      makeElement("strong", "", resultState === "guidance" ? "解题建议" : resultState === "full_score" ? "表现总结" : "提分建议"),
      academicParagraph("", report.revisionAdvice),
    );
    root.append(advice, academicParagraph("export-review export-block", report.reviewNote));
    global.AcademicRendering.renderElement(root);
    return root;
  }

  function mountExportReport(report) {
    const host = makeElement("div", "export-host");
    const reportElement = createExportReport(report);
    host.append(reportElement);
    document.body.append(host);
    return { host, reportElement };
  }

  async function downloadPdf(report) {
    if (typeof global.html2pdf !== "function") throw new Error("PDF 组件未加载，请刷新页面后重试");
    const { host, reportElement } = mountExportReport(report);
    try {
      await document.fonts.ready;
      const worker = global.html2pdf().set({
        filename: fileName(report, "pdf"),
        margin: [10, 10, 13, 10],
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
          windowWidth: 900,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: {
          mode: ["css", "legacy"],
          avoid: [".export-block", ".export-point", ".export-field"],
        },
      }).from(reportElement).toPdf();
      const pdf = await worker.get("pdf");
      const pageCount = pdf.internal.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.setTextColor(120, 126, 145);
        pdf.text(`${page} / ${pageCount}`, 105, 291, { align: "center" });
      }
      await worker.save();
    } finally {
      host.remove();
    }
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const formulaCache = new Map();

  async function formulaImage(token) {
    const key = `${token.display ? "block" : "inline"}:${token.value}`;
    if (formulaCache.has(key)) return formulaCache.get(key);
    if (typeof global.html2canvas !== "function" || typeof global.katex?.render !== "function") {
      throw new Error("公式导出组件未加载，请刷新页面后重试");
    }

    const host = makeElement("span", `formula-capture ${token.display ? "is-display" : ""}`);
    document.body.append(host);
    try {
      global.katex.render(token.value, host, {
        displayMode: token.display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
      });
      await document.fonts.ready;
      const canvas = await global.html2canvas(host, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("公式图像生成失败")), "image/png");
      });
      const cssWidth = Math.max(12, canvas.width / 2);
      const cssHeight = Math.max(12, canvas.height / 2);
      const maxWidth = token.display ? 520 : 220;
      const scale = Math.min(1, maxWidth / cssWidth);
      const image = {
        data: await blob.arrayBuffer(),
        width: Math.round(cssWidth * scale),
        height: Math.round(cssHeight * scale),
      };
      formulaCache.set(key, image);
      return image;
    } finally {
      host.remove();
    }
  }

  async function wordParagraphs(text, options = {}) {
    const { Paragraph, TextRun, ImageRun, AlignmentType } = global.docx;
    const paragraphs = [];
    let runs = [];

    function flush(alignment = options.alignment) {
      if (runs.length === 0) return;
      paragraphs.push(new Paragraph({
        children: runs,
        alignment,
        keepLines: true,
        spacing: { after: 110, line: 310 },
      }));
      runs = [];
    }

    const tokens = global.AcademicRendering.tokenize(text);
    for (const token of tokens) {
      if (token.type === "text") {
        const parts = token.value.split("\n");
        parts.forEach((part, index) => {
          if (part) runs.push(new TextRun({ text: part, font: "Microsoft YaHei", size: 21, color: COLORS.ink }));
          if (index < parts.length - 1) flush();
        });
        continue;
      }

      const image = await formulaImage(token);
      const imageRun = new ImageRun({
        type: "png",
        data: image.data,
        transformation: { width: image.width, height: image.height },
        altText: { name: "学科公式", title: token.value, description: token.value },
      });
      if (token.display) {
        flush();
        paragraphs.push(new Paragraph({
          children: [imageRun],
          alignment: AlignmentType.CENTER,
          keepLines: true,
          spacing: { before: 80, after: 130 },
        }));
      } else {
        runs.push(imageRun);
      }
    }
    flush();
    if (paragraphs.length === 0) paragraphs.push(new Paragraph({ text: "" }));
    return paragraphs;
  }

  function wordLabel(text) {
    const { Paragraph, TextRun } = global.docx;
    return new Paragraph({
      children: [new TextRun({ text, bold: true, color: COLORS.violet, font: "Microsoft YaHei", size: 20 })],
      keepNext: true,
      spacing: { before: 100, after: 50 },
    });
  }

  async function wordField(label, text) {
    return [wordLabel(label), ...await wordParagraphs(text)];
  }

  async function downloadWord(report) {
    if (!global.docx?.Document) throw new Error("Word 组件未加载，请刷新页面后重试");
    const {
      AlignmentType,
      BorderStyle,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      Table,
      TableCell,
      TableRow,
      TextRun,
      WidthType,
    } = global.docx;
    const resultState = resultStateOf(report);
    const hasStudentWork = resultState !== "guidance";
    const children = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: "得分点完整报告", bold: true, color: COLORS.ink, font: "Microsoft YaHei", size: 38 })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `${report.subject || "未标注学科"} · AI 得分点拆解 · ${new Date().toLocaleDateString("zh-CN")}`, color: COLORS.muted, font: "Microsoft YaHei", size: 19 })],
      spacing: { after: 260 },
    }));
    children.push(wordLabel("题目预览"), ...await wordParagraphs(report.questionPreview));

    const summaryText = hasStudentWork
      ? `${scoreText(report.earnedScore)} / ${scoreText(report.totalScore)} 分    已获得 ${scoreText(report.earnedScore)} 分    ${resultState === "full_score" ? "未失分" : "待补充"} ${scoreText(report.missingScore)} 分`
      : `分析模式：六维解题指导    题目总分 ${scoreText(report.totalScore)} 分`;
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "CECFF2" },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "CECFF2" },
        left: { style: BorderStyle.SINGLE, size: 4, color: "CECFF2" },
        right: { style: BorderStyle.SINGLE, size: 4, color: "CECFF2" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
      rows: [new TableRow({
        cantSplit: true,
        children: [new TableCell({
          shading: { fill: "F7F7FF" },
          margins: { top: 180, bottom: 180, left: 220, right: 220 },
          children: [new Paragraph({
            children: [new TextRun({ text: summaryText, bold: true, color: COLORS.violet, font: "Microsoft YaHei", size: 26 })],
            alignment: AlignmentType.CENTER,
          })],
        })],
      })],
    }), new Paragraph({ text: "", spacing: { after: 180 } }));

    children.push(new Paragraph({
      children: [new TextRun({ text: resultState === "guidance" ? "六维解题指导" : "六维评分诊断", bold: true, color: COLORS.ink, font: "Microsoft YaHei", size: 28 })],
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { before: 180, after: 120 },
    }));

    for (const [index, point] of report.scorePoints.entries()) {
      const analysisLabel = resultState === "guidance" ? "解题指导" : resultState === "full_score" ? "表现分析" : "作答诊断";
      const suggestionLabel = resultState === "guidance" ? "解题建议" : resultState === "full_score" ? "保持建议" : "提分动作";
      const pointChildren = [new Paragraph({
        children: [
          new TextRun({ text: `${String(index + 1).padStart(2, "0")}  ${point.label}`, bold: true, color: COLORS.ink, font: "Microsoft YaHei", size: 25 }),
          new TextRun({ text: `    ${Number(point.score) > 0 ? `${scoreText(point.score)} 分` : "关联维度"}    ${statusLabel(point, resultState)}`, bold: true, color: COLORS.green, font: "Microsoft YaHei", size: 20 }),
        ],
        keepNext: true,
        spacing: { after: 70 },
      })];
      pointChildren.push(...await wordField("评分观察", point.requirement));
      pointChildren.push(...await wordField(analysisLabel, point.analysis));
      pointChildren.push(...await wordField(suggestionLabel, point.suggestion));
      if (hasStudentWork) {
        pointChildren.push(...await wordField(point.evidence ? "作答依据" : "判定说明", point.evidence || "该维度的得分状态已记录，请结合原图复核对应位置。"));
      }

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line },
          bottom: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line },
          left: { style: BorderStyle.SINGLE, size: 12, color: COLORS.green },
          right: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
        },
        rows: [new TableRow({
          cantSplit: true,
          children: [new TableCell({
            shading: { fill: COLORS.panel },
            margins: { top: 180, bottom: 180, left: 220, right: 220 },
            children: pointChildren,
          })],
        })],
      }), new Paragraph({ text: "", spacing: { after: 90 } }));
    }

    const adviceLabel = resultState === "guidance" ? "解题建议" : resultState === "full_score" ? "表现总结" : "提分建议";
    children.push(wordLabel(adviceLabel), ...await wordParagraphs(report.revisionAdvice));
    children.push(wordLabel("复核说明"), ...await wordParagraphs(report.reviewNote));

    const document = new Document({
      title: "AI 得分点完整报告",
      subject: report.subject || "得分点分析",
      creator: "AI 得分点拆解",
      description: "包含题目预览、分数概览、六维诊断与建议的完整报告",
      styles: {
        default: {
          document: {
            run: { font: "Microsoft YaHei", size: 21, color: COLORS.ink },
            paragraph: { spacing: { line: 310, after: 100 } },
          },
        },
      },
      sections: [{
        properties: {
          page: {
            margin: { top: 900, right: 900, bottom: 900, left: 900 },
          },
        },
        children,
      }],
    });
    triggerDownload(await Packer.toBlob(document), fileName(report, "docx"));
  }

  global.ReportExporter = { downloadPdf, downloadWord };
}(window));
