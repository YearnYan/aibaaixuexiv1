const EXAM_SUBMISSION_TOOL_NAME = 'submit_exam';

const STRUCTURED_CONTENT_SCHEMA = {
  type: 'string',
  minLength: 1,
  description: '普通文字与标准 LaTeX 的完整用户可见字符串。行内公式只能用 \\(...\\)，独立公式只能用 \\[...\\]；工具参数保持合法 JSON。禁止私有传输词、[[LATEX]]、美元公式、Unicode 伪公式、\\eq、嵌套或双重转义定界符和 Markdown。'
};

const FIGURE_SCHEMA = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'description'],
      properties: {
        type: { type: 'string', minLength: 1 },
        description: {
          type: 'string',
          minLength: 12,
          description: '内部绘图指令。允许 ASCII 关系如 A(0,4)、y=x^2；禁止 LaTeX、LATEXSLASH、公式定界符和 Markdown。'
        }
      }
    }
  ]
};

const OPTIONS_SCHEMA = {
  anyOf: [
    { type: 'null' },
    {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: STRUCTURED_CONTENT_SCHEMA
    }
  ]
};

const EXAM_SUBMISSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stem', 'options', 'answer', 'explanation', 'figure'],
        properties: {
          stem: STRUCTURED_CONTENT_SCHEMA,
          options: OPTIONS_SCHEMA,
          answer: STRUCTURED_CONTENT_SCHEMA,
          explanation: STRUCTURED_CONTENT_SCHEMA,
          figure: FIGURE_SCHEMA
        }
      }
    }
  }
};

const EXAM_SUBMISSION_CONTRACT = buildExamSubmissionContract();

function buildExamSubmissionContract({ expectedQuestionType = '', expectedQuestionCount = null } = {}) {
  const supportedTypes = ['choice', 'fill', 'calculation'];
  if (expectedQuestionType && !supportedTypes.includes(expectedQuestionType)) {
    throw new TypeError('expectedQuestionType 必须是 choice、fill 或 calculation');
  }
  if (expectedQuestionCount !== null
    && (!Number.isInteger(expectedQuestionCount) || expectedQuestionCount < 1 || expectedQuestionCount > 30)) {
    throw new TypeError('expectedQuestionCount 必须是 1-30 的整数');
  }

  const schema = cloneSchema(EXAM_SUBMISSION_SCHEMA);
  const itemsSchema = schema.properties.items;
  if (expectedQuestionCount !== null) {
    itemsSchema.minItems = expectedQuestionCount;
    itemsSchema.maxItems = expectedQuestionCount;
  }
  if (expectedQuestionType === 'choice') {
    itemsSchema.items.properties.options = {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: cloneSchema(STRUCTURED_CONTENT_SCHEMA),
      description: '选择题必须恰好四个选项，每个选项都是一条完整的用户可见字符串。'
    };
  } else if (expectedQuestionType) {
    itemsSchema.items.properties.options = {
      type: 'null',
      description: '非选择题 options 必须为 null。'
    };
  }

  const scope = [
    expectedQuestionType ? `题型固定为 ${expectedQuestionType}` : '',
    expectedQuestionCount !== null ? `题量固定为 ${expectedQuestionCount}` : ''
  ].filter(Boolean).join('，');
  return {
    name: EXAM_SUBMISSION_TOOL_NAME,
    description: `提交经过独立复核、可直接进入严格质量门的完整试题 JSON${scope ? `；${scope}` : ''}。`,
    schema
  };
}

function cloneSchema(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildStructuredOutputRequest(contract = EXAM_SUBMISSION_CONTRACT) {
  validateContract(contract);
  return {
    tools: [{
      type: 'function',
      function: {
        name: contract.name,
        description: contract.description,
        strict: true,
        parameters: contract.schema
      }
    }],
    tool_choice: {
      type: 'function',
      function: { name: contract.name }
    }
  };
}

function extractStructuredToolArguments(message, contract = EXAM_SUBMISSION_CONTRACT) {
  validateContract(contract);
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw createStructuredOutputError('INVALID_AI_MESSAGE', 'AI 响应缺少有效 message 对象');
  }

  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (calls.length !== 1) {
    throw createStructuredOutputError(
      'INVALID_TOOL_CALL_COUNT',
      `AI 必须且只能调用一次 ${contract.name}，实际为 ${calls.length} 次`
    );
  }

  const call = calls[0];
  if (call?.type !== 'function' || call?.function?.name !== contract.name) {
    throw createStructuredOutputError(
      'UNEXPECTED_TOOL_CALL',
      `AI 调用了未授权工具，必须使用 ${contract.name}`
    );
  }

  const rawArguments = call.function.arguments;
  if (typeof rawArguments !== 'string' || !rawArguments.trim()) {
    throw createStructuredOutputError('EMPTY_TOOL_ARGUMENTS', `${contract.name} 缺少 JSON 参数`);
  }

  const source = rawArguments.trim();
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    const error = createStructuredOutputError(
      'INVALID_TOOL_ARGUMENTS_JSON',
      `${contract.name} 参数无法直接 JSON.parse：${cause.message}`
    );
    error.cause = cause;
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createStructuredOutputError('INVALID_TOOL_ARGUMENTS_ROOT', `${contract.name} 参数根节点必须是对象`);
  }
  return source;
}

function validateContract(contract) {
  if (!contract || typeof contract !== 'object'
    || typeof contract.name !== 'string' || !contract.name
    || typeof contract.description !== 'string' || !contract.description
    || !contract.schema || typeof contract.schema !== 'object') {
    throw new TypeError('structuredOutput 契约必须包含 name、description 和 schema');
  }
}

function createStructuredOutputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  EXAM_SUBMISSION_CONTRACT,
  EXAM_SUBMISSION_SCHEMA,
  EXAM_SUBMISSION_TOOL_NAME,
  buildExamSubmissionContract,
  buildStructuredOutputRequest,
  extractStructuredToolArguments
};
