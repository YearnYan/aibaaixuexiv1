import { z } from "zod";

export const configInputSchema = z.object({
  baseUrl: z.string().trim().url("请输入有效的接口地址"),
  apiKey: z.string().trim().max(500, "密钥长度异常"),
  model: z.string().trim().min(1, "请填写模型名称").max(120),
  temperature: z.coerce.number().min(0).max(1.5),
  maxTokens: z.coerce.number().int().min(400).max(8000),
  customInstructions: z.string().trim().max(1000).default(""),
});

export type ConfigInput = z.infer<typeof configInputSchema>;
export type AiConfig = ConfigInput;

export const analyzeInputSchema = z.object({
  subject: z.string().trim().min(1, "请选择学科").max(30),
  grade: z.string().trim().min(1, "请选择年级").max(30),
  notes: z.string().trim().max(200, "补充说明不能超过 200 字").default(""),
});

const confidenceSchema = z.preprocess((value) => {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric === "number" && numeric > 1 && numeric <= 100) {
    return numeric / 100;
  }
  return numeric;
}, z.number().min(0).max(1));

const shortText = z.string().trim().min(1).max(500);

export const analysisSchema = z.object({
  questionText: z.string().trim().min(1).max(20000),
  problemType: z.string().trim().min(1).max(80),
  confidence: confidenceSchema,
  potentialOmissions: z.array(shortText).max(8).default([]),
  taskWords: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(12),
        text: shortText,
      }),
    )
    .min(1)
    .max(12),
  restrictions: z.array(shortText).max(16).default([]),
  keyData: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(120),
      }),
    )
    .max(16)
    .default([]),
  hiddenConditions: z.array(shortText).max(16).default([]),
  distractions: z.array(shortText).max(16).default([]),
  answerScope: shortText,
  paraphrase: z.string().trim().min(1).max(1000),
  highlights: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(120),
        category: z.enum(["task", "restriction", "data", "hidden", "scope"]),
      }),
    )
    .max(30)
    .default([]),
});

export type Analysis = z.infer<typeof analysisSchema>;

export const analysisMetaSchema = z.object({
  subject: z.string().trim().min(1).max(30),
  grade: z.string().trim().min(1).max(30),
  source: z.string().trim().min(1).max(80),
  recognizedAt: z.string().trim().min(1).max(80),
  fileNames: z.array(z.string().trim().min(1).max(260)).max(5),
});

export const reportRequestSchema = z.object({
  analysis: analysisSchema,
  meta: analysisMetaSchema,
});

export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;
export type ReportRequest = z.infer<typeof reportRequestSchema>;
