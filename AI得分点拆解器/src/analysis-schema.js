const { AppError } = require("./errors");
const { normalizeReportAcademicText, truncateAcademicText } = require("./academic-content");

const CATEGORY_ORDER = [
  "answer_target",
  "core_conclusion",
  "key_evidence",
  "reasoning_steps",
  "keywords",
  "format",
];

const CATEGORY_LABELS = {
  answer_target: "答题对象",
  core_conclusion: "核心结论",
  key_evidence: "关键依据",
  reasoning_steps: "推理步骤",
  keywords: "关键词",
  format: "格式要求",
};

const CATEGORY_DEFAULT_GUIDANCE = {
  answer_target: {
    requirement: "明确题目要求回答的对象、范围和任务动词。",
    analysis: "先圈出题干中的作答对象与限定条件，后续结论和依据都必须围绕它展开。",
    suggestion: "写答案前先用一句话确认“回答谁、回答什么、回答到什么范围”。",
  },
  core_conclusion: {
    requirement: "给出能够直接回应题问的核心判断或结论。",
    analysis: "先形成明确结论，再补材料或计算过程，避免只有过程没有最终回答。",
    suggestion: "把核心结论放在答案开头或每个要点的首句。",
  },
  key_evidence: {
    requirement: "选取能够支撑结论的题干条件、材料信息、公式或事实。",
    analysis: "逐一核对结论依赖的已知条件，区分有效依据与无关信息。",
    suggestion: "在每个结论后补上对应条件、材料原句或公式来源。",
  },
  reasoning_steps: {
    requirement: "呈现从已知条件到结论的关键推导、计算或论证链。",
    analysis: "检查相邻步骤之间是否存在跳步，并说明每一步使用了什么条件或规律。",
    suggestion: "按“条件—方法—过程—结论”补齐中间推导。",
  },
  keywords: {
    requirement: "使用学科规范术语、关键概念和必要符号。",
    analysis: "对照题目所属知识点，检查表达是否准确、是否使用了阅卷可识别的术语。",
    suggestion: "把口语化表述替换为教材中的规范概念、公式符号或术语。",
  },
  format: {
    requirement: "满足题目要求的分点、单位、符号、书写和答案格式。",
    analysis: "完成内容后检查分点层次、单位、符号、答句和书写规范。",
    suggestion: "按题目要求整理分点，并补全单位、符号或完整答句。",
  },
};

const CATEGORY_FULL_SCORE_GUIDANCE = {
  answer_target: {
    analysis: "作答紧扣题目要求的对象与范围，答题方向准确。",
    suggestion: "继续保持先确认作答对象和限定范围，再组织答案的习惯。",
  },
  core_conclusion: {
    analysis: "核心结论明确，能够直接回应题目设问。",
    suggestion: "继续保持结论先行，并让后续依据始终围绕结论展开。",
  },
  key_evidence: {
    analysis: "所用条件、材料信息或事实能够有效支撑核心结论。",
    suggestion: "继续保持结论与依据一一对应，确保阅卷时能快速识别。",
  },
  reasoning_steps: {
    analysis: "推理过程完整，关键步骤之间衔接清楚，能够形成论证闭环。",
    suggestion: "继续保持步骤清晰，并在关键转折处写明所用条件或规律。",
  },
  keywords: {
    analysis: "学科术语和关键表达使用准确，满足本题阅卷识别要求。",
    suggestion: "继续保持规范术语表达，并确保关键词服务于结论和论证。",
  },
  format: {
    analysis: "分点、符号、单位或答句格式符合本题作答要求。",
    suggestion: "继续保持完成作答后复核分点、符号、单位和书写格式。",
  },
};

const STUDENT_WORK_ANALYSIS_FALLBACK = "请对照本维度的评分观察，核查现有作答是否完整、准确并形成闭环。";
const FULL_SCORE_CONFLICT_PATTERN = /未识别|未覆盖|缺失|缺少|待补|补充|尚未|遗漏|不足|不完整|完善|修改|改正|纠正|错误/;

const CATEGORY_SPECIFIC_GUIDANCE = {
  answer_target: {
    requirement: (cue) => `围绕题干“${cue}”锁定本题真正要求回答的对象、范围和任务动词。`,
    analysis: (cue) => `先把“${cue}”中的设问对象与限定条件单独标出，再判断后续内容是否始终围绕该对象。`,
    suggestion: (cue) => `作答前根据“${cue}”写出一句任务确认，明确本题回答对象、内容和范围。`,
  },
  core_conclusion: {
    requirement: (cue) => `根据“${cue}”确定本题最终需要形成的判断、数值、关系式或结论类型。`,
    analysis: (cue) => `结合“${cue}”先判断结论应回答原因、大小关系、计算结果、反应产物还是其他指定目标。`,
    suggestion: (cue) => `先用本题条件推出结论，再检查该结论能否直接回应“${cue}”中的设问。`,
  },
  key_evidence: {
    requirement: (cue) => `从“${cue}”中筛选能直接支撑结论的数据、材料语句、图示关系、实验现象或公式条件。`,
    analysis: (cue) => `逐项核对“${cue}”给出的数值、条件和图表信息，区分必要依据与干扰信息。`,
    suggestion: (cue) => `把从“${cue}”提取的每条有效条件分别对应到它所支撑的结论或计算步骤。`,
  },
  reasoning_steps: {
    requirement: (cue) => `围绕“${cue}”呈现从已知条件到结论所需的关键推导、计算、反应或论证链。`,
    analysis: (cue) => `按本题“${cue}”中的条件顺序建立中间关系，检查公式代入、单位换算或因果过渡是否完整。`,
    suggestion: (cue) => `使用本题实际数据和条件写出“已知条件—学科规律—中间过程—最终结论”的完整链条。`,
  },
  keywords: {
    requirement: (cue) => `针对“${cue}”所属知识点使用阅卷可识别的规范术语、符号、单位和学科表达。`,
    analysis: (cue) => `根据“${cue}”涉及的概念、物理量、化学物质、生命过程或地理要素核对专业表述。`,
    suggestion: (cue) => `把本题“${cue}”中的核心概念转换成教材规范术语，并让符号、上下标和单位保持一致。`,
  },
  format: {
    requirement: (cue) => `依据“${cue}”的题型要求检查分点、答句、公式、化学式、单位、图表或计算格式。`,
    analysis: (cue) => `完成本题后对照“${cue}”检查分点层次、公式定界、上下标、单位和最终答句。`,
    suggestion: (cue) => `按本题实际设问整理答案结构，并逐项复核符号、单位、化学式和结论格式。`,
  },
};

const STATUS_VALUES = ["covered", "partial", "missing", "pending", "compliant"];

// 只让模型提供必须由它判断的内容，其余字段统一由服务端计算。
const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questionPreview: { type: "string", minLength: 1, maxLength: 1200 },
    hasStudentWork: { type: "boolean" },
    requiresTeacherReview: { type: "boolean" },
    scorePoints: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: CATEGORY_ORDER },
          score: { type: "number", minimum: 0, maximum: 150 },
          status: { type: "string", enum: STATUS_VALUES },
          earnedScore: { type: "number", minimum: 0, maximum: 150 },
          evidence: { type: "string", maxLength: 600 },
          requirement: { type: "string", minLength: 1, maxLength: 500 },
          analysis: { type: "string", minLength: 1, maxLength: 800 },
          suggestion: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: [
          "category", "score", "status", "earnedScore", "evidence",
          "requirement", "analysis", "suggestion",
        ],
      },
    },
    revisionAdvice: { type: "string", minLength: 1, maxLength: 300 },
    reviewNote: { type: "string", minLength: 1, maxLength: 300 },
  },
  required: [
    "questionPreview",
    "hasStudentWork",
    "requiresTeacherReview",
    "scorePoints",
    "revisionAdvice",
    "reviewNote",
  ],
};

const CATEGORY_ALIASES = {
  answer_target: ["answer_target", "answertarget", "答题对象", "回答对象", "作答对象"],
  core_conclusion: ["core_conclusion", "coreconclusion", "核心结论", "主要结论"],
  key_evidence: ["key_evidence", "keyevidence", "关键依据", "材料依据", "证据"],
  reasoning_steps: ["reasoning_steps", "reasoningsteps", "推理步骤", "论证过程", "解题步骤"],
  keywords: ["keywords", "keyword", "关键词", "关键术语"],
  format: ["format", "format_requirement", "formatrequirement", "格式要求", "答题格式"],
};

const POINT_COLLECTION_KEYS = [
  "scorePoints", "score_points", "scoringPoints", "scoring_points", "points",
  "rubric", "rubricItems", "rubric_items", "criteria", "breakdown",
  "scoreBreakdown", "score_breakdown", "items", "得分点", "得分点列表",
  "得分项", "评分点", "评分项", "评分标准", "评分细则",
];

const POINT_LABEL_KEYS = [
  "category", "type", "label", "name", "title", "criterion", "criteriaName",
  "criteria_name", "pointName", "point_name", "inferredLabel", "类别", "类型",
  "名称", "得分点", "得分项", "评分项",
];

const POINT_SCORE_KEYS = [
  "score", "maxScore", "max_score", "points", "value", "分值", "满分", "分数",
];

const POINT_STATUS_KEYS = [
  "status", "coverageStatus", "coverage_status", "coverage", "状态", "覆盖状态",
];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstDefined(record, keys) {
  if (!isRecord(record)) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function asText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("；");
  return "";
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const matched = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return undefined;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "是", "需要"].includes(normalized)) return true;
    if (["false", "no", "0", "否", "不需要"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[\s_-]/g, "");
}

function normalizeCategory(value, index) {
  const text = asText(value);
  const token = normalizeToken(value);
  for (const [category, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some((alias) => {
      const aliasToken = normalizeToken(alias);
      return token === aliasToken || (/[\u4e00-\u9fff]/.test(alias) && text.includes(alias));
    })) return category;
  }
  return CATEGORY_ORDER[index] || null;
}

function normalizeStatus(value) {
  const text = asText(value).toLowerCase();
  const token = normalizeToken(value);
  if (!text) return undefined;
  if (["compliant", "符合", "已符合", "规范"].some((item) => text.includes(item))) return "compliant";
  if (["missing", "uncovered", "notcovered", "缺失", "未覆盖", "缺少"].some((item) => token.includes(normalizeToken(item)))) return "missing";
  if (["covered", "complete", "satisfied", "已覆盖", "已获得", "命中", "完整"].some((item) => text.includes(item))) return "covered";
  if (["partial", "部分", "待补充", "不完整"].some((item) => text.includes(item))) return "partial";
  if (["pending", "待分析", "待评分"].some((item) => text.includes(item))) return "pending";
  return undefined;
}

function toPointArray(value) {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, point]) => (
    isRecord(point) ? { inferredLabel: key, ...point } : { inferredLabel: key, score: point }
  ));
}

function pointCollectionConfidence(value, hinted = false) {
  const points = toPointArray(value);
  if (points.length === 0 || points.length > 12) return -1;

  let recognizedCategories = 0;
  let labels = 0;
  let scores = 0;
  let semanticFields = 0;

  for (const rawPoint of points) {
    const point = isRecord(rawPoint) ? rawPoint : { label: rawPoint };
    const label = firstDefined(point, POINT_LABEL_KEYS);
    if (asText(label)) labels += 1;
    if (normalizeCategory(label, -1)) recognizedCategories += 1;
    if (asNumber(firstDefined(point, POINT_SCORE_KEYS)) !== undefined) scores += 1;
    if (normalizeStatus(firstDefined(point, POINT_STATUS_KEYS))
      || firstDefined(point, [
        "evidence", "requirement", "analysis", "suggestion", "依据", "评分要求", "分析", "建议",
      ]) !== undefined) {
      semanticFields += 1;
    }
  }

  const majority = Math.ceil(points.length / 2);
  const categoryMatch = recognizedCategories > 0;
  const rubricShape = points.length >= 2 && labels >= majority && scores >= majority;
  const semanticShape = rubricShape && (hinted || semanticFields > 0 || points.length >= 5);
  if (!categoryMatch && !semanticShape) return -1;

  return (hinted ? 20 : 0)
    + recognizedCategories * 8
    + labels * 2
    + scores * 3
    + semanticFields;
}

// 兼容代理服务额外包裹结果或改写集合键名，同时限制搜索深度和候选规模。
function findPointCollection(root) {
  if (!isRecord(root) && !Array.isArray(root)) return undefined;

  const queue = [{ value: root, depth: 0 }];
  let visited = 0;
  let best;

  while (queue.length > 0 && visited < 200) {
    const { value, depth } = queue.shift();
    visited += 1;

    if (Array.isArray(value)) {
      const confidence = pointCollectionConfidence(value);
      if (confidence >= 0 && (!best || confidence > best.confidence)) {
        best = { value, confidence };
      }
      if (depth < 6) {
        for (const item of value) {
          if (isRecord(item) || Array.isArray(item)) queue.push({ value: item, depth: depth + 1 });
        }
      }
      continue;
    }

    for (const [key, child] of Object.entries(value)) {
      const hinted = POINT_COLLECTION_KEYS.includes(key)
        || /(?:score|point|rubric|criteria|breakdown|得分|评分)/i.test(key);
      const confidence = pointCollectionConfidence(child, hinted);
      if (confidence >= 0 && (!best || confidence > best.confidence)) {
        best = { value: child, confidence };
      }
      if (depth < 6 && (isRecord(child) || Array.isArray(child))) {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }

  return best?.value;
}

function unwrapReport(value) {
  if (Array.isArray(value)) return { scorePoints: value };
  if (!isRecord(value)) return null;
  if (Array.isArray(value.data)) return { ...value, scorePoints: value.data };
  if (Array.isArray(value.result)) return { ...value, scorePoints: value.result };

  const candidates = [
    value.report,
    value.data?.report,
    value.data,
    value.result,
    value.analysis,
    value,
  ].filter((candidate) => isRecord(candidate));

  return candidates.find((candidate) => findPointCollection(candidate) !== undefined)
    || candidates[0]
    || null;
}

function normalizePoint(rawPoint, index) {
  const point = isRecord(rawPoint) ? rawPoint : { label: rawPoint };
  const label = firstDefined(point, POINT_LABEL_KEYS);
  const category = normalizeCategory(label, index);
  if (!category) return null;

  const score = Math.max(0, asNumber(firstDefined(point, POINT_SCORE_KEYS)) ?? 0);

  let status = normalizeStatus(firstDefined(point, POINT_STATUS_KEYS));

  if (!status) {
    const covered = firstDefined(point, ["covered", "isCovered", "is_covered", "是否覆盖"]);
    if (covered !== undefined) status = asBoolean(covered, false) ? "covered" : "missing";
  }

  let earnedScore = asNumber(firstDefined(point, [
    "earnedScore",
    "earned_score",
    "earned",
    "scoreObtained",
    "score_obtained",
    "obtainedScore",
    "obtained_score",
    "已得分",
    "获得分数",
    "得分",
  ]));

  if (earnedScore === undefined) {
    if (["covered", "compliant"].includes(status)) earnedScore = score;
    else if (status === "partial") earnedScore = score / 2;
    else earnedScore = 0;
  }

  return {
    id: asText(firstDefined(point, ["id", "序号"])) || String(index + 1),
    category,
    label: CATEGORY_LABELS[category],
    score,
    status: status || "missing",
    earnedScore: Math.min(score || earnedScore, Math.max(0, earnedScore)),
    evidence: asText(firstDefined(point, [
      "evidence",
      "matchedText",
      "matched_text",
      "studentEvidence",
      "student_evidence",
      "依据",
      "命中内容",
      "学生原文",
    ])),
    requirement: asText(firstDefined(point, [
      "requirement",
      "criterionDescription",
      "criterion_description",
      "scoringRequirement",
      "scoring_requirement",
      "评分要求",
      "评分观察",
      "考查要求",
      "得分条件",
    ])),
    analysis: asText(firstDefined(point, [
      "analysis",
      "diagnosis",
      "diagnosticAnalysis",
      "diagnostic_analysis",
      "解析",
      "分析",
      "诊断",
      "作答分析",
      "解题指导",
    ])),
    suggestion: asText(firstDefined(point, [
      "suggestion",
      "guidance",
      "improvement",
      "advice",
      "revision",
      "修改建议",
      "建议",
      "补充方向",
      "提分动作",
      "解题建议",
    ])),
  };
}

function roundTenth(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function allocateScores(points, totalScore) {
  const units = Math.round(totalScore * 10);
  const weights = points.map((point) => Math.max(0, Number(point.score) || 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const exact = weightTotal > 0
    ? weights.map((weight) => (weight / weightTotal) * units)
    : weights.map(() => units / points.length);
  const allocated = exact.map(Math.floor);
  let remainder = units - allocated.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let cursor = 0; remainder > 0; cursor += 1) {
    allocated[order[cursor % order.length].index] += 1;
    remainder -= 1;
  }

  return allocated.map((value) => value / 10);
}

function statusFromScore(category, score, earnedScore, modelStatus) {
  if (score === 0) {
    if (["missing", "partial", "covered", "compliant"].includes(modelStatus)) return modelStatus;
    return category === "format" ? "compliant" : "covered";
  }
  if (earnedScore <= 0) return "missing";
  if (earnedScore >= score) return category === "format" ? "compliant" : "covered";
  return "partial";
}

function conflictsWithFullScore(value) {
  return FULL_SCORE_CONFLICT_PATTERN.test(asText(value));
}

function questionCue(questionPreview) {
  const compact = questionPreview.replace(/\s+/g, " ").trim();
  if (compact.length <= 90) return compact;
  let clipped = compact.slice(0, 90);
  [["\\(", "\\)"], ["\\[", "\\]"]].forEach(([left, right]) => {
    if (clipped.lastIndexOf(left) > clipped.lastIndexOf(right)) {
      clipped = clipped.slice(0, clipped.lastIndexOf(left)).trim();
    }
  });
  return `${clipped || compact.slice(0, 60)}…`;
}

function guidanceText(genericText, specificText, fallbackFactory, questionPreview) {
  const specific = String(specificText || "").trim();
  if (specific.includes("通用方法：") && specific.includes("本题应用：")) return specific;
  const contextual = specific && specific !== genericText
    ? specific.replace(/^(?:本题应用|本题具体)[：:]\s*/, "")
    : fallbackFactory(questionCue(questionPreview));
  return `通用方法：${genericText}\n本题应用：${contextual}`;
}

function parseAndNormalizeReport(value, { totalScore, hasStudentAnswer }) {
  const report = unwrapReport(value);
  const rawPoints = toPointArray(findPointCollection(report));
  const normalizedPoints = rawPoints.slice(0, 12).map(normalizePoint).filter(Boolean);

  if (normalizedPoints.length === 0) {
    throw new AppError(
      "AI_RESPONSE_INVALID",
      "AI 未返回可用的得分点，请重试；若持续失败请在配置页切换模型",
      502,
    );
  }

  const byCategory = new Map();
  for (const point of normalizedPoints) {
    if (!byCategory.has(point.category)) byCategory.set(point.category, point);
  }

  const modelDetectedStudentWork = asBoolean(firstDefined(report, [
    "hasStudentWork",
    "has_student_work",
    "hasStudentAnswer",
    "has_student_answer",
    "detectedStudentWork",
    "detected_student_work",
    "存在学生作答",
    "检测到学生作答",
  ]), false);
  const hasStudentWork = Boolean(hasStudentAnswer || modelDetectedStudentWork);
  const studentWorkSource = hasStudentAnswer
    ? "answer_file"
    : modelDetectedStudentWork ? "question_file" : "none";
  const questionPreview = truncateAcademicText(asText(firstDefined(report, [
    "questionPreview",
    "question_preview",
    "question",
    "problem",
    "题目预览",
    "题目",
    "题干",
  ])) || "题目资料已读取，请结合原文件查看完整题干。", 1200);

  const ordered = CATEGORY_ORDER.map((category, index) => byCategory.get(category) || {
    id: String(index + 1),
    category,
    label: CATEGORY_LABELS[category],
    score: 0,
    status: hasStudentWork ? "missing" : "pending",
    earnedScore: 0,
    evidence: "",
    requirement: "",
    analysis: "",
    suggestion: "",
  });

  const normalizedScores = allocateScores(ordered, totalScore);
  const normalizedScorePoints = ordered.map((point, index) => {
    const score = normalizedScores[index];
    const defaults = CATEGORY_DEFAULT_GUIDANCE[point.category];
    const ratio = point.score > 0
      ? Math.min(1, Math.max(0, point.earnedScore / point.score))
      : ["covered", "compliant"].includes(point.status)
        ? 1
        : point.status === "partial" ? 0.5 : 0;
    const earnedScore = hasStudentWork ? Math.min(score, roundTenth(score * ratio)) : 0;
    const specificGuidance = CATEGORY_SPECIFIC_GUIDANCE[point.category];
    return {
      id: String(index + 1).padStart(2, "0"),
      category: point.category,
      label: CATEGORY_LABELS[point.category],
      score,
      status: hasStudentWork
        ? statusFromScore(point.category, score, earnedScore, point.status)
        : "pending",
      earnedScore,
      evidence: hasStudentWork ? truncateAcademicText(point.evidence, 600) : "",
      requirement: hasStudentWork
        ? truncateAcademicText(point.requirement || defaults.requirement, 700)
        : truncateAcademicText(guidanceText(defaults.requirement, point.requirement, specificGuidance.requirement, questionPreview), 700),
      analysis: hasStudentWork
        ? truncateAcademicText(point.analysis || STUDENT_WORK_ANALYSIS_FALLBACK, 1000)
        : truncateAcademicText(guidanceText(defaults.analysis, point.analysis, specificGuidance.analysis, questionPreview), 1000),
      suggestion: hasStudentWork
        ? truncateAcademicText(point.suggestion || defaults.suggestion, 700)
        : truncateAcademicText(guidanceText(defaults.suggestion, point.suggestion, specificGuidance.suggestion, questionPreview), 700),
    };
  });

  const earnedScore = roundTenth(normalizedScorePoints.reduce((sum, point) => sum + point.earnedScore, 0));
  const missingScore = roundTenth(Math.max(0, totalScore - earnedScore));
  const allDimensionsCovered = normalizedScorePoints.every((point) => (
    ["covered", "compliant"].includes(point.status)
  ));
  const resultState = !hasStudentWork
    ? "guidance"
    : missingScore === 0 && allDimensionsCovered ? "full_score" : "needs_improvement";
  const scorePoints = normalizedScorePoints.map((point) => {
    if (resultState !== "full_score" || !["covered", "compliant"].includes(point.status)) {
      return point;
    }

    const fullScoreGuidance = CATEGORY_FULL_SCORE_GUIDANCE[point.category];
    return {
      ...point,
      analysis: truncateAcademicText(point.analysis === STUDENT_WORK_ANALYSIS_FALLBACK || conflictsWithFullScore(point.analysis)
        ? fullScoreGuidance.analysis
        : point.analysis, 1000),
      suggestion: truncateAcademicText(conflictsWithFullScore(point.suggestion)
        ? fullScoreGuidance.suggestion
        : point.suggestion, 700),
    };
  });
  const fallbackAdvice = ordered.map((point) => point.suggestion).filter(Boolean).slice(0, 2).join("；")
    || (hasStudentWork
      ? "请根据未覆盖的得分点补充原答案"
      : "先明确答题对象与核心结论，再按关键依据和推理步骤组织答案");
  const reportedAdvice = asText(firstDefined(report, [
    "revisionAdvice",
    "revision_advice",
    "advice",
    "修改建议",
  ]));
  const revisionAdvice = resultState === "full_score"
    ? "六个得分维度均达到要求，继续保持结论明确、依据充分、推理完整和书写规范。"
    : (reportedAdvice || fallbackAdvice);
  const reportedReviewNote = asText(firstDefined(report, [
    "reviewNote",
    "review_note",
    "teacherNote",
    "teacher_note",
    "复核说明",
    "教师复核",
  ]));
  const fallbackReviewNote = hasStudentWork
    ? "AI 评分仅供参考，请教师结合实际评分标准复核"
    : "解题指导基于题目与常见评分要求生成，请教师结合实际题型复核";
  const reviewNote = resultState === "full_score" && conflictsWithFullScore(reportedReviewNote)
    ? "AI 分析显示六个维度均已达到得分要求，请教师结合原卷确认识别与评分标准"
    : (reportedReviewNote || fallbackReviewNote);

  return normalizeReportAcademicText({
    questionPreview,
    totalScore,
    earnedScore,
    missingScore,
    hasStudentWork,
    hasStudentAnswer: hasStudentWork,
    studentWorkSource,
    resultState,
    requiresTeacherReview: asBoolean(firstDefined(report, [
      "requiresTeacherReview",
      "requires_teacher_review",
      "teacherReviewRequired",
      "teacher_review_required",
      "需要教师复核",
    ]), true),
    scorePoints,
    revisionAdvice: truncateAcademicText(revisionAdvice, 160),
    reviewNote: truncateAcademicText(reviewNote, 160),
  });
}

module.exports = {
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  analysisJsonSchema,
  parseAndNormalizeReport,
};
