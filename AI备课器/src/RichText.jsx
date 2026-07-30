import React from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import { splitRichContent, splitScientificText } from './scientificText.js';
import { latexMathToPlainText } from './wordMath.js';
import { normalizeEducationalSvgMarkup } from './educationalSvg.js';

export { splitRichContent, splitScientificText } from './scientificText.js';

function Formula({ value, display }) {
  try {
    const html = katex.renderToString(value, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml'
    });
    return <span className={display ? 'science-formula science-formula-display' : 'science-formula science-formula-inline'} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span className="science-formula-fallback">{latexMathToPlainText(value)}</span>;
  }
}

function SafeSvg({ value, description }) {
  const normalized = normalizeEducationalSvgMarkup(value);
  return <span className="rich-svg" role="group" aria-label={description} dangerouslySetInnerHTML={{ __html: normalized }} />;
}

export function RichText({ children, className = '' }) {
  const segments = splitRichContent(children);
  return <span className={`rich-text ${className}`.trim()}>{segments.map((segment, index) => {
    if (segment.type === 'math') return <Formula key={`math-${index}-${segment.value}`} value={segment.value} display={segment.display} />;
    if (segment.type === 'svg') return <SafeSvg key={`svg-${index}`} value={segment.value} description={segment.description} />;
    return <React.Fragment key={`text-${index}`}>{segment.value}</React.Fragment>;
  })}</span>;
}
