import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import {
  extractOptionLabel,
  hasVisualOptionPlaceholderSet,
  normalizeOptionLabel,
  restoreVisualOptionLabels,
} from "../shared/optionText.js";
import { containsMarkdownTableBlock, stripMarkdownTableBlocks } from "../shared/tableText.js";
import { normalizeQuestionMathFields } from "../shared/mathText.js";
import { normalizeEducationalUnicode } from "../shared/formulaText.js";
import type { AiSettingsInput } from "./aiSettings.js";

// 8 页一批控制上游调用成本；生产复检已从关键路径移除，主识别不会再被串行增强步骤卡住。
const RECOGNITION_BATCH_PAGE_COUNT = 8;
// 单次上游请求和完整批次都有明确边界；多页超时自动拆批，最终失败则由业务层退款并允许重试。
const DEFAULT_UPSTREAM_TIMEOUT_MS = 180_000;
const DEFAULT_RECOGNITION_OPERATION_TIMEOUT_MS = 600_000;
const DEFAULT_RECOGNITION_MAX_TOKENS = 8_192;
const MAX_RECOGNITION_MAX_TOKENS = 65_536;
const MAX_COMPLETION_CONTENT_CHARS = 1_000_000;
const MAX_UPSTREAM_ERROR_HINT_CHARS = 16_000;
const MAX_COMPLETION_EXTRACTION_DEPTH = 8;
const MAX_JSON_PARSE_DEPTH = 6;
const MAX_JSON_VALUE_DEPTH = 32;
const MAX_COMPLETION_TEXT_PARTS = 4_096;
const MAX_RECOGNIZED_QUESTIONS = 500;
const MAX_RECOGNIZED_OPTIONS = 12;
const MAX_RECOGNIZED_FIGURES = 24;
const MAX_RECOGNIZED_WARNINGS = 50;
const MAX_SINGLE_PAGE_STRUCTURE_ATTEMPTS = 3;
const MAX_RECOVERY_TARGET_STRUCTURE_ATTEMPTS = 2;
// 复检属于增强步骤，必须有独立预算，不能阻塞整卷识别。
const MAX_RECOVERY_TARGETS_PER_BATCH = 6;
const DEFAULT_RECOVERY_TARGET_TIMEOUT_MS = 20_000;
const DEFAULT_RECOVERY_BATCH_TIMEOUT_MS = 12_000;
const BBOX_EPSILON = 0.000001;
const SETTINGS_VERIFICATION_IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5aQAAAABJRU5ErkJggg==";

const ImageDataUrlSchema = z.string()
  .min(32, "图片数据为空")
  .refine(isAllowedImageDataUrl, "图片必须是 PNG、JPEG 或 WebP 格式的 data URL");

export const RecognitionPageSchema = z.object({
  pageIndex: z.number().int().safe().min(0),
  width: z.number().int().safe().min(1),
  height: z.number().int().safe().min(1),
  imageDataUrl: ImageDataUrlSchema,
}).strict();

export const RecognitionRequestSchema = z.object({
  pages: z.array(RecognitionPageSchema).min(1),
}).strict().superRefine((value, context) => {
  const uniquePageIndexes = new Set(value.pages.map((page) => page.pageIndex));
  if (uniquePageIndexes.size !== value.pages.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pages"],
      message: "页面编号不能重复",
    });
  }
});

const NormalizedCoordinateSchema = z.number().finite().min(0).max(1);
const NormalizedDimensionSchema = z.number().finite().positive().max(1);
const RecognizedFigureKindSchema = z.enum(["diagram", "table", "option-group", "option"]);
type RecognizedFigureKind = z.infer<typeof RecognizedFigureKindSchema>;
const RecognizedItemKindSchema = z.enum(["question", "content"]);

const BoundingBoxSchema = z.object({
  x: NormalizedCoordinateSchema,
  y: NormalizedCoordinateSchema,
  width: NormalizedDimensionSchema,
  height: NormalizedDimensionSchema,
}).strict().superRefine((bbox, context) => {
  if (bbox.x + bbox.width > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["width"],
      message: "归一化坐标 x + width 不能大于 1",
    });
  }
  if (bbox.y + bbox.height > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["height"],
      message: "归一化坐标 y + height 不能大于 1",
    });
  }
});

const RecognizedFigureSchema = z.object({
  pageIndex: z.number().int().safe().min(0),
  bbox: BoundingBoxSchema,
  kind: RecognizedFigureKindSchema.default("diagram"),
  optionLabel: z.string().trim().max(8).optional(),
  caption: z.string().trim().max(1_000).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
}).strip();

const RecognizedQuestionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  kind: RecognizedItemKindSchema.default("question"),
  number: z.string().trim().max(128),
  pageIndex: z.number().int().safe().min(0),
  sourcePageIndexes: z.array(z.number().int().safe().min(0)).min(1).max(RECOGNITION_BATCH_PAGE_COUNT),
  stemMarkdown: z.string().trim().max(30_000),
  options: z.array(z.string().trim().max(10_000)).max(12),
  figures: z.array(RecognizedFigureSchema).max(24),
}).strip().superRefine((question, context) => {
  if (question.kind === "question" && !question.number) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["number"],
      message: "题目必须包含题号",
    });
  }
  if (!question.stemMarkdown && !question.options.length && !question.figures.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "题目内容不能为空",
    });
  }
});

const RecognitionResultSchema = z.object({
  questions: z.array(RecognizedQuestionSchema).max(MAX_RECOGNIZED_QUESTIONS),
  processedPageIndexes: z.array(z.number().int().safe().min(0)).min(1).max(RECOGNITION_BATCH_PAGE_COUNT),
  emptyPageIndexes: z.array(z.number().int().safe().min(0)).max(RECOGNITION_BATCH_PAGE_COUNT),
  warnings: z.array(z.string().trim().max(1_000)).max(50).default([]),
}).strip();

export type RecognitionRequest = z.infer<typeof RecognitionRequestSchema>;
export type RecognitionPage = z.infer<typeof RecognitionPageSchema>;
export type RecognitionResult = z.infer<typeof RecognitionResultSchema>;

export type RecognitionSequenceCheckpoint = {
  expectedPageCount: number;
  completedBatches: Array<{
    pageIndexes: number[];
    result: RecognitionResult;
  }>;
  partialBatches?: Array<{
    pageIndexes: number[];
    result: RecognitionResult;
    completedRecoveryKinds: RecoveryKind[];
  }>;
};

type RecognitionOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: { current: number; total: number }) => void;
  checkpoint?: RecognitionSequenceCheckpoint;
};

export type RecoveryKind = "table" | "option" | "figure";

type RecoveryTarget = {
  targetId: string;
  questionIndex: number;
  pageIndex: number;
  pageIndexes: number[];
  number: string;
  stemExcerpt: string;
};

const SETTINGS_VERIFICATION_REQUEST: RecognitionRequest = {
  pages: [{
    pageIndex: 0,
    width: 1,
    height: 1,
    imageDataUrl: SETTINGS_VERIFICATION_IMAGE_DATA_URL,
  }],
};

export class AiProxyError extends Error {
  constructor(
    public readonly kind: "timeout" | "upstream" | "invalid-response" | "truncated-response",
    public readonly retryable = false,
    public readonly upstreamStatus?: number,
  ) {
    super("AI 服务请求失败");
    this.name = "AiProxyError";
  }
}

export class RecognitionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecognitionInputError";
  }
}

export async function recognizePages(
  settings: AiSettingsInput,
  request: RecognitionRequest,
  options: RecognitionOptions = {},
): Promise<RecognitionResult> {
  return recognizePageSequence(settings, request.pages, request.pages.length, options);
}

/**
 * 在一次业务请求中渐进消费任意页数，并以固定内存批次调用同一识别模型。
 * 相邻批次共享一个边界页；最终只返回已经覆盖全部输入页的完整合并结果。
 */
export async function recognizePageSequence(
  settings: AiSettingsInput,
  pages: Iterable<RecognitionPage> | AsyncIterable<RecognitionPage>,
  expectedPageCount: number,
  options: RecognitionOptions = {},
): Promise<RecognitionResult> {
  if (!Number.isSafeInteger(expectedPageCount) || expectedPageCount < 1) {
    throw new RecognitionInputError("识别页数必须是正安全整数");
  }

  const signal = options.signal ?? new AbortController().signal;
  const checkpoint = options.checkpoint ?? {
    expectedPageCount,
    completedBatches: [],
  };
  if (checkpoint.expectedPageCount !== expectedPageCount) {
    throw new RecognitionInputError("识别断点页数与本次任务不一致");
  }
  checkpoint.partialBatches ??= [];
  const completedBatches: Array<{
    result: RecognitionResult;
    pageIndexes: number[];
    deferLastPage: boolean;
  }> = [];
  const seenPageIndexes = new Set<number>();
  const receivedPageIndexes: number[] = [];
  let reportedProgress = countCheckpointCoveredPages(checkpoint);
  let batchPages: RecognitionPage[] = [];
  let pendingFullBatch: { result: RecognitionResult; pages: RecognitionPage[] } | null = null;

  const reportProgress = (current: number) => {
    reportedProgress = Math.min(expectedPageCount, Math.max(reportedProgress, current));
    options.onProgress?.({ current: reportedProgress, total: expectedPageCount });
  };

  for await (const page of pages) {
    if (signal.aborted) throw signal.reason || new AiProxyError("timeout", true);
    const parsedPage = RecognitionPageSchema.safeParse(page);
    if (!parsedPage.success || seenPageIndexes.has(parsedPage.data.pageIndex)) {
      throw new RecognitionInputError("识别页面格式不正确或页码重复");
    }

    if (pendingFullBatch && batchPages.length === 1) {
      completedBatches.push({
        result: pendingFullBatch.result,
        pageIndexes: pendingFullBatch.pages.map((page) => page.pageIndex),
        deferLastPage: true,
      });
      pendingFullBatch = null;
    }

    seenPageIndexes.add(parsedPage.data.pageIndex);
    receivedPageIndexes.push(parsedPage.data.pageIndex);
    batchPages.push(parsedPage.data);

    if (batchPages.length === RECOGNITION_BATCH_PAGE_COUNT) {
      reportProgress(Math.max(1, receivedPageIndexes.length - batchPages.length + 1));
      pendingFullBatch = {
        pages: batchPages,
        result: await recognizeOrResumePageBatch(
          settings,
          batchPages,
          signal,
          { hasLeadingOverlap: completedBatches.length > 0 },
          checkpoint,
        ),
      };
      reportProgress(receivedPageIndexes.length);
      batchPages = [batchPages.at(-1)!];
    }
  }

  if (receivedPageIndexes.length !== expectedPageCount) {
    throw new RecognitionInputError(`声明 ${expectedPageCount} 页，实际收到 ${receivedPageIndexes.length} 页`);
  }

  if (pendingFullBatch) {
    completedBatches.push({
      result: pendingFullBatch.result,
      pageIndexes: pendingFullBatch.pages.map((page) => page.pageIndex),
      deferLastPage: false,
    });
  } else if (batchPages.length) {
    reportProgress(Math.max(1, expectedPageCount - batchPages.length + 1));
    completedBatches.push({
      result: await recognizeOrResumePageBatch(
        settings,
        batchPages,
        signal,
        { hasLeadingOverlap: completedBatches.length > 0 },
        checkpoint,
      ),
      pageIndexes: batchPages.map((page) => page.pageIndex),
      deferLastPage: false,
    });
    reportProgress(expectedPageCount);
  }

  return mergeRecognitionBatches(completedBatches, receivedPageIndexes);
}

async function recognizeOrResumePageBatch(
  settings: AiSettingsInput,
  pages: RecognitionRequest["pages"],
  signal: AbortSignal,
  batchContext: BatchRecognitionContext,
  checkpoint: RecognitionSequenceCheckpoint,
) {
  const pageIndexes = pages.map((page) => page.pageIndex);
  const completed = checkpoint.completedBatches.find((batch) => (
    areSamePageIndexes(batch.pageIndexes, pageIndexes)
  ));
  if (completed) return completed.result;

  const result = await recognizePageBatch(settings, pages, signal, batchContext, undefined, checkpoint);
  // 只有当前批次已经完整解析并通过页码约束后才写入断点，失败或残缺结果绝不复用。
  checkpoint.completedBatches.push({ pageIndexes: [...pageIndexes], result });
  checkpoint.partialBatches = checkpoint.partialBatches?.filter((batch) => (
    !areSamePageIndexes(batch.pageIndexes, pageIndexes)
  ));
  return result;
}

function findPartialBatch(
  checkpoint: RecognitionSequenceCheckpoint | undefined,
  pageIndexes: readonly number[],
) {
  return checkpoint?.partialBatches?.find((batch) => (
    areSamePageIndexes(batch.pageIndexes, pageIndexes)
  ));
}

function savePartialBatch(
  checkpoint: RecognitionSequenceCheckpoint | undefined,
  pageIndexes: readonly number[],
  result: RecognitionResult,
  completedRecoveryKinds: readonly RecoveryKind[],
) {
  if (!checkpoint) return;
  checkpoint.partialBatches ??= [];
  const saved = {
    pageIndexes: [...pageIndexes],
    result,
    completedRecoveryKinds: [...new Set(completedRecoveryKinds)],
  };
  const index = checkpoint.partialBatches.findIndex((batch) => (
    areSamePageIndexes(batch.pageIndexes, pageIndexes)
  ));
  if (index < 0) checkpoint.partialBatches.push(saved);
  else checkpoint.partialBatches[index] = saved;
}

function countCheckpointCoveredPages(checkpoint: RecognitionSequenceCheckpoint) {
  return new Set(checkpoint.completedBatches.flatMap((batch) => batch.pageIndexes)).size;
}

function areSamePageIndexes(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((pageIndex, index) => pageIndex === right[index]);
}

function mergeRecognitionBatches(
  batches: Array<{
    result: RecognitionResult;
    pageIndexes: number[];
    deferLastPage: boolean;
  }>,
  receivedPageIndexes: number[],
): RecognitionResult {
  const questions: RecognitionResult["questions"] = [];
  const warnings: string[] = [];

  for (const [batchIndex, batch] of batches.entries()) {
    const firstPageIndex = batch.pageIndexes[0];
    const lastPageIndex = batch.pageIndexes.at(-1)!;

    for (const question of batch.result.questions) {
      // 非末批最后一页由下一批复看后统一认领，避免跨批边界题被截成半题。
      if (batch.deferLastPage && question.pageIndex === lastPageIndex) continue;

      if (batchIndex > 0
        && question.kind === "question"
        && question.number
        && question.pageIndex === firstPageIndex) {
        const normalizedNumber = normalizeQuestionNumber(question.number);
        const isRepeatedContinuation = questions.some((existing) => (
          existing.kind === "question"
          && Boolean(existing.number)
          && normalizeQuestionNumber(existing.number) === normalizedNumber
          && existing.sourcePageIndexes.includes(firstPageIndex)
        ));
        if (isRepeatedContinuation) continue;
      }

      questions.push({
        ...question,
        id: `q-${questions.length + 1}`,
      });
    }

    for (const warning of batch.result.warnings) {
      if (warning && !warnings.includes(warning)) warnings.push(warning);
    }
  }

  const contentPageIndexes = new Set<number>();
  for (const question of questions) {
    contentPageIndexes.add(question.pageIndex);
    for (const pageIndex of question.sourcePageIndexes) contentPageIndexes.add(pageIndex);
    for (const figure of question.figures) contentPageIndexes.add(figure.pageIndex);
  }

  return {
    questions,
    processedPageIndexes: [...receivedPageIndexes],
    emptyPageIndexes: receivedPageIndexes.filter((pageIndex) => !contentPageIndexes.has(pageIndex)),
    warnings,
  };
}

function normalizeQuestionNumber(value: string) {
  return String(value || "").replace(/[\s.、．:：()（）]/gu, "").toLowerCase();
}

type BatchRecognitionContext = {
  hasLeadingOverlap?: boolean;
  structureRecovery?: boolean;
};

type BatchRecoveryState = {
  attempt: number;
  deadlineAt: number;
};

async function recognizePageBatch(
  settings: AiSettingsInput,
  pages: RecognitionRequest["pages"],
  signal: AbortSignal,
  batchContext: BatchRecognitionContext = {},
  recoveryState: BatchRecoveryState = {
    attempt: 0,
    deadlineAt: Date.now() + getRecognitionOperationTimeoutMs(),
  },
  checkpoint?: RecognitionSequenceCheckpoint,
): Promise<RecognitionResult> {
  try {
    return await recognizePageBatchAttempt(
      settings,
      pages,
      signal,
      { ...batchContext, structureRecovery: recoveryState.attempt > 0 },
      recoveryState.deadlineAt,
      checkpoint,
    );
  } catch (error) {
    if (isRecognitionTimeout(error) && !signal.aborted) {
      const pageIndexes = pages.map((page) => page.pageIndex);
      if (pages.length === 1 || Date.now() >= recoveryState.deadlineAt) {
        console.warn(JSON.stringify({
          event: "word_recognition_timeout_failed",
          pageIndexes,
          reason: pages.length === 1 ? "single_page_timeout" : "operation_deadline_exhausted",
        }));
        throw error;
      }

      const split = splitRecognitionPages(pages);
      console.warn(JSON.stringify({
        event: "word_recognition_timeout_split",
        pageIndexes,
        leftPageIndexes: split.left.map((page) => page.pageIndex),
        rightPageIndexes: split.right.map((page) => page.pageIndex),
      }));
      const left = await recognizePageBatch(
        settings,
        split.left,
        signal,
        batchContext,
        { attempt: 0, deadlineAt: recoveryState.deadlineAt },
        checkpoint,
      );
      const right = await recognizePageBatch(
        settings,
        split.right,
        signal,
        { hasLeadingOverlap: split.hasOverlap || batchContext.hasLeadingOverlap },
        { attempt: 0, deadlineAt: recoveryState.deadlineAt },
        checkpoint,
      );
      return mergeRecognitionBatches([
        {
          result: left,
          pageIndexes: split.left.map((page) => page.pageIndex),
          deferLastPage: split.hasOverlap,
        },
        {
          result: right,
          pageIndexes: split.right.map((page) => page.pageIndex),
          deferLastPage: false,
        },
      ], pageIndexes);
    }
    if (!isRecoverableStructureError(error) || signal.aborted) {
      throw error;
    }

    const pageIndexes = pages.map((page) => page.pageIndex);
    if (Date.now() >= recoveryState.deadlineAt) {
      console.warn(JSON.stringify({
        event: "word_recognition_structure_failed",
        pageIndexes,
        reason: "structure_deadline_exhausted",
      }));
      throw error;
    }
    if (recoveryState.attempt === 0 || pages.length === 1) {
      const nextAttempt = recoveryState.attempt + 1;
      if (pages.length > 1 || nextAttempt < MAX_SINGLE_PAGE_STRUCTURE_ATTEMPTS) {
        console.warn(JSON.stringify({
          event: "word_recognition_structure_retry",
          pageIndexes,
          attempt: nextAttempt,
        }));
        return recognizePageBatch(settings, pages, signal, batchContext, {
          ...recoveryState,
          attempt: nextAttempt,
        }, checkpoint);
      }
      console.warn(JSON.stringify({
        event: "word_recognition_structure_failed",
        pageIndexes,
        reason: error.kind,
        attempts: MAX_SINGLE_PAGE_STRUCTURE_ATTEMPTS,
      }));
      throw error;
    }

    const split = splitRecognitionPages(pages);
    console.warn(JSON.stringify({
      event: "word_recognition_structure_split",
      pageIndexes,
      leftPageIndexes: split.left.map((page) => page.pageIndex),
      rightPageIndexes: split.right.map((page) => page.pageIndex),
    }));
    const left = await recognizePageBatch(
      settings,
      split.left,
      signal,
      batchContext,
      { attempt: 0, deadlineAt: recoveryState.deadlineAt },
      checkpoint,
    );
    const right = await recognizePageBatch(
      settings,
      split.right,
      signal,
      { hasLeadingOverlap: split.hasOverlap || batchContext.hasLeadingOverlap },
      { attempt: 0, deadlineAt: recoveryState.deadlineAt },
      checkpoint,
    );
    return mergeRecognitionBatches([
      {
        result: left,
        pageIndexes: split.left.map((page) => page.pageIndex),
        deferLastPage: split.hasOverlap,
      },
      {
        result: right,
        pageIndexes: split.right.map((page) => page.pageIndex),
        deferLastPage: false,
      },
    ], pageIndexes);
  }
}

function splitRecognitionPages(pages: RecognitionRequest["pages"]) {
  if (pages.length < 2) throw new AiProxyError("invalid-response");
  if (pages.length === 2) {
    return { left: pages.slice(0, 1), right: pages.slice(1), hasOverlap: false };
  }
  const middle = Math.ceil(pages.length / 2);
  return {
    left: pages.slice(0, middle),
    right: pages.slice(middle - 1),
    hasOverlap: true,
  };
}

function isRecoverableStructureError(error: unknown): error is AiProxyError {
  return error instanceof AiProxyError
    && (error.kind === "invalid-response" || error.kind === "truncated-response");
}

function isRecognitionTimeout(error: unknown): error is AiProxyError {
  return error instanceof AiProxyError && error.kind === "timeout";
}

async function recognizePageBatchAttempt(
  settings: AiSettingsInput,
  pages: RecognitionRequest["pages"],
  signal: AbortSignal,
  batchContext: BatchRecognitionContext,
  deadlineAt: number,
  checkpoint?: RecognitionSequenceCheckpoint,
): Promise<RecognitionResult> {
  const pageIndexes = pages.map((page) => page.pageIndex);
  const maxTokens = Math.min(
    MAX_RECOGNITION_MAX_TOKENS,
    DEFAULT_RECOGNITION_MAX_TOKENS * pages.length,
  );
  // 主识别、结构纠错和所有精确复检共享同一绝对截止时间，任何重试都不能重新获得完整时限。
  const requestOptions = {
    signal,
    maxTokens,
    deadlineAt,
    retryTimeout: pages.length === 1,
  };
  const saved = findPartialBatch(checkpoint, pageIndexes);
  let recognized: RecognitionResult;
  const completedRecoveryKinds = new Set<RecoveryKind>(saved?.completedRecoveryKinds ?? []);

  if (saved) {
    recognized = saved.result;
    console.info(JSON.stringify({
      event: "word_recognition_batch_stage_resumed",
      pageIndexes,
      completedRecoveryKinds: [...completedRecoveryKinds],
    }));
  } else {
    const content = await requestRecognitionCompletion(
      settings,
      createRecognitionRequest(pages, { ...batchContext }),
      requestOptions,
    );
    recognized = parseRecognitionResult(content, pages);
    savePartialBatch(checkpoint, pageIndexes, recognized, []);
    console.info(JSON.stringify({
      event: "word_recognition_batch_primary_checkpointed",
      pageIndexes,
      questionCount: recognized.questions.length,
    }));
  }

  // 复检只负责提升图形边界质量，不能阻塞主识别结果。生产默认跳过该增强阶段，
  // 如需开启可显式设置 WORD_RECOGNITION_RECOVERY=1；主识别结果本身仍完整保留。
  if (!shouldRunRecognitionRecovery()) {
    console.info(JSON.stringify({
      event: "word_recognition_recovery_skipped",
      pageIndexes,
      reason: "production_fast_path",
    }));
    return recognized;
  }

  const recoveryDeadlineAt = Math.min(
    deadlineAt,
    Date.now() + getRecoveryBatchTimeoutMs(),
  );

  for (const kind of ["table", "option", "figure"] as const) {
    if (completedRecoveryKinds.has(kind)) continue;
    if (Date.now() >= recoveryDeadlineAt) {
      console.warn(JSON.stringify({
        event: "word_recognition_recovery_batch_timeout",
        pageIndexes,
        completedRecoveryKinds: [...completedRecoveryKinds],
      }));
      break;
    }
    recognized = await recoverRecognitionKind(
      settings,
      pages,
      recognized,
      kind,
      signal,
      recoveryDeadlineAt,
      batchContext,
      (current) => savePartialBatch(checkpoint, pageIndexes, current, [...completedRecoveryKinds]),
    );
    completedRecoveryKinds.add(kind);
    savePartialBatch(checkpoint, pageIndexes, recognized, [...completedRecoveryKinds]);
  }

  return recognized;
}

async function recoverRecognitionKind(
  settings: AiSettingsInput,
  pages: RecognitionRequest["pages"],
  initial: RecognitionResult,
  kind: RecoveryKind,
  signal: AbortSignal,
  deadlineAt: number,
  batchContext: BatchRecognitionContext,
  onTargetCompleted: (result: RecognitionResult) => void,
) {
  let recognized = initial;
  const allTargets = buildRecoveryTargets(recognized, kind);
  const targets = allTargets.slice(0, MAX_RECOVERY_TARGETS_PER_BATCH);
  if (allTargets.length > targets.length) {
    console.warn(JSON.stringify({
      event: "word_recognition_recovery_budget_exhausted",
      kind,
      totalTargets: allTargets.length,
      processedTargets: targets.length,
      preservedTargets: allTargets.length - targets.length,
    }));
  }
  for (const target of targets) {
    // 前一个目标完成后会改变识别结果；若当前目标已被顺带修复，则无需再次调用上游。
    if (!buildRecoveryTargets(recognized, kind).some((candidate) => candidate.targetId === target.targetId)) {
      continue;
    }
    recognized = await recoverSingleTarget(
      settings,
      pages,
      recognized,
      kind,
      target,
      signal,
      deadlineAt,
      batchContext,
    );
    onTargetCompleted(recognized);
  }
  // 超出预算的增强目标直接保留原页，保证主识别结果继续向后输出。
  for (const target of allTargets.slice(MAX_RECOVERY_TARGETS_PER_BATCH)) {
    if (!buildRecoveryTargets(recognized, kind).some((candidate) => candidate.targetId === target.targetId)) {
      continue;
    }
    recognized = preserveRecoveryTarget(recognized, target, kind);
    onTargetCompleted(recognized);
  }
  return recognized;
}

async function recoverSingleTarget(
  settings: AiSettingsInput,
  allPages: RecognitionRequest["pages"],
  original: RecognitionResult,
  kind: RecoveryKind,
  target: RecoveryTarget,
  signal: AbortSignal,
  deadlineAt: number,
  batchContext: BatchRecognitionContext,
) {
  const targetPageIndexes = new Set(target.pageIndexes);
  const pages = allPages.filter((page) => targetPageIndexes.has(page.pageIndex));
  const scopedPages = pages.length
    ? pages
    : allPages.filter((page) => page.pageIndex === target.pageIndex);
  const targetDeadlineAt = Math.min(
    deadlineAt,
    Date.now() + getRecoveryTargetTimeoutMs(),
  );

  for (let attempt = 0; attempt < MAX_RECOVERY_TARGET_STRUCTURE_ATTEMPTS; attempt += 1) {
    if (Date.now() >= targetDeadlineAt) {
      return preserveRecoveryTarget(original, target, kind);
    }
    try {
      const recoveryContent = await requestRecognitionCompletion(
        settings,
        createRecognitionRequest(scopedPages, {
          ...batchContext,
          structureRecovery: attempt > 0,
          tableRecovery: kind === "table",
          optionGroupRecovery: kind === "option",
          figureRecovery: kind === "figure",
          recoveryTargets: [target],
        }),
        {
          signal,
          maxTokens: Math.min(
            MAX_RECOGNITION_MAX_TOKENS,
            DEFAULT_RECOGNITION_MAX_TOKENS * Math.max(1, scopedPages.length),
          ),
          deadlineAt: targetDeadlineAt,
        },
      );
      const recovery = parseRecognitionResult(recoveryContent, scopedPages);
      const merged = mergeRecoveredTarget(original, recovery, target, kind);
      if (buildRecoveryTargets(merged, kind).some((candidate) => candidate.targetId === target.targetId)) {
        throw new AiProxyError("invalid-response");
      }
      return merged;
    } catch (error) {
      if (signal.aborted) throw signal.reason || error;
      if (!isRecoverableStructureError(error)) {
        if (!(error instanceof AiProxyError)) throw error;
        console.warn(JSON.stringify({
          event: "word_recognition_recovery_fallback",
          kind,
          targetId: target.targetId,
          pageIndexes: scopedPages.map((page) => page.pageIndex),
          reason: error.kind,
        }));
        return preserveRecoveryTarget(original, target, kind);
      }
      const nextAttempt = attempt + 1;
      if (nextAttempt < MAX_RECOVERY_TARGET_STRUCTURE_ATTEMPTS && Date.now() < targetDeadlineAt) {
        console.warn(JSON.stringify({
          event: "word_recognition_recovery_retry",
          kind,
          targetId: target.targetId,
          pageIndexes: scopedPages.map((page) => page.pageIndex),
          attempt: nextAttempt,
        }));
        continue;
      }
      console.warn(JSON.stringify({
        event: "word_recognition_recovery_fallback",
        kind,
        targetId: target.targetId,
        pageIndexes: scopedPages.map((page) => page.pageIndex),
        reason: error.kind,
      }));
      return preserveRecoveryTarget(original, target, kind);
    }
  }

  return preserveRecoveryTarget(original, target, kind);
}

function mergeRecoveredTarget(
  original: RecognitionResult,
  recovery: RecognitionResult,
  target: RecoveryTarget,
  kind: RecoveryKind,
) {
  if (kind === "table") return mergeRecoveredTableFigures(original, recovery, [target]);
  if (kind === "option") return mergeRecoveredVisualOptions(original, recovery, [target]);
  return mergeRecoveredFigures(original, recovery, [target]);
}

async function requestRecognitionCompletion(
  settings: AiSettingsInput,
  payload: Record<string, unknown>,
  options: { signal: AbortSignal; maxTokens: number; deadlineAt: number; retryTimeout?: boolean },
) {
  try {
    return await requestChatCompletion(settings, payload, options);
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason || error;
    if (!(error instanceof AiProxyError) || !error.retryable) throw error;
    // 超时通常意味着当前图片批次过大；交给上层立即拆批，不能把同一大批再次耗满时限。
    if (error.kind === "timeout" && options.retryTimeout === false) throw error;
    // 仅对传输型故障按原图、原提示词、原模型重放一次，不切图、不采用残缺结果。
    return requestChatCompletion(settings, payload, options);
  }
}

export async function verifyAiSettings(settings: AiSettingsInput) {
  await recognizePages(settings, SETTINGS_VERIFICATION_REQUEST);
}

async function requestChatCompletion(
  settings: AiSettingsInput,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal; maxTokens?: number; deadlineAt?: number } = {},
) {
  const timeoutController = new AbortController();
  const deadlineAt = Math.min(
    options.deadlineAt ?? Number.POSITIVE_INFINITY,
    Date.now() + getUpstreamTimeoutMs(),
  );
  const timeout = setTimeout(
    timeoutController.abort.bind(timeoutController),
    Math.max(1, deadlineAt - Date.now()),
  );
  const signal = options.signal
    ? AbortSignal.any([timeoutController.signal, options.signal])
    : timeoutController.signal;
  const maxTokens = Math.min(
    MAX_RECOGNITION_MAX_TOKENS,
    Math.max(1, options.maxTokens ?? DEFAULT_RECOGNITION_MAX_TOKENS),
  );

  try {
    signal.throwIfAborted();
    const upstreamUrl = await chatCompletionsUrl(settings.baseUrl);
    signal.throwIfAborted();
    let controls: ChatCompletionControls = { responseFormat: true, maxTokens };
    let response: Response | null = null;

    // 兼容 OpenAI 兼容接口：只移除被明确拒绝的控制字段，避免无谓丢失输出额度。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await sendChatCompletionRequest(settings, upstreamUrl, payload, signal, controls);
      if (response.ok) break;

      const fallbackControls = await resolveFallbackControls(response, controls);
      if (!fallbackControls) break;
      controls = fallbackControls;
    }

    if (!response?.ok) {
      const status = response?.status;
      await cancelResponseBody(response);
      throw new AiProxyError("upstream", isRetryableUpstreamStatus(status), status);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason || error;
      if (isAbortError(error)) throw new AiProxyError("timeout", true);
      throw new AiProxyError("invalid-response");
    }

    return extractCompleteChatCompletionContent(responseBody);
  } catch (error) {
    if (error instanceof AiProxyError) throw error;
    if (options.signal?.aborted) throw options.signal.reason || error;
    if (isAbortError(error)) throw new AiProxyError("timeout", true);
    throw new AiProxyError("upstream", true);
  } finally {
    clearTimeout(timeout);
  }
}

type ChatCompletionControls = {
  responseFormat: boolean;
  maxTokens: number | null;
};

function sendChatCompletionRequest(
  settings: AiSettingsInput,
  upstreamUrl: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  controls: ChatCompletionControls,
) {
  return fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      ...payload,
      ...(controls.responseFormat ? { response_format: { type: "json_object" } } : {}),
      ...(controls.maxTokens !== null ? { max_tokens: controls.maxTokens } : {}),
    }),
    signal,
    redirect: "error",
  });
}

function isRetryableUpstreamStatus(status: number | undefined) {
  return status === 408
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

async function cancelResponseBody(response: Response | null) {
  if (!response?.body || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // 失败响应已经判定不可用；取消失败不能覆盖原始上游错误。
  }
}

async function resolveFallbackControls(response: Response, controls: ChatCompletionControls) {
  if (response.status !== 400 && response.status !== 422) return false;

  const hint = (await readUpstreamErrorHint(response)).toLowerCase();
  if (!hint) return false;

  const rejectsResponseFormat = /response[\s_-]*format/.test(hint);
  const rejectsMaxTokens = /max[\s_-]*tokens/.test(hint);
  const mentionsOptionalField = rejectsResponseFormat || rejectsMaxTokens;
  const indicatesIncompatibility = /unsupported|not\s+supported|unknown|unrecognized|unexpected|extra[\s_-]*forbidden|additional[\s_-]*properties|invalid[\s_-]*(?:parameter|field|request)|not\s+allowed|does\s+not\s+support|\u4e0d\u652f\u6301|\u672a\u77e5\u53c2\u6570|\u65e0\u6548\u53c2\u6570|\u4e0d\u5141\u8bb8|\u989d\u5916\u5b57\u6bb5/.test(hint);
  const explicitMaxTokens = rejectsMaxTokens ? readExplicitMaxTokensLimit(hint) : null;
  if (!mentionsOptionalField || (!indicatesIncompatibility && explicitMaxTokens === null)) return null;

  const fallback = {
    responseFormat: controls.responseFormat && !rejectsResponseFormat,
    maxTokens: rejectsMaxTokens
      ? explicitMaxTokens !== null && controls.maxTokens !== null && explicitMaxTokens < controls.maxTokens
        ? explicitMaxTokens
        : null
      : controls.maxTokens,
  };
  return fallback.responseFormat === controls.responseFormat && fallback.maxTokens === controls.maxTokens
    ? null
    : fallback;
}

function readExplicitMaxTokensLimit(hint: string) {
  const patterns = [
    /max[\s_-]*tokens[^\d]{0,80}(?:<=|at\s+most|less\s+than\s+or\s+equal\s+to|maximum(?:\s+of)?|最多|不得超过)\s*([\d,_]+)/i,
    /(?:maximum|max)\s+(?:output\s+)?(?:token\s+count|tokens)[^\d]{0,40}(?:is|of|:)\s*([\d,_]+)/i,
  ];
  for (const pattern of patterns) {
    const matched = pattern.exec(hint)?.[1]?.replace(/[,_]/g, "");
    const parsed = Number(matched);
    if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_RECOGNITION_MAX_TOKENS) return parsed;
  }
  return null;
}

async function readUpstreamErrorHint(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_ERROR_HINT_CHARS) return "";

  try {
    const text = await response.text();
    return text.length <= MAX_UPSTREAM_ERROR_HINT_CHARS ? text : "";
  } catch {
    return "";
  }
}

function createRecognitionRequest(
  pages: RecognitionRequest["pages"],
  options: {
    tableRecovery?: boolean;
    optionGroupRecovery?: boolean;
    figureRecovery?: boolean;
    recoveryTargets?: readonly RecoveryTarget[];
    hasLeadingOverlap?: boolean;
    structureRecovery?: boolean;
  } = {},
) {
  const recoveryTargetsInstruction = options.recoveryTargets?.length
    ? [
        "本次只复检下列目标。每个目标必须恰好返回一次，返回题目的 id 必须逐字等于 targetId；不得返回清单外题目，也不得按同页其他题目替代。",
        "复检模式下，emptyPageIndexes 表示没有本次目标输出的页面；页面上即使存在清单外题目，也必须忽略并按本次目标的实际覆盖情况填写。",
        JSON.stringify(options.recoveryTargets.map(({ targetId, pageIndex, pageIndexes, number, stemExcerpt }) => ({
          targetId,
          pageIndex,
          pageIndexes,
          number,
          stemExcerpt,
        }))),
      ].join("\n")
    : "";
  const tableRecoveryInstruction = options.tableRecovery
    ? "这是表格纠错复检：只返回含表格的题目即可。必须为每一张原卷表格返回一个 kind=table 的 figures 项和精确 bbox；即使表格文字已经能识别，也不能只返回 Markdown 表格。"
    : "所有具有行列、边框或单元格结构的内容，包括列联表、统计表、数据表、临界值表和实验记录表，都必须当作图片图形处理：每张表分别放入 figures，kind 必须为 table，bbox 只包住完整表格边框；stemMarkdown 和 options 不得转写或重复输出 Markdown 表格。";
  const optionGroupInstruction = options.optionGroupRecovery
    ? "这是图形选项纠错复检：只返回含纯图片/图形选项的题目即可。A、B、C、D 每个选项必须分别返回一个 kind=option 的 figures 项，optionLabel 分别为 A/B/C/D，bbox 只包住对应选项图片内容；不要返回合并选项图、空图片链接或 Blank Equation。"
    : "如果选择题的选项主要或全部是图案、几何图、装置图、地图局部等图片，A/B/C/D 每个视觉选项必须分别放入 figures，kind 使用 option，optionLabel 保存对应标签，bbox 只包住该选项图片内容且不包含标签；options 必须保留选项结构，例如 [\"A.\",\"B.\",\"C.\",\"D.\"]，不得输出 Markdown 图片、Codecogs 空链接或 Blank Equation。";
  const figureRecoveryInstruction = options.figureRecovery
    ? "这是多图题边界复检：只返回目标题目，并为题干引用的每一张独立普通图或表格分别返回 figures 元素；不得合并图形，不得漏掉跨页图，不得返回目标清单之外的题目。"
    : "";
  const overlapInstruction = options.hasLeadingOverlap
    ? "当前批次第一张图片也是上一批次的边界复看页。必须完整返回从该页开始并延续到后页的题目；如果首图顶部只是明显从更前一页开始的残段，不得把该残段另造为重复新题。"
    : "当前批次从文档起始页或新的连续页面段开始。";
  const structureRecoveryInstruction = options.structureRecovery
    ? "上一次同批次输出因 JSON 结构、页码字段或学科符号格式无法解析而被拒绝。本次必须重新观察原图并从头返回完整合法 JSON；不要解释错误，不要复制上一次文本，不得省略任何题目、图形、公式或页面。"
    : "";
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "你是通用资料图片的完整转录与排版助手。上传内容不限类型，可能是试卷、讲义、通知、教案、文章、答案解析、表单或任意其他资料。请按原图阅读顺序识别全部可见内容，并只返回一个合法 JSON 对象，不要使用 Markdown 代码块。",
        "兼容字段 questions 表示按原资料阅读顺序排列的全部内容项，不再只表示题目。返回格式必须是：{\"questions\":[{\"id\":\"item-1\",\"kind\":\"content\",\"number\":\"\",\"pageIndex\":0,\"sourcePageIndexes\":[0],\"stemMarkdown\":\"资料标题或正文\",\"options\":[],\"figures\":[{\"pageIndex\":0,\"kind\":\"diagram\",\"bbox\":{\"x\":0.1,\"y\":0.2,\"width\":0.3,\"height\":0.4},\"caption\":\"图片说明\",\"confidence\":0.9}]}],\"processedPageIndexes\":[0],\"emptyPageIndexes\":[],\"warnings\":[]}",
        "题目项使用 kind=question 并完整填写原题号；标题、正文段落、列表、说明、答案、解析、页眉、页脚、目录、落款和其他非题目内容使用 kind=content 且 number 必须为空字符串。不要给普通内容编造题号。每个内容项必须保持原文，不得摘要、改写、合并掉独立段落或省略重复出现但原图确实存在的文字。",
        "pageIndex 必须使用输入图片给出的值。bbox 的 x、y、width、height 必须是相对于所属当前识别图片宽高的归一化坐标，范围均为 0 到 1，且 x + width、y + height 均不能大于 1；绝不能使用像素坐标。没有图形时 figures 返回空数组；没有选项时 options 返回空数组。数学公式使用 LaTeX，并用 \\( 和 \\) 或 \\[ 和 \\] 包裹。",
        "每个内容项的 sourcePageIndexes 必须列出该项文字、材料、选项或续页实际跨越的全部页面，且必须包含 pageIndex。processedPageIndexes 必须无遗漏、无重复地列出本次输入的全部 pageIndex。emptyPageIndexes 只允许列出真正空白或完全无法辨认且没有任何可见内容的页面；它必须与 questions/sourcePageIndexes/figures 实际覆盖页面的补集完全一致。跨页内容必须通过 sourcePageIndexes 明确覆盖所在页，不得重复造项或把遗漏页面标为空页。",
        "必须完整保留每页全部可见文字、题号、题干、材料、选项、公式、表格、图片、图注、答案和解析，不得因内容较多、内容不像题目、位于页边或重复出现而摘要、改写、省略或只返回部分内容。纯图片内容也必须建立 kind=content 的内容项并返回图形边界。",
        "同一道题可能对应一张、两张或更多独立图形，也可能跨页；每张独立图形必须分别返回一个 figures 元素，绝不能把两张图合并成一个大 bbox，也不能把一题的图分配给相邻题。关联必须综合题号、题干中的‘如图/图1/图2/左图/右图’引用、页面连续性和布局事实；图形按原卷从上到下、从左到右返回。",
        "如果题干明确引用多张图，即使图形外观相似，也要为每一张图分别给出所属 pageIndex、kind 和只包住该图主体的 bbox；跨页题的 sourcePageIndexes 必须包含所有图形所在页。",
        tableRecoveryInstruction,
        optionGroupInstruction,
        figureRecoveryInstruction,
        overlapInstruction,
        structureRecoveryInstruction,
        recoveryTargetsInstruction,
        "图形 bbox 是最终裁切边界，不是题目上下文范围。确定每个 bbox 前必须逐边检查：上、下边界不得带入题干、选项、答案、注释、页码或相邻题目的文字；左、右边界不得带入选项标签、题号或邻栏文字。边界应紧贴图形、照片、表格外框或图中自带标注，只保留极少安全留白；图形内部的坐标轴文字、图例和必要标签必须保留。宁可精确贴边，也不要为了上下文扩大 bbox。",
        "同一道题有多张表或多张普通图时，按从上到下、从左到右的顺序分别返回；表格 bbox 必须包含完整外边框、合并表头和全部数据行列，但不要包含表格外的题干、附注、公式或另一张表。普通几何图、统计图、地图、实验装置等 kind 使用 diagram。",
        "页眉页脚、目录、答案解析、解题过程、批注、说明和重复印刷内容都属于用户上传资料，必须按可见顺序完整返回。不得自行判断内容是否重要。",
        "数学、物理、化学、生物、地理等所有学科的符号必须使用标准 Unicode 或可渲染 LaTeX：上下标、分式、根式、向量、希腊字母、集合与微积分、SI 单位、化学式与离子电荷、反应箭头、核素、遗传方向、经纬度和比例尺均须保持原义。禁止输出乱码、私有区字形、控制图片、�、[UNK]、HTML 公式图片或裸露的 LaTeX 命令；所有公式必须放在 \\( ... \\) 或 \\[ ... \\] 中。",
      ].join("\n"),
    },
    ...pages.flatMap((page, index) => [
      {
        type: "text",
        text: `第 ${index + 1} 张待识别图片：原始 pageIndex=${page.pageIndex}，当前识别图片尺寸=${page.width}x${page.height} 像素。紧随其后的图片即为此 pageIndex=${page.pageIndex} 的图片。`,
      },
      {
        type: "image_url",
        image_url: {
          url: page.imageDataUrl,
          detail: "high",
        },
      },
    ]),
  ];

  return {
    messages: [{ role: "user", content }],
    temperature: 0,
  };
}

async function chatCompletionsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/chat/completions")
    ? normalizedPath
    : `${normalizedPath}/chat/completions`;
  await assertSafeUpstreamUrl(url);
  return url.toString();
}

function parseRecognitionResult(content: string, pages: RecognitionRequest["pages"]): RecognitionResult {
  const parsed = tryParseJsonValue(content);
  if (parsed === null) throw new AiProxyError("invalid-response");
  if (!findRecognitionEnvelope(parsed)) {
    throw new AiProxyError("invalid-response");
  }
  const normalized = normalizeRecognitionResult(parsed, pages);
  if (normalized.emptyPageIndexes.length) {
    // 提示词要求纯图片页也返回内容项；出现空页说明模型遗漏了输入页，不能按成功结果结算。
    throw new AiProxyError("invalid-response");
  }
  const result = RecognitionResultSchema.safeParse(normalized);
  const allowedPageIndexes = new Set(pages.map((page) => page.pageIndex));
  if (!result.success || !hasOnlyAllowedPageIndexes(result.data, allowedPageIndexes)) {
    throw new AiProxyError("invalid-response");
  }
  return result.data;
}

function hasOnlyAllowedPageIndexes(result: RecognitionResult, allowedPageIndexes: ReadonlySet<number>) {
  return result.questions.every((question) => (
    allowedPageIndexes.has(question.pageIndex)
    && question.sourcePageIndexes.every((pageIndex) => allowedPageIndexes.has(pageIndex))
    && question.figures.every((figure) => allowedPageIndexes.has(figure.pageIndex))
  ));
}

function requiresTableFigureRecovery(result: RecognitionResult) {
  return result.questions.some((question) => (
    question.figures.every((figure) => figure.kind !== "table")
    && [question.stemMarkdown, ...question.options].some(containsMarkdownTableBlock)
  ));
}

function requiresFigureRecovery(result: Pick<RecognitionResult, "questions">) {
  return result.questions.some((question) => {
    const expected = countExplicitFigureReferences(question.stemMarkdown);
    const actual = question.figures.filter((figure) => figure.kind === "diagram" || figure.kind === "table").length;
    return expected >= 2 && actual < expected;
  });
}

function countExplicitFigureReferences(stem: string) {
  const numbered = [...stem.matchAll(/图\s*[一二三四五六七八九十百\d]+/gu)].length;
  const directional = [...stem.matchAll(/(?:左图|右图|上图|下图)/gu)].length;
  const plural = /(?:两图|两幅图|两个图|多图)/u.test(stem) ? 2 : 0;
  const singular = /(?:如图|见图|下图|图示|图中|示意图)/u.test(stem) ? 1 : 0;
  return Math.max(plural, numbered, directional, singular);
}

function buildRecoveryTargets(result: RecognitionResult, kind: RecoveryKind): RecoveryTarget[] {
  const targets: RecoveryTarget[] = [];
  for (const [questionIndex, question] of result.questions.entries()) {
    const needsRecovery = kind === "table"
      ? question.figures.every((figure) => figure.kind !== "table")
        && [question.stemMarkdown, ...question.options].some(containsMarkdownTableBlock)
      : kind === "option"
        ? requiresVisualOptionRecovery({ questions: [question] })
        : requiresFigureRecovery({ questions: [question] });
    if (!needsRecovery) continue;
    targets.push({
      targetId: `recovery:${kind}:${question.pageIndex}:${questionIndex}`,
      questionIndex,
      pageIndex: question.pageIndex,
      pageIndexes: [...new Set([
        question.pageIndex,
        ...question.sourcePageIndexes,
        ...question.figures.map((figure) => figure.pageIndex),
      ])],
      number: question.number,
      stemExcerpt: question.stemMarkdown.slice(0, 120),
    });
  }
  return targets;
}

function preserveRecoveryTarget(
  original: RecognitionResult,
  target: RecoveryTarget,
  kind: RecoveryKind,
): RecognitionResult {
  const warning = `第 ${target.pageIndex + 1} 页${recoveryKindLabel(kind)}精确复检异常，已改用完整原页保真。`;
  const questions = original.questions.map((question, questionIndex) => {
    if (questionIndex !== target.questionIndex) return question;
    const figures = [...question.figures];
    for (const pageIndex of target.pageIndexes) {
      const fullPage = createFullPageFigure(pageIndex);
      if (!figures.some((figure) => isSameRecognizedFigure(figure, fullPage))) figures.push(fullPage);
    }
    return { ...question, figures: sortRecognizedFigures(figures) };
  });
  return {
    ...original,
    questions,
    warnings: [...new Set([...original.warnings, warning])].slice(0, MAX_RECOGNIZED_WARNINGS),
  };
}

function createFullPageFigure(pageIndex: number): RecognitionResult["questions"][number]["figures"][number] {
  return {
    pageIndex,
    kind: "diagram",
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    caption: "原始上传页面（完整保留）",
    confidence: 1,
  };
}

function recoveryKindLabel(kind: RecoveryKind) {
  if (kind === "table") return "表格";
  if (kind === "option") return "图形选项";
  return "图形";
}

function mergeRecoveredFigures(
  original: RecognitionResult,
  recovery: RecognitionResult,
  targets: readonly RecoveryTarget[],
) {
  const candidates = assertExactRecoveryCandidates(recovery, targets);
  const questions = original.questions.map((question, questionIndex) => {
    const recovered = candidates.get(targets.find((target) => target.questionIndex === questionIndex)?.targetId || "");
    if (!recovered) return question;
    const figures = [...question.figures];
    for (const figure of recovered.figures) {
      if (figure.kind !== "diagram" && figure.kind !== "table") continue;
      if (!figures.some((existing) => isSameRecognizedFigure(existing, figure))) figures.push(figure);
    }
    return { ...question, figures: sortRecognizedFigures(figures) };
  });
  return { ...original, questions, warnings: [...original.warnings, ...recovery.warnings] };
}

function assertExactRecoveryCandidates(recovery: RecognitionResult, targets: readonly RecoveryTarget[]) {
  const targetsById = new Map(targets.map((target) => [target.targetId, target]));
  if (targetsById.size !== targets.length || recovery.questions.length !== targets.length) {
    throw new AiProxyError("invalid-response");
  }

  const candidates = new Map<string, RecognitionResult["questions"][number]>();
  for (const question of recovery.questions) {
    const target = targetsById.get(question.id);
    if (!target || target.pageIndex !== question.pageIndex || candidates.has(question.id)) {
      throw new AiProxyError("invalid-response");
    }
    candidates.set(question.id, question);
  }
  if (candidates.size !== targets.length) throw new AiProxyError("invalid-response");
  return candidates;
}

function mergeRecoveredTableFigures(
  original: RecognitionResult,
  recovery: RecognitionResult,
  targets: readonly RecoveryTarget[],
): RecognitionResult {
  const candidates = assertExactRecoveryCandidates(recovery, targets);
  const recoveredByQuestionIndex = new Map<number, RecognitionResult["questions"][number]["figures"]>();
  for (const target of targets) {
    const tables = candidates.get(target.targetId)?.figures.filter((figure) => figure.kind === "table") ?? [];
    if (!tables.length) throw new AiProxyError("invalid-response");
    recoveredByQuestionIndex.set(target.questionIndex, tables);
  }

  const questions = original.questions.map((question, questionIndex) => {
    const recoveredTables = recoveredByQuestionIndex.get(questionIndex);
    if (!recoveredTables) return question;
    const figures = [...question.figures];
    for (const table of recoveredTables) {
      if (!figures.some((figure) => isSameRecognizedFigure(figure, table))) figures.push(table);
    }
    return {
      ...question,
      stemMarkdown: stripMarkdownTableBlocks(question.stemMarkdown),
      options: question.options.map(stripMarkdownTableBlocks).filter(Boolean),
      figures,
    };
  });

  return {
    ...original,
    questions,
    warnings: [...original.warnings, ...recovery.warnings],
  };
}

function requiresVisualOptionRecovery(result: Pick<RecognitionResult, "questions">) {
  return result.questions.some((question) => {
    const hasVisualSource = hasVisualOptionPlaceholderSet(question.options)
      || question.figures.some((figure) => figure.kind === "option-group");
    if (!hasVisualSource) return false;

    const expectedLabels = collectExpectedOptionLabels(question);
    const recognizedLabels = new Set(
      question.figures
        .filter((figure) => figure.kind === "option")
        .map((figure) => normalizeOptionLabel(figure.optionLabel))
        .filter(Boolean),
    );
    return expectedLabels.some((label) => !recognizedLabels.has(label));
  });
}

function mergeRecoveredVisualOptions(
  original: RecognitionResult,
  recovery: RecognitionResult,
  targets: readonly RecoveryTarget[],
): RecognitionResult {
  const candidates = assertExactRecoveryCandidates(recovery, targets);
  const recoveredByQuestionIndex = new Map<number, RecognitionResult["questions"][number]["figures"]>();
  for (const target of targets) {
    const question = original.questions[target.questionIndex];
    const expectedLabels = collectExpectedOptionLabels(question);
    const optionFigures = candidates.get(target.targetId)?.figures.filter((figure) => (
      figure.kind === "option" && normalizeOptionLabel(figure.optionLabel)
    )) ?? [];
    const recoveredLabels = new Set(optionFigures.map((figure) => normalizeOptionLabel(figure.optionLabel)).filter(Boolean));
    if (!expectedLabels.every((label) => recoveredLabels.has(label))) {
      throw new AiProxyError("invalid-response");
    }
    recoveredByQuestionIndex.set(target.questionIndex, optionFigures);
  }

  const questions = original.questions.map((question, questionIndex) => {
    const recoveredOptions = recoveredByQuestionIndex.get(questionIndex);
    if (!recoveredOptions) return question;
    const figures = [...question.figures];
    for (const optionFigure of recoveredOptions) {
      if (!figures.some((figure) => isSameRecognizedFigure(figure, optionFigure))) figures.push(optionFigure);
    }
    const recoveredLabels = figures
      .filter((figure) => figure.kind === "option")
      .map((figure) => normalizeOptionLabel(figure.optionLabel))
      .filter(Boolean);
    return {
      ...question,
      options: restoreVisualOptionLabels(question.options, recoveredLabels),
      figures: sortRecognizedFigures(figures.filter((figure) => figure.kind !== "option-group")),
    };
  });

  return {
    ...original,
    questions,
    warnings: [...original.warnings, ...recovery.warnings],
  };
}

function collectExpectedOptionLabels(question: RecognitionResult["questions"][number]) {
  const labels = question.options.map(extractOptionLabel).filter(Boolean);
  if (labels.length) return [...new Set(labels)];
  const figureLabels = question.figures
    .filter((figure) => figure.kind === "option")
    .map((figure) => normalizeOptionLabel(figure.optionLabel))
    .filter(Boolean);
  return figureLabels.length ? [...new Set(figureLabels)] : ["A", "B", "C", "D"];
}

function isSameRecognizedFigure(
  left: RecognitionResult["questions"][number]["figures"][number],
  right: RecognitionResult["questions"][number]["figures"][number],
) {
  return left.pageIndex === right.pageIndex
    && left.kind === right.kind
    && Math.abs(left.bbox.x - right.bbox.x) < 0.005
    && Math.abs(left.bbox.y - right.bbox.y) < 0.005
    && Math.abs(left.bbox.width - right.bbox.width) < 0.005
    && Math.abs(left.bbox.height - right.bbox.height) < 0.005;
}

type RecognitionEnvelope = {
  questions: unknown[];
  warnings: unknown;
  processedPageIndexes: unknown;
  emptyPageIndexes: unknown;
};

function normalizeRecognitionResult(value: unknown, pages: RecognitionRequest["pages"]) {
  const envelope = findRecognitionEnvelope(value);
  if (!envelope) throw new AiProxyError("invalid-response");
  if (envelope.questions.length > MAX_RECOGNIZED_QUESTIONS) throw new AiProxyError("invalid-response");

  const pagesByIndex = new Map(pages.map((page) => [page.pageIndex, page]));
  const singlePageIndex = pages.length === 1 ? pages[0].pageIndex : null;
  const questions: Array<Record<string, unknown>> = [];

  for (const [index, question] of envelope.questions.entries()) {
    const normalized = normalizeRecognizedQuestion(question, index, pagesByIndex, singlePageIndex);
    if (!normalized) throw new AiProxyError("invalid-response");
    questions.push(normalized);
  }

  const pageCoverage = reconcilePageCoverage(envelope, questions, pagesByIndex);
  const warnings = normalizeTextList(envelope.warnings, MAX_RECOGNIZED_WARNINGS, 1_000);

  return {
    questions,
    processedPageIndexes: pageCoverage.processedPageIndexes,
    emptyPageIndexes: pageCoverage.emptyPageIndexes,
    warnings: [...new Set([...warnings, ...pageCoverage.warnings])].slice(0, MAX_RECOGNIZED_WARNINGS),
  };
}

function reconcilePageCoverage(
  envelope: RecognitionEnvelope,
  questions: Array<Record<string, unknown>>,
  pagesByIndex: ReadonlyMap<number, RecognitionPage>,
) {
  const expectedPageIndexes = new Set(pagesByIndex.keys());
  const modelProcessedPageIndexes = tryParsePageIndexList(envelope.processedPageIndexes, expectedPageIndexes);
  const modelEmptyPageIndexes = tryParsePageIndexList(envelope.emptyPageIndexes, expectedPageIndexes);

  const contentPageIndexes = new Set<number>();
  for (const question of questions) {
    contentPageIndexes.add(Number(question.pageIndex));
    const sourcePageIndexes = Array.isArray(question.sourcePageIndexes)
      ? question.sourcePageIndexes
      : [];
    for (const pageIndex of sourcePageIndexes) contentPageIndexes.add(Number(pageIndex));
    const figures = Array.isArray(question.figures) ? question.figures : [];
    for (const figure of figures) {
      if (isRecord(figure)) contentPageIndexes.add(Number(figure.pageIndex));
    }
  }
  // 处理页由服务端已经送入模型的实际批次确定；模型字段仅用于发现偏差，不能覆盖服务端事实。
  const processedPageIndexesInInputOrder = [...expectedPageIndexes];
  const emptyPageIndexesInInputOrder = processedPageIndexesInInputOrder
    .filter((pageIndex) => !contentPageIndexes.has(pageIndex));
  const modelMetadataMatches = Boolean(
    modelProcessedPageIndexes
    && modelProcessedPageIndexes.size === expectedPageIndexes.size
    && processedPageIndexesInInputOrder.every((pageIndex) => modelProcessedPageIndexes.has(pageIndex))
    && modelEmptyPageIndexes
    && modelEmptyPageIndexes.size === emptyPageIndexesInInputOrder.length
    && emptyPageIndexesInInputOrder.every((pageIndex) => modelEmptyPageIndexes.has(pageIndex)),
  );
  return {
    processedPageIndexes: processedPageIndexesInInputOrder,
    emptyPageIndexes: emptyPageIndexesInInputOrder,
    warnings: modelMetadataMatches ? [] : ["页面覆盖元数据已由服务端按实际识别内容重新计算。"],
  };
}

function tryParsePageIndexList(value: unknown, allowedPageIndexes: ReadonlySet<number>) {
  if (!Array.isArray(value)) return null;
  const pageIndexes = new Set<number>();
  for (const item of value) {
    const pageIndex = toNonNegativeInteger(item);
    if (pageIndex === null || !allowedPageIndexes.has(pageIndex) || pageIndexes.has(pageIndex)) return null;
    pageIndexes.add(pageIndex);
  }
  return pageIndexes;
}

function findRecognitionEnvelope(value: unknown, depth = 0): RecognitionEnvelope | null {
  if (depth > MAX_JSON_PARSE_DEPTH) return null;

  if (typeof value === "string") {
    const parsed = tryParseJsonValue(value);
    return parsed === null ? null : findRecognitionEnvelope(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    if (isLikelyQuestionArray(value)) {
      return {
        questions: value,
        warnings: [],
        processedPageIndexes: undefined,
        emptyPageIndexes: undefined,
      };
    }

    for (const item of value.slice(0, MAX_RECOGNIZED_QUESTIONS)) {
      const nested = findRecognitionEnvelope(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  if (Array.isArray(value.questions)) {
    return {
      questions: value.questions,
      warnings: value.warnings,
      processedPageIndexes: value.processedPageIndexes,
      emptyPageIndexes: value.emptyPageIndexes,
    };
  }

  if (typeof value.questions === "string") {
    const parsedQuestions = tryParseJsonValue(value.questions);
    if (Array.isArray(parsedQuestions)) {
      return {
        questions: parsedQuestions,
        warnings: value.warnings,
        processedPageIndexes: value.processedPageIndexes,
        emptyPageIndexes: value.emptyPageIndexes,
      };
    }
  }

  for (const key of ["data", "result", "output", "response"] as const) {
    if (!hasOwn(value, key)) continue;
    const nested = findRecognitionEnvelope(value[key], depth + 1);
    if (!nested) continue;
    return {
      questions: nested.questions,
      warnings: hasOwn(value, "warnings") ? value.warnings : nested.warnings,
      processedPageIndexes: hasOwn(value, "processedPageIndexes")
        ? value.processedPageIndexes
        : nested.processedPageIndexes,
      emptyPageIndexes: hasOwn(value, "emptyPageIndexes")
        ? value.emptyPageIndexes
        : nested.emptyPageIndexes,
    };
  }

  return null;
}

function looksLikeQuestion(value: unknown) {
  if (!isRecord(value)) return false;
  if (["stemMarkdown", "stem", "question", "options", "choices", "figures"].some((key) => hasOwn(value, key))) {
    return true;
  }
  return typeof value.content === "string" || typeof value.text === "string";
}

function isLikelyQuestionArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && (!value.length || value.some(looksLikeQuestion));
}

function normalizeRecognizedQuestion(
  value: unknown,
  index: number,
  pagesByIndex: ReadonlyMap<number, RecognitionPage>,
  singlePageIndex: number | null,
) {
  const source = isRecord(value)
    ? value
    : typeof value === "string"
      ? { stemMarkdown: value }
      : null;
  if (!source) return null;

  const pageIndex = resolveAllowedPageIndex(
    readFirstField(source, ["pageIndex", "page_index", "page", "pageNo", "pageNumber"]),
    singlePageIndex,
    pagesByIndex,
    false,
  );
  if (pageIndex === null) throw new AiProxyError("invalid-response");

  const id = normalizeText(
    readFirstField(source, ["id", "questionId", "question_id", "uid"]),
    128,
    `q-${index + 1}`,
  );
  const explicitKind = normalizeText(
    readFirstField(source, ["kind", "itemKind", "item_kind", "contentType", "content_type"]),
    32,
  ).toLowerCase();
  const kind = ["content", "text", "paragraph", "heading", "document"].includes(explicitKind)
    ? "content"
    : "question";
  const number = normalizeText(
    readFirstField(source, ["number", "questionNumber", "question_number", "no", "index"]),
    128,
    kind === "question" ? String(index + 1) : "",
  );
  const declaredSourcePageIndexes = normalizeSourcePageIndexes(
    readFirstField(source, ["sourcePageIndexes", "source_page_indexes", "pageIndexes", "page_indexes"]),
    pageIndex,
    pagesByIndex,
  );
  const rawStemMarkdown = normalizeText(
    readFirstField(source, ["stemMarkdown", "stem", "question", "content", "text"]),
    30_000,
  );
  const figures = deduplicateRecognizedFigures([
    ...normalizeRecognizedFigures(
      readFirstField(source, ["figures", "images", "diagrams", "graphics", "figure"]),
      pageIndex,
      pagesByIndex,
      "diagram",
    ),
    ...normalizeRecognizedFigures(
      readFirstField(source, ["tables", "tableRegions", "table_regions", "table"]),
      pageIndex,
      pagesByIndex,
      "table",
    ),
    ...normalizeRecognizedFigures(
      readFirstField(source, ["optionFigures", "option_figures", "optionImages", "option_images", "visualOptions", "visual_options"]),
      pageIndex,
      pagesByIndex,
      "option",
    ),
  ]);
  const sourcePageIndexes = [...new Set([
    ...declaredSourcePageIndexes,
    ...figures.map((figure) => Number(figure.pageIndex)),
  ])].sort((left, right) => left - right);
  const optionLabels = figures
    .filter((figure) => figure.kind === "option")
    .map((figure) => normalizeOptionLabel(figure.optionLabel))
    .filter(Boolean);
  const hasTableFigure = figures.some((figure) => figure.kind === "table");
  const hasOptionGroup = figures.some((figure) => figure.kind === "option-group");
  const hasVisualOptions = optionLabels.length > 0 || hasOptionGroup;
  const stemMarkdown = hasTableFigure ? stripMarkdownTableBlocks(rawStemMarkdown) : rawStemMarkdown;
  const normalizedOptions = normalizeOptions(readFirstField(source, ["options", "choices", "answers", "selections"]))
    .map((option) => (hasTableFigure ? stripMarkdownTableBlocks(option) : option))
    .filter(Boolean);
  const sourceOptionLabels = normalizedOptions.map(extractOptionLabel).filter(Boolean);
  const requiredOptionLabels = sourceOptionLabels.length
    ? [...new Set(sourceOptionLabels)]
    : hasOptionGroup
      ? ["A", "B", "C", "D"]
      : [...new Set(optionLabels)];
  const options = hasVisualOptions
    ? restoreVisualOptionLabels(normalizedOptions, requiredOptionLabels)
    : normalizedOptions;
  const recognizedOptionLabels = new Set(optionLabels);
  const hasCompleteIndependentOptions = requiredOptionLabels.length > 0
    && requiredOptionLabels.every((label) => recognizedOptionLabels.has(label));
  const normalizedFigures = hasCompleteIndependentOptions
    ? figures.filter((figure) => figure.kind !== "option-group")
    : figures;
  const normalizedMathText = normalizeQuestionMathFields({ stemMarkdown, options });

  return {
    id,
    kind,
    number,
    pageIndex,
    sourcePageIndexes,
    stemMarkdown: normalizedMathText.stemMarkdown,
    options: normalizedMathText.options,
      figures: sortRecognizedFigures(normalizedFigures),
  };
}

function normalizeSourcePageIndexes(
  value: unknown,
  questionPageIndex: number,
  pagesByIndex: ReadonlyMap<number, RecognitionPage>,
) {
  if (value === undefined || value === null) {
    return [questionPageIndex];
  }
  if (!Array.isArray(value) || !value.length || value.length > pagesByIndex.size) {
    throw new AiProxyError("invalid-response");
  }
  const result: number[] = [];
  for (const rawPageIndex of value) {
    const pageIndex = toNonNegativeInteger(rawPageIndex);
    if (pageIndex === null
      || !pagesByIndex.has(pageIndex)
      || result.includes(pageIndex)) {
      throw new AiProxyError("invalid-response");
    }
    result.push(pageIndex);
  }
  if (!result.includes(questionPageIndex)) throw new AiProxyError("invalid-response");
  return result;
}

function normalizeOptions(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : value === undefined || value === null
        ? []
        : [value];
  if (source.length > MAX_RECOGNIZED_OPTIONS) throw new AiProxyError("invalid-response");
  const options: string[] = [];

  for (const option of source) {
    const optionValue = isRecord(option)
      ? readFirstField(option, ["text", "content", "label", "value"])
      : option;
    const text = normalizeText(optionValue, 10_000);
    if (!text) throw new AiProxyError("invalid-response");
    options.push(text);
  }
  return options;
}

function normalizeRecognizedFigures(
  value: unknown,
  questionPageIndex: number,
  pagesByIndex: ReadonlyMap<number, RecognitionPage>,
  defaultKind: RecognizedFigureKind,
) {
  const source = Array.isArray(value)
    ? value
    : isRecord(value)
      ? [value]
      : value === undefined || value === null
        ? []
        : null;
  if (!source || source.length > MAX_RECOGNIZED_FIGURES) throw new AiProxyError("invalid-response");
  const figures: Array<Record<string, unknown>> = [];

  for (const figure of source) {
    const normalized = normalizeRecognizedFigure(figure, questionPageIndex, pagesByIndex, defaultKind);
    if (!normalized) throw new AiProxyError("invalid-response");
    figures.push(normalized);
  }
  return figures;
}

function normalizeRecognizedFigure(
  value: unknown,
  questionPageIndex: number,
  pagesByIndex: ReadonlyMap<number, RecognitionPage>,
  defaultKind: RecognizedFigureKind,
) {
  if (!isRecord(value)) return null;

  const pageIndex = resolveAllowedPageIndex(
    readFirstField(value, ["pageIndex", "page_index", "page", "pageNo", "pageNumber"]),
    questionPageIndex,
    pagesByIndex,
    false,
  );
  if (pageIndex === null) return null;

  const page = pagesByIndex.get(pageIndex);
  if (!page) return null;
  const bbox = normalizeBoundingBox(value, page);
  if (!bbox) return null;

  const rawCaption = normalizeText(readFirstField(value, ["caption", "description", "label", "text"]), 1_000);
  const confidence = normalizeConfidence(readFirstField(value, ["confidence", "score", "probability"]));
  const kind = normalizeRecognizedFigureKind(
    readFirstField(value, ["kind", "type", "category", "contentType", "content_type"]),
    rawCaption,
    defaultKind,
  );
  const optionLabel = kind === "option"
    ? normalizeOptionLabel(readFirstField(value, ["optionLabel", "option_label", "choiceLabel", "choice_label", "label", "option", "choice"]))
      || normalizeOptionLabel(rawCaption)
    : "";
  const caption = kind === "option" && normalizeOptionLabel(rawCaption) === optionLabel ? "" : rawCaption;
  return {
    pageIndex,
    bbox,
    kind,
    ...(optionLabel ? { optionLabel } : {}),
    ...(caption
      ? { caption }
      : kind === "table"
        ? { caption: "题目表格" }
        : kind === "option-group"
          ? { caption: "图形选项（A-D）" }
          : kind === "option"
            ? { caption: optionLabel ? `${optionLabel}选项图` : "图形选项" }
          : {}),
    ...(confidence === null ? {} : { confidence }),
  };
}

function normalizeRecognizedFigureKind(value: unknown, caption: string, fallback: RecognizedFigureKind) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["option", "visual-option", "visual_option", "image-option", "image_option", "单个选项", "选项图片"].includes(normalized)) {
    return "option";
  }
  if (["option-group", "option_group", "visual-options", "visual_options", "image-options", "image_options", "选项组", "图形选项", "图片选项"].includes(normalized)) {
    return "option-group";
  }
  if (["table", "grid", "tabular", "spreadsheet", "表格", "表"].includes(normalized)) return "table";
  if (["diagram", "figure", "image", "graphic", "chart", "图形", "图片"].includes(normalized)) return "diagram";
  if (/^(?:[A-HＡ-Ｈ]\s*)?(?:选项图|选项图片)$/.test(caption) || /(?:A|B|C|D)选项图/.test(caption)) return "option";
  if (/(?:图形选项|图片选项|图案选项|四个图案选项|选项组)/.test(caption)) return "option-group";
  if (/(?:表格|列联表|统计表|数据表|临界值表|记录表)/.test(caption)) return "table";
  return fallback;
}

function deduplicateRecognizedFigures(figures: Array<Record<string, unknown>>) {
  const unique: Array<Record<string, unknown>> = [];
  for (const figure of figures) {
    const bbox = isRecord(figure.bbox) ? figure.bbox : null;
    if (!bbox) throw new AiProxyError("invalid-response");
    const duplicated = unique.some((existing) => {
      const existingBbox = isRecord(existing.bbox) ? existing.bbox : null;
      return existingBbox
        && existing.pageIndex === figure.pageIndex
        && existing.kind === figure.kind
        && Math.abs(Number(existingBbox.x) - Number(bbox.x)) < 0.005
        && Math.abs(Number(existingBbox.y) - Number(bbox.y)) < 0.005
        && Math.abs(Number(existingBbox.width) - Number(bbox.width)) < 0.005
        && Math.abs(Number(existingBbox.height) - Number(bbox.height)) < 0.005;
    });
    if (!duplicated) unique.push(figure);
  }
  if (unique.length > MAX_RECOGNIZED_FIGURES) throw new AiProxyError("invalid-response");
  return unique;
}

function sortRecognizedFigures<T extends Record<string, unknown>>(figures: T[]) {
  return [...figures].sort((left, right) => (
    Number(left.pageIndex) - Number(right.pageIndex)
    || Number((left.bbox as { y?: unknown })?.y) - Number((right.bbox as { y?: unknown })?.y)
    || Number((left.bbox as { x?: unknown })?.x) - Number((right.bbox as { x?: unknown })?.x)
    || String(left.kind || "").localeCompare(String(right.kind || ""))
    || String(left.optionLabel || "").localeCompare(String(right.optionLabel || ""))
  ));
}

function normalizeBoundingBox(figure: Record<string, unknown>, page: RecognitionPage) {
  const bbox = readBoundingBoxSource(figure);
  if (!bbox) return null;

  const x = readFiniteNumber(bbox, ["x", "left", "x1"]);
  const y = readFiniteNumber(bbox, ["y", "top", "y1"]);
  const right = readFiniteNumber(bbox, ["right", "x2"]);
  const bottom = readFiniteNumber(bbox, ["bottom", "y2"]);
  const width = readFiniteNumber(bbox, ["width", "w"]);
  const height = readFiniteNumber(bbox, ["height", "h"]);
  const resolvedWidth = width ?? (x !== null && right !== null ? right - x : null);
  const resolvedHeight = height ?? (y !== null && bottom !== null ? bottom - y : null);
  if (x === null || y === null || resolvedWidth === null || resolvedHeight === null) return null;

  const hasPixelCoordinates = [x, y, resolvedWidth, resolvedHeight]
    .some((coordinate) => Math.abs(coordinate) > 1 + BBOX_EPSILON);
  const normalizedX = hasPixelCoordinates ? x / page.width : x;
  const normalizedY = hasPixelCoordinates ? y / page.height : y;
  const normalizedWidth = hasPixelCoordinates ? resolvedWidth / page.width : resolvedWidth;
  const normalizedHeight = hasPixelCoordinates ? resolvedHeight / page.height : resolvedHeight;

  if (
    ![normalizedX, normalizedY, normalizedWidth, normalizedHeight].every(Number.isFinite)
    || normalizedX < -BBOX_EPSILON
    || normalizedY < -BBOX_EPSILON
    || normalizedWidth <= 0
    || normalizedHeight <= 0
    || normalizedX + normalizedWidth > 1 + BBOX_EPSILON
    || normalizedY + normalizedHeight > 1 + BBOX_EPSILON
  ) {
    return null;
  }

  const safeX = clampUnit(normalizedX);
  const safeY = clampUnit(normalizedY);
  const safeWidth = Math.min(clampUnit(normalizedWidth), 1 - safeX);
  const safeHeight = Math.min(clampUnit(normalizedHeight), 1 - safeY);
  if (safeWidth <= 0 || safeHeight <= 0) return null;

  return {
    x: safeX,
    y: safeY,
    width: safeWidth,
    height: safeHeight,
  };
}

function readBoundingBoxSource(figure: Record<string, unknown>) {
  for (const key of ["bbox", "boundingBox", "bounding_box", "box", "bounds", "rect"] as const) {
    const value = figure[key];
    if (isRecord(value)) return value;
  }
  return figure;
}

function resolveAllowedPageIndex(
  value: unknown,
  fallback: number | null,
  pagesByIndex: ReadonlyMap<number, RecognitionPage>,
  allowFallbackForInvalidValue = true,
) {
  const pageIndex = toNonNegativeInteger(value);
  if (pageIndex !== null && pagesByIndex.has(pageIndex)) return pageIndex;
  if (!allowFallbackForInvalidValue && !isMissingPageIndex(value)) return null;
  return fallback !== null && pagesByIndex.has(fallback) ? fallback : null;
}

function isMissingPageIndex(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function normalizeTextList(value: unknown, maximumItems: number, maximumLength: number) {
  const source = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  if (source.length > maximumItems) throw new AiProxyError("invalid-response");
  const values: string[] = [];

  for (const item of source) {
    const text = normalizeText(item, maximumLength);
    if (text) values.push(text);
  }
  return values;
}

function normalizeText(value: unknown, maximumLength: number, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const source = String(value).trim();
  if (source.length > maximumLength) throw new AiProxyError("invalid-response");
  const text = normalizeEducationalUnicode(source).trim();
  return text || fallback;
}

function normalizeConfidence(value: unknown) {
  const confidence = toFiniteNumber(value);
  return confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null;
}

function readFiniteNumber(source: Record<string, unknown>, keys: readonly string[]) {
  return toFiniteNumber(readFirstField(source, keys));
}

function toFiniteNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNonNegativeInteger(value: unknown) {
  const number = toFiniteNumber(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0
    ? number
    : null;
}

function readFirstField(source: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (hasOwn(source, key)) return source[key];
  }
  return undefined;
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

async function assertSafeUpstreamUrl(url: URL) {
  if (process.env.PLATFORM_AI_PROXY === "1" && ["127.0.0.1", "localhost", "::1"].includes(normalizeHostname(url.hostname))) {
    return;
  }
  if (process.env.NODE_ENV !== "production") return;
  if (url.protocol !== "https:") {
    throw new AiProxyError("upstream");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isLocalHostname(hostname) || isPrivateOrLinkLocalIpAddress(hostname)) {
    throw new AiProxyError("upstream");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AiProxyError("upstream");
  }

  if (!addresses.length || addresses.some(({ address }) => isPrivateOrLinkLocalIpAddress(address))) {
    throw new AiProxyError("upstream");
  }
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local");
}

function isPrivateOrLinkLocalIpAddress(value: string) {
  const address = normalizeIpAddress(value);
  const family = isIP(address);
  if (family === 4) return isPrivateOrLinkLocalIpv4(address);
  if (family === 6) return isPrivateOrLinkLocalIpv6(address);
  return false;
}

function normalizeHostname(hostname: string) {
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.toLowerCase().replace(/\.$/, "");
}

function normalizeIpAddress(value: string) {
  const address = normalizeHostname(value);
  if (isIP(address) !== 6) return address;

  try {
    return normalizeHostname(new URL(`http://[${address}]/`).hostname);
  } catch {
    return address;
  }
}

function isPrivateOrLinkLocalIpv4(address: string) {
  const [first, second] = address.split(".").map(Number);
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isPrivateOrLinkLocalIpv6(address: string) {
  const normalized = address.toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("::ffff:")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized);
}

function extractCompleteChatCompletionContent(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !payload.choices.length) {
    throw new AiProxyError("invalid-response");
  }
  if (payload.choices.length > 4) throw new AiProxyError("invalid-response");

  let selectedContent: string | null = null;
  for (const choice of payload.choices) {
    if (!isRecord(choice)) throw new AiProxyError("invalid-response");
    const finishReason = readFirstStringField(
      choice,
      ["finish_reason", "finishReason", "stop_reason", "stopReason"],
    );
    if (!finishReason
      || !/^(?:stop|end[_\s-]*turn|completed?|success|eos(?:[_\s-]*token)?)$/i.test(finishReason.trim())) {
      throw new AiProxyError("truncated-response");
    }
    selectedContent ??= extractChoiceContent(choice, 0);
  }

  if (!selectedContent) throw new AiProxyError("invalid-response");
  return selectedContent;
}

function extractChoiceContent(value: unknown, depth: number) {
  if (!isRecord(value)) return null;

  if (isRecord(value.message)) {
    const messageContent = extractTextContent(value.message.content, depth + 1);
    if (messageContent) return messageContent;
  }

  for (const key of ["content", "text", "output_text"] as const) {
    if (!hasOwn(value, key)) continue;
    const content = extractTextContent(value[key], depth + 1);
    if (content) return content;
  }

  return null;
}

function extractTextContent(value: unknown, depth: number): string | null {
  if (depth > MAX_COMPLETION_EXTRACTION_DEPTH) return null;
  if (typeof value === "string") return toBoundedCompletionContent(value);
  if (Array.isArray(value)) return joinTextParts(value);
  if (!isRecord(value)) return null;

  for (const key of ["text", "output_text", "content"] as const) {
    if (!hasOwn(value, key)) continue;
    const content = extractTextContent(value[key], depth + 1);
    if (content) return content;
  }
  return null;
}

function joinTextParts(parts: unknown[]) {
  let text = "";
  for (const part of parts.slice(0, MAX_COMPLETION_TEXT_PARTS)) {
    const content = typeof part === "string"
      ? part
      : isRecord(part)
        ? readFirstStringField(part, ["text", "output_text", "content"])
        : null;
    if (content === null) continue;
    text += content;
    if (text.length > MAX_COMPLETION_CONTENT_CHARS) return null;
  }
  return toBoundedCompletionContent(text);
}

function readFirstStringField(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function toBoundedCompletionContent(value: string) {
  return value.length > 0 && value.length <= MAX_COMPLETION_CONTENT_CHARS ? value : null;
}

function tryParseJsonValue(content: string, depth = 0): unknown | null {
  if (depth > MAX_JSON_PARSE_DEPTH) return null;
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > MAX_COMPLETION_CONTENT_CHARS) return null;

  for (const candidate of jsonCandidates(trimmed)) {
    // 必须在严格解析前处理模型漏写的 LaTeX 反斜杠；否则 \frac、\begin、\right、
    // \text 会被 JSON.parse 当成合法的 \f、\b、\r、\t，并在不报错的情况下破坏公式。
    const repaired = repairLooseJsonEscapes(candidate);
    let parsed: unknown;
    try {
      parsed = JSON.parse(repaired);
    } catch {
      continue;
    }
    if (!hasSafeJsonDepth(parsed)) continue;
    if (typeof parsed === "string") return tryParseJsonValue(parsed, depth + 1);
    return parsed;
  }
  return null;
}

/**
 * 仅修复 JSON 字符串内部由模型漏写转义符造成的 LaTeX 与控制字符问题。
 * 合法的双反斜杠、引号、Unicode、换行与制表符转义保持原样。
 */
export function repairLooseJsonEscapes(jsonText: string) {
  let output = "";
  let inString = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const character = jsonText[index];

    if (!inString) {
      if (character === "\"") inString = true;
      output += character;
      continue;
    }

    if (character === "\"") {
      inString = false;
      output += character;
      continue;
    }

    if (character === "\\") {
      const next = jsonText[index + 1];
      if (!next) {
        output += "\\\\";
        continue;
      }

      if (isLikelyLatexBackslash(jsonText, index)) {
        output += "\\\\";
        continue;
      }

      if (next === "u" && isValidUnicodeEscape(jsonText.slice(index + 2, index + 6))) {
        output += jsonText.slice(index, index + 6);
        index += 5;
        continue;
      }

      if ("\"\\/bfnrt".includes(next)) {
        output += character + next;
        index += 1;
        continue;
      }

      output += "\\\\";
      continue;
    }

    if (character === "\n") {
      output += "\\n";
      continue;
    }
    if (character === "\r") {
      output += "\\r";
      continue;
    }
    if (character === "\t") {
      output += "\\t";
      continue;
    }
    if (character.charCodeAt(0) < 0x20) {
      output += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }

    output += character;
  }

  return output;
}

const latexJsonEscapeCommands = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "begin", "end", "left", "right",
  "overline", "underline", "vec", "sin", "cos", "tan", "cot", "sec", "csc",
  "ln", "log", "lg", "lim", "sum", "prod", "int", "le", "ge", "leq", "geq",
  "ne", "neq", "approx", "sim", "equiv", "mid", "cap", "cup", "in", "notin",
  "subset", "subseteq", "supset", "supseteq", "parallel", "perp", "cdot", "times",
  "div", "pm", "mp", "angle", "triangle", "circ", "degree", "to", "rightarrow",
  "leftarrow", "leftrightarrow", "rightleftharpoons", "uparrow", "downarrow", "Delta",
  "nabla", "partial", "mu", "ohm", "Omega", "alpha", "beta", "gamma", "delta",
  "theta", "lambda", "pi", "omega", "because", "therefore", "text", "mathrm",
  "mathit", "operatorname", "overrightarrow", "hat", "bar", "dot", "ddot", "infty",
  "varnothing", "emptyset", "forall", "exists", "propto", "cong", "simeq", "min",
  "max", "arcsin", "arccos", "arctan", "ce",
  "boxed", "boldsymbol", "binom", "dbinom", "tbinom", "bmod", "pmod", "mod",
  "mathbf", "mathsf", "mathtt", "mathbb", "mathcal", "mathfrak", "bf",
  "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr",
  "flat", "not", "nexists", "nmid", "nparallel", "neg", "rm", "root", "rule",
  "textbf", "textit", "textrm", "textsf", "texttt", "tag", "top",
]);

function isLikelyLatexBackslash(text: string, slashIndex: number) {
  const next = text[slashIndex + 1];
  if (!next) return false;
  if ("()[]{}| ,;!".includes(next)) return true;

  const command = text.slice(slashIndex + 1).match(/^[A-Za-z]+/)?.[0];
  // JSON 的合法单字符控制转义已在上层单独判断；两个及以上字母的命令按通用 LaTeX
  // 处理，避免新学科命令因不在有限清单中而被 \b/\f/\n/\r/\t 静默破坏。
  return Boolean(command && (command.length >= 2 || latexJsonEscapeCommands.has(command)));
}

function isValidUnicodeEscape(value: string) {
  return /^[0-9a-fA-F]{4}$/.test(value);
}

function jsonCandidates(value: string) {
  const candidates = [value];
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(value);
  if (fence?.[1]) candidates.push(fence[1]);
  candidates.push(...findEmbeddedJsonCandidates(value));
  return [...new Set(candidates)];
}

function findEmbeddedJsonCandidates(value: string) {
  const candidates: string[] = [];

  for (let index = 0; index < value.length && candidates.length < 16; index += 1) {
    if (value[index] !== "{" && value[index] !== "[") continue;
    const candidate = readBalancedJsonCandidate(value, index);
    if (!candidate) continue;
    candidates.push(candidate);
    index += candidate.length - 1;
  }

  return candidates;
}

function readBalancedJsonCandidate(value: string, start: number) {
  const opening = value[start];
  const stack = [opening === "{" ? "}" : "]"];
  let quoted = false;
  let escaped = false;

  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        quoted = false;
      }
      continue;
    }

    if (character === "\"") {
      quoted = true;
    } else if (character === "{") {
      stack.push("}");
    } else if (character === "[") {
      stack.push("]");
    } else if (character === "}" || character === "]") {
      if (stack.at(-1) !== character) return null;
      stack.pop();
      if (!stack.length) return value.slice(start, index + 1);
    }
  }

  return null;
}

function hasSafeJsonDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_VALUE_DEPTH) return false;
  if (Array.isArray(value)) return value.every((item) => hasSafeJsonDepth(item, depth + 1));
  if (isRecord(value)) return Object.values(value).every((item) => hasSafeJsonDepth(item, depth + 1));
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isAllowedImageDataUrl(value: string) {
  const match = value.match(/^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  return Boolean(match && match[1].length >= 4 && match[1].length % 4 === 0);
}

function getUpstreamTimeoutMs() {
  const configured = Number(process.env.UPSTREAM_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000 || configured > 600_000) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  return Math.floor(configured);
}

function getRecognitionOperationTimeoutMs() {
  const configured = Number(process.env.RECOGNITION_OPERATION_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000 || configured > 1_100_000) {
    return DEFAULT_RECOGNITION_OPERATION_TIMEOUT_MS;
  }
  return Math.floor(configured);
}

function getRecoveryTargetTimeoutMs() {
  const configured = Number(process.env.RECOVERY_TARGET_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000 || configured > 120_000) {
    return DEFAULT_RECOVERY_TARGET_TIMEOUT_MS;
  }
  return Math.floor(configured);
}

function getRecoveryBatchTimeoutMs() {
  const configured = Number(process.env.RECOVERY_BATCH_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000 || configured > 120_000) {
    return DEFAULT_RECOVERY_BATCH_TIMEOUT_MS;
  }
  return Math.floor(configured);
}

function shouldRunRecognitionRecovery() {
  const configured = process.env.WORD_RECOGNITION_RECOVERY;
  if (configured !== undefined) return /^(1|true|on)$/iu.test(configured.trim());
  return process.env.NODE_ENV !== "production";
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
