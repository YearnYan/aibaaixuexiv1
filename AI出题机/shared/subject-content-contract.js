const katex = require('katex');
require('katex/contrib/mhchem');
const { mml2omml } = require('mathml2omml');
const {
  assertWordFormulaOmmlSourceFree,
  normalizeWordFormulaOmml
} = require('./word-export-quality');

const SUPPORTED_SUBJECTS = ['数学', '物理', '化学', '生物', '地理', '历史', '语文', '英语', '政治'];
const SUPPORTED_SUBJECT_SET = new Set(SUPPORTED_SUBJECTS);
const CHEMISTRY_CONTEXT_SUBJECTS = new Set(['物理', '化学', '生物', '地理']);
const INLINE_OPEN = '\\(';
const INLINE_CLOSE = '\\)';
const DISPLAY_OPEN = '\\[';
const DISPLAY_CLOSE = '\\]';
const FORMULA_COMMAND_PATTERN = /\\[A-Za-z]+/;
const UNICODE_MATH_PATTERN = /[√∑∫∏∞≈≠≤≥±×÷∠△∥⊥∈∉∪∩∅∝∴∵°℃→←↔⇌⇄\u2070-\u209F]/;
const GREEK_PATTERN = /[Α-Ωα-ω]/;
const SUBJECT_ALIASES = {
  道德与法治: '政治',
  思想政治: '政治',
  政治与法治: '政治'
};

const SUBJECT_RULES = {
  数学: [
    '代数式、方程、不等式、函数、数列、集合、向量、概率统计、极限、导数、积分、矩阵、分段函数和几何关系全部使用 LaTeX。',
    '分数使用 \\frac，根式使用 \\sqrt，上下标使用 ^{...}/_{...}，角度使用 ^\\circ，禁止用斜杠分数或 Unicode 上下标代替。'
  ],
  物理: [
    '物理量、公式、矢量、单位、科学计数法和测量不确定度全部置于公式定界符内。',
    '单位使用 \\mathrm{...} 并与数值保留规范空隙，例如 \\(v=10\\,\\mathrm{m/s}\\)，禁止输出 10m/s、m/s²、℃ 等裸文本伪公式。'
  ],
  化学: [
    '元素符号、分子式、离子、化学方程式、电子式和反应条件使用 KaTeX mhchem 的 \\ce{...}，并置于公式定界符内。',
    '方程式必须配平，电荷、状态、沉淀、气体和可逆符号必须符合真实教学规范；禁止用 Unicode 上下标、箭头或纯文本化学式替代。'
  ],
  生物: [
    '遗传式、基因型、染色体记号、比例、概率、统计量和生化反应使用标准 LaTeX；涉及化学过程时使用 \\ce{...}。',
    '普通生物名词保持自然文本，DNA、RNA 等通用缩写不强行包成公式。'
  ],
  地理: [
    '经纬度、比例尺、时区计算、统计量、海拔与单位等定量表达使用标准 LaTeX。',
    '经纬度方向使用 \\mathrm{E}/\\mathrm{W}/\\mathrm{N}/\\mathrm{S}，角度使用 ^\\circ，禁止输出 120°E、1:500000 等未渲染伪公式。'
  ],
  历史: [
    '历史年代、朝代、人名、书名号和引文保持普通文本；不要把公元年份、破折号或中文标点误识别为公式。',
    '只有确有计算、比例或统计表达时才使用 LaTeX，禁止为了形式统一而给普通历史文本添加公式定界符。'
  ],
  语文: [
    '汉字、拼音、古诗文、标点、书名号和引文保持普通文本；不要把括号、斜杠、着重号或序号误识别为公式。',
    '只有确有数理表达时才使用 LaTeX，不得把普通语言材料包入公式。'
  ],
  英语: [
    '英文句子、音标 IPA、缩写、撇号、连字符和标点保持普通文本；IPA 使用 /.../ 或 [...]，不得误包成公式。',
    '美元金额如 $5、$10 保持普通文本；只有确有数学表达时才使用 LaTeX，禁止使用 $...$ 作为公式定界符。'
  ],
  政治: [
    '政治术语、法规条文、引文、年份和序号保持普通文本，不得误包成公式。',
    '经济计算、比例和统计表达确需公式时使用标准 LaTeX；货币文本保持真实教学材料中的正常写法。'
  ]
};

class ContentContractError extends Error {
  constructor(errors, message = '学科内容质量门未通过') {
    const normalized = Array.isArray(errors) ? errors : [{ path: 'exam', code: 'UNKNOWN', message: String(errors || message) }];
    const summary = normalized.slice(0, 8).map((item) => `${item.path}：${item.message}`).join('；');
    super(`${message}：${summary}`);
    this.name = 'ContentContractError';
    this.code = 'SUBJECT_CONTENT_CONTRACT_FAILED';
    this.errors = normalized;
  }
}

function normalizeSubject(subject) {
  const value = String(subject || '').trim();
  return SUBJECT_ALIASES[value] || value;
}

function buildSubjectStructuredContentPrompt(subject) {
  const normalizedSubject = normalizeSubject(subject);
  const rules = SUBJECT_RULES[normalizedSubject] || [
    '普通文本保持自然语言；只有真正的学科公式才使用标准 LaTeX 定界符。'
  ];
  return String.raw`# ${normalizedSubject || '当前科目'}结构化内容表达式契约
1. stem、每个 option、answer、explanation 都必须是一个字符串；普通语言直接写在字符串中。
2. 行内公式必须直接写成 \(...\)，独立公式必须直接写成 \[...\]。例如：已知 \(f(x)=\frac{1}{2}x\)，求函数值。
3. 工具调用参数必须保持合法 JSON；JSON 解析后的字段值只能含一层标准 LaTeX 反斜杠。禁止 LATEXSLASH、@@BS@@、[[LATEX]] 等私有传输词或中间格式。
4. 化学正确示例：反应方程式为 \(\ce{2H2 + O2 -> 2H2O}\)。
5. 禁止美元公式、Unicode 伪公式、Markdown、嵌套定界符、错序定界符、不闭合定界符和双重转义定界符。
6. 等号直接写字符 =，绝对禁止不存在的命令 \eq；不等号按语义使用 \neq、\le 或 \ge。
7. 填空横线必须写在公式外的普通文字中，例如“________”；禁止写成 \text{________}。
8. 所有公式都会使用 KaTeX + mhchem 严格编译；任一公式失败会使整批作废。
9. 公式中的中文说明必须使用 \text{...}，或先在普通文字中定义 ASCII/数字下标变量；禁止把中文直接写入数学模式。
10. 输出前逐个检查：命令真实存在、花括号配对；每个 \( 对应一个 \)，每个 \[ 对应一个 \]，且内部不得再次开启公式。

# 学科专项规范
${rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`;
}

function scanText(value, { subject = '', path = 'text' } = {}) {
  const source = String(value ?? '');
  const errors = [];
  const formulas = [];
  let mode = '';
  let formulaStart = -1;
  let bodyStart = -1;
  let plainText = '';

  const addError = (code, message, index = -1) => {
    errors.push({ path, code, message, index });
  };

  for (let index = 0; index < source.length;) {
    if (source.startsWith('\\\\(', index) || source.startsWith('\\\\[', index)
      || source.startsWith('\\\\)', index) || source.startsWith('\\\\]', index)) {
      addError('DOUBLE_ESCAPED_DELIMITER', '公式定界符在解析后仍含双反斜杠', index);
      if (!mode) plainText += source[index];
      index += 1;
      continue;
    }

    const token = readDelimiter(source, index);
    if (!token) {
      if (!mode) plainText += source[index];
      index += 1;
      continue;
    }

    if (token.kind === 'open') {
      if (mode) {
        addError('NESTED_DELIMITER', '公式定界符发生嵌套', index);
      } else {
        mode = token.mode;
        formulaStart = index;
        bodyStart = index + token.value.length;
      }
      index += token.value.length;
      continue;
    }

    if (!mode) {
      addError('UNEXPECTED_CLOSING_DELIMITER', '出现没有对应开始符的公式结束符', index);
      index += token.value.length;
      continue;
    }

    if (mode !== token.mode) {
      addError('MISMATCHED_DELIMITER', '行内公式与独立公式定界符类型不匹配', index);
      index += token.value.length;
      continue;
    }

    const body = source.slice(bodyStart, index).trim();
    if (!body) addError('EMPTY_FORMULA', '公式内容为空', formulaStart);
    if (/LATEXSLASH|@@BS@@|\[\[\s*\/?\s*LATEX\s*\]\]/i.test(body)) {
      addError('INTERNAL_TRANSPORT_MARKER', '公式中残留内部传输标记', formulaStart);
    }
    if (/\\eq\b/.test(body)) {
      addError('FORBIDDEN_EQ_COMMAND', '等号必须直接写 =，禁止使用 \\eq', formulaStart);
    }
    formulas.push({
      path,
      mode,
      body,
      start: formulaStart,
      end: index + token.value.length
    });
    mode = '';
    formulaStart = -1;
    bodyStart = -1;
    index += token.value.length;
  }

  if (mode) addError('UNCLOSED_DELIMITER', '公式定界符不完整，缺少结束符', formulaStart);

  if (FORMULA_COMMAND_PATTERN.test(plainText)) {
    addError('BARE_LATEX_COMMAND', '公式外存在裸露的 LaTeX 命令');
  }
  if (/LATEXSLASH|@@BS@@|\[\[\s*\/?\s*LATEX\s*\]\]/i.test(plainText)) {
    addError('INTERNAL_TRANSPORT_MARKER', '用户可见文本中残留内部传输标记');
  }
  if (containsInvalidDollarDelimiter(plainText)) {
    addError('DOLLAR_DELIMITER', '禁止使用 $...$ 或 $$...$$ 作为公式定界符');
  }

  const normalizedSubject = normalizeSubject(subject);
  if (SUPPORTED_SUBJECT_SET.has(normalizedSubject)) {
    if (UNICODE_MATH_PATTERN.test(plainText) || GREEK_PATTERN.test(plainText)) {
      addError('UNICODE_FORMULA', '公式外存在 Unicode 数学、上下标、角度或希腊符号');
    }
    if (containsBareStemExpression(plainText)) {
      addError('BARE_STEM_EXPRESSION', '公式外存在未使用 LaTeX 定界符的定量表达式');
    }
  }

  if (CHEMISTRY_CONTEXT_SUBJECTS.has(normalizedSubject) && containsBareChemicalFormula(plainText)) {
    addError('BARE_CHEMICAL_FORMULA', '化学式或元素组合必须使用 \\ce{...} 并置于公式定界符内');
  }

  return { formulas, errors, plainText };
}

function readDelimiter(source, index) {
  if (source.startsWith(INLINE_OPEN, index)) return { value: INLINE_OPEN, kind: 'open', mode: 'inline' };
  if (source.startsWith(INLINE_CLOSE, index)) return { value: INLINE_CLOSE, kind: 'close', mode: 'inline' };
  if (source.startsWith(DISPLAY_OPEN, index)) return { value: DISPLAY_OPEN, kind: 'open', mode: 'display' };
  if (source.startsWith(DISPLAY_CLOSE, index)) return { value: DISPLAY_CLOSE, kind: 'close', mode: 'display' };
  return null;
}

function containsInvalidDollarDelimiter(text) {
  const source = String(text || '');
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '$') continue;
    if (source[index + 1] === '$') return true;
    const currency = source.slice(index + 1).match(/^\s*\d+(?:,\d{3})*(?:\.\d{1,2})?(?=$|[\s,.;:!?、，。；：！？)）\-])/);
    if (!currency) return true;
  }
  return false;
}

function containsBareStemExpression(text) {
  const source = String(text || '');
  const equation = /(?:[A-Za-z]\w*(?:\([^\n)]{1,40}\))?|[\u4E00-\u9FFF]{1,12}|\d+(?:\.\d+)?)\s*(?:=|<|>)\s*(?:[-+]?\d|[A-Za-z\u4E00-\u9FFF])/;
  const exponent = /\b[A-Za-z]\w*\s*[\^_]\s*(?:\{[^}\n]+\}|[A-Za-z0-9])/;
  const fraction = /(?:\b\d+(?:\.\d+)?|\([^\n()]+\))\s*\/\s*(?:\d+(?:\.\d+)?\b|\([^\n()]+\))/;
  const coordinate = /\b[A-Z]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d/;
  const valueWithUnit = /\b\d+(?:\.\d+)?\s*(?:m\/s|km\/h|kg|mg|mol|mm|cm|km|Pa|Hz|kHz|N|J|W|V|A|Ω|L|mL)\b/i;
  const geographicScale = /\b1\s*:\s*\d{3,}\b/;
  return equation.test(source) || exponent.test(source) || fraction.test(source)
    || coordinate.test(source) || valueWithUnit.test(source) || geographicScale.test(source);
}

function containsBareChemicalFormula(text) {
  const source = String(text || '');
  const candidatePattern = /\b(?:[A-Z][a-z]?\d*){1,8}\b/g;
  let match;
  while ((match = candidatePattern.exec(source))) {
    const candidate = match[0];
    if (/^(?:DNA|RNA|ATP|ADP|NADH|PCR|PH)$/i.test(candidate)) continue;
    const tokens = candidate.match(/[A-Z][a-z]?\d*/g) || [];
    const meaningful = /\d/.test(candidate) || tokens.length >= 2 || /[a-z]/.test(candidate);
    if (meaningful && tokens.every(isElementToken)) return true;
  }
  return false;
}

function isElementToken(token) {
  const symbol = token.replace(/\d+/g, '');
  return ELEMENT_SYMBOLS.has(symbol);
}

const ELEMENT_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra',
  'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db',
  'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
]);

function compileFormula(formula) {
  try {
    const rendered = katex.renderToString(formula.body, {
      displayMode: formula.mode === 'display',
      throwOnError: true,
      strict: 'error',
      trust: false,
      output: 'mathml',
      maxExpand: 1000,
      maxSize: 20
    });
    return validateWordFormulaConversion(rendered, formula);
  } catch (error) {
    return {
      path: formula.path,
      code: 'KATEX_COMPILE_FAILED',
      message: `KaTeX/mhchem 编译失败：${error.message}`,
      index: formula.start
    };
  }
}

function validateWordFormulaConversion(renderedMathml, formula) {
  const mathml = String(renderedMathml || '').match(/<math\b[\s\S]*<\/math>/)?.[0]
    ?.replace(/<annotation\b[\s\S]*?<\/annotation>/gi, '');
  if (!mathml) {
    return {
      path: formula.path,
      code: 'WORD_OMML_CONVERSION_FAILED',
      message: '公式缺少可转换的 MathML 结构',
      index: formula.start
    };
  }

  const warnings = [];
  const originalWarn = console.warn;
  let omml = '';
  try {
    // 转换器会提示 mhchem 的零宽排版节点；浏览器导出前已有确定性结构规范化。
    console.warn = (...parts) => warnings.push(parts.map(String).join(' '));
    omml = normalizeWordFormulaOmml(mml2omml(mathml));
  } catch (error) {
    return {
      path: formula.path,
      code: 'WORD_OMML_CONVERSION_FAILED',
      message: `公式无法转换为 Word 原生公式：${error.message}`,
      index: formula.start
    };
  } finally {
    console.warn = originalWarn;
  }

  const unsupportedWarnings = warnings.filter((message) => (
    !/^Type not supported: (?:mpadded|mphantom)$/.test(message)
  ));
  try {
    if (unsupportedWarnings.length) {
      throw new Error(unsupportedWarnings.join('；'));
    }
    assertWordFormulaOmmlSourceFree(omml);
    return null;
  } catch (error) {
    return {
      path: formula.path,
      code: 'WORD_OMML_CONVERSION_FAILED',
      message: `公式无法无源码转换为 Word 原生公式：${error.message}`,
      index: formula.start
    };
  }
}

function validateExamContent(exam, { subject = '', expectedQuestionCount = null, expectedQuestionType = '' } = {}) {
  const errors = [];
  const fields = [];
  if (!exam || typeof exam !== 'object' || Array.isArray(exam)) {
    throw new ContentContractError([{ path: 'exam', code: 'INVALID_EXAM', message: '试卷必须是对象' }]);
  }

  requireText(exam.title, 'title', errors, fields);
  if (!Array.isArray(exam.questions) || exam.questions.length === 0) {
    errors.push({ path: 'questions', code: 'INVALID_QUESTIONS', message: 'questions 必须是非空数组' });
  }

  let questionCount = 0;
  for (const [groupIndex, group] of (exam.questions || []).entries()) {
    const groupPath = `questions[${groupIndex}]`;
    if (!group || typeof group !== 'object') {
      errors.push({ path: groupPath, code: 'INVALID_GROUP', message: '题组必须是对象' });
      continue;
    }
    requireText(group.title, `${groupPath}.title`, errors, fields);
    if (!['choice', 'fill', 'calculation'].includes(group.type)) {
      errors.push({ path: `${groupPath}.type`, code: 'INVALID_TYPE', message: '题型必须是 choice、fill 或 calculation' });
    }
    if (expectedQuestionType && group.type !== expectedQuestionType) {
      errors.push({ path: `${groupPath}.type`, code: 'UNEXPECTED_TYPE', message: `必须只生成 ${expectedQuestionType} 题型` });
    }
    if (!Array.isArray(group.items) || group.items.length === 0) {
      errors.push({ path: `${groupPath}.items`, code: 'INVALID_ITEMS', message: 'items 必须是非空数组' });
      continue;
    }

    for (const [itemIndex, item] of group.items.entries()) {
      questionCount += 1;
      const itemPath = `${groupPath}.items[${itemIndex}]`;
      if (!item || typeof item !== 'object') {
        errors.push({ path: itemPath, code: 'INVALID_ITEM', message: '题目必须是对象' });
        continue;
      }
      requireText(item.stem, `${itemPath}.stem`, errors, fields);
      requireText(item.answer, `${itemPath}.answer`, errors, fields);
      requireText(item.explanation, `${itemPath}.explanation`, errors, fields);
      if (group.type === 'choice') {
        if (!Array.isArray(item.options) || item.options.length !== 4) {
          errors.push({ path: `${itemPath}.options`, code: 'INVALID_OPTIONS', message: '选择题必须有且仅有 4 个选项' });
        } else {
          item.options.forEach((option, optionIndex) => {
            requireText(option, `${itemPath}.options[${optionIndex}]`, errors, fields);
          });
        }
      } else if (item.options !== undefined && item.options !== null && !Array.isArray(item.options)) {
        errors.push({ path: `${itemPath}.options`, code: 'INVALID_OPTIONS', message: 'options 如存在必须是数组' });
      }
      validateFigure(item, itemPath, errors);
    }
  }

  if (Number.isInteger(expectedQuestionCount) && questionCount !== expectedQuestionCount) {
    errors.push({ path: 'questions', code: 'QUESTION_COUNT_MISMATCH', message: `生成 ${questionCount} 题，必须严格等于 ${expectedQuestionCount} 题` });
  }
  if (!Array.isArray(exam.answers) || exam.answers.length !== questionCount) {
    errors.push({ path: 'answers', code: 'ANSWER_COUNT_MISMATCH', message: `答案汇总必须有 ${questionCount} 项` });
  } else {
    exam.answers.forEach((answer, index) => requireText(answer, `answers[${index}]`, errors, fields));
  }

  for (const field of fields) {
    const result = scanText(field.value, { subject, path: field.path });
    errors.push(...result.errors);
    for (const formula of result.formulas) {
      const compileError = compileFormula(formula);
      if (compileError) errors.push(compileError);
    }
  }

  if (errors.length) throw new ContentContractError(dedupeErrors(errors));
  return exam;
}

function requireText(value, path, errors, fields) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ path, code: 'EMPTY_TEXT', message: '必须是非空字符串' });
    return;
  }
  fields.push({ path, value });
}

function validateFigure(item, itemPath, errors) {
  const stem = typeof item.stem === 'string' ? item.stem : '';
  const referencesFigure = /(如图|图中|下图|由图|作图|画出|绘制|示意图|电路图|受力图|光路图|地图)/.test(stem);
  if (item.figure === undefined || item.figure === null) {
    if (referencesFigure) {
      errors.push({ path: `${itemPath}.figure`, code: 'MISSING_FIGURE', message: '题干引用或要求图形，但 figure 缺失' });
    }
    return;
  }
  if (!item.figure || typeof item.figure !== 'object' || Array.isArray(item.figure)) {
    errors.push({ path: `${itemPath}.figure`, code: 'INVALID_FIGURE', message: 'figure 必须是含 type 和 description 的对象' });
    return;
  }
  if (typeof item.figure.type !== 'string' || !item.figure.type.trim()) {
    errors.push({ path: `${itemPath}.figure.type`, code: 'INVALID_FIGURE_TYPE', message: '图形类型不能为空' });
  }
  if (typeof item.figure.description !== 'string' || item.figure.description.trim().length < 12) {
    errors.push({ path: `${itemPath}.figure.description`, code: 'INVALID_FIGURE_DESCRIPTION', message: '图形描述必须具体、完整且不少于 12 个字符' });
  } else {
    validateFigureDescription(item.figure.description, `${itemPath}.figure.description`, errors);
  }
}

function validateFigureDescription(value, path, errors) {
  const source = String(value || '');
  if (/LATEXSLASH|@@BS@@|\[\[\s*\/?\s*LATEX\s*\]\]|\\[A-Za-z]+|\\[()[\]]|```/i.test(source)) {
    errors.push({
      path,
      code: 'INVALID_FIGURE_DESCRIPTION_MARKUP',
      message: '图形描述是内部绘图指令，禁止 LaTeX 命令、公式定界符、传输标记或 Markdown'
    });
  }
  if (containsInvalidDollarDelimiter(source)) {
    errors.push({ path, code: 'DOLLAR_DELIMITER', message: '图形描述禁止使用 $...$ 或 $$...$$ 公式定界符' });
  }
}

function dedupeErrors(errors) {
  const seen = new Set();
  return errors.filter((item) => {
    const key = `${item.path}\u0000${item.code}\u0000${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatContractErrors(error, limit = 12) {
  const items = error instanceof ContentContractError ? error.errors : [];
  if (!items.length) return String(error?.message || error || '未知质量错误');
  return items.slice(0, limit).map((item, index) => `${index + 1}. ${item.path} [${item.code}] ${item.message}`).join('\n');
}

module.exports = {
  SUPPORTED_SUBJECTS,
  ContentContractError,
  buildSubjectStructuredContentPrompt,
  compileFormula,
  formatContractErrors,
  normalizeSubject,
  scanText,
  validateExamContent
};
