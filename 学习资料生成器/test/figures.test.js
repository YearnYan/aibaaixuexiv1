import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TEACHING_FIGURES,
  auditTeachingFigures,
  buildFallbackSvg,
  buildFigureSystemPrompt,
  detectFigureType,
  finalizeSvg,
  inspectSvgVisualQuality,
  isRenderableSvg,
  isSemanticallyRelevantSvg,
  normalizeFigurePayload,
  normalizeTeachingFigures,
  sanitizeFigureDescription
} from "../src/figures.js";

const TYPE_CASES = [
  ["数学", "二次函数抛物线及顶点", "function"],
  ["数学", "三角形全等与垂线", "geometry"],
  ["数学", "数轴上表示不等式解集", "numberline"],
  ["物理", "串联电路中电流表读数", "circuit"],
  ["物理", "斜面木块受力分析", "force"],
  ["物理", "凸透镜成像光路", "optics"],
  ["物理", "机械波的波峰与波长", "wave"],
  ["化学", "分子结构和化学键", "molecule"],
  ["地理", "气温曲线和降水柱状图", "chart"],
  ["历史", "事件发展时间轴", "timeline"],
  ["生物", "细胞结构示意图", "diagram"],
  ["英语", "句法结构关系图", "diagram"]
];

test("图形类型识别覆盖参考项目类型与全学科内容", () => {
  TYPE_CASES.forEach(([subject, text, expected]) => {
    assert.equal(detectFigureType("", text, text, subject), expected, `${subject}：${text}`);
  });
});

test("显式通用类型会按学科描述升级为反应图", () => {
  assert.equal(detectFigureType("diagram", "氧化还原反应中的电子转移", "反应物生成物", "化学"), "reaction");
  const svg = buildFallbackSvg({ subject: "化学", figureType: "reaction", description: "氧化还原反应中的电子转移" });
  assert.match(svg, /反应物/u);
  assert.match(svg, /生成物/u);
  assert.match(svg, /电子转移/u);
  assert.doesNotMatch(svg, /核心对象|关键关系|应用检查/u);
});

test("栏目教学职责优先于正文关键词选择图形信息架构", () => {
  const strategy = normalizeFigurePayload({
    subject: "物理",
    figureType: "circuit",
    description: "把复杂电路去表、找节点、画等效电路的动作顺序画成策略路径",
    params: { teachingRole: "strategy-1" }
  });
  const contrast = normalizeFigurePayload({
    subject: "数学",
    figureType: "function",
    description: "对照两个二次函数图像的易混条件",
    params: { teachingRole: "visual-contrast" }
  });
  const mechanism = normalizeFigurePayload({
    subject: "物理",
    figureType: "circuit",
    description: "绘制串联电路并标出电流方向",
    params: { teachingRole: "key-mechanism" }
  });
  assert.equal(strategy.figureType, "diagram");
  assert.equal(contrast.figureType, "table");
  assert.equal(mechanism.figureType, "circuit");
});

test("化学内容会拒绝通用核心对象关系占位图", () => {
  const generic = '<svg viewBox="0 0 400 300"><rect x="20" y="20" width="100" height="50"/><rect x="150" y="20" width="100" height="50"/><rect x="90" y="150" width="100" height="50"/><text>核心对象</text><text>关键关系</text><text>应用检查</text></svg>';
  assert.equal(isSemanticallyRelevantSvg(generic, { subject: "化学", description: "氧化还原反应" }), false);
});

test("参考项目全部兜底类型都输出安全可见的 400×300 SVG", () => {
  const cases = [
    ["geometry", "数学"], ["function", "数学"], ["coordinate", "数学"], ["numberline", "数学"],
    ["circuit", "物理"], ["force", "物理"], ["optics", "物理"], ["wave", "物理"],
    ["molecule", "化学"], ["reaction", "化学"], ["timeline", "历史"], ["venn", "数学"],
    ["table", "数学"], ["chart", "数学"], ["diagram", "数学"]
  ];
  cases.forEach(([figureType, subject]) => {
    const figure = {
      subject,
      figureType,
      stem: "题目条件",
      description: "绘制包含关键对象、标签和关系的规范教学图形"
    };
    const svg = buildFallbackSvg(figure);
    assert.match(svg, /viewBox="0 0 400 300"/u, figureType);
    assert.equal(isRenderableSvg(svg), true, figureType);
    assert.equal(inspectSvgVisualQuality(svg, figure).valid, true, figureType);
    assert.doesNotMatch(svg, /<script|foreignObject|on\w+\s*=|<image\b[^>]+(?:href|xlink:href)\s*=\s*["']https?:/iu, figureType);
  });
});

test("地理洋流内容即使出现浮游生物也只能生成地理图", () => {
  const figure = {
    subject: "地理",
    figureType: "diagram",
    description: "寒暖流交汇形成渔场，营养盐上涌使浮游生物增多，鱼群聚集"
  };
  assert.equal(detectFigureType("diagram", figure.description, "地理洋流的规律与影响", "地理"), "diagram");
  const svg = buildFallbackSvg(figure);
  assert.match(svg, /寒流/u);
  assert.match(svg, /暖流/u);
  assert.match(svg, /营养盐上涌/u);
  assert.match(svg, /鱼群聚集/u);
  assert.doesNotMatch(svg, /细胞膜|细胞核|细胞质/u);
  assert.equal(isSemanticallyRelevantSvg(svg, figure), true);
  assert.equal(inspectSvgVisualQuality(svg, figure).valid, true);
});

test("地理请求会拒绝结构完整但学科错误的细胞 SVG", () => {
  const cellSvg = buildFallbackSvg({ subject: "生物", figureType: "diagram", description: "细胞膜、细胞核和细胞质" });
  const geographyFigure = {
    subject: "地理",
    figureType: "diagram",
    description: "寒暖流交汇形成渔场，浮游生物增多"
  };
  assert.equal(isRenderableSvg(cellSvg), true);
  assert.equal(isSemanticallyRelevantSvg(cellSvg, geographyFigure), false);
  assert.ok(inspectSvgVisualQuality(cellSvg, geographyFigure).issues.some((issue) => /学科冲突/u.test(issue)));
});

test("SVG 标签含题意外造词或错字时必须拒绝", () => {
  const figure = {
    subject: "地理",
    figureType: "diagram",
    description: "寒暖流在海域中部交汇，营养盐上涌，浮游生物增多并形成渔场"
  };
  const typoSvg = buildFallbackSvg(figure).replace(">交汇区</text>", ">潮境（交汇麦）</text>");
  const quality = inspectSvgVisualQuality(typoSvg, figure);
  assert.equal(quality.valid, false);
  assert.ok(quality.issues.some((issue) => /题意外文字/u.test(issue)));
});

test("SVG 文字越界或明显重叠时必须拒绝", () => {
  const figure = {
    subject: "数学",
    figureType: "function",
    description: "函数图中的超出边界、标签甲和标签乙"
  };
  const base = buildFallbackSvg(figure);
  const invalid = base.replace("</svg>", '<text x="395" y="80" font-size="14">超出边界</text><text x="120" y="110" font-size="14">标签甲</text><text x="122" y="111" font-size="14">标签乙</text></svg>');
  const issues = inspectSvgVisualQuality(invalid, figure).issues;
  assert.ok(issues.some((issue) => /文字超出视口/u.test(issue)));
  assert.ok(issues.some((issue) => /文字发生重叠/u.test(issue)));
});

test("跨学科内容中的单个合法术语不会被误判为错图", () => {
  const ecologySvg = buildFallbackSvg({
    subject: "生物",
    figureType: "diagram",
    description: "海拔梯度上的生产者、消费者与分解者关系"
  }).replace("</svg>", '<text x="42" y="282" font-size="12" fill="#475569">海拔梯度</text></svg>');
  const quality = inspectSvgVisualQuality(ecologySvg, {
    subject: "生物",
    figureType: "diagram",
    description: "海拔梯度上的生态系统关系"
  });
  assert.equal(quality.valid, true);
  assert.equal(quality.issues.some((issue) => /学科冲突/u.test(issue)), false);
});

test("函数图按结构参数计算坐标范围、曲线与关键点", () => {
  const figure = {
    subject: "数学",
    figureType: "function",
    description: "二次函数图像与顶点、零点",
    params: { a: 2, b: -4, c: 1, xRange: [-2, 4], yRange: [-2, 8] }
  };
  const svg = buildFallbackSvg(figure);
  assert.match(svg, /顶点/u);
  assert.match(svg, /零点/u);
  assert.match(svg, /cx="214\.00" cy="224\.40"/u);
  assert.match(svg, /<polyline\b[^>]+points="[^"]{200,}"/u);
  assert.equal(inspectSvgVisualQuality(svg, figure).valid, true);
});

test("统计图按类别和数值计算柱高与标签", () => {
  const figure = {
    subject: "数学",
    figureType: "chart",
    description: "四组学生阅读数量柱状图",
    params: { categories: ["一组", "二组", "三组", "四组"], values: [8, 16, 12, 20] }
  };
  const svg = buildFallbackSvg(figure);
  assert.match(svg, />一组</u);
  assert.match(svg, />四组</u);
  assert.match(svg, />20</u);
  const heights = [...svg.matchAll(/<rect\b[^>]*height="([\d.]+)"[^>]*fill="#[0-9a-f]{6}"/giu)].map((match) => Number(match[1]));
  assert.ok(new Set(heights.map((height) => height.toFixed(2))).size >= 4);
  assert.equal(inspectSvgVisualQuality(svg, figure).valid, true);
});

test("地理气候图同时按降水和气温参数绘制柱线组合", () => {
  const figure = {
    subject: "地理",
    figureType: "chart",
    description: "某地一至四月气温曲线与降水柱状图",
    params: {
      months: ["1月", "2月", "3月", "4月"],
      precipitation: [20, 45, 80, 120],
      temperatures: [3, 6, 12, 18]
    }
  };
  const svg = buildFallbackSvg(figure);
  assert.match(svg, /降水量 \/ mm/u);
  assert.match(svg, /气温 \/ ℃/u);
  assert.match(svg, /<polyline\b/u);
  assert.ok((svg.match(/<rect\b/gu) || []).length >= 5);
  assert.equal(inspectSvgVisualQuality(svg, figure).valid, true);
});

test("权威学科会拒绝模型给出的跨学科具体类型", () => {
  assert.equal(detectFigureType("molecule", "寒暖流交汇形成渔场", "海水运动", "地理"), "diagram");
  assert.equal(detectFigureType("circuit", "句子主干结构", "主语谓语宾语", "英语"), "diagram");
});

test("非理科内容的 SVG 兜底图也使用学科结构，不输出通用占位节点", () => {
  const cases = [
    ["生物", "细胞膜、细胞质和细胞核的结构示意图", /细胞膜|细胞核/u],
    ["生物", "食物链中的生产者、消费者和分解者", /生产者|消费者/u],
    ["英语", "句法结构中的主语、谓语和宾语", /Subject|Verb|Object/u],
    ["地理", "经纬网中的经度与纬度", /经纬网|经度|纬度/u]
  ];
  cases.forEach(([subject, description, expected]) => {
    const svg = buildFallbackSvg({ subject, figureType: "diagram", description });
    assert.match(svg, expected, `${subject} 应包含可读的学科结构标签`);
    assert.doesNotMatch(svg, /要素 A|要素 B|>结果</u, `${subject} 不应回退到通用占位图`);
    assert.equal(isRenderableSvg(svg), true, subject);
  });
});

test("SVG 校验拒绝脚本、外链和只有文字的伪图形", () => {
  assert.equal(isRenderableSvg('<svg><script>alert(1)</script><rect width="10" height="10"/></svg>'), false);
  assert.equal(isRenderableSvg('<svg><image href="https://example.com/a.png"/></svg>'), false);
  assert.equal(isRenderableSvg('<svg><text x="1" y="1">只有文字</text></svg>'), false);
  assert.equal(finalizeSvg('<svg><text x="1" y="1">只有文字</text></svg>'), "");
});

test("SVG 结构不完整时严格拒绝，不把浏览器错误占位传到页面", () => {
  assert.equal(finalizeSvg('<svg viewBox="0 0 400 300"><path d="M0 0"></svg>'), "");
});

test("学科语义校验会拒绝与圆柱条件不匹配的通用方框图", () => {
  const generic = buildFallbackSvg({ subject: "数学", figureType: "diagram", description: "圆柱的体积结构图" });
  const relevant = buildFallbackSvg({ subject: "数学", figureType: "geometry", description: "圆柱的体积结构图" });
  assert.equal(isSemanticallyRelevantSvg(generic, { subject: "数学", description: "圆柱的体积" }), false);
  assert.equal(isSemanticallyRelevantSvg(relevant, { subject: "数学", description: "圆柱的体积" }), true);
});

test("语义校验拒绝 AI 返回的要素 A、要素 B、结果占位图", () => {
  const svg = '<svg viewBox="0 0 400 300"><rect x="10" y="10" width="40" height="40"/><text>要素 A</text><text>要素 B</text><text>结果</text></svg>';
  assert.equal(isSemanticallyRelevantSvg(svg, { subject: "英语", description: "句法结构关系" }), false);
});

test("题目图形描述会移除答案与解题线索", () => {
  const cleaned = sanitizeFigureDescription("画出抛物线。正确答案是 2；辅助线连接 AB；只标题干已有顶点。 ");
  assert.doesNotMatch(cleaned, /正确答案|辅助线连接/u);
  assert.match(cleaned, /抛物线|顶点/u);
});

test("归一化会为知识点、例题和练习补齐必要图形并建立位置关联", () => {
  const material = {
    meta: { title: "二次函数", subject: "数学" },
    knowledgeMap: { center: "二次函数图像" },
    workedExamples: [{ id: "E1", title: "抛物线读图", problem: "根据二次函数图像判断顶点。", given: "坐标系中给出抛物线。" }],
    practice: [{ id: "P1", question: "在坐标系中画出二次函数图像。" }]
  };
  material.teachingFigures = normalizeTeachingFigures([], material);
  const placements = new Set(material.teachingFigures.map((item) => `${item.placement.section}:${item.placement.refId}`));
  assert.ok(placements.has("knowledgeDiagrams:D1"));
  assert.ok(placements.has("workedExamples:E1"));
  assert.ok(placements.has("practice:P1"));
  assert.deepEqual(auditTeachingFigures(material), []);
  assert.ok(material.teachingFigures.every((item) => item.renderStatus === "pending"));
  assert.ok(material.teachingFigures.every((item) => item.svg === ""));
});

test("待绘图形不携带临时 SVG，只有 ready 成品才进入语义审计", () => {
  const wrongCellSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#fff"/><ellipse cx="200" cy="150" rx="130" ry="85"/><ellipse cx="200" cy="150" rx="55" ry="40"/><circle cx="200" cy="150" r="10"/><path d="M80 60 L130 100 M280 220 L245 190"/><text>细胞膜</text><text>细胞核</text><text>细胞质</text></svg>';
  const material = {
    meta: { title: "洋流", subject: "地理" },
    knowledgeDiagrams: [
      { title: "洋流全景", purpose: "看全局", explanation: "寒暖流交汇" },
      { title: "判断路径", purpose: "会判断", explanation: "根据流向判断" }
    ],
    visuals: [], workedExamples: [], practice: [], keyPoints: []
  };
  material.teachingFigures = normalizeTeachingFigures([{
    id: "模型重复图",
    subject: "生物",
    type: "diagram",
    description: "寒流与暖流交汇形成渔场",
    placement: { section: "knowledgeDiagrams", refId: "D1" },
    renderStatus: "fallback",
    svg: wrongCellSvg
  }], material);

  assert.equal(material.teachingFigures[0].renderStatus, "pending");
  assert.equal(material.teachingFigures[0].svg, "");
  assert.deepEqual(auditTeachingFigures(material), []);

  material.teachingFigures[0] = {
    ...material.teachingFigures[0],
    renderStatus: "ready",
    svg: wrongCellSvg
  };
  assert.ok(auditTeachingFigures(material).some((issue) => /SVG 与权威学科或图形描述不一致/u.test(issue)));
});

test("重点中的自然图形会生成独立 K placement", () => {
  const material = {
    meta: { title: "串联电路", subject: "物理" },
    keyPoints: [{ id: "K1", title: "串联电路", explanation: "电路中电流、电压和电阻的连接关系。" }],
    knowledgeDiagrams: [{ title: "全景图", purpose: "看全局", explanation: "电路结构" }, { title: "判断图", purpose: "会判断", explanation: "串联与并联" }],
    visuals: [], workedExamples: [], practice: []
  };
  const figures = normalizeTeachingFigures([], material);
  assert.ok(figures.some((figure) => figure.placement.section === "keyPoints" && figure.placement.refId === "K1"));
  assert.ok(figures.some((figure) => figure.placement.section === "keyPoints" && figure.type === "circuit"));
});

test("固定十个图位优先于重点配图，P4 不会被数量上限挤掉", () => {
  const material = {
    meta: { title: "二次函数", subject: "数学" },
    knowledgeDiagrams: [
      { title: "完整全景", purpose: "看完整结构", explanation: "函数图像完整结构" },
      { title: "判断路径", purpose: "按条件判断", explanation: "函数图像判断路径" }
    ],
    visuals: [
      { title: "易混对照", caption: "对比图像", items: ["开口方向"] },
      { title: "变化过程", caption: "观察变化", items: ["顶点移动"] }
    ],
    keyPoints: Array.from({ length: 3 }, (_, index) => ({
      id: `K${index + 1}`,
      title: `函数重点 ${index + 1}`,
      explanation: "根据二次函数图像、坐标和抛物线完成判断。"
    })),
    workedExamples: Array.from({ length: 2 }, (_, index) => ({
      id: `E${index + 1}`,
      title: `示范 ${index + 1}`,
      problem: "根据坐标系中的抛物线判断顶点。",
      given: "题目给出一条二次函数图像。"
    })),
    practice: Array.from({ length: 4 }, (_, index) => ({
      id: `P${index + 1}`,
      question: `在坐标系中完成第 ${index + 1} 道二次函数读图题。`
    }))
  };
  const figures = normalizeTeachingFigures([], material);
  const placements = new Set(figures.map((item) => `${item.placement.section}:${item.placement.refId}`));
  ["D1", "D2"].forEach((id) => assert.ok(placements.has(`knowledgeDiagrams:${id}`)));
  ["V1", "V2"].forEach((id) => assert.ok(placements.has(`visuals:${id}`)));
  ["E1", "E2"].forEach((id) => assert.ok(placements.has(`workedExamples:${id}`)));
  ["P1", "P2", "P3", "P4"].forEach((id) => assert.ok(placements.has(`practice:${id}`)));
  assert.ok(figures.length <= MAX_TEACHING_FIGURES);
  assert.equal(new Set(figures.map((item) => item.teachingRole)).size, figures.length);
});

test("正文明确引用图形时生成栏目专属位置，不再借用 D1 或 D2", () => {
  const material = {
    meta: { title: "受力分析", subject: "物理" },
    knowledgeDiagrams: [],
    visuals: [],
    keyPoints: [],
    workedExamples: [],
    practice: [],
    strategyCards: [{ scenario: "如图判断受力方向", trigger: "斜面上的物体", route: [] }],
    closeReading: [{ heading: "图中箭头", original: "据图说明方向", explanation: "核对箭头", question: "方向如何" }],
    mistakes: [{ wrong: "看图后方向画反", right: "沿箭头判断", reason: "忽略方向" }],
    masteryChecks: [{ id: "M1", task: "根据下图标出受力", deliverable: "完整受力图", criteria: "方向正确", outputFrame: [] }]
  };
  const figures = normalizeTeachingFigures([], material);
  const placements = new Set(figures.map((item) => `${item.placement.section}:${item.placement.refId}`));
  assert.ok(placements.has("strategyCards:S1"));
  assert.ok(placements.has("closeReading:C1"));
  assert.ok(placements.has("mistakes:X1"));
  assert.ok(placements.has("masteryChecks:M1"));
  ["strategyCards", "closeReading", "mistakes", "masteryChecks"].forEach((section) => {
    const figure = figures.find((item) => item.placement.section === section);
    assert.match(figure.description, /唯一教学职责/u);
  });
});

test("模型把 refId 写成标题时按栏目局部顺序纠正，不保留孤儿图", () => {
  const material = {
    meta: { title: "二次函数", subject: "数学" },
    knowledgeDiagrams: [
      { title: "全景", purpose: "看结构", explanation: "二次函数图像全景" },
      { title: "路径", purpose: "会判断", explanation: "二次函数判断路径" }
    ],
    visuals: [
      { title: "对照", caption: "对照开口", items: ["开口"] },
      { title: "变化", caption: "观察平移", items: ["平移"] }
    ],
    keyPoints: [],
    workedExamples: [],
    practice: []
  };
  const figures = normalizeTeachingFigures([
    { id: "bad-D1", placement: { section: "knowledgeDiagrams", refId: "二次函数全景图" }, description: "二次函数图像完整结构" },
    { id: "bad-D2", placement: { section: "knowledgeDiagrams", refId: "二次函数判断路径" }, description: "二次函数判断分支" },
    { id: "bad-V1", placement: { section: "visuals", refId: "开口方向对照" }, description: "二次函数开口对照" },
    { id: "bad-V2", placement: { section: "visuals", refId: "平移过程" }, description: "二次函数平移过程" }
  ], material);
  assert.deepEqual(
    figures.slice(0, 4).map((item) => `${item.placement.section}:${item.placement.refId}`),
    ["knowledgeDiagrams:D1", "knowledgeDiagrams:D2", "visuals:V1", "visuals:V2"]
  );
  assert.ok(figures.every((item) => /^[DVEKPSCMX]\d+$/u.test(item.placement.refId)));
});

test("参考项目式提示词同时注入学科、图形类型和安全约束", () => {
  const prompt = buildFigureSystemPrompt("物理", "circuit");
  assert.match(prompt, /400x300|0 0 400 300/u);
  assert.match(prompt, /电路连接/u);
  assert.match(prompt, /完整闭合导线/u);
  assert.match(prompt, /不得添加答案/u);
  assert.match(prompt, /script|外链资源/u);
});
