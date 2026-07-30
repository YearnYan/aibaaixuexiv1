const CONTINUE_QUESTION_COUNT = 3;
const SOURCE_KEYS = ['topic', 'examPoint', 'difficulty', 'questionType'];

function sourcesMatch(actual = {}, expected = {}) {
  return SOURCE_KEYS.every((key) => String(actual[key] ?? '') === String(expected[key] ?? ''));
}

function buildContinuationAppendPlan(data, expectedSource, firstIndex) {
  const startIndex = Number(firstIndex);
  if (!Number.isInteger(startIndex) || startIndex < 0) throw new Error('现有题目数量无效');
  const groups = Array.isArray(data?.questions) ? data.questions.filter(Boolean) : [];
  const items = groups.flatMap((group) => Array.isArray(group.items) ? group.items.filter(Boolean) : []);
  if (groups.length !== 1 || items.length !== CONTINUE_QUESTION_COUNT) {
    throw new Error(`服务端必须完整返回 ${CONTINUE_QUESTION_COUNT} 道同组题目`);
  }
  if (!Array.isArray(data.answers) || data.answers.length !== CONTINUE_QUESTION_COUNT) {
    throw new Error(`服务端必须完整返回 ${CONTINUE_QUESTION_COUNT} 条答案解析`);
  }
  if (!sourcesMatch(groups[0].source, expectedSource)) {
    throw new Error('继续生成题组与当前题组来源不一致');
  }
  for (const item of items) {
    if (!sourcesMatch(item.source, expectedSource)) {
      throw new Error('继续生成题目与当前题组来源不一致');
    }
  }

  return {
    group: groups[0],
    items: items.map((item, offset) => ({
      ...item,
      index: startIndex + offset + 1,
      source: { ...expectedSource }
    })),
    answers: data.answers.map((answer, offset) => {
      const content = String(answer || '').replace(/^\d+\.\s*/, '').trim();
      if (!content) throw new Error('继续生成答案解析不能为空');
      return `${startIndex + offset + 1}. ${content}`;
    })
  };
}

module.exports = { CONTINUE_QUESTION_COUNT, buildContinuationAppendPlan, sourcesMatch };
