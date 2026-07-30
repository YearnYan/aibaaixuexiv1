import { z } from 'zod';

export const CONTENT_SCHEMA_VERSION = 3;

const boundedText = (min, max) => z.string().trim().min(min).max(max);

export const configInputSchema = z.object({
  providerName: boundedText(1, 40),
  baseUrl: boundedText(8, 500).refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, '接口地址必须是有效的 HTTP 或 HTTPS URL'),
  apiKey: z.string().trim().max(1000).optional().default(''),
  model: boundedText(1, 100),
  temperature: z.coerce.number().min(0).max(1),
  timeoutMs: z.coerce.number().int().min(5000).max(120000),
});

const stepSchema = z.object({
  title: boundedText(2, 30),
  description: boundedText(5, 160),
  task: boundedText(5, 500),
  guidance: boundedText(10, 3000),
  hints: z.array(boundedText(2, 500)).length(3),
});

export const solutionPlanSchema = z.object({
  problemSummary: boundedText(10, 800),
  knowledgePoints: z.array(boundedText(1, 80)).min(1).max(8),
  steps: z.array(stepSchema).length(4),
  finalAnswer: boundedText(20, 6000),
});

export const analysisFormSchema = z.object({
  subject: boundedText(1, 30),
  grade: boundedText(1, 30),
});
