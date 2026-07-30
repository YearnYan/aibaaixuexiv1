import assert from "node:assert/strict";
import test from "node:test";
import { createMaterialTemplate, extractSourceAtoms, inferSubject, normalizeMaterial } from "../src/material.js";

test("讲义结构模板满足完整输出不变量", () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "荷塘月色.docx",
      kind: "docx",
      size: 1_024,
      text: "荷塘月色\n这几天心里颇不宁静。沿着荷塘，是一条曲折的小煤屑路。"
    }],
    options: { grade: "高中", subject: "语文", depth: "detailed" }
  });

  assert.equal(material.meta.title, "荷塘月色");
  assert.equal(material.meta.grade, "高中");
  assert.equal(material.learningGoals.length, 3);
  assert.ok(material.learningGoals.every((goal) => goal.text.length <= 36));
  assert.equal(material.overview.coreModel.reasoningChain.length, 3);
  assert.equal(material.overview.coreModel.boundaries.length, 2);
  assert.equal(material.quickStart.prerequisites.length, 2);
  assert.equal(material.quickStart.studyPlan.length, 3);
  assert.ok(material.quickStart.studyPlan.reduce((total, item) => total + item.minutes, 0) <= 5);
  assert.ok(["closed", "open", "single"].includes(material.knowledgeMap.scopeType));
  assert.ok(material.knowledgeMap.scope && material.knowledgeMap.coverageSummary);
  assert.ok(material.knowledgeMap.coverageDimensions.length >= 4);
  assert.ok(material.knowledgeMap.nodes.length >= 6);
  assert.ok(material.knowledgeMap.nodes.every((node) => Array.isArray(node.members)));
  assert.equal(material.keyPoints.length, 3);
  assert.ok(material.keyPoints.every((point) => (
    point.principle
    && point.useWhen
    && point.boundary
    && point.sourceRefs.length
    && point.diagnostic.prompt
    && point.diagnostic.expected
    && point.diagnostic.trap
    && point.diagnostic.repair
  )));
  assert.ok(material.keyPoints.every((point) => (
    point.title.length <= 18
    && point.explanation.length <= 120
    && point.principle.length <= 55
    && point.useWhen.length <= 55
    && point.boundary.length <= 55
  )));
  assert.equal(material.strategyCards.length, 3);
  assert.ok(material.strategyCards.every((card) => (
    card.trigger
    && card.firstMove
    && card.route.length >= 2
    && card.scoringPoints.length >= 2
    && card.commonLoss
    && card.variation
  )));
  assert.equal(material.workedExamples.length, 2);
  assert.ok(material.workedExamples.every((example) => (
    example.steps.length >= 2
    && example.sourceRefs.length
    && example.scoringPoints.length >= 2
    && example.decisionFork.temptingMove
    && example.decisionFork.whyItFails
    && example.decisionFork.recoveryMove
  )));
  assert.ok(material.workedExamples.every((example) => (
    example.title.length <= 24
    && example.problem.length <= 100
    && example.answer.length <= 100
    && example.steps.length <= 3
    && example.steps.every((step) => step.explanation.length <= 55)
  )));
  assert.equal(material.closeReading.length, 2);
  assert.ok(material.closeReading.every((item) => item.original && item.explanation && item.question && item.sourceRefs.length));
  assert.ok(material.concepts.length >= 4 && material.concepts.length <= 6);
  assert.ok(material.concepts.every((item) => item.term && item.definition && item.example));
  assert.equal(material.knowledgeDiagrams.length, 2);
  assert.ok(material.knowledgeDiagrams.every((item) => item.title && item.figureType && item.figureHint));
  assert.ok(material.teachingFigures.length >= 10);
  assert.equal(material.visuals.length, 2);
  assert.ok(material.visuals.every((item) => item.title && item.caption));
  assert.ok(material.mistakes.length >= 3 && material.mistakes.length <= 4);
  assert.ok(material.mistakes.every((item) => item.wrong && item.right && item.reason));
  assert.equal(material.practice.length, 4);
  assert.ok(material.practice.every((practice) => practice.solvingPlan && practice.scoringPoints.length >= 2 && practice.sourceRefs.length));
  assert.ok(material.practice.every((practice) => (
    practice.question.length <= 90
    && practice.answer.length <= 120
    && practice.explanation.length <= 120
  )));
  assert.deepEqual(material.masteryChecks.map((item) => item.level), ["复述", "应用", "迁移"]);
  assert.ok(material.masteryChecks.every((item) => item.deliverable && item.outputFrame.length >= 3 && item.rubric.length >= 2 && item.sourceRefs.length));
  assert.ok(material.masteryChecks.every((item) => (
    item.task.length <= 90
    && item.deliverable.length <= 80
    && item.criteria.length <= 80
  )));
  assert.equal(material.reviewPlan.length, 4);
  assert.ok(material.reviewPlan.every((item) => item.day && item.task && item.duration));
  assert.equal(material.sourceFiles[0].name, "荷塘月色.docx");
});

test("最终资料清洗保留全部基础图位，不把 P4 裁出结果", () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "二次函数.txt",
      kind: "text",
      text: "二次函数的图像、顶点、对称轴、开口方向和坐标轴交点。"
    }],
    options: { grade: "初中", subject: "数学", depth: "detailed" }
  });
  const placements = new Set(material.teachingFigures.map((item) => `${item.placement.section}:${item.placement.refId}`));
  ["P1", "P2", "P3", "P4"].forEach((id) => assert.ok(placements.has(`practice:${id}`)));
  assert.ok(material.teachingFigures.length >= 10);
});

test("自动识别优先采用用户输入中的明确学科并锁定结果", () => {
  assert.equal(inferSubject("语文作文：如何写好人物细节", "自动识别"), "语文");
  assert.equal(inferSubject("英语作文：My School", "自动识别"), "英语");
  assert.equal(inferSubject("数学函数与图像", "自动识别"), "数学");
  assert.equal(inferSubject("语文作文", "英语"), "英语");

  const defaults = createMaterialTemplate({
    sources: [{ name: "手动输入的知识点", text: "语文作文" }],
    options: { subject: "自动识别", grade: "初中" }
  });
  const material = normalizeMaterial({
    meta: { title: "初中英语：语文作文", subject: "英语" }
  }, defaults);

  assert.equal(defaults.meta.subject, "语文");
  assert.equal(material.meta.subject, "语文");
  assert.equal(material.meta.title, "语文作文");
});

test("模型结果缺字段时补齐结构并清理 HTML", () => {
  const defaults = createMaterialTemplate();
  const normalized = normalizeMaterial({
    meta: { title: "<b>安全标题</b>", estimatedMinutes: 500 },
    learningGoals: [{ level: "理解", text: "看懂主题" }],
    quickStart: { studyPlan: [{ minutes: 99, task: "开始" }] },
    workedExamples: [{ title: "示范", steps: [{ label: "一步", explanation: "思考" }] }],
    practice: [{ question: "一道题", options: ["A. A. 正确", "dishonesty C. y = kx + b"] }],
    masteryChecks: [
      { level: "复述", task: "复述一次" },
      { level: "复述", task: "重复层级" },
      { level: "复述", task: "仍是重复层级" }
    ]
  }, defaults);

  assert.equal(normalized.meta.title, "安全标题");
  assert.equal(normalized.meta.estimatedMinutes, 180);
  assert.equal(normalized.learningGoals.length, 3);
  assert.equal(normalized.quickStart.studyPlan.length, 3);
  assert.ok(normalized.quickStart.studyPlan.reduce((total, item) => total + item.minutes, 0) <= 5);
  assert.equal(normalized.overview.coreModel.reasoningChain.length, 3);
  assert.equal(normalized.overview.coreModel.boundaries.length, 2);
  assert.ok(normalized.keyPoints.every((point) => point.sourceRefs.length && point.principle && point.boundary && point.diagnostic.expected));
  assert.equal(normalized.strategyCards.length, 3);
  assert.equal(normalized.workedExamples.length, 2);
  assert.ok(normalized.workedExamples.every((example) => (
    example.steps.length >= 2
    && example.steps.every((step) => step.rationale && step.checkpoint)
    && example.decisionFork.whyItFails
  )));
  assert.equal(normalized.practice.length, 4);
  assert.equal(normalized.practice[0].options[0], "正确");
  assert.equal(normalized.practice[0].options[1], "y = kx + b");
  assert.ok(normalized.practice.every((practice) => practice.scoringPoints.length >= 2 && practice.repairAction));
  assert.equal(normalized.closeReading.length, 2);
  assert.ok(normalized.concepts.length >= 4);
  assert.ok(normalized.knowledgeDiagrams.length >= 1);
  assert.equal(normalized.visuals.length, 2);
  assert.ok(normalized.mistakes.length >= 3);
  assert.equal(normalized.reviewPlan.length, 4);
  assert.deepEqual(normalized.masteryChecks.map((item) => item.level), ["复述", "应用", "迁移"]);
  assert.ok(normalized.masteryChecks.every((item) => item.outputFrame.length >= 3));
});

test("生成内容清理旧表述，并让标题只保留知识主题", () => {
  const defaults = createMaterialTemplate({
    sources: [{
      name: "一般过去时.txt",
      text: "一般过去时用于表示过去发生的动作。"
    }],
    options: { subject: "英语", grade: "初中" }
  });
  const topic = "初中英语：一般过去时";
  const packagedTitles = [
    `${topic}自学指南`,
    `${topic}学习指南`,
    `${topic}讲义`,
    `${topic}工作页`,
    `${topic}（学习讲义）`,
    `《${topic}自学指南》`,
    `学习指南：${topic}`
  ];

  packagedTitles.forEach((title) => {
    const material = normalizeMaterial({ meta: { title } }, defaults);
    assert.equal(material.meta.title, topic);
  });

  const filenameMaterial = createMaterialTemplate({
    sources: [{ name: `${topic}自学指南.txt`, text: "" }],
    options: { subject: "英语", grade: "初中" }
  });
  assert.equal(filenameMaterial.meta.title, topic);

  const material = normalizeMaterial({
    meta: {
      title: `${topic}自学指南`,
      summary: "这份自学资料会带你认识一般过去时。"
    },
    learningGoals: [{ level: "理解", text: "完成自学后，能说出一般过去时的用法。" }],
    overview: {
      coreQuestion: "自学时怎样判断句子要用一般过去时？",
      readingTip: "先看时间词，再检查动词变化。",
      outline: ["自学前先看时间词"]
    },
    strategyCards: [{
      scenario: "自学检查",
      trigger: "句中出现过去时间词。",
      firstMove: "先圈出时间词。",
      route: [{ action: "找时间词", reason: "判断动作发生的时间。" }, { action: "改动词", reason: "让形式对应时间。" }],
      scoringPoints: ["找对时间词", "动词变化正确"],
      commonLoss: "自学时只看动词，不看时间。",
      variation: "换一个过去时间词后再判断。"
    }],
    visuals: [{
      type: "flow",
      title: "自学判断步骤",
      caption: "一步一步完成自学检查。",
      items: ["看时间词", "改动词"]
    }],
    learningRoute: [{
      focus: "自学时先看时间线索",
      action: "完成自学练习后核对答案。",
      proof: "写出自学后的判断理由。"
    }]
  }, defaults);

  assert.equal(material.meta.title, topic);
  assert.doesNotMatch(JSON.stringify(material), /自学/u);
});

test("重点讲解补齐白话说明、例子与检查动作", () => {
  const defaults = createMaterialTemplate({
    sources: [{
      name: "动词分类.txt",
      text: "实义动词表示动作或状态。系动词常接形容词或名词来说明主语。感官动词 smell 后面可接形容词。"
    }],
    options: { subject: "英语", grade: "初中" }
  });
  const sourceRef = defaults.sourceAtoms[0].id;
  const material = normalizeMaterial({
    keyPoints: [{
      title: "分清实义动词和系动词",
      explanation: "实义动词写动作，系动词把主语和状态连起来。",
      principle: "先看动词后面说明动作，还是说明主语状态。",
      useWhen: "句子里有感官动词，或动词后面接形容词时。",
      boundary: "不能看到动词就当动作词；先看后面说的是动作还是状态。",
      example: sourceRef,
      memoryTip: "同上",
      retrievalQuestion: "想一想",
      sourceRefs: [sourceRef]
    }]
  }, defaults);
  const point = material.keyPoints[0];

  assert.match(point.explanation, /先找句子里的线索/u);
  assert.match(point.example, /^例子：资料中提到“/u);
  assert.doesNotMatch(point.example, /^S\d+(?:-\d+)?$/u);
  assert.ok(point.memoryTip.length >= 6);
  assert.notEqual(point.memoryTip, "同上");
  assert.ok(point.retrievalQuestion.length >= 12);
  assert.ok(point.principle && point.useWhen && point.boundary && point.diagnostic.expected);
  assert.doesNotMatch(JSON.stringify(material), /自学/u);
});

test("不同学科使用不同的快速掌握策略", () => {
  const science = createMaterialTemplate({
    sources: [{ name: "函数.txt", text: "一次函数的图像与性质" }],
    options: { subject: "数学" }
  });
  const english = createMaterialTemplate({
    sources: [{ name: "travel.txt", text: "Travel vocabulary and grammar" }],
    options: { subject: "英语" }
  });

  assert.match(science.workedExamples[0].strategy, /条件|规律/);
  assert.match(english.workedExamples[0].strategy, /语境|搭配/);
  assert.notEqual(science.quickStart.firstChallenge, english.quickStart.firstChallenge);
  assert.equal(science.closeReading.length, 2);
  assert.match(science.overview.coreModel.coreClaim, /条件/);
  assert.match(english.overview.coreModel.coreClaim, /语境/);

  const exam = createMaterialTemplate({
    sources: [{ name: "函数.txt", text: "一次函数 y=kx+b" }],
    options: { subject: "数学", goal: "exam" }
  });
  const deep = createMaterialTemplate({
    sources: [{ name: "函数.txt", text: "一次函数 y=kx+b" }],
    options: { subject: "数学", goal: "deep" }
  });
  assert.match(exam.overview.readingTip, /稳定得分/);
  assert.match(deep.overview.readingTip, /深度理解/);
  assert.equal(exam.strategyCards.length, 3);
  assert.match(exam.practice[0].solvingPlan, /限时/);
  assert.match(deep.practice.at(-1).question, /反例/);
  assert.match(deep.masteryChecks[2].criteria, /反例/);
});

test("资料证据单元只提取原资料，并为学习任务建立可追溯引用", () => {
  const sourceText = "一次函数 y=kx+b。定义中 k 不等于 0。当 k>0 时，y 随 x 增大而增大。当 k=0 时，原关系不成立。解题时先确定 k 的取值，再判断图像变化。";
  const sources = [{ name: "一次函数.txt", text: sourceText }];
  const atoms = extractSourceAtoms(sources, "数学");
  const material = createMaterialTemplate({ sources, options: { subject: "数学", goal: "exam" } });
  const atomIds = new Set(material.sourceAtoms.map((atom) => atom.id));

  assert.ok(atoms.length >= 3 && atoms.length <= 4);
  assert.ok(atoms.every((atom) => sourceText.includes(atom.text)));
  assert.ok(atoms.some((atom) => atom.kind === "formula"));
  assert.ok(atoms.some((atom) => atom.kind === "condition"));
  assert.ok(atoms.some((atom) => atom.kind === "boundary"));
  assert.ok(material.learningRoute.every((route) => route.sourceRefs.every((reference) => atomIds.has(reference))));
  assert.ok(material.keyPoints.every((item) => item.sourceRefs.every((reference) => atomIds.has(reference))));
  assert.ok(material.workedExamples.every((item) => item.sourceRefs.every((reference) => atomIds.has(reference))));
  assert.ok(material.practice.every((item) => item.sourceRefs.every((reference) => atomIds.has(reference))));
  assert.ok(material.masteryChecks.every((item) => item.sourceRefs.every((reference) => atomIds.has(reference))));
  assert.ok(material.strategyCards.every((item) => item.sourceRefs.every((reference) => atomIds.has(reference))));
  assert.ok(material.keyPoints.every((item) => item.diagnostic.prompt.includes("资料中的“")));
  assert.ok(material.workedExamples.every((item) => item.decisionFork.temptingMove.includes("资料中的“")));
  assert.ok(material.masteryChecks.every((item) => item.outputFrame.length >= 3));
});

test("归一化拒绝未知资料引用，并保留真实资料锚点", () => {
  const defaults = createMaterialTemplate({
    sources: [{ name: "函数.txt", text: "一次函数 y=kx+b。当 k>0 时，图像从左向右上升。" }],
    options: { subject: "数学" }
  });
  const material = normalizeMaterial({
    keyPoints: [{
      title: "判断增减性",
      explanation: "根据斜率的正负判断图像变化方向。",
      principle: "斜率符号决定一次函数的增减方向。",
      useWhen: "题干给出 k 的符号或图像方向。",
      boundary: "k 等于零时不属于一次函数，需要重新判断。",
      sourceRefs: ["S99-99", "不存在的资料"],
      retrievalQuestion: "k 小于零时图像如何变化？"
    }],
    strategyCards: [{
      scenario: "符号判断",
      trigger: "题干给出 k 的正负。",
      firstMove: "先圈出 k 的符号。",
      route: [{ action: "读出 k", reason: "先确定斜率方向。" }, { action: "得出结论", reason: "按符号判断增减。" }],
      scoringPoints: ["写出 k 的符号", "说明图像方向"],
      commonLoss: "把 b 的正负当作增减依据。",
      variation: "把 k 改成负数后重做。",
      sourceRefs: ["S88-1"]
    }]
  }, defaults);
  const atomIds = new Set(material.sourceAtoms.map((atom) => atom.id));

  assert.ok(material.keyPoints[0].sourceRefs.every((reference) => atomIds.has(reference)));
  assert.equal(material.strategyCards.length, 3);
  assert.ok(material.strategyCards[0].sourceRefs.every((reference) => atomIds.has(reference)));
  assert.doesNotMatch(material.keyPoints[0].sourceRefs.join("；"), /S99|不存在/);
});

test("学习图谱把每个目标连到可验证的学习闭环", () => {
  const material = createMaterialTemplate({
    sources: [{
      name: "一次函数完整资料.txt",
      text: "一次函数 y=kx+b。定义中 k 不等于 0。当 k>0 时，y 随 x 增大而增大。当 k<0 时，y 随 x 增大而减小。当 k=0 时，原关系不成立。解题时先确定 k 的取值，再判断图像变化。"
    }],
    options: { subject: "数学", goal: "deep" }
  });
  const entities = {
    goal: new Set(material.learningGoals.map((item) => item.id)),
    node: new Set(material.knowledgeMap.nodes.map((item) => item.id)),
    point: new Set(material.keyPoints.map((item) => item.id)),
    example: new Set(material.workedExamples.map((item) => item.id)),
    practice: new Set(material.practice.map((item) => item.id)),
    mastery: new Set(material.masteryChecks.map((item) => item.id))
  };
  const entityLookup = new Map([
    ...material.knowledgeMap.nodes,
    ...material.keyPoints,
    ...material.workedExamples,
    ...material.practice,
    ...material.masteryChecks
  ].map((item) => [item.id, item]));

  assert.deepEqual(material.learningGoals.map((item) => item.id), ["G1", "G2", "G3"]);
  assert.equal(material.learningRoute.length, material.learningGoals.length);
  assert.equal(new Set(material.learningRoute.map((route) => route.goalId)).size, 3);
  assert.equal(new Set(material.learningRoute.flatMap((route) => route.practiceIds)).size, 4);
  assert.equal(material.learningGraph.status, "完整闭环");
  assert.equal(material.sourceCoverage.status, "完整覆盖");
  assert.equal(material.sourceCoverage.covered, material.sourceCoverage.total);

  material.learningRoute.forEach((route) => {
    assert.ok(entities.goal.has(route.goalId));
    assert.ok(route.knowledgeNodeIds.length && route.knowledgeNodeIds.every((id) => entities.node.has(id)));
    assert.ok(route.keyPointIds.length && route.keyPointIds.every((id) => entities.point.has(id)));
    assert.ok(route.exampleIds.length && route.exampleIds.every((id) => entities.example.has(id)));
    assert.equal(route.exampleIds.length, 1);
    assert.ok(route.practiceIds.length >= 1 && route.practiceIds.length <= 2);
    assert.ok(route.practiceIds.every((id) => entities.practice.has(id)));
    assert.ok(route.masteryCheckIds.length && route.masteryCheckIds.every((id) => entities.mastery.has(id)));
    assert.ok(route.focus.length <= 36);
    assert.ok(route.action.length <= 70);
    assert.ok(route.proof.length <= 60);
    assert.ok(route.evidenceFocus.includes("S1-"));

    const linkedIds = [
      ...route.knowledgeNodeIds,
      ...route.keyPointIds,
      ...route.exampleIds,
      ...route.practiceIds,
      ...route.masteryCheckIds
    ];
    linkedIds.forEach((id) => {
      assert.ok(route.sourceRefs.some((reference) => entityLookup.get(id).sourceRefs.includes(reference)));
    });
  });

  material.sourceCoverage.evidence.forEach((evidence) => {
    assert.ok(evidence.teachingIds.length, `${evidence.id} 应进入讲解单元`);
    assert.ok(evidence.activeTaskIds.length, `${evidence.id} 应进入主动任务`);
  });
  assert.ok(material.learningRoute.some((route) => route.sharedExampleReason));
});

test("旧模型输出会补齐图谱并拒绝重复或未知关联", () => {
  const defaults = createMaterialTemplate({
    sources: [{
      name: "函数.txt",
      text: "一次函数 y=kx+b。k 不等于 0。k 为正时图像上升。k 为零时不成立。"
    }],
    options: { subject: "数学" }
  });
  const material = normalizeMaterial({
    learningGoals: [
      { id: "G9", level: "辨析", text: "识别斜率的正负和取值限制。" },
      { id: "G9", level: "推理", text: "根据条件判断图像变化方向。" },
      { id: "错误格式", level: "检验", text: "检查边界条件是否成立。" },
      { id: "G4", level: "多余", text: "这项目标不应进入三步路径。" }
    ],
    knowledgeMap: {
      nodes: [{ id: "N9", label: "斜率条件", detail: "先判断 k 的符号。", sourceRefs: ["S1-2"] }]
    },
    keyPoints: [{
      id: "K9",
      title: "先看斜率",
      explanation: "根据 k 的取值判断函数是否成立以及图像方向。",
      principle: "k 的符号决定一次函数的增减方向。",
      useWhen: "题干给出 k 的取值或图像变化。",
      boundary: "k 等于零时要停止套用一次函数性质。",
      sourceRefs: ["S1-2"],
      retrievalQuestion: "k 小于零时图像怎样变化？"
    }],
    workedExamples: [{
      id: "E9",
      title: "保留的示范标题",
      questionType: "符号判断",
      trigger: "给出 k 的取值。",
      given: "k 的符号。",
      target: "判断图像变化。",
      problem: "当 k 小于零时，判断图像变化方向并说明依据。",
      decisionRule: "先检查 k 是否为零，再判断正负。",
      strategy: "把 k 的取值与定义和增减性质逐条对应。",
      sourceRefs: ["S1-2"],
      steps: [{ label: "检查定义", explanation: "先确认 k 不等于零。", rationale: "避免把常函数当作一次函数。", checkpoint: "k 是否为零。" }, { label: "判断方向", explanation: "k 为负时图像下降。", rationale: "斜率符号决定变化方向。", checkpoint: "结论是否对应 k 的符号。" }],
      boundaryCheck: "k 等于零时结论失效。",
      answer: "先确认 k 不等于零，再由负号判断图像下降。",
      scoringPoints: ["确认定义", "说明斜率方向"],
      commonWrongPath: "忽略 k 是否为零。",
      selfCheck: "结论有没有保留 k 不等于零的前提。",
      variation: "把 k 改为正数后重做。"
    }],
    learningRoute: [{
      id: "R9",
      goalId: "G404",
      knowledgeNodeIds: ["N404"],
      keyPointIds: ["K404"],
      exampleIds: ["E404"],
      practiceIds: ["P404"],
      masteryCheckIds: ["M404"],
      focus: "保留这个关键判断",
      action: "保留这个独立动作并完成练习。",
      proof: "保留这个掌握证据。",
      sourceRefs: ["S404"]
    }]
  }, defaults);
  const knownSourceIds = new Set(material.sourceAtoms.map((item) => item.id));

  assert.equal(material.learningGoals.length, 3);
  assert.equal(material.learningRoute.length, 3);
  assert.equal(new Set(material.learningGoals.map((item) => item.id)).size, 3);
  assert.ok(material.workedExamples.some((item) => item.title === "保留的示范标题"));
  assert.ok(material.learningRoute.every((route) => route.knowledgeNodeIds.length && route.keyPointIds.length && route.exampleIds.length && route.practiceIds.length && route.masteryCheckIds.length));
  assert.ok(material.learningRoute.every((route) => route.sourceRefs.every((reference) => knownSourceIds.has(reference))));
  assert.ok(material.learningRoute.every((route) => !route.knowledgeNodeIds.includes("N404") && !route.keyPointIds.includes("K404") && !route.exampleIds.includes("E404")));
  assert.equal(material.learningGraph.status, "完整闭环");
  assert.equal(material.sourceCoverage.status, "完整覆盖");
});

test("英语时态系统覆盖 16 种时态并提供两张 SVG 图解描述", () => {
  const defaults = createMaterialTemplate({
    sources: [{
      name: "手动输入的知识点.txt",
      text: "请完整讲解以下语法系统。"
    }],
    options: { subject: "英语", grade: "初中" }
  });
  const material = normalizeMaterial({
    meta: { title: "英语时态系统", subject: "英语" },
    knowledgeMap: {
      center: "英语时态系统",
      nodes: [
        { label: "一般现在时", detail: "表示习惯或事实。" },
        { label: "一般过去时", detail: "表示过去发生。" },
        { label: "一般将来时", detail: "表示将来发生。" },
        { label: "现在完成时", detail: "表示过去影响现在。" }
      ]
    }
  }, defaults);

  assert.equal(material.knowledgeMap.nodes.length, 16);
  assert.ok(material.knowledgeMap.nodes.some((item) => item.label === "一般现在时"));
  assert.ok(material.knowledgeMap.nodes.some((item) => item.label === "过去将来完成进行时"));
  assert.equal(material.knowledgeDiagrams.length, 2);
  assert.equal(material.knowledgeDiagrams[0].figureType, "table");
  assert.equal(material.knowledgeDiagrams[1].figureType, "diagram");
  assert.ok(material.teachingFigures.some((item) => item.placement.section === "knowledgeDiagrams" && item.placement.refId === "D1"));
  assert.ok(material.teachingFigures.some((item) => item.placement.section === "knowledgeDiagrams" && item.placement.refId === "D2"));
  assert.ok(material.teachingFigures.every((item) => item.renderStatus === "pending"));
  assert.ok(material.teachingFigures.every((item) => item.svg === ""));
});

test("归一化删除补充讲解字样并移除旧 ASCII 图字段", () => {
  const defaults = createMaterialTemplate({
    sources: [{ name: "函数.txt", text: "函数关系可以用结构图表示。" }],
    options: { subject: "数学" }
  });
  const material = normalizeMaterial({
    meta: { summary: "【补充讲解】先看结构。" },
    knowledgeDiagrams: [{
      title: "【补充讲解】函数结构",
      purpose: "补充讲解：看清输入和输出。",
      ascii: "[输入]    ->    [规则]\n                  |\n                [输出]",
      explanation: "补充讲解：沿箭头阅读。",
      readingGuide: ["【补充讲解】先看输入", "再看输出"]
    }]
  }, defaults);

  assert.doesNotMatch(JSON.stringify(material), /补充讲解/u);
  assert.equal(Object.hasOwn(material.knowledgeDiagrams[0], "ascii"), false);
  assert.equal(material.knowledgeDiagrams[0].figureType, "diagram");
});

test("开放型知识体系保留完整分类、常用成员和 32 项节点上限", () => {
  const defaults = createMaterialTemplate({
    sources: [{ name: "英语介词.txt", text: "英语介词需要按功能分类学习。" }],
    options: { subject: "英语", grade: "初中" }
  });
  const categories = Array.from({ length: 40 }, (_, index) => ({
    id: `N${index + 1}`,
    label: `介词分类 ${index + 1}`,
    detail: `第 ${index + 1} 类介词的共同用法、判断线索和不能直接套用的情况。`,
    members: Array.from({ length: 12 }, (__, memberIndex) => `prep-${index + 1}-${memberIndex + 1}`)
  }));
  const material = normalizeMaterial({
    meta: { title: "初中英语：介词完整分类", subject: "英语" },
    knowledgeMap: {
      center: "英语介词",
      scopeType: "open",
      scope: "覆盖初中阶段常用英语介词的全部主流功能分类。",
      coverageSummary: "覆盖全部主流分类和各类常用成员；冷僻古旧用法不逐条展开。",
      coverageDimensions: ["定义与边界", "完整分类", "常用成员", "搭配规则", "特殊情况", "易混与应用"],
      nodes: categories
    }
  }, defaults);

  assert.equal(material.knowledgeMap.scopeType, "open");
  assert.equal(material.knowledgeMap.nodes.length, 32);
  assert.equal(material.knowledgeMap.nodes.at(-1).label, "介词分类 32");
  assert.equal(material.knowledgeMap.nodes[0].members.length, 12);
  assert.match(material.knowledgeMap.coverageSummary, /32 个主流分类/u);
});
