const { generateContent } = require('./ai');
const {
  FIGURE_OUTPUT_RULE,
  normalizeExamFigures,
  repairExamFigureIntegrity,
  assertExamFigureIntegrity,
} = require('../../shared/figure-integrity');
const {
  FORMULA_OUTPUT_RULE,
  extractCompleteJsonObject,
  normalizeJsonStringSyntax,
  parseAcademicJson,
  normalizeExamAcademicContent,
  repairExamAcademicContent,
  assertAcademicContentIntegrity,
} = require('../../shared/academic-content');

function parseAIJson(content) {
  return parseAcademicJson(content);
}

async function parseAIJsonWithRepair(content) {
  try {
    return parseAIJson(content);
  } catch (error) {
    console.warn('上传试卷生成结果 JSON 解析失败，尝试自动修复:', error.message);
  }

  const repairedContent = await generateContent(
    '你是严格的 JSON 语法修复器。只修复 JSON 语法错误，必须保留原有字段、题目内容、答案、解析、题目顺序和题目数量。不要改写、补写、删减任何试题内容。只输出修复后的合法 JSON，不输出 markdown 或解释。',
    `下面这段内容应该是一个 JSON 对象，但存在语法错误。请只修复 JSON 语法，使其可以被 JSON.parse 正常解析。\n\n${content}`,
    {
      maxTokens: 16000,
      temperature: 0
    }
  );

  try {
    return parseAIJson(repairedContent);
  } catch (error) {
    console.error('上传试卷生成结果 JSON 自动修复后仍解析失败:', error.message);
    throw new Error('AI 返回结构暂未整理成功，请重新生成一次');
  }
}

function buildSourceText(sources) {
  return sources.map((source, index) => {
    const header = `【文件 ${index + 1}：${source.name}；类型：${source.kind}；页面图片：${source.imageCount || 0} 张】`;
    return source.text ? `${header}\n${source.text}` : `${header}\n[该文件通过视觉内容解析]`;
  }).join('\n\n');
}

function countQuestions(exam) {
  return (exam.questions || []).reduce((total, group) => total + (group.items || []).length, 0);
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildUploadMetadata(exam, sources, settings = {}) {
  const generatedQuestionCount = countQuestions(exam);
  const declaredQuestionCount = parsePositiveInt(exam.analysisSummary?.questionCount);

  if (!exam.analysisSummary || typeof exam.analysisSummary !== 'object') {
    exam.analysisSummary = {};
  }

  if (declaredQuestionCount && declaredQuestionCount !== generatedQuestionCount) {
    console.warn(
      `[AI] 题量元数据与生成结果不一致，已按生成结果校正: analysisSummary=${declaredQuestionCount}, generated=${generatedQuestionCount}`
    );
  }

  // analysisSummary 是模型输出的元数据，不能让它的计数误差阻断已生成试卷。
  exam.analysisSummary.questionCount = generatedQuestionCount;

  return {
    sourceFiles: sources.map((source) => source.name),
    sourceQuestionCount: generatedQuestionCount,
    generatedQuestionCount,
    declaredQuestionCount: declaredQuestionCount || generatedQuestionCount,
    questionCountAdjusted: Boolean(declaredQuestionCount && declaredQuestionCount !== generatedQuestionCount),
    generationMode: 'uploaded-exam-variant',
    variantDifficulty: settings.variantDifficulty,
    variationCoefficient: settings.variationCoefficient,
    figureIntegrityIssueCount: settings.figureIntegrityIssueCount || 0,
    figureRepairedIndexes: settings.figureRepairedIndexes || [],
    academicIntegrityIssueCount: settings.academicIntegrityIssueCount || 0,
    academicRepairedPaths: settings.academicRepairedPaths || [],
    academicFallbackPaths: settings.academicFallbackPaths || [],
    generatedAt: new Date().toISOString()
  };
}

function clampLevel(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(10, parsed));
}

function getVariantDifficultyDescription(level) {
  const descriptions = {
    1: '极低难度：识记或直接观察即可作答，1步完成，不能设置陷阱',
    2: '很简单：只需理解单一概念或公式，1-2步完成，数据直接',
    3: '超简单题：基础应用，低步骤计算，面向刚学会该知识点的学生',
    4: '基础巩固：需要选择合适公式或方法，2-3步完成，轻微转化',
    5: '标准练习：常规校内训练难度，3-4步完成，有基础综合',
    6: '日常难度题：课堂、作业、单元练习常见难度，4-5步，适度综合',
    7: '提高训练：需要多条件整合、分类或转化，5-7步，有明显区分度',
    8: '中高考级别难度：综合理解、规范推理、关键转化和中高考式区分度',
    9: '竞赛入门难度：需要非常规思路、辅助构造或深层分析',
    10: '奥林匹克级别超难题：高度综合、构造性强，需要创新方法或证明'
  };
  return descriptions[level] || descriptions[8];
}

function getVariationCoefficientDescription(level) {
  if (level <= 2) return '极低变式：只允许替换小数值或等价表述，题型和解法路径几乎不变';
  if (level <= 5) return '保守变式：保持原题题型和主要解法路径，可调整数值、对象、条件顺序或轻微情境';
  if (level <= 7) return '明显变式：只保留知识点和考点，至少改变 4 个维度，如题型、情境、对象、条件组合、设问角度、表达载体或推理路径';
  if (level <= 9) return '强变式：只保留知识点和考点，至少改变 5-6 个维度，题干骨架、条件结构、设问目标和推理路径都要明显区别于原题';
  return '最大变式：只保留知识点和考点，其余维度尽量重构，生成让用户明显感知为全新题目的高强度变体';
}

function getQuestionTypeRule(level) {
  if (level <= 5) {
    return '变式系数为 1-5 时，原则上保留原题题型：选择题仍为选择题，填空题仍为填空题，解答题仍为解答题；变化重点放在数值、对象、条件顺序、轻微情境和设问角度。';
  }
  return '变式系数为 6-10 时，只要求知识点和考点一致，题型可以改变，也可以保留；不得为了保留题型而做成相似题。题型、情境、表达载体、条件结构、设问目标和推理路径都可以大幅改变。';
}

function getVariationIntensityRule(level) {
  if (level <= 5) {
    return '变式系数 1-5：允许小到中等变化，但不能只做同义改写。至少调整数值、对象、条件顺序或轻微情境中的 1-2 项。';
  }
  if (level <= 7) {
    return '变式系数 6-7：每道题必须至少改变 4 个维度，可选维度包括题型、题干情境、对象角色、条件组合、数据关系、表达载体、设问目标、推理路径。禁止只换数字、只换措辞或保留原题骨架。';
  }
  if (level <= 9) {
    return '变式系数 8-9：每道题必须至少改变 5-6 个维度，并且题干骨架、条件结构和设问目标要明显不同于原题；应重新设计情境载体、信息呈现方式、条件关系、问题目标和解题切入点。';
  }
  return '变式系数 10：每道题必须做重构式变体，只保留知识点和考点，最大幅度改变题型、情境、表达载体、条件组合、数据关系、设问结构和推理路径，让用户明显感知为全新变体题。';
}

function getGenerationTemperature(level) {
  return Math.min(0.95, 0.35 + level * 0.075);
}

function normalizeExam(exam) {
  if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
    throw new Error('AI 未返回有效试卷结构，请重试');
  }

  const answers = [];
  let index = 1;

  for (const group of exam.questions) {
    if (!Array.isArray(group.items)) {
      group.items = [];
      continue;
    }

    for (const item of group.items) {
      item.index = index;
      answers.push(`${index}. ${item.answer || ''} 解析：${item.explanation || ''}`);
      index += 1;
    }
  }

  if (index === 1) {
    throw new Error('AI 未识别到试卷题目，请确认上传的是完整试卷');
  }

  exam.answers = answers;
  exam.title = String(exam.title || '原卷对应变式试卷').trim();
  normalizeExamFigures(exam);
  normalizeExamAcademicContent(exam);
  return exam;
}

async function generateVariantExamFromUpload({ sources, imageUrls, variantDifficulty = 8, variationCoefficient = 6 }) {
  const safeVariantDifficulty = clampLevel(variantDifficulty, 8);
  const safeVariationCoefficient = clampLevel(variationCoefficient, 6);
  const generationTemperature = getGenerationTemperature(safeVariationCoefficient);
  const systemPrompt = `你是一位资深 K12 试卷命题专家和试卷结构解析专家。

你的任务不是随机出卷，而是先完整理解用户上传的原始试卷，再生成一份一一对应的变式试卷。

【必须遵守】
1. 先在内部解析原卷的科目、学段、题型结构、知识点、考点、题目数量、难度梯度、每题解法和图形需求。不要向用户展示解析过程。
2. 新试卷的题目数量必须与原卷一致。原卷第 N 题必须对应生成新卷第 N 题，不允许新增、删减、合并或拆分题目。
3. 每道新题必须是对应原题的变形变体题：变式系数 1-5 级偏保守，尽量保留题型和主要解法路径；变式系数 6-10 级只保留核心知识点和考点，其余维度必须明显变化，不能做相似题。
4. 禁止原样照抄题干、选项、答案和解析。禁止只做同义改写。
5. ${getQuestionTypeRule(safeVariationCoefficient)}
6. 如果新题确实需要图形，必须提供 figure 字段。figure.description 要精确描述新题图形，不得沿用与新题不一致的旧数据。
${FIGURE_OUTPUT_RULE}
7. 所有答案必须先自行验算，再填写 answer 和 explanation。解析必须完整、准确、与答案一致。
8. 每一道新题都必须匹配用户指定的变式难度：${safeVariantDifficulty}/10（${getVariantDifficultyDescription(safeVariantDifficulty)}）。不要沿用原卷难度；若原题难度与用户指定难度冲突，以用户指定难度为准，同时保留原题知识点和考点。难度等级必须让用户明确感知到差异，不得把不同等级都写成相似的日常题。
9. 每一道新题都必须匹配用户指定的变式系数：${safeVariationCoefficient}/10（${getVariationCoefficientDescription(safeVariationCoefficient)}）。当变式系数大于 5 时，只允许知识点和考点保持一致，其余维度要尽可能变化，不能只换数字、不能同义改写、不能保留原题题干骨架。
10. 高变式强制要求：${getVariationIntensityRule(safeVariationCoefficient)} 若新题与原题在题型、题干骨架、条件组合、设问目标和推理路径中有 3 项以上相似，视为不合格，必须重写。
11. 反相似题判定：高变式题不能让用户感觉是“原题套壳”。必须先在内部抽象原题知识点和考点，再重新选择任务场景、信息结构、条件关系、设问目标和解题切入点。
12. 难度自检：生成每道题后在内部核对步骤数、综合性、隐藏条件、计算量和思路创新度是否符合 ${safeVariantDifficulty} 级；不符合就重写该题。
13. ${FORMULA_OUTPUT_RULE}
14. 只返回 JSON，不返回分析过程，不返回 markdown。

【输出结构】
{
  "title": "原卷对应变式试卷",
  "analysisSummary": {
    "subject": "识别到的科目",
    "gradeLevel": "识别到的学段或年级",
    "questionCount": 题目总数,
    "difficulty": "难度概述",
    "variantDifficulty": ${safeVariantDifficulty},
    "variationCoefficient": ${safeVariationCoefficient},
    "knowledgePoints": ["知识点"],
    "examPoints": ["考点"]
  },
  "questions": [
    {
      "type": "choice|fill|blank|calculation|qa|other",
      "title": "大题标题",
      "items": [
        {
          "index": 1,
          "stem": "新题题干",
          "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
          "answer": "答案",
          "explanation": "解析",
          "figure": {
            "type": "geometry|function|coordinate|circuit|diagram 等",
            "description": "精确描述新题图形"
          }
        }
      ]
    }
  ],
  "answers": ["1. 答案 解析：..."]
}

不需要图形的题目不要添加 figure 字段。`;

  const userPrompt = `请根据以下完整原卷内容生成一份逐题对应的变式试卷。

本次变式设置：
- 变式难度：${safeVariantDifficulty}/10，所有题目都必须达到该难度级别。
- 变式系数：${safeVariationCoefficient}/10，所有题目都必须达到该变化幅度；知识点、考点不得改变。
- 题型规则：${getQuestionTypeRule(safeVariationCoefficient)}
- 变化强度：${getVariationIntensityRule(safeVariationCoefficient)}

${buildSourceText(sources)}

请直接输出变式试卷 JSON。`;

  const content = await generateContent(systemPrompt, userPrompt, {
    maxTokens: 16000,
    temperature: generationTemperature,
    imageUrls
  });

  const exam = normalizeExam(await parseAIJsonWithRepair(content));
  if (!exam.analysisSummary || typeof exam.analysisSummary !== 'object') {
    exam.analysisSummary = {};
  }
  exam.analysisSummary.variantDifficulty = safeVariantDifficulty;
  exam.analysisSummary.variationCoefficient = safeVariationCoefficient;
  const figureIntegrity = await repairExamFigureIntegrity(exam, {
    requestRepair: async ({ systemPrompt: repairSystemPrompt, userPrompt: repairUserPrompt, maxTokens }) => {
      const repairContent = await generateContent(repairSystemPrompt, repairUserPrompt, {
        maxTokens,
        temperature: 0.15,
      });
      return parseAIJsonWithRepair(repairContent);
    },
    context: {
      subject: exam.analysisSummary.subject,
      grade: exam.analysisSummary.gradeLevel,
      variantDifficulty: safeVariantDifficulty,
      variationCoefficient: safeVariationCoefficient,
    },
    maxAttempts: 2,
  });
  normalizeExam(exam);
  const academicIntegrity = await repairExamAcademicContent(exam, {
    requestRepair: async ({ systemPrompt: repairSystemPrompt, userPrompt: repairUserPrompt, maxTokens }) => {
      const repairContent = await generateContent(repairSystemPrompt, repairUserPrompt, {
        maxTokens,
        temperature: 0,
      });
      return parseAIJsonWithRepair(repairContent);
    },
    context: {
      subject: exam.analysisSummary.subject,
      grade: exam.analysisSummary.gradeLevel,
    },
    maxAttempts: 2,
  });
  if (academicIntegrity.fallbackPaths.length > 0) {
    console.warn('[AI公式] 定点返修未完全收敛，已安全移除孤立定界符:', academicIntegrity.fallbackPaths.join('、'));
  }
  assertAcademicContentIntegrity(exam);
  assertExamFigureIntegrity(exam);
  exam.metadata = buildUploadMetadata(exam, sources, {
    variantDifficulty: safeVariantDifficulty,
    variationCoefficient: safeVariationCoefficient,
    figureIntegrityIssueCount: figureIntegrity.initialIssueCount,
    figureRepairedIndexes: figureIntegrity.repairedIndexes,
    academicIntegrityIssueCount: academicIntegrity.initialIssueCount,
    academicRepairedPaths: academicIntegrity.repairedPaths,
    academicFallbackPaths: academicIntegrity.fallbackPaths,
  });

  return exam;
}

module.exports = {
  generateVariantExamFromUpload,
  _internals: {
    parseAIJson,
    extractCompleteJsonObject,
    normalizeJsonStringSyntax
  }
};
