const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXAM_SUBMISSION_CONTRACT,
  buildExamSubmissionContract,
  buildStructuredOutputRequest,
  extractStructuredToolArguments
} = require('../shared/ai-structured-output');

function toolMessage(argumentsValue = '{"items":[]}') {
  return {
    content: '这段普通 content 必须被忽略',
    tool_calls: [{
      type: 'function',
      function: {
        name: EXAM_SUBMISSION_CONTRACT.name,
        arguments: argumentsValue
      }
    }]
  };
}

test('构建请求时强制唯一 submit_exam 工具', () => {
  const request = buildStructuredOutputRequest();
  assert.equal(request.tools.length, 1);
  assert.equal(request.tools[0].function.name, 'submit_exam');
  assert.equal(request.tools[0].function.strict, true);
  assert.equal(request.tool_choice.function.name, 'submit_exam');
  assert.equal(request.tools[0].function.parameters.additionalProperties, false);
});

test('按当前题型与批次题量动态收窄工具 schema', () => {
  const choice = buildExamSubmissionContract({ expectedQuestionType: 'choice', expectedQuestionCount: 2 });
  const choiceItems = choice.schema.properties.items;
  assert.deepEqual(Object.keys(choice.schema.properties), ['items']);
  assert.equal(choiceItems.minItems, 2);
  assert.equal(choiceItems.maxItems, 2);
  assert.equal(choiceItems.items.properties.options.type, 'array');
  assert.equal(choiceItems.items.properties.options.minItems, 4);
  assert.equal(choiceItems.items.properties.type, undefined);
  assert.equal(choiceItems.items.properties.index, undefined);

  const calculation = buildExamSubmissionContract({ expectedQuestionType: 'calculation', expectedQuestionCount: 1 });
  assert.equal(calculation.schema.properties.items.items.properties.options.type, 'null');
  assert.equal(EXAM_SUBMISSION_CONTRACT.schema.properties.items.items.properties.options.anyOf.length, 2);
});

test('只从指定工具参数读取严格 JSON，不读取普通 content', () => {
  const source = extractStructuredToolArguments(toolMessage());
  assert.deepEqual(JSON.parse(source), { items: [] });
});

test('拒绝 content-only、错误工具、多工具和坏参数，不做提取或修复', () => {
  assert.throws(
    () => extractStructuredToolArguments({ content: '{"title":"不能读取"}' }),
    (error) => error.code === 'INVALID_TOOL_CALL_COUNT'
  );
  assert.throws(
    () => extractStructuredToolArguments({
      tool_calls: [{ type: 'function', function: { name: 'other_tool', arguments: '{}' } }]
    }),
    (error) => error.code === 'UNEXPECTED_TOOL_CALL'
  );
  assert.throws(
    () => extractStructuredToolArguments({ tool_calls: [toolMessage().tool_calls[0], toolMessage().tool_calls[0]] }),
    (error) => error.code === 'INVALID_TOOL_CALL_COUNT'
  );
  assert.throws(
    () => extractStructuredToolArguments(toolMessage('```json\n{}\n```')),
    (error) => error.code === 'INVALID_TOOL_ARGUMENTS_JSON'
  );
  assert.throws(
    () => extractStructuredToolArguments(toolMessage('[]')),
    (error) => error.code === 'INVALID_TOOL_ARGUMENTS_ROOT'
  );
});
