const {
  ContentContractError,
  buildSubjectStructuredContentPrompt,
  formatContractErrors,
  scanText,
  validateExamContent
} = require('./subject-content-contract');
const { buildExamSubmissionContract } = require('./ai-structured-output');

const MAX_GENERATION_ATTEMPTS = 3;
const MAX_BATCH_REVIEW_ATTEMPTS = 2;
const BATCH_SIZE = 2;
const REVIEWABLE_DRAFT_ERROR_CODES = new Set([
  'ANSWER_COUNT_MISMATCH',
  'BARE_CHEMICAL_FORMULA',
  'BARE_LATEX_COMMAND',
  'BARE_STEM_EXPRESSION',
  'DOLLAR_DELIMITER',
  'DOUBLE_ESCAPED_DELIMITER',
  'EMPTY_FORMULA',
  'EMPTY_TEXT',
  'FIGURE_DESCRIPTION_TRANSPORT_MARKER',
  'FORBIDDEN_EQ_COMMAND',
  'INTERNAL_TRANSPORT_MARKER',
  'INVALID_FIGURE',
  'INVALID_FIGURE_DESCRIPTION',
  'INVALID_FIGURE_DESCRIPTION_MARKUP',
  'INVALID_FIGURE_TYPE',
  'KATEX_COMPILE_FAILED',
  'MISMATCHED_DELIMITER',
  'MISSING_FIGURE',
  'NESTED_DELIMITER',
  'UNCLOSED_DELIMITER',
  'UNEXPECTED_CLOSING_DELIMITER',
  'UNICODE_FORMULA',
  'WORD_OMML_CONVERSION_FAILED'
]);
const TYPE_NAMES = {
  choice: '选择题',
  fill: '填空题',
  calculation: '计算题/解答题'
};
function createExamGenerator({ invokeAI, getMaxTokens, logger = console, batchConcurrency = 1 }) {
  if (typeof invokeAI !== 'function') throw new TypeError('invokeAI 必须是函数');
  const resolveMaxTokens = typeof getMaxTokens === 'function' ? getMaxTokens : () => undefined;

  async function generateExam(params) {
    let lastError = null;
    let previousFailure = '';

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      try {
        logger.log(`[严格生成] 第 ${attempt}/${MAX_GENERATION_ATTEMPTS} 次任务级生成开始`);
        const exam = await generateExamAttempt(params, { attempt, previousFailure });
        logger.log(`[严格生成] 第 ${attempt} 次生成通过全部质量门`);
        return exam;
      } catch (error) {
        lastError = error;
        previousFailure = describeGenerationError(error);
        logger.error(`[严格生成] 第 ${attempt} 次失败：${previousFailure}`);
        if (!isRetryableGenerationError(error)) throw error;
      }
    }

    const finalError = new Error(`连续 ${MAX_GENERATION_ATTEMPTS} 次严格生成均未通过，整次任务已拒绝输出：${describeGenerationError(lastError)}`);
    finalError.code = 'STRICT_GENERATION_REJECTED';
    finalError.cause = lastError;
    throw finalError;
  }

  async function generateExamAttempt(params, context) {
    const normalized = normalizeGenerationParams(params);
    const batchSpecs = buildBatchSpecs(normalized.questionCount);
    const systemPrompt = buildGenerationSystemPrompt(normalized);

    const reviewedBatches = await runWithConcurrency(batchSpecs, batchConcurrency, async (batchSpec, batchIndex) => {
      logger.log(`[严格生成] 批次 ${batchIndex + 1}/${batchSpecs.length}，题号 ${batchSpec.startIndex}-${batchSpec.startIndex + batchSpec.count - 1}`);
      const userPrompt = buildBatchUserPrompt(normalized, batchSpec, context);
      const structuredOutput = buildExamSubmissionContract({
        expectedQuestionType: normalized.expectedQuestionType,
        expectedQuestionCount: batchSpec.count
      });
      const rawContent = await invokeAI(systemPrompt, userPrompt, {
        maxTokens: resolveMaxTokens(),
        temperature: 0.4,
        structuredOutput,
        imageUrls: normalized.imageUrls
      });
      const generatedStructured = parseStrictExamJson(rawContent);
      let draftFailure = '';
      try {
        const generatedBatch = materializeStructuredExam(generatedStructured, {
          expectedQuestionType: normalized.expectedQuestionType,
          startIndex: batchSpec.startIndex
        });
        rebuildAnswerSummary(generatedBatch);
        validateExamContent(generatedBatch, {
          subject: normalized.subject,
          expectedQuestionCount: batchSpec.count,
          expectedQuestionType: normalized.expectedQuestionType
        });
      } catch (error) {
        if (!isReviewableDraftError(error)) throw error;
        draftFailure = describeGenerationError(error);
        logger.error(`[严格生成] 批次 ${batchIndex + 1} 初稿需审题纠正：${draftFailure}`);
      }

      return reviewExamBatch(
        generatedStructured,
        normalized,
        batchSpec,
        { ...context, draftFailure, batchIndex },
        structuredOutput
      );
    });

    const allItems = [];
    for (const batch of reviewedBatches) {
      for (const group of batch.questions) {
        for (const item of group.items) allItems.push({ type: group.type, item });
      }
    }

    const exam = buildExamFromItems(allItems, normalized.subject);
    validateExamContent(exam, {
      subject: normalized.subject,
      expectedQuestionCount: normalized.questionCount,
      expectedQuestionType: normalized.expectedQuestionType
    });
    exam.metadata = {
      version: normalized.version,
      grade: normalized.grade,
      subject: normalized.subject,
      topics: normalized.topicsText,
      examPoints: normalized.examPointsText,
      difficulty: normalized.difficulty,
      generatedAt: new Date().toISOString()
    };
    return exam;
  }

  async function reviewExamBatch(exam, params, batchSpec, context, structuredOutput) {
    const systemPrompt = buildReviewSystemPrompt(params);
    let candidate = exam;
    let localFailure = context.draftFailure || '';
    let lastError = null;

    for (let reviewAttempt = 1; reviewAttempt <= MAX_BATCH_REVIEW_ATTEMPTS; reviewAttempt += 1) {
      const failureSections = [];
      if (context.previousFailure) {
        failureSections.push(`上一轮任务级质量错误：\n${buildRetryGuidance(context.previousFailure)}`);
      }
      if (localFailure) {
        failureSections.push(`当前批次必须精确修复的字段错误：\n${buildRetryGuidance(localFailure)}`);
      }
      const failureContext = failureSections.length
        ? `\n\n# 质量门纠错清单\n${failureSections.join('\n\n')}`
        : '';
      const userPrompt = `请对下面这批 ${params.grade}${params.subject} 题目执行独立复算和对抗式审核。\n\n${serializeExamForAI(candidate)}${failureContext}\n\n必须调用 submit_exam，并且参数根对象只能有 items；题型仍为 ${params.expectedQuestionType}，items 数量仍为 ${batchSpec.count}。题号、题型和标题由服务器确定，严禁输出 title、type、index、questions 或 answers。系统将从审核通过的 answer 与 explanation 确定性生成答案汇总。`;

      try {
        const reviewedContent = await invokeAI(systemPrompt, userPrompt, {
          maxTokens: resolveMaxTokens(),
          temperature: 0.1,
          structuredOutput
        });
        const reviewedStructured = parseStrictExamJson(reviewedContent);
        candidate = reviewedStructured;
        const reviewedExam = materializeStructuredExam(reviewedStructured, {
          expectedQuestionType: params.expectedQuestionType,
          startIndex: batchSpec.startIndex
        });
        rebuildAnswerSummary(reviewedExam);
        validateExamContent(reviewedExam, {
          subject: params.subject,
          expectedQuestionCount: batchSpec.count,
          expectedQuestionType: params.expectedQuestionType
        });
        return reviewedExam;
      } catch (error) {
        lastError = error;
        localFailure = describeGenerationError(error);
        logger.error(`[严格审题] 批次 ${(context.batchIndex || 0) + 1} 第 ${reviewAttempt}/${MAX_BATCH_REVIEW_ATTEMPTS} 次纠正失败：${localFailure}`);
        if (!isRetryableGenerationError(error)) throw error;
      }
    }

    throw lastError;
  }

  return { generateExam };
}

function normalizeGenerationParams(params = {}) {
  const questionCount = Number.parseInt(params.questionCount, 10);
  const expectedQuestionType = String(params.expectedQuestionType || '').trim();
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 30) {
    throw new Error('单个生成任务题量必须在 1-30 题之间');
  }
  if (!TYPE_NAMES[expectedQuestionType]) {
    throw new Error('单个生成任务必须指定 choice、fill 或 calculation 题型');
  }
  return {
    version: String(params.version || '全版本融合课程体系'),
    grade: String(params.grade || '').trim(),
    subject: String(params.subject || '').trim(),
    topicsText: Array.isArray(params.topics) ? params.topics.join('、') : String(params.topics || '').trim(),
    examPointsText: Array.isArray(params.examPoints) ? params.examPoints.join('、') : String(params.examPoints || '').trim(),
    difficulty: Number.parseInt(params.difficulty, 10) || 5,
    difficultyPrompt: String(params.difficultyPrompt || '').trim(),
    questionCount,
    expectedQuestionType,
    questionTypeName: TYPE_NAMES[expectedQuestionType],
    imageUrls: Array.isArray(params.imageUrls) ? params.imageUrls : []
  };
}

function buildGenerationSystemPrompt(params) {
  const optionsExample = params.expectedQuestionType === 'choice'
    ? '["A. \\(1\\)","B. \\(2\\)","C. \\(3\\)","D. \\(4\\)"]'
    : 'null';
  return `你是一位资深的${params.subject}命题教师，熟悉${params.grade}新课标与主流教材共性体系（${params.version}）。

# 难度硬约束
${params.difficultyPrompt}

${buildSubjectStructuredContentPrompt(params.subject)}

# 命题质量硬约束
1. 每道题先在内部独立求解并反向代入验证；不要输出思维链，只输出经验证的题目、答案和完整解析。
2. 选择题有且仅有一个正确答案，四个选项互斥，干扰项来自可解释的常见错误。
3. 条件充分自洽；答案、解析、单位、精度、正负号和题图描述完全一致。
4. 数学公式、物理定律与单位、化学配平、生物逻辑、地理数据、历史事实、语文依据、英语语法和政治术语必须准确。
5. 不得超出知识点和考点范围，不得用模糊措辞掩盖条件不足。

# 图形硬约束
1. 依赖几何、函数图像、电路、受力、光路、实验装置、地图、统计图、结构图或时间轴的题目必须提供 figure。
2. figure 必须是 {"type":"...","description":"..."}，description 逐项说明位置、关系、标注、方向和数值。
3. figure.description 是内部绘图指令，只写自然语言、ASCII 坐标或关系（如 A(0,4)、y=x^2）；禁止 LaTeX 命令、公式定界符、私有传输词、美元公式和 Markdown。
4. 不需要图形时必须设为 null；禁止生成占位图、静态模板图和无关装饰图。

# submit_exam 参数唯一结构
{
  "items": [{
    "stem": "已知 \\(x^2=1\\)，求解。",
    "options": ${optionsExample},
    "answer": "\\(1\\)",
    "explanation": "由 \\(x=1\\) 得 \\(x^2=1\\)。",
    "figure": null
  }]
}

根对象必须且只能有 items。每个 item 必须且只能有 stem、options、answer、explanation、figure；题号、题型和标题由服务器确定，严禁输出 title、type、index、questions 或 answers。
普通文字必须在公式定界符外；必须关闭当前 \\( 或 \\[ 后才能开始下一个公式。提交前逐字符检查，任何未关闭、错序、嵌套或双重转义定界符都必须重写。
选择题 options 必须恰好 4 项；其他题型 options 必须为 null。figure 必须为对象或 null。必须且只能调用 submit_exam 提交结果，禁止在普通 content 中输出 JSON。`;
}

function buildBatchUserPrompt(params, batchSpec, context) {
  const retryContext = context.previousFailure
    ? `\n# 上一轮质量门错误（本轮必须逐条消除）\n${buildRetryGuidance(context.previousFailure)}\n`
    : '';
  return `请生成 ${batchSpec.count} 道${params.questionTypeName}。\n\n课程体系：${params.version}\n年级：${params.grade}\n科目：${params.subject}\n知识点：${params.topicsText}\n考点：${params.examPointsText}\n难度：${params.difficulty}/10\n题量硬约束：items 必须恰好 ${batchSpec.count} 项${retryContext}\n输出前必须逐题完成学科正确性、答案唯一性、表达式可编译性和题图一致性自检。必须调用 submit_exam，根对象只能有 items，不得输出服务器已知的题号、题型、标题或题组，不得在普通 content 中回答。`;
}

function buildReviewSystemPrompt(params) {
  return `你是独立于命题者的${params.subject}首席审题专家，必须逐题从零复核并直接修正，不得相信原答案。

${buildSubjectStructuredContentPrompt(params.subject)}

# 对抗式审核程序
1. 主动寻找反例、歧义、条件不足、事实错误、公式错误和单位错误。
2. 逐一验证选择题四个选项，证明只有一个成立；非选择题验证答案边界和全部步骤。
3. 检查 stem、options、answer、explanation 与 figure 描述完全一致，保持标准 LaTeX 定界符正确。
4. 依赖图形的信息必须完整落入 figure.description，不得删除题干引用掩盖缺图。
5. 不得删除公式、改成 Unicode 或纯文本来绕过编译质量门。
6. 保持题型和题量不变；根对象只输出 items，严禁输出 title、type、index、questions 或 answers。
7. 公式定界符只包裹公式正文，不包裹“因为、所以、由、得”等普通文字；关闭当前公式后才能开启下一个。

必须且只能调用 submit_exam 提交修正后的完整结果，不在普通 content 中输出审核说明、Markdown、JSON 或思维链。`;
}

function buildRetryGuidance(previousFailure) {
  const source = String(previousFailure || '');
  const guidance = [];
  const fieldErrors = Array.from(source.matchAll(/(?:^|\n)\d+\.\s+([^\s]+)\s+\[([A-Z0-9_]+)\]\s+([^\n]+)/g))
    .map((match) => `${match[1]} [${match[2]}] ${match[3]}`);
  if (fieldErrors.length) {
    guidance.push(`字段级纠偏：只修改下列被拒绝字段，并逐字符复查同类字段；不得删除公式或改变题目考查目标。\n${fieldErrors.join('\n')}`);
  }
  if (/UNKNOWN_STRUCTURED_FIELD|INVALID_STRUCTURED_EXAM|INVALID_QUESTIONS|INVALID_GROUP/.test(source)) {
    guidance.push('结构纠偏：submit_exam 参数根对象只能有 items；item 只能有 stem、options、answer、explanation、figure，禁止自行添加任何元数据字段。');
  }
  if (/NESTED_DELIMITER|UNCLOSED_DELIMITER|UNEXPECTED_CLOSING_DELIMITER|MISMATCHED_DELIMITER|DOUBLE_ESCAPED_DELIMITER/.test(source)) {
    guidance.push('公式边界纠偏：普通文字必须在公式外；每个 \\( 只能对应一个 \\)，每个 \\[ 只能对应一个 \\]，关闭后才能开始下一个公式，禁止嵌套和双重转义。');
  }
  if (/INTERNAL_TRANSPORT_MARKER|BARE_LATEX_COMMAND|DOLLAR_DELIMITER|FORBIDDEN_EQ_COMMAND/.test(source)) {
    guidance.push('公式传输纠偏：公式命令只在 \\(...\\) 或 \\[...\\] 内使用标准 LaTeX；等号直接写 =；禁止私有传输词、\\eq、公式外命令和美元公式。工具调用参数必须保持合法 JSON。');
  }
  if (/KATEX_COMPILE_FAILED|WORD_OMML_CONVERSION_FAILED/.test(source)) {
    guidance.push('公式编译与导出纠偏：只使用 KaTeX/mhchem 和 Word 原生公式都能完整表达的教学命令；不得删除公式或改成纯文本，必须使用语义等价的标准公式重写。');
  }
  return [source, ...guidance].join('\n');
}

function isReviewableDraftError(error) {
  return error instanceof ContentContractError
    && error.errors.length > 0
    && error.errors.every((item) => REVIEWABLE_DRAFT_ERROR_CODES.has(item.code));
}

function parseStrictExamJson(content) {
  const source = String(content || '').trim();
  if (!source) {
    const error = new Error('AI 返回空内容');
    error.code = 'EMPTY_AI_RESPONSE';
    throw error;
  }
  if (source.startsWith('```') || !source.startsWith('{') || !source.endsWith('}')) {
    const error = new Error('AI 响应不是纯 JSON 对象，禁止提取或修复后继续');
    error.code = 'NON_STRICT_JSON';
    throw error;
  }
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('根节点不是对象');
    return parsed;
  } catch (cause) {
    const error = new Error(`AI JSON 无法直接解析，禁止自动修复：${cause.message}`);
    error.code = 'INVALID_AI_JSON';
    error.cause = cause;
    throw error;
  }
}

function serializeExamForAI(exam) {
  return JSON.stringify(exam, (key, value) => key === 'answers' ? undefined : value, 2);
}

function materializeStructuredExam(structuredExam, {
  expectedQuestionType = 'calculation',
  startIndex = 1
} = {}) {
  const errors = [];
  if (!structuredExam || typeof structuredExam !== 'object' || Array.isArray(structuredExam)) {
    throw new ContentContractError([{ path: 'exam', code: 'INVALID_STRUCTURED_EXAM', message: '结构化试卷必须是对象' }]);
  }
  rejectUnknownKeys(structuredExam, ['items'], 'exam', errors);
  if (!TYPE_NAMES[expectedQuestionType]) {
    errors.push({ path: 'exam', code: 'INVALID_EXPECTED_TYPE', message: '服务器题型必须是 choice、fill 或 calculation' });
  }
  if (!Number.isInteger(startIndex) || startIndex < 1) {
    errors.push({ path: 'exam', code: 'INVALID_START_INDEX', message: '服务器起始题号必须是正整数' });
  }
  if (!Array.isArray(structuredExam.items) || !structuredExam.items.length) {
    errors.push({ path: 'items', code: 'INVALID_ITEMS', message: 'items 必须是非空数组' });
  }

  const items = [];
  for (const [itemIndex, item] of (structuredExam.items || []).entries()) {
    const itemPath = `items[${itemIndex}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ path: itemPath, code: 'INVALID_ITEM', message: '题目必须是对象' });
      continue;
    }
    rejectUnknownKeys(item, ['stem', 'options', 'answer', 'explanation', 'figure'], itemPath, errors);
    const materialized = {
      index: startIndex + itemIndex,
      stem: materializeStructuredContent(item.stem, `${itemPath}.stem`, errors),
      answer: materializeStructuredContent(item.answer, `${itemPath}.answer`, errors),
      explanation: materializeStructuredContent(item.explanation, `${itemPath}.explanation`, errors),
      figure: materializeStructuredFigure(item.figure, `${itemPath}.figure`, errors)
    };
    if (item.options === null) {
      // 非选择题必须显式提交 null，最终对象不保留 options。
    } else if (!Array.isArray(item.options)) {
      errors.push({ path: `${itemPath}.options`, code: 'INVALID_STRUCTURED_OPTIONS', message: 'options 必须是用户可见字符串数组或 null，且字段不能省略' });
    } else {
      materialized.options = item.options.map((option, optionIndex) => (
        materializeStructuredContent(option, `${itemPath}.options[${optionIndex}]`, errors)
      ));
    }
    items.push(materialized);
  }

  if (errors.length) throw new ContentContractError(errors, '结构化内容质量门未通过');
  return {
    title: '批次试题',
    questions: [{
      type: expectedQuestionType,
      title: TYPE_NAMES[expectedQuestionType],
      items
    }]
  };
}

function materializeStructuredContent(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push({ path, code: 'INVALID_STRUCTURED_CONTENT', message: '内容字段必须是非空字符串' });
    return '';
  }
  const scan = scanText(value, { path });
  errors.push(...scan.errors);
  return value;
}

function materializeStructuredFigure(figure, path, errors) {
  if (figure === undefined) {
    errors.push({ path, code: 'MISSING_STRUCTURED_FIGURE', message: 'figure 字段不能省略，无图题必须显式设为 null' });
    return null;
  }
  if (figure === null) return null;
  if (!figure || typeof figure !== 'object' || Array.isArray(figure)) return figure;
  rejectUnknownKeys(figure, ['type', 'description'], path, errors);
  const materialized = { ...figure };
  if (typeof materialized.description === 'string') {
    if (/LATEXSLASH|@@BS@@/.test(materialized.description)) {
      errors.push({
        path: `${path}.description`,
        code: 'FIGURE_DESCRIPTION_TRANSPORT_MARKER',
        message: 'figure.description 是内部绘图指令，禁止使用公式传输标记'
      });
    }
  }
  return materialized;
}

function rejectUnknownKeys(value, allowedKeys, path, errors) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) {
      errors.push({ path: `${path}.${key}`, code: 'UNKNOWN_STRUCTURED_FIELD', message: `禁止未定义字段 ${key}` });
    }
  }
}

function rebuildAnswerSummary(exam) {
  const answers = [];
  let index = 1;
  for (const group of exam.questions || []) {
    for (const item of group.items || []) {
      answers.push(`${index}. ${String(item.answer || '')} 解析：${String(item.explanation || '')}`);
      index += 1;
    }
  }
  exam.answers = answers;
  return exam;
}

function buildBatchSpecs(questionCount) {
  const specs = [];
  let remaining = questionCount;
  let startIndex = 1;
  while (remaining > 0) {
    const count = Math.min(BATCH_SIZE, remaining);
    specs.push({ count, startIndex });
    remaining -= count;
    startIndex += count;
  }
  return specs;
}

function buildExamFromItems(allItems, subject) {
  const typeOrder = ['choice', 'fill', 'calculation'];
  const typeLabels = ['一', '二', '三'];
  const grouped = new Map();
  for (const entry of allItems) {
    if (!grouped.has(entry.type)) grouped.set(entry.type, []);
    grouped.get(entry.type).push({ ...entry.item });
  }

  const questions = [];
  const answers = [];
  let index = 1;
  let groupIndex = 0;
  for (const type of typeOrder) {
    const items = grouped.get(type) || [];
    if (!items.length) continue;
    for (const item of items) {
      item.index = index;
      answers.push(`${index}. ${item.answer} 解析：${item.explanation}`);
      index += 1;
    }
    questions.push({
      type,
      title: `${typeLabels[groupIndex]}、${TYPE_NAMES[type]}`,
      items
    });
    groupIndex += 1;
  }
  return { title: `${subject}试卷`, questions, answers };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, consume));
  return results;
}

function describeGenerationError(error) {
  if (error instanceof ContentContractError) return formatContractErrors(error);
  return String(error?.message || error || '未知生成错误').slice(0, 2400);
}

function isRetryableGenerationError(error) {
  const message = String(error?.message || '');
  if (/(?:API返回\s*)?(?:401|403)|API\s*Key|密钥未配置|未配置.*密钥/i.test(message)) return false;
  return true;
}

module.exports = {
  BATCH_SIZE,
  MAX_BATCH_REVIEW_ATTEMPTS,
  MAX_GENERATION_ATTEMPTS,
  createExamGenerator,
  _internals: {
    buildBatchSpecs,
    buildGenerationSystemPrompt,
    buildRetryGuidance,
    buildReviewSystemPrompt,
    isReviewableDraftError,
    materializeStructuredExam,
    parseStrictExamJson,
    rebuildAnswerSummary,
    serializeExamForAI,
    runWithConcurrency
  }
};
