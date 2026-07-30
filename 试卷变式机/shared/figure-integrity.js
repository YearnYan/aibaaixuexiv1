const VISUAL_REFERENCE_PATTERNS = [
  /(?:如|见)(?:下|上|左|右)?(?:图|图形|图案|图片|插图|示意图|模型图|结构图|流程图|关系图|电路图|光路图|受力图|装置图|实验装置|地图|分布图|地形图|等高线图|剖面图|统计图|柱状图|折线图|饼图|曲线图|坐标图|函数图像|漫画|照片|表格)(?:\s*[A-Za-z0-9一二三四五六七八九十-]+)?(?:所示)?/u,
  /(?:根据|依据|观察|分析|结合|参照|阅读|读|看)\s*(?:下列|下面|上面|下方|上方|左侧|右侧|所给|给出)?(?:的)?(?:图|图形|图案|图片|插图|示意图|模型图|结构图|流程图|关系图|电路图|光路图|受力图|装置图|实验装置|地图|分布图|地形图|等高线图|剖面图|统计图|柱状图|折线图|饼图|曲线图|坐标图|函数图像|漫画|照片|表格)/u,
  /(?:根据|依据|观察|分析|结合|参照|阅读|读|看)\s*[^，。；：\n]{0,24}(?:下图|上图|左图|右图|图\s*[A-Za-z0-9一二三四五六七八九十]+|图形|图案|图片|插图|示意图|模型图|结构图|流程图|关系图|电路图|光路图|受力图|装置图|实验装置|地图|分布图|地形图|等高线图|剖面图|统计图|柱状图|折线图|饼图|曲线图|坐标图|漫画|照片|表格)/u,
  /(?:下列|下面|上面|下方|上方|左侧|右侧)(?:的)?(?:图|图形|图案|图片|插图|示意图|模型图|结构图|流程图|关系图|电路图|光路图|受力图|装置图|实验装置|地图|分布图|地形图|等高线图|剖面图|统计图|柱状图|折线图|饼图|曲线图|坐标图|函数图像|漫画|照片|表格)/u,
  /(?:图中|图示|由图|据图|读图|看图|识图|图表中|表中数据|漫画中|地图中|装置中)(?:所示|显示|给出|反映|可知|可见)?/u,
  /(?:^|[\s，。；：、（(])(?:图|表)\s*[A-Za-z0-9一二三四五六七八九十]+(?:[\s，。；：、）)]|$)/u,
  /(?:as\s+shown\s+in|according\s+to|based\s+on|refer(?:ring)?\s+to|look\s+at|study|observe|read)\s+(?:the\s+)?(?:following\s+|above\s+|below\s+|left\s+|right\s+)?(?:figure|diagram|graph|chart|map|table|picture|image)/iu,
  /(?:figure|fig\.?|diagram|graph|chart|map|table|picture|image)\s*[A-Za-z0-9]+\s*(?:shows?|below|above|illustrates?|indicates?)/iu,
];

const GENERIC_FIGURE_DESCRIPTION_PATTERN = /根据题干|根据题意|围绕当前题目|生成配图|所引用的配图|如需图形|在这里描述|必须与题意一致|必须与题干一致|图形要与题干一致|参考题干|参照题干|自行绘制|示意图即可|通用示意图|占位|兜底|见原图|参照原图|同原图|原试卷图|图略|略图/u;
const CONCRETE_DETAIL_PATTERN = /\d|[A-ZＡ-Ｚ甲乙丙丁戊己庚辛壬癸]|[①②③④⑤⑥⑦⑧⑨⑩]|[∠△⊙]|东|西|南|北|上|下|左|右|横轴|纵轴|坐标|刻度|图例|箭头|标签|标注|相连|连接|平行|垂直|相交|包含|指向|流向|边界|区域|节点|步骤|导管|开关|电源|透镜|光线|细胞|器官|年代|柱|折线|百分比/u;

const FIGURE_OUTPUT_RULE = `【跨学科题图完整性规则】
- 只要题干或选项出现“如图、下图、图中、图1、表1、地图、图表、实验装置、漫画、picture、diagram、chart、map、table”等视觉指代，就必须同时输出 figure。
- figure.description 必须让绘图器不查看原卷也能唯一还原新题所需信息：列出所有答题相关对象、标签、数值、单位、方向、位置、比例、坐标、刻度、图例、连接或包含关系。
- 数学与物理要写清点线角、坐标、力、光路、电路拓扑；化学与生物要写清装置、导管、结构层级和标签；地理与历史要写清区域、方向、图例、年代和箭头；语文、英语及其他学科的漫画、流程、表格、图片材料也要写清全部答题信息。
- 禁止使用“根据题干绘制、示意图即可、参照原图、同原图、图略”等无法独立还原的描述。
- 如果无法精确描述图形，必须把该题重写为完全自包含的文字或文本表格题，删除全部视觉指代和 figure，并重新验算答案与解析；绝不能保留一个没有图也无法作答的题干。`;

function itemText(item) {
  const parts = [String(item?.stem || '')];
  if (Array.isArray(item?.options)) parts.push(...item.options.map((option) => String(option || '')));
  return parts.join('\n');
}

function referencesVisualMaterial(item) {
  const text = itemText(item);
  return VISUAL_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

function isPreciseFigureDescription(description) {
  const text = String(description || '').replace(/\s+/gu, ' ').trim();
  if (!text || text.length < 12) return false;
  if (GENERIC_FIGURE_DESCRIPTION_PATTERN.test(text)) return false;
  return text.length >= 28 || CONCRETE_DETAIL_PATTERN.test(text);
}

function inferFigureType(text) {
  const value = String(text || '');
  if (/表格|数据表|table/iu.test(value)) return 'table';
  if (/统计图|柱状图|折线图|饼图|直方图|频数|graph|chart/iu.test(value)) return 'chart';
  if (/电路|电流|电压|电阻|开关|电源|串联|并联/iu.test(value)) return 'circuit';
  if (/受力|斜面|摩擦力|弹簧|滑块|力图|矢量/iu.test(value)) return 'force';
  if (/光路|透镜|折射|反射|入射光|凸透镜|凹透镜/iu.test(value)) return 'optics';
  if (/波形|波长|振动|波峰|波谷/iu.test(value)) return 'wave';
  if (/分子|原子|化学键|结构式/iu.test(value)) return 'molecule';
  if (/时间轴|年代|朝代|timeline/iu.test(value)) return 'timeline';
  if (/集合|交集|并集|维恩|venn/iu.test(value)) return 'venn';
  if (/数轴|区间|number\s*line/iu.test(value)) return 'numberline';
  if (/函数|抛物线|坐标|象限|coordinate/iu.test(value)) {
    return /坐标|象限|平面直角坐标系|coordinate/iu.test(value) ? 'coordinate' : 'function';
  }
  if (/三角形|四边形|正方形|长方形|圆|轴对称|中心对称|旋转|平移|几何|角|线段/iu.test(value)) return 'geometry';
  return 'diagram';
}

function normalizeFigureValue(figure, contextText = '') {
  if (!figure) return null;
  const source = typeof figure === 'string' ? { description: figure } : figure;
  if (!source || typeof source !== 'object') return null;
  const description = String(source.description || source.code || '').replace(/\s+/gu, ' ').trim();
  if (!isPreciseFigureDescription(description)) return null;
  const type = String(source.type || '').trim() || inferFigureType(`${contextText}\n${description}`);
  return { ...source, type, description };
}

function normalizeExamFigures(exam) {
  for (const group of Array.isArray(exam?.questions) ? exam.questions : []) {
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      if (!item) continue;
      const normalized = normalizeFigureValue(item.figure, itemText(item));
      if (normalized) item.figure = normalized;
      else delete item.figure;
    }
  }
  return exam;
}

function findFigureIntegrityIssues(exam) {
  const issues = [];
  for (const [groupIndex, group] of (Array.isArray(exam?.questions) ? exam.questions : []).entries()) {
    for (const [itemIndex, item] of (Array.isArray(group?.items) ? group.items : []).entries()) {
      if (!item || !referencesVisualMaterial(item)) continue;
      const normalized = normalizeFigureValue(item.figure, itemText(item));
      if (normalized) continue;
      issues.push({
        index: Number(item.index) || itemIndex + 1,
        groupIndex,
        itemIndex,
        groupType: String(group.type || ''),
        reason: item.figure ? 'figure_description_not_reproducible' : 'figure_missing',
        stem: String(item.stem || ''),
        options: Array.isArray(item.options) ? item.options : [],
        answer: item.answer,
        explanation: item.explanation,
      });
    }
  }
  return issues;
}

function getItemByIndex(exam, targetIndex) {
  for (const group of Array.isArray(exam?.questions) ? exam.questions : []) {
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      if (Number(item?.index) === Number(targetIndex)) return item;
    }
  }
  return null;
}

function applyFigureRepairs(exam, payload, issues) {
  const expected = new Set(issues.map((issue) => Number(issue.index)));
  const repairs = Array.isArray(payload?.repairs) ? payload.repairs : [];
  const applied = [];

  for (const repair of repairs) {
    const index = Number(repair?.index);
    const item = expected.has(index) ? getItemByIndex(exam, index) : null;
    if (!item) continue;

    const stem = String(repair.stem || '').trim();
    const answer = String(repair.answer ?? '').trim();
    const explanation = String(repair.explanation || '').trim();
    if (!stem || !answer || !explanation) continue;

    const hadOptions = Array.isArray(item.options) && item.options.length > 0;
    const options = Array.isArray(repair.options)
      ? repair.options.map((option) => String(option || '').trim()).filter(Boolean)
      : [];
    if (hadOptions && options.length < 2) continue;

    const candidate = { ...item, stem, answer, explanation };
    if (hadOptions) candidate.options = options;
    else if (options.length > 0) candidate.options = options;
    else delete candidate.options;

    const figure = normalizeFigureValue(repair.figure, itemText(candidate));
    if (figure) candidate.figure = figure;
    else delete candidate.figure;
    if (referencesVisualMaterial(candidate) && !candidate.figure) continue;

    Object.assign(item, candidate);
    if (!candidate.figure) delete item.figure;
    applied.push(index);
  }

  return applied;
}

function buildFigureRepairPrompts(exam, issues, context = {}, forceTextOnly = false) {
  const subject = String(context.subject || exam?.analysisSummary?.subject || '未明确科目');
  const grade = String(context.grade || exam?.analysisSummary?.gradeLevel || '未明确年级');
  const modeRule = forceTextOnly
    ? '本轮必须把所有问题题目改写为不依赖任何图片、地图、图表、装置或漫画的自包含题；figure 必须为 null，题干和选项中不得保留任何视觉指代。'
    : '每题优先补全可独立还原的 figure；如果无法保证图形信息完整，则改写为不依赖视觉材料的自包含题并令 figure 为 null。';
  const repairItems = issues.map((issue) => ({
    index: issue.index,
    groupType: issue.groupType,
    reason: issue.reason,
    stem: issue.stem,
    options: issue.options,
    answer: issue.answer,
    explanation: issue.explanation,
  }));

  const systemPrompt = `你是覆盖小学、初中、高中全部年级和全部学科的 K12 试题完整性修复专家。
你的任务只修复给定的问题题目，不得修改题号、题量、顺序、知识点、考点、目标难度和变式强度。
适用范围包括但不限于数学、物理、化学、生物、科学、地理、历史、语文、英语、政治/道德与法治、信息技术和综合实践。

${FIGURE_OUTPUT_RULE}

修复要求：
1. 题干、选项、答案、解析必须作为一个整体同步修正，确保条件充分、答案唯一或评分点明确、解析可复核。
2. 不得只删除“如图”两个字而保留依赖图中隐藏信息的残缺题。
3. 不得复制原卷题目或沿用与新题不一致的旧图数据。
4. ${modeRule}
5. 只返回 JSON，不返回 markdown 或解释。`;

  const userPrompt = `科目：${subject}
年级：${grade}
目标难度：${context.variantDifficulty ?? context.difficulty ?? '保持当前要求'}
变式系数：${context.variationCoefficient ?? '保持当前要求'}

请逐项修复以下题目：
${JSON.stringify(repairItems, null, 2)}

输出结构：
{
  "repairs": [
    {
      "index": 1,
      "stem": "完整新题题干",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "重新核验后的答案",
      "explanation": "完整解析",
      "figure": {
        "type": "geometry|function|coordinate|table|chart|circuit|force|optics|wave|molecule|timeline|venn|diagram",
        "description": "可独立、唯一还原图形的完整描述"
      }
    }
  ]
}

不需要图形时 figure 必须为 null。必须返回每个给定 index，不能新增其他 index。`;

  return {
    systemPrompt,
    userPrompt,
    maxTokens: Math.min(12000, Math.max(3000, 1200 + issues.length * 900)),
  };
}

async function repairExamFigureIntegrity(exam, options = {}) {
  const requestRepair = options.requestRepair;
  if (typeof requestRepair !== 'function') throw new TypeError('requestRepair 必须是函数');
  const parseRepair = typeof options.parseRepair === 'function' ? options.parseRepair : JSON.parse;
  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || 2));
  const repairedIndexes = new Set();
  const errors = [];

  normalizeExamFigures(exam);
  let issues = findFigureIntegrityIssues(exam);
  const initialIssueCount = issues.length;

  for (let attempt = 1; attempt <= maxAttempts && issues.length > 0; attempt += 1) {
    const forceTextOnly = attempt === maxAttempts;
    const prompts = buildFigureRepairPrompts(exam, issues, options.context, forceTextOnly);
    try {
      const raw = await requestRepair({ ...prompts, attempt, forceTextOnly, issues });
      const payload = typeof raw === 'string' ? parseRepair(raw) : raw;
      for (const index of applyFigureRepairs(exam, payload, issues)) repairedIndexes.add(index);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
    normalizeExamFigures(exam);
    issues = findFigureIntegrityIssues(exam);
  }

  if (issues.length > 0) {
    const indexes = issues.map((issue) => issue.index).join('、');
    const detail = errors.length > 0 ? `；修复请求异常：${errors.at(-1)}` : '';
    throw new Error(`第 ${indexes} 题的视觉材料未能补全或改写为自包含题${detail}`);
  }

  return {
    initialIssueCount,
    repairedIndexes: [...repairedIndexes].sort((a, b) => a - b),
  };
}

function assertExamFigureIntegrity(exam) {
  const issues = findFigureIntegrityIssues(exam);
  if (issues.length === 0) return;
  const indexes = issues.map((issue) => issue.index).join('、');
  throw new Error(`第 ${indexes} 题仍引用未提供的视觉材料`);
}

module.exports = {
  FIGURE_OUTPUT_RULE,
  referencesVisualMaterial,
  isPreciseFigureDescription,
  inferFigureType,
  normalizeFigureValue,
  normalizeExamFigures,
  findFigureIntegrityIssues,
  applyFigureRepairs,
  buildFigureRepairPrompts,
  repairExamFigureIntegrity,
  assertExamFigureIntegrity,
};
