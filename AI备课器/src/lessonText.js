import { splitRichContent } from './scientificText.js';
import { normalizeEducationalSvgMarkup } from './educationalSvg.js';

function cleanBlackboardText(value) {
  return String(value || '')
    .replace(/[|｜]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

export function sanitizeBlackboard(value) {
  const cleaned = splitRichContent(value).map((segment) => {
    if (segment.type === 'math') {
      const singleLineFormula = segment.value.replace(/\s*\n\s*/g, ' ').trim();
      return `${segment.display ? '\\[' : '\\('}${singleLineFormula}${segment.display ? '\\]' : '\\)'}`;
    }
    if (segment.type === 'svg') return normalizeEducationalSvgMarkup(segment.value, { blackboard: true });
    return segment.value.split('\n').map(cleanBlackboardText).join('\n');
  })
    .join('');

  return cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[-:—–\s]+$/.test(line))
    .join('\n');
}
