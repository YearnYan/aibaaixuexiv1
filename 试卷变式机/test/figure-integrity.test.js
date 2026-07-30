const assert = require('node:assert/strict');
const test = require('node:test');
const {
  referencesVisualMaterial,
  isPreciseFigureDescription,
  findFigureIntegrityIssues,
  repairExamFigureIntegrity,
} = require('../shared/figure-integrity');

function makeExam(items) {
  return {
    analysisSummary: { subject: '综合', gradeLevel: 'K12' },
    questions: [{ type: 'choice', title: '一、选择题', items }],
  };
}

test('识别全学科常见的中英文视觉材料引用', () => {
  const stems = [
    '如图所示，求三角形ABC的面积。',
    '根据右侧电路图，判断开关闭合后的电流方向。',
    '观察下列实验装置，选择正确的制气方法。',
    '据图中的细胞结构示意图，判断结构①的功能。',
    '读某区域等高线地形图，判断河流流向。',
    '结合图1所示历史地图，判断该时期。',
    '阅读下面漫画，概括其寓意。',
    'Look at the following chart and choose the correct answer.',
  ];
  for (const stem of stems) assert.equal(referencesVisualMaterial({ stem }), true, stem);
});

test('不把普通的图像概念表述误判为缺图题', () => {
  assert.equal(referencesVisualMaterial({ stem: '说明一次函数图像的基本性质。' }), false);
  assert.equal(referencesVisualMaterial({ stem: '什么是地形图？请解释概念。' }), false);
});

test('拒绝占位描述并接受可独立还原的跨学科描述', () => {
  assert.equal(isPreciseFigureDescription('根据题干生成一张合适的示意图即可'), false);
  assert.equal(isPreciseFigureDescription('参照原图，保持与题意一致'), false);
  assert.equal(
    isPreciseFigureDescription('平面直角坐标系中标出A(1,2)、B(5,2)，连接AB，并从B点向上作垂线至C(5,6)。'),
    true,
  );
  assert.equal(
    isPreciseFigureDescription('中国东部区域地图，标出甲乙两城市、北向箭头、沿海边界和由甲指向乙的迁移箭头。'),
    true,
  );
});

test('首轮补全精准题图时只修复问题题目并保持题量顺序', async () => {
  const exam = makeExam([
    { index: 1, stem: '如图，求AB长度。', options: ['A. 3', 'B. 4'], answer: 'B', explanation: '原解析' },
    { index: 2, stem: '计算2+3。', options: ['A. 4', 'B. 5'], answer: 'B', explanation: '2+3=5' },
  ]);
  const untouched = JSON.stringify(exam.questions[0].items[1]);
  const calls = [];

  const result = await repairExamFigureIntegrity(exam, {
    requestRepair: async (request) => {
      calls.push(request);
      return {
        repairs: [{
          index: 1,
          stem: '如图，直角三角形ABC中，AC=3，BC=4，求AB。',
          options: ['A. 4', 'B. 5'],
          answer: 'B',
          explanation: '由勾股定理得AB=5。',
          figure: {
            type: 'geometry',
            description: '直角三角形ABC，直角位于C点，AC为水平边并标注3，BC为竖直边并标注4，连接A与B形成斜边AB。',
          },
        }],
      };
    },
  });

  assert.deepEqual(result.repairedIndexes, [1]);
  assert.equal(calls.length, 1);
  assert.equal(exam.questions[0].items.length, 2);
  assert.equal(exam.questions[0].items[0].figure.type, 'geometry');
  assert.equal(JSON.stringify(exam.questions[0].items[1]), untouched);
  assert.deepEqual(findFigureIntegrityIssues(exam), []);
});

test('首轮仍缺图时第二轮强制改写为自包含题', async () => {
  const exam = makeExam([
    { index: 1, stem: '阅读下面漫画，选择最符合寓意的一项。', options: ['A. 合作', 'B. 冲突'], answer: 'A', explanation: '原解析' },
  ]);
  let calls = 0;

  const result = await repairExamFigureIntegrity(exam, {
    requestRepair: async ({ forceTextOnly }) => {
      calls += 1;
      if (!forceTextOnly) {
        return { repairs: [{ index: 1, stem: '阅读下图漫画并作答。', options: ['A. 合作', 'B. 冲突'], answer: 'A', explanation: '仍不完整', figure: null }] };
      }
      return {
        repairs: [{
          index: 1,
          stem: '两名同学分工收集资料并共同完成报告，这一情境体现的核心品质是？',
          options: ['A. 合作', 'B. 冲突'],
          answer: 'A',
          explanation: '分工并共同完成目标体现合作。',
          figure: null,
        }],
      };
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.repairedIndexes, [1]);
  assert.equal(exam.questions[0].items[0].figure, undefined);
  assert.equal(referencesVisualMaterial(exam.questions[0].items[0]), false);
});

test('两轮修复后仍依赖缺失视觉材料时明确拒绝', async () => {
  const exam = makeExam([
    { index: 1, stem: '根据下图作答。', options: ['A. 甲', 'B. 乙'], answer: 'A', explanation: '原解析' },
  ]);
  await assert.rejects(
    repairExamFigureIntegrity(exam, {
      requestRepair: async () => ({
        repairs: [{ index: 1, stem: '根据下图作答。', options: ['A. 甲', 'B. 乙'], answer: 'A', explanation: '仍缺图', figure: null }],
      }),
    }),
    /视觉材料未能补全/u,
  );
});
