import { visit } from 'unist-util-visit';

const FORMULA_ERROR_TEXT = '公式格式异常，请重新生成';

export function rehypeScientificFormulaFallback() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      const classNames = Array.isArray(node.properties?.className)
        ? node.properties.className
        : [];
      if (!classNames.includes('katex-error') || !parent || !Number.isInteger(index)) return;
      parent.children[index] = {
        type: 'element',
        tagName: 'span',
        properties: {
          className: ['scientific-render-error'],
          role: 'status',
        },
        children: [{ type: 'text', value: FORMULA_ERROR_TEXT }],
      };
    });
  };
}
