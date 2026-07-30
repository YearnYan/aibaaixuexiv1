import { describe, expect, it } from 'vitest';
import { rehypeScientificFormulaFallback } from './scientific-rendering.js';

describe('公式渲染失败兜底', () => {
  it('用中文提示替换 KaTeX 红色原始命令', () => {
    const tree = {
      type: 'root',
      children: [{
        type: 'element',
        tagName: 'span',
        properties: { className: ['katex-error'] },
        children: [{ type: 'text', value: '\\ceNaOH' }],
      }],
    };

    rehypeScientificFormulaFallback()(tree);

    expect(tree.children[0]).toMatchObject({
      properties: { className: ['scientific-render-error'] },
      children: [{ type: 'text', value: '公式格式异常，请重新生成' }],
    });
    expect(JSON.stringify(tree)).not.toContain('\\ceNaOH');
  });

  it('不改写已经成功渲染的 KaTeX 节点', () => {
    const validNode = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['katex'] },
      children: [{ type: 'text', value: 'NaOH' }],
    };
    const tree = { type: 'root', children: [validNode] };
    rehypeScientificFormulaFallback()(tree);
    expect(tree.children[0]).toBe(validNode);
  });
});
