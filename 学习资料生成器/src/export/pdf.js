import { chromium } from "playwright-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { prepareExportMaterial } from "./common.js";

const BROWSER_ATTEMPTS = [
  { channel: "chrome" },
  { channel: "msedge" },
  {}
];

async function launchBrowser() {
  if (process.env.EXPORT_BROWSER_PATH?.trim()) {
    return chromium.launch({
      executablePath: process.env.EXPORT_BROWSER_PATH.trim(),
      headless: true
    });
  }

  let lastError;
  for (const attempt of BROWSER_ATTEMPTS) {
    try {
      return await chromium.launch({
        ...attempt,
        headless: true,
        args: ["--font-render-hinting=none"]
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`未找到可用的 PDF 导出浏览器：${lastError?.message || "未知错误"}`);
}

async function assertPdfHasNoBlankPages(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const blankPages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const visibleText = textContent.items
        .map((item) => item.str)
        .join("")
        .replace(/\s+/gu, "");
      if (!visibleText) blankPages.push(pageNumber);
    }
  } finally {
    await pdf.destroy();
  }
  if (blankPages.length) {
    throw new Error(`PDF 排版复核未通过：第 ${blankPages.join("、")} 页为空白页`);
  }
}

export async function createPdfReport({ material, baseUrl }) {
  const normalized = prepareExportMaterial(material);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30_000);
    await page.goto(`${baseUrl}/?export=pdf`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.renderStudyReportForExport === "function");
    await page.waitForFunction(() => [...document.styleSheets].some((sheet) => sheet.href?.endsWith("/export-print.css")));
    const mathRenderState = await page.evaluate((report) => window.renderStudyReportForExport(report), normalized);
    if (mathRenderState !== "ready") {
      const detail = await page.locator("#study-paper").getAttribute("data-math-render-error");
      throw new Error(`公式渲染未完成：${detail || "未知公式错误"}`);
    }
    await page.waitForFunction(() => document.querySelector("#study-paper")?.dataset.mathRenderState === "ready");
    await page.emulateMedia({ media: "print" });
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    const layoutAudit = await page.evaluate(() => {
      const root = document.querySelector("#study-paper");
      if (!root) return { overflow: ["缺少报告正文"], overlaps: [] };
      const rootRect = root.getBoundingClientRect();
      const structuralSelectors = [
        ".key-point",
        ".point-content",
        ".point-decision-grid",
        ".point-diagnostic-answer",
        ".strategy-card",
        ".worked-example",
        ".practice-item",
        ".mastery-content"
      ];
      const describe = (element) => {
        const className = typeof element.className === "string" ? element.className.trim() : "";
        return className ? `${element.tagName.toLowerCase()}.${className.replace(/\s+/gu, ".")}` : element.tagName.toLowerCase();
      };
      const structuralNodes = [...root.querySelectorAll([
        ".key-point",
        ".strategy-card",
        ".worked-example",
        ".practice-item",
        ".mastery-level",
        ".teaching-figure",
        ".knowledge-diagram-card",
        ".visual-block"
      ].join(","))];
      const overflow = structuralNodes
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1);
        })
        .slice(0, 8)
        .map(describe);
      const overlaps = [];
      structuralSelectors.forEach((selector) => {
        root.querySelectorAll(selector).forEach((container) => {
          const children = [...container.children].filter((child) => {
            const style = getComputedStyle(child);
            const rect = child.getBoundingClientRect();
            return style.display !== "none"
              && style.visibility !== "hidden"
              && !["absolute", "fixed"].includes(style.position)
              && rect.width > 1
              && rect.height > 1;
          });
          for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
            const left = children[leftIndex].getBoundingClientRect();
            for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
              const right = children[rightIndex].getBoundingClientRect();
              const horizontal = Math.min(left.right, right.right) - Math.max(left.left, right.left);
              const vertical = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
              if (horizontal > 1 && vertical > 1) {
                overlaps.push(`${describe(children[leftIndex])} / ${describe(children[rightIndex])}`);
                if (overlaps.length >= 8) return;
              }
            }
          }
        });
      });
      return { overflow, overlaps };
    });
    if (layoutAudit.overflow.length || layoutAudit.overlaps.length) {
      throw new Error(`导出排版预检未通过：${[
        ...layoutAudit.overflow.map((item) => `越界 ${item}`),
        ...layoutAudit.overlaps.map((item) => `重叠 ${item}`)
      ].join("；")}`);
    }
    const pdf = Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      tagged: true,
      outline: true
    }));
    await assertPdfHasNoBlankPages(pdf);
    return pdf;
  } finally {
    await browser.close();
  }
}
