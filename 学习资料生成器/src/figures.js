import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { cleanSingleLine, cleanText } from "./utils.js";
import { FIGURE_SPECS } from "./figure-specs.js";

const SVG_VIEWBOX = "0 0 400 300";
export const MAX_TEACHING_FIGURES = 28;
const SVG_ELEMENT_PATTERN = /<(path|line|polyline|polygon|circle|ellipse|rect|text|g|marker)\b/iu;
const VISIBLE_SVG_PATTERN = /<(path|line|polyline|polygon|circle|ellipse|rect)\b/giu;
const DANGEROUS_SVG_PATTERN = /<(?:script|foreignObject|iframe|object|embed)\b|on[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|javascript:)/iu;
const FIGURE_REFERENCE_PATTERN = /如图(?:所示)?|图中(?:所示)?|下图(?:所示)?|由图(?:可知)?|据图|看图|示意图|图\s*[一二三四五六七八九十\d①②③④⑤⑥⑦⑧⑨]/u;
const NATURAL_FIGURE_PATTERN = /坐标|函数|图像|直角坐标|抛物线|数轴|三角形|四边形|矩形|正方形|圆|几何|角|线段|平行|垂直|相似|全等|面积|体积|受力|斜面|滑块|杠杆|电路|电流|电压|电阻|光路|透镜|波形|实验装置|分子结构|化学键|反应过程|细胞结构|遗传系谱|代谢流程|食物链|食物网|器官系统|等高线|地形剖面|经纬网|气候图|区域示意|统计图|柱状图|折线图|扇形图|地图|时间轴|年代尺|人物关系|文章结构|叙事线|句法结构|语篇结构|论证结构|权利义务|主体关系|制度流程|流程图|示意图/u;

const FIGURE_TYPE_ALIASES = Object.freeze({
  geometry: "geometry",
  math: "geometry",
  plane: "geometry",
  "solid-geometry": "geometry",
  coordinate: "coordinate",
  coordinates: "coordinate",
  function: "function",
  "function-plot": "function",
  graph: "function",
  chart: "chart",
  statistics: "chart",
  stats: "chart",
  "climate-chart": "chart",
  numberline: "numberline",
  "number-line": "numberline",
  venn: "venn",
  "set-diagram": "venn",
  set: "venn",
  circuit: "circuit",
  electric: "circuit",
  electricity: "circuit",
  force: "force",
  "force-diagram": "force",
  mechanics: "force",
  optics: "optics",
  light: "optics",
  wave: "wave",
  molecule: "molecule",
  chemistry: "molecule",
  reaction: "reaction",
  redox: "reaction",
  "chemical-reaction": "reaction",
  timeline: "timeline",
  history: "timeline",
  table: "table",
  diagram: "diagram",
  flowchart: "diagram",
  process: "diagram",
  relation: "diagram",
  relationship: "diagram",
  "syntax-tree": "diagram",
  "argument-map": "diagram",
  cell: "diagram",
  genetics: "diagram",
  ecology: "diagram",
  "organ-system": "diagram",
  "contour-map": "diagram",
  "terrain-profile": "diagram",
  "latitude-longitude": "diagram",
  "regional-map": "diagram",
  experiment: "diagram",
  "reaction-process": "reaction",
  motion: "diagram",
  "probability-tree": "diagram"
});

const SUBJECT_KEYS = Object.freeze([
  "数学", "物理", "化学", "生物", "地理", "历史", "语文", "英语", "政治", "道法"
]);

const SUBJECT_ALLOWED_TYPES = Object.freeze({
  数学: new Set(["geometry", "function", "coordinate", "numberline", "venn", "chart", "table", "diagram"]),
  物理: new Set(["circuit", "force", "optics", "wave", "chart", "table", "diagram"]),
  化学: new Set(["molecule", "reaction", "chart", "table", "diagram"]),
  生物: new Set(["molecule", "reaction", "chart", "table", "diagram"]),
  地理: new Set(["coordinate", "chart", "table", "diagram"]),
  历史: new Set(["timeline", "chart", "table", "diagram"]),
  语文: new Set(["timeline", "chart", "table", "diagram"]),
  英语: new Set(["timeline", "chart", "table", "diagram"]),
  政治: new Set(["timeline", "chart", "table", "diagram"]),
  道法: new Set(["timeline", "chart", "table", "diagram"])
});

const SUBJECT_CONFLICT_SIGNATURES = Object.freeze({
  数学: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/寒流/u, /暖流/u, /交汇区/u], [/反应物/u, /生成物/u, /反应条件/u]],
  物理: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/经度/u, /纬度/u, /经纬网/u], [/反应物/u, /生成物/u, /反应条件/u]],
  化学: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/经度/u, /纬度/u, /经纬网/u], [/主语|Subject/u, /谓语|Verb/u, /宾语|Object/u]],
  生物: [[/经度/u, /纬度/u, /经纬网/u], [/寒流/u, /暖流/u, /交汇区/u], [/主语|Subject/u, /谓语|Verb/u, /宾语|Object/u]],
  地理: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/染色体/u, /基因型/u, /亲本|子代/u], [/主语|Subject/u, /谓语|Verb/u, /宾语|Object/u]],
  历史: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/电源/u, /开关/u, /灯泡|电阻/u], [/反应物/u, /生成物/u, /反应条件/u]],
  语文: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/电源/u, /开关/u, /灯泡|电阻/u], [/经度/u, /纬度/u, /经纬网/u]],
  英语: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/电源/u, /开关/u, /灯泡|电阻/u], [/经度/u, /纬度/u, /经纬网/u]],
  政治: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/电源/u, /开关/u, /灯泡|电阻/u], [/反应物/u, /生成物/u, /反应条件/u]],
  道法: [[/细胞膜/u, /细胞核/u, /细胞质/u], [/电源/u, /开关/u, /灯泡|电阻/u], [/反应物/u, /生成物/u, /反应条件/u]]
});

const MINIMUM_VISIBLE_GEOMETRY = Object.freeze({
  geometry: 4,
  function: 6,
  coordinate: 6,
  numberline: 8,
  circuit: 8,
  force: 7,
  optics: 8,
  wave: 3,
  molecule: 5,
  reaction: 7,
  timeline: 8,
  venn: 2,
  table: 2,
  chart: 6,
  diagram: 4
});

const SVG_LABEL_VOCABULARY = [
  "示意图图像图表坐标横轴纵轴原点正方向顶点零点截距函数数据数值类别图例合计单位年月日第组一二三四五六七八九十",
  "条件已知过程结果影响关系结构对象步骤时间事件节点区域方向位置大小高低多少数量输入输出检查项目起点信息核对要点底面圆侧面竖直",
  "气温温度降水量海拔经度纬度等高线坡度寒流暖流洋流交汇区营养盐上涌渔场鱼群",
  "物体斜面角电流电压电阻电源开关灯泡支路串联并联重力支持力摩擦力焦点透镜凸凹光线平行入射反射折射像方物方光心实像虚像倒立正立波峰波谷波长传播经过前后不变",
  "原子分子化学键共价键反应物生成物反应条件已有新物质反应进行电子转移氧化还原失得守恒种类数目细胞膜细胞核细胞质生产者消费者初级次级分解者亲本子代物质循环能量传递环境",
  "主语谓语宾语句子主干找补充修饰成分文本线索表达作用历史时代公共参与主体规则形成增加减少变化读图先看再看核对的了在从向由与和及是为将把经后通过前不变回到"
].join("");

export function normalizeFigureSubject(value) {
  const source = String(value || "").trim();
  if (/道德与法治|道法/u.test(source)) return "道法";
  return SUBJECT_KEYS.find((subject) => source.includes(subject)) || "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value, maximum = 600) {
  return cleanText(value, maximum).replace(/\s+/gu, " ").trim();
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildShortLabel(value, maximum = 16) {
  const text = compactText(value, 120).replace(/[，。；：、,.!?！？]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!text) return "示意图";
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

const FIGURE_PLACEMENT_SECTIONS = Object.freeze([
  "knowledgeDiagrams",
  "keyPoints",
  "visuals",
  "workedExamples",
  "practice",
  "strategyCards",
  "closeReading",
  "mistakes",
  "masteryChecks"
]);

function figurePlacementRole(section, refId) {
  const index = Math.max(1, Number.parseInt(String(refId || "1").replace(/\D/gu, ""), 10) || 1);
  if (section === "knowledgeDiagrams") {
    return index === 1
      ? { key: "knowledge-overview", title: "知识全景图", purpose: "呈现完整分类、组成层级和核心关系，帮助先建立整体结构。" }
      : { key: "knowledge-decision", title: "判断路径图", purpose: "呈现判断顺序、条件分支和核对终点，帮助把知识用于具体问题。" };
  }
  if (section === "visuals") {
    return index === 1
      ? { key: "visual-contrast", title: "易混对照图", purpose: "并列呈现容易混淆的对象、差异和识别线索。" }
      : { key: "visual-process", title: "过程变化图", purpose: "沿时间、方向或因果顺序呈现变化过程与关键节点。" };
  }
  if (section === "keyPoints") {
    const roles = [
      { key: "key-mechanism", title: "重点机制图", purpose: "只解释本重点最关键的对象、方向和作用关系。" },
      { key: "key-boundary", title: "重点边界图", purpose: "对照成立条件、例外和不能直接套用的情况。" },
      { key: "key-application", title: "重点应用图", purpose: "呈现从题目线索到正确判断的最短应用路径。" }
    ];
    return roles[(index - 1) % roles.length];
  }
  if (section === "workedExamples") {
    return { key: `example-${index}`, title: `示范 ${index} 题设图`, purpose: "只画本示范的已知条件与对象关系，不提前呈现答案或推导结果。" };
  }
  if (section === "practice") {
    return { key: `practice-${index}`, title: `练习 ${index} 题设图`, purpose: "只画本练习独有的题设条件，供学生独立读图和判断。" };
  }
  if (section === "strategyCards") {
    return { key: `strategy-${index}`, title: `策略 ${index} 路径图`, purpose: "把本策略的触发信号、动作顺序和检查点画成专属路径。" };
  }
  if (section === "closeReading") {
    return { key: `reading-${index}`, title: `精读 ${index} 证据图`, purpose: "只呈现本段材料中的证据结构和对应关系。" };
  }
  if (section === "mistakes") {
    return { key: `mistake-${index}`, title: `易错 ${index} 辨析图`, purpose: "并列呈现本条错误理解与正确关系，突出导致错误的关键差异。" };
  }
  if (section === "masteryChecks") {
    return { key: `mastery-${index}`, title: `掌握证明 ${index} 任务图`, purpose: "只呈现本关任务需要读取或补全的条件，不代替学生作答。" };
  }
  return { key: `figure-${index}`, title: "教学图形", purpose: "呈现本栏目的关键对象和关系。" };
}

function figurePlacementPrefix(section) {
  if (section === "workedExamples") return "E";
  if (section === "practice") return "P";
  if (section === "visuals") return "V";
  if (section === "keyPoints") return "K";
  if (section === "strategyCards") return "S";
  if (section === "closeReading") return "C";
  if (section === "mistakes") return "X";
  if (section === "masteryChecks") return "M";
  return "D";
}

function normalizePlacement(value, fallbackSection = "knowledgeDiagrams", fallbackRefId = "D1") {
  const section = FIGURE_PLACEMENT_SECTIONS.includes(value?.section)
    ? value.section
    : fallbackSection;
  const prefix = figurePlacementPrefix(section);
  const candidate = cleanSingleLine(value?.refId, 24);
  const normalizedFallback = new RegExp(`^${prefix}\\d+$`, "u").test(fallbackRefId)
    ? fallbackRefId
    : `${prefix}1`;
  return {
    section,
    refId: new RegExp(`^${prefix}\\d+$`, "u").test(candidate) ? candidate : normalizedFallback
  };
}

function normalizeParams(value, depth = 0) {
  if (depth > 3 || value == null) return {};
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => {
      if (typeof item === "number") return Number.isFinite(item) ? item : 0;
      if (typeof item === "string") return compactText(item, 80);
      if (item && typeof item === "object") return normalizeParams(item, depth + 1);
      return null;
    }).filter((item) => item !== null);
  }
  if (typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).slice(0, 40).map(([key, item]) => {
      const safeKey = cleanSingleLine(key, 40).replace(/[^\p{L}\p{N}_-]/gu, "") || "value";
      if (typeof item === "number") return [safeKey, Number.isFinite(item) ? item : 0];
      if (typeof item === "boolean") return [safeKey, item];
      if (typeof item === "string") return [safeKey, compactText(item, 120)];
      return [safeKey, normalizeParams(item, depth + 1)];
    })
  );
}

export function sanitizeFigureDescription(value) {
  let text = compactText(value, 600)
    .replace(/<\/?(?:script|style|iframe|object|embed|svg|path)\b[^>]*>/giu, "")
    .replace(/\bon\w+\s*=|javascript:|data:text\/html/giu, "");
  const leakPatterns = [
    /答案(?:为|是|等于)?[^，。；;]*/gu,
    /正确答案[^，。；;]*/gu,
    /解题(?:路径|思路|步骤)[^，。；;]*/gu,
    /辅助线(?:为|是|连接|作)?[^，。；;]*/gu,
    /关键结论[^，。；;]*/gu,
    /由此可得[^，。；;]*/gu,
    /所以[^，。；;]*(?:答案|结果|结论)[^，。；;]*/gu,
    /标注坐标\s*\([^)]*\)\s*(?:为答案|为结果)?/gu,
    /标出(?:最大值|最小值|零点|交点|斜率|面积|长度|角度)答案[^，。；;]*/gu
  ];
  leakPatterns.forEach((pattern) => { text = text.replace(pattern, ""); });
  return compactText(text, 600);
}

export function detectFigureType(explicitType, description = "", stem = "", subject = "") {
  const explicit = String(explicitType || "").trim().toLowerCase();
  const explicitAlias = FIGURE_TYPE_ALIASES[explicit];
  const subjectKey = normalizeFigureSubject(subject);
  const allowedTypes = SUBJECT_ALLOWED_TYPES[subjectKey];
  // 明确学科是最高优先级。模型给出的具体类型只有属于该学科时才采用，
  // diagram 等泛化类型继续在当前学科内部做语义识别。
  if (explicitAlias && explicitAlias !== "diagram" && (!allowedTypes || allowedTypes.has(explicitAlias))) {
    return explicitAlias;
  }
  const combined = `${description} ${stem}`.toLowerCase();

  if (subjectKey === "数学") {
    if (/(数轴|区间|number line|numberline)/u.test(combined)) return "numberline";
    if (/(函数|抛物线|坐标|象限|图像|curve|graph|coordinate)/u.test(combined)) {
      return /(坐标|象限)/u.test(combined) && !/(函数|抛物线)/u.test(combined) ? "coordinate" : "function";
    }
    if (/(维恩|韦恩|集合|交集|并集|venn)/u.test(combined)) return "venn";
    if (/(统计图|柱状图|折线图|饼图|扇形图|直方图|chart)/u.test(combined)) return "chart";
    if (/(表格|列表|行列|table)/u.test(combined)) return "table";
    if (/(三角形|四边形|矩形|正方形|圆|几何|角|线段|平行|垂直|相似|全等|geometry|polygon)/u.test(combined)) return "geometry";
    return explicitAlias || "diagram";
  }
  if (subjectKey === "物理") {
    if (/(电路|电流|电压|电阻|开关|电源|串联|并联|circuit)/u.test(combined)) return "circuit";
    if (/(受力|斜面|摩擦力|弹簧|滑块|力图|矢量|force)/u.test(combined)) return "force";
    if (/(光路|透镜|折射|反射|凸透镜|凹透镜|optics)/u.test(combined)) return "optics";
    if (/(波形|波长|振动|驻波|波谷|波峰|wave)/u.test(combined)) return "wave";
    if (/(统计图|折线图|实验曲线|chart)/u.test(combined)) return "chart";
    return explicitAlias && allowedTypes.has(explicitAlias) ? explicitAlias : "diagram";
  }
  if (subjectKey === "化学") {
    if (/(氧化还原|氧化剂|还原剂|失电子|得电子|电子转移|反应物|生成物|化学方程式|反应过程|redox|reaction)/u.test(combined)) return "reaction";
    if (/(分子|原子|化学键|结构式|molecule)/u.test(combined)) return "molecule";
    if (/(曲线|统计图|chart)/u.test(combined)) return "chart";
    return explicitAlias && allowedTypes.has(explicitAlias) ? explicitAlias : "diagram";
  }
  if (subjectKey === "生物") {
    if (/(分子|化学键|结构式|molecule)/u.test(combined)) return "molecule";
    if (/(反应过程|代谢反应|光合作用|呼吸作用|reaction)/u.test(combined)) return "reaction";
    if (/(曲线|统计图|柱状图|折线图|chart)/u.test(combined)) return "chart";
    return explicitAlias && allowedTypes.has(explicitAlias) ? explicitAlias : "diagram";
  }
  if (subjectKey === "地理") {
    if (/(气候图|气温曲线|降水柱状图|统计图|柱状图|折线图|扇形图|chart)/u.test(combined)) return "chart";
    if (/(坐标|经纬坐标|coordinate)/u.test(combined)) return "coordinate";
    return explicitAlias && allowedTypes.has(explicitAlias) ? explicitAlias : "diagram";
  }
  if (subjectKey === "历史") {
    if (/(时间轴|年代尺|朝代|世纪|timeline)/u.test(combined)) return "timeline";
    if (/(统计图|柱状图|折线图|chart)/u.test(combined)) return "chart";
    return explicitAlias && allowedTypes.has(explicitAlias) ? explicitAlias : "diagram";
  }
  if (["语文", "英语", "政治", "道法"].includes(subjectKey)) {
    if (/(时间轴|年代|timeline)/u.test(combined)) return "timeline";
    if (/(统计图|柱状图|折线图|扇形图|chart)/u.test(combined)) return "chart";
    if (/(表格|列表|行列|table)/u.test(combined)) return "table";
    return explicitAlias && allowedTypes.has(explicitAlias) ? explicitAlias : "diagram";
  }

  if (/(电路|电流|电压|电阻|开关|电源|串联|并联|circuit)/u.test(combined)) return "circuit";
  if (/(受力|斜面|摩擦力|弹簧|滑块|力图|矢量|force)/u.test(combined)) return "force";
  if (/(光路|透镜|折射|反射|凸透镜|凹透镜|optics)/u.test(combined)) return "optics";
  if (/(波形|波长|振动|驻波|波谷|波峰|wave)/u.test(combined)) return "wave";
  if (/(氧化还原|氧化剂|还原剂|失电子|得电子|电子转移|反应物|生成物|化学方程式|反应过程|redox|reaction)/u.test(combined)) return "reaction";
  if (/(分子|原子|化学键|结构式|molecule)/u.test(combined)) return "molecule";
  if (/(时间轴|年代尺|朝代|timeline)/u.test(combined)) return "timeline";
  if (/(维恩|韦恩|集合|交集|并集|venn)/u.test(combined)) return "venn";
  if (/(数轴|区间|number line|numberline)/u.test(combined)) return "numberline";
  if (/(函数|抛物线|坐标|象限|图像|curve|graph|coordinate)/u.test(combined)) {
    return /(坐标|象限)/u.test(combined) && !/(函数|抛物线)/u.test(combined) ? "coordinate" : "function";
  }
  if (/(统计图|柱状图|折线图|饼图|扇形图|直方图|气候图|chart)/u.test(combined)) return "chart";
  if (/(表格|列表|行列|table)/u.test(combined)) return "table";
  if (/(三角形|四边形|矩形|正方形|圆|几何|角|线段|平行|垂直|相似|全等|geometry|polygon)/u.test(combined)) return "geometry";
  return explicitAlias || "diagram";
}

function sourceTextForPlacement(material, section, refId) {
  if (section === "keyPoints") {
    const index = Math.max(0, Number.parseInt(String(refId || "K1").replace(/\D/gu, ""), 10) - 1);
    const point = asArray(material?.keyPoints).find((entry) => entry?.id === refId)
      || asArray(material?.keyPoints)[index]
      || {};
    return compactText([point.title, point.explanation, point.principle, point.useWhen, point.example].filter(Boolean).join(" "), 260);
  }
  if (section === "knowledgeDiagrams") {
    const index = Math.max(0, Number.parseInt(String(refId || "D1").replace(/\D/gu, ""), 10) - 1);
    const diagram = asArray(material?.knowledgeDiagrams)[index] || {};
    return compactText([diagram.title, diagram.purpose, diagram.explanation].filter(Boolean).join(" "), 260)
      || compactText([material?.meta?.title, material?.knowledgeMap?.center].filter(Boolean).join(" "), 260);
  }
  if (section === "visuals") {
    const index = Math.max(0, Number.parseInt(String(refId || "V1").replace(/\D/gu, ""), 10) - 1);
    const visual = asArray(material?.visuals)[index] || {};
    return compactText([
      visual.title,
      visual.caption,
      ...(asArray(visual.items).slice(0, 6)),
      ...(asArray(visual.leftItems).slice(0, 3)),
      ...(asArray(visual.rightItems).slice(0, 3))
    ].filter(Boolean).join(" "), 260);
  }
  if (section === "workedExamples") {
    const item = asArray(material?.workedExamples).find((entry) => entry?.id === refId);
    return compactText([item?.title, item?.problem, item?.given].filter(Boolean).join(" "), 260);
  }
  if (section === "practice") {
    const item = asArray(material?.practice).find((entry) => entry?.id === refId);
    return compactText(item?.question, 260);
  }
  if (section === "strategyCards") {
    const index = Math.max(0, Number.parseInt(String(refId || "S1").replace(/\D/gu, ""), 10) - 1);
    const item = asArray(material?.strategyCards)[index] || {};
    return compactText([
      item.scenario,
      item.trigger,
      item.firstMove,
      ...asArray(item.route).flatMap((step) => [step?.action, step?.reason]),
      item.variation
    ].filter(Boolean).join(" "), 320);
  }
  if (section === "closeReading") {
    const index = Math.max(0, Number.parseInt(String(refId || "C1").replace(/\D/gu, ""), 10) - 1);
    const item = asArray(material?.closeReading)[index] || {};
    return compactText([item.heading, item.original, item.explanation, item.question].filter(Boolean).join(" "), 320);
  }
  if (section === "mistakes") {
    const index = Math.max(0, Number.parseInt(String(refId || "X1").replace(/\D/gu, ""), 10) - 1);
    const item = asArray(material?.mistakes)[index] || {};
    return compactText([item.wrong, item.right, item.reason].filter(Boolean).join(" "), 320);
  }
  if (section === "masteryChecks") {
    const index = Math.max(0, Number.parseInt(String(refId || "M1").replace(/\D/gu, ""), 10) - 1);
    const item = asArray(material?.masteryChecks).find((entry) => entry?.id === refId)
      || asArray(material?.masteryChecks)[index]
      || {};
    return compactText([
      item.task,
      item.deliverable,
      item.criteria,
      ...asArray(item.outputFrame)
    ].filter(Boolean).join(" "), 320);
  }
  return compactText([material?.meta?.title, material?.knowledgeMap?.center].filter(Boolean).join(" "), 260);
}

export function detectFigureRequirements(material = {}) {
  const requirements = [];
  const seen = new Set();
  const add = (section, refId, text, force = false, referenceOnly = false) => {
    const matchesTrigger = referenceOnly
      ? FIGURE_REFERENCE_PATTERN.test(text)
      : (FIGURE_REFERENCE_PATTERN.test(text) || NATURAL_FIGURE_PATTERN.test(text));
    if (!text || (!force && !matchesTrigger)) return;
    const key = `${section}:${refId}`;
    if (seen.has(key)) return;
    seen.add(key);
    requirements.push({
      section,
      refId,
      type: detectFigureType("", text, text, material?.meta?.subject),
      text: compactText(text, 220)
    });
  };
  const diagramCount = Math.max(2, asArray(material?.knowledgeDiagrams).length);
  for (let index = 0; index < diagramCount; index += 1) {
    const refId = `D${index + 1}`;
    add("knowledgeDiagrams", refId, sourceTextForPlacement(material, "knowledgeDiagrams", refId), true);
  }
  asArray(material?.visuals).forEach((item, index) => {
    add("visuals", `V${index + 1}`, sourceTextForPlacement(material, "visuals", `V${index + 1}`), true);
  });
  asArray(material?.workedExamples).forEach((item, index) => {
    const refId = cleanSingleLine(item?.id, 24) || `E${index + 1}`;
    add("workedExamples", refId, sourceTextForPlacement(material, "workedExamples", refId), true);
  });
  asArray(material?.practice).forEach((item, index) => {
    const refId = cleanSingleLine(item?.id, 24) || `P${index + 1}`;
    add("practice", refId, sourceTextForPlacement(material, "practice", refId), true);
  });
  // 十个固定图位必须优先完整保留，不能因为重点配图而挤掉 P4。
  asArray(material?.keyPoints).forEach((item, index) => {
    const refId = cleanSingleLine(item?.id, 24) || `K${index + 1}`;
    add("keyPoints", refId, sourceTextForPlacement(material, "keyPoints", refId));
  });
  [
    ["strategyCards", "S", material?.strategyCards],
    ["closeReading", "C", material?.closeReading],
    ["mistakes", "X", material?.mistakes],
    ["masteryChecks", "M", material?.masteryChecks]
  ].forEach(([section, prefix, items]) => {
    asArray(items).forEach((item, index) => {
      const refId = cleanSingleLine(item?.id, 24) || `${prefix}${index + 1}`;
      add(section, refId, sourceTextForPlacement(material, section, refId), false, true);
    });
  });
  return requirements.slice(0, MAX_TEACHING_FIGURES);
}

function createAutoFigure(requirement, material) {
  const isQuestion = ["workedExamples", "practice"].includes(requirement.section);
  const isVisual = requirement.section === "visuals";
  const isKeyPoint = requirement.section === "keyPoints";
  const role = figurePlacementRole(requirement.section, requirement.refId);
  return {
    id: `F-${requirement.section}-${requirement.refId}`,
    subject: material?.meta?.subject,
    type: requirement.type,
    title: `${material?.meta?.title || "本知识点"}·${role.title}`,
    purpose: role.purpose || (isQuestion
      ? "把题目已有条件转成可观察图形，帮助准确读题。"
      : (isVisual ? "把流程、对比或关系变成一张可读的学科图。" : (isKeyPoint ? "把重点中的对象、方向或关系画清楚，帮助完成判断。" : "把知识中的空间、数量、结构或过程关系画清楚。"))),
    description: `本图唯一教学职责是“${role.purpose}”根据${isQuestion ? "本题" : (isVisual ? "本辅助栏目" : "本知识栏目")}绘制必要教学 SVG：${requirement.text}。图中只呈现原内容已有条件、必要识别标签和已知关系，不新增条件，不标注答案、解题路径、辅助线结论或推导结果。`,
    placement: { section: requirement.section, refId: requirement.refId },
    caption: "先核对图中对象和标签，再观察方向、连接、刻度或位置关系；所有判断仍以正文条件为准。",
    params: { teachingRole: role.key, placementRef: `${requirement.section}:${requirement.refId}` },
    constraints: [
      `必须完成“${role.title}”的专属职责，不能复用其他栏目的构图`,
      "主体必须完整可见",
      "关键标签与原内容一致",
      "关系、方向或层级必须可核对",
      "不得泄露答案或解题线索"
    ]
  };
}

export function normalizeFigurePayload(input = {}) {
  const description = sanitizeFigureDescription(input.description || input.tikzCode || "");
  const stem = compactText(input.stem, 320);
  const rawSubject = cleanSingleLine(input.subject, 30);
  const subject = normalizeFigureSubject(rawSubject) || rawSubject;
  const params = normalizeParams(input.params);
  const teachingRole = String(params.teachingRole || "");
  const roleFigureType = /^(?:visual-contrast|key-boundary|mistake-)/u.test(teachingRole)
    ? "table"
    : (/^(?:knowledge-decision|strategy-|reading-|mastery-)/u.test(teachingRole) ? "diagram" : "");
  // 栏目职责决定信息架构，学科关键词只决定图中对象。否则“电路策略路径图”
  // 会被误路由为纯闭合电路，造成模型按流程绘制、校验器按电路验收的死循环。
  const figureType = roleFigureType
    || detectFigureType(input.figureType || input.type, description, stem, subject);
  return {
    description,
    stem,
    subject,
    figureType,
    params,
    constraints: asArray(input.constraints).slice(0, 12).map((item) => compactText(item, 120)).filter(Boolean),
    cacheKey: JSON.stringify({ description, stem, subject, figureType, params })
  };
}

export function getSubjectFigureGuidance(subject) {
  const key = normalizeFigureSubject(subject);
  return (key ? FIGURE_SPECS.subjects[key] : ["图形必须与教学内容一致，主体、标签和关系清晰。"]).join("；");
}

export function buildFigureSystemPrompt(subject, figureType) {
  const subjectKey = normalizeFigureSubject(subject) || String(subject || "").trim();
  const commonRules = FIGURE_SPECS.common.outputRules.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const subjectRules = (FIGURE_SPECS.subjects[subjectKey] || ["图形必须与教学内容一致，标注清晰。"]).map((item, index) => `${index + 1}. ${item}`).join("\n");
  const typeRules = (FIGURE_SPECS.types[figureType] || FIGURE_SPECS.types.diagram).map((item, index) => `${index + 1}. ${item}`).join("\n");
  return `你是 K12 教学图形渲染专家，负责输出可直接嵌入学习资料的 SVG。

【权威学科】
${subjectKey || "通用"}。这是最高优先级，正文即使出现其他学科词，也禁止画成其他学科图形。

【通用输出规范】
${commonRules}

【${subjectKey || "通用"}学科约束】
${subjectRules}

【${figureType} 图形约束】
${typeRules}

【强制技术要求】
1. SVG 根节点必须包含 xmlns="http://www.w3.org/2000/svg" 与 viewBox="${SVG_VIEWBOX}"。
2. 默认白色背景，主线条使用深灰色，正文标签使用 12—15px，适合网页、PDF 和 Word 打印。
3. 主体放在 x=24—376、y=24—276 的安全区，至少占视口 55%；不得挤在角落或被边界裁切。
4. 标签与图形保持至少 8px 间距；引线指向明确，箭头终点停在节点边缘，不能穿过文字或节点。
5. 除标题外至少保留 2 个可核对标签；复杂装置、地图、函数或过程必须包含足够图元，不能用三个通用方框代替。
6. 颜色只承担区分作用，深色线条和文字必须保证黑白打印仍可辨；同类对象使用一致线宽和圆角。
7. 所有中文标签必须逐字取自用户提供的图形描述、结构参数或约束；只能补充坐标轴、图例、方向、单位等必要教学通用词，禁止自行改写、造词或使用近音错字。
8. 只呈现知识内容或题目已有关系，不得添加答案、解题路径、辅助线结论或推导结果。
9. 禁止出现与“${subjectKey || "当前"}”学科不符的结构、器官、装置或标签。
10. 输出前做两轮自检：先逐字检查标签、学科与事实，再检查遮挡、越界、错误连接、图元过少和标签缺失。
11. 严禁输出 Markdown、解释语句、注释块、脚本、外链资源。

只输出 SVG 代码。`;
}

export function buildFigureUserPrompt(payload) {
  const params = Object.keys(payload.params || {}).length ? JSON.stringify(payload.params) : "未提供";
  const constraints = payload.constraints?.length ? payload.constraints.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. 按描述准确绘制。";
  return `请为下面的学习内容生成教学图形。

科目：${payload.subject || "未提供"}
图形类型：${payload.figureType}
关联内容：${payload.stem || "未提供"}
图形描述：${payload.description}
结构参数：${params}
额外约束：
${constraints}

要求：
1. 图形必须能单独成立，不能依赖未画出的信息。
2. 关键点、线、装置、方向、刻度、图例或层级必须落图，但只保留理解内容所必需的标注。
3. 坐标、函数、几何、受力、电路、光路、实验、分子、结构、地图、时间轴等必须体现对应类型的核心结构。
4. 正文出现其他学科名词时仍以“${payload.subject || "当前学科"}”为准，例如地理中的“浮游生物”不能画成细胞结构。
5. 输出前自检：不能空白，不能只有标题文字，不能缺失主体，不能出现错误连接、标签遮挡、越界或答案泄露。`;
}

export function extractSvg(content) {
  return String(content || "").match(/<svg[\s\S]*?<\/svg>/iu)?.[0] || "";
}

export function isRenderableSvg(svg) {
  const source = String(svg || "");
  if (!/<svg[\s\S]*<\/svg>/iu.test(source)) return false;
  if (DANGEROUS_SVG_PATTERN.test(source)) return false;
  if (!SVG_ELEMENT_PATTERN.test(source)) return false;
  return (source.match(VISIBLE_SVG_PATTERN) || []).length > 0;
}

function textLayoutIssues(svg) {
  const tokens = String(svg || "").match(/<g\b[^>]*>|<\/g>|<text\b[^>]*>[\s\S]*?<\/text>/giu) || [];
  const contextStack = [{ transformed: false, fontSize: 14, anchor: "start" }];
  const boxes = [];
  for (const token of tokens) {
    if (/^<g\b/iu.test(token)) {
      const parent = contextStack.at(-1);
      contextStack.push({
        transformed: parent.transformed || /\btransform\s*=/iu.test(token),
        fontSize: clampNumber(finiteNumber(token.match(/\bfont-size\s*=\s*["']\s*(\d+(?:\.\d+)?)/iu)?.[1], parent.fontSize), 8, 32),
        anchor: token.match(/\btext-anchor\s*=\s*["']([^"']+)/iu)?.[1]?.toLowerCase() || parent.anchor
      });
      continue;
    }
    if (/^<\/g/iu.test(token)) {
      if (contextStack.length > 1) contextStack.pop();
      continue;
    }
    const opening = token.match(/^<text\b([^>]*)>/iu)?.[1] || "";
    const context = contextStack.at(-1);
    if (context.transformed || /\btransform\s*=/iu.test(opening)) continue;
    const x = finiteNumber(opening.match(/\bx\s*=\s*["']\s*(-?\d+(?:\.\d+)?)/iu)?.[1]);
    const y = finiteNumber(opening.match(/\by\s*=\s*["']\s*(-?\d+(?:\.\d+)?)/iu)?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const fontSize = clampNumber(finiteNumber(opening.match(/\bfont-size\s*=\s*["']\s*(\d+(?:\.\d+)?)/iu)?.[1], context.fontSize), 8, 32);
    const label = compactText(token.replace(/^<text\b[^>]*>|<\/text>$/giu, "").replace(/<[^>]+>/gu, ""), 80);
    if (!label) continue;
    const width = [...label].reduce((sum, character) => (
      sum + fontSize * (/\s/u.test(character) ? 0.35 : (/[^\u3400-\u9fff]/u.test(character) ? 0.6 : 1))
    ), 0);
    const anchor = opening.match(/\btext-anchor\s*=\s*["']([^"']+)/iu)?.[1]?.toLowerCase() || context.anchor;
    const left = anchor === "middle" ? x - width / 2 : (anchor === "end" ? x - width : x);
    boxes.push({ label, left, right: left + width, top: y - fontSize * 0.9, bottom: y + fontSize * 0.25 });
  }
  const outOfBounds = boxes.filter((box) => box.left < 4 || box.right > 396 || box.top < 4 || box.bottom > 296);
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      if (overlapWidth > 2.5 && overlapHeight > 2.5) overlaps.push(`${left.label} / ${right.label}`);
    }
  }
  const issues = [];
  if (outOfBounds.length) issues.push(`SVG 文字超出视口：${outOfBounds.slice(0, 3).map((box) => box.label).join("、")}`);
  if (overlaps.length) issues.push(`SVG 文字发生重叠：${overlaps.slice(0, 3).join("、")}`);
  return issues;
}

export function inspectSvgVisualQuality(svg, figure = {}) {
  const source = String(svg || "");
  const issues = [];
  const subject = normalizeFigureSubject(figure.subject);
  const type = detectFigureType(figure.figureType || figure.type, figure.description, figure.stem, subject);
  const visibleGeometry = (source.match(VISIBLE_SVG_PATTERN) || []).length;
  const textLabels = (source.match(/<text\b/giu) || []).length;
  const minimumGeometry = MINIMUM_VISIBLE_GEOMETRY[type] || MINIMUM_VISIBLE_GEOMETRY.diagram;

  if (!isRenderableSvg(source)) issues.push("SVG 不安全、结构不完整或没有可见图元");
  if (visibleGeometry < minimumGeometry) issues.push(`${type} 图形可见图元不足 ${minimumGeometry} 个`);
  if (textLabels < 2) issues.push("缺少至少两个可核对标签");
  if (/要素\s*[AB]|核心对象[\s\S]{0,220}关键关系[\s\S]{0,220}应用检查/u.test(source)) {
    issues.push("仍是通用占位关系图");
  }
  const hasConflictSignature = SUBJECT_CONFLICT_SIGNATURES[subject]?.some((patterns) => (
    patterns.filter((pattern) => pattern.test(source)).length >= 2
  ));
  if (subject && hasConflictSignature) {
    issues.push(`SVG 出现与${subject}学科冲突的结构标签`);
  }
  const labelSource = [
    subject,
    figure.description,
    figure.stem,
    asArray(figure.constraints).join(" "),
    JSON.stringify(figure.params || {}),
    SVG_LABEL_VOCABULARY
  ].join(" ");
  const unsupportedLabels = [...source.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/giu)]
    .map((match) => match[1].replace(/<[^>]+>/gu, ""))
    .filter((label) => {
      const characters = label.match(/[\u3400-\u9fff]/gu) || [];
      return characters.some((character) => !labelSource.includes(character));
    })
    .map((label) => compactText(label, 40))
    .filter(Boolean);
  if (unsupportedLabels.length) {
    issues.push(`SVG 标签含题意外文字：${[...new Set(unsupportedLabels)].slice(0, 3).join("、")}`);
  }
  issues.push(...textLayoutIssues(source));

  return {
    valid: issues.length === 0,
    issues,
    metrics: { subject, type, visibleGeometry, textLabels, minimumGeometry }
  };
}

export function isSemanticallyRelevantSvg(svg, figure = {}) {
  const source = String(svg || "");
  const combined = `${figure.subject || ""} ${figure.description || ""} ${figure.stem || ""}`;
  const subject = normalizeFigureSubject(figure.subject);
  if (!inspectSvgVisualQuality(source, figure).valid) return false;
  const genericPlaceholder = /<text\b[^>]*>\s*要素\s*[AB]\s*<\/text>/iu.test(source)
    && /<text\b[^>]*>\s*结果\s*<\/text>/iu.test(source);
  if (genericPlaceholder) return false;
  if (/(化学|氧化还原|氧化剂|还原剂|失电子|得电子|电子转移|反应物|生成物|化学方程式|反应过程)/u.test(combined)
    && /核心对象[\s\S]{0,220}关键关系[\s\S]{0,220}应用检查/u.test(source)) {
    return false;
  }
  if (/圆柱/u.test(combined)) {
    return /<ellipse\b/iu.test(source) && /(?:半径|\br\b)/iu.test(source) && /(?:高度|\b高\b|\bh\b)/iu.test(source);
  }
  if (/圆锥/u.test(combined)) return /<ellipse\b/iu.test(source) && /<path\b/iu.test(source);
  if (/球/u.test(combined)) return /<circle\b/iu.test(source);
  if (/(函数|抛物线)/u.test(combined)) return /<(?:path|polyline)\b/iu.test(source);
  if (/(电路|电流|电压|电阻)/u.test(combined)) return /<(?:path|polyline|circle)\b/iu.test(source);
  if (/(氧化还原|氧化剂|还原剂|失电子|得电子|电子转移|反应物|生成物|化学方程式|反应过程)/u.test(combined)) {
    return /<(?:rect|line|path|polygon)\b/iu.test(source) && /反应物|生成物|电子转移|反应进行/u.test(source);
  }
  if (/受力/u.test(combined)) return /<line\b/iu.test(source) && /(?:arrow|polygon)/iu.test(source);
  if (/(分子|原子|化学键)/u.test(combined)) return /<circle\b/iu.test(source) && /<line\b/iu.test(source);
  if (/(时间轴|年代尺)/u.test(combined)) return /<line\b/iu.test(source) && /<circle\b/iu.test(source);
  if (subject === "地理" && /(洋流|寒流|暖流|渔场|海流)/u.test(combined)) {
    return /寒流|暖流|洋流/u.test(source) && /<(?:path|line|polyline)\b/iu.test(source);
  }
  return true;
}

export function finalizeSvg(svg, { validateDocument = true } = {}) {
  let source = extractSvg(svg).trim();
  if (!isRenderableSvg(source)) return "";
  source = source
    .replace(/<\/?(?:script|foreignObject|iframe|object|embed)\b[^>]*>/giu, "")
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/giu, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])(?:https?:|data:|javascript:).*?\1/giu, "");
  if (!/xmlns=/iu.test(source)) source = source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  source = /viewBox=/iu.test(source)
    ? source.replace(/\sviewBox\s*=\s*(["']).*?\1/iu, ` viewBox="${SVG_VIEWBOX}"`)
    : source.replace("<svg", `<svg viewBox="${SVG_VIEWBOX}"`);
  source = source.replace(/<svg\b([^>]*)>/iu, (opening, attributes) => {
    const cleaned = attributes.replace(/\s(?:width|height)\s*=\s*(["']).*?\1/giu, "");
    return `<svg${cleaned}>`;
  });
  if (!/preserveAspectRatio=/iu.test(source)) source = source.replace("<svg", '<svg preserveAspectRatio="xMidYMid meet"');
  if (!/<rect\b[^>]*fill=["']#?fff/iu.test(source) && !/<rect\b[^>]*fill=["']white/iu.test(source)) {
    source = source.replace(/(<svg\b[^>]*>)/iu, '$1<rect x="0" y="0" width="400" height="300" fill="#fff"/>');
  }
  if (validateDocument) {
    try {
      // 浏览器 DOMParser 和 Word/PDF 渲染器都会拒绝不完整 XML；这里提前用同一套 SVG 引擎做一次结构验收。
      new Resvg(source);
    } catch {
      return "";
    }
  }
  return source;
}

export function createFigureVisualSignature(svg) {
  const source = String(svg || "");
  const geometryTags = source.match(/<(?:path|line|polyline|polygon|circle|ellipse|rect)\b[^>]*>/giu) || [];
  const geometryAttributes = new Set([
    "d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "transform", "marker-start", "marker-mid", "marker-end", "stroke-dasharray"
  ]);
  const tokens = geometryTags.map((tag) => {
    const name = tag.match(/^<([a-z]+)/iu)?.[1]?.toLowerCase() || "shape";
    const attributes = [...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/giu)]
      .filter((match) => geometryAttributes.has(match[1].toLowerCase()))
      .map((match) => `${match[1].toLowerCase()}=${match[3].replace(/\s+/gu, " ").trim()}`)
      .sort();
    return `${name}:${attributes.join(",")}`;
  });
  return createHash("sha256").update(tokens.join(";")).digest("hex").slice(0, 20);
}

function baseSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SVG_VIEWBOX}" preserveAspectRatio="xMidYMid meet"><rect x="0" y="0" width="400" height="300" fill="#fff"/>${body}</svg>`;
}

function finiteNumber(value, fallback = Number.NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function findFigureParam(params, names) {
  const candidates = [params, params?.function, params?.chart, params?.data, params?.dataset]
    .filter((item) => item && typeof item === "object" && !Array.isArray(item));
  for (const source of candidates) {
    for (const name of names) {
      if (source[name] !== undefined) return source[name];
    }
  }
  return undefined;
}

function numericArray(value, maximum = 24) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).map((item) => finiteNumber(item)).filter(Number.isFinite);
}

function labelArray(value, maximum = 24) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).map((item) => buildShortLabel(item, 8)).filter(Boolean);
}

function pointArray(value, maximum = 80) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).map((item, index) => {
    if (Array.isArray(item)) {
      const x = finiteNumber(item[0]);
      const y = finiteNumber(item[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y, label: "" } : null;
    }
    if (!item || typeof item !== "object") return null;
    const x = finiteNumber(item.x ?? item.xValue ?? item[0]);
    const y = finiteNumber(item.y ?? item.yValue ?? item.value ?? item[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, label: buildShortLabel(item.label || item.name || `P${index + 1}`, 6) };
  }).filter(Boolean);
}

function normalizedRange(value, fallback) {
  const numbers = numericArray(value, 2);
  if (numbers.length < 2 || numbers[0] === numbers[1]) return fallback;
  return numbers[0] < numbers[1] ? numbers : [numbers[1], numbers[0]];
}

function formatAxisNumber(value) {
  if (Math.abs(value) < 1e-9) return "0";
  if (Math.abs(value) >= 1000) return Number(value.toPrecision(3)).toString();
  return Number(value.toFixed(Math.abs(value) < 1 ? 2 : 1)).toString();
}

function expandedDataRange(values, includeZero = true) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [-5, 5];
  let minimum = Math.min(...finite);
  let maximum = Math.max(...finite);
  if (includeZero) {
    minimum = Math.min(0, minimum);
    maximum = Math.max(0, maximum);
  }
  if (minimum === maximum) {
    const padding = Math.max(1, Math.abs(minimum) * 0.25);
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.12;
  return [minimum - padding, maximum + padding];
}

function coefficientFromMatch(value) {
  if (!value || value === "+") return 1;
  if (value === "-") return -1;
  return finiteNumber(value, Number.NaN);
}

function readFunctionDefinition(payload) {
  const params = payload.params || {};
  const coefficients = findFigureParam(params, ["coefficients", "coefficient", "系数"]);
  const coefficientValues = Array.isArray(coefficients) ? coefficients : [];
  const coefficientObject = coefficients && typeof coefficients === "object" && !Array.isArray(coefficients) ? coefficients : {};
  let a = finiteNumber(params.a ?? coefficientObject.a ?? coefficientValues[0], 1);
  let b = finiteNumber(params.b ?? coefficientObject.b ?? coefficientValues[1], 0);
  let c = finiteNumber(params.c ?? coefficientObject.c ?? coefficientValues[2], 0);
  const expression = String(findFigureParam(params, ["expression", "equation", "formula", "函数表达式"]) || "")
    .replace(/[$\\{}\s]/gu, "")
    .replace(/f\(x\)|y/giu, "")
    .replace(/^=/u, "");
  if (expression.includes("x")) {
    const quadraticMatch = expression.match(/([+-]?(?:\d+(?:\.\d+)?)?)x(?:\^?2|²)/iu);
    const withoutQuadratic = quadraticMatch ? expression.replace(quadraticMatch[0], "") : expression;
    const linearMatch = withoutQuadratic.match(/([+-]?(?:\d+(?:\.\d+)?)?)x(?![\^\d])/iu);
    const constantMatch = withoutQuadratic.replace(linearMatch?.[0] || "", "").match(/[+-]?\d+(?:\.\d+)?/u);
    if (quadraticMatch) a = coefficientFromMatch(quadraticMatch[1]);
    if (linearMatch) b = coefficientFromMatch(linearMatch[1]);
    if (constantMatch) c = finiteNumber(constantMatch[0], c);
  }
  const combined = `${payload.description || ""} ${payload.stem || ""} ${expression}`;
  const kind = /反比例|inverse|1\/x/iu.test(combined)
    ? "inverse"
    : (/绝对值|absolute/iu.test(combined)
      ? "absolute"
      : (/一次函数|正比例|直线|linear/iu.test(combined) && !/二次|抛物线|x(?:\^?2|²)/iu.test(combined) ? "linear" : "quadratic"));
  return {
    kind,
    a: Number.isFinite(a) ? a : 1,
    b: Number.isFinite(b) ? b : 0,
    c: Number.isFinite(c) ? c : 0,
    h: finiteNumber(params.h ?? params.vertexX, 0),
    k: finiteNumber(params.k ?? params.vertexY, 0),
    expression
  };
}

function evaluateFunction(definition, x) {
  if (definition.kind === "inverse") return Math.abs(x - definition.h) < 1e-5 ? Number.NaN : definition.a / (x - definition.h) + definition.k;
  if (definition.kind === "absolute") return definition.a * Math.abs(x - definition.h) + definition.k;
  if (definition.kind === "linear") return definition.a * x + definition.b;
  return definition.a * x * x + definition.b * x + definition.c;
}

function axisTicks(range, count = 6) {
  const [minimum, maximum] = range;
  return Array.from({ length: count + 1 }, (_, index) => minimum + ((maximum - minimum) * index) / count);
}

function geometrySvg(payload) {
  const combined = `${payload.subject || ""} ${payload.description || ""} ${payload.stem || ""}`;
  if (/圆柱/u.test(combined)) {
    return baseSvg(`<defs><marker id="arrow-cylinder" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#c18b31"/></marker></defs><ellipse cx="200" cy="64" rx="92" ry="24" fill="#eaf4f6" stroke="#315e74" stroke-width="3"/><path d="M108 64 V224 M292 64 V224" fill="none" stroke="#315e74" stroke-width="3"/><path d="M108 224 C108 251 292 251 292 224" fill="#f7fbfc" stroke="#315e74" stroke-width="3"/><path d="M108 224 C108 197 292 197 292 224" fill="none" stroke="#315e74" stroke-width="2" stroke-dasharray="6 5"/><line x1="200" y1="64" x2="200" y2="224" stroke="#c18b31" stroke-width="2" stroke-dasharray="6 5"/><line x1="200" y1="64" x2="286" y2="64" stroke="#c18b31" stroke-width="2" marker-end="url(#arrow-cylinder)"/><line x1="200" y1="224" x2="200" y2="74" stroke="#c18b31" stroke-width="2" marker-end="url(#arrow-cylinder)"/><text x="238" y="56" font-size="16" fill="#a66e1f">r</text><text x="208" y="150" font-size="16" fill="#a66e1f">h</text><text x="154" y="282" font-size="14" fill="#315e74">底面为圆，侧面竖直</text>`);
  }
  if (/圆锥/u.test(combined)) {
    return baseSvg(`<path d="M200 42 L104 228 Q200 268 296 228 Z" fill="#edf4f6" stroke="#315e74" stroke-width="3"/><ellipse cx="200" cy="228" rx="96" ry="26" fill="#f7fbfc" stroke="#315e74" stroke-width="3"/><line x1="200" y1="42" x2="200" y2="228" stroke="#c18b31" stroke-width="2" stroke-dasharray="6 5"/><line x1="200" y1="228" x2="286" y2="228" stroke="#c18b31" stroke-width="2"/><text x="238" y="220" font-size="16" fill="#a66e1f">r</text><text x="208" y="145" font-size="16" fill="#a66e1f">h</text><text x="145" y="282" font-size="14" fill="#315e74">顶点到底面圆心的高</text>`);
  }
  if (/球/u.test(combined)) {
    return baseSvg(`<circle cx="200" cy="150" r="92" fill="#edf4f6" stroke="#315e74" stroke-width="3"/><ellipse cx="200" cy="150" rx="92" ry="36" fill="none" stroke="#6d929f" stroke-width="2" stroke-dasharray="6 5"/><line x1="200" y1="150" x2="292" y2="150" stroke="#c18b31" stroke-width="2"/><circle cx="200" cy="150" r="4" fill="#c18b31"/><text x="242" y="142" font-size="16" fill="#a66e1f">r</text><text x="148" y="282" font-size="14" fill="#315e74">球心到球面任一点的距离相等</text>`);
  }
  if (/长方体|正方体/u.test(combined)) {
    return baseSvg(`<path d="M90 102 L238 72 L318 116 L170 148 Z M90 102 V224 L170 270 V148 M170 148 V270 L318 238 V116" fill="#edf4f6" stroke="#315e74" stroke-width="3"/><line x1="170" y1="148" x2="318" y2="116" stroke="#c18b31" stroke-width="2"/><text x="232" y="136" font-size="15" fill="#a66e1f">长</text><text x="80" y="164" font-size="15" fill="#a66e1f">高</text><text x="188" y="266" font-size="15" fill="#a66e1f">宽</text><text x="140" y="292" font-size="14" fill="#315e74">三个方向长度共同决定体积</text>`);
  }
  return baseSvg(`<polygon points="80,230 200,70 320,230" fill="none" stroke="#333" stroke-width="3"/><circle cx="80" cy="230" r="3.5" fill="#333"/><circle cx="200" cy="70" r="3.5" fill="#333"/><circle cx="320" cy="230" r="3.5" fill="#333"/><text x="66" y="248" font-size="16">A</text><text x="194" y="58" font-size="16">B</text><text x="324" y="248" font-size="16">C</text><path d="M95 230 A15 15 0 0 1 110 214" fill="none" stroke="#666" stroke-width="2"/><text x="138" y="214" font-size="13" fill="#444">${escapeXml(buildShortLabel(payload.description))}</text>`);
}

function functionSvg(payload, coordinate = false) {
  const params = payload.params || {};
  const suppliedPoints = pointArray(findFigureParam(params, ["points", "coordinates", "坐标点"]));
  const pairedX = numericArray(findFigureParam(params, ["xValues", "xData"]));
  const pairedY = numericArray(findFigureParam(params, ["yValues", "yData"]));
  const pairedPoints = pairedX.slice(0, Math.min(pairedX.length, pairedY.length)).map((x, index) => ({ x, y: pairedY[index], label: "" }));
  const coordinatePoints = suppliedPoints.length ? suppliedPoints : pairedPoints;
  const definition = readFunctionDefinition(payload);
  const xRange = normalizedRange(findFigureParam(params, ["xRange", "domain", "x范围"]), coordinatePoints.length
    ? expandedDataRange(coordinatePoints.map((point) => point.x), true)
    : [-5, 5]);
  const samples = coordinate && coordinatePoints.length
    ? coordinatePoints
    : Array.from({ length: 161 }, (_, index) => {
        const x = xRange[0] + ((xRange[1] - xRange[0]) * index) / 160;
        return { x, y: evaluateFunction(definition, x), label: "" };
      });
  const sampledY = samples.map((point) => point.y).filter((value) => Number.isFinite(value) && Math.abs(value) < 1e6);
  const yRange = normalizedRange(findFigureParam(params, ["yRange", "range", "y范围"]), expandedDataRange(sampledY, true));
  const plot = { left: 62, right: 366, top: 48, bottom: 244 };
  const mapX = (value) => plot.left + ((value - xRange[0]) / (xRange[1] - xRange[0])) * (plot.right - plot.left);
  const mapY = (value) => plot.bottom - ((value - yRange[0]) / (yRange[1] - yRange[0])) * (plot.bottom - plot.top);
  const xTicks = axisTicks(xRange);
  const yTicks = axisTicks(yRange);
  const xAxisY = yRange[0] <= 0 && yRange[1] >= 0 ? mapY(0) : plot.bottom;
  const yAxisX = xRange[0] <= 0 && xRange[1] >= 0 ? mapX(0) : plot.left;
  const grid = [
    ...xTicks.map((value) => `<line x1="${mapX(value).toFixed(2)}" y1="${plot.top}" x2="${mapX(value).toFixed(2)}" y2="${plot.bottom}" stroke="#dbe5e9" stroke-width="1"/>`),
    ...yTicks.map((value) => `<line x1="${plot.left}" y1="${mapY(value).toFixed(2)}" x2="${plot.right}" y2="${mapY(value).toFixed(2)}" stroke="#dbe5e9" stroke-width="1"/>`)
  ].join("");
  const tickLabels = [
    ...xTicks.map((value) => {
      const x = mapX(value);
      return `<line x1="${x.toFixed(2)}" y1="${(xAxisY - 4).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(xAxisY + 4).toFixed(2)}" stroke="#334155" stroke-width="1.4"/><text x="${x.toFixed(2)}" y="${Math.min(276, plot.bottom + 18)}" text-anchor="middle" font-size="10.5" fill="#475569">${formatAxisNumber(value)}</text>`;
    }),
    ...yTicks.map((value) => {
      const y = mapY(value);
      return `<line x1="${(yAxisX - 4).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(yAxisX + 4).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#334155" stroke-width="1.4"/><text x="${plot.left - 8}" y="${(y + 3.5).toFixed(2)}" text-anchor="end" font-size="10.5" fill="#475569">${formatAxisNumber(value)}</text>`;
    })
  ].join("");

  const segments = [];
  let currentSegment = [];
  samples.forEach((point) => {
    const x = mapX(point.x);
    const y = mapY(point.y);
    const previous = currentSegment.at(-1);
    const discontinuity = !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 1200
      || (previous && Math.abs(y - previous.y) > (plot.bottom - plot.top) * 1.8);
    if (discontinuity) {
      if (currentSegment.length > 1) segments.push(currentSegment);
      currentSegment = [];
      return;
    }
    currentSegment.push({ x, y });
  });
  if (currentSegment.length > 1) segments.push(currentSegment);
  const graph = segments.map((segment) => `<polyline points="${segment.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}" fill="none" stroke="${coordinate ? "#2563eb" : "#0f766e"}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join("");

  const keyPoints = [];
  if (coordinate && coordinatePoints.length) {
    coordinatePoints.slice(0, 8).forEach((point, index) => keyPoints.push({ ...point, label: point.label || `P${index + 1}` }));
  } else if (definition.kind === "quadratic" && Math.abs(definition.a) > 1e-9) {
    const vertexX = -definition.b / (2 * definition.a);
    keyPoints.push({ x: vertexX, y: evaluateFunction(definition, vertexX), label: "顶点" });
    const discriminant = definition.b * definition.b - 4 * definition.a * definition.c;
    if (discriminant >= 0) {
      const rootOffset = Math.sqrt(discriminant);
      keyPoints.push({ x: (-definition.b - rootOffset) / (2 * definition.a), y: 0, label: "零点" });
      if (rootOffset > 1e-8) keyPoints.push({ x: (-definition.b + rootOffset) / (2 * definition.a), y: 0, label: "零点" });
    }
  } else if (definition.kind === "linear") {
    keyPoints.push({ x: 0, y: definition.b, label: "截距" });
  }
  const pointMarkup = keyPoints.filter((point) => (
    point.x >= xRange[0] && point.x <= xRange[1] && point.y >= yRange[0] && point.y <= yRange[1]
  )).slice(0, 8).map((point, index) => {
    const x = mapX(point.x);
    const y = mapY(point.y);
    const labelY = clampNumber(y + (index % 2 ? 19 : -10), plot.top + 12, plot.bottom - 8);
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.2" fill="#c2410c" stroke="#fff" stroke-width="1.5"/><text x="${clampNumber(x + 7, plot.left + 3, plot.right - 28).toFixed(2)}" y="${labelY.toFixed(2)}" font-size="11" font-weight="700" fill="#9a3412">${escapeXml(point.label)}</text>`;
  }).join("");
  const title = buildShortLabel(payload.description || payload.stem, 22);
  return baseSvg(`<defs><clipPath id="function-plot-area"><rect x="${plot.left}" y="${plot.top}" width="${plot.right - plot.left}" height="${plot.bottom - plot.top}"/></clipPath></defs><text x="${plot.left}" y="27" font-size="13.5" font-weight="700" fill="#334155">${escapeXml(title)}</text>${grid}<line x1="${plot.left}" y1="${xAxisY.toFixed(2)}" x2="${plot.right}" y2="${xAxisY.toFixed(2)}" stroke="#1f2937" stroke-width="2.2"/><line x1="${yAxisX.toFixed(2)}" y1="${plot.bottom}" x2="${yAxisX.toFixed(2)}" y2="${plot.top}" stroke="#1f2937" stroke-width="2.2"/><polygon points="${plot.right},${xAxisY.toFixed(2)} ${plot.right - 10},${(xAxisY - 5).toFixed(2)} ${plot.right - 10},${(xAxisY + 5).toFixed(2)}" fill="#1f2937"/><polygon points="${yAxisX.toFixed(2)},${plot.top} ${(yAxisX - 5).toFixed(2)},${plot.top + 10} ${(yAxisX + 5).toFixed(2)},${plot.top + 10}" fill="#1f2937"/><text x="${plot.right - 4}" y="${clampNumber(xAxisY - 8, plot.top + 12, plot.bottom - 6).toFixed(2)}" text-anchor="end" font-size="12">x</text><text x="${clampNumber(yAxisX + 8, plot.left + 8, plot.right - 14).toFixed(2)}" y="${plot.top + 13}" font-size="12">y</text>${tickLabels}<g clip-path="url(#function-plot-area)">${graph}</g>${pointMarkup}`);
}

function numberLineSvg(payload) {
  const ticks = [0, 1, 2, 3, 4, 5].map((value) => {
    const x = 80 + value * 45;
    return `<line x1="${x}" y1="142" x2="${x}" y2="168" stroke="#333" stroke-width="2"/><text x="${x - 4}" y="190" font-size="13">${value}</text>`;
  }).join("");
  return baseSvg(`<line x1="50" y1="155" x2="355" y2="155" stroke="#333" stroke-width="3"/><polygon points="355,155 343,149 343,161" fill="#333"/>${ticks}<circle cx="170" cy="155" r="5" fill="#2563eb"/><path d="M170 130 L170 100" stroke="#2563eb" stroke-width="2.5"/><polygon points="170,92 164,104 176,104" fill="#2563eb"/><text x="135" y="82" font-size="13" fill="#2563eb">${escapeXml(buildShortLabel(payload.description, 10))}</text>`);
}

function parallelCircuitSvg(payload) {
  return baseSvg(`<defs><marker id="arrow-parallel-current" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#c2410c"/></marker></defs><path d="M56 72 H104 M121 72 H168 M202 72 H338 V238 H56 V72" fill="none" stroke="#1f2937" stroke-width="3" stroke-linejoin="round"/><line x1="104" y1="52" x2="104" y2="92" stroke="#1f2937" stroke-width="2.5"/><line x1="121" y1="44" x2="121" y2="100" stroke="#1f2937" stroke-width="4"/><text x="96" y="35" font-size="14" fill="#b91c1c">＋</text><text x="117" y="35" font-size="14" fill="#1d4ed8">−</text><circle cx="168" cy="72" r="4" fill="#1f2937"/><circle cx="202" cy="72" r="4" fill="#1f2937"/><line x1="168" y1="72" x2="195" y2="58" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/><text x="166" y="48" font-size="12" fill="#475569">开关</text><path d="M138 112 H214 M250 112 H320 M138 112 V202 M320 112 V202 M138 202 H214 M250 202 H320" fill="none" stroke="#1f2937" stroke-width="2.8"/><circle cx="232" cy="112" r="18" fill="#fff7ed" stroke="#1f2937" stroke-width="2.5"/><path d="M220 100 L244 124 M244 100 L220 124" stroke="#c2410c" stroke-width="2.3"/><circle cx="232" cy="202" r="18" fill="#fff7ed" stroke="#1f2937" stroke-width="2.5"/><path d="M220 190 L244 214 M244 190 L220 214" stroke="#c2410c" stroke-width="2.3"/><circle cx="138" cy="112" r="4.5" fill="#1f2937"/><circle cx="320" cy="112" r="4.5" fill="#1f2937"/><circle cx="138" cy="202" r="4.5" fill="#1f2937"/><circle cx="320" cy="202" r="4.5" fill="#1f2937"/><path d="M138 157 H112 V238 M320 157 H338" fill="none" stroke="#1f2937" stroke-width="2.8"/><line x1="338" y1="218" x2="338" y2="172" stroke="#c2410c" stroke-width="2.5" marker-end="url(#arrow-parallel-current)"/><text x="260" y="104" font-size="12" fill="#9a3412">支路 1</text><text x="260" y="194" font-size="12" fill="#9a3412">支路 2</text><text x="92" y="267" font-size="13" fill="#475569">两支路连接在同一对节点之间，构成并联</text>`);
}

function circuitSvg(payload) {
  const combined = `${payload.description || ""} ${payload.stem || ""}`;
  if (/并联/u.test(combined) && !/串联与并联|串、并联|串并联/u.test(combined)) return parallelCircuitSvg(payload);
  const hasAmmeter = /电流表|安培表|ammeter/u.test(combined);
  const ammeter = hasAmmeter
    ? '<circle cx="104" cy="225" r="18" fill="#fff" stroke="#1f2937" stroke-width="2.5"/><text x="98" y="231" font-size="15" fill="#1f2937">A</text>'
    : "";
  return baseSvg(`<defs><marker id="arrow-current" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#c2410c"/></marker></defs><path d="M60 90 H108 M125 90 H174 M206 90 H262 M298 90 H340 V225 H60 V90" fill="none" stroke="#1f2937" stroke-width="3" stroke-linejoin="round"/><line x1="108" y1="70" x2="108" y2="110" stroke="#1f2937" stroke-width="2.5"/><line x1="125" y1="62" x2="125" y2="118" stroke="#1f2937" stroke-width="4"/><text x="100" y="53" font-size="14" fill="#b91c1c">＋</text><text x="121" y="53" font-size="14" fill="#1d4ed8">−</text><circle cx="174" cy="90" r="4" fill="#1f2937"/><circle cx="206" cy="90" r="4" fill="#1f2937"/><line x1="174" y1="90" x2="199" y2="77" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/><text x="172" y="67" font-size="12" fill="#475569">开关</text><circle cx="280" cy="90" r="18" fill="#fff7ed" stroke="#1f2937" stroke-width="2.5"/><path d="M268 78 L292 102 M292 78 L268 102" stroke="#c2410c" stroke-width="2.5"/><text x="264" y="58" font-size="12" fill="#9a3412">灯泡</text><polyline points="176,225 188,213 200,237 212,213 224,237 236,213 248,225" fill="none" stroke="#1f2937" stroke-width="2.5"/><text x="200" y="257" font-size="12" fill="#475569">电阻</text><line x1="340" y1="205" x2="340" y2="160" stroke="#c2410c" stroke-width="2.5" marker-end="url(#arrow-current)"/><text x="346" y="187" font-size="12" fill="#c2410c">电流方向</text>${ammeter}`);
}

function forceSvg(payload) {
  return baseSvg(`<defs><marker id="arrow-gravity" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#dc2626"/></marker><marker id="arrow-normal" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#059669"/></marker><marker id="arrow-friction" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#2563eb"/></marker></defs><path d="M44 244 L356 186" fill="none" stroke="#475569" stroke-width="4"/><path d="M50 250 L356 192" fill="none" stroke="#cbd5e1" stroke-width="2"/><rect x="164" y="144" width="74" height="52" rx="5" fill="#f8fafc" stroke="#1f2937" stroke-width="2.8" transform="rotate(-10.5 201 170)"/><circle cx="201" cy="170" r="4" fill="#1f2937"/><line x1="201" y1="170" x2="201" y2="254" stroke="#dc2626" stroke-width="3" marker-end="url(#arrow-gravity)"/><line x1="201" y1="170" x2="185" y2="82" stroke="#059669" stroke-width="3" marker-end="url(#arrow-normal)"/><line x1="201" y1="170" x2="126" y2="184" stroke="#2563eb" stroke-width="3" marker-end="url(#arrow-friction)"/><path d="M66 240 A30 30 0 0 1 95 234" fill="none" stroke="#c18b31" stroke-width="2"/><text x="202" y="244" font-size="13" font-weight="700" fill="#b91c1c">G 重力</text><text x="152" y="76" font-size="13" font-weight="700" fill="#047857">N 支持力</text><text x="86" y="204" font-size="13" font-weight="700" fill="#1d4ed8">f 摩擦力</text><text x="78" y="232" font-size="12" fill="#8a611b">斜面角</text><text x="62" y="48" font-size="13" fill="#475569">${escapeXml(buildShortLabel(payload.description, 16))}</text>`);
}

function opticsSvg(payload) {
  return baseSvg(`<defs><marker id="arrow-ray-a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#c2410c"/></marker><marker id="arrow-ray-b" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#15803d"/></marker></defs><line x1="34" y1="150" x2="366" y2="150" stroke="#64748b" stroke-width="1.8"/><path d="M198 54 Q179 150 198 246 M202 54 Q221 150 202 246" fill="#e0f2fe" fill-opacity=".7" stroke="#2563eb" stroke-width="2.8"/><circle cx="120" cy="150" r="4" fill="#2563eb"/><circle cx="250" cy="150" r="4" fill="#2563eb"/><text x="111" y="170" font-size="12" fill="#1d4ed8">F</text><text x="244" y="170" font-size="12" fill="#1d4ed8">F′</text><line x1="70" y1="150" x2="70" y2="84" stroke="#1f2937" stroke-width="3"/><polygon points="70,76 64,90 76,90" fill="#1f2937"/><text x="44" y="72" font-size="12" fill="#334155">物体</text><line x1="70" y1="84" x2="200" y2="84" stroke="#c2410c" stroke-width="2.8" marker-end="url(#arrow-ray-a)"/><line x1="200" y1="84" x2="330" y2="253" stroke="#c2410c" stroke-width="2.8" marker-end="url(#arrow-ray-a)"/><line x1="70" y1="84" x2="330" y2="214" stroke="#15803d" stroke-width="2.8" marker-end="url(#arrow-ray-b)"/><line x1="282" y1="150" x2="282" y2="190" stroke="#334155" stroke-width="2.6"/><polygon points="282,198 276,184 288,184" fill="#334155"/><text x="290" y="199" font-size="12" fill="#334155">倒立实像</text><circle cx="200" cy="150" r="4" fill="#1f2937"/><text x="176" y="44" font-size="13" font-weight="700" fill="#1d4ed8">凸透镜</text><text x="46" y="262" font-size="12" fill="#475569">平行光经透镜后通过像方焦点；过光心的光线方向不变</text>`);
}

function waveSvg(payload) {
  return baseSvg(`<line x1="45" y1="150" x2="355" y2="150" stroke="#d1d5db" stroke-width="1.5"/><path d="M45 150 C70 90 100 90 125 150 C150 210 180 210 205 150 C230 90 260 90 285 150 C310 210 335 210 355 150" fill="none" stroke="#7c3aed" stroke-width="3.5"/><line x1="125" y1="128" x2="205" y2="128" stroke="#111" stroke-width="2"/><text x="160" y="118" font-size="13">λ</text><text x="78" y="72" font-size="13" fill="#444">${escapeXml(buildShortLabel(payload.description, 12))}</text>`);
}

function moleculeSvg(payload) {
  const combined = `${payload.description || ""} ${payload.stem || ""}`;
  const formula = combined.match(/\\ce\{([^}]+)\}/u)?.[1] || combined.match(/\b[A-Z][A-Za-z]?\d*(?:\s*[A-Z][A-Za-z]?\d*)+/u)?.[0] || "";
  const tokens = [...new Set((formula.match(/[A-Z][a-z]?/gu) || []))].slice(0, 3);
  const labels = /水分子|H2O|H₂O/u.test(combined) ? ["O", "H", "H"] : (tokens.length >= 2 ? [tokens[0], tokens[1], tokens[2] || tokens[1]] : ["X", "Y", "Y"]);
  return baseSvg(`<line x1="142" y1="142" x2="184" y2="120" stroke="#334155" stroke-width="6" stroke-linecap="round"/><line x1="142" y1="158" x2="184" y2="180" stroke="#334155" stroke-width="6" stroke-linecap="round"/><circle cx="120" cy="150" r="30" fill="#fee2e2" stroke="#b91c1c" stroke-width="2.5"/><circle cx="202" cy="108" r="23" fill="#dbeafe" stroke="#1d4ed8" stroke-width="2.5"/><circle cx="202" cy="192" r="23" fill="#dbeafe" stroke="#1d4ed8" stroke-width="2.5"/><text x="112" y="157" font-size="17" font-weight="700" fill="#7f1d1d">${escapeXml(labels[0])}</text><text x="194" y="114" font-size="15" font-weight="700" fill="#1d4ed8">${escapeXml(labels[1])}</text><text x="194" y="198" font-size="15" font-weight="700" fill="#1d4ed8">${escapeXml(labels[2])}</text><path d="M80 84 Q120 56 160 84 M245 78 Q280 98 286 132" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="4 4"/><text x="56" y="62" font-size="13" fill="#475569">原子节点</text><text x="273" y="157" font-size="13" fill="#475569">共价键</text><text x="84" y="258" font-size="13" fill="#475569">${escapeXml(buildShortLabel(payload.description, 18))}</text>`);
}

function reactionSvg(payload) {
  const combined = `${payload.subject || ""} ${payload.description || ""} ${payload.stem || ""}`;
  const redox = /氧化还原|氧化剂|还原剂|失电子|得电子|电子转移|redox/u.test(combined);
  const marker = '<defs><marker id="arrow-reaction" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#9a3412"/></marker></defs>';
  const chips = redox
    ? '<rect x="38" y="214" width="148" height="38" rx="10" fill="#fff1f2" stroke="#e11d48" stroke-width="1.8"/><rect x="214" y="214" width="148" height="38" rx="10" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8"/><text x="58" y="238" font-size="13" fill="#be123c">氧化：失电子</text><text x="234" y="238" font-size="13" fill="#1d4ed8">还原：得电子</text>'
    : '<rect x="92" y="216" width="216" height="36" rx="10" fill="#f8fafc" stroke="#64748b" stroke-width="1.6"/><text x="137" y="239" font-size="13" fill="#475569">守恒：原子种类与数目不变</text>';
  const centerLabel = redox ? "电子转移" : "反应进行";
  return baseSvg(`${marker}<text x="137" y="48" font-size="15" font-weight="700" fill="#334155">化学反应关系图</text><rect x="34" y="92" width="112" height="76" rx="12" fill="#fff1f2" stroke="#e11d48" stroke-width="2.5"/><rect x="254" y="92" width="112" height="76" rx="12" fill="#eff6ff" stroke="#2563eb" stroke-width="2.5"/><text x="65" y="126" font-size="15" fill="#be123c">反应物</text><text x="283" y="126" font-size="15" fill="#1d4ed8">生成物</text><text x="56" y="150" font-size="12" fill="#9f1239">已有条件</text><text x="275" y="150" font-size="12" fill="#1e40af">新物质</text><line x1="150" y1="130" x2="250" y2="130" stroke="#9a3412" stroke-width="2.8" marker-end="url(#arrow-reaction)"/><text x="174" y="112" font-size="13" fill="#9a3412">${centerLabel}</text><path d="M200 145 C182 169 182 188 200 204 C218 188 218 169 200 145 Z" fill="#fed7aa" stroke="#c2410c" stroke-width="1.8"/><text x="184" y="181" font-size="12" fill="#9a3412">反应条件</text>${chips}<text x="70" y="76" font-size="12" fill="#64748b">${escapeXml(buildShortLabel(payload.description, 18))}</text>`);
}

function timelineSvg(payload) {
  const nodes = [90, 165, 245, 320].map((x, index) => `<circle cx="${x}" cy="155" r="6" fill="${index % 2 ? "#059669" : "#2563eb"}"/><line x1="${x}" y1="155" x2="${x}" y2="${index % 2 ? 205 : 105}" stroke="#999" stroke-width="2"/><text x="${x - 5}" y="${index % 2 ? 224 : 96}" font-size="13">${index + 1}</text>`).join("");
  return baseSvg(`<line x1="55" y1="155" x2="345" y2="155" stroke="#333" stroke-width="3"/>${nodes}<text x="78" y="62" font-size="13" fill="#444">${escapeXml(buildShortLabel(payload.description))}</text>`);
}

function vennSvg(payload) {
  return baseSvg(`<circle cx="165" cy="150" r="72" fill="#dbeafe" fill-opacity=".6" stroke="#2563eb" stroke-width="3"/><circle cx="235" cy="150" r="72" fill="#d1fae5" fill-opacity=".6" stroke="#059669" stroke-width="3"/><text x="132" y="95" font-size="16" fill="#2563eb">A</text><text x="260" y="95" font-size="16" fill="#059669">B</text><text x="182" y="154" font-size="13">A∩B</text><text x="95" y="245" font-size="13" fill="#444">${escapeXml(buildShortLabel(payload.description, 12))}</text>`);
}

function readChartDataset(payload) {
  const params = payload.params || {};
  const rawData = findFigureParam(params, ["data", "dataset", "数据"]);
  let categories = labelArray(findFigureParam(params, ["categories", "labels", "xLabels", "类别"]));
  let values = numericArray(findFigureParam(params, ["values", "counts", "yValues", "数值"]));
  if (Array.isArray(rawData) && rawData.some((item) => item && typeof item === "object" && !Array.isArray(item))) {
    const items = rawData.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, 12);
    categories = categories.length ? categories : items.map((item, index) => buildShortLabel(item.label || item.name || item.category || `第${index + 1}组`, 8));
    values = values.length ? values : items.map((item) => finiteNumber(item.value ?? item.y ?? item.count)).filter(Number.isFinite);
  }
  const rawSeries = findFigureParam(params, ["series", "系列"]);
  if (!values.length && Array.isArray(rawSeries)) {
    const firstSeries = rawSeries.find((item) => item && typeof item === "object") || rawSeries;
    values = numericArray(firstSeries?.values || firstSeries?.data || firstSeries);
  }
  if (!values.length && Array.isArray(rawData)) values = numericArray(rawData);
  if (!values.length) values = [4, 7, 6, 9, 5];
  values = values.slice(0, 12);
  if (!categories.length) categories = values.map((_, index) => `第${index + 1}组`);
  while (categories.length < values.length) categories.push(`第${categories.length + 1}组`);
  return { categories: categories.slice(0, values.length), values };
}

function pieChartSvg(payload, dataset) {
  const colors = ["#2f6f8f", "#57a06d", "#d99a2b", "#cc6650", "#7868a6", "#5d8f90"];
  const values = dataset.values.slice(0, 6).map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  let angle = -Math.PI / 2;
  const sectors = values.map((value, index) => {
    const nextAngle = angle + (value / total) * Math.PI * 2;
    const start = { x: 145 + 82 * Math.cos(angle), y: 158 + 82 * Math.sin(angle) };
    const end = { x: 145 + 82 * Math.cos(nextAngle), y: 158 + 82 * Math.sin(nextAngle) };
    const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
    const path = value === total
      ? `<circle cx="145" cy="158" r="82" fill="${colors[index]}" stroke="#fff" stroke-width="2"/>`
      : `<path d="M145 158 L${start.x.toFixed(2)} ${start.y.toFixed(2)} A82 82 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z" fill="${colors[index]}" stroke="#fff" stroke-width="2"/>`;
    angle = nextAngle;
    return path;
  }).join("");
  const legend = values.map((value, index) => {
    const y = 86 + index * 29;
    const percent = `${Math.round((value / total) * 100)}%`;
    return `<rect x="252" y="${y - 12}" width="13" height="13" rx="2" fill="${colors[index]}"/><text x="274" y="${y}" font-size="11.5" fill="#334155">${escapeXml(dataset.categories[index])} ${percent}</text>`;
  }).join("");
  return baseSvg(`<text x="42" y="32" font-size="13.5" font-weight="700" fill="#334155">${escapeXml(buildShortLabel(payload.description, 22))}</text>${sectors}<circle cx="145" cy="158" r="31" fill="#fff"/><text x="145" y="154" text-anchor="middle" font-size="11" fill="#64748b">合计</text><text x="145" y="174" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">${formatAxisNumber(total)}</text>${legend}`);
}

function climateChartSvg(payload) {
  const params = payload.params || {};
  const precipitation = numericArray(findFigureParam(params, ["precipitation", "rainfall", "降水量", "降水"]), 12);
  const temperatures = numericArray(findFigureParam(params, ["temperature", "temperatures", "气温", "temperatureData"]), 12);
  const dataItems = findFigureParam(params, ["data", "dataset"]);
  const itemPrecipitation = Array.isArray(dataItems) ? dataItems.map((item) => finiteNumber(item?.precipitation ?? item?.rainfall)).filter(Number.isFinite) : [];
  const itemTemperatures = Array.isArray(dataItems) ? dataItems.map((item) => finiteNumber(item?.temperature ?? item?.temp)).filter(Number.isFinite) : [];
  const rain = (precipitation.length ? precipitation : itemPrecipitation).slice(0, 12);
  const temp = (temperatures.length ? temperatures : itemTemperatures).slice(0, 12);
  if (!rain.length || !temp.length) return null;
  const count = Math.min(rain.length, temp.length, 12);
  const labels = labelArray(findFigureParam(params, ["categories", "labels", "months", "月份"]), 12);
  const months = Array.from({ length: count }, (_, index) => labels[index] || `${index + 1}月`);
  const plot = { left: 54, right: 357, top: 58, bottom: 238 };
  const rainMax = Math.max(10, ...rain.slice(0, count)) * 1.12;
  const tempRange = expandedDataRange(temp.slice(0, count), false);
  const step = (plot.right - plot.left) / count;
  const barWidth = Math.max(8, step * 0.62);
  const bars = rain.slice(0, count).map((value, index) => {
    const height = (Math.max(0, value) / rainMax) * (plot.bottom - plot.top);
    const x = plot.left + index * step + (step - barWidth) / 2;
    return `<rect x="${x.toFixed(2)}" y="${(plot.bottom - height).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="1.5" fill="#79b7d1"/>`;
  }).join("");
  const temperaturePoints = temp.slice(0, count).map((value, index) => {
    const x = plot.left + index * step + step / 2;
    const y = plot.bottom - ((value - tempRange[0]) / (tempRange[1] - tempRange[0])) * (plot.bottom - plot.top);
    return { x, y, value };
  });
  const line = `<polyline points="${temperaturePoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}" fill="none" stroke="#c8553d" stroke-width="2.8" stroke-linejoin="round"/>${temperaturePoints.map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3" fill="#c8553d"/>`).join("")}`;
  const categoryLabels = months.map((month, index) => `<text x="${(plot.left + index * step + step / 2).toFixed(2)}" y="257" text-anchor="middle" font-size="9.5" fill="#475569">${escapeXml(month.replace("月", ""))}</text>`).join("");
  const rainTicks = axisTicks([0, rainMax], 4).map((value) => {
    const y = plot.bottom - (value / rainMax) * (plot.bottom - plot.top);
    return `<line x1="${plot.left}" y1="${y.toFixed(2)}" x2="${plot.right}" y2="${y.toFixed(2)}" stroke="#e2e8f0" stroke-width="1"/><text x="${plot.left - 7}" y="${(y + 3).toFixed(2)}" text-anchor="end" font-size="9.5" fill="#64748b">${formatAxisNumber(value)}</text>`;
  }).join("");
  return baseSvg(`<text x="42" y="30" font-size="13.5" font-weight="700" fill="#334155">${escapeXml(buildShortLabel(payload.description, 22))}</text><text x="54" y="48" font-size="10.5" fill="#2f6f8f">降水量 / mm</text><line x1="267" y1="44" x2="287" y2="44" stroke="#c8553d" stroke-width="2.8"/><text x="294" y="48" font-size="10.5" fill="#9f3f2f">气温 / ℃</text>${rainTicks}<line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.right}" y2="${plot.bottom}" stroke="#334155" stroke-width="2"/><line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.left}" y2="${plot.top}" stroke="#334155" stroke-width="2"/>${bars}${line}${categoryLabels}<text x="349" y="257" font-size="10" fill="#64748b">月</text>`);
}

function chartSvg(payload) {
  const combined = `${payload.subject || ""} ${payload.description || ""} ${payload.stem || ""}`;
  const climate = /气候|气温.*降水|降水.*气温/u.test(combined) ? climateChartSvg(payload) : null;
  if (climate) return climate;
  const dataset = readChartDataset(payload);
  if (/饼图|扇形图|pie|donut/iu.test(combined)) return pieChartSvg(payload, dataset);
  const plot = { left: 62, right: 362, top: 56, bottom: 238 };
  const [minimum, maximum] = expandedDataRange(dataset.values, true);
  const yMinimum = Math.min(0, minimum);
  const yMaximum = maximum === yMinimum ? yMinimum + 1 : maximum;
  const step = (plot.right - plot.left) / dataset.values.length;
  const barWidth = Math.max(10, Math.min(38, step * 0.58));
  const mapY = (value) => plot.bottom - ((value - yMinimum) / (yMaximum - yMinimum)) * (plot.bottom - plot.top);
  const zeroY = mapY(0);
  const ticks = axisTicks([yMinimum, yMaximum], 5);
  const grid = ticks.map((value) => {
    const y = mapY(value);
    return `<line x1="${plot.left}" y1="${y.toFixed(2)}" x2="${plot.right}" y2="${y.toFixed(2)}" stroke="#e2e8f0" stroke-width="1"/><text x="${plot.left - 7}" y="${(y + 3.5).toFixed(2)}" text-anchor="end" font-size="10" fill="#64748b">${formatAxisNumber(value)}</text>`;
  }).join("");
  const lineMode = /折线|趋势|变化曲线|line chart/iu.test(combined);
  const points = dataset.values.map((value, index) => ({
    x: plot.left + step * index + step / 2,
    y: mapY(value),
    value,
    label: dataset.categories[index]
  }));
  const dataMarks = lineMode
    ? `<polyline points="${points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}" fill="none" stroke="#2f6f8f" stroke-width="3" stroke-linejoin="round"/>${points.map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" fill="#2f6f8f" stroke="#fff" stroke-width="1.5"/><text x="${point.x.toFixed(2)}" y="${clampNumber(point.y - 9, plot.top + 11, plot.bottom - 7).toFixed(2)}" text-anchor="middle" font-size="10" fill="#244a5a">${formatAxisNumber(point.value)}</text>`).join("")}`
    : points.map((point, index) => {
        const top = Math.min(zeroY, point.y);
        const height = Math.max(1, Math.abs(zeroY - point.y));
        const colors = ["#4e89a8", "#63a477", "#d59b3c", "#c96d5a", "#7d75a8", "#4f9290"];
        return `<rect x="${(point.x - barWidth / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" rx="3" fill="${colors[index % colors.length]}"/><text x="${point.x.toFixed(2)}" y="${clampNumber(top - 7, plot.top + 11, plot.bottom - 7).toFixed(2)}" text-anchor="middle" font-size="10" fill="#334155">${formatAxisNumber(point.value)}</text>`;
      }).join("");
  const labels = points.map((point) => `<text x="${point.x.toFixed(2)}" y="257" text-anchor="middle" font-size="10.5" fill="#475569">${escapeXml(point.label)}</text>`).join("");
  return baseSvg(`<text x="42" y="30" font-size="13.5" font-weight="700" fill="#334155">${escapeXml(buildShortLabel(payload.description, 22))}</text>${grid}<line x1="${plot.left}" y1="${zeroY.toFixed(2)}" x2="${plot.right}" y2="${zeroY.toFixed(2)}" stroke="#334155" stroke-width="2"/><line x1="${plot.left}" y1="${plot.bottom}" x2="${plot.left}" y2="${plot.top}" stroke="#334155" stroke-width="2"/>${dataMarks}${labels}`);
}

function tableSvg(payload) {
  return baseSvg(`<rect x="70" y="70" width="260" height="160" fill="#fff" stroke="#333" stroke-width="2.5"/><path d="M70 110 H330 M70 150 H330 M70 190 H330 M150 70 V230 M240 70 V230" fill="none" stroke="#333" stroke-width="2"/><text x="87" y="95" font-size="13">项目</text><text x="170" y="95" font-size="13">数据1</text><text x="258" y="95" font-size="13">数据2</text><text x="86" y="53" font-size="13" fill="#444">${escapeXml(buildShortLabel(payload.description, 12))}</text>`);
}

function biologyDiagramSvg(payload) {
  const combined = `${payload.subject || ""} ${payload.description || ""} ${payload.stem || ""}`;
  if (/(遗传|基因|孟德尔|杂交|亲本|子代)/u.test(combined)) {
    return baseSvg(`<rect x="68" y="74" width="264" height="166" fill="#fff" stroke="#334155" stroke-width="2.5"/><path d="M68 116 H332 M68 158 H332 M68 200 H332 M134 74 V240 M200 74 V240 M266 74 V240" fill="none" stroke="#94a3b8" stroke-width="1.8"/><text x="82" y="101" font-size="13" fill="#0f172a">亲本</text><text x="148" y="101" font-size="13" fill="#0f172a">配子 1</text><text x="214" y="101" font-size="13" fill="#0f172a">配子 2</text><text x="278" y="101" font-size="13" fill="#0f172a">子代</text><text x="84" y="143" font-size="14" fill="#2563eb">条件</text><text x="150" y="143" font-size="14">A</text><text x="216" y="143" font-size="14">a</text><text x="282" y="143" font-size="14">组合</text><text x="84" y="185" font-size="14" fill="#059669">分离</text><text x="150" y="185" font-size="14">A</text><text x="216" y="185" font-size="14">a</text><text x="282" y="185" font-size="14">核对</text><text x="84" y="225" font-size="13" fill="#475569">按亲本 → 配子 → 子代的顺序读表</text>`);
  }
  return baseSvg(`<ellipse cx="196" cy="154" rx="126" ry="82" fill="#eff6ff" stroke="#2563eb" stroke-width="3"/><ellipse cx="196" cy="154" rx="54" ry="40" fill="#fef3c7" stroke="#d97706" stroke-width="3"/><circle cx="196" cy="154" r="13" fill="#f59e0b"/><path d="M112 122 C128 105 142 109 151 125 M250 188 C268 203 282 195 290 179 M118 192 C136 205 151 195 160 180" fill="none" stroke="#059669" stroke-width="4" stroke-linecap="round"/><line x1="78" y1="66" x2="132" y2="104" stroke="#475569" stroke-width="1.8"/><line x1="249" y1="86" x2="225" y2="120" stroke="#475569" stroke-width="1.8"/><line x1="286" y1="236" x2="252" y2="194" stroke="#475569" stroke-width="1.8"/><text x="42" y="60" font-size="13" fill="#0f172a">细胞膜</text><text x="250" y="81" font-size="13" fill="#0f172a">细胞核</text><text x="288" y="252" font-size="13" fill="#0f172a">细胞质</text>`);
}

function ecologyDiagramSvg() {
  const labels = ["生产者", "初级消费者", "次级消费者", "分解者"];
  const x = [48, 138, 228, 318];
  const colors = ["#16a34a", "#2563eb", "#ea580c", "#7c3aed"];
  const nodes = labels.map((label, index) => `<rect x="${x[index] - 34}" y="126" width="68" height="48" rx="10" fill="#fff" stroke="${colors[index]}" stroke-width="2.5"/><text x="${x[index] - 25}" y="155" font-size="12" fill="#0f172a">${label}</text>`).join("");
  const arrows = x.slice(0, -1).map((value, index) => `<line x1="${value + 36}" y1="150" x2="${x[index + 1] - 40}" y2="150" stroke="#475569" stroke-width="2.5" marker-end="url(#arrow-ecology)"/>`).join("");
  return baseSvg(`<defs><marker id="arrow-ecology" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><polygon points="0 0, 7 3.5, 0 7" fill="#475569"/></marker></defs><text x="124" y="72" font-size="16" fill="#0f172a">物质循环与能量传递</text>${arrows}${nodes}<path d="M320 192 C270 260 112 260 48 192" fill="none" stroke="#7c3aed" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#arrow-ecology)"/><text x="122" y="247" font-size="13" fill="#475569">分解后回到环境</text>`);
}

function languageStructureDiagramSvg(payload) {
  const isEnglish = /英语|英文/u.test(`${payload.subject || ""} ${payload.description || ""}`);
  const labels = isEnglish ? ["Subject", "Verb", "Object"] : ["主语", "谓语", "宾语"];
  return baseSvg(`<line x1="200" y1="72" x2="200" y2="112" stroke="#334155" stroke-width="2.5"/><line x1="200" y1="112" x2="104" y2="154" stroke="#334155" stroke-width="2.5"/><line x1="200" y1="112" x2="200" y2="154" stroke="#334155" stroke-width="2.5"/><line x1="200" y1="112" x2="296" y2="154" stroke="#334155" stroke-width="2.5"/><rect x="140" y="42" width="120" height="34" rx="9" fill="#eff6ff" stroke="#2563eb" stroke-width="2.5"/><rect x="48" y="154" width="112" height="48" rx="9" fill="#fff" stroke="#2563eb" stroke-width="2.5"/><rect x="144" y="154" width="112" height="48" rx="9" fill="#fff" stroke="#059669" stroke-width="2.5"/><rect x="240" y="154" width="112" height="48" rx="9" fill="#fff" stroke="#ea580c" stroke-width="2.5"/><text x="164" y="64" font-size="14">句子主干</text><text x="${isEnglish ? 66 : 82}" y="184" font-size="14">${labels[0]}</text><text x="${isEnglish ? 176 : 178}" y="184" font-size="14">${labels[1]}</text><text x="${isEnglish ? 272 : 274}" y="184" font-size="14">${labels[2]}</text><text x="85" y="244" font-size="13" fill="#475569">先找主干，再补充修饰成分</text>`);
}

function oceanCurrentSvg(payload) {
  return baseSvg(`<defs><marker id="arrow-warm" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#dc5a3a"/></marker><marker id="arrow-cold" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#2878b8"/></marker><marker id="arrow-up" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="#3f7f67"/></marker></defs><rect x="24" y="50" width="352" height="210" rx="12" fill="#f4fbfd" stroke="#9fc8d6" stroke-width="1.8"/><path d="M26 76 C72 64 96 80 118 107 C137 131 150 144 171 151" fill="none" stroke="#a7b7a8" stroke-width="3"/><path d="M374 68 C341 76 329 94 318 116 C306 142 289 158 266 170" fill="none" stroke="#a7b7a8" stroke-width="3"/><path d="M54 224 C92 214 122 190 148 170 C163 158 176 151 190 148" fill="none" stroke="#dc5a3a" stroke-width="5" stroke-linecap="round" marker-end="url(#arrow-warm)"/><path d="M346 92 C315 101 286 115 258 127 C239 136 223 141 208 146" fill="none" stroke="#2878b8" stroke-width="5" stroke-linecap="round" marker-end="url(#arrow-cold)"/><ellipse cx="200" cy="150" rx="30" ry="20" fill="#fff6cb" fill-opacity=".8" stroke="#c7962d" stroke-width="2" stroke-dasharray="5 4"/><path d="M180 228 V184 M200 234 V184 M220 228 V184" fill="none" stroke="#3f7f67" stroke-width="2.2" stroke-dasharray="5 4" marker-end="url(#arrow-up)"/><circle cx="251" cy="178" r="4" fill="#4d9a69"/><circle cx="267" cy="188" r="3" fill="#4d9a69"/><circle cx="282" cy="177" r="5" fill="#4d9a69"/><path d="M286 205 Q300 194 316 204 Q300 216 286 205 Z M316 204 L326 196 L325 213 Z" fill="#5f7f98" stroke="#345164" stroke-width="1.4"/><path d="M316 226 Q330 215 346 225 Q330 237 316 226 Z M346 225 L356 217 L355 234 Z" fill="#5f7f98" stroke="#345164" stroke-width="1.4"/><text x="48" y="205" font-size="13" font-weight="700" fill="#b64128">暖流</text><text x="302" y="84" font-size="13" font-weight="700" fill="#1f6397">寒流</text><text x="176" y="145" font-size="12" font-weight="700" fill="#8a611b">交汇区</text><text x="140" y="252" font-size="12" fill="#356b58">营养盐上涌</text><text x="238" y="166" font-size="12" fill="#35724d">浮游生物增多</text><text x="302" y="247" font-size="12" fill="#345164">鱼群聚集</text><text x="38" y="34" font-size="14" font-weight="700" fill="#244a5a">${escapeXml(buildShortLabel(payload.description, 22))}</text>`);
}

function geographyProcessSvg(payload) {
  const title = escapeXml(buildShortLabel(payload.description || payload.stem, 22));
  return baseSvg(`<defs><marker id="arrow-geo-process" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="#456979"/></marker></defs><text x="42" y="45" font-size="14" font-weight="700" fill="#244a5a">${title}</text><rect x="34" y="94" width="92" height="72" rx="10" fill="#eef7fb" stroke="#377d9b" stroke-width="2.2"/><rect x="154" y="94" width="92" height="72" rx="10" fill="#f4f8ec" stroke="#64883e" stroke-width="2.2"/><rect x="274" y="94" width="92" height="72" rx="10" fill="#fff6e8" stroke="#b67632" stroke-width="2.2"/><line x1="128" y1="130" x2="150" y2="130" stroke="#456979" stroke-width="2.5" marker-end="url(#arrow-geo-process)"/><line x1="248" y1="130" x2="270" y2="130" stroke="#456979" stroke-width="2.5" marker-end="url(#arrow-geo-process)"/><text x="52" y="125" font-size="13" font-weight="700" fill="#27627b">地理条件</text><text x="52" y="148" font-size="11" fill="#4e6974">位置·地形·气候</text><text x="172" y="125" font-size="13" font-weight="700" fill="#527331">空间过程</text><text x="172" y="148" font-size="11" fill="#61715a">流动·交换·变化</text><text x="292" y="125" font-size="13" font-weight="700" fill="#915b24">区域影响</text><text x="292" y="148" font-size="11" fill="#76634f">环境·生产·生活</text><path d="M82 205 C126 180 166 220 205 197 C244 174 283 213 326 188" fill="none" stroke="#5c91a8" stroke-width="3"/><circle cx="82" cy="205" r="5" fill="#377d9b"/><circle cx="205" cy="197" r="5" fill="#64883e"/><circle cx="326" cy="188" r="5" fill="#b67632"/><text x="88" y="238" font-size="12" fill="#51656e">读图顺序：先定位条件，再沿箭头看过程，最后核对区域影响</text>`);
}

function geographyDiagramSvg(payload) {
  const combined = `${payload.description || ""} ${payload.stem || ""}`;
  if (/洋流|寒流|暖流|海流|渔场/u.test(combined)) return oceanCurrentSvg(payload);
  if (/经纬|纬度|经度|经纬网/u.test(combined)) {
    const verticals = [112, 158, 204, 250, 296].map((x) => `<path d="M${x} 72 C${x - 20} 120 ${x - 20} 180 ${x} 228" fill="none" stroke="#2563eb" stroke-width="1.8"/>`).join("");
    const horizontals = [104, 136, 168, 200].map((y) => `<path d="M72 ${y} C142 ${y - 16} 258 ${y - 16} 328 ${y}" fill="none" stroke="#059669" stroke-width="1.8"/>`).join("");
    return baseSvg(`${verticals}${horizontals}<text x="78" y="54" font-size="15" fill="#0f172a">经纬网</text><text x="296" y="249" font-size="13" fill="#2563eb">经度</text><text x="40" y="104" font-size="13" fill="#059669">纬度</text>`);
  }
  if (/等高线|地形|高程|海拔|剖面/u.test(combined)) {
    return baseSvg(`<path d="M54 224 C96 180 82 122 128 88 C164 62 204 106 238 82 C274 56 296 96 346 72" fill="none" stroke="#2563eb" stroke-width="3"/><path d="M54 248 C104 204 92 150 138 116 C174 90 214 132 248 108 C284 82 306 122 346 98" fill="none" stroke="#059669" stroke-width="3"/><path d="M54 272 C112 228 102 182 146 144 C180 118 222 158 258 134 C294 108 316 148 346 124" fill="none" stroke="#ea580c" stroke-width="3"/><line x1="72" y1="64" x2="72" y2="244" stroke="#64748b" stroke-width="1.6"/><polygon points="72,54 66,67 78,67" fill="#64748b"/><text x="82" y="62" font-size="12" fill="#475569">海拔升高</text><text x="70" y="42" font-size="15" font-weight="700" fill="#0f172a">等高线与地形起伏</text><text x="274" y="258" font-size="13" fill="#475569">线越密，坡越陡</text>`);
  }
  return geographyProcessSvg(payload);
}

function semanticLabelSet(payload) {
  const combined = `${payload.description || ""} ${payload.stem || ""}`;
  const subject = normalizeFigureSubject(payload.subject);
  if (subject === "数学") return ["已知条件", "数量关系", "核对结果"];
  if (subject === "物理") return ["物理对象", "相互作用", "观察结果"];
  if (subject === "历史") return ["历史条件", "发展过程", "时代影响"];
  if (["语文", "英语"].includes(subject)) return ["文本线索", "结构关系", "表达作用"];
  if (["政治", "道法"].includes(subject)) return ["参与主体", "运行规则", "公共影响"];
  if (/输入|条件|材料/u.test(combined)) return ["输入条件", "判断规则", "可核对结论"];
  if (/原因|过程|结果|因果/u.test(combined)) return ["原因或证据", "变化过程", "结果影响"];
  if (/分类|组成|结构/u.test(combined)) return ["核心对象", "组成关系", "应用场景"];
  return ["起点信息", "变化关系", "核对要点"];
}

function diagramSvg(payload) {
  const combined = `${payload.subject || ""} ${payload.description || ""} ${payload.stem || ""}`;
  const subject = normalizeFigureSubject(payload.subject);
  if (subject === "地理") return geographyDiagramSvg(payload);
  if (subject === "生物") {
    return /食物链|食物网|生态|生产者|消费者|分解者/u.test(combined)
      ? ecologyDiagramSvg(payload)
      : biologyDiagramSvg(payload);
  }
  if (subject === "化学") return reactionSvg(payload);
  if (subject === "历史") return timelineSvg(payload);
  if (["语文", "英语"].includes(subject)) return languageStructureDiagramSvg(payload);
  if (/化学|氧化还原|氧化剂|还原剂|失电子|得电子|电子转移|反应物|生成物|化学方程式|反应过程/u.test(combined)) return reactionSvg(payload);
  if (/食物链|食物网|生态|生产者|消费者|分解者/u.test(combined)) return ecologyDiagramSvg(payload);
  if (/生物|细胞|遗传|基因|孟德尔|杂交|亲本|子代/u.test(combined)) return biologyDiagramSvg(payload);
  if (/语文|英语|英文|句法|语法|主语|谓语|宾语|从句/u.test(combined)) return languageStructureDiagramSvg(payload);
  if (/地理|经纬|纬度|经度|等高线|地形|区域|地图/u.test(combined)) return geographyDiagramSvg(payload);
  const [leftLabel, rightLabel, resultLabel] = semanticLabelSet(payload);
  return baseSvg(`<defs><marker id="arrow-main" markerWidth="10" markerHeight="10" refX="7" refY="3.5" orient="auto"><polygon points="0 0, 7 3.5, 0 7" fill="#333"/></marker></defs><rect x="54" y="95" width="108" height="54" rx="8" fill="#eff6ff" stroke="#2563eb" stroke-width="2.5"/><rect x="238" y="95" width="108" height="54" rx="8" fill="#ecfdf5" stroke="#059669" stroke-width="2.5"/><rect x="146" y="196" width="108" height="54" rx="8" fill="#fff7ed" stroke="#ea580c" stroke-width="2.5"/><line x1="162" y1="122" x2="238" y2="122" stroke="#333" stroke-width="2.5" marker-end="url(#arrow-main)"/><line x1="200" y1="149" x2="200" y2="196" stroke="#333" stroke-width="2.5" marker-end="url(#arrow-main)"/><text x="67" y="128" font-size="14">${escapeXml(leftLabel)}</text><text x="252" y="128" font-size="14">${escapeXml(rightLabel)}</text><text x="159" y="230" font-size="14">${escapeXml(resultLabel)}</text><text x="76" y="70" font-size="13" fill="#444">${escapeXml(buildShortLabel(payload.description))}</text>`);
}

const FALLBACK_RENDERERS = Object.freeze({
  geometry: geometrySvg,
  function: (payload) => functionSvg(payload, false),
  coordinate: (payload) => functionSvg(payload, true),
  numberline: numberLineSvg,
  circuit: circuitSvg,
  force: forceSvg,
  optics: opticsSvg,
  wave: waveSvg,
  molecule: moleculeSvg,
  reaction: reactionSvg,
  timeline: timelineSvg,
  venn: vennSvg,
  chart: chartSvg,
  table: tableSvg,
  diagram: diagramSvg
});

export function buildFallbackSvg(input) {
  const payload = normalizeFigurePayload(input);
  // 直接调用回退渲染器时，显式 diagram 仍表示“通用关系图”；
  // 服务端请求会先经过 normalizeFigurePayload，因此自然语义仍会升级为具体学科类型。
  if (["diagram", "flowchart", "process", "relation", "relationship"].includes(String(input?.figureType || input?.type || "").trim().toLowerCase())) {
    payload.figureType = "diagram";
  }
  const renderer = FALLBACK_RENDERERS[payload.figureType] || FALLBACK_RENDERERS.diagram;
  return finalizeSvg(renderer(payload), { validateDocument: false });
}

function normalizeTeachingFigure(item, index, material, fallbackPlacement = {}) {
  const placement = normalizePlacement(
    item?.placement,
    fallbackPlacement.section || "knowledgeDiagrams",
    fallbackPlacement.refId || `D${index + 1}`
  );
  const role = figurePlacementRole(placement.section, placement.refId);
  const stem = compactText(item?.stem || sourceTextForPlacement(material, placement.section, placement.refId), 320);
  const subject = cleanSingleLine(material?.meta?.subject || item?.subject, 30) || "综合";
  const sourceDescription = sanitizeFigureDescription(item?.description || item?.purpose || stem)
    .replace(/^(?:本图唯一教学职责是“[^”]+”\s*)+/u, "");
  const description = sanitizeFigureDescription(`本图唯一教学职责是“${role.purpose}”${sourceDescription}`);
  const type = detectFigureType(item?.type, description, stem, subject);
  const payload = normalizeFigurePayload({
    subject,
    figureType: type,
    description,
    stem,
    params: {
      ...normalizeParams(item?.params),
      teachingRole: role.key,
      placementRef: `${placement.section}:${placement.refId}`
    },
    constraints: [
      `必须完成“${role.title}”的专属职责，构图不能与其他栏目相同`,
      ...asArray(item?.constraints)
    ]
  });
  // 讲义模型只负责提供绘图描述。只有专用渲染服务明确标记为 ready 的
  // SVG 才能进入资料；其余状态一律保持空画布，避免规则图先闪现为重复成品。
  const finalizedSubmittedSvg = item?.renderStatus === "ready"
    ? finalizeSvg(item?.svg || "", { validateDocument: true })
    : "";
  const submittedSvg = finalizedSubmittedSvg && isSemanticallyRelevantSvg(finalizedSubmittedSvg, payload)
    ? finalizedSubmittedSvg
    : "";
  const svg = submittedSvg;
  return {
    id: `F-${placement.section}-${placement.refId}`,
    subject,
    type,
    title: compactText(item?.title, 80) || role.title,
    purpose: compactText(item?.purpose, 180) || role.purpose,
    description,
    stem,
    placement,
    caption: compactText(item?.caption, 220) || "先核对标签，再观察方向、连接、刻度或位置关系。",
    params: payload.params,
    constraints: payload.constraints,
    svg,
    renderStatus: submittedSvg ? "ready" : "pending",
    hash: submittedSvg ? createHash("sha256").update(svg).digest("hex").slice(0, 16) : "",
    visualSignature: submittedSvg ? createFigureVisualSignature(svg) : "",
    teachingRole: role.key
  };
}

export function normalizeTeachingFigures(items, material = {}) {
  const source = asArray(items).slice(0, MAX_TEACHING_FIGURES);
  const figures = [];
  const sourcePlacements = new Set();
  const sectionIndexes = new Map();
  source.forEach((item, index) => {
    const section = FIGURE_PLACEMENT_SECTIONS.includes(item?.placement?.section)
      ? item.placement.section
      : "knowledgeDiagrams";
    const sectionIndex = (sectionIndexes.get(section) || 0) + 1;
    sectionIndexes.set(section, sectionIndex);
    const normalized = normalizeTeachingFigure(item, index, material, {
      section,
      refId: `${figurePlacementPrefix(section)}${sectionIndex}`
    });
    const placementKey = `${normalized.placement.section}:${normalized.placement.refId}`;
    if (!normalized.description || sourcePlacements.has(placementKey)) return;
    sourcePlacements.add(placementKey);
    figures.push(normalized);
  });
  const placements = new Set(figures.map((item) => `${item.placement.section}:${item.placement.refId}`));
  detectFigureRequirements(material).forEach((requirement) => {
    const key = `${requirement.section}:${requirement.refId}`;
    if (placements.has(key) || figures.length >= MAX_TEACHING_FIGURES) return;
    figures.push(normalizeTeachingFigure(createAutoFigure(requirement, material), figures.length, material));
    placements.add(key);
  });

  const visualSignatures = new Map();
  figures.forEach((figure, index) => {
    if (figure.renderStatus !== "ready") return;
    const previousPlacement = visualSignatures.get(figure.visualSignature);
    if (!previousPlacement) {
      visualSignatures.set(figure.visualSignature, `${figure.placement.section}:${figure.placement.refId}`);
      return;
    }
    // AI 若把同一份 SVG 填到多个栏目，丢弃重复成品并按本栏目的专属职责重新构造。
    const rebuilt = normalizeTeachingFigure({
      ...figure,
      svg: "",
      renderStatus: "pending",
      description: `${figure.description} 本图不得复用“${previousPlacement}”的视觉结构，必须围绕当前栏目重新组织对象、关系和阅读顺序。`
    }, index, material);
    figures[index] = rebuilt;
    visualSignatures.set(rebuilt.visualSignature, `${rebuilt.placement.section}:${rebuilt.placement.refId}`);
  });
  return figures;
}

export function auditTeachingFigures(material = {}) {
  const issues = [];
  const figures = asArray(material?.teachingFigures);
  const expectedSubject = normalizeFigureSubject(material?.meta?.subject);
  const placements = new Set();
  const hashes = new Map();
  const visualSignatures = new Map();
  figures.forEach((item, index) => {
    const placementKey = `${item?.placement?.section}:${item?.placement?.refId}`;
    if (placements.has(placementKey)) issues.push(`teachingFigures[${index}] 与其他图形重复使用位置 ${placementKey}`);
    placements.add(placementKey);
  });
  detectFigureRequirements(material).forEach((requirement) => {
    if (!placements.has(`${requirement.section}:${requirement.refId}`)) {
      issues.push(`${requirement.section}.${requirement.refId} 的内容依赖图形，但 teachingFigures 没有对应配图`);
    }
  });
  figures.forEach((item, index) => {
    const actualSubject = normalizeFigureSubject(item?.subject);
    const figureForAudit = { ...item, subject: expectedSubject || actualSubject };
    const type = detectFigureType(item?.type, item?.description, item?.stem, figureForAudit.subject);
    if (expectedSubject && actualSubject !== expectedSubject) {
      issues.push(`teachingFigures[${index}] 的 subject 必须为“${expectedSubject}”`);
    }
    if (!FIGURE_SPECS.types[type]) issues.push(`teachingFigures[${index}] 的 type 无法识别`);
    if (!sanitizeFigureDescription(item?.description)) issues.push(`teachingFigures[${index}] 缺少具体图形描述`);
    if (!item?.placement?.section || !item?.placement?.refId) issues.push(`teachingFigures[${index}] 缺少 placement`);
    const hasFinalSvg = item?.renderStatus === "ready";
    const hash = hasFinalSvg
      ? (item?.hash || (item?.svg ? createHash("sha256").update(item.svg).digest("hex").slice(0, 16) : ""))
      : "";
    const visualSignature = hasFinalSvg
      ? (item?.visualSignature || (item?.svg ? createFigureVisualSignature(item.svg) : ""))
      : "";
    if (hash && hashes.has(hash)) {
      issues.push(`teachingFigures[${index}] 与 ${hashes.get(hash)} 使用了完全相同的 SVG`);
    } else if (hash) {
      hashes.set(hash, `teachingFigures[${index}]`);
    }
    if (visualSignature && visualSignatures.has(visualSignature)) {
      issues.push(`teachingFigures[${index}] 与 ${visualSignatures.get(visualSignature)} 的主体构图重复，必须按栏目职责重新绘制`);
    } else if (visualSignature) {
      visualSignatures.set(visualSignature, `teachingFigures[${index}]`);
    }
    if (!hasFinalSvg && item?.svg) {
      issues.push(`teachingFigures[${index}] 尚未完成却携带了临时 SVG`);
    }
    if (hasFinalSvg && (!item?.svg || !isSemanticallyRelevantSvg(item.svg, figureForAudit))) {
      issues.push(`teachingFigures[${index}] 的 SVG 与权威学科或图形描述不一致`);
    }
  });
  return issues;
}

export function renderTeachingFigureSvg(figure) {
  const svg = finalizeSvg(figure?.svg || "", { validateDocument: false });
  if (svg && isSemanticallyRelevantSvg(svg, figure)) return svg;
  const error = new Error(`教学图形“${compactText(figure?.title || figure?.id || "未命名图形", 80)}”尚未通过导出校验`);
  error.code = "FIGURE_EXPORT_INVALID";
  throw error;
}

export function renderTeachingFigurePng(figure, width = 1600) {
  const svg = renderTeachingFigureSvg(figure);
  const rendered = new Resvg(svg, {
    background: "rgba(255, 255, 255, 0)",
    fitTo: { mode: "width", value: Math.max(400, Math.min(2400, Math.round(Number(width) || 1600))) },
    font: { loadSystemFonts: true }
  }).render();
  return Buffer.from(rendered.asPng());
}
