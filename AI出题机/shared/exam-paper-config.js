const { validateExamContent } = require('./subject-content-contract');

const MAX_TOPIC_CONFIGS = 20;
const MAX_POINTS_PER_TOPIC = 20;
const MAX_TOTAL_QUESTIONS = 30;
const CONTINUE_QUESTION_COUNT = 3;
const TYPE_LABELS = {
  choice: '选择题',
  fill: '填空题',
  calculation: '解答题'
};
const TYPE_ALIASES = {
  choice: ['choice', '选择题', '单项选择题', '多项选择题'],
  fill: ['fill', '填空题'],
  calculation: ['calculation', '计算题', '计算题/解答题', '解答题', '解答']
};

function normalizeTopicConfigs(body = {}) {
  if (Array.isArray(body.topicConfigs) && body.topicConfigs.length > 0) {
    if (body.topicConfigs.length > MAX_TOPIC_CONFIGS) {
      throw new Error(`最多配置 ${MAX_TOPIC_CONFIGS} 个知识点`);
    }
    return body.topicConfigs.map((rawTopic, topicIndex) => {
      const topic = cleanLabel(rawTopic?.topic);
      if (!topic) throw new Error(`第 ${topicIndex + 1} 个知识点名称不能为空`);
      const rawPoints = Array.isArray(rawTopic?.examPoints) ? rawTopic.examPoints : [];
      if (rawPoints.length < 1) throw new Error(`知识点“${topic}”至少选择一个考点`);
      if (rawPoints.length > MAX_POINTS_PER_TOPIC) {
        throw new Error(`知识点“${topic}”最多配置 ${MAX_POINTS_PER_TOPIC} 个考点`);
      }
      return {
        topic,
        examPoints: rawPoints.map((rawPoint, pointIndex) => normalizePoint(rawPoint, rawTopic, topic, pointIndex))
      };
    });
  }

  const topic = cleanLabel(body.topic);
  if (!topic) throw new Error('至少选择一个知识点');
  const examPoint = cleanLabel(body.examPoint) || topic;
  const questionCount = clampInt(body.questionCount, 1, MAX_TOTAL_QUESTIONS, 15);
  const difficulty = clampInt(body.difficulty, 1, 10, 5);
  const questionTypeCounts = distributeLegacyTypes(questionCount, body.questionTypes);
  return [{
    topic,
    examPoints: [{ name: examPoint, questionCount, difficulty, questionTypeCounts }]
  }];
}

function normalizeContinuationRequest(body = {}) {
  if (body.topicConfigs !== undefined || body.topics !== undefined || body.examPoints !== undefined) {
    throw new Error('继续生成一次只能指定一个知识点、一个考点和一个题型');
  }
  const grade = requireString(body.grade, '年级');
  const subject = requireString(body.subject, '学科');
  const topic = requireString(body.topic, '知识点');
  const examPoint = requireString(body.examPoint, '考点');
  const questionType = normalizeType(requireString(body.questionType, '题型'));
  if (!questionType) throw new Error('继续生成的题型不受支持');
  const continuationToken = requireString(body.continuationToken, '组卷会话凭证');
  if (continuationToken.length < 32 || continuationToken.length > 128) {
    throw new Error('组卷会话凭证格式无效');
  }

  const count = body.count;
  if (!Number.isInteger(count) || count !== CONTINUE_QUESTION_COUNT) {
    throw new Error(`继续生成的题量必须固定为 ${CONTINUE_QUESTION_COUNT} 题`);
  }
  const difficulty = body.difficulty;
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10) {
    throw new Error('继续生成的难度必须是 1-10 的整数');
  }
  const imageUrls = body.imageUrls ?? [];
  if (!Array.isArray(imageUrls)) throw new Error('imageUrls 必须是数组');

  const version = typeof body.version === 'string' && body.version.trim()
    ? cleanLabel(body.version)
    : '全版本融合课程体系';
  const examType = typeof body.examType === 'string' && body.examType.trim()
    ? cleanLabel(body.examType)
    : 'final';
  const job = { topic, examPoint, difficulty, questionType, questionCount: CONTINUE_QUESTION_COUNT };
  const topicConfigs = [{
    topic,
    examPoints: [{
      name: examPoint,
      questionCount: CONTINUE_QUESTION_COUNT,
      difficulty,
      questionTypeCounts: { [questionType]: CONTINUE_QUESTION_COUNT }
    }]
  }];
  return { version, grade, subject, examType, imageUrls, continuationToken, job, topicConfigs };
}

function normalizePoint(rawPoint, rawTopic, topic, pointIndex) {
  const name = cleanLabel(typeof rawPoint === 'string' ? rawPoint : rawPoint?.name);
  if (!name) throw new Error(`知识点“${topic}”的第 ${pointIndex + 1} 个考点名称不能为空`);
  const questionCount = clampInt(rawPoint?.questionCount ?? rawTopic?.questionCount, 1, MAX_TOTAL_QUESTIONS, 5);
  const difficulty = clampInt(rawPoint?.difficulty ?? rawTopic?.difficulty, 1, 10, 5);
  const rawCounts = rawPoint?.questionTypeCounts || rawPoint?.questionTypes;
  const questionTypeCounts = normalizeTypeCounts(rawCounts, questionCount);
  const countSum = Object.values(questionTypeCounts).reduce((sum, count) => sum + count, 0);
  if (countSum !== questionCount) {
    throw new Error(`考点“${name}”的题型数量之和为 ${countSum}，必须等于题目数量 ${questionCount}`);
  }
  return { name, questionCount, difficulty, questionTypeCounts };
}

function normalizeTypeCounts(rawCounts, questionCount) {
  const entries = rawCounts && typeof rawCounts === 'object' && !Array.isArray(rawCounts)
    ? Object.entries(rawCounts)
    : [];
  const result = {};
  const unknownTypes = [];
  for (const [rawType, rawCount] of entries) {
    const type = normalizeType(rawType);
    const count = clampInt(rawCount, 0, MAX_TOTAL_QUESTIONS, 0);
    if (!type) {
      unknownTypes.push(rawType);
      continue;
    }
    if (count > 0) result[type] = (result[type] || 0) + count;
  }
  if (unknownTypes.length) throw new Error(`不支持的题型：${unknownTypes.join('、')}`);
  if (Object.keys(result).length === 0) return { calculation: questionCount };
  return result;
}

function normalizeType(value) {
  const input = cleanLabel(value).toLowerCase();
  return Object.entries(TYPE_ALIASES)
    .find(([, aliases]) => aliases.some((alias) => alias.toLowerCase() === input))?.[0] || '';
}

function distributeLegacyTypes(questionCount, rawTypes) {
  const types = Array.isArray(rawTypes) ? rawTypes.map(normalizeType).filter(Boolean) : [];
  const uniqueTypes = Array.from(new Set(types.length ? types : ['choice', 'fill', 'calculation']));
  const counts = {};
  uniqueTypes.forEach((type, index) => {
    counts[type] = Math.floor(questionCount / uniqueTypes.length) + (index < questionCount % uniqueTypes.length ? 1 : 0);
  });
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
}

function buildGenerationJobs(topicConfigs) {
  const jobs = [];
  for (const topicConfig of topicConfigs) {
    for (const point of topicConfig.examPoints) {
      for (const [questionType, questionCount] of Object.entries(point.questionTypeCounts)) {
        jobs.push({
          topic: topicConfig.topic,
          examPoint: point.name,
          difficulty: point.difficulty,
          questionType,
          questionCount
        });
      }
    }
  }
  return jobs;
}

function countConfiguredQuestions(topicConfigs) {
  return topicConfigs.reduce(
    (sum, topic) => sum + topic.examPoints.reduce((pointSum, point) => pointSum + point.questionCount, 0),
    0
  );
}

function mergeGeneratedExams(results, subject, examType, topicConfigs) {
  const groups = [];
  const groupMap = new Map();
  const answers = [];
  let index = 1;

  for (const { job, exam } of results) {
    for (const group of exam.questions || []) {
      for (const item of group.items || []) {
        const source = {
          topic: job.topic,
          examPoint: job.examPoint,
          difficulty: job.difficulty,
          questionType: job.questionType
        };
        const key = `${job.topic}\u0000${job.examPoint}\u0000${job.questionType}`;
        let target = groupMap.get(key);
        if (!target) {
          target = {
            type: job.questionType,
            title: `${job.topic}｜${job.examPoint}｜${TYPE_LABELS[job.questionType]}`,
            source,
            items: []
          };
          groupMap.set(key, target);
          groups.push(target);
        }
        const nextItem = { ...item, index, source };
        target.items.push(nextItem);
        answers.push(`${index}. ${nextItem.answer} 解析：${nextItem.explanation}`);
        index += 1;
      }
    }
  }

  const expected = countConfiguredQuestions(topicConfigs);
  const exam = {
    title: `${subject}${examType === 'unit' ? '单元' : '多知识点'}试卷`,
    questions: groups,
    answers,
    metadata: {
      subject,
      examType,
      topicConfigs,
      totalQuestions: expected,
      generatedAt: new Date().toISOString()
    }
  };
  validateExamContent(exam, { subject, expectedQuestionCount: expected });
  return exam;
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

function cleanLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return cleanLabel(value);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

module.exports = {
  CONTINUE_QUESTION_COUNT,
  MAX_POINTS_PER_TOPIC,
  MAX_TOPIC_CONFIGS,
  MAX_TOTAL_QUESTIONS,
  TYPE_LABELS,
  buildGenerationJobs,
  countConfiguredQuestions,
  mergeGeneratedExams,
  normalizeContinuationRequest,
  normalizeTopicConfigs,
  runWithConcurrency
};
