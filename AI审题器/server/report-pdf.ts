import { withReportPage } from "./browser.js";
import { buildReportHtml } from "./report-html.js";
import type { ReportRequest } from "./schemas.js";

export async function generatePdfReport(report: ReportRequest) {
  return withReportPage(async (page) => {
    await page.setContent(buildReportHtml(report), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;padding:0 13mm;color:#7a848b;font-size:8px;text-align:right;">第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</div>',
      margin: { top: "14mm", right: "13mm", bottom: "16mm", left: "13mm" },
    });
    return Buffer.from(pdf);
  });
}
