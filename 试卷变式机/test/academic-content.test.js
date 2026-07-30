const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const katex = require('katex');
require('katex/contrib/mhchem');

const {
  FORMULA_OUTPUT_RULE,
  parseAcademicJson,
  normalizeAcademicText,
  normalizeExamAcademicContent,
  stabilizeFormulaDelimiters,
  repairExamAcademicContent,
  findAcademicContentIssues,
  assertAcademicContentIntegrity,
} = require('../shared/academic-content');

const FORMULA_SEGMENT_PATTERN = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/gu;

function renderAllFormulaSegments(text) {
  const rendered = [];
  for (const match of String(text || '').matchAll(FORMULA_SEGMENT_PATTERN)) {
    const source = match[1] ?? match[2];
    rendered.push(katex.renderToString(source, {
      displayMode: match[2] !== undefined,
      throwOnError: true,
      strict: 'error',
      trust: false,
      output: 'htmlAndMathml',
    }));
  }
  return rendered;
}

test('JSON 解析前保护所有常见 LaTeX 控制转义，不吞掉命令字符', () => {
  const content = String.raw`说明文字
  {
    "title": "全学科公式卷",
    "questions": [{
      "type": "calculation",
      "title": "一、综合题",
      "items": [{
        "stem": "数学 \\(\\frac{1}{2}\\)，物理 \\(\\theta=30^\\circ\\)，化学 \\(\\ce{H2O}\\)，关系 \\(a\\neq b\\)",
        "options": ["A. \\(\\nabla f\\)", "B. \\(\\rho v\\)",],
        "answer": "\\(\\frac{1}{2}\\)",
        "explanation": "由 \\(\\begin{cases}x+y=3\\\\x-y=1\\end{cases}\\) 可得。"
      },],
    },],
  }
  后续说明`;

  const exam = parseAcademicJson(content);
  const item = exam.questions[0].items[0];
  assert.match(item.stem, /\\frac\{1\}\{2\}/u);
  assert.match(item.stem, /\\theta/u);
  assert.match(item.stem, /\\ce\{H2O\}/u);
  assert.match(item.stem, /\\neq/u);
  assert.match(item.options[0], /\\nabla/u);
  assert.match(item.options[1], /\\rho/u);
  assert.match(item.explanation, /\\begin\{cases\}/u);
  assert.doesNotMatch(item.stem, /[\u0000-\u001F\u007F]/u);
});

test('已经被 JSON 合法转义破坏的命令可保守恢复', () => {
  const damaged = '\frac{a}{b}；\theta；\neq；\right；\begin{cases}';
  const normalized = normalizeAcademicText(damaged);
  assert.equal(normalized, String.raw`\frac{a}{b}；\theta；\neq；\right；\begin{cases}`);
});

test('统一美元定界符并由规范化后的题目字段重建答案', () => {
  const exam = {
    title: '测试卷',
    questions: [{
      type: 'fill',
      title: '填空题',
      items: [{
        stem: '计算 $\\frac{1}{3}$，并写出 $$x^2+y^2=1$$',
        answer: '$\\frac{1}{3}$',
        explanation: '结果为 $\\frac{1}{3}$。',
      }],
    }],
    answers: ['旧答案不得保留'],
  };

  normalizeExamAcademicContent(exam);
  assert.equal(exam.questions[0].items[0].stem, '计算 \\(\\frac{1}{3}\\)，并写出 \\[x^2+y^2=1\\]');
  assert.equal(exam.answers[0], '1. \\(\\frac{1}{3}\\) 解析：结果为 \\(\\frac{1}{3}\\)。');
  assert.deepEqual(findAcademicContentIssues(exam), []);
});

test('自动修复模型混用的行内与独立公式闭合符，避免整卷生成失败', () => {
  const exam = {
    title: '定界符修复卷',
    questions: [
      { title: '第一组', items: [] },
      { title: '第二组', items: [] },
      {
        title: '第三组',
        items: [
          { stem: '占位题 1', answer: '略', explanation: '略' },
          { stem: '占位题 2', answer: '略', explanation: '略' },
          {
            stem: String.raw`计算：\[x^2-1=0\)`,
            answer: String.raw`\(x=\pm1\)`,
            explanation: '使用平方差公式。',
          },
          {
            stem: '求未知数。',
            answer: String.raw`\(x=1\)`,
            explanation: String.raw`由 \(x+1=2\]，解得 \(x=1\)。`,
          },
        ],
      },
    ],
  };

  const originalIssues = findAcademicContentIssues(exam);
  assert.ok(originalIssues.some((issue) => (
    issue.path === 'questions[2].items[3].explanation'
      && issue.code === 'UNBALANCED_INLINE_DELIMITER'
  )));
  assert.ok(originalIssues.some((issue) => (
    issue.path === 'questions[2].items[3].explanation'
      && issue.code === 'UNBALANCED_DISPLAY_DELIMITER'
  )));

  normalizeExamAcademicContent(exam);

  assert.equal(exam.questions[2].items[2].stem, String.raw`计算：\[x^2-1=0\]`);
  assert.equal(
    exam.questions[2].items[3].explanation,
    String.raw`由 \(x+1=2\)，解得 \(x=1\)。`,
  );
  assert.deepEqual(findAcademicContentIssues(exam), []);
  assert.doesNotThrow(() => assertAcademicContentIntegrity(exam));
});

test('结构化终态修复移除孤立定界符，同时保留完整公式和全部正文', () => {
  assert.equal(
    stabilizeFormulaDelimiters(String.raw`结果为 \(x=1，因此结论成立。`),
    '结果为 x=1，因此结论成立。',
  );
  assert.equal(
    stabilizeFormulaDelimiters(String.raw`多余 \)；完整 \(y=2\)。`),
    String.raw`多余 ；完整 \(y=2\)。`,
  );
  assert.equal(
    stabilizeFormulaDelimiters(String.raw`前 \(a，后 \(b=2\)。`),
    String.raw`前 a，后 \(b=2\)。`,
  );
  assert.equal(
    stabilizeFormulaDelimiters(String.raw`混用 \[x^2=1\)，继续。`),
    String.raw`混用 \[x^2=1\]，继续。`,
  );
});

test('穷举六个公式定界符的全部排列，终态修复始终成对且不丢正文', () => {
  const tokens = [String.raw`\(`, String.raw`\)`, String.raw`\[`, String.raw`\]`];
  const delimiterPattern = /\\[()[\]]/gu;
  const combinations = tokens.length ** 6;

  for (let number = 0; number < combinations; number += 1) {
    let cursor = number;
    const sequence = [];
    for (let index = 0; index < 6; index += 1) {
      sequence.push(tokens[cursor % tokens.length]);
      cursor = Math.floor(cursor / tokens.length);
    }
    const source = sequence.map((token, index) => `正文${index}${token}`).join('') + '结束';
    const stabilized = stabilizeFormulaDelimiters(source);
    assert.equal(
      stabilized.replace(delimiterPattern, ''),
      source.replace(delimiterPattern, ''),
      `不得丢失组合 ${number} 的正文`,
    );
    assert.equal(
      (stabilized.match(/\\\(/gu) || []).length,
      (stabilized.match(/\\\)/gu) || []).length,
      `组合 ${number} 的行内公式必须成对`,
    );
    assert.equal(
      (stabilized.match(/\\\[/gu) || []).length,
      (stabilized.match(/\\\]/gu) || []).length,
      `组合 ${number} 的独立公式必须成对`,
    );
  }
});

test('数量相等但顺序嵌套错误及孤立美元符号也进入统一返修闭环', async () => {
  const exam = {
    questions: [{
      items: [{
        stem: String.raw`嵌套 \(a+\[b\)c\]`,
        answer: 'A',
        explanation: '价格符号 $ 不得充当公式边界',
      }],
    }],
  };
  normalizeExamAcademicContent(exam);
  const beforeCodes = findAcademicContentIssues(exam).map((issue) => issue.code);
  assert.ok(beforeCodes.includes('MALFORMED_DELIMITER_SEQUENCE'));
  assert.ok(beforeCodes.includes('NONSTANDARD_DELIMITER'));

  const result = await repairExamAcademicContent(exam, { maxAttempts: 2 });

  assert.deepEqual(result.fallbackPaths, [
    'questions[0].items[0].stem',
    'questions[0].items[0].explanation',
  ]);
  assert.deepEqual(findAcademicContentIssues(exam), []);
  assert.doesNotThrow(() => assertAcademicContentIntegrity(exam));
});

test('只让模型返修公式损坏字段，不修改其他题目或字段', async () => {
  const exam = {
    title: '字段返修卷',
    questions: [{
      title: '解答题',
      items: Array.from({ length: 7 }, (_, index) => ({
        stem: `第 ${index + 1} 题题干`,
        answer: `答案 ${index + 1}`,
        explanation: `解析 ${index + 1}`,
      })),
    }],
  };
  exam.questions[0].items[5].explanation = String.raw`由 \(x+1=2，可得 x=1。`;
  exam.questions[0].items[6].explanation = String.raw`代入 \(y=3，结论成立。`;
  const untouchedStem = exam.questions[0].items[5].stem;
  let requestCount = 0;

  const result = await repairExamAcademicContent(exam, {
    requestRepair: async ({ issues, userPrompt }) => {
      requestCount += 1;
      assert.deepEqual(
        issues.map((issue) => issue.path),
        [
          'questions[0].items[5].explanation',
          'questions[0].items[6].explanation',
        ],
      );
      assert.match(userPrompt, /questions\[0\]\.items\[5\]\.explanation/u);
      assert.doesNotMatch(userPrompt, /questions\[0\]\.items\[4\]\.explanation/u);
      return {
        repairs: [
          {
            path: 'questions[0].items[5].explanation',
            value: String.raw`由 \(x+1=2\)，可得 \(x=1\)。`,
          },
          {
            path: 'questions[0].items[6].explanation',
            value: String.raw`代入 \(y=3\)，结论成立。`,
          },
        ],
      };
    },
    maxAttempts: 2,
  });

  assert.equal(requestCount, 1);
  assert.equal(result.initialIssueCount, 2);
  assert.deepEqual(result.repairedPaths, [
    'questions[0].items[5].explanation',
    'questions[0].items[6].explanation',
  ]);
  assert.deepEqual(result.fallbackPaths, []);
  assert.equal(exam.questions[0].items[5].stem, untouchedStem);
  assert.deepEqual(findAcademicContentIssues(exam), []);
  assert.doesNotThrow(() => assertAcademicContentIntegrity(exam));
});

test('模型连续返修失败时局部安全降级，公式错误不得导致整卷失败', async () => {
  const exam = {
    questions: [{
      title: '解答题',
      items: Array.from({ length: 7 }, (_, index) => ({
        stem: `第 ${index + 1} 题`,
        answer: `${index + 1}`,
        explanation: `解析 ${index + 1}`,
      })),
    }],
  };
  exam.questions[0].items[5].explanation = String.raw`由 \(\frac{a}{b}=2，因此 a=2b。`;
  exam.questions[0].items[6].explanation = String.raw`根据 \(v_0=5\,\mathrm{m\,s^{-1}}，可知速度。`;
  let requestCount = 0;

  const result = await repairExamAcademicContent(exam, {
    requestRepair: async () => {
      requestCount += 1;
      throw new Error('模拟返修服务暂时不可用');
    },
    maxAttempts: 2,
  });

  assert.equal(requestCount, 2);
  assert.deepEqual(result.fallbackPaths, [
    'questions[0].items[5].explanation',
    'questions[0].items[6].explanation',
  ]);
  assert.equal(
    exam.questions[0].items[5].explanation,
    String.raw`由 \frac{a}{b}=2，因此 a=2b。`,
  );
  assert.equal(
    exam.questions[0].items[6].explanation,
    String.raw`根据 v_0=5\,\mathrm{m\,s^{-1}}，可知速度。`,
  );
  assert.deepEqual(findAcademicContentIssues(exam), []);
  assert.doesNotThrow(() => assertAcademicContentIntegrity(exam));
});

test('数学、物理、化学、生物、地理代表性公式均可由 KaTeX 与 mhchem 严格渲染', () => {
  const subjectSamples = {
    数学: String.raw`\(\frac{-b\pm\sqrt{b^2-4ac}}{2a}\)、\(A\cap B\)、\(\overrightarrow{AB}\)、\(\sum_{k=1}^{n}k\)、\(\int_0^1x^2\,\mathrm{d}x\)、\(\binom{n}{k}\)、\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]、\[\begin{cases}x+y=3\\x-y=1\end{cases}\]`,
    物理: String.raw`\(\vec{F}=m\vec{a}\)、\(v_0=5\,\mathrm{m\,s^{-1}}\)、\(U=IR\)、\(1.6\times10^{-19}\,\mathrm{C}\)、\(E_k=\frac12mv^2\)、\(\lambda=\frac{v}{f}\)`,
    化学: String.raw`\(\ce{H2SO4}\)、\(\ce{SO4^2-}\)、\(\ce{Fe^3+}\)、\(\ce{^{14}_{6}C}\)、\(\ce{2H2(g) + O2(g) -> 2H2O(l)}\)、\(\ce{N2 + 3H2 <=> 2NH3}\)、\(\pu{0.1 mol L-1}\)`,
    生物: String.raw`\(Aa\times Aa\)、\(3\mathbin{:}1\)、\(N_t=N_0\lambda^t\)、\(\ce{6CO2 + 6H2O -> C6H12O6 + 6O2}\)、\(10^{-3}\,\mathrm{mol\,L^{-1}}\)`,
    地理: String.raw`\(35^\circ26'\mathrm{N}\)、\(120^\circ15'\mathrm{E}\)、\(i=\frac{h}{l}\times100\%\)、\(1\mathbin{:}50000\)、\(\Delta T=0.6^\circ\mathrm{C}/100\,\mathrm{m}\)`,
  };

  for (const [subject, sample] of Object.entries(subjectSamples)) {
    const output = renderAllFormulaSegments(sample);
    assert.ok(output.length >= 5, `${subject}样例必须覆盖至少 5 类公式`);
    output.forEach((html) => {
      assert.match(html, /class="katex"/u, `${subject}公式必须生成 KaTeX 结构`);
      assert.doesNotMatch(html, /katex-error/u, `${subject}公式不得降级为错误文本`);
    });
  }
});

test('内容完整性检查拒绝控制字符和不成对定界符', () => {
  const exam = {
    questions: [{
      title: '选择题',
      items: [{ stem: '损坏公式 \\(\\frac{1}{2}', answer: 'A\u000B', explanation: '错误' }],
    }],
  };
  const issues = findAcademicContentIssues(exam);
  assert.ok(issues.some((issue) => issue.code === 'UNBALANCED_INLINE_DELIMITER'));
  assert.ok(issues.some((issue) => issue.code === 'CONTROL_CHARACTER'));
  assert.throws(() => assertAcademicContentIntegrity(exam), /学科公式内容校验失败/u);
});

test('生成规则覆盖五大学科且 Node、Worker 不再执行 Unicode 降级', () => {
  ['数学', '物理', '化学', '生物', '地理', 'mhchem', 'JSON 转义'].forEach((keyword) => {
    assert.match(FORMULA_OUTPUT_RULE, new RegExp(keyword, 'u'));
  });

  const nodeSource = readFileSync(path.join(__dirname, '../server/services/ai.js'), 'utf8');
  const uploadSource = readFileSync(path.join(__dirname, '../server/services/uploaded-exam-variant.js'), 'utf8');
  const workerSource = readFileSync(path.join(__dirname, '../worker/routes/exam.js'), 'utf8');
  const frontendSource = readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const editableWordSource = readFileSync(path.join(__dirname, '../shared/editable-word-export.js'), 'utf8');

  [nodeSource, uploadSource, workerSource].forEach((source) => {
    assert.match(source, /normalizeExamAcademicContent/u);
    assert.match(source, /repairExamAcademicContent/u);
    assert.match(source, /assertAcademicContentIntegrity/u);
    assert.doesNotMatch(source, /postProcessLatexSymbols|将LaTeX符号转换为Unicode/u);
  });
  assert.match(frontendSource, /import katex from 'katex'/u);
  assert.match(frontendSource, /import 'katex\/contrib\/mhchem'/u);
  assert.match(frontendSource, /output: 'htmlAndMathml'/u);
  assert.match(frontendSource, /createEditableWordDocument/u);
  assert.doesNotMatch(frontendSource, /window\.katex/u);
  assert.match(editableWordSource, /require\('katex\/contrib\/mhchem'\)/u);
  assert.match(editableWordSource, /output: 'mathml'/u);
  assert.match(editableWordSource, /<m:oMath\\b/u);
  assert.match(editableWordSource, /Word 公式完整性校验失败/u);
});
