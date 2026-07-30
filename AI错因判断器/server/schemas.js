const { z } = require('zod');

const PROVIDERS = ['openai', 'deepseek', 'qwen', 'kimi', 'ollama', 'custom'];
const ERROR_TYPES = [
  '知识理解或记忆错误',
  '题意读取错误',
  '方法选择错误',
  '解题步骤错误',
  '运算判断或执行错误',
  '答案表达错误',
  '检查动作缺失',
  '信息不足，无法确定',
];
const STEP_STATUSES = ['正确', '首次出错', '受影响', '未判断'];

const configInputSchema = z.object({
  provider: z.enum(PROVIDERS),
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean().optional(),
  model: z.string().trim().min(1).max(100),
  temperature: z.coerce.number().min(0).max(1),
  timeoutMs: z.coerce.number().int().min(10000).max(180000),
});

const analyzeFieldsSchema = z.object({
  subject: z.string().trim().min(1, '请选择学科').max(30),
  studentAnswer: z.string().trim().max(12000).default(''),
  correctAnswer: z.string().trim().max(12000).default(''),
  standardProcess: z.string().trim().max(12000).default(''),
  scoringCriteria: z.string().trim().max(8000).default(''),
  selfAssessment: z.string().trim().max(100).default(''),
});

const timelineItemSchema = z.object({
  stepNumber: z.coerce.number().int().min(1).max(4),
  stepName: z.string().trim().min(1).max(30),
  status: z.enum(STEP_STATUSES),
  detail: z.string().trim().min(1).max(600),
});

const reportSchema = z.object({
  firstError: z.object({
    stepNumber: z.coerce.number().int().min(0).max(4),
    stepName: z.string().trim().min(1).max(30),
    description: z.string().trim().min(1).max(800),
    impact: z.string().trim().min(1).max(800),
  }),
  evidence: z.string().trim().min(1).max(1200),
  errorType: z.enum(ERROR_TYPES),
  errorTypeReason: z.string().trim().min(1).max(800),
  timeline: z.array(timelineItemSchema).length(4),
  comparison: z.object({
    studentJudgment: z.string().trim().min(1).max(100),
    aiJudgment: z.string().trim().min(1).max(100),
    conclusion: z.string().trim().min(1).max(300),
  }),
  correction: z.object({
    action: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(500),
    checklist: z.array(z.string().trim().min(1).max(200)).min(2).max(5),
  }),
  needsTeacherReview: z.boolean(),
  reviewReason: z.string().trim().max(500),
  confidence: z.coerce.number().min(0).max(1),
}).superRefine((report, context) => {
  const stepNumbers = report.timeline.map((item) => item.stepNumber);
  if (new Set(stepNumbers).size !== 4 || stepNumbers.some((step, index) => step !== index + 1)) {
    context.addIssue({
      code: 'custom',
      path: ['timeline'],
      message: '时间线必须按 1 至 4 连续排列',
    });
  }

  const firstErrors = report.timeline.filter((item) => item.status === '首次出错');
  if (report.errorType === '信息不足，无法确定') {
    if (report.firstError.stepNumber !== 0 || firstErrors.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['firstError', 'stepNumber'],
        message: '信息不足时首错步骤必须为 0，且时间线不得标记首次出错',
      });
    }
  } else if (firstErrors.length !== 1 || firstErrors[0].stepNumber !== report.firstError.stepNumber) {
    context.addIssue({
      code: 'custom',
      path: ['firstError', 'stepNumber'],
      message: '首错步骤必须与时间线中唯一的首次出错步骤一致',
    });
  }

  if (report.needsTeacherReview && !report.reviewReason) {
    context.addIssue({
      code: 'custom',
      path: ['reviewReason'],
      message: '需要教师复核时必须说明原因',
    });
  }
});

const exportReportSchema = z.intersection(
  reportSchema,
  z.object({ generatedAt: z.string().datetime() }),
);

const exportRequestSchema = z.object({
  subject: z.string().trim().min(1).max(30),
  sourceFilename: z.string().trim().max(255).default(''),
  report: exportReportSchema,
});

module.exports = {
  ERROR_TYPES,
  PROVIDERS,
  STEP_STATUSES,
  analyzeFieldsSchema,
  configInputSchema,
  exportRequestSchema,
  reportSchema,
};
