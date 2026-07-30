'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const JSZip = require('jszip');
const katex = require('katex');
require('katex/contrib/mhchem');
const { DOMParser } = require('@xmldom/xmldom');
const {
    DOCX_MIME,
    academicTextToWordBlocks,
    createEditableWordDocument,
    latexToOmml,
    plainTextSegments,
    prepareMathmlForOmml,
    tokenizeAcademicText
} = require('../shared/editable-word-export');

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XlM5WQAAAABJRU5ErkJggg==';

function countMatches(value, pattern) {
    return (String(value || '').match(pattern) || []).length;
}

function assertValidXml(xml, label) {
    const errors = [];
    const parser = new DOMParser({
        errorHandler: {
            warning: () => {},
            error: (message) => errors.push(message),
            fatalError: (message) => errors.push(message)
        }
    });
    const documentNode = parser.parseFromString(xml, 'application/xml');
    assert.ok(documentNode.documentElement, `${label} 缺少根节点`);
    assert.deepEqual(errors, [], `${label} 必须是有效 XML`);
}

test('数学、物理、化学、生物、地理和复杂结构均转换为 Word 原生 OMML', () => {
    const samples = [
        ['数学', String.raw`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, ['<m:f>', '<m:rad>']],
        ['物理', String.raw`v=v_0+at,\quad E_k=\frac12mv^2`, ['<m:sSub>', '<m:f>']],
        ['化学', String.raw`\ce{SO4^2- + Ba^2+ -> BaSO4 v}`, ['<m:sSub>', '<m:sSup>']],
        ['化学单位', String.raw`\pu{8.31 J mol^{-1} K^{-1}}`, ['<m:sSup>']],
        ['生物', String.raw`N_t=N_0\left(\frac12\right)^{t/T_{1/2}}`, ['<m:sSub>', '<m:sSup>']],
        ['地理', String.raw`H=1000\frac{P_1-P_2}{\rho g}`, ['<m:f>', '<m:sSub>']],
        ['比较符', String.raw`\Delta<0\quad\text{且}\quad a>b\ \&\ b\neq0`, ['<m:r>']],
        ['方程组', String.raw`\begin{cases}x+y=3\\2x-y=0\end{cases}`, ['<m:d>', '<m:m>']],
        ['矩阵', String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, ['<m:d>', '<m:m>']],
        ['积分', String.raw`\int_0^{\infty}e^{-x^2}\,dx`, ['<m:nary>', '<m:sSup>']]
    ];

    samples.forEach(([subject, source, expectedTags]) => {
        const omml = latexToOmml(source);
        assert.match(omml, /^<m:oMath\b/u, `${subject} 必须输出 OMML`);
        expectedTags.forEach((tag) => assert.ok(omml.includes(tag), `${subject} 缺少 ${tag}`));
        assert.doesNotMatch(omml, /m:val="undefined"/u, `${subject} 不得包含无效样式`);
        assert.doesNotMatch(omml, /<m:t[^>]*>X<\/m:t>/u, `${subject} 不得泄漏 mhchem 占位 X`);
        assert.doesNotMatch(omml, /<(?:math|mrow|mfrac|msub|msup)\b/u, `${subject} 不得残留 MathML`);
        if (subject === '比较符') {
            assert.match(omml, />Δ<\/m:t>/u);
            assert.match(omml, /&lt;0/u);
            assert.match(omml, /a&gt;b/u);
            assert.match(omml, /&amp;/u);
        }
        assertValidXml(`<root xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${omml}</root>`, `${subject} OMML`);
    });
});

test('mhchem MathML 预处理删除零宽占位并把上下标挂回真实化学式', () => {
    const markup = katex.renderToString(String.raw`\ce{SO4^2- + H2O}`, {
        output: 'mathml',
        throwOnError: true,
        strict: 'ignore'
    });
    const mathml = markup.match(/<math\b[\s\S]*<\/math>/u)[0];
    const prepared = prepareMathmlForOmml(mathml);

    assert.doesNotMatch(prepared, /<(?:annotation|mpadded|mphantom)\b/u);
    assert.match(prepared, /<msup><msub>[\s\S]*<mn>4<\/mn>[\s\S]*<mn>2<\/mn><mo>−<\/mo>/u);
    assert.match(prepared, /<msub><mi[^>]*>H<\/mi><mn>2<\/mn><\/msub>/u);
});

test('学术文本令牌化覆盖题干、行内公式、独立公式和隐式 LaTeX', () => {
    const tokens = tokenizeAcademicText(String.raw`速度 \(v=v_0+at\)。\[E_k=\frac12mv^2\] 化学 \ce{H2O}。`);
    assert.equal(tokens.filter((token) => token.type === 'math').length, 3);
    assert.deepEqual(tokens.filter((token) => token.type === 'math').map((token) => token.display), [false, true, false]);
    assert.equal(tokens.filter((token) => token.type === 'text').map((token) => token.value).join(''), '速度 。 化学 。');
});

test('独立公式写入 Word 段落，确保 WPS 可见且保持原生可编辑', () => {
    const result = academicTextToWordBlocks(
        String.raw`解方程组：\[\begin{cases}x+y=3\\2x-y=0\end{cases}\]`,
        { styleId: 'Question' }
    );
    const xml = result.blocks.join('');

    assert.equal(result.formulaCount, 1);
    assert.match(xml, /<w:p><w:pPr><w:pStyle w:val="Question"\/><\/w:pPr><m:oMathPara>/u);
    assert.match(xml, /<m:oMathPara>[\s\S]*<m:d>[\s\S]*<m:m>/u);
    assert.doesNotMatch(xml, /^<m:oMathPara>/u, '独立公式不得直接成为文档主体节点');
});

test('未定界学科符号仍以 Word 可编辑文本上下标表示', () => {
    const segments = plainTextSegments('H2SO4、CO2、x^2、v_0、SO₄²⁻、Delta T、A4纸');
    const subscriptText = segments.filter((segment) => segment.verticalAlign === 'subscript').map((segment) => segment.value).join('|');
    const superscriptText = segments.filter((segment) => segment.verticalAlign === 'superscript').map((segment) => segment.value).join('|');
    const normalText = segments.filter((segment) => !segment.verticalAlign).map((segment) => segment.value).join('');

    assert.equal(subscriptText, '2|4|2|0|4');
    assert.equal(superscriptText, '2|2-');
    assert.match(normalText, /HSO、CO、x、v、SO、Δ T、A4纸/u);
});

test('真实 DOCX 包写入全学科 OMML、可编辑文本和唯一题图媒体', async () => {
    const groups = {
        choice: {
            title: '一、跨学科选择题',
            items: [
                {
                    index: 1,
                    stem: String.raw`数学：求 \(x=\frac{-b+\sqrt{b^2-4ac}}{2a}\)。`,
                    options: [String.raw`A. \(x>0\)`, String.raw`B. \(x\leq0\)`],
                    originalIdx: 0
                },
                {
                    index: 2,
                    stem: String.raw`物理：由 \(F=ma\) 计算 \(a=2\,\mathrm{m/s^2}\)。`,
                    options: [],
                    originalIdx: 1
                },
                {
                    index: 3,
                    stem: String.raw`化学：配平 \(\ce{2H2 + O2 -> 2H2O}\)。兼容文本 H2O 与 x^2 仍须可编辑。`,
                    options: [],
                    originalIdx: 2
                },
                {
                    index: 4,
                    stem: String.raw`生物：种群增长满足 \(N_t=N_0e^{rt}\)。`,
                    options: [],
                    originalIdx: 3
                },
                {
                    index: 5,
                    stem: String.raw`地理：相对高度为 \(H=1000\frac{P_1-P_2}{\rho g}\)。`,
                    options: [],
                    originalIdx: 4
                }
            ]
        }
    };
    const answers = [
        String.raw`1. \(x=\frac{-b+\sqrt{b^2-4ac}}{2a}\)，解析：使用求根公式。`,
        String.raw`2. \(a=2\,\mathrm{m/s^2}\)。`,
        String.raw`3. \(\ce{2H2 + O2 -> 2H2O}\)。`,
        String.raw`4. \(N_t=N_0e^{rt}\)。`,
        String.raw`5. \(H=1000\frac{P_1-P_2}{\rho g}\)。`
    ];
    const figureImages = new Map([[2, ONE_PIXEL_PNG]]);
    const result = await createEditableWordDocument({
        title: '五大学科可编辑公式试卷',
        groups,
        answers,
        showAnswer: true,
        figureImages
    });

    assert.equal(result.mimeType, DOCX_MIME);
    assert.equal(result.fileName, '五大学科可编辑公式试卷.docx');
    assert.equal(result.figureCount, 1);
    assert.equal(result.formulaCount, 13);
    assert.deepEqual(Array.from(result.bytes.slice(0, 2)), [0x50, 0x4B]);

    const zip = await JSZip.loadAsync(result.bytes);
    const requiredParts = [
        '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml',
        'word/document.xml', 'word/styles.xml', 'word/settings.xml',
        'word/_rels/document.xml.rels', 'word/media/figure-1.png'
    ];
    requiredParts.forEach((part) => assert.ok(zip.file(part), `DOCX 缺少 ${part}`));

    const documentXml = await zip.file('word/document.xml').async('string');
    const relationshipsXml = await zip.file('word/_rels/document.xml.rels').async('string');
    const settingsXml = await zip.file('word/settings.xml').async('string');
    assertValidXml(documentXml, 'word/document.xml');
    assertValidXml(relationshipsXml, 'word/_rels/document.xml.rels');
    assert.equal(countMatches(documentXml, /<m:oMath\b/gu), result.formulaCount);
    assert.ok(countMatches(documentXml, /<m:f>/gu) >= 3, '分式必须是原生公式结构');
    assert.ok(countMatches(documentXml, /<m:rad>/gu) >= 2, '根式必须是原生公式结构');
    assert.match(documentXml, /<w:t[^>]*>五大学科可编辑公式试卷<\/w:t>/u);
    assert.match(documentXml, /<w:vertAlign w:val="(?:subscript|superscript)"\/>/u);
    assert.doesNotMatch(documentXml, /\\(?:frac|ce|sqrt|pu)\b/u, 'DOCX 不得暴露原始 LaTeX 命令');
    assert.doesNotMatch(documentXml, /<m:t[^>]*>X<\/m:t>/u, 'DOCX 不得包含 mhchem 占位 X');
    assert.doesNotMatch(documentXml, /<(?:canvas|svg|math)\b/iu, '公式不得以网页或图片节点写入');
    assert.equal(countMatches(relationshipsXml, /relationships\/image/gu), 1, '图片关系只能来自唯一题图');
    assert.match(settingsXml, /<m:mathFont m:val="Cambria Math"\/>/u);
});

test('非法公式必须阻止导出，不能静默生成错误 Word', async () => {
    await assert.rejects(
        createEditableWordDocument({
            title: '非法公式',
            groups: {
                calculation: {
                    title: '计算题',
                    items: [{ index: 1, stem: String.raw`计算 \(\frac{a}\)。`, options: [] }]
                }
            }
        }),
        /无法转换为规范公式/u
    );
});
