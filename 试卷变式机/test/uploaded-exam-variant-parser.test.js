const assert = require('node:assert/strict');
const test = require('node:test');

process.env.AI_API_KEY ||= 'unit-test-key';

const { _internals } = require('../server/services/uploaded-exam-variant');

test('解析 Markdown 包裹且前后带说明的完整试卷 JSON', () => {
  const content = `说明文字\n\`\`\`json\n{
    "title": "测试卷",
    "questions": [{"type":"choice","items":[{"stem":"题干含 {集合}","answer":"A"}]}]
  }\n\`\`\`\n后续说明`;
  const result = _internals.parseAIJson(content);
  assert.equal(result.title, '测试卷');
  assert.equal(result.questions[0].items[0].stem, '题干含 {集合}');
});

test('保守修复字符串换行、尾逗号和 LaTeX 非标准反斜杠', () => {
  const content = `{
    "title": "公式卷",
    "questions": [{
      "type": "fill",
      "items": [{
        "stem": "计算 \\(x^2\\) 的值
并写出 \\ce{H2O}",
        "answer": "1",
      }],
    }],
  }`;
  const result = _internals.parseAIJson(content);
  assert.equal(result.questions[0].items[0].stem, '计算 \\(x^2\\) 的值\n并写出 \\ce{H2O}');
  assert.equal(result.questions[0].items[0].answer, '1');
});

test('截断的 JSON 必须拒绝，不能伪造缺失试题', () => {
  assert.throws(
    () => _internals.parseAIJson('{"title":"未完成","questions":['),
    /未完整结束/u,
  );
});
