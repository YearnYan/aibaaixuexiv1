import { sanitizeSvgMarkup, splitScientificText } from './scientificText.js';
import { latexMathToPlainText } from './wordMath.js';

const SVG_TAG_PATTERN = /<\/?(?:svg|g|path|rect|circle|ellipse|line|polyline|polygon|text|tspan|defs|clipPath|mask|linearGradient|radialGradient|stop|pattern|marker|symbol|use|title|desc)\b[^>]*>/gi;
const SUBSCRIPT_CHARS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
const SUPERSCRIPT_CHARS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };

function escapeXmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mapScript(value, characters, fallback) {
  const source = String(value || '');
  return [...source].every((character) => characters[character])
    ? [...source].map((character) => characters[character]).join('')
    : fallback(source);
}

function makeFormulaReadable(value) {
  return latexMathToPlainText(value)
    .replace(/_\(([^()]*)\)/g, (_, content) => mapScript(content, SUBSCRIPT_CHARS, (text) => (/^[\p{Script=Han}]+$/u.test(text) ? text : `_(${text})`)))
    .replace(/\^\(([^()]*)\)/g, (_, content) => mapScript(content, SUPERSCRIPT_CHARS, (text) => (text === '°' ? '°' : `^(${text})`)))
    .replace(/[ \t]{2,}/g, ' ');
}

export function normalizeEducationalSvgText(value) {
  const source = String(value || '');
  const segments = splitScientificText(source);
  return segments.map((segment) => {
    if (segment.type === 'math') return makeFormulaReadable(segment.value);
    if (/\\(?:[A-Za-z]+|[^\s])|[_^]\s*(?:\{|[A-Za-z0-9])/.test(segment.value)) {
      return makeFormulaReadable(segment.value.replace(/\\\(|\\\)|\\\[|\\\]/g, ''));
    }
    return segment.value;
  }).join('');
}

function normalizeVisibleText(markup) {
  let result = '';
  let cursor = 0;
  let visibleTextDepth = 0;
  SVG_TAG_PATTERN.lastIndex = 0;
  let match;
  while ((match = SVG_TAG_PATTERN.exec(markup))) {
    const text = markup.slice(cursor, match.index);
    result += visibleTextDepth ? escapeXmlText(normalizeEducationalSvgText(text)) : text;
    const tag = match[0];
    result += tag;
    const name = tag.match(/^<\/?\s*([A-Za-z]+)/)?.[1]?.toLowerCase();
    if (name === 'text' || name === 'tspan') {
      if (tag.startsWith('</')) visibleTextDepth = Math.max(0, visibleTextDepth - 1);
      else if (!/\/\s*>$/.test(tag)) visibleTextDepth += 1;
    }
    cursor = match.index + tag.length;
  }
  return result + (visibleTextDepth ? escapeXmlText(normalizeEducationalSvgText(markup.slice(cursor))) : markup.slice(cursor));
}

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function resolveLength(value, total, fallback = 0) {
  const source = String(value || '').trim();
  if (!source) return fallback;
  const number = Number.parseFloat(source);
  if (!Number.isFinite(number)) return fallback;
  return source.endsWith('%') ? total * number / 100 : number;
}

function canvasGeometry(svgTag) {
  const viewBox = readAttribute(svgTag, 'viewBox').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  }
  return {
    x: 0,
    y: 0,
    width: Math.max(1, resolveLength(readAttribute(svgTag, 'width'), 1, 1)),
    height: Math.max(1, resolveLength(readAttribute(svgTag, 'height'), 1, 1))
  };
}

function isBlackboardDecoration(rectTag, canvas) {
  const width = resolveLength(readAttribute(rectTag, 'width'), canvas.width);
  const height = resolveLength(readAttribute(rectTag, 'height'), canvas.height);
  if (width <= 0 || height <= 0) return false;
  const x = resolveLength(readAttribute(rectTag, 'x'), canvas.width, canvas.x);
  const y = resolveLength(readAttribute(rectTag, 'y'), canvas.height, canvas.y);
  const left = (x - canvas.x) / canvas.width;
  const top = (y - canvas.y) / canvas.height;
  const right = (x + width - canvas.x) / canvas.width;
  const bottom = (y + height - canvas.y) / canvas.height;
  const widthRatio = width / canvas.width;
  const heightRatio = height / canvas.height;
  const fill = readAttribute(rectTag, 'fill').trim().toLowerCase();
  const fillOpacity = Number.parseFloat(readAttribute(rectTag, 'fill-opacity'));
  const transparentFill = fill === 'none' || fill === 'transparent' || fillOpacity === 0;

  const canvasBackdrop = widthRatio >= 0.88 && heightRatio >= 0.88
    && left <= 0.08 && top <= 0.08 && right >= 0.92 && bottom >= 0.92;
  const decorativeFrame = transparentFill && widthRatio * heightRatio >= 0.5
    && left <= 0.2 && top <= 0.2 && right >= 0.8 && bottom >= 0.8;
  return canvasBackdrop || decorativeFrame;
}

function removeBlackboardDecorations(markup) {
  const svgTag = markup.match(/^<svg\b[^>]*>/i)?.[0];
  if (!svgTag) return markup;
  const canvas = canvasGeometry(svgTag);
  return markup.replace(/<rect\b[^>]*(?:\/\s*>|>\s*<\/rect\s*>)/gi, (rectTag) => (
    isBlackboardDecoration(rectTag, canvas) ? '' : rectTag
  ));
}

function normalizeBlackboardTextWeight(markup) {
  return markup.replace(/<(g|text|tspan)\b([^>]*)>/gi, (tag, name, attributes) => {
    const selfClosing = /\/\s*>$/.test(tag);
    const cleanAttributes = attributes
      .replace(/\sfont-weight\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\/\s*$/, '');
    return `<${name}${cleanAttributes} font-weight="400"${selfClosing ? ' /' : ''}>`;
  });
}

export function normalizeEducationalSvgMarkup(value, { blackboard = false } = {}) {
  const safeSvg = sanitizeSvgMarkup(value);
  if (!safeSvg) return '';
  const layoutSvg = blackboard ? removeBlackboardDecorations(safeSvg) : safeSvg;
  const readableSvg = normalizeVisibleText(layoutSvg);
  return blackboard ? normalizeBlackboardTextWeight(readableSvg) : readableSvg;
}
