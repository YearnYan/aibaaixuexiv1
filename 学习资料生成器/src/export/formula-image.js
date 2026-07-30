import { Resvg } from "@resvg/resvg-js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import {
  collectFormulaSegments,
  formulaCacheKey,
  validateLatex
} from "../formula.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({ packages: AllPackages });
const svgOutput = new SVG({ fontCache: "none" });
const mathDocument = mathjax.document("", { InputJax: tex, OutputJax: svgOutput });

function extractSvg(markup) {
  const matched = String(markup).match(/<svg\b[\s\S]*<\/svg>/iu);
  if (!matched) throw new Error("公式转换后没有生成 SVG");
  return matched[0];
}

function getViewBox(svg) {
  const matched = svg.match(/viewBox="([^"]+)"/iu);
  if (!matched) return { width: 1_000, height: 1_000 };
  const values = matched[1].trim().split(/\s+/u).map(Number);
  const width = Math.abs(values[2]) || 1_000;
  const height = Math.abs(values[3]) || 1_000;
  return { width, height };
}

function setRasterSize(svg, width, height) {
  return svg.replace(/<svg\b([^>]*)>/iu, (fullMatch, attributes) => {
    const cleanedAttributes = attributes
      .replace(/\s(?:width|height)="[^"]*"/giu, "")
      .replace(/\sstyle="[^"]*"/giu, "");
    return `<svg${cleanedAttributes} width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">`;
  });
}

function calculateDisplaySize(viewBox, display) {
  const ratio = Math.max(0.12, Math.min(40, viewBox.width / viewBox.height));
  let height = display ? 32 : 18;
  let width = Math.max(8, height * ratio);
  const maxWidth = display ? 620 : 320;
  if (width > maxWidth) {
    height = Math.max(display ? 17 : 11, height * (maxWidth / width));
    width = maxWidth;
  }
  return {
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10
  };
}

export function renderFormulaImage(latex, display = false) {
  const validation = validateLatex(latex, display);
  if (!validation.valid) throw new Error(`LaTeX 无法解析：${validation.error}`);

  const converted = mathDocument.convert(String(latex).trim(), { display: Boolean(display) });
  const svg = extractSvg(adaptor.outerHTML(converted));
  const viewBox = getViewBox(svg);
  const displaySize = calculateDisplaySize(viewBox, display);
  const scale = 4;
  const rasterWidth = Math.max(32, Math.ceil(displaySize.width * scale));
  const rasterHeight = Math.max(32, Math.ceil(displaySize.height * scale));
  const sizedSvg = setRasterSize(svg, rasterWidth, rasterHeight);
  const rendered = new Resvg(sizedSvg, {
    background: "rgba(255, 255, 255, 0)",
    fitTo: { mode: "original" },
    font: { loadSystemFonts: true }
  }).render();

  return {
    data: Buffer.from(rendered.asPng()),
    width: displaySize.width,
    height: displaySize.height,
    display: Boolean(display),
    latex: String(latex).trim()
  };
}

export function createFormulaImageCache(material) {
  const cache = new Map();
  collectFormulaSegments(material).forEach((formula) => {
    const key = formulaCacheKey(formula.value, formula.display);
    if (cache.has(key)) return;
    try {
      cache.set(key, renderFormulaImage(formula.value, formula.display));
    } catch (error) {
      const wrapped = new Error(`Word 公式渲染失败（${formula.value}）：${error.message}`);
      wrapped.code = "FORMULA_RENDER_FAILED";
      throw wrapped;
    }
  });
  return cache;
}
