const assert = require('node:assert/strict');
const { parseResponse } = require('../ai-json.js');

const proseWrapped = parseResponse('识别完成，结果如下：\n```json\n{"questions":[{"title":"第1题"}]}\n```\n请查收。');
assert.equal(proseWrapped.questions[0].title, '第1题');

const openAiWrapped = parseResponse({
    choices: [{ message: { content: JSON.stringify({ slides: [{ title: '第2题' }] }) } }]
});
assert.equal(openAiWrapped.slides[0].title, '第2题');

const doubleEncoded = parseResponse(JSON.stringify(JSON.stringify({ questions: [{ title: '第3题' }] })));
assert.equal(doubleEncoded.questions[0].title, '第3题');

const latex = parseResponse(String.raw`{"questions":[{"stem":"计算 \\frac{1}{2} 与 \\sqrt{x}"}],}`);
assert.equal(latex.questions[0].stem, String.raw`计算 \frac{1}{2} 与 \sqrt{x}`);

assert.throws(() => parseResponse('这里没有结构化结果'), /JSON/u);

console.log('PPT AI JSON 响应解析测试通过');
