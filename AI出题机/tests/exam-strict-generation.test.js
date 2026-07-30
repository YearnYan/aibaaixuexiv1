const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BATCH_SIZE, createExamGenerator, _internals } = require('../shared/exam-generation-core');

function createExamJson(count) {
  const items = Array.from({ length: count }, (_, index) => ({
    stem: `概括材料所反映的历史特征（${index + 1}）。`,
    options: null,
    answer: `特征${index + 1}`,
    explanation: `依据材料第${index + 1}层信息归纳。`,
    figure: null
  }));
  return JSON.stringify({ items });
}

function generationParams(questionCount) {
  return {
    version: '全版本融合课程体系',
    grade: '高中一年级',
    subject: '历史',
    topics: '近代中国',
    examPoints: '社会转型',
    difficulty: 5,
    difficultyPrompt: '难度适中',
    expectedQuestionType: 'calculation',
    questionCount
  };
}

const silentLogger = { log() {}, error() {} };

test('严格 JSON 解析器拒绝代码块、前后说明和非法反斜杠，不做修复', () => {
  assert.throws(() => _internals.parseStrictExamJson('```json\n{}\n```'), /不是纯 JSON/);
  assert.throws(() => _internals.parseStrictExamJson('说明：{"questions":[]}'), /不是纯 JSON/);
  assert.throws(() => _internals.parseStrictExamJson('{"questions":[],"stem":"\\(x\\)"}'), /禁止自动修复/);
  const encoded = _internals.parseStrictExamJson(String.raw`{"questions":[],"stem":"\u005c(x\u005c)"}`);
  assert.equal(encoded.stem, '\\(x\\)');
});

test('首次质量失败后使用同一生成器严格重试并成功', async () => {
  let calls = 0;
  const generator = createExamGenerator({
    invokeAI: async () => {
      calls += 1;
      if (calls === 1) return '不是 JSON';
      return createExamJson(1);
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });
  const exam = await generator.generateExam(generationParams(1));
  assert.equal(calls, 3, '第一次生成失败，第二次生成与审核各调用一次');
  assert.equal(exam.questions[0].items.length, 1);
});

test('初稿裸 LaTeX 不浪费任务级重试而是携带字段错误进入严格审题纠正', async () => {
  const invalidDraft = JSON.parse(createExamJson(1));
  invalidDraft.items[0].answer = '答案为 \\frac{1}{2}';
  const observed = [];
  const generator = createExamGenerator({
    invokeAI: async (systemPrompt, userPrompt) => {
      observed.push({ systemPrompt, userPrompt });
      return observed.length === 1 ? JSON.stringify(invalidDraft) : createExamJson(1);
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });

  const exam = await generator.generateExam(generationParams(1));
  assert.equal(observed.length, 2, '初稿内容错误应直接进入独立审题修正，不应从零重生成');
  assert.equal(exam.questions[0].items.length, 1);
  assert.match(observed[1].userPrompt, /items\[0\]\.answer \[BARE_LATEX_COMMAND\]/);
  assert.match(observed[1].userPrompt, /只修改下列被拒绝字段/);
  assert.match(observed[1].userPrompt, /答案为 \\\\frac\{1\}\{2\}/);
});

test('Word 原生公式不兼容项在交付前进入批次审题并完整纠正', async () => {
  const invalidDraft = JSON.parse(createExamJson(1));
  invalidDraft.items[0].answer = '\\(\\href{x}{y}\\)';
  const observed = [];
  const generator = createExamGenerator({
    invokeAI: async (systemPrompt, userPrompt) => {
      observed.push({ systemPrompt, userPrompt });
      return observed.length === 1 ? JSON.stringify(invalidDraft) : createExamJson(1);
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });

  const exam = await generator.generateExam(generationParams(1));
  assert.equal(observed.length, 2, 'Word 不兼容公式应在当前批次审题纠正，不应进入任务级重生成');
  assert.equal(exam.questions[0].items.length, 1);
  assert.match(observed[1].userPrompt, /items\[0\]\.answer \[WORD_OMML_CONVERSION_FAILED\]/);
  assert.match(observed[1].userPrompt, /\\\\href\{x\}\{y\}/);
  assert.doesNotMatch(JSON.stringify(exam), /\\\\href/);
});

test('审题首次仍输出裸命令时只重试当前批次并使用最新坏稿纠正', async () => {
  const invalidReview = JSON.parse(createExamJson(1));
  invalidReview.items[0].answer = '\\sqrt{4}';
  const prompts = [];
  let calls = 0;
  const generator = createExamGenerator({
    invokeAI: async (systemPrompt, userPrompt) => {
      calls += 1;
      prompts.push(userPrompt);
      if (calls === 2) return JSON.stringify(invalidReview);
      return createExamJson(1);
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });

  const exam = await generator.generateExam(generationParams(1));
  assert.equal(calls, 3, '生成一次、失败审题一次、当前批次纠正一次');
  assert.equal(exam.questions[0].items.length, 1);
  assert.match(prompts[2], /items\[0\]\.answer \[BARE_LATEX_COMMAND\]/);
  assert.match(prompts[2], /\\\\sqrt\{4\}/);
});

test('继续生成3题的2加1批次在首题答案连续违规后仍完整收敛', async () => {
  const invalidTwo = JSON.parse(createExamJson(2));
  invalidTwo.items[0].answer = 'a=\\frac{5}{2}';
  const validTwo = createExamJson(2);
  const validOne = createExamJson(1);
  let calls = 0;
  const prompts = [];
  const generator = createExamGenerator({
    invokeAI: async (systemPrompt, userPrompt) => {
      calls += 1;
      prompts.push(userPrompt);
      if (calls <= 2) return JSON.stringify(invalidTwo);
      if (calls === 3) return validTwo;
      return validOne;
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });

  const exam = await generator.generateExam(generationParams(3));
  const items = exam.questions.flatMap((group) => group.items);
  assert.equal(calls, 5, '首批生成、两次局部审题、第二批生成与审核');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.index), [1, 2, 3]);
  assert.match(prompts[1], /items\[0\]\.answer \[BARE_LATEX_COMMAND\]/);
  assert.match(prompts[2], /items\[0\]\.answer \[BARE_LATEX_COMMAND\]/);
  assert.doesNotMatch(JSON.stringify(exam), /a=\\\\frac\{5\}\{2\}/);
});

test('结构未知字段不能借审题纠正绕过严格提交契约', () => {
  const invalid = JSON.parse(createExamJson(1));
  invalid.items[0].index = 1;
  assert.throws(
    () => _internals.materializeStructuredExam(invalid),
    (error) => {
      assert.equal(_internals.isReviewableDraftError(error), false);
      return error.errors.some((item) => item.code === 'UNKNOWN_STRUCTURED_FIELD');
    }
  );
});

test('前序批次成功但后续批次失败时禁止返回部分试卷', async () => {
  let calls = 0;
  const generator = createExamGenerator({
    invokeAI: async () => {
      calls += 1;
      const phase = (calls - 1) % 3;
      if (phase === 0 || phase === 1) return createExamJson(BATCH_SIZE);
      return '后续批次损坏';
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });
  await assert.rejects(
    () => generator.generateExam(generationParams(BATCH_SIZE + 1)),
    (error) => error.code === 'STRICT_GENERATION_REJECTED'
  );
  assert.equal(calls, 9, '三次任务级尝试都必须重新生成首批并在坏批次处整体失败');
});

test('生成与审核提示词只允许标准 LaTeX 契约且不降低图形约束', () => {
  const prompt = _internals.buildGenerationSystemPrompt({
    ...generationParams(1),
    questionTypeName: '解答题',
    topicsText: '近代中国',
    examPointsText: '社会转型'
  });
  assert.match(prompt, /KaTeX \+ mhchem/);
  assert.match(prompt, /禁止生成占位图、静态模板图/);
  assert.match(prompt, /行内公式必须直接写成/);
  assert.doesNotMatch(prompt, /反斜杠只能写成单词 LATEXSLASH/);
  assert.match(prompt, /严禁输出 .*answers/);
  assert.match(prompt, /必须且只能调用 submit_exam/);
  assert.match(prompt, /figure\.description 是内部绘图指令/);
  assert.match(prompt, /根对象必须且只能有 items/);
  assert.doesNotMatch(prompt, /"answers"\s*:/);
  assert.doesNotMatch(prompt, /"questions"\s*:/);
  assert.doesNotMatch(prompt, /"index"\s*:/);
  assert.match(prompt, /\\frac/);
  assert.doesNotMatch(prompt, /禁止使用任何LaTeX|必须使用纯文本和Unicode符号/);
});

test('审核输入通过合法 JSON 直接传输标准 LaTeX', () => {
  const exam = JSON.parse(createExamJson(1));
  exam.items[0].stem = '已知 \\(x^2=\\frac{1}{1}\\)。';
  const serialized = _internals.serializeExamForAI(exam);
  assert.ok(serialized.includes('\\\\frac'), 'JSON.stringify 必须按 JSON 标准转义 LaTeX 反斜杠');
  assert.doesNotMatch(serialized, /LATEXSLASH|@@BS@@/);
  assert.doesNotMatch(serialized, /"answers"\s*:/);
  const parsed = _internals.parseStrictExamJson(serialized);
  assert.equal(parsed.items[0].stem, '已知 \\(x^2=\\frac{1}{1}\\)。');
  const materialized = _internals.materializeStructuredExam(parsed);
  assert.equal(materialized.questions[0].items[0].stem, '已知 \\(x^2=\\frac{1}{1}\\)。');
  assert.equal(materialized.questions[0].items[0].index, 1);

  const offsetMaterialized = _internals.materializeStructuredExam(parsed, {
    expectedQuestionType: 'fill',
    startIndex: 7
  });
  assert.equal(offsetMaterialized.questions[0].type, 'fill');
  assert.equal(offsetMaterialized.questions[0].items[0].index, 7);
});

test('非选择题 options 必须显式为 null，省略字段直接拒绝', () => {
  const exam = JSON.parse(createExamJson(1));
  const materialized = _internals.materializeStructuredExam(exam);
  assert.equal(materialized.questions[0].items[0].options, undefined);
  delete exam.items[0].options;
  assert.throws(
    () => _internals.materializeStructuredExam(exam),
    (error) => error.errors.some((item) => item.code === 'INVALID_STRUCTURED_OPTIONS')
  );
});

test('结构化内容接受标准 LaTeX，拒绝坏边界、私有传输词和不存在的 eq 命令', () => {
  const validExam = JSON.parse(createExamJson(1));
  validExam.items[0].stem = '计算 \\(\\frac{1}{2}\\)。';
  validExam.items[0].explanation = '设 \\(S_{\\text{主视图}}=3\\)，代入计算。';
  assert.equal(
    _internals.materializeStructuredExam(validExam).questions[0].items[0].stem,
    '计算 \\(\\frac{1}{2}\\)。'
  );

  const invalidValues = [
    ['\\(x^2', 'UNCLOSED_DELIMITER'],
    ['x^2\\)', 'UNEXPECTED_CLOSING_DELIMITER'],
    ['\\(x+\\(1\\)\\)', 'NESTED_DELIMITER'],
    ['\\(LATEXSLASHfrac{1}{2}\\)', 'INTERNAL_TRANSPORT_MARKER'],
    ['[[LATEX]]x^2[[/LATEX]]', 'INTERNAL_TRANSPORT_MARKER'],
    ['\\(1 \\eq 1\\)', 'FORBIDDEN_EQ_COMMAND'],
    ['计算 \\frac{1}{2}', 'BARE_LATEX_COMMAND'],
    ['\\\\(x^2\\\\)', 'DOUBLE_ESCAPED_DELIMITER']
  ];
  for (const [stem, code] of invalidValues) {
    const exam = JSON.parse(createExamJson(1));
    exam.items[0].stem = stem;
    assert.throws(
      () => _internals.materializeStructuredExam(exam),
      (error) => error.errors.some((item) => item.code === code),
      stem
    );
  }
});

test('结构化提交拒绝未知字段、模型生成的确定性元数据和缺失 figure', () => {
  const cases = [
    [(exam) => { exam.answers = []; }, 'UNKNOWN_STRUCTURED_FIELD'],
    [(exam) => { exam.questions = []; }, 'UNKNOWN_STRUCTURED_FIELD'],
    [(exam) => { exam.items[0].index = 1; }, 'UNKNOWN_STRUCTURED_FIELD'],
    [(exam) => { exam.items[0].type = 'calculation'; }, 'UNKNOWN_STRUCTURED_FIELD'],
    [(exam) => { delete exam.items[0].figure; }, 'MISSING_STRUCTURED_FIGURE']
  ];
  for (const [mutate, code] of cases) {
    const exam = JSON.parse(createExamJson(1));
    mutate(exam);
    assert.throws(
      () => _internals.materializeStructuredExam(exam),
      (error) => error.errors.some((item) => item.code === code),
      code
    );
  }
});

test('图形描述只接受内部绘图指令并拒绝公式传输标记', () => {
  const exam = JSON.parse(createExamJson(1));
  exam.items[0].stem = '如图所示，回答问题。';
  exam.items[0].figure = {
    type: 'function',
    description: '绘制函数 y=x^2 的图像，顶点为 O(0,0)，标明坐标轴正方向。'
  };
  const materialized = _internals.materializeStructuredExam(exam);
  assert.equal(
    materialized.questions[0].items[0].figure.description,
    '绘制函数 y=x^2 的图像，顶点为 O(0,0)，标明坐标轴正方向。'
  );

  exam.items[0].figure.description = '绘制 LATEXSLASH(y=x^2LATEXSLASH) 的图像并标明关键点。';
  assert.throws(
    () => _internals.materializeStructuredExam(exam),
    (error) => error.errors.some((item) => item.code === 'FIGURE_DESCRIPTION_TRANSPORT_MARKER')
  );
});

test('生成与审核调用只携带强制 submit_exam 契约', async () => {
  const observed = [];
  const generator = createExamGenerator({
    invokeAI: async (systemPrompt, userPrompt, options) => {
      observed.push({ systemPrompt, userPrompt, options });
      return createExamJson(1);
    },
    getMaxTokens: () => 8000,
    logger: silentLogger,
    batchConcurrency: 1
  });
  await generator.generateExam(generationParams(1));
  assert.equal(observed.length, 2);
  for (const call of observed) {
    assert.equal(call.options.structuredOutput.name, 'submit_exam');
    assert.equal(call.options.jsonMode, undefined);
    const itemsSchema = call.options.structuredOutput.schema.properties.items;
    assert.equal(itemsSchema.minItems, 1);
    assert.equal(itemsSchema.maxItems, 1);
    assert.equal(itemsSchema.items.properties.options.type, 'null');
    assert.deepEqual(Object.keys(call.options.structuredOutput.schema.properties), ['items']);
  }
});

test('Node、Worker 与前端源码不存在内容降级和静态图兜底路径', () => {
  const root = path.join(__dirname, '..');
  const sources = {
    nodeAI: fs.readFileSync(path.join(root, 'server/services/ai.js'), 'utf8'),
    workerAI: fs.readFileSync(path.join(root, 'worker/services/ai.js'), 'utf8'),
    nodeExam: fs.readFileSync(path.join(root, 'server/routes/exam.js'), 'utf8'),
    workerExam: fs.readFileSync(path.join(root, 'worker/routes/exam.js'), 'utf8'),
    workerRender: fs.readFileSync(path.join(root, 'worker/routes/render.js'), 'utf8'),
    frontend: fs.readFileSync(path.join(root, 'src/main.js'), 'utf8')
  };
  assert.doesNotMatch(sources.nodeAI, /repairJsonText|wrapBareLatex|postProcessLatexSymbols|return \[\]/);
  assert.doesNotMatch(sources.nodeAI, /response_format|jsonMode/);
  assert.doesNotMatch(sources.workerAI, /response_format|jsonMode/);
  assert.match(sources.nodeAI, /extractStructuredToolArguments/);
  assert.match(sources.workerAI, /extractStructuredToolArguments/);
  assert.match(sources.nodeAI, /batchConcurrency:\s*1/);
  assert.match(sources.nodeExam, /runWithConcurrency\(jobs,\s*2/);
  assert.match(sources.workerExam, /batchConcurrency:\s*1/);
  assert.match(sources.workerExam, /runWithConcurrency\(jobs,\s*2/);
  assert.doesNotMatch(sources.workerExam, /禁止使用任何LaTeX|postProcessLatexSymbols|replace\(figureRef|repairJsonText/);
  assert.doesNotMatch(sources.workerRender, /buildFallbackSvg|fallbackRenderers|catch\(\(\) => null\)/);
  assert.doesNotMatch(sources.nodeAI, /buildGenerationSystemPromptBase|buildReviewSystemPromptBase/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'shared/exam-generation-core.js'), 'utf8'), /buildGenerationSystemPromptBase|buildReviewSystemPromptBase/);
  const formatFunction = sources.frontend.match(/function formatPaperText[\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(formatFunction, /\$\$|startsWith\('\$'\)/);
  const pdfExportFunction = sources.frontend.match(/async function exportToPdf[\s\S]*?\n}\n/)[0];
  assert.match(pdfExportFunction, /querySelectorAll\('\.q-figure svg'\)/);
  assert.doesNotMatch(pdfExportFunction, /querySelectorAll\('svg'\)/);
});
