import type { ReportRequest } from "./schemas.js";
import { escapeHtml, getEmbeddedKatexCss, renderRichTextHtml } from "./latex-renderer.js";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  })
    .format(date)
    .replaceAll("/", "-");
}

function listHtml(items: string[], emptyText: string) {
  if (items.length === 0) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `<ul>${items.map((item) => `<li>${renderRichTextHtml(item)}</li>`).join("")}</ul>`;
}

function card(number: string, title: string, content: string, footer: string, className = "") {
  return `<section class="card ${className}">
    <header><span class="number">${number}</span><h2>${title}</h2><span class="check">✓</span></header>
    <div class="card-body">${content}</div>
    <p class="card-footer">${footer}</p>
  </section>`;
}

export function buildReportHtml({ analysis, meta }: ReportRequest) {
  const warningHtml = analysis.potentialOmissions.length
    ? `<section class="warning"><strong>可能遗漏</strong>${listHtml(analysis.potentialOmissions, "")}</section>`
    : `<section class="success">关键信息已完整提取</section>`;
  const taskHtml = analysis.taskWords
    .map((item) => `<div class="task"><span>${renderRichTextHtml(item.label)}</span><p>${renderRichTextHtml(item.text)}</p></div>`)
    .join("");
  const dataHtml = analysis.keyData.length
    ? `<div class="data-grid">${analysis.keyData
        .map((item) => `<div><strong>${renderRichTextHtml(item.label)}：</strong>${renderRichTextHtml(item.value)}</div>`)
        .join("")}</div>`
    : `<div class="empty">题目中没有需要单列的数值。</div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>${getEmbeddedKatexCss()}</style>
  <style>
    @page { size: A4; margin: 14mm 13mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; color: #172028; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif; font-size: 12px; line-height: 1.65; }
    body { background: #fff; }
    .report-header { padding-bottom: 14px; display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid #18b9cc; }
    .report-header h1 { margin: 0; font-size: 25px; line-height: 1.2; }
    .report-header p { margin: 5px 0 0; color: #69757d; }
    .report-mark { color: #108c9c; font-size: 12px; font-weight: 700; }
    .warning, .success { margin: 13px 0; padding: 10px 14px; border-radius: 5px; break-inside: avoid; }
    .warning { color: #9f1f26; border: 1px solid #f1c3c6; background: #fff1f1; }
    .warning strong { display: block; margin-bottom: 2px; }
    .warning ul { margin: 0; }
    .success { color: #286f2c; border: 1px solid #cde5ca; background: #f1f9ef; }
    .preview { margin-bottom: 13px; padding: 15px 17px; display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 18px; border: 1px dashed #aebcc3; border-left: 3px solid #18bdd0; break-inside: avoid; }
    .preview h2 { margin: 0 0 8px; font-size: 15px; }
    .question { margin: 0; font-size: 14px; line-height: 2; overflow-wrap: anywhere; }
    .meta { margin: 0; padding-left: 15px; border-left: 1px dashed #c7d0d4; color: #5d6871; }
    .meta div { display: flex; margin-bottom: 4px; }
    .meta dt { flex: none; }
    .meta dd { margin: 0; overflow-wrap: anywhere; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: stretch; }
    .card { min-height: 178px; padding: 12px 13px 13px; display: flex; flex-direction: column; border: 1px solid #cbd3d7; border-radius: 6px; break-inside: avoid; background: #fff; }
    .card header { display: flex; align-items: center; gap: 8px; }
    .card h2 { margin: 0; font-size: 15px; }
    .number { width: 30px; height: 30px; display: inline-grid; place-items: center; color: #fff; font-weight: 800; border-radius: 50%; background: #18b9cc; }
    .check { width: 19px; height: 19px; margin-left: auto; display: inline-grid; place-items: center; color: #fff; line-height: 1; border-radius: 50%; background: #15a51b; }
    .card-body { margin-top: 12px; font-size: 12px; }
    .card-footer { margin: auto 0 0; padding-top: 12px; color: #68737b; font-size: 10.5px; }
    ul { margin: 0; padding-left: 19px; }
    li { margin-bottom: 5px; }
    .task { display: flex; align-items: flex-start; gap: 8px; }
    .task > span { min-width: 34px; padding: 2px 7px; text-align: center; border: 1px solid #27bfd2; border-radius: 4px; background: #eafbfd; }
    .task p { margin: 1px 0 0; }
    .data-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
    .data-grid > div { padding: 6px 8px; border-radius: 4px; background: #eaf6e5; overflow-wrap: anywhere; }
    .scope { padding: 13px; color: #472976; border-radius: 5px; background: #f0eafb; }
    .empty { padding: 12px; color: #525d65; border-radius: 5px; background: #f3f5f5; }
    .paraphrase { margin-top: 12px; padding: 12px 15px; border-top: 2px solid #18b9cc; background: #f4f7f7; break-inside: avoid; }
    .paraphrase strong { color: #108796; }
    .paraphrase p { margin: 4px 0 0; }
    .formula-inline { display: inline-block; max-width: 100%; vertical-align: -0.15em; }
    .formula-block { display: block; max-width: 100%; margin: 6px 0; overflow: hidden; text-align: center; }
    .katex { font-size: 1em; }
    .katex-display { margin: 0.35em 0; }
    .review-note { margin: 11px 0 0; color: #7a848b; font-size: 9.5px; text-align: right; }
  </style>
</head>
<body>
  <header class="report-header">
    <div><h1>AI审题分析报告</h1><p>先证明读准，再开始解题</p></div>
    <span class="report-mark">${escapeHtml(meta.subject)} · ${escapeHtml(meta.grade)}</span>
  </header>
  ${warningHtml}
  <section class="preview">
    <div><h2>【题目预览】</h2><p class="question">${renderRichTextHtml(analysis.questionText)}</p></div>
    <dl class="meta">
      <div><dt>学科：</dt><dd>${escapeHtml(meta.subject)}</dd></div>
      <div><dt>年级：</dt><dd>${escapeHtml(meta.grade)}</dd></div>
      <div><dt>题型：</dt><dd>${renderRichTextHtml(analysis.problemType)}</dd></div>
      <div><dt>来源：</dt><dd>${escapeHtml(meta.source)}</dd></div>
      <div><dt>识别时间：</dt><dd>${formatDate(meta.recognizedAt)}</dd></div>
      <div><dt>置信度：</dt><dd>${analysis.confidence.toFixed(2)}</dd></div>
    </dl>
  </section>
  <div class="grid">
    ${card("01", "任务词", taskHtml, "明确需要完成的审题目标。")}
    ${card("02", "限制条件", listHtml(analysis.restrictions, "未识别到额外限制条件。"), "对范围、数量与关系的限定条件。")}
    ${card("03", "关键数据", dataHtml, "用于判断与计算的核心信息。")}
    ${card("04", "隐藏条件", listHtml(analysis.hiddenConditions, "未识别到需要额外推断的隐藏条件。"), "未直接表述，但影响解题的条件。")}
    ${card("05", "干扰信息", listHtml(analysis.distractions, "无明显干扰信息。"), "题目中与当前任务无关的信息。")}
    ${card("06", "作答范围", `<div class="scope">仅需求解：${renderRichTextHtml(analysis.answerScope)}</div>`, "只回答题目要求的对象、范围与形式。")}
  </div>
  <section class="paraphrase"><strong>题意复述</strong><p>${renderRichTextHtml(analysis.paraphrase)}</p></section>
  <p class="review-note">AI 生成内容须由教师结合原题复核。</p>
</body>
</html>`;
}
