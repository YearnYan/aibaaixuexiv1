const assert = require('node:assert/strict');
const AcademicMath = require('../academic-math.js');
const AcademicRepair = require('../academic-repair.js');

const slides = [
    {
        id: 10,
        type: '选择题',
        subject: '数学',
        question: '已知 \\(x=1\\)，求目标式的值。',
        options: [
            { letter: 'A', text: '\\frac', correct: true },
            { letter: 'B', text: '\\(1\\)', correct: false }
        ],
        answer: '\\frac',
        analysis: '代入后结果为 \\(\\frac{1}{2}\\)。',
        knowledge: ['分式运算'],
        figure: { exists: false, description: '', sourcePageId: 'P1', sourcePage: 1 }
    }
];

const violations = AcademicRepair.collectViolations(slides, AcademicMath);
assert.deepEqual(
    violations.map((item) => item.fieldPath),
    ['answer', 'options.0.text']
);

const prompt = AcademicRepair.buildRepairPrompt({
    slides,
    violations,
    attempt: 1,
    maxAttempts: 4
});
assert.ok(prompt.includes('"fieldPath": "answer"'));
assert.ok(prompt.includes('"fieldPath": "options.0.text"'));
assert.ok(prompt.includes('只重写 invalidFields'));
assert.ok(prompt.includes('禁止增加任何未请求字段'));

const response = {
    repairs: [
        {
            slideIndex: 0,
            slideId: 10,
            fields: {
                answer: '\\(\\frac{1}{2}\\)',
                'options.0.text': '\\(\\frac{1}{2}\\)'
            }
        }
    ]
};
const repaired = AcademicRepair.applyRepairResponse(
    slides,
    violations,
    response,
    AcademicMath.normalizeText
);

assert.equal(repaired[0].answer, '\\(\\frac{1}{2}\\)');
assert.equal(repaired[0].options[0].text, '\\(\\frac{1}{2}\\)');
assert.equal(repaired[0].question, slides[0].question);
assert.equal(repaired[0].analysis, slides[0].analysis);
assert.equal(repaired[0].options[0].correct, true);
assert.equal(slides[0].answer, '\\frac', '字段补丁不得原地修改原始题目');
assert.deepEqual(AcademicRepair.collectViolations(repaired, AcademicMath), []);

assert.throws(
    () => AcademicRepair.applyRepairResponse(
        slides,
        violations,
        { repairs: [{ slideIndex: 0, slideId: 10, fields: { answer: '\\(1\\)' } }] }
    ),
    (error) => error.code === 'ACADEMIC_REPAIR_RESPONSE_INVALID' && /漏掉/.test(error.message)
);

assert.throws(
    () => AcademicRepair.applyRepairResponse(
        slides,
        violations,
        {
            repairs: [{
                slideIndex: 0,
                slideId: 10,
                fields: {
                    answer: '\\(1\\)',
                    'options.0.text': '\\(1\\)',
                    analysis: '越权内容'
                }
            }]
        }
    ),
    (error) => error.code === 'ACADEMIC_REPAIR_RESPONSE_INVALID' && /越权/.test(error.message)
);

assert.throws(
    () => AcademicRepair.applyRepairResponse(
        slides,
        violations,
        {
            repairs: [{
                slideIndex: 0,
                slideId: 11,
                fields: { answer: '\\(1\\)', 'options.0.text': '\\(1\\)' }
            }]
        }
    ),
    (error) => error.code === 'ACADEMIC_REPAIR_RESPONSE_INVALID' && /题号/.test(error.message)
);

const stillInvalid = AcademicRepair.applyRepairResponse(
    slides,
    violations,
    {
        repairs: [{
            slideIndex: 0,
            slideId: 10,
            fields: { answer: '\\(\\frac\\)', 'options.0.text': '\\(\\frac\\)' }
        }]
    }
);
assert.equal(AcademicRepair.collectViolations(stillInvalid, AcademicMath).length, 2);

const parsedCodeBlock = AcademicRepair.parseRepairResponse('```json\n{"repairs": []}\n```');
assert.deepEqual(parsedCodeBlock, { repairs: [] });

console.log('公式字段修复测试通过：字段定位、受限合并、漏项、越权、错题号与复检断言。');
