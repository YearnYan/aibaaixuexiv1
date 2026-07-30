import 'katex/contrib/mhchem';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { rehypeScientificFormulaFallback } from '../scientific-rendering.js';

const rehypePlugins = [[rehypeKatex, {
  throwOnError: false,
  strict: 'error',
  trust: false,
  output: 'htmlAndMathml',
}], rehypeScientificFormulaFallback];

export default function ScientificText({ children, as = 'div', className = '' }) {
  const Component = as;
  const inline = as === 'span' || as === 'small';
  return (
    <Component className={`scientific-text${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={rehypePlugins}
        skipHtml
        components={inline ? { p: ({ children: content }) => content } : undefined}
      >
        {String(children || '')}
      </ReactMarkdown>
    </Component>
  );
}
