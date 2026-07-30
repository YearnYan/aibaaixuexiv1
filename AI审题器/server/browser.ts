import { existsSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const EXECUTABLE_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROMIUM_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter((value): value is string => Boolean(value));

let browserPromise: Promise<Browser> | null = null;

function findExecutable() {
  return EXECUTABLE_CANDIDATES.find((candidate) => existsSync(candidate));
}

export function getReportBrowser() {
  if (!browserPromise) {
    const executablePath = findExecutable();
    if (!executablePath) {
      const error = new Error("服务器缺少 Chromium，暂时无法生成 PDF 或含公式的 Word 报告");
      Object.assign(error, { statusCode: 503 });
      throw error;
    }
    browserPromise = puppeteer
      .launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=medium"],
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

export async function withReportPage<T>(
  callback: (page: Page) => Promise<T>,
  viewport = { width: 1200, height: 900, deviceScaleFactor: 2 },
) {
  const browser = await getReportBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);
    return await callback(page);
  } finally {
    await page.close();
  }
}

export async function closeReportBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
