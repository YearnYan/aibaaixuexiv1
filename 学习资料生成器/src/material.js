import { cleanSingleLine, cleanText } from "./utils.js";
import { MAX_TEACHING_FIGURES, normalizeTeachingFigures } from "./figures.js";

const CORE_CONTENT_LIMITS = Object.freeze({
  sourceAtoms: 4,
  goals: 3,
  knowledgeNodesMinimum: 6,
  knowledgeNodes: 32,
  keyPoints: 3,
  strategyCards: 3,
  workedExamples: 2,
  closeReading: 2,
  conceptsMinimum: 4,
  concepts: 6,
  knowledgeDiagramsMinimum: 2,
  knowledgeDiagrams: 2,
  teachingFigures: MAX_TEACHING_FIGURES,
  visuals: 2,
  mistakesMinimum: 3,
  mistakes: 4,
  practice: 4,
  masteryChecks: 3,
  reviewPlan: 4
});

const CORE_TEXT_LIMITS = Object.freeze({
  goal: 36,
  pointTitle: 18,
  pointExplanation: 120,
  pointRule: 55,
  exampleTitle: 24,
  exampleText: 100,
  exampleStep: 55,
  practiceQuestion: 90,
  practiceText: 120,
  masteryTask: 90,
  masteryText: 80,
  routeFocus: 36,
  routeAction: 70,
  routeProof: 60
});

// 标题只保留知识主题，去掉为了包装资料而附加的名称。
const TITLE_PACKAGING_SUFFIX = /(?:\s*[·—–\-|｜:：]\s*)?(?:AI\s*)?(?:(?:学习|复习|课程|课堂)?(?:指南|讲义|工作页|任务单|资料册|资料包|手册)|(?:学习|复习)资料)\s*$/iu;
const TITLE_PACKAGING_PREFIX = /^(?:\s*(?:AI\s*)?(?:(?:学习|复习|课程|课堂)?(?:指南|讲义|工作页|任务单|资料册|资料包|手册)|(?:学习|复习)资料)\s*(?:[·—–\-|｜:：]\s*)?)+/iu;
const TITLE_BRACKETED_PACKAGING_SUFFIX = /\s*(?:（|\(|【|\[)\s*(?:AI\s*)?(?:(?:学习|复习|课程|课堂)?(?:指南|讲义|工作页|任务单|资料册|资料包|手册)|(?:学习|复习)资料)\s*(?:）|\)|】|\])\s*$/iu;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const KNOWLEDGE_SCOPE_TYPES = new Set(["closed", "open", "single"]);
const DEFAULT_COVERAGE_DIMENSIONS = Object.freeze([
  "定义与边界",
  "完整分类",
  "核心规则",
  "典型成员",
  "特殊情况",
  "易混与应用"
]);
const DEFAULT_KNOWLEDGE_NODES = Object.freeze([
  { label: "定义与边界", detail: "先说清它是什么、研究什么，以及哪些内容不属于这个知识点。", members: [] },
  { label: "组成与分类", detail: "列出完整主流分类，避免只选择少数例子代替整体框架。", members: [] },
  { label: "核心规则", detail: "说明各部分怎样判断、怎样变化，以及彼此之间怎样连接。", members: [] },
  { label: "识别线索", detail: "给出题目、材料或真实情境中可以直接观察到的判断信号。", members: [] },
  { label: "典型应用", detail: "展示知识在基础题、综合题或真实任务中的常见用法。", members: [] },
  { label: "例外与易混", detail: "列出不能直接套用的情况、特殊规则和相近概念的区别。", members: [] }
]);

function normalizeKnowledgeScopeType(value, nodes = []) {
  const normalized = cleanSingleLine(value, 20).toLowerCase();
  if (KNOWLEDGE_SCOPE_TYPES.has(normalized)) return normalized;
  return asArray(nodes).length >= 12 ? "closed" : "single";
}

function ensureKnowledgeNodeMinimum(nodes, minimum = CORE_CONTENT_LIMITS.knowledgeNodesMinimum) {
  const result = asArray(nodes).map((item) => ({ ...item }));
  const labels = new Set(result.map((item) => cleanSingleLine(item?.label, 40)).filter(Boolean));

  DEFAULT_KNOWLEDGE_NODES.forEach((fallback) => {
    if (result.length >= minimum || labels.has(fallback.label)) return;
    result.push({ ...fallback, members: [...fallback.members] });
    labels.add(fallback.label);
  });
  return result;
}

function defaultCoverageSummary(scopeType, nodes) {
  const nodeCount = asArray(nodes).length;
  const memberCount = asArray(nodes).reduce((total, node) => total + asArray(node?.members).length, 0);
  if (scopeType === "closed") return `按标准体系完整列出 ${nodeCount} 个组成单元，并说明关键规则与例外。`;
  if (scopeType === "open") return `覆盖 ${nodeCount} 个主流分类${memberCount ? `、${memberCount} 个常用成员` : ""}；超纲或冷僻内容会明确标出边界。`;
  return `从定义、组成、原理、条件、应用和易混点 ${nodeCount} 个角度完整讲解。`;
}

function verifiedCoverageSummary(scopeType, nodes, providedSummary) {
  const nodeCount = asArray(nodes).length;
  const memberCount = new Set(
    asArray(nodes).flatMap((node) => asArray(node?.members))
      .map((item) => cleanSingleLine(item, 60).toLowerCase())
      .filter(Boolean)
  ).size;
  const provided = cleanText(providedSummary, 260);
  const boundary = provided.match(/(?:冷僻|古旧|超纲|不逐条展开)[^。；]*[。；]?/u)?.[0] || "";

  if (scopeType === "open") {
    return `当前讲义覆盖 ${nodeCount} 个主流分类${memberCount ? `、${memberCount} 个常用成员` : ""}。${boundary || "冷僻或明显超纲内容不逐条展开。"}`;
  }
  if (scopeType === "closed") return `当前讲义按标准体系列出 ${nodeCount} 个组成单元，并同步讲解规则、例外与应用。`;
  return provided || defaultCoverageSummary(scopeType, nodes);
}

function replaceSelfStudyWording(value) {
  return String(value ?? "").replaceAll("自学", "学习");
}

function cleanGeneratedWording(value, { preserveWhitespace = false } = {}) {
  const cleaned = replaceSelfStudyWording(value)
    .replace(/[【\[]\s*补充讲解\s*[】\]]/gu, "")
    .replace(/补充讲解[：:]?/gu, "");
  if (preserveWhitespace) return cleaned.trim();
  return cleaned.replace(/[ \t]{2,}/gu, " ").replace(/^\s*[：:]\s*/gmu, "").trim();
}

function cleanAsciiDiagram(value, maxLength = 4_000) {
  return cleanGeneratedWording(
    String(value ?? "")
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>/gu, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "")
      .replace(/\r\n?/gu, "\n")
      .replace(/\n{4,}/gu, "\n\n\n"),
    { preserveWhitespace: true }
  ).slice(0, maxLength);
}

function trimTitleDecorations(value) {
  return String(value ?? "")
    .replace(/^[\s·—–\-|｜:：]+|[\s·—–\-|｜:：]+$/gu, "")
    .trim();
}

function unwrapTitleQuotes(value) {
  const title = String(value ?? "").trim();
  const matched = title.match(/^《\s*(.+?)\s*》$/u);
  return matched ? matched[1] : title;
}

function stripTitlePackaging(value) {
  let title = trimTitleDecorations(unwrapTitleQuotes(replaceSelfStudyWording(value)));
  let previous = "";

  while (title && title !== previous) {
    previous = title;
    const stripped = title
      .replace(TITLE_BRACKETED_PACKAGING_SUFFIX, "")
      .replace(TITLE_PACKAGING_SUFFIX, "")
      .replace(TITLE_PACKAGING_PREFIX, "");
    title = trimTitleDecorations(unwrapTitleQuotes(stripped));
  }

  return title;
}

function sanitizeMaterialTitle(value, fallback = "学习主题") {
  const title = stripTitlePackaging(value);
  if (title) return cleanSingleLine(title, 80);

  const fallbackTitle = stripTitlePackaging(fallback);
  return cleanSingleLine(fallbackTitle || "学习主题", 80);
}

// AI 输出和模板文案都经过同一层清洗，避免页面、导出内容出现不一致的旧表述。
function sanitizeMaterialCopy(material) {
  const visit = (value, path = []) => {
    if (typeof value === "string") {
      const isVerbatimSourceText = path.length === 3
        && path[0] === "sourceAtoms"
        && path[2] === "text";
      if (isVerbatimSourceText) return value;

      const text = cleanGeneratedWording(value);
      const isMetaTitle = path.length === 2 && path[0] === "meta" && path[1] === "title";
      return isMetaTitle ? sanitizeMaterialTitle(text) : text;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => visit(item, [...path, index]));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])])
      );
    }

    return value;
  };

  return visit(material);
}

function limitedItems(items, fallback, minimum, maximum, mapper) {
  const source = asArray(items).slice(0, maximum);
  let fallbackIndex = 0;
  while (source.length < minimum && fallback.length) {
    source.push(fallback[fallbackIndex % fallback.length]);
    fallbackIndex += 1;
  }
  const mapped = source.map(mapper).filter(Boolean);
  while (mapped.length < minimum) {
    mapped.push(mapper(fallback[mapped.length % fallback.length], mapped.length));
  }
  return mapped;
}

function deriveTitle(sources) {
  const text = sources.map((source) => source.text).filter(Boolean).join("\n");
  const firstLine = text
    .split(/\n+/)
    .map((line) => cleanSingleLine(line, 50))
    .find((line) => line.length >= 2 && line.length <= 32);

  if (firstLine) {
    const normalizedFirstLine = firstLine.replace(/^[第\s]*\d+[章节课、.．]*/u, "") || firstLine;
    return sanitizeMaterialTitle(normalizedFirstLine);
  }
  const filename = sources[0]?.name?.replace(/\.[^.]+$/, "");
  const quotedTitle = filename?.match(/《([^》]+)》/u)?.[1];
  return sanitizeMaterialTitle(quotedTitle || filename, "学习主题");
}

function deriveExcerpts(sources) {
  const text = sources.map((source) => source.text).filter(Boolean).join("\n");
  const candidates = text
    .split(/(?<=[。！？；])|\n+/u)
    .map((item) => cleanSingleLine(item, 180))
    .filter((item) => item.length >= 2);
  return candidates.slice(0, 5);
}

const EXPLICIT_SUBJECT_RULES = [
  ["语文", /语文/u],
  ["数学", /数学/u],
  ["英语", /英语|英文/u],
  ["物理", /物理/u],
  ["化学", /化学/u],
  ["生物", /生物/u],
  ["历史", /历史/u],
  ["地理", /地理/u],
  ["道德与法治", /道德与法治|道法|政治/u]
];

const SUBJECT_FEATURE_RULES = [
  ["数学", /方程|函数|几何|概率|分数|代数|数列|导数|向量|三角形|圆/u],
  ["英语", /\b(?:grammar|vocabulary|tense|pronoun|preposition|english)\b|单词|语法|时态|介词|英语阅读/iu],
  ["物理", /力学|电路|电流|电压|光学|声学|牛顿|机械能|压强|浮力/u],
  ["化学", /元素|化合物|化学反应|化学方程式|酸碱盐|氧化还原/u],
  ["生物", /细胞|分子|生态|遗传|基因|光合作用|呼吸作用/u],
  ["历史", /朝代|年代|历史事件|改革|战争|文明演变/u],
  ["地理", /气候|人口|地形|经纬度|板块|洋流|区域地理/u],
  ["道德与法治", /法律|法治|道德|权利|义务|公民|宪法/u],
  ["语文", /作文|阅读理解|文言文|古诗|诗词|修辞|病句|议论文|记叙文|说明文|小说|散文/u]
];

export function inferSubject(text, requestedSubject) {
  if (requestedSubject && requestedSubject !== "自动识别") return requestedSubject;
  const content = cleanText(text, 20_000);
  const explicitMatches = EXPLICIT_SUBJECT_RULES
    .map(([subject, pattern], priority) => {
      const match = pattern.exec(content);
      return match ? { subject, index: match.index, priority } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index || left.priority - right.priority);
  if (explicitMatches.length) return explicitMatches[0].subject;

  const featureMatch = SUBJECT_FEATURE_RULES.find(([, pattern]) => pattern.test(content));
  if (featureMatch) return featureMatch[0];
  return "语文";
}

function getSubjectGroup(subject) {
  if (/数学|物理|化学|生物|科学|理科/u.test(subject)) return "science";
  if (/英语|英文/u.test(subject)) return "english";
  return "humanities";
}

function classifySourceAtom(text, subjectGroup) {
  if (subjectGroup === "science") {
    if (/常见错误|易错|误用|混淆|漏掉/u.test(text)) return "mistake";
    if (/不能|不成立|例外|边界|极值|等号|零值/u.test(text)) return "boundary";
    if (/定义|叫做|是指|称为/u.test(text)) return "definition";
    if (/当|若|如果|只有|必须|条件|范围|大于|小于|至少|至多|正|负/u.test(text)) return "condition";
    if (/[=<>≤≥≠≈]/u.test(text)) return "formula";
    if (/求|解|证明|步骤|先|再|代入|检验/u.test(text)) return "method";
    return "relation";
  }

  if (subjectGroup === "english") {
    if (/[A-Za-z]/u.test(text) && /\b(?:be|do|have|to|in|on|at|for|with|if|when)\b/iu.test(text)) return "expression";
    if (/语法|时态|词性|搭配|从句|句型|被动/u.test(text)) return "grammar";
    if (/语境|人物|时间|态度|指代|连接词/u.test(text)) return "context";
    return "usage";
  }

  if (/因为|所以|因此|导致|表明|说明|体现|反映|由此/u.test(text)) return "relation";
  if (/观点|主张|认为|主题|意义|作用/u.test(text)) return "claim";
  if (/人物|事件|材料|事实|数据|原文|描写/u.test(text)) return "evidence";
  if (/[=<>≤≥≠≈]/u.test(text)) return "formula";
  return "fact";
}

function getAtomLabel(kind, text) {
  const labels = {
    formula: "公式或关系",
    definition: "概念定义",
    condition: "适用条件",
    boundary: "条件边界",
    method: "方法步骤",
    mistake: "易错提醒",
    relation: "因果或推理关系",
    expression: "核心表达",
    grammar: "语法与搭配",
    context: "语境线索",
    usage: "用法线索",
    claim: "核心观点",
    evidence: "事实证据",
    fact: "关键事实"
  };
  const summary = cleanSingleLine(text, 20);
  return `${labels[kind] || "资料要点"}：${summary}`;
}

function scoreSourceAtom(atom, subjectGroup) {
  const kindScores = subjectGroup === "science"
    ? { formula: 9, condition: 8, definition: 7, boundary: 7, mistake: 7, method: 6, relation: 5 }
    : subjectGroup === "english"
      ? { expression: 9, grammar: 8, context: 7, usage: 6 }
      : { claim: 9, evidence: 8, relation: 7, fact: 6 };
  return (kindScores[atom.kind] || 4) + Math.min(atom.text.length / 80, 2);
}

function splitSourceFragments(text) {
  const normalized = cleanText(text, 12_000);
  if (!normalized) return [];

  const primary = normalized
    .split(/(?<=[。！？；])|\n+/u)
    .map((fragment) => cleanSingleLine(fragment, 260))
    .filter((fragment) => fragment.length >= 2);

  if (primary.length >= 3) return primary.slice(0, 18);

  const clauses = normalized
    .split(/[：:，、；;\n]+/u)
    .map((fragment) => cleanSingleLine(fragment, 220))
    .filter((fragment) => fragment.length >= 2);
  return [...primary, ...clauses].slice(0, 18);
}

export function extractSourceAtoms(sources = [], subject = "语文") {
  const subjectGroup = getSubjectGroup(subject);
  const candidates = [];
  const seen = new Set();

  sources.forEach((source, sourceIndex) => {
    const sourceName = cleanSingleLine(source?.name, 80) || `资料 ${sourceIndex + 1}`;
    splitSourceFragments(source?.text).forEach((text, fragmentIndex) => {
      const fingerprint = text.replace(/\s+/gu, "").toLowerCase();
      if (!fingerprint || seen.has(fingerprint)) return;
      seen.add(fingerprint);
      const kind = classifySourceAtom(text, subjectGroup);
      candidates.push({
        id: `S${sourceIndex + 1}-${fragmentIndex + 1}`,
        sourceName,
        text,
        label: getAtomLabel(kind, text),
        kind,
        score: scoreSourceAtom({ text, kind }, subjectGroup),
        order: candidates.length
      });
    });
  });

  if (!candidates.length) {
    return [{
      id: "S0",
      sourceName: "未提供资料",
      text: "当前仅能生成学习框架；补充定义、例题或原文后可得到更贴合资料的讲解。",
      label: "资料待补充",
      kind: "notice"
    }];
  }

  const selected = [];
  const selectedKinds = new Set();
  const ranked = [...candidates].sort((left, right) => right.score - left.score || left.order - right.order);
  ranked.forEach((atom) => {
    if (selected.length >= CORE_CONTENT_LIMITS.sourceAtoms) return;
    if (!selectedKinds.has(atom.kind) || selected.length < 3) {
      selected.push(atom);
      selectedKinds.add(atom.kind);
    }
  });
  ranked.forEach((atom) => {
    if (selected.length >= CORE_CONTENT_LIMITS.sourceAtoms || selected.some((item) => item.id === atom.id)) return;
    selected.push(atom);
  });

  return selected
    .sort((left, right) => left.order - right.order)
    .map(({ score, order, ...atom }) => atom);
}

function sourceEvidenceStatus(sourceAtoms) {
  const usableAtoms = sourceAtoms.filter((atom) => atom.id !== "S0");
  if (usableAtoms.length >= 3) {
    return {
      status: "ready",
      message: "本讲义的重点、例题和练习都应回到下方资料证据，不靠泛化结论记忆。"
    };
  }
  return {
    status: "thin",
    message: "当前资料更像主题提示。AI 会补充基础讲解；再加入定义、例题、条件或错题，可得到更贴合你的判断与练习。"
  };
}

function createFastLearningModules({ title, subject }) {
  const isScience = /数学|物理|化学|生物|科学|理科/u.test(subject);
  const isEnglish = /英语|英文/u.test(subject);

  if (isScience) {
    return {
      quickStart: {
        prerequisites: [
          { topic: "概念与符号", check: "用一句话说出本节核心量或概念分别表示什么。" },
          { topic: "已知与未知", check: "从资料中任选一个问题，圈出条件并标出要求的结果。" }
        ],
        studyPlan: [
          { minutes: 1, task: "扫读标题、公式和图示，定位本节研究对象", outcome: "写下 1 个核心问题" },
          { minutes: 2, task: "对照知识地图说清条件、规律与结果", outcome: "口头复述 1 条关系链" },
          { minutes: 2, task: "遮住答案完成首个挑战并检查单位或条件", outcome: "得到 1 次即时反馈" }
        ],
        firstChallenge: `不看后文，先写出学习《${title}》时最需要分清的两个条件，并说明它们可能怎样影响结果。`
      },
      workedExamples: [
        {
          title: "示范一：从条件找到规律",
          problem: `面对《${title}》中的一个典型问题，怎样从已知条件确定要使用的概念、规律或方法？`,
          strategy: "先翻译条件，再匹配规律，最后检查结论是否满足原条件。",
          steps: [
            { label: "标出条件", explanation: "把题目中的对象、数值、范围或变化逐项列出，不急着计算。" },
            { label: "连接规律", explanation: "说明每个条件与哪个概念或规律有关，并排除条件不满足的方法。" },
            { label: "验证结果", explanation: "检查单位、数量级、边界或因果方向是否合理。" }
          ],
          answer: "完整答案应包含条件整理、方法依据、分步过程和结果检查，不能只写最终结论。",
          selfCheck: "我是否解释了为什么选这个方法，并检查了每个条件都被使用？"
        },
        {
          title: "示范二：把规律迁移到新情境",
          problem: "如果改变一个关键条件，原来的结论是否仍然成立？",
          strategy: "一次只改变一个变量，比较变化前后的推理链。",
          steps: [
            { label: "固定其余条件", explanation: "先说明哪些条件保持不变，避免同时变化导致无法判断。" },
            { label: "追踪影响", explanation: "沿着规律逐步判断被改变的条件会影响哪个中间量和最终结果。" }
          ],
          answer: "结论要写清是否成立、变化方向及其依据；信息不足时应明确还缺少什么条件。",
          selfCheck: "我能否指出结论变化发生在推理链的哪一步？"
        }
      ]
    };
  }

  if (isEnglish) {
    return {
      quickStart: {
        prerequisites: [
          { topic: "语境线索", check: "找出资料中表示人物、时间、地点或态度的关键词。" },
          { topic: "核心表达", check: "任选一个重点词组，用自己的话说出它在句中的意思。" }
        ],
        studyPlan: [
          { minutes: 1, task: "扫读标题与首尾句，猜测语境和主题", outcome: "写下 1 句主题预测" },
          { minutes: 2, task: "圈出高频词组并放回上下文理解", outcome: "说清 2 个表达的用法" },
          { minutes: 2, task: "用目标表达完成一句口头或书面输出", outcome: "产出 1 个新句子" }
        ],
        firstChallenge: `从《${title}》中选一个核心表达，不照抄原句，用它表达一个与自己有关的新意思。`
      },
      workedExamples: [
        {
          title: "示范一：根据语境理解表达",
          problem: "遇到熟词新义或陌生表达时，怎样不用逐词翻译也能判断意思？",
          strategy: "先判断句子功能，再利用搭配、指代和上下文验证。",
          steps: [
            { label: "定位语境", explanation: "判断这句话是在叙事、描述、提问、解释还是表达态度。" },
            { label: "观察搭配", explanation: "看目标表达前后的词性、固定搭配和指代对象。" },
            { label: "换句验证", explanation: "用一个简单表达替换后重读，检查整段意思是否连贯。" }
          ],
          answer: "答案应说明语境判断、关键线索以及最终确定的含义或用法。",
          selfCheck: "我的理解能否解释前后句，而不只是对应一个中文词？"
        },
        {
          title: "示范二：从理解走向输出",
          problem: "怎样把刚学到的表达用于一个新的真实语境？",
          strategy: "保留表达结构，替换人物、时间或事件信息。",
          steps: [
            { label: "提取句型", explanation: "保留承担语法和逻辑功能的部分，标出可以替换的信息。" },
            { label: "生成新句", explanation: "换成自己的情境，并检查时态、主谓和搭配是否一致。" }
          ],
          answer: "新句应语义完整、语境自然，并正确保留目标表达的结构和功能。",
          selfCheck: "我能否在不看原句的情况下，再说出一个不同语境的新句？"
        }
      ]
    };
  }

  return {
    quickStart: {
      prerequisites: [
        { topic: "背景与对象", check: "用一句话说出这份资料主要在讨论谁或什么。" },
        { topic: "证据意识", check: "找出一处能支持核心意思的原文或事实。" }
      ],
      studyPlan: [
        { minutes: 1, task: "看标题、首尾和小标题，预测内容主线", outcome: "写下 1 个核心问题" },
        { minutes: 2, task: "沿知识地图找出观点、证据与关系", outcome: "复述 1 条证据链" },
        { minutes: 2, task: "不看讲义回答首个挑战，再回文定位依据", outcome: "完成 1 次主动回忆" }
      ],
      firstChallenge: `不照抄原文，用两句话说明《${title}》最重要的内容，并指出一条依据。`
    },
    workedExamples: [
      {
        title: "示范一：从材料得出结论",
        problem: `怎样用资料中的信息解释《${title}》的核心内容，而不是只给出空泛结论？`,
        strategy: "先明确问题，再找直接证据，最后解释证据与结论的关系。",
        steps: [
          { label: "锁定问题", explanation: "把题目改写成需要回答的对象、特点、原因或作用。" },
          { label: "选择证据", explanation: "找到最能支持答案的原文、事实或结构位置，舍去无关细节。" },
          { label: "完成解释", explanation: "说明这条证据为什么能推出结论，形成“观点—证据—解释”。" }
        ],
        answer: "完整答案必须同时包含明确观点、资料证据和二者之间的解释。",
        selfCheck: "删掉我的观点后，所引证据还能让别人得出同样结论吗？"
      },
      {
        title: "示范二：组织规范表达",
        problem: "信息很多时，怎样把答案写得有层次又不漏关键点？",
        strategy: "先搭主干，再按因果、时间或总分关系组织信息。",
        steps: [
          { label: "写主干句", explanation: "先用一句话直接回答问题，避免从背景细节绕起。" },
          { label: "补证据链", explanation: "按清晰关系补充两到三个关键依据，并使用准确关联词。" }
        ],
        answer: "答案应先回应问题，再分层补充依据；每一层都服务于核心结论。",
        selfCheck: "每句话是否都在回答题目，顺序是否能让读者看出信息关系？"
      }
    ]
  };
}

function createDeepStudyDefaults({ title, subject, sourceAtoms, goal }) {
  const sourceRefs = sourceAtoms.map((atom) => atom.id).filter(Boolean);
  const primaryRef = sourceRefs[0] || "S0";
  const secondaryRef = sourceRefs[1] || primaryRef;
  const goalFocus = goal === "exam"
    ? "稳定得分：先识别信号，再写出关键依据和检查过程。"
    : goal === "deep"
      ? "深度理解：说明条件为什么必要，并能处理条件变化后的新情境。"
      : "真正看懂：能用自己的话解释关系，并在相近问题中做出正确判断。";

  if (/数学|物理|化学|生物|科学|理科/u.test(subject)) {
    return {
      learningGoals: [
        { level: "辨析", text: `说清《${title}》中每个核心概念、量或条件分别限制什么。` },
        { level: "推理", text: "从题干条件推出应使用的关系、规律或模型，并说明依据。" },
        { level: "检验", text: "完成求解后检查条件、单位、范围、边界或因果方向。" }
      ],
      overview: {
        coreQuestion: `《${title}》的关键不是记住一个结论，而是判断“什么条件下可以用什么关系，以及结论怎样被条件限制”。`,
        readingTip: `先把资料中的对象、已知、未知和限制条件分别圈出。每得到一个结果，都回到原条件检查它是否仍然成立。${goalFocus}`,
        outline: ["识别对象与条件", "建立关系或模型", "按条件推理求解", "回到边界检查结果"]
      },
      coreModel: {
        coreClaim: `《${title}》中的结论必须由条件推出；条件一变，关系、方法或结果都可能随之改变。`,
        reasoningChain: [
          { from: "题干给出的对象、量和限制条件", because: "它们决定问题属于哪类关系或模型", therefore: "先写出可用的定义、规律或关系式" },
          { from: "定义或规律的适用条件", because: "每条规律都有前提，不能只看表面关键词", therefore: "筛掉不满足条件的直接套用方法" },
          { from: "得到的数值、方向或结论", because: "结果仍受单位、范围和边界约束", therefore: "代回条件检查是否合理" }
        ],
        boundaries: [
          { when: "关键条件缺失、改变或超出范围", rule: "先补条件或重新选模型，不能沿用原结论", why: "同一公式或规律在前提变化后可能失效" },
          { when: "结果与单位、数量级、方向或实际范围矛盾", rule: "回到列式与条件翻译步骤逐项核查", why: "计算正确不等于结论在题目情境中成立" }
        ],
        confusionPair: { title: "“记住关系”与“会用关系”", difference: "前者只会复述结论，后者能指出适用条件并完成结果检查。", decisionRule: "先问条件是否满足，再决定能否调用关系。" }
      },
      knowledgeMap: {
        center: title,
        nodes: [
          { label: "对象与量", detail: "题目研究什么，哪些量已知或未知" },
          { label: "核心关系", detail: "定义、规律、公式或模型怎样连接量" },
          { label: "适用条件", detail: "哪些前提必须同时满足" },
          { label: "推理步骤", detail: "从条件到结论的顺序不能跳步" },
          { label: "结果检验", detail: "单位、范围、边界和方向是否合理" }
        ]
      },
      keyPoints: [
        {
          title: "先翻译条件，再选择关系",
          explanation: "题干中的对象、数量、范围和变化不是背景信息，而是决定模型选择的约束。先把它们写成明确条件，才能避免凭关键词套公式。",
          principle: "方法由条件决定，不由题目表面词决定。",
          useWhen: "题目同时出现多个量、图像、公式或关系词，需要判断先用哪条规律时。",
          boundary: "如果条件没有说明范围、单位或变化方向，先补问或保留条件，不能假定它满足。",
          sourceRefs: [primaryRef],
          example: primaryRef,
          memoryTip: "对象—条件—关系—检验，四步不省略。",
          retrievalQuestion: "不看讲义，说出本题至少两个决定方法选择的条件。",
          importance: "必会"
        },
        {
          title: "推理链必须写出中间依据",
          explanation: "从条件直接跳到答案最容易掩盖错误。把“条件怎样进入规律、规律怎样推出结论”写成链条，才能定位错在理解还是计算。",
          principle: "每个结论都要能回溯到一个条件和一条依据。",
          useWhen: "计算题、证明题、图像题或需要解释原因的题目。",
          boundary: "只写公式或只报答案都不能证明条件已经被正确使用。",
          sourceRefs: [secondaryRef],
          example: secondaryRef,
          memoryTip: "条件写左边，依据写中间，结论写右边。",
          retrievalQuestion: "任选一个结论，指出它依赖的条件和规律分别是什么。",
          importance: "重点"
        },
        {
          title: "结果要经过边界检查",
          explanation: "结果是否可用，还要看它是否违反定义、单位、范围、数量级或实际情境。检查边界能发现最隐蔽的“算对但答错”。",
          principle: "答案成立的最后一步，是验证它没有越过题目的边界。",
          useWhen: "求范围、求数值、实际应用、参数讨论和条件变化题。",
          boundary: "当出现极端值、等号、零值、负值或单位转换时，必须单独代回检查。",
          sourceRefs: [primaryRef, secondaryRef],
          example: secondaryRef,
          memoryTip: "代回、看单位、看范围、看方向。",
          retrievalQuestion: "写出本题一个不能直接取到的边界值，并解释原因。",
          importance: "提升"
        }
      ],
      strategyCards: [
        {
          scenario: "条件判定型",
          trigger: "题干要求判断类别、范围、图像、方向或能否使用某规律。",
          firstMove: "把题干条件拆成符号、范围或关系，再与定义逐条比对。",
          route: [
            { action: "列出所有显性和隐性条件", reason: "避免只抓一个关键词而漏掉定义限制。" },
            { action: "逐条对照定义或规律的前提", reason: "先确认能用什么，再开始计算或判断。" },
            { action: "检查边界是否取等", reason: "边界常常决定分类和取值范围。" }
          ],
          scoringPoints: ["写出关键条件", "说明条件与定义或规律的对应关系"],
          commonLoss: "只凭题目关键词直接下结论，遗漏隐含条件。",
          variation: "把一个条件改为边界值，重新判断原结论是否仍成立。"
        },
        {
          scenario: "关系求解型",
          trigger: "题目给出数据、点、图像或实验现象，要求求未知量、关系式或结果。",
          firstMove: "先写出对象之间的关系和每个量的含义，不急着代数运算。",
          route: [
            { action: "设出未知量或关系式", reason: "让已知和未知进入同一个可推理结构。" },
            { action: "代入与条件对应的信息", reason: "每个条件都应影响一次推理或计算。" },
            { action: "把结果代回原条件", reason: "验证没有丢失单位、范围或方向。" }
          ],
          scoringPoints: ["关系式或模型正确", "过程完整且结果回代检查"],
          commonLoss: "公式代入正确，但把量的含义、单位或范围弄错。",
          variation: "替换一个已知条件，比较哪一步会先改变。"
        },
        {
          scenario: "实际情境型",
          trigger: "题目出现时间、数量、成本、速度、实验条件或真实限制。",
          firstMove: "写出每个量的实际意义，并先确定合理取值范围。",
          route: [
            { action: "翻译情境中的变化关系", reason: "文字信息必须先转化为可判断的关系。" },
            { action: "列出范围与单位约束", reason: "真实情境不能按无限制的数学对象处理。" },
            { action: "用极端值检查结论", reason: "起点、终点或边界最容易暴露模型错误。" }
          ],
          scoringPoints: ["量与单位说明清楚", "写出符合情境的范围或边界"],
          commonLoss: "得到关系式后忘记写范围，或把实际对象当作无限延伸的模型。",
          variation: "让一个限制条件发生变化，判断模型和范围怎样调整。"
        }
      ],
      closeReading: [
        { heading: "从定义中找限制条件", original: primaryRef, explanation: "先圈出定义、关系或叙述中的限定词。它们决定概念是否成立，也是后续判断能否套用规律的依据。", question: "把其中一个限制条件改成边界值，原结论是否仍成立？请说明依据。" },
        { heading: "从条件推到结果", original: secondaryRef, explanation: "把资料中的条件、规律和结果分成三层，检查中间是否缺少必要的推理环节。", question: "这条结果依赖哪些条件？少一个条件时，哪一步不能继续？" }
      ],
      concepts: [
        { term: "条件", definition: "决定一个结论、规律或方法能否使用的限制信息。", example: "范围、单位、方向、初始值或定义中的限制。" },
        { term: "模型", definition: "把对象和关系整理成可推理、计算或解释的结构。", example: "先确定量之间关系，再代入条件求解。" },
        { term: "边界", definition: "结论刚好改变、失效或需要另行讨论的位置。", example: "等号、零值、最大最小值和范围端点。" },
        { term: "检验", definition: "把结果放回条件中，检查是否符合定义和实际限制。", example: "代回原式并核对单位与取值范围。" }
      ],
      mistakes: [
        { wrong: "看到熟悉公式就直接代入。", right: "先写出适用条件，再决定是否使用公式或规律。", reason: "公式的前提不满足时，计算过程再完整也没有意义。" },
        { wrong: "把中间推理省掉，只写结果。", right: "写出条件、依据和结论的连接。", reason: "中间依据决定答案是否可验证，也便于定位错误。" },
        { wrong: "只检查计算，不检查范围和单位。", right: "把结果代回题干限制，检查边界、单位和方向。", reason: "大量失分来自结果不符合情境，而非算式错误。" }
      ],
      practice: [
        { type: "条件辨析", question: `从《${title}》中找出两个决定方法选择的条件，分别说明它们排除了什么错误做法。`, options: [], solvingPlan: "先列条件，再逐条对应定义或规律。", answer: "答案需包含两个具体条件及其限制作用。", explanation: "条件不是背景信息，它们决定方法能否调用。", scoringPoints: ["条件准确", "限制作用解释清楚"], commonLosses: ["只罗列条件，不说明作用"], repairAction: "回到核心原理，按“条件—依据—结论”补全。", sourceRefs: [primaryRef], difficulty: "基础" },
        { type: "推理题", question: "选择一个结论，写出从题干条件到该结论的完整三步推理链。", options: [], solvingPlan: "条件 → 依据 → 结论，每步标出理由。", answer: "答案应明确写出条件、使用的定义或规律，以及得到的结论。", explanation: "推理链能区分“会算”与“知道为什么这样算”。", scoringPoints: ["依据正确", "推理顺序完整"], commonLosses: ["直接跳到结论"], repairAction: "从例题中找一条完整链条，替换为本题条件重写。", sourceRefs: [secondaryRef], difficulty: "进阶" },
        { type: "边界检查", question: "改变一个关键条件到边界值，判断原来的方法或结论是否仍成立。", options: [], solvingPlan: "先定位边界，再代回定义或条件检查。", answer: "答案需说明成立与否，并指出改变发生在哪个条件。", explanation: "边界题考查是否真正理解方法的适用范围。", scoringPoints: ["边界定位正确", "理由与条件对应"], commonLosses: ["只说不成立，没有说明条件变化"], repairAction: "回看重点精讲中的“条件边界”，逐条核对。", sourceRefs: [primaryRef], difficulty: "提升" },
        { type: "迁移题", question: "换一个相似情境，先写出必须补充的条件，再说明你会选用的关系或模型。", options: [], solvingPlan: "对象 → 条件 → 关系 → 检验。", answer: "答案应至少说明一个新增条件、一个关系选择和一个检查动作。", explanation: "迁移不是换数字重算，而是能在新条件下重新建模。", scoringPoints: ["条件补充合理", "方法选择有依据"], commonLosses: ["照搬原题关系，不看新限制"], repairAction: "用策略卡的第一步重新识别新情境。", sourceRefs: [secondaryRef], difficulty: "迁移" }
      ],
      masteryChecks: [
        { level: "复述", task: `不看讲义，用“条件—关系—结果—检查”讲清《${title}》的一条核心推理。`, deliverable: "写出 4 句推理链，每句分别对应一个环节。", criteria: "四个环节完整，且能指出至少一个限制条件。", rubric: ["条件准确", "依据可追溯", "结果经过检查"], ifStuck: "只回看核心原理的推理链，遮住结论后重述。", sourceRefs: [primaryRef] },
        { level: "应用", task: "独立完成一道同类题，并在每一步旁边标出所用条件或规律。", deliverable: "一份带条件标注和边界检查的完整过程。", criteria: "方法选择有依据，过程不断步，结果符合条件。", rubric: ["方法匹配", "过程完整", "边界检查"], ifStuck: "回到例题拆解的触发信号和第一步，只重做卡住的一步。", sourceRefs: [secondaryRef] },
        { level: "迁移", task: "把一个条件改掉，判断原方法是否仍可用并说明怎样调整。", deliverable: "写出改变的条件、调整后的方法与理由。", criteria: "能指出原方法的边界，并给出新方法或补充条件。", rubric: ["条件变化明确", "调整有理由", "结论可验证"], ifStuck: "对照高价值策略中的变式与常见失分，定位哪个条件被忽略。", sourceRefs: [primaryRef, secondaryRef] }
      ]
    };
  }

  if (/英语|英文/u.test(subject)) {
    return {
      learningGoals: [
        { level: "辨析", text: `能根据《${title}》的语境判断核心表达的真实含义和功能。` },
        { level: "运用", text: "能保留关键结构，在新语境中正确替换并输出。" },
        { level: "校验", text: "能检查表达的语境、搭配、词性、时态或语法功能是否匹配。" }
      ],
      overview: { coreQuestion: `《${title}》的关键不是逐词翻译，而是判断表达在什么语境下、以什么形式完成什么功能。`, readingTip: `先标出人物、时间、态度、指代和连接词，再判断表达在句中承担的功能；最后换一个情境输出验证。${goalFocus}`, outline: ["定位语境与功能", "识别形式和搭配", "替换信息完成输出", "回读检查语法与语义"] },
      coreModel: {
        coreClaim: `英语表达的准确性来自“语境、形式、功能”同时匹配，而不是孤立记住一个中文释义。`,
        reasoningChain: [
          { from: "上下文的人物、时间、态度和连接词", because: "它们限定表达要传达的真实意思", therefore: "先确定语用功能，再选择释义" },
          { from: "词性、时态和固定搭配", because: "形式决定表达能否放进这个句位", therefore: "检查结构是否保留正确" },
          { from: "新情境中的输出", because: "替换后仍通顺才说明真正掌握", therefore: "用自己的内容造句并回读验证" }
        ],
        boundaries: [
          { when: "同一个词在不同语境中含义变化", rule: "不要只查单词表，先看上下句与说话意图", why: "孤立释义无法决定实际功能" },
          { when: "替换人物、时间或动作后", rule: "重新检查时态、主谓一致和搭配", why: "结构正确不等于新句自然" }
        ],
        confusionPair: { title: "词义记忆与语境理解", difference: "词义记忆给出候选含义，语境理解决定本句实际表达。", decisionRule: "先问这句话想完成什么交际功能，再选含义。" }
      },
      knowledgeMap: {
        center: title,
        nodes: isEnglishTenseSystem({ title, subject })
          ? createEnglishTenseKnowledgeNodes()
          : [{ label: "语境", detail: "人物、时间、态度和上下文线索" }, { label: "核心表达", detail: "词义、词性、时态和固定搭配" }, { label: "句子功能", detail: "叙述、请求、比较、解释或评价" }, { label: "输出结构", detail: "保留骨架，替换可变信息" }, { label: "回读校验", detail: "语义、语法和语境是否一致" }]
      },
      keyPoints: [
        { title: "先用语境确定含义", explanation: "同一个词或结构的实际意义由上下文决定。先识别谁在说、何时说、要表达什么态度，再选择最符合整段意思的解释。", principle: "语境先于词典释义。", useWhen: "遇到熟词新义、代词指代、语气判断或阅读理解细节题时。", boundary: "只看目标词本身，无法判断反讽、态度、时间和指代变化。", sourceRefs: [primaryRef], example: primaryRef, memoryTip: "看前后句，不孤立翻。", retrievalQuestion: "指出一句中两个改变含义的语境线索。", importance: "必会" },
        { title: "形式服务于表达功能", explanation: "词性、时态、语序和搭配不是孤立规则，它们共同决定一句话在当前语境中能否表达正确关系。", principle: "先确定要表达的关系，再选择匹配的形式。", useWhen: "语法填空、改错、翻译和写作替换表达时。", boundary: "结构相似不代表可以互换，搭配对象和时间关系改变时需重选。", sourceRefs: [secondaryRef], example: secondaryRef, memoryTip: "功能定结构，结构再定词。", retrievalQuestion: "说出本句的时间关系和一个必须保留的结构。", importance: "重点" },
        { title: "输出后要回到语境检查", explanation: "造句或改写后，必须检查新内容是否保留原表达的功能，并核对时态、主谓、搭配与逻辑关系。", principle: "能放进新语境且自然通顺，才算会用。", useWhen: "口语、写作、句型仿写和翻译输出时。", boundary: "只替换单词而不检查语法关系，容易得到看似正确但不自然的句子。", sourceRefs: [primaryRef, secondaryRef], example: secondaryRef, memoryTip: "换信息，再回读。", retrievalQuestion: "不用原句人物和事件，造一个功能相同的新句。", importance: "提升" }
      ],
      strategyCards: [
        { scenario: "语境判断型", trigger: "题目要求判断词义、态度、指代、主旨或句子含义。", firstMove: "先读目标句前后两句，圈出人物、时间、连接词和态度词。", route: [{ action: "判断句子在段落中的功能", reason: "先知道它是在解释、转折、评价还是举例。" }, { action: "利用搭配和指代缩小含义", reason: "词语不能脱离相邻成分理解。" }, { action: "把候选含义代回整段", reason: "整段连贯才能验证选择。" }], scoringPoints: ["语境线索明确", "含义与整段逻辑一致"], commonLoss: "只按单词表的第一义项作答。", variation: "把目标词放进态度相反的新语境，重新判断含义。" },
        { scenario: "结构输出型", trigger: "题目要求仿写、翻译、改错、填空或用指定表达造句。", firstMove: "先保留承担语法和逻辑功能的骨架，再替换可变信息。", route: [{ action: "标出不可替换的结构", reason: "它决定时态、搭配和逻辑关系。" }, { action: "替换人物、时间或事件", reason: "用自己的信息完成真实输出。" }, { action: "回读检查形式和语境", reason: "避免句法正确但表达不自然。" }], scoringPoints: ["结构保留正确", "新句语境自然"], commonLoss: "逐词翻译或只换单词，不检查时态和搭配。", variation: "把时间或说话对象改掉，调整表达形式。" },
        { scenario: "错误定位型", trigger: "句子中有语法、搭配、指代或逻辑错误，需要改错或解释原因。", firstMove: "先确定句子想表达的功能，再检查形式是否支持这个功能。", route: [{ action: "标出功能冲突的位置", reason: "错误往往表现为时间、对象或逻辑不一致。" }, { action: "替换为符合功能的形式", reason: "改错要说明为什么改，不是凭语感。" }, { action: "代回上下文复读", reason: "确保修正后与段落一致。" }], scoringPoints: ["错误类型判断正确", "修改后能解释原因"], commonLoss: "只改形式，不说明原句与语境冲突。", variation: "在新语境里故意改变一个线索，判断原修改是否还适用。" }
      ],
      closeReading: [{ heading: "从上下文锁定表达功能", original: primaryRef, explanation: "先找前后句的时间、人物、态度和连接词，再判断目标表达是在说明、转折、评价还是请求。", question: "如果把说话者或时间换掉，哪一个词或结构必须改变？" }, { heading: "从形式验证语境", original: secondaryRef, explanation: "标出时态、词性、搭配和指代，检查它们是否共同支持当前语境。", question: "不用原句信息，保留结构造一个语境自然的新句。" }],
      concepts: [{ term: "语境", definition: "决定表达实际含义的上下文、人物、时间和交际目的。", example: "同一词在请求和评价句中可能含义不同。" }, { term: "搭配", definition: "词与词在自然表达中常见的固定组合关系。", example: "替换词语时要同时检查它能否和附近词搭配。" }, { term: "功能", definition: "一句话在交流中承担的作用，例如解释、比较、请求或评价。", example: "先确定功能，才能选择合适结构。" }, { term: "回读", definition: "把输出放回上下文检查语义、语法和语境是否一致。", example: "造句后读完整段，而不只看单句。" }],
      mistakes: [{ wrong: "只按单词表翻译目标词。", right: "先找上下文线索，再选择符合功能的含义。", reason: "词典给出候选义，语境才决定实际义。" }, { wrong: "仿写时只替换单词。", right: "保留结构骨架，并检查时态、搭配和对象。", reason: "表达的正确性来自形式与功能一起匹配。" }, { wrong: "写完句子不回读。", right: "把新句放回完整语境检查是否自然。", reason: "单句语法正确仍可能与上下文逻辑冲突。" }],
      practice: [{ type: "语境辨析", question: `从《${title}》中找出两个决定核心表达含义的语境线索。`, options: [], solvingPlan: "目标表达 → 前后句线索 → 实际功能。", answer: "答案需说明线索及其怎样限制含义。", explanation: "语境线索比孤立释义更能支持判断。", scoringPoints: ["线索准确", "功能说明清楚"], commonLosses: ["只写中文词义"], repairAction: "回到核心原理，先补人物、时间和态度。", sourceRefs: [primaryRef], difficulty: "基础" }, { type: "结构输出", question: "保留一个核心结构，替换人物、时间或事件，写出一个新语境自然的句子。", options: [], solvingPlan: "保留功能骨架，再替换可变信息。", answer: "新句需语义完整、形式正确、语境自然。", explanation: "输出验证能暴露只会认不会用的问题。", scoringPoints: ["结构正确", "时态搭配正确"], commonLosses: ["只换单词，不改形式"], repairAction: "标出原句不可替换的结构后重写。", sourceRefs: [secondaryRef], difficulty: "进阶" }, { type: "错误定位", question: "设计一个与本课相关的错误句，并说明它与语境或形式冲突在哪里。", options: [], solvingPlan: "先确定要表达的功能，再故意改变一个关键形式。", answer: "答案需写出错误位置、正确形式与原因。", explanation: "能解释错误来源，才说明掌握了规则边界。", scoringPoints: ["错误真实", "原因与功能对应"], commonLosses: ["只说语法错，不说明为何错"], repairAction: "对照策略卡中的“错误定位型”重做。", sourceRefs: [primaryRef], difficulty: "提升" }, { type: "迁移表达", question: "用本课表达完成一个与自己经历有关的两句微对话或微段落。", options: [], solvingPlan: "确定交际目的，再选择表达并回读。", answer: "答案需保留目标表达功能，且前后逻辑连贯。", explanation: "迁移要求在新语境中保持表达功能。", scoringPoints: ["功能一致", "语境完整"], commonLosses: ["只有孤立句，没有语境"], repairAction: "先写人物、时间和目的，再组织句子。", sourceRefs: [secondaryRef], difficulty: "迁移" }],
      masteryChecks: [{ level: "复述", task: `不看讲义，说出《${title}》中一个表达在什么语境下承担什么功能。`, deliverable: "一段包含语境线索、形式和功能的口头解释。", criteria: "能说出至少两个语境线索，并解释它们怎样影响含义。", rubric: ["线索准确", "功能明确", "表达连贯"], ifStuck: "只回看核心原理的第一条推理链，再遮住说明复述。", sourceRefs: [primaryRef] }, { level: "应用", task: "用一个核心结构写出自己的新句，并标出保留与替换的部分。", deliverable: "一条标注结构和语境的新句。", criteria: "结构、时态和搭配正确，且新句功能与原表达一致。", rubric: ["结构正确", "语境自然", "回读检查"], ifStuck: "回到例题拆解，只看触发信号和第一步重写。", sourceRefs: [secondaryRef] }, { level: "迁移", task: "改变说话对象或时间，调整原表达并解释哪一处必须改变。", deliverable: "一组原句与改写句，以及改变原因。", criteria: "能指出形式变化与语境变化之间的对应关系。", rubric: ["变化定位", "形式调整", "理由充分"], ifStuck: "用策略卡的边界检查重新判断时态、指代和搭配。", sourceRefs: [primaryRef, secondaryRef] }]
    };
  }

  return {
    learningGoals: [
      { level: "判断", text: `用资料中的证据解释《${title}》的核心观点、内容或关系。` },
      { level: "论证", text: "把观点、依据和解释组织成完整的表达链。" },
      { level: "迁移", text: "在相似材料中识别同类关系，并说明方法何时需要调整。" }
    ],
    overview: { coreQuestion: `学习《${title}》时，关键不是罗列信息，而是判断“核心观点是什么、证据怎样支持它、哪些条件会改变结论”。`, readingTip: `先区分观点、证据和解释；每读一段都追问它为哪个结论服务，并标出范围、转折和反例。${goalFocus}`, outline: ["定位核心观点", "提取直接证据", "解释证据关系", "检查范围与反例"] },
    coreModel: {
      coreClaim: `《${title}》中的关键结论必须由材料证据和推理关系共同支撑，不能只靠标签式概括。`,
      reasoningChain: [
        { from: "资料中的事实、语句、现象或结构", because: "它们提供可以核对的依据", therefore: "先明确这些信息直接说明什么" },
        { from: "证据之间的因果、对比、递进或总分关系", because: "关系决定证据怎样支持观点", therefore: "写出“因此、但是、由于”等推理连接" },
        { from: "最终观点或表达结论", because: "结论的范围必须与证据强度一致", therefore: "检查是否夸大、遗漏条件或跳过解释" }
      ],
      boundaries: [
        { when: "证据只说明局部情形或特定对象", rule: "结论也要保留相同范围，不扩大到所有情况", why: "材料证据不能支持超出范围的判断" },
        { when: "出现转折、反例、不同立场或限定词", rule: "把它作为修正观点的条件，而不是当作无关细节", why: "这些信息往往决定论证是否成立" }
      ],
      confusionPair: { title: "概括与论证", difference: "概括只回答“写了什么”，论证还要说明“凭什么这样说”。", decisionRule: "答案中至少写出一个材料依据和一条解释关系。" }
    },
    knowledgeMap: { center: title, nodes: [{ label: "核心观点", detail: "资料最终要说明、评价或解决什么" }, { label: "直接证据", detail: "可回到原文或事实核对的信息" }, { label: "关系结构", detail: "因果、对比、递进、转折或照应" }, { label: "范围边界", detail: "结论适用于谁、何时和什么条件" }, { label: "规范表达", detail: "观点、证据、解释三者连成完整答案" }] },
    keyPoints: [
      { title: "观点必须落在证据上", explanation: "有效结论不是抽象标签，而是能回到资料中找到支持它的事实、语句、结构或现象。先确定观点，再选择最直接的证据。", principle: "先有可核对依据，才有可信结论。", useWhen: "概括、分析、作用、原因、评价和材料题。", boundary: "细节多不等于证据强；只选与问题直接相关的信息。", sourceRefs: [primaryRef], example: primaryRef, memoryTip: "观点后面跟证据。", retrievalQuestion: "指出一条最能支持核心观点的资料信息，并解释它的作用。", importance: "必会" },
      { title: "证据之间要说清关系", explanation: "同样的事实，放在因果、对比、递进或转折关系中，会支持不同结论。写出关系，答案才不是证据堆砌。", principle: "证据的价值由它与观点的关系决定。", useWhen: "段落作用、材料分析、历史原因、观点论证或阅读理解。", boundary: "不能把时间先后自动当成因果，也不能把并列细节强行说成主次。", sourceRefs: [secondaryRef], example: secondaryRef, memoryTip: "证据后面补“所以/但是/因此”。", retrievalQuestion: "用一个关系词连接两条资料信息，并说明它怎样支持观点。", importance: "重点" },
      { title: "结论必须保留范围", explanation: "资料往往带有对象、时间、条件和立场。结论超出这些限定，就会从合理推断变成无根据的断言。", principle: "证据能支持多大范围，结论就写多大范围。", useWhen: "评价、比较、原因、影响、主旨和开放表达。", boundary: "遇到“都、一定、完全、唯一”等绝对词，要回到资料检查是否有充分证据。", sourceRefs: [primaryRef, secondaryRef], example: secondaryRef, memoryTip: "范围不放大，结论才站得住。", retrievalQuestion: "找出一个限定词，说明删掉它会怎样改变结论范围。", importance: "提升" }
    ],
    strategyCards: [
      { scenario: "证据定位型", trigger: "题目问原因、作用、观点依据、人物特点或材料结论。", firstMove: "先把问题改写成一个待证明的观点，再回资料寻找最直接证据。", route: [{ action: "写出一句直接观点", reason: "避免先抄材料而没有回答问题。" }, { action: "选择一到两条关键证据", reason: "证据要直接支持观点，而不是越多越好。" }, { action: "说明证据怎样推出观点", reason: "补上解释，形成可得分的论证链。" }], scoringPoints: ["观点直接回应题目", "证据具体且解释关系明确"], commonLoss: "罗列材料原句，不说明它为什么能支持答案。", variation: "替换一条证据，判断原观点是否仍成立。" },
      { scenario: "关系分析型", trigger: "题目出现转折、对比、因果、递进、照应、变化或不同立场。", firstMove: "先标出关系词、结构位置或前后差异。", route: [{ action: "分别概括关系两端的信息", reason: "先看各自说了什么，才能判断关系。" }, { action: "写出关系类型和方向", reason: "因果、对比和递进支持结论的方式不同。" }, { action: "回到题目说明作用", reason: "关系最终要服务于观点、结构或表达效果。" }], scoringPoints: ["关系判断准确", "能说明关系对结论的作用"], commonLoss: "只写术语，不解释前后内容怎样对应。", variation: "把转折改为并列，判断观点会怎样变化。" },
      { scenario: "规范表达型", trigger: "题目要求概括、评价、启示、比较、开放作答或简答。", firstMove: "先写直接结论，再按“依据—解释—范围”补充。", route: [{ action: "用一句话回答问题", reason: "先保证答案有中心。" }, { action: "补充材料依据", reason: "让结论可核对。" }, { action: "加入解释或范围限定", reason: "避免空泛和绝对化。" }], scoringPoints: ["结论明确", "证据与解释完整"], commonLoss: "答案只停在感受或标签，没有材料依据。", variation: "改变材料对象或时间，调整结论范围。" }
    ],
    closeReading: [{ heading: "从材料中定位观点与证据", original: primaryRef, explanation: "先区分这段话中的结论、事实和解释，判断每一部分为哪个中心观点服务。", question: "用“观点—证据—解释”重写这一处内容，不要只摘抄原句。" }, { heading: "从关系词看论证方向", original: secondaryRef, explanation: "重点看转折、因果、递进和限定词，它们决定前后信息怎样相互支持或修正。", question: "删去一个关系或限定词后，结论范围会怎样变化？" }],
    concepts: [{ term: "观点", definition: "对资料作出的可回答、可讨论的核心判断。", example: "它需要被材料中的信息支持。" }, { term: "证据", definition: "能够回到资料核对、直接支持观点的信息。", example: "事实、语句、数据、现象或结构位置。" }, { term: "解释", definition: "说明证据为什么能够推出观点的推理连接。", example: "用因果、对比或递进关系连接二者。" }, { term: "范围", definition: "结论适用的对象、时间、条件或程度。", example: "限定词决定结论不能被无限扩大。" }],
    mistakes: [{ wrong: "把所有细节都写进答案。", right: "只选直接支持观点的关键证据，并解释关系。", reason: "答案考查的是判断与论证，不是材料搬运。" }, { wrong: "看到先后顺序就写因果。", right: "确认资料是否提供原因、机制或结果证据。", reason: "时间相邻不能自动推出因果关系。" }, { wrong: "用绝对词扩大结论。", right: "保留材料中的对象、条件和程度限定。", reason: "结论范围超出证据范围会失去依据。" }],
    practice: [{ type: "证据题", question: `为《${title}》写出一个核心观点，并给出一条最直接的资料依据。`, options: [], solvingPlan: "观点 → 证据 → 解释。", answer: "答案需包含观点、具体依据以及依据怎样支持观点。", explanation: "能解释证据关系，才不是材料摘抄。", scoringPoints: ["观点明确", "证据具体", "解释完整"], commonLosses: ["只有观点或只有原文"], repairAction: "用策略卡的“证据定位型”重写。", sourceRefs: [primaryRef], difficulty: "基础" }, { type: "关系题", question: "选择两条资料信息，判断它们是因果、对比、递进还是转折关系，并说明理由。", options: [], solvingPlan: "概括两端 → 判断关系 → 说明作用。", answer: "答案需指出关系类型和内容上的对应。", explanation: "关系判断让证据成为推理链。", scoringPoints: ["关系正确", "对应内容清楚"], commonLosses: ["只写关系术语"], repairAction: "回到资料标出关系词和前后差异。", sourceRefs: [secondaryRef], difficulty: "进阶" }, { type: "边界题", question: "找出一个限定词或反例，说明它限制了哪一个结论。", options: [], solvingPlan: "定位限定 → 写出原范围 → 比较扩大后的问题。", answer: "答案需说明限定词如何防止结论被夸大。", explanation: "边界意识决定答案是否严谨。", scoringPoints: ["限定准确", "范围解释明确"], commonLosses: ["只解释词义"], repairAction: "用核心原理中的边界规则重新回答。", sourceRefs: [primaryRef], difficulty: "提升" }, { type: "迁移题", question: "换一份相似材料，写出一个“观点—证据—解释—范围”四句答案。", options: [], solvingPlan: "先定观点，再选证据，最后加解释和范围。", answer: "答案需四部分齐全，且每部分互相对应。", explanation: "迁移检验的是论证结构能否在新材料中复用。", scoringPoints: ["四部分完整", "材料对应"], commonLosses: ["结论超出材料范围"], repairAction: "先圈出新材料的对象和限定词。", sourceRefs: [secondaryRef], difficulty: "迁移" }],
    masteryChecks: [{ level: "复述", task: `不看讲义，用“观点—证据—解释—范围”讲清《${title}》的一个关键结论。`, deliverable: "四句结构化口头或书面答案。", criteria: "四部分齐全，且证据能直接支持观点。", rubric: ["观点明确", "证据具体", "范围恰当"], ifStuck: "只回看核心原理的第一条推理链，再遮住说明复述。", sourceRefs: [primaryRef] }, { level: "应用", task: "独立完成一道材料分析题，并在答案旁标出观点、证据和解释。", deliverable: "一份带三类标记的简答答案。", criteria: "每个观点都有证据，解释没有跳步。", rubric: ["结构完整", "关系正确", "表达规范"], ifStuck: "使用策略卡的“证据定位型”从第一步重写。", sourceRefs: [secondaryRef] }, { level: "迁移", task: "把资料对象或条件替换，调整原结论的范围并说明理由。", deliverable: "一组原结论、调整后结论和范围变化说明。", criteria: "能指出什么变了、什么不变，并保留证据边界。", rubric: ["条件识别", "范围调整", "理由充分"], ifStuck: "对照核心原理中的边界与反例，找出遗漏的限定。", sourceRefs: [primaryRef, secondaryRef] }]
  };
}

function applyGoalProfile(study, goal) {
  const withAnchoredStrategies = {
    ...study,
    strategyCards: study.strategyCards.map((card, index) => ({
      ...card,
      sourceRefs: card.sourceRefs?.length ? card.sourceRefs : study.keyPoints[index % study.keyPoints.length].sourceRefs
    }))
  };

  if (goal === "exam") {
    return {
      ...withAnchoredStrategies,
      learningGoals: [
        { level: "审题", text: "在读题前 30 秒圈出决定方法的条件、问法和限制，排除不能直接套用的路径。" },
        { level: "得分", text: "用“条件或证据—依据—结论”写出可评分的关键步骤，不只报最终答案。" },
        { level: "订正", text: "按失分原因重做关键一步，并用边界检查确认同类题不会再错。" }
      ],
      overview: {
        ...withAnchoredStrategies.overview,
        coreQuestion: `${withAnchoredStrategies.overview.coreQuestion} 考场上要把它压缩成“识别信号、写出依据、检查失分点”的稳定流程。`,
        readingTip: `${withAnchoredStrategies.overview.readingTip} 每次练习限时完成第一步，先保住方法分和依据分。`
      },
      strategyCards: withAnchoredStrategies.strategyCards.map((card) => ({
        ...card,
        trigger: `限时审题时，${card.trigger}`,
        firstMove: `先在题干旁写出“信号/条件”，再${card.firstMove}`,
        scoringPoints: [...card.scoringPoints, "关键依据写在结论前，避免只有答案没有过程"].slice(0, 3),
        commonLoss: `${card.commonLoss} 做完后不能只对答案，要定位漏掉的是条件、依据还是边界。`
      })),
      practice: withAnchoredStrategies.practice.map((item, index) => ({
        ...item,
        solvingPlan: `限时 ${index < 2 ? "2" : "3"} 分钟：${item.solvingPlan}`,
        scoringPoints: [...item.scoringPoints, "先写触发信号，再写结论"].slice(0, 3),
        repairAction: `订正时先标出失分环节，再${item.repairAction}`
      })),
      masteryChecks: withAnchoredStrategies.masteryChecks.map((item, index) => ({
        ...item,
        deliverable: `${item.deliverable}；限时 ${index === 0 ? "1" : "3"} 分钟完成。`,
        criteria: `${item.criteria} 能在限时内写出关键依据和最后检查。`
      }))
    };
  }

  if (goal === "deep") {
    return {
      ...withAnchoredStrategies,
      learningGoals: [
        { level: "建模", text: "说明核心关系为什么成立，并区分表面相似但条件不同的情境。" },
        { level: "辨界", text: "为每个关键结论找出至少一个失效条件、反例或需要重新判断的边界。" },
        { level: "迁移", text: "在陌生情境中重新选择方法，并解释哪些条件保留、哪些条件改变。" }
      ],
      overview: {
        ...withAnchoredStrategies.overview,
        coreQuestion: `${withAnchoredStrategies.overview.coreQuestion} 还要追问：改变哪个条件后，它会失效或需要换一种解释？`,
        readingTip: `${withAnchoredStrategies.overview.readingTip} 每学到一个结论，都主动构造一个“看起来相似但不能照搬”的反例。`
      },
      keyPoints: withAnchoredStrategies.keyPoints,
      strategyCards: withAnchoredStrategies.strategyCards.map((card) => ({
        ...card,
        variation: `${card.variation} 比较新旧情境中“保持不变”和“必须调整”的部分。`
      })),
      practice: withAnchoredStrategies.practice.map((item, index) => (
        index === withAnchoredStrategies.practice.length - 1
          ? {
            ...item,
            question: `${item.question} 还要说明一个不能照搬原方法的反例。`,
            explanation: `${item.explanation} 深度掌握还要能解释条件变化后为什么要改方法。`,
            scoringPoints: [...item.scoringPoints, "说明一个边界或反例"].slice(0, 3)
          }
          : item
      )),
      masteryChecks: withAnchoredStrategies.masteryChecks.map((item, index) => (
        index === 2
          ? { ...item, criteria: `${item.criteria} 必须说明一个条件变化、反例或替代路径。` }
          : item
      ))
    };
  }

  return withAnchoredStrategies;
}

function enrichWorkedExamples(examples, sourceRefs, subject) {
  const isScience = /数学|物理|化学|生物|科学|理科/u.test(subject);
  const isEnglish = /英语|英文/u.test(subject);
  const trigger = isScience
    ? "题干出现已知条件、未知量、范围、图像、公式或实际限制。"
    : isEnglish
      ? "题目要求判断语境、选择形式、改写表达或在新情境中输出。"
      : "题目要求根据材料概括、分析关系、说明原因、评价观点或规范表达。";
  const decisionRule = isScience
    ? "先确认条件是否满足，再选择关系或模型，最后检查边界。"
    : isEnglish
      ? "先确认语境和功能，再选择形式与搭配，最后回读验证。"
      : "先明确观点，再选择证据并说明二者的推理关系。";
  const defaultCheck = isScience
    ? "检查定义条件、单位、范围、等号和结果方向是否都符合题意。"
    : isEnglish
      ? "检查语境、词性、时态、搭配和新句的表达功能是否一致。"
      : "检查答案是否包含观点、具体依据、解释和必要的范围限定。";

  return examples.map((example, index) => ({
    ...example,
    questionType: index === 0 ? "核心判断型" : "条件变化型",
    trigger,
    given: sourceRefs[index % sourceRefs.length] || "资料中的关键条件或信息",
    target: index === 0 ? "确定正确方法并完整说明依据。" : "判断条件变化后原结论如何调整。",
    decisionRule,
    sourceRefs,
    steps: example.steps.map((step) => ({
      ...step,
      rationale: step.explanation,
      checkpoint: defaultCheck
    })),
    boundaryCheck: defaultCheck,
    scoringPoints: isScience
      ? ["条件或关系选择正确", "过程完整且有结果检查"]
      : isEnglish
        ? ["语境与结构匹配", "输出自然并回读验证"]
        : ["观点直接回应题目", "证据和解释形成完整链条"],
    commonWrongPath: isScience
      ? "只看一个关键词直接套用公式或规律，忽略隐含条件。"
      : isEnglish
        ? "只替换单词或按词典直译，忽略语境和结构功能。"
        : "只摘抄材料或堆砌术语，没有说明证据为什么支持结论。",
    variation: index === 0
      ? "改变一个关键条件，说明原方法是否还能直接使用。"
      : "换一份相似材料或情境，重新写出第一步和边界检查。"
  }));
}

function createDefaultVisuals(subject, outline) {
  if (/数学|物理|化学|生物|科学|理科/u.test(subject)) {
    return [
      { type: "flow", title: "从条件到可验证结论", caption: "每一步都保留条件与检查，避免只会套用关系。", items: ["识别对象与条件", "选择关系或模型", "按条件推理", "回到边界检查"] },
      { type: "compare", title: "能直接使用与需要重判", caption: "先核对前提，再决定是否调用公式、规律或模型。", leftTitle: "需要停下来", rightTitle: "可以继续", leftItems: ["条件缺失或范围改变", "单位、方向或对象不一致"], rightItems: ["定义前提全部满足", "结果能代回题干检查"] }
    ];
  }
  if (/英语|英文/u.test(subject)) {
    return [
      { type: "flow", title: "从语境到正确输出", caption: "先确定表达功能，再选择形式，最后放回语境验证。", items: ["定位语境线索", "判断表达功能", "选择结构与搭配", "输出后回读"] },
      { type: "compare", title: "只看词形与结合语境", caption: "同一个词或结构要放回句子，才能判断真正含义和用法。", leftTitle: "容易误判", rightTitle: "正确做法", leftItems: ["见到熟词就套固定词义", "只改一个词不检查整句"], rightItems: ["同时看前后句和表达功能", "完成后回读时态、搭配和语义"] }
    ];
  }
  return [
    { type: "flow", title: "从证据到可靠结论", caption: "把观点、证据、解释和范围连成可验证的推理链。", items: outline.slice(0, 5) },
    { type: "compare", title: "材料摘抄与有效论证", caption: "答案不仅要有材料，还要说明材料怎样支持结论。", leftTitle: "只有摘抄", rightTitle: "形成论证", leftItems: ["罗列原文，没有直接观点", "证据很多，但没有解释关系"], rightItems: ["先回应问题，再选直接证据", "用因果、对比或范围说明关系"] }
  ];
}

function isEnglishTenseSystem({ title = "", subject = "", center = "" } = {}) {
  return /英语|英文/iu.test(subject)
    && /时态|tense/iu.test(`${title} ${center}`);
}

function createEnglishTenseKnowledgeNodes() {
  return [
    { label: "一般现在时", detail: "经常、习惯或事实；do/does；常见 often、usually" },
    { label: "现在进行时", detail: "此刻或现阶段正在发生；am/is/are doing；常见 now" },
    { label: "现在完成时", detail: "过去发生并影响现在；have/has done；常见 already、since" },
    { label: "现在完成进行时", detail: "过去开始并持续到现在；have/has been doing；强调持续" },
    { label: "一般过去时", detail: "过去某时发生或存在；did；常见 yesterday、ago" },
    { label: "过去进行时", detail: "过去某时正在发生；was/were doing；常见 at that time" },
    { label: "过去完成时", detail: "过去某时之前已完成；had done；强调过去的过去" },
    { label: "过去完成进行时", detail: "过去某时前持续进行；had been doing；强调持续过程" },
    { label: "一般将来时", detail: "将要发生或临时决定；will do；常见 tomorrow、next" },
    { label: "将来进行时", detail: "将来某时正在发生；will be doing；强调将来进程" },
    { label: "将来完成时", detail: "将来某时前将已完成；will have done；常见 by + 将来时间" },
    { label: "将来完成进行时", detail: "到将来某时将持续一段时间；will have been doing" },
    { label: "一般过去将来时", detail: "站在过去看将要发生；would do；常见宾语从句" },
    { label: "过去将来进行时", detail: "过去预计将来某时正在发生；would be doing" },
    { label: "过去将来完成时", detail: "过去预计将来某时前完成；would have done" },
    { label: "过去将来完成进行时", detail: "过去预计到将来某时持续进行；would have been doing" }
  ];
}

function createEnglishTenseDiagrams() {
  return [
    {
      title: "16 种时态总矩阵",
      purpose: "先按时间视角定位一行，再按动作状态定位一列。",
      explanation: "四种时间视角与四种动作状态交叉，组成常见的 16 种时态。不要把时态当成 16 条孤立规则。",
      readingGuide: ["先问动作站在哪个时间点看", "再问动作是一般、进行、完成还是完成进行", "最后根据主语检查助动词和动词形式"],
      figureType: "table"
    },
    {
      title: "时态判断决策树",
      purpose: "把做题顺序固定为“时间 → 状态 → 结构 → 校验”。",
      explanation: "时间状语只是线索，不是唯一答案；上下文的先后关系、持续性和结果影响同样决定时态。",
      readingGuide: ["先判断整段基调，不要只盯一个时间词", "完成与完成进行的区别在结果和持续过程", "没有明显时间词时用上下文关系判断"],
      figureType: "diagram"
    }
  ];
}

function createDefaultKnowledgeDiagrams(title, subject, knowledgeMap) {
  if (isEnglishTenseSystem({ title, subject, center: knowledgeMap?.center })) {
    return createEnglishTenseDiagrams();
  }

  const center = cleanSingleLine(knowledgeMap?.center || title, 36);
  const nodeSummary = asArray(knowledgeMap?.nodes)
    .slice(0, 8)
    .map((node) => cleanSingleLine(node.label, 24))
    .filter(Boolean)
    .join("、");

  return [{
    title: "知识结构总览",
    purpose: "用一张结构图看清中心主题与关键分支。",
    explanation: "先看中心主题，再沿分支确认分类、条件和关系。图形只负责建立全景，具体判断回到重点与例题。",
    readingGuide: ["先说出中心主题", "沿分支复述关键节点", "指出节点之间的先后、并列或因果关系"],
    figureType: "diagram",
    figureHint: `${center}：${nodeSummary || "核心概念与关键分支"}`
  }, {
    title: "判断与应用路径",
    purpose: "把看到题目后的判断顺序固定下来，避免直接套结论。",
    explanation: "先找线索，再核对条件，最后写出结论并回读检查。每一步都对应后面的策略、例题和练习。",
    readingGuide: ["先找题干中的对象和信号", "再核对适用条件与边界", "最后写结论并检查依据"],
    figureType: "diagram",
    figureHint: `${center}的判断路径：线索 → 条件 → 方法 → 结论 → 检查`
  }];
}

function getStableEntityId(value, fallback, prefix, index, usedIds) {
  const pattern = new RegExp(`^${prefix}\\d+$`, "iu");
  const candidates = [value, fallback]
    .map((candidate) => cleanSingleLine(candidate, 24).toUpperCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (pattern.test(candidate) && !usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }

  let serial = index + 1;
  let generated = `${prefix}${serial}`;
  while (usedIds.has(generated)) {
    serial += 1;
    generated = `${prefix}${serial}`;
  }
  usedIds.add(generated);
  return generated;
}

function assignStableEntityIds(items, prefix) {
  const usedIds = new Set();
  return asArray(items).map((item, index) => ({
    ...item,
    id: getStableEntityId(item?.id, "", prefix, index, usedIds)
  }));
}

function asReferenceList(value) {
  return Array.isArray(value) ? value : [value];
}

function normalizeGraphEntityIds(value, fallback, entities, minimum = 1, maximum = 3) {
  const availableIds = new Set(asArray(entities).map((item) => item?.id).filter(Boolean));
  const references = [];
  const add = (candidate) => {
    const id = cleanSingleLine(typeof candidate === "object" ? candidate?.id : candidate, 24).toUpperCase();
    if (availableIds.has(id) && !references.includes(id) && references.length < maximum) {
      references.push(id);
    }
  };

  asReferenceList(value).forEach(add);
  if (references.length < minimum) asReferenceList(fallback).forEach(add);
  if (references.length < minimum) asArray(entities).forEach((item) => add(item?.id));
  return references;
}

function uniqueSourceRefs(values, maximum = 2) {
  const references = [];
  asArray(values).flat().forEach((value) => {
    const reference = cleanSingleLine(value, 24).toUpperCase();
    if (/^S\d+(?:-\d+)?$/u.test(reference) && !references.includes(reference) && references.length < maximum) {
      references.push(reference);
    }
  });
  return references;
}

function entitySourceRefs(entities) {
  return uniqueSourceRefs(asArray(entities).flatMap((item) => item?.sourceRefs || []));
}

function evidenceOverlap(left, right) {
  const rightRefs = new Set(asArray(right));
  return asArray(left).filter((reference) => rightRefs.has(reference)).length;
}

function distributeItemsAcrossGoals(items, goalCount) {
  const source = asArray(items).filter(Boolean);
  const buckets = Array.from({ length: goalCount }, () => []);
  if (!source.length || !goalCount) return buckets;

  source.forEach((item, index) => {
    const bucketIndex = Math.min(goalCount - 1, Math.floor((index * goalCount) / source.length));
    buckets[bucketIndex].push(item);
  });

  buckets.forEach((bucket, index) => {
    if (!bucket.length) bucket.push(source[Math.min(index, source.length - 1)]);
  });
  return buckets;
}

function selectExamplesForRoutes(examples, routeEvidenceSets) {
  const source = asArray(examples).filter(Boolean);
  const usage = new Map();

  return routeEvidenceSets.map((routeRefs) => {
    const unused = source.filter((example) => !usage.has(example.id));
    const candidates = unused.length ? unused : source;
    const example = [...candidates].sort((left, right) => {
      const overlapDifference = evidenceOverlap(right.sourceRefs, routeRefs) - evidenceOverlap(left.sourceRefs, routeRefs);
      if (overlapDifference) return overlapDifference;
      const usageDifference = (usage.get(left.id) || 0) - (usage.get(right.id) || 0);
      if (usageDifference) return usageDifference;
      return source.indexOf(left) - source.indexOf(right);
    })[0];
    if (!example) return [];
    usage.set(example.id, (usage.get(example.id) || 0) + 1);
    return [example];
  });
}

function sourceRefForIndex(sourceAtoms, index) {
  const usable = asArray(sourceAtoms).filter((atom) => atom?.id && atom.id !== "S0");
  if (usable.length) return usable[index % usable.length].id;
  return asArray(sourceAtoms).find((atom) => atom?.id)?.id || "S0";
}

function appendSourceRef(entity, sourceRef, maximum = 2) {
  if (!entity || !sourceRef) return;
  const refs = uniqueSourceRefs([entity.sourceRefs || [], sourceRef], maximum);
  if (refs.length) entity.sourceRefs = refs;
}

function buildLearningRoute({ learningGoals, knowledgeMap, keyPoints, workedExamples, practice, masteryChecks }) {
  const goals = asArray(learningGoals);
  const knowledgeBuckets = distributeItemsAcrossGoals(knowledgeMap?.nodes, goals.length);
  const pointBuckets = distributeItemsAcrossGoals(keyPoints, goals.length);
  const practiceBuckets = distributeItemsAcrossGoals(practice, goals.length);
  const masteryBuckets = distributeItemsAcrossGoals(masteryChecks, goals.length);
  const routeEvidenceSets = goals.map((goal, index) => uniqueSourceRefs([
    goal?.sourceRefs || [],
    entitySourceRefs(knowledgeBuckets[index]),
    entitySourceRefs(pointBuckets[index]),
    entitySourceRefs(practiceBuckets[index]),
    entitySourceRefs(masteryBuckets[index])
  ]));
  const exampleBuckets = selectExamplesForRoutes(workedExamples, routeEvidenceSets);

  return goals.map((goal, index) => {
    const points = pointBuckets[index];
    const examples = exampleBuckets[index];
    const exercises = practiceBuckets[index];
    const mastery = masteryBuckets[index];
    const focus = points[0]?.title || knowledgeBuckets[index][0]?.label || "完成关键判断";
    const exampleTitle = examples[0]?.title || "示范例题";
    const exerciseType = exercises[0]?.type || "独立练习";
    const proof = mastery[0]?.deliverable || mastery[0]?.task || "完成一份可核对的学习产出";

    return {
      id: `R${index + 1}`,
      goalId: goal.id,
      goalLevel: goal.level,
      goal: goal.text,
      knowledgeNodeIds: knowledgeBuckets[index].map((item) => item.id),
      keyPointIds: points.map((item) => item.id),
      exampleIds: examples.map((item) => item.id),
      practiceIds: exercises.map((item) => item.id),
      masteryCheckIds: mastery.map((item) => item.id),
      focus,
      action: `先完成“${exampleTitle}”，再独立完成“${exerciseType}”。`,
      proof,
      sourceRefs: uniqueSourceRefs([
        routeEvidenceSets[index],
        entitySourceRefs(examples)
      ]),
      evidenceFocus: "",
      sharedExampleReason: ""
    };
  });
}

function getReferencedSourceAtom(sourceAtoms, sourceRefs, fallbackIndex = 0) {
  const usableAtoms = sourceAtoms.filter((atom) => atom.id !== "S0");
  const referenced = asArray(sourceRefs)
    .map((reference) => usableAtoms.find((atom) => atom.id === reference))
    .find(Boolean);
  return referenced || usableAtoms[fallbackIndex % Math.max(usableAtoms.length, 1)] || sourceAtoms[0];
}

function sourceSignal(atom) {
  if (!atom || atom.id === "S0") return "本题中的关键条件或资料证据";
  return `资料中的“${cleanSingleLine(atom.text, 96)}”`;
}

function finishSentence(value) {
  const text = cleanText(value, CORE_TEXT_LIMITS.pointExplanation);
  if (!text) return "";
  return /[。！？；]$/u.test(text) ? text : `${text}。`;
}

function buildPlainPointAction(subject) {
  const group = getSubjectGroup(subject);
  if (group === "science") return "做题时先圈出条件，再选关系，最后把结果放回题目检查。";
  if (group === "english") return "先找句子里的线索，再选形式，最后读一遍看句子是否自然。";
  return "先说清自己的结论，再找资料里的依据，最后说明两者为什么有关。";
}

function enrichPointExplanation(point, subject) {
  const explanation = cleanText(point?.explanation, CORE_TEXT_LIMITS.pointExplanation);
  if (!explanation) {
    const rule = cleanText(point?.principle, CORE_TEXT_LIMITS.pointRule) || "先找题目里的关键线索，再说明理由。";
    return cleanText(`这条重点想告诉你：${rule} ${buildPlainPointAction(subject)}`, CORE_TEXT_LIMITS.pointExplanation);
  }

  const sentenceCount = (explanation.match(/[。！？]/gu) || []).length;
  if (explanation.length >= 68 || sentenceCount >= 2) return explanation;
  return cleanText(`${finishSentence(explanation)}${buildPlainPointAction(subject)}`, CORE_TEXT_LIMITS.pointExplanation);
}

function hasUsefulPointExample(value) {
  const text = cleanText(value, 120);
  if (!text || /^S\d+(?:-\d+)?$/iu.test(text)) return false;
  return text.length >= 16 || /(?:例如|比如|如：|→|=|＝|“)/u.test(text);
}

function buildPointExample(point, index, subject, sourceAtoms) {
  const atom = getReferencedSourceAtom(sourceAtoms, point.sourceRefs, index);
  const sourceText = cleanSingleLine(atom?.text, 64);
  const evidence = sourceText ? `资料中提到“${sourceText}”` : "题目里给出的关键信息";
  const group = getSubjectGroup(subject);
  const nextStep = group === "science"
    ? "先把条件圈出来，再用规则判断能不能这样算或这样选。"
    : group === "english"
      ? "先找句子里的线索，再判断它在这里想表达什么和该用什么形式。"
      : "先用这条信息说出结论，再补一句它为什么能支持结论。";
  return cleanText(`例子：${evidence}。${nextStep}`, 120);
}

function hasUsefulMemoryTip(value) {
  const text = cleanSingleLine(value, 72);
  return text.length >= 6 && !/^(?:记住|重点|同上|见上文|暂无)$/u.test(text);
}

function buildPointMemoryTip(subject) {
  const group = getSubjectGroup(subject);
  if (group === "science") return "找条件 → 选关系 → 做检查。";
  if (group === "english") return "找线索 → 选形式 → 再回读。";
  return "先结论 → 再依据 → 说关系。";
}

function hasUsefulRetrievalQuestion(value) {
  const text = cleanText(value, 100);
  return text.length >= 12 && !/^(?:想一想|自己检查|复习本课)$/u.test(text);
}

function buildPointRetrievalQuestion(point, subject) {
  const title = cleanSingleLine(point?.title, CORE_TEXT_LIMITS.pointTitle) || "这条规则";
  const group = getSubjectGroup(subject);
  if (group === "science") return `不看讲解，说出“${title}”要先核对哪些条件，最后怎样检查。`;
  if (group === "english") return `不看讲解，说出“${title}”要先找哪两个句子线索，再检查什么。`;
  return `不看讲解，说出“${title}”的结论、资料依据和它们之间的关系。`;
}

// 对模型的短输出补齐学生真正需要的例子、记忆提示和检查动作，避免资料编号或空话直接出现在页面上。
function enrichKeyPointTeachingCoverage(material) {
  const subject = material?.meta?.subject || "";
  const sourceAtoms = asArray(material?.sourceAtoms);

  return {
    ...material,
    keyPoints: asArray(material?.keyPoints).map((point, index) => ({
      ...point,
      explanation: enrichPointExplanation(point, subject),
      example: hasUsefulPointExample(point?.example)
        ? cleanText(point.example, 120)
        : buildPointExample(point, index, subject, sourceAtoms),
      memoryTip: hasUsefulMemoryTip(point?.memoryTip)
        ? cleanSingleLine(point.memoryTip, 72)
        : buildPointMemoryTip(subject),
      retrievalQuestion: hasUsefulRetrievalQuestion(point?.retrievalQuestion)
        ? cleanText(point.retrievalQuestion, 100)
        : buildPointRetrievalQuestion(point, subject),
      diagnostic: normalizePointDiagnostic(
        point?.diagnostic,
        buildPointDiagnostic(point, index, subject, sourceAtoms)
      )
    }))
  };
}

function buildPointDiagnostic(point, index, subject, sourceAtoms) {
  const atom = getReferencedSourceAtom(sourceAtoms, point.sourceRefs, index);
  const signal = sourceSignal(atom);
  const group = getSubjectGroup(subject);

  if (group === "science") {
    return {
      prompt: `${signal}。先不看讲解：题干一旦改变其中一个条件，你准备先核对哪一项，再决定“${point.title}”还能不能直接使用？`,
      expected: `先写出对象、条件和变化方向，再用“${point.principle}”判断；结论必须能回到题干条件。`,
      trap: "看到熟悉公式、图像或关键词就直接套用，忽略范围、符号、单位或已知条件是否变化。",
      repair: `回到“何时使用”，把题干条件逐条对照；只重做“选关系前的判断”这一步。`
    };
  }

  if (group === "english") {
    return {
      prompt: `${signal}。先不看讲解：遇到“${point.title}”时，你会先找哪两个句子线索，再决定能不能这样用？`,
      expected: `先看“${point.useWhen}”，再用“${point.principle}”做判断；最后按“${point.boundary}”检查。`,
      trap: "只看到熟悉单词或句型就下结论，忽略句子里的时间、对象、搭配或表达目的。",
      repair: `回到“何时使用”，圈出两个线索；再按“${point.boundary}”检查一次。`
    };
  }

  return {
    prompt: `${signal}。先不看讲解：你准备选哪一条具体信息作为依据，才能完成“${point.title}”的判断，而不是只给结论？`,
    expected: `先写出观点或结论，再用“${point.principle}”把一条资料依据和解释关系连接起来。`,
    trap: "只摘抄资料、堆砌术语，或把时间先后直接当成因果而没有说明关系。",
    repair: "回到资料证据，补写“这条信息说明了什么，所以能支持什么结论”。"
  };
}

function buildDecisionFork(example, index, subject, sourceAtoms) {
  const atom = getReferencedSourceAtom(sourceAtoms, example.sourceRefs, index);
  const signal = sourceSignal(atom);
  const group = getSubjectGroup(subject);

  if (group === "science") {
    return {
      temptingMove: `看到${signal}后，马上列式、代数或套用熟悉关系。`,
      whyItFails: "这会跳过条件匹配；即使计算正确，也可能把不满足前提的关系用到了题目上。",
      recoveryMove: `回到“${example.decisionRule}”，先圈出条件并写明每个条件如何进入关系式。`
    };
  }

  if (group === "english") {
    return {
      temptingMove: `看到${signal}后，直接按熟悉词义翻译或照搬原句结构。`,
      whyItFails: "表达是否正确取决于当前语境与功能；换了人物、时间或目的后，原形式可能不再适用。",
      recoveryMove: `回到“${example.decisionRule}”，先写清语境和功能，再决定词义、时态与搭配。`
    };
  }

  return {
    temptingMove: `看到${signal}后，直接摘抄它或给出一个标签式结论。`,
    whyItFails: "材料本身不是答案；还需要说明这条证据如何支持观点，以及结论适用到什么范围。",
    recoveryMove: `回到“${example.decisionRule}”，按“观点—证据—解释—范围”补齐中间推理。`
  };
}

function buildOutputFrame(subject) {
  const group = getSubjectGroup(subject);
  if (group === "science") {
    return ["写出题干中的对象、条件与未知量", "写出调用的关系或方法，并说明条件为什么满足", "写出结论，再完成代回、范围或边界检查"];
  }
  if (group === "english") {
    return ["写出决定含义的语境线索", "写出表达功能和需要保留的结构", "写出新句或答案，再回读检查时态、搭配与语义"];
  }
  return ["先直接回应问题，写出观点或结论", "补一条具体资料证据并说明它的作用", "补上解释关系和必要的对象、时间或范围限定"];
}

function addDepthScaffolds(material) {
  return enrichKeyPointTeachingCoverage({
    ...material,
    keyPoints: material.keyPoints.map((point, index) => ({
      ...point,
      diagnostic: point.diagnostic || buildPointDiagnostic(point, index, material.meta.subject, material.sourceAtoms)
    })),
    workedExamples: material.workedExamples.map((example, index) => ({
      ...example,
      decisionFork: example.decisionFork || buildDecisionFork(example, index, material.meta.subject, material.sourceAtoms)
    })),
    masteryChecks: material.masteryChecks.map((check) => ({
      ...check,
      outputFrame: check.outputFrame || buildOutputFrame(material.meta.subject)
    }))
  });
}

function composeComprehensiveMaterial(material) {
  const coreModel = material.overview?.coreModel || {};
  const knowledgeMap = material.knowledgeMap || {};
  const knowledgeNodes = ensureKnowledgeNodeMinimum(knowledgeMap.nodes)
    .map((node) => ({ ...node, members: asArray(node?.members) }))
    .slice(0, CORE_CONTENT_LIMITS.knowledgeNodes);
  const scopeType = normalizeKnowledgeScopeType(knowledgeMap.scopeType, knowledgeNodes);
  const allPractice = asArray(material.practice);
  const corePractice = allPractice.length > CORE_CONTENT_LIMITS.practice
    ? [...allPractice.slice(0, CORE_CONTENT_LIMITS.practice - 1), allPractice.at(-1)]
    : allPractice;

  return {
    ...material,
    overview: {
      ...material.overview,
      outline: asArray(material.overview?.outline).slice(0, 4),
      coreModel: {
        ...coreModel,
        reasoningChain: asArray(coreModel.reasoningChain).slice(0, 3),
        boundaries: asArray(coreModel.boundaries).slice(0, 2)
      }
    },
    quickStart: {
      ...material.quickStart,
      prerequisites: asArray(material.quickStart?.prerequisites).slice(0, 2),
      studyPlan: asArray(material.quickStart?.studyPlan).slice(0, 3)
    },
    knowledgeMap: {
      ...knowledgeMap,
      scopeType,
      scope: cleanText(knowledgeMap.scope, 240) || `围绕“${material.meta?.title || knowledgeMap.center || "本知识点"}”覆盖当前学习阶段需要掌握的完整主流框架。`,
      coverageSummary: verifiedCoverageSummary(scopeType, knowledgeNodes, knowledgeMap.coverageSummary),
      coverageDimensions: asArray(knowledgeMap.coverageDimensions).length
        ? asArray(knowledgeMap.coverageDimensions).slice(0, 8)
        : [...DEFAULT_COVERAGE_DIMENSIONS],
      nodes: knowledgeNodes
    },
    keyPoints: asArray(material.keyPoints).slice(0, CORE_CONTENT_LIMITS.keyPoints),
    workedExamples: asArray(material.workedExamples).slice(0, CORE_CONTENT_LIMITS.workedExamples),
    practice: corePractice,
    masteryChecks: asArray(material.masteryChecks).slice(0, CORE_CONTENT_LIMITS.masteryChecks),
    strategyCards: asArray(material.strategyCards).slice(0, CORE_CONTENT_LIMITS.strategyCards),
    closeReading: asArray(material.closeReading).slice(0, CORE_CONTENT_LIMITS.closeReading),
    concepts: asArray(material.concepts).slice(0, CORE_CONTENT_LIMITS.concepts),
    knowledgeDiagrams: asArray(material.knowledgeDiagrams).slice(0, CORE_CONTENT_LIMITS.knowledgeDiagrams),
    teachingFigures: asArray(material.teachingFigures).slice(0, CORE_CONTENT_LIMITS.teachingFigures),
    visuals: asArray(material.visuals).slice(0, CORE_CONTENT_LIMITS.visuals),
    mistakes: asArray(material.mistakes).slice(0, CORE_CONTENT_LIMITS.mistakes),
    reviewPlan: asArray(material.reviewPlan).slice(0, CORE_CONTENT_LIMITS.reviewPlan)
  };
}

export function createMaterialTemplate({ sources = [], options = {} } = {}) {
  const title = deriveTitle(sources);
  const excerpts = deriveExcerpts(sources);
  const sourceText = sources.map((source) => source.text).join(" ");
  const subject = inferSubject(sourceText, options.subject);
  const grade = options.grade || "初中";
  const sourceAtoms = extractSourceAtoms(sources, subject);
  const fastLearning = createFastLearningModules({ title, subject });
  const deepStudy = applyGoalProfile(createDeepStudyDefaults({
    title,
    subject,
    sourceAtoms,
    goal: options.goal || "understand"
  }), options.goal || "understand");

  const legacy = {
    meta: {
      title,
      subject,
      grade,
      estimatedMinutes: options.depth === "standard" ? 28 : 42,
      difficulty: "循序渐进",
      summary: "先建立全局理解，再逐层拆解重点，最后用练习和复习计划把知识真正留下来。"
    },
    learningGoals: [
      { level: "理解", text: `用自己的话说清《${title}》的主要内容与核心问题。` },
      { level: "分析", text: "找出关键语句，理解内容、结构与表达方法之间的联系。" },
      { level: "应用", text: "完成由浅入深的练习，并能把方法迁移到相似材料。" },
      { level: "复盘", text: "借助知识地图和间隔复习计划，形成长期记忆。" }
    ],
    overview: {
      coreQuestion: `学习《${title}》时，最重要的不是背下结论，而是看懂作者或教材如何一步步把观点讲清楚。`,
      readingTip: "先通读标题、首尾和段落中心句，再带着问题回到细节。每读完一部分，停下来用一句话概括。",
      outline: ["快速通读，确定主题", "按结构拆分信息", "精读关键内容", "练习并回看薄弱点"]
    },
    quickStart: fastLearning.quickStart,
    knowledgeMap: {
      center: title,
      nodes: [
        { label: "内容主线", detail: "谁、什么、怎样发展" },
        { label: "核心概念", detail: "必须准确理解的词句" },
        { label: "结构方法", detail: "信息之间如何组织" },
        { label: "表达作用", detail: "为什么这样写或这样说明" },
        { label: "迁移应用", detail: "怎样用于新题和新材料" }
      ]
    },
    keyPoints: [
      {
        title: "先抓主线，再看细节",
        explanation: "主线像一根绳子，把人物、事件、概念和论证串起来。没有主线，细节就会变成互不相干的碎片。",
        example: excerpts[0],
        memoryTip: "用“对象—变化—结果”三个词复述全文。",
        importance: "必会"
      },
      {
        title: "关键词要放回语境",
        explanation: "词语的真正含义由上下文决定。先看它附近写了什么，再判断它表达的态度、特点或关系。",
        example: excerpts[1],
        memoryTip: "圈词 → 找上下句 → 换成自己的话。",
        importance: "重点"
      },
      {
        title: "结构本身也在表达",
        explanation: "开头、转折、照应和结尾不是形式装饰，它们决定读者先看到什么、后理解什么。",
        example: excerpts[2],
        memoryTip: "每一部分旁边写下：这一段为什么放在这里？",
        importance: "重点"
      },
      {
        title: "从理解走向迁移",
        explanation: "真正掌握一个知识点，需要在新材料中再次识别和使用，而不只是记住原文答案。",
        example: excerpts[3] || title,
        memoryTip: "学完后自己出一道相似题，是最快的检验。",
        importance: "提升"
      }
    ],
    workedExamples: fastLearning.workedExamples,
    closeReading: [
      {
        heading: "第一处：确定阅读对象",
        original: excerpts[0],
        explanation: "这句话提供了进入材料的第一把钥匙。阅读时要标出对象、动作或概念，并判断它承担的是开篇提示还是核心说明。",
        question: "如果删去其中一个关键词，原意会发生什么变化？"
      },
      {
        heading: "第二处：寻找信息转折",
        original: excerpts[1],
        explanation: "转折前后往往对应表面与本质、原因与结果或不同观点，是考试中最容易设题的位置。",
        question: "这部分与上文是什么关系？请用一个关联词概括。"
      },
      {
        heading: "第三处：回到学习结论",
        original: excerpts[2],
        explanation: "结尾不只重复内容，还可能深化主题、提出行动或与开头形成照应。",
        question: "用不超过 20 个字写出这部分带给你的启示。"
      }
    ],
    concepts: [
      { term: "主线", definition: "贯穿全文、连接主要信息的发展路径。", example: "把每段概括连起来，就能看到主线。" },
      { term: "语境", definition: "词句所在的上下文和具体使用环境。", example: "同一个词在不同句子中可能含义不同。" },
      { term: "照应", definition: "前后内容相互呼应，使结构完整、重点突出。", example: "结尾再次提到开头的事物。" },
      { term: "迁移", definition: "把已经学会的方法用于新的材料或问题。", example: "用本课的概括方法阅读另一篇文章。" }
    ],
    visuals: [
      {
        type: "flow",
        title: "一遍看懂的阅读路径",
        caption: "每一步只完成一个任务，避免反复低效重读。",
        items: ["看标题与首尾", "划分内容层次", "标记关键词句", "用自己的话复述", "练习检验理解"]
      },
      {
        type: "compare",
        title: "低效阅读与高效学习",
        caption: "把“看过”升级为“能解释、会应用”。",
        leftTitle: "容易踩坑",
        rightTitle: "推荐做法",
        leftItems: ["从头到尾反复读", "只抄标准答案", "不会的地方先跳过"],
        rightItems: ["带着问题分层阅读", "先自己概括再对照", "记录疑问并及时验证"]
      }
    ],
    mistakes: [
      {
        wrong: "把细节罗列当成内容概括。",
        right: "先说主要对象和核心变化，再补最关键的结果。",
        reason: "概括考查信息压缩，不是把原文换一种顺序抄写。"
      },
      {
        wrong: "回答表达作用时只写“生动形象”。",
        right: "指出具体写法、写出了什么、对主题或结构有什么作用。",
        reason: "作用题需要“方法 + 内容 + 效果”的完整证据链。"
      },
      {
        wrong: "看完解析就认为自己已经掌握。",
        right: "合上讲义复述一次，再独立完成一道迁移题。",
        reason: "识别答案比主动回忆容易，只有主动输出才能检验掌握。"
      }
    ],
    practice: [
      {
        type: "理解题",
        question: `请用 30—50 个字概括《${title}》的主要内容。`,
        options: [],
        answer: "答案应包含主要对象、核心内容或变化，以及最终结果；不要逐段罗列。",
        explanation: "先写一句主干，再检查人物、事件或概念是否齐全。",
        difficulty: "基础"
      },
      {
        type: "选择题",
        question: "下面哪一种阅读顺序更适合第一次学习？",
        options: ["先背答案，再看原文", "先看标题首尾，再划分层次", "逐字查词，不看整体", "只阅读加粗部分"],
        answer: "B．先看标题首尾，再划分层次。",
        explanation: "第一次阅读的目标是搭建整体框架，细节应放到第二遍精读。",
        difficulty: "基础"
      },
      {
        type: "分析题",
        question: "任选一处关键句，说明它在内容和结构上的作用。",
        options: [],
        answer: "先指出句子写了什么，再说明它承接、转折、铺垫、照应或点题等结构作用。",
        explanation: "不要只写抽象术语，要把术语与原文信息对应起来。",
        difficulty: "进阶"
      },
      {
        type: "迁移题",
        question: "给同学设计一个 3 步阅读提示，帮助他快速看懂一篇相似材料。",
        options: [],
        answer: "示例：①读标题首尾猜主题；②给每部分写一句概括；③圈出转折和反复出现的关键词。",
        explanation: "能把方法讲给别人，说明你已经从知识记忆走向方法迁移。",
        difficulty: "提升"
      },
      {
        type: "自测题",
        question: "不看讲义，用一分钟口头复述今天学到的三个关键点。",
        options: [],
        answer: "复述应至少覆盖内容主线、一个重点方法和一个易错提醒。",
        explanation: "限时主动回忆能迅速暴露记忆空白。",
        difficulty: "复盘"
      }
    ],
    masteryChecks: [
      {
        level: "复述",
        task: `合上讲义，用 60 秒讲清《${title}》的核心问题、两个重点和一条关键关系。`,
        criteria: "不看提示，内容准确，至少说出 3 个彼此有关的要点。",
        ifStuck: "只回看知识地图，遮住说明后沿节点重新复述。"
      },
      {
        level: "应用",
        task: "独立完成一道同类型练习，并把每一步所依据的知识写在旁边。",
        criteria: "答案正确或基本正确，步骤完整，能解释所用方法而不是只给结论。",
        ifStuck: "回到例题拆解，只看策略与步骤标题，再重新尝试。"
      },
      {
        level: "迁移",
        task: "换一份相似但情境不同的材料，独立判断应使用哪个重点并完成说明。",
        criteria: "能识别变化与不变条件，方法选择合理，结论有证据或检查过程。",
        ifStuck: "对照易错提醒，找出是概念、条件、步骤还是表达环节出现问题。"
      }
    ],
    reviewPlan: [
      { day: "现在", task: "合上讲义，依次复述三个关键判断", duration: "3 分钟" },
      { day: "今晚", task: "重做一题，并订正易错原因", duration: "8 分钟" },
      { day: "第 2 天", task: "只看标题，默写 4 个重点", duration: "6 分钟" },
      { day: "第 7 天", task: "找一份新材料完成迁移练习", duration: "12 分钟" }
    ],
    sourceFiles: sources.map((source) => ({
      name: cleanSingleLine(source.name, 180),
      kind: source.kind,
      size: source.size || 0
    }))
  };

  const material = addDepthScaffolds({
    ...legacy,
    learningGoals: deepStudy.learningGoals,
    overview: {
      ...deepStudy.overview,
      coreModel: deepStudy.coreModel
    },
    knowledgeMap: deepStudy.knowledgeMap,
    keyPoints: deepStudy.keyPoints,
    strategyCards: deepStudy.strategyCards,
    workedExamples: enrichWorkedExamples(fastLearning.workedExamples, sourceAtoms.slice(0, 2).map((atom) => atom.id), subject),
    closeReading: deepStudy.closeReading,
    concepts: deepStudy.concepts,
    knowledgeDiagrams: createDefaultKnowledgeDiagrams(title, subject, deepStudy.knowledgeMap),
    visuals: createDefaultVisuals(subject, deepStudy.overview.outline),
    mistakes: deepStudy.mistakes,
    practice: deepStudy.practice,
    masteryChecks: deepStudy.masteryChecks,
    sourceAtoms,
    sourceEvidence: sourceEvidenceStatus(sourceAtoms)
  });

  const completedMaterial = completeLearningGraph(composeComprehensiveMaterial(material));
  completedMaterial.teachingFigures = normalizeTeachingFigures([], completedMaterial);
  return sanitizeMaterialCopy(completedMaterial);
}

function textOrFallback(value, fallback, maxLength, minimumLength = 1) {
  const text = cleanText(value, maxLength);
  const fallbackText = cleanText(fallback, maxLength);
  return text.length >= minimumLength ? text : fallbackText;
}

function normalizedTextList(items, fallback, minimum, maximum, maxLength) {
  return limitedItems(items, fallback, minimum, maximum, (item) => cleanText(item, maxLength));
}

function normalizePointDiagnostic(value, fallback) {
  const input = value && typeof value === "object" ? value : {};
  const base = fallback || {
    prompt: "先判断本题最关键的条件或证据。",
    expected: "写出条件、依据和结论之间的关系。",
    trap: "不要只凭关键词直接下结论。",
    repair: "回到题干或资料，补出缺失的条件或依据。"
  };
  return {
    prompt: textOrFallback(input.prompt, base.prompt, 300, 12),
    expected: textOrFallback(input.expected, base.expected, 300, 12),
    trap: textOrFallback(input.trap, base.trap, 260, 10),
    repair: textOrFallback(input.repair, base.repair, 240, 10)
  };
}

function normalizeDecisionFork(value, fallback) {
  const input = value && typeof value === "object" ? value : {};
  const base = fallback || {
    temptingMove: "直接套用熟悉方法。",
    whyItFails: "没有先确认条件或证据是否匹配。",
    recoveryMove: "回到判断规则，补出关键条件和依据。"
  };
  return {
    temptingMove: textOrFallback(input.temptingMove, base.temptingMove, 260, 10),
    whyItFails: textOrFallback(input.whyItFails, base.whyItFails, 280, 12),
    recoveryMove: textOrFallback(input.recoveryMove, base.recoveryMove, 260, 10)
  };
}

function normalizeOutputFrame(value, fallback) {
  const base = asArray(fallback).length ? fallback : ["写出关键信息", "写出判断依据", "写出结论和检查"];
  return normalizedTextList(value, base, 3, 4, 180);
}

function normalizeSourceAtoms(atoms, fallback = []) {
  const seen = new Set();
  const normalized = asArray(atoms).map((atom, index) => {
    const id = cleanSingleLine(atom?.id, 24).toUpperCase();
    const text = cleanSingleLine(atom?.text, 260);
    if (!/^S\d+(?:-\d+)?$/u.test(id) || !text || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      sourceName: cleanSingleLine(atom?.sourceName, 80) || "资料",
      text,
      label: cleanSingleLine(atom?.label, 80) || `资料要点 ${index + 1}`,
      kind: cleanSingleLine(atom?.kind, 24) || "fact"
    };
  }).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function hasUsableSourceAtoms(sourceAtoms) {
  return sourceAtoms.some((atom) => atom.id !== "S0");
}

function resolveSourceRefId(value, sourceAtoms) {
  const reference = cleanSingleLine(value, 280);
  if (!reference) return "";
  const matchedId = reference.match(/^S\d+(?:-\d+)?/iu)?.[0]?.toUpperCase();
  if (matchedId) {
    if (sourceAtoms.some((atom) => atom.id === matchedId)) return matchedId;
    const sourceGroup = sourceAtoms.find((atom) => atom.id.startsWith(`${matchedId}-`));
    if (sourceGroup) return sourceGroup.id;
  }
  const matchingAtom = sourceAtoms.find((atom) => (
    atom.text === reference
    || atom.text.includes(reference)
    || reference.includes(atom.text)
  ));
  return matchingAtom?.id || "";
}

function normalizeSourceRefs(items, fallback, sourceAtoms, minimum = 1, maximum = 2) {
  const references = [];
  const add = (value) => {
    const id = resolveSourceRefId(value, sourceAtoms);
    if (id && !references.includes(id) && references.length < maximum) references.push(id);
  };
  asArray(items).forEach(add);
  if (references.length < minimum) asArray(fallback).forEach(add);
  if (references.length < minimum) sourceAtoms.forEach((atom) => add(atom.id));
  return references;
}

function withGraphEntityMetadata(material) {
  const sourceAtoms = asArray(material.sourceAtoms);
  const withRefs = (items, prefix) => assignStableEntityIds(items, prefix).map((item, index) => ({
    ...item,
    sourceRefs: normalizeSourceRefs(
      item?.sourceRefs,
      [sourceRefForIndex(sourceAtoms, index)],
      sourceAtoms,
      1,
      2
    )
  }));
  const withSourceRefs = (items) => asArray(items).map((item, index) => ({
    ...item,
    sourceRefs: normalizeSourceRefs(
      item?.sourceRefs,
      [sourceRefForIndex(sourceAtoms, index)],
      sourceAtoms,
      1,
      2
    )
  }));

  return {
    ...material,
    learningGoals: withRefs(material.learningGoals, "G"),
    knowledgeMap: {
      ...material.knowledgeMap,
      nodes: withRefs(material.knowledgeMap?.nodes, "N")
    },
    keyPoints: withRefs(material.keyPoints, "K"),
    strategyCards: withSourceRefs(material.strategyCards),
    workedExamples: withRefs(material.workedExamples, "E"),
    closeReading: withSourceRefs(material.closeReading),
    practice: withRefs(material.practice, "P"),
    masteryChecks: withRefs(material.masteryChecks, "M")
  };
}

function ensureEvidenceInTargets(targets, sourceRef) {
  if (asArray(targets).some((item) => asArray(item?.sourceRefs).includes(sourceRef))) return;
  const candidate = asArray(targets)
    .filter((item) => item && asArray(item.sourceRefs).length < 4)
    .sort((left, right) => {
      const lengthDifference = asArray(left.sourceRefs).length - asArray(right.sourceRefs).length;
      if (lengthDifference) return lengthDifference;
      return String(left.id).localeCompare(String(right.id));
    })[0];
  appendSourceRef(candidate, sourceRef);
}

function ensureSourceEvidenceCoverage(material) {
  const usableSourceRefs = asArray(material.sourceAtoms)
    .filter((atom) => atom?.id && atom.id !== "S0")
    .map((atom) => atom.id);
  const teachingTargets = [...asArray(material.keyPoints), ...asArray(material.workedExamples)];
  const activeTargets = [...asArray(material.practice), ...asArray(material.masteryChecks)];

  usableSourceRefs.forEach((sourceRef) => {
    ensureEvidenceInTargets(teachingTargets, sourceRef);
    ensureEvidenceInTargets(activeTargets, sourceRef);
  });
  return material;
}

function findGraphEntities(entities, ids) {
  const lookup = new Map(asArray(entities).map((item) => [item.id, item]));
  return asArray(ids).map((id) => lookup.get(id)).filter(Boolean);
}

function sourceFocusText(sourceAtoms, sourceRefs) {
  const lookup = new Map(asArray(sourceAtoms).map((atom) => [atom.id, atom]));
  return asArray(sourceRefs)
    .map((reference) => {
      const atom = lookup.get(reference);
      return atom ? `${atom.id}：${atom.label}` : "";
    })
    .filter(Boolean)
    .join("；");
}

function getRouteEntities(material, route) {
  return [
    ...findGraphEntities(material.knowledgeMap?.nodes, route.knowledgeNodeIds),
    ...findGraphEntities(material.keyPoints, route.keyPointIds),
    ...findGraphEntities(material.workedExamples, route.exampleIds),
    ...findGraphEntities(material.practice, route.practiceIds),
    ...findGraphEntities(material.masteryChecks, route.masteryCheckIds)
  ];
}

function synchronizeRouteEvidence(material) {
  const exampleUsage = new Map();
  const firstRouteByExample = new Map();
  material.learningRoute.forEach((route, routeIndex) => {
    asArray(route.exampleIds).forEach((id) => exampleUsage.set(id, (exampleUsage.get(id) || 0) + 1));
    asArray(route.exampleIds).forEach((id) => {
      if (!firstRouteByExample.has(id)) firstRouteByExample.set(id, routeIndex);
    });
  });

  material.learningRoute = material.learningRoute.map((route, index) => {
    const connectedEntities = getRouteEntities(material, route);
    const connectedRefs = entitySourceRefs(connectedEntities);
    const sourceRefs = uniqueSourceRefs([route.sourceRefs, connectedRefs]);
    const anchor = sourceRefs[0] || sourceRefForIndex(material.sourceAtoms, index);
    connectedEntities.forEach((entity) => appendSourceRef(entity, anchor));
    const normalizedRefs = uniqueSourceRefs([anchor, sourceRefs]);
    const sharedExample = findGraphEntities(material.workedExamples, route.exampleIds)[0];
    const isSharedExample = asArray(route.exampleIds).some((id) => (
      (exampleUsage.get(id) || 0) > 1 && firstRouteByExample.get(id) !== index
    ));

    return {
      ...route,
      sourceRefs: normalizedRefs,
      evidenceFocus: textOrFallback(
        route.evidenceFocus,
        sourceFocusText(material.sourceAtoms, normalizedRefs) || "回到本路线关联的资料证据完成判断。",
        120,
        6
      ),
      sharedExampleReason: isSharedExample
        ? textOrFallback(
          route.sharedExampleReason,
          `示范“${sharedExample?.title || "核心示范"}”被复用，是因为它训练的判断规则可直接迁移到本目标；本路线仍要求完成专属独立练习。`,
          100,
          12
        )
        : ""
    };
  });
  return material;
}

function buildSourceCoverage(material) {
  const sourceAtoms = asArray(material.sourceAtoms).filter((atom) => atom?.id && atom.id !== "S0");
  if (!sourceAtoms.length) {
    return {
      status: "资料不足",
      total: 0,
      covered: 0,
      missingTeaching: [],
      missingActive: [],
      evidence: []
    };
  }

  const teachingTargets = [...asArray(material.keyPoints), ...asArray(material.workedExamples)];
  const activeTargets = [...asArray(material.practice), ...asArray(material.masteryChecks)];
  const evidence = sourceAtoms.map((atom) => ({
    id: atom.id,
    teachingIds: teachingTargets.filter((item) => asArray(item.sourceRefs).includes(atom.id)).map((item) => item.id),
    activeTaskIds: activeTargets.filter((item) => asArray(item.sourceRefs).includes(atom.id)).map((item) => item.id)
  }));
  const missingTeaching = evidence.filter((item) => !item.teachingIds.length).map((item) => item.id);
  const missingActive = evidence.filter((item) => !item.activeTaskIds.length).map((item) => item.id);

  return {
    status: missingTeaching.length || missingActive.length ? "待补齐" : "完整覆盖",
    total: sourceAtoms.length,
    covered: evidence.filter((item) => item.teachingIds.length && item.activeTaskIds.length).length,
    missingTeaching,
    missingActive,
    evidence
  };
}

function buildLearningGraphStatus(material) {
  const idsByType = {
    goal: new Set(asArray(material.learningGoals).map((item) => item.id)),
    node: new Set(asArray(material.knowledgeMap?.nodes).map((item) => item.id)),
    point: new Set(asArray(material.keyPoints).map((item) => item.id)),
    example: new Set(asArray(material.workedExamples).map((item) => item.id)),
    practice: new Set(asArray(material.practice).map((item) => item.id)),
    mastery: new Set(asArray(material.masteryChecks).map((item) => item.id))
  };
  const issues = [];
  const routes = asArray(material.learningRoute);

  if (routes.length !== material.learningGoals.length) issues.push("学习路线数量与学习目标不一致");
  routes.forEach((route) => {
    if (!idsByType.goal.has(route.goalId)) issues.push(`${route.id} 缺少有效学习目标`);
    const requirements = [
      ["知识节点", route.knowledgeNodeIds, idsByType.node],
      ["重点", route.keyPointIds, idsByType.point],
      ["示范", route.exampleIds, idsByType.example],
      ["练习", route.practiceIds, idsByType.practice],
      ["掌握证明", route.masteryCheckIds, idsByType.mastery]
    ];
    requirements.forEach(([label, values, available]) => {
      if (!asArray(values).length || asArray(values).some((value) => !available.has(value))) {
        issues.push(`${route.id} 缺少有效${label}关联`);
      }
    });
  });

  return {
    status: issues.length ? "待修复" : "完整闭环",
    goalCount: material.learningGoals.length,
    routeCount: routes.length,
    issues
  };
}

function normalizeLearningRoute(items, fallback, sourceAtoms, material) {
  const candidates = asArray(items);
  const routeIds = new Set();
  const goalsById = new Map(asArray(material.learningGoals).map((goal) => [goal.id, goal]));
  const usedCandidateIndexes = new Set();

  return fallback.map((base, index) => {
    let candidateIndex = candidates.findIndex((candidate, itemIndex) => (
      !usedCandidateIndexes.has(itemIndex) && cleanSingleLine(candidate?.goalId, 24).toUpperCase() === base.goalId
    ));
    if (candidateIndex < 0 && !usedCandidateIndexes.has(index)) candidateIndex = index;
    if (candidateIndex >= 0) usedCandidateIndexes.add(candidateIndex);
    const item = candidateIndex >= 0 ? candidates[candidateIndex] : {};
    const goal = goalsById.get(base.goalId) || base;
    const knowledgeNodeIds = normalizeGraphEntityIds(
      item?.knowledgeNodeIds || item?.knowledgeNodeRefs,
      base.knowledgeNodeIds,
      material.knowledgeMap?.nodes
    );
    const keyPointIds = normalizeGraphEntityIds(item?.keyPointIds || item?.keyPointRefs, base.keyPointIds, material.keyPoints);
    const exampleIds = normalizeGraphEntityIds(item?.exampleIds || item?.exampleRefs, base.exampleIds, material.workedExamples, 1, 2);
    const practiceIds = normalizeGraphEntityIds(item?.practiceIds || item?.practiceRefs, base.practiceIds, material.practice, 1, 3);
    const masteryCheckIds = normalizeGraphEntityIds(
      item?.masteryCheckIds || item?.masteryCheckRefs,
      base.masteryCheckIds,
      material.masteryChecks,
      1,
      1
    );
    const connectedEntities = [
      ...findGraphEntities(material.knowledgeMap?.nodes, knowledgeNodeIds),
      ...findGraphEntities(material.keyPoints, keyPointIds),
      ...findGraphEntities(material.workedExamples, exampleIds),
      ...findGraphEntities(material.practice, practiceIds),
      ...findGraphEntities(material.masteryChecks, masteryCheckIds)
    ];

    return {
      id: getStableEntityId(item?.id, base.id, "R", index, routeIds),
      goalId: base.goalId,
      goalLevel: goal.level || base.goalLevel,
      goal: goal.text || base.goal,
      knowledgeNodeIds,
      keyPointIds,
      exampleIds,
      practiceIds,
      masteryCheckIds,
      focus: textOrFallback(item?.focus, base.focus, CORE_TEXT_LIMITS.routeFocus, 4),
      action: textOrFallback(item?.action, base.action, CORE_TEXT_LIMITS.routeAction, 10),
      proof: textOrFallback(item?.proof, base.proof, CORE_TEXT_LIMITS.routeProof, 10),
      sourceRefs: uniqueSourceRefs([
        normalizeSourceRefs(item?.sourceRefs, base.sourceRefs, sourceAtoms, 1, 2),
        entitySourceRefs(connectedEntities)
      ]),
      evidenceFocus: cleanText(item?.evidenceFocus, 120),
      sharedExampleReason: cleanText(item?.sharedExampleReason, 100)
    };
  });
}

function completeLearningGraph(material, requestedRoutes = []) {
  const graphMaterial = ensureSourceEvidenceCoverage(withGraphEntityMetadata(material));
  const fallbackRoutes = buildLearningRoute(graphMaterial);
  graphMaterial.learningRoute = normalizeLearningRoute(
    requestedRoutes,
    fallbackRoutes,
    graphMaterial.sourceAtoms,
    graphMaterial
  );
  synchronizeRouteEvidence(graphMaterial);
  graphMaterial.sourceCoverage = buildSourceCoverage(graphMaterial);
  graphMaterial.learningGraph = buildLearningGraphStatus(graphMaterial);
  return graphMaterial;
}

function normalizeOption(value) {
  let option = cleanSingleLine(value, 160);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = option.replace(/^(?:(?:dishonesty|作弊)\s+)?[A-F][.、．:：]\s*/iu, "");
    if (next === option) break;
    option = next;
  }
  return option;
}

function normalizeQuickStartPlan(items, fallback) {
  const plan = limitedItems(items, fallback, 3, 5, (item) => ({
    requestedMinutes: Math.min(10, Math.max(1, Number(item?.minutes) || 1)),
    task: textOrFallback(item?.task, "完成一个明确学习动作。", 180, 8),
    outcome: textOrFallback(item?.outcome, "得到可核对的学习产出。", 120, 5)
  }));
  const minutes = plan.map(() => 1);
  let remaining = Math.max(0, 5 - plan.length);
  const priority = plan
    .map((item, index) => ({ index, requestedMinutes: item.requestedMinutes }))
    .sort((left, right) => right.requestedMinutes - left.requestedMinutes);

  while (remaining > 0) {
    const candidate = priority.find(({ index }) => minutes[index] < 3);
    if (!candidate) break;
    minutes[candidate.index] += 1;
    remaining -= 1;
  }

  return plan.map((item, index) => ({
    minutes: minutes[index],
    task: item.task,
    outcome: item.outcome
  }));
}

export function normalizeMaterial(raw, defaults) {
  const base = defaults || createMaterialTemplate();
  const input = raw && typeof raw === "object" ? raw : {};
  const baseSourceAtoms = normalizeSourceAtoms(base.sourceAtoms, []);
  const sourceAtoms = hasUsableSourceAtoms(baseSourceAtoms)
    ? baseSourceAtoms
    : normalizeSourceAtoms(input.sourceAtoms, baseSourceAtoms);
  const meta = input.meta && typeof input.meta === "object" ? input.meta : {};
  const overview = input.overview && typeof input.overview === "object" ? input.overview : {};
  const coreModel = input.coreModel && typeof input.coreModel === "object"
    ? input.coreModel
    : (overview.coreModel && typeof overview.coreModel === "object" ? overview.coreModel : {});
  const quickStart = input.quickStart && typeof input.quickStart === "object" ? input.quickStart : {};
  const knowledgeMap = input.knowledgeMap && typeof input.knowledgeMap === "object" ? input.knowledgeMap : {};
  const authoritativeSubject = cleanSingleLine(defaults?.meta?.subject, 30);
  const modelSubject = cleanSingleLine(meta.subject, 30);
  const normalizedSubject = authoritativeSubject || modelSubject || base.meta.subject;
  const hasSubjectConflict = Boolean(authoritativeSubject && modelSubject && authoritativeSubject !== modelSubject);
  const normalizedTitle = sanitizeMaterialTitle(hasSubjectConflict ? base.meta.title : meta.title, base.meta.title);
  const isCompleteTenseSystem = isEnglishTenseSystem({
    title: normalizedTitle,
    subject: normalizedSubject,
    center: knowledgeMap.center || base.knowledgeMap.center
  });
  const completeKnowledgeFallback = ensureKnowledgeNodeMinimum(
    isCompleteTenseSystem ? createEnglishTenseKnowledgeNodes() : base.knowledgeMap.nodes,
    isCompleteTenseSystem ? 16 : CORE_CONTENT_LIMITS.knowledgeNodesMinimum
  );
  const submittedKnowledgeNodes = asArray(knowledgeMap.nodes);
  const knowledgeNodeCandidates = isCompleteTenseSystem && submittedKnowledgeNodes.length < 16
    ? completeKnowledgeFallback
    : submittedKnowledgeNodes;
  const knowledgeNodeMinimum = isCompleteTenseSystem ? 16 : CORE_CONTENT_LIMITS.knowledgeNodesMinimum;
  const scopeType = normalizeKnowledgeScopeType(
    knowledgeMap.scopeType || base.knowledgeMap.scopeType,
    knowledgeNodeCandidates.length ? knowledgeNodeCandidates : completeKnowledgeFallback
  );
  const diagramFallback = isCompleteTenseSystem
    ? createEnglishTenseDiagrams()
    : (asArray(base.knowledgeDiagrams).length
      ? base.knowledgeDiagrams
      : createDefaultKnowledgeDiagrams(normalizedTitle, normalizedSubject, {
        center: knowledgeMap.center || base.knowledgeMap.center,
        nodes: completeKnowledgeFallback
      }));
  const submittedDiagrams = asArray(input.knowledgeDiagrams);
  const diagramCandidates = isCompleteTenseSystem && submittedDiagrams.length < 2
    ? diagramFallback
    : (submittedDiagrams.length ? submittedDiagrams : diagramFallback);

  const material = {
    meta: {
      title: normalizedTitle,
      subject: normalizedSubject,
      grade: cleanSingleLine(meta.grade, 30) || base.meta.grade,
      estimatedMinutes: Math.min(180, Math.max(10, Number(meta.estimatedMinutes) || base.meta.estimatedMinutes)),
      difficulty: cleanSingleLine(meta.difficulty, 30) || base.meta.difficulty,
      summary: cleanText(meta.summary, 160) || base.meta.summary
    },
    learningGoals: limitedItems(input.learningGoals, base.learningGoals, CORE_CONTENT_LIMITS.goals, CORE_CONTENT_LIMITS.goals, (item, index) => {
      const fallback = base.learningGoals[index % base.learningGoals.length];
      return {
        id: cleanSingleLine(item?.id, 24) || fallback.id,
        level: cleanSingleLine(item?.level, 16) || fallback.level || "理解",
        text: textOrFallback(item?.text, fallback.text, CORE_TEXT_LIMITS.goal, 10),
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms, 1, 2)
      };
    }),
    overview: {
      coreQuestion: cleanText(overview.coreQuestion, 280) || base.overview.coreQuestion,
      readingTip: cleanText(overview.readingTip, 320) || base.overview.readingTip,
      outline: limitedItems(overview.outline, base.overview.outline, 2, 3, (item) => cleanSingleLine(item, 80)),
      coreModel: {
        coreClaim: textOrFallback(coreModel.coreClaim, base.overview.coreModel.coreClaim, 260, 20),
        reasoningChain: limitedItems(coreModel.reasoningChain, base.overview.coreModel.reasoningChain, 3, 3, (item, index) => {
          const fallback = base.overview.coreModel.reasoningChain[index % base.overview.coreModel.reasoningChain.length];
          return {
            from: textOrFallback(item?.from, fallback.from, 180, 8),
            because: textOrFallback(item?.because, fallback.because, 260, 12),
            therefore: textOrFallback(item?.therefore, fallback.therefore, 220, 10)
          };
        }),
        boundaries: limitedItems(coreModel.boundaries, base.overview.coreModel.boundaries, 2, 2, (item, index) => {
          const fallback = base.overview.coreModel.boundaries[index % base.overview.coreModel.boundaries.length];
          return {
            when: textOrFallback(item?.when, fallback.when, 180, 8),
            rule: textOrFallback(item?.rule, fallback.rule, 220, 10),
            why: textOrFallback(item?.why, fallback.why, 260, 12)
          };
        }),
        confusionPair: {
          title: textOrFallback(coreModel.confusionPair?.title, base.overview.coreModel.confusionPair.title, 80, 4),
          difference: textOrFallback(coreModel.confusionPair?.difference, base.overview.coreModel.confusionPair.difference, 240, 12),
          decisionRule: textOrFallback(coreModel.confusionPair?.decisionRule, base.overview.coreModel.confusionPair.decisionRule, 180, 8)
        }
      }
    },
    quickStart: {
      prerequisites: limitedItems(quickStart.prerequisites, base.quickStart.prerequisites, 2, 2, (item) => ({
        topic: cleanSingleLine(item?.topic, 40) || "前置知识",
        check: cleanText(item?.check, 180)
      })),
      studyPlan: normalizeQuickStartPlan(quickStart.studyPlan, base.quickStart.studyPlan),
      firstChallenge: cleanText(quickStart.firstChallenge, 320) || base.quickStart.firstChallenge
    },
    knowledgeMap: {
      center: cleanSingleLine(knowledgeMap.center, 60) || base.knowledgeMap.center,
      scopeType,
      scope: cleanText(knowledgeMap.scope, 240)
        || cleanText(base.knowledgeMap.scope, 240)
        || `围绕“${normalizedTitle}”覆盖当前学习阶段需要掌握的完整主流框架。`,
      coverageSummary: cleanText(knowledgeMap.coverageSummary, 260)
        || cleanText(base.knowledgeMap.coverageSummary, 260)
        || defaultCoverageSummary(scopeType, knowledgeNodeCandidates.length ? knowledgeNodeCandidates : completeKnowledgeFallback),
      coverageDimensions: normalizedTextList(
        knowledgeMap.coverageDimensions,
        base.knowledgeMap.coverageDimensions || DEFAULT_COVERAGE_DIMENSIONS,
        4,
        8,
        40
      ),
      nodes: limitedItems(knowledgeNodeCandidates, completeKnowledgeFallback, knowledgeNodeMinimum, CORE_CONTENT_LIMITS.knowledgeNodes, (item, index) => {
        const fallback = completeKnowledgeFallback[index % completeKnowledgeFallback.length];
        return {
          id: cleanSingleLine(item?.id, 24) || fallback.id,
          label: cleanSingleLine(item?.label, 40) || fallback.label || "核心内容",
          detail: cleanText(item?.detail, 220) || cleanText(fallback.detail, 220) || "理解并建立联系",
          members: normalizedTextList(item?.members, fallback.members || [], 0, 24, 60),
          sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms, 1, 2)
        };
      })
    },
    keyPoints: limitedItems(input.keyPoints, base.keyPoints, CORE_CONTENT_LIMITS.keyPoints, CORE_CONTENT_LIMITS.keyPoints, (item, index) => {
      const fallback = base.keyPoints[index % base.keyPoints.length];
      return {
        id: cleanSingleLine(item?.id, 24) || fallback.id,
        title: textOrFallback(item?.title, fallback.title, CORE_TEXT_LIMITS.pointTitle, 4),
        explanation: textOrFallback(item?.explanation, fallback.explanation, CORE_TEXT_LIMITS.pointExplanation, 18),
        principle: textOrFallback(item?.principle, fallback.principle, CORE_TEXT_LIMITS.pointRule, 12),
        useWhen: textOrFallback(item?.useWhen, fallback.useWhen, CORE_TEXT_LIMITS.pointRule, 12),
        boundary: textOrFallback(item?.boundary, fallback.boundary, CORE_TEXT_LIMITS.pointRule, 12),
        diagnostic: item?.diagnostic,
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms),
        example: cleanText(item?.example, 120),
        memoryTip: cleanSingleLine(item?.memoryTip, 72),
        retrievalQuestion: cleanText(item?.retrievalQuestion, 100),
        importance: cleanSingleLine(item?.importance, 16) || fallback.importance || "重点"
      };
    }),
    strategyCards: limitedItems(input.strategyCards, base.strategyCards, CORE_CONTENT_LIMITS.strategyCards, CORE_CONTENT_LIMITS.strategyCards, (item, index) => {
      const fallback = base.strategyCards[index % base.strategyCards.length] || {};
      const fallbackRoute = asArray(fallback.route).length
        ? fallback.route
        : [
          { action: "先写出题目中的关键条件或证据。", reason: "避免凭熟悉词直接下结论。" },
          { action: "再写出判断依据和结论。", reason: "让答案可以被核对。" }
        ];
      return {
        scenario: textOrFallback(item?.scenario, fallback.scenario || "补充策略", 80, 4),
        trigger: textOrFallback(item?.trigger, fallback.trigger || "题干出现需要判断的条件或证据。", 260, 12),
        firstMove: textOrFallback(item?.firstMove, fallback.firstMove || "先圈出判断所需的条件或证据。", 220, 12),
        route: limitedItems(item?.route, fallbackRoute, 2, 3, (step, stepIndex) => {
          const fallbackStep = fallbackRoute[stepIndex % fallbackRoute.length];
          return {
            action: textOrFallback(step?.action, fallbackStep.action, 180, 8),
            reason: textOrFallback(step?.reason, fallbackStep.reason, 240, 10)
          };
        }),
        scoringPoints: normalizedTextList(item?.scoringPoints, fallback.scoringPoints || ["判断依据明确", "结论能回到题干"], 2, 3, 160),
        commonLoss: textOrFallback(item?.commonLoss, fallback.commonLoss || "只写结论，遗漏判断依据。", 220, 10),
        variation: textOrFallback(item?.variation, fallback.variation || "改变一个条件后重新判断。", 220, 10),
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms)
      };
    }),
    workedExamples: limitedItems(input.workedExamples, base.workedExamples, CORE_CONTENT_LIMITS.workedExamples, CORE_CONTENT_LIMITS.workedExamples, (item, index) => {
      const fallback = base.workedExamples[index % base.workedExamples.length];
      return {
        id: cleanSingleLine(item?.id, 24) || fallback.id,
        title: textOrFallback(item?.title, fallback.title, CORE_TEXT_LIMITS.exampleTitle, 4),
        questionType: textOrFallback(item?.questionType, fallback.questionType, 24, 4),
        trigger: textOrFallback(item?.trigger, fallback.trigger, 100, 12),
        given: textOrFallback(item?.given, fallback.given, 100, 8),
        target: textOrFallback(item?.target, fallback.target, 80, 8),
        problem: textOrFallback(item?.problem, fallback.problem, CORE_TEXT_LIMITS.exampleText, 16),
        decisionRule: textOrFallback(item?.decisionRule, fallback.decisionRule, 80, 12),
        strategy: textOrFallback(item?.strategy, fallback.strategy, 120, 16),
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms),
        steps: limitedItems(item?.steps, fallback.steps, 2, 3, (step, stepIndex) => {
          const fallbackStep = fallback.steps[stepIndex % fallback.steps.length];
          return {
            label: textOrFallback(step?.label, fallbackStep.label, 24, 3),
            explanation: textOrFallback(step?.explanation, fallbackStep.explanation, CORE_TEXT_LIMITS.exampleStep, 16),
            rationale: textOrFallback(step?.rationale, fallbackStep.rationale, 100, 12),
            checkpoint: textOrFallback(step?.checkpoint, fallbackStep.checkpoint, 72, 8)
          };
        }),
        boundaryCheck: textOrFallback(item?.boundaryCheck, fallback.boundaryCheck, 80, 12),
        answer: textOrFallback(item?.answer, fallback.answer, CORE_TEXT_LIMITS.exampleText, 16),
        scoringPoints: normalizedTextList(item?.scoringPoints, fallback.scoringPoints, 2, 3, 100),
        commonWrongPath: textOrFallback(item?.commonWrongPath, fallback.commonWrongPath, 100, 12),
        selfCheck: textOrFallback(item?.selfCheck, fallback.selfCheck, 100, 12),
        variation: textOrFallback(item?.variation, fallback.variation, 100, 12),
        decisionFork: normalizeDecisionFork(item?.decisionFork, fallback.decisionFork)
      };
    }),
    closeReading: limitedItems(input.closeReading, base.closeReading, CORE_CONTENT_LIMITS.closeReading, CORE_CONTENT_LIMITS.closeReading, (item, index) => {
      const fallback = base.closeReading[index % base.closeReading.length] || {};
      return {
        heading: textOrFallback(item?.heading, fallback.heading || "补充精读", 80, 4),
        original: textOrFallback(item?.original, fallback.original || "请回到资料定位这条依据。", 420, 12),
        explanation: textOrFallback(item?.explanation, fallback.explanation || "用这处内容核对重点中的判断依据。", 520, 30),
        question: textOrFallback(item?.question, fallback.question || "这条资料如何支持你的结论？", 220, 12),
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs || [fallback.original], sourceAtoms)
      };
    }),
    concepts: limitedItems(input.concepts, base.concepts, CORE_CONTENT_LIMITS.conceptsMinimum, CORE_CONTENT_LIMITS.concepts, (item, index) => {
      const fallback = base.concepts[index % base.concepts.length] || {};
      return {
        term: cleanSingleLine(item?.term, 40) || cleanSingleLine(fallback.term, 40) || "核心概念",
        definition: cleanText(item?.definition, 240) || cleanText(fallback.definition, 240),
        example: cleanText(item?.example, 220) || cleanText(fallback.example, 220)
      };
    }),
    knowledgeDiagrams: limitedItems(
      diagramCandidates,
      diagramFallback,
      CORE_CONTENT_LIMITS.knowledgeDiagramsMinimum,
      CORE_CONTENT_LIMITS.knowledgeDiagrams,
      (item, index) => {
        const fallback = diagramFallback[index % diagramFallback.length] || {};
        return {
          title: cleanSingleLine(item?.title, 80) || cleanSingleLine(fallback.title, 80) || "知识结构图",
          purpose: cleanText(item?.purpose, 220) || cleanText(fallback.purpose, 220),
          explanation: cleanText(item?.explanation, 420) || cleanText(fallback.explanation, 420),
          readingGuide: normalizedTextList(item?.readingGuide, fallback.readingGuide || [], 2, 4, 160),
          figureType: cleanSingleLine(item?.figureType, 24) || cleanSingleLine(fallback.figureType, 24) || "diagram",
          figureHint: cleanText(item?.figureHint, 260) || cleanText(fallback.figureHint, 260)
        };
      }
    ),
    visuals: limitedItems(input.visuals, base.visuals, CORE_CONTENT_LIMITS.visuals, CORE_CONTENT_LIMITS.visuals, (item, index) => {
      const fallback = base.visuals[index % base.visuals.length] || {};
      return {
        type: ["flow", "timeline", "compare"].includes(item?.type) ? item.type : (fallback.type || "flow"),
        title: cleanSingleLine(item?.title, 80) || cleanSingleLine(fallback.title, 80) || "图解",
        caption: cleanText(item?.caption, 180) || cleanText(fallback.caption, 180),
        items: asArray(item?.items).length
          ? asArray(item.items).slice(0, 7).map((value) => cleanSingleLine(value, 80)).filter(Boolean)
          : asArray(fallback.items).slice(0, 7).map((value) => cleanSingleLine(value, 80)).filter(Boolean),
        leftTitle: cleanSingleLine(item?.leftTitle, 40) || cleanSingleLine(fallback.leftTitle, 40) || "容易混淆",
        rightTitle: cleanSingleLine(item?.rightTitle, 40) || cleanSingleLine(fallback.rightTitle, 40) || "正确理解",
        leftItems: asArray(item?.leftItems).length
          ? asArray(item.leftItems).slice(0, 5).map((value) => cleanSingleLine(value, 100)).filter(Boolean)
          : asArray(fallback.leftItems).slice(0, 5).map((value) => cleanSingleLine(value, 100)).filter(Boolean),
        rightItems: asArray(item?.rightItems).length
          ? asArray(item.rightItems).slice(0, 5).map((value) => cleanSingleLine(value, 100)).filter(Boolean)
          : asArray(fallback.rightItems).slice(0, 5).map((value) => cleanSingleLine(value, 100)).filter(Boolean)
      };
    }),
    mistakes: limitedItems(input.mistakes, base.mistakes, CORE_CONTENT_LIMITS.mistakesMinimum, CORE_CONTENT_LIMITS.mistakes, (item, index) => {
      const fallback = base.mistakes[index % base.mistakes.length] || {};
      return {
        wrong: cleanText(item?.wrong, 220) || cleanText(fallback.wrong, 220),
        right: cleanText(item?.right, 240) || cleanText(fallback.right, 240),
        reason: cleanText(item?.reason, 280) || cleanText(fallback.reason, 280)
      };
    }),
    practice: limitedItems(input.practice, base.practice, CORE_CONTENT_LIMITS.practice, CORE_CONTENT_LIMITS.practice, (item, index) => {
      const fallback = base.practice[index % base.practice.length];
      return {
        id: cleanSingleLine(item?.id, 24) || fallback.id,
        type: textOrFallback(item?.type, fallback.type, 24, 2),
        question: textOrFallback(item?.question, fallback.question, CORE_TEXT_LIMITS.practiceQuestion, 16),
        options: asArray(item?.options).slice(0, 6).map((value) => normalizeOption(value)).filter(Boolean),
        solvingPlan: textOrFallback(item?.solvingPlan, fallback.solvingPlan, 100, 10),
        answer: textOrFallback(item?.answer, fallback.answer, CORE_TEXT_LIMITS.practiceText, 12),
        explanation: textOrFallback(item?.explanation, fallback.explanation, CORE_TEXT_LIMITS.practiceText, 16),
        scoringPoints: normalizedTextList(item?.scoringPoints, fallback.scoringPoints, 2, 3, 100),
        commonLosses: normalizedTextList(item?.commonLosses, fallback.commonLosses, 1, 2, 100),
        repairAction: textOrFallback(item?.repairAction, fallback.repairAction, 100, 10),
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms),
        difficulty: cleanSingleLine(item?.difficulty, 20) || fallback.difficulty || "基础"
      };
    }),
    masteryChecks: ["复述", "应用", "迁移"].map((level, index) => {
      const candidates = asArray(input.masteryChecks);
      const fallback = base.masteryChecks[index];
      const item = candidates.find((candidate) => cleanSingleLine(candidate?.level, 16) === level)
        || candidates[index]
        || fallback;
      return {
        id: cleanSingleLine(item?.id, 24) || fallback.id,
        level,
        task: textOrFallback(item?.task, fallback.task, CORE_TEXT_LIMITS.masteryTask, 16),
        deliverable: textOrFallback(item?.deliverable, fallback.deliverable, CORE_TEXT_LIMITS.masteryText, 10),
        criteria: textOrFallback(item?.criteria, fallback.criteria, CORE_TEXT_LIMITS.masteryText, 12),
        rubric: normalizedTextList(item?.rubric, fallback.rubric, 2, 3, 80),
        ifStuck: textOrFallback(item?.ifStuck, fallback.ifStuck, 100, 10),
        outputFrame: normalizeOutputFrame(item?.outputFrame, fallback.outputFrame),
        sourceRefs: normalizeSourceRefs(item?.sourceRefs, fallback.sourceRefs, sourceAtoms)
      };
    }),
    reviewPlan: limitedItems(input.reviewPlan, base.reviewPlan, CORE_CONTENT_LIMITS.reviewPlan, CORE_CONTENT_LIMITS.reviewPlan, (item, index) => {
      const fallback = base.reviewPlan[index % base.reviewPlan.length] || {};
      return {
        day: cleanSingleLine(item?.day, 30) || cleanSingleLine(fallback.day, 30) || "复习",
        task: cleanText(item?.task, 180) || cleanText(fallback.task, 180),
        duration: cleanSingleLine(item?.duration, 30) || cleanSingleLine(fallback.duration, 30) || "5 分钟"
      };
    }),
    sourceFiles: base.sourceFiles || [],
    sourceAtoms,
    sourceEvidence: sourceEvidenceStatus(sourceAtoms)
  };

  const completedMaterial = completeLearningGraph(
    composeComprehensiveMaterial(enrichKeyPointTeachingCoverage(material)),
    input.learningRoute
  );
  completedMaterial.teachingFigures = normalizeTeachingFigures(
    asArray(input.teachingFigures).length ? input.teachingFigures : base.teachingFigures,
    completedMaterial
  );
  return sanitizeMaterialCopy(completedMaterial);
}
