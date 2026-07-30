import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createLessonDocxBlob } from '../src/exportDocx.js';
import { latexMathToPlainText } from '../src/wordMath.js';

test('LaTeX 公式转换为可读的可编辑表达', () => {
  assert.equal(latexMathToPlainText('x=-\\frac{b}{2a}'), 'x=-(b)/(2a)');
  assert.equal(latexMathToPlainText('\\ce{2H2 + O2 -> 2H2O}'), '2H₂ + O₂ → 2H₂O');
  assert.equal(latexMathToPlainText('x\\in\\mathbb{R}'), 'x∈ℝ');
  assert.equal(latexMathToPlainText('F_{\\向上} \\implies F_{\\向下}'), 'F_(向上) ⇒ F_(向下)');
  assert.equal(latexMathToPlainText('\\because a>b \\therefore a-b>0'), '∵ a>b ∴ a-b>0');
});

test('Word 导出使用原生 Office Math，不生成公式图片', { timeout: 15000 }, async () => {
  const blob = await createLessonDocxBlob({
    title: '公式测试教案',
    goals: ['理解 \\(y=x^2\\) 的图像', '分析 \\(F_{\\向上} \\implies F_{\\向下}\\)'],
    flow: [{ name: '公式探究', time: 45, context: '求解 \\(x=-\\frac{b}{2a}\\)' }],
    blackboard: '| 二次函数 |\n| \\(y=a(x-h)^2+k\\) |',
    reflection: ['检查公式是否可编辑']
  }, {
    period: '第1课时',
    duration: 45
  });

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file('word/document.xml').async('string');
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));

  assert.match(documentXml, /<m:oMath>/);
  assert.match(documentXml, /<m:f>/);
  assert.match(documentXml, /<m:sSup>/);
  assert.doesNotMatch(documentXml, /<w:drawing>/);
  assert.equal(mediaFiles.length, 0);
  assert.doesNotMatch(documentXml, /<m:t>\|<\/m:t>|<w:t[^>]*>\|<\/w:t>/);
});

test('动态教案 Word 按当前模块顺序输出，不补回固定模块', { timeout: 15000 }, async () => {
  const blob = await createLessonDocxBlob({
    documentVersion: 3,
    title: '动态模块教案',
    cover: { title: '动态模块教案', subtitle: '全局优化结果', meta: [] },
    appearance: { theme: 'blue', density: 'comfortable', pageLayout: 'single' },
    sections: [
      { id: 'conclusion', title: '先给结论', layout: 'stack', blocks: [{ type: 'paragraph', text: '浮力为 \\(F_{\\text{浮}}=G-F_{\\text{示}}\\)' }] },
      { id: 'data', title: '实验数据', layout: 'table', blocks: [{ type: 'table', headers: ['状态', '示数'], rows: [['空气中', '5 N'], ['水中', '3 N']] }] }
    ],
    footer: { note: '按实验器材调整。' }
  }, { lesson: '浮力', period: '第1课时', duration: 45 });

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file('word/document.xml').async('string');

  assert.match(documentXml, /先给结论/);
  assert.match(documentXml, /实验数据/);
  assert.ok(documentXml.indexOf('先给结论') < documentXml.indexOf('实验数据'));
  assert.match(documentXml, /<m:oMath>/);
  assert.match(documentXml, /<w:tbl>/);
  assert.doesNotMatch(documentXml, /课程标准与课时定位|学情诊断|课后反思/);
});

test('动态教案 Word 将独立和内嵌 SVG 转为可见图片', { timeout: 15000 }, async () => {
  const pngBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XvE4WQAAAABJRU5ErkJggg==', 'base64'));
  const converted = [];
  const blob = await createLessonDocxBlob({
    documentVersion: 3,
    title: 'SVG 图形测试教案',
    cover: { title: 'SVG 图形测试教案', meta: [] },
    appearance: { theme: 'classic', density: 'comfortable', pageLayout: 'single' },
    sections: [{
      id: 'figures',
      title: '图形验证',
      layout: 'stack',
      blocks: [
        { type: 'paragraph', text: '内嵌图：<svg viewBox="0 0 100 50"><title>内嵌关系图</title><line x1="5" y1="25" x2="95" y2="25" stroke="#000"/></svg>' },
        { type: 'svg', content: '<svg viewBox="0 0 120 60"><title>浮力方向图</title><line x1="60" y1="50" x2="60" y2="10" stroke="#173f34"/></svg>', caption: '浮力方向竖直向上' }
      ]
    }, {
      id: 'blackboard',
      title: '板书设计',
      layout: 'blackboard',
      blocks: [{
        type: 'paragraph',
        align: 'center',
        text: `<svg viewBox="0 0 160 90">
          <title>多行板书图</title>
          <rect width="160" height="90" fill="#173f34"/>
          <rect x="5" y="5" width="150" height="80" fill="none" stroke="#999"/>
          <text x="20" y="45" fill="#fff">板书图形：\\(\\sqrt{x} \\ge 0\\)</text>
        </svg>`
      }]
    }],
    footer: {}
  }, { lesson: '浮力', period: '第1课时', duration: 45 }, {
    rasterizeSvg: async (markup) => {
      converted.push(markup);
      const uniquePngBytes = new Uint8Array(pngBytes.length + 1);
      uniquePngBytes.set(pngBytes);
      uniquePngBytes[uniquePngBytes.length - 1] = converted.length;
      return { data: uniquePngBytes, width: 240, height: 120 };
    }
  });

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file('word/document.xml').async('string');
  const relationshipXml = await zip.file('word/_rels/document.xml.rels').async('string');
  const mediaFiles = Object.keys(zip.files).filter((name) => /^word\/media\/[^/]+\.png$/i.test(name));

  assert.equal(converted.length, 3);
  assert.equal(mediaFiles.length, 3);
  assert.equal((documentXml.match(/<w:drawing>/g) || []).length, 3);
  assert.match(documentXml, /浮力方向竖直向上/);
  assert.match(relationshipXml, /relationships\/image/);
  assert.doesNotMatch(documentXml, /SVG 图示，请在网页结果页查看/);
  const blackboardSvg = converted.find((markup) => /多行板书图/.test(markup));
  assert.ok(blackboardSvg);
  assert.doesNotMatch(blackboardSvg, /width="160" height="90"|width="150" height="80"/);
  assert.equal((blackboardSvg.match(/<rect\b/g) || []).length, 1);
  assert.match(blackboardSvg, /<rect x="0" y="0" width="100%" height="100%" fill="#173F34" \/>/);
  assert.doesNotMatch(blackboardSvg, /stroke="#999"/);
  assert.match(blackboardSvg, /板书图形：√\(x\) ≥ 0/);
  assert.doesNotMatch(blackboardSvg, /\\sqrt|\\ge|\\[()]/);
  converted.filter((markup) => markup !== blackboardSvg).forEach((markup) => {
    assert.doesNotMatch(markup, /fill="#173F34"/);
  });
});
