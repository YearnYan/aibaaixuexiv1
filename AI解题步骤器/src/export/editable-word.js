function childElements(node) {
  return [...node.childNodes].filter((child) => child.nodeType === Node.ELEMENT_NODE);
}

function normalizeMathText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/−/g, '−')
    .trim();
}

function mathMlChildren(node, word) {
  return childElements(node).flatMap((child) => mathMlNode(child, word));
}

function bracketComponent(open, children, word) {
  if (open === '[') return new word.MathSquareBrackets({ children });
  if (open === '{') return new word.MathCurlyBrackets({ children });
  if (open === '⟨' || open === '<') return new word.MathAngledBrackets({ children });
  return new word.MathRoundBrackets({ children });
}

function mathMlNode(node, word) {
  const name = node.localName?.toLowerCase();
  if (!name || name === 'annotation') return [];

  if (['math', 'semantics', 'mrow', 'mstyle', 'mpadded', 'mphantom'].includes(name)) {
    return mathMlChildren(node, word);
  }

  if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(name)) {
    const text = normalizeMathText(node.textContent);
    return text ? [new word.MathRun(text)] : [];
  }

  if (name === 'mspace') return [new word.MathRun(' ')];

  const children = childElements(node);
  if (name === 'mfrac' && children.length >= 2) {
    return [new word.MathFraction({
      numerator: mathMlNode(children[0], word),
      denominator: mathMlNode(children[1], word),
    })];
  }

  if (name === 'msqrt') {
    return [new word.MathRadical({ children: mathMlChildren(node, word) })];
  }

  if (name === 'mroot' && children.length >= 2) {
    return [new word.MathRadical({
      children: mathMlNode(children[0], word),
      degree: mathMlNode(children[1], word),
    })];
  }

  if (name === 'msup' && children.length >= 2) {
    return [new word.MathSuperScript({
      children: mathMlNode(children[0], word),
      superScript: mathMlNode(children[1], word),
    })];
  }

  if (name === 'msub' && children.length >= 2) {
    return [new word.MathSubScript({
      children: mathMlNode(children[0], word),
      subScript: mathMlNode(children[1], word),
    })];
  }

  if (name === 'msubsup' && children.length >= 3) {
    return [new word.MathSubSuperScript({
      children: mathMlNode(children[0], word),
      subScript: mathMlNode(children[1], word),
      superScript: mathMlNode(children[2], word),
    })];
  }

  if ((name === 'mover' || name === 'munder') && children.length >= 2) {
    const options = {
      children: mathMlNode(children[0], word),
      [name === 'mover' ? 'superScript' : 'subScript']: mathMlNode(children[1], word),
    };
    return [name === 'mover'
      ? new word.MathSuperScript(options)
      : new word.MathSubScript(options)];
  }

  if (name === 'munderover' && children.length >= 3) {
    return [new word.MathSubSuperScript({
      children: mathMlNode(children[0], word),
      subScript: mathMlNode(children[1], word),
      superScript: mathMlNode(children[2], word),
    })];
  }

  if (name === 'mfenced') {
    return [bracketComponent(node.getAttribute('open') || '(', mathMlChildren(node, word), word)];
  }

  if (name === 'menclose') {
    return [new word.MathSquareBrackets({ children: mathMlChildren(node, word) })];
  }

  if (name === 'mtable') {
    const rows = children.map((row) => mathMlNode(row, word));
    const linear = rows.flatMap((row, index) => (
      index === rows.length - 1 ? row : [...row, new word.MathRun('; ')]
    ));
    return [new word.MathSquareBrackets({ children: linear })];
  }

  if (name === 'mtr') {
    return children.flatMap((cell, index) => {
      const content = mathMlNode(cell, word);
      return index === children.length - 1 ? content : [...content, new word.MathRun(', ')];
    });
  }

  if (name === 'mtd') return mathMlChildren(node, word);

  const nested = mathMlChildren(node, word);
  if (nested.length) return nested;
  const fallback = normalizeMathText(node.textContent);
  return fallback ? [new word.MathRun(fallback)] : [];
}

function latexToWordMath(latex, katex, word) {
  const markup = katex.renderToString(latex, {
    output: 'mathml',
    throwOnError: true,
    strict: 'error',
    trust: false,
    maxExpand: 1000,
  });
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const math = parsed.querySelector('math');
  const components = math ? mathMlNode(math, word) : [];
  return new word.Math({
    children: components.length ? components : [new word.MathRun(latex)],
  });
}

function inlineChildren(nodes, context, formatting = {}) {
  const result = [];
  for (const node of nodes || []) {
    if (node.type === 'text') {
      result.push(new context.word.TextRun({ text: node.value, ...formatting }));
    } else if (node.type === 'inlineMath') {
      result.push(latexToWordMath(node.value, context.katex, context.word));
    } else if (node.type === 'strong') {
      result.push(...inlineChildren(node.children, context, { ...formatting, bold: true }));
    } else if (node.type === 'emphasis') {
      result.push(...inlineChildren(node.children, context, { ...formatting, italics: true }));
    } else if (node.type === 'break') {
      result.push(new context.word.TextRun({ break: 1 }));
    } else if (node.children) {
      result.push(...inlineChildren(node.children, context, formatting));
    }
  }
  return result;
}

function markdownParagraphs(source, context, options = {}) {
  const tree = context.markdownParser.parse(String(source || ''));
  const paragraphs = [];

  const renderBlocks = (nodes, list = null) => {
    for (const node of nodes || []) {
      if (node.type === 'paragraph') {
        paragraphs.push(new context.word.Paragraph({
          children: inlineChildren(node.children, context),
          keepLines: true,
          spacing: { after: options.after ?? 130, line: options.line ?? 330 },
          ...(list ? { numbering: list } : {}),
        }));
      } else if (node.type === 'math') {
        paragraphs.push(new context.word.Paragraph({
          alignment: context.word.AlignmentType.CENTER,
          children: [latexToWordMath(node.value, context.katex, context.word)],
          keepLines: true,
          spacing: { before: 100, after: 160 },
        }));
      } else if (node.type === 'list') {
        const reference = node.ordered ? 'report-numbers' : 'report-bullets';
        node.children.forEach((item) => renderBlocks(item.children, { reference, level: 0 }));
      } else if (node.type === 'blockquote') {
        renderBlocks(node.children);
      } else if (node.children) {
        renderBlocks(node.children, list);
      }
    }
  };

  renderBlocks(tree.children);
  return paragraphs.length ? paragraphs : [new context.word.Paragraph('')];
}

function sectionHeading(text, word, level = 2, options = {}) {
  return new word.Paragraph({
    heading: level === 1 ? word.HeadingLevel.HEADING_1 : word.HeadingLevel.HEADING_2,
    pageBreakBefore: options.pageBreakBefore,
    keepNext: true,
    spacing: { before: level === 1 ? 300 : 240, after: 120 },
    children: [new word.TextRun({ text, bold: true, color: level === 1 ? '1F3F57' : '345F83' })],
  });
}

function labelParagraph(text, word) {
  return new word.Paragraph({
    keepNext: true,
    spacing: { before: 130, after: 70 },
    children: [new word.TextRun({ text, bold: true, color: '2F7A4C', size: 21 })],
  });
}

export async function buildEditableWordBlob(session) {
  const word = await import('docx');
  const markdownParser = unified().use(remarkParse).use(remarkMath);
  const context = { word, katex, markdownParser };
  const children = [
    new word.Paragraph({
      alignment: word.AlignmentType.CENTER,
      spacing: { before: 280, after: 90 },
      children: [new word.TextRun({ text: 'AI 解题步骤报告', bold: true, size: 40, color: '1F3F57' })],
    }),
    new word.Paragraph({
      alignment: word.AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [new word.TextRun({ text: '四步解题指导与完整答案', size: 21, color: '666666' })],
    }),
    sectionHeading('题目摘要', word, 1),
    ...markdownParagraphs(session.problemSummary, context),
    sectionHeading('涉及知识点', word, 2),
    ...session.knowledgePoints.map((point) => new word.Paragraph({
      numbering: { reference: 'knowledge-bullets', level: 0 },
      spacing: { after: 90 },
      children: inlineChildren(markdownParser.parse(point).children[0]?.children || [], context),
    })),
  ];

  session.steps.forEach((step, index) => {
    children.push(
      sectionHeading(`${String(index + 1).padStart(2, '0')}  ${step.title}`, word, 1),
      ...markdownParagraphs(step.description, context, { after: 100 }),
      labelParagraph('本步重点', word),
      ...markdownParagraphs(step.task, context),
      labelParagraph('AI 解题指导', word),
      ...markdownParagraphs(step.guidance, context),
      labelParagraph('三级补充指导', word),
      ...step.hints.flatMap((hint, hintIndex) => [new word.Paragraph({
        numbering: { reference: `step-hints-${index}`, level: 0 },
        spacing: { after: 90, line: 310 },
        children: [
          new word.TextRun({ text: `${['一级', '二级', '三级'][hintIndex]}指导：`, bold: true }),
          ...inlineChildren(markdownParser.parse(hint).children[0]?.children || [], context),
        ],
      })]),
    );
  });

  children.push(
    sectionHeading('05  完整答案', word, 1, { pageBreakBefore: true }),
    ...markdownParagraphs(session.finalAnswer, context, { after: 150, line: 340 }),
  );

  const numbering = [
    {
      reference: 'knowledge-bullets',
      levels: [{
        level: 0,
        format: word.LevelFormat.BULLET,
        text: '•',
        alignment: word.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 480, hanging: 240 } } },
      }],
    },
    {
      reference: 'report-bullets',
      levels: [{
        level: 0,
        format: word.LevelFormat.BULLET,
        text: '•',
        alignment: word.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 480, hanging: 240 } } },
      }],
    },
    {
      reference: 'report-numbers',
      levels: [{
        level: 0,
        format: word.LevelFormat.DECIMAL,
        text: '%1.',
        alignment: word.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 480, hanging: 240 } } },
      }],
    },
    ...session.steps.map((_step, index) => ({
      reference: `step-hints-${index}`,
      levels: [{
        level: 0,
        format: word.LevelFormat.DECIMAL,
        text: '%1.',
        alignment: word.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 480, hanging: 240 } } },
      }],
    })),
  ];

  const doc = new word.Document({
    creator: 'AI 解题步骤器',
    title: 'AI 解题步骤报告',
    description: '四步解题指导与完整答案',
    numbering: { config: numbering },
    styles: {
      default: { document: { run: { font: 'Microsoft YaHei', size: 21 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Microsoft YaHei', size: 30, bold: true, color: '1F3F57' },
          paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Microsoft YaHei', size: 25, bold: true, color: '345F83' },
          paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1000, right: 1100, bottom: 1000, left: 1100 },
        },
      },
      footers: {
        default: new word.Footer({
          children: [new word.Paragraph({
            alignment: word.AlignmentType.CENTER,
            children: [
              new word.TextRun({ text: 'AI 解题步骤报告  |  ', color: '777777', size: 17 }),
              new word.TextRun({ children: [word.PageNumber.CURRENT], color: '777777', size: 17 }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return word.Packer.toBlob(doc);
}
import katex from 'katex';
import 'katex/contrib/mhchem';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
