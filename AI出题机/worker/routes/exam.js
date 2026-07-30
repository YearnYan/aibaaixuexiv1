import { Hono } from 'hono';
import generationCore from '../../shared/exam-generation-core.js';
import paperConfig from '../../shared/exam-paper-config.js';
import { generateContent } from '../services/ai.js';
import { getDifficultyPrompt } from '../prompts/difficulty-levels.js';
import {
  consumeTrialCredit,
  getRemainingTrialCredits,
  issuePaperContinuationGrant,
  updateSessionCookie,
  verifyPaperContinuationGrant
} from '../middleware/security.js';

const { createExamGenerator } = generationCore;
const {
  MAX_TOTAL_QUESTIONS,
  TYPE_LABELS,
  buildGenerationJobs,
  countConfiguredQuestions,
  mergeGeneratedExams,
  normalizeContinuationRequest,
  normalizeTopicConfigs,
  runWithConcurrency
} = paperConfig;

const app = new Hono();
const TRIAL_EXHAUSTED_MESSAGE = '如需继续使用，请联系：赛博工头微信 aigongtou666';
const CONTINUATION_GRANT_INVALID_MESSAGE = '当前组卷会话已过期，请重新生成整卷后再追加题目';

app.post('/suggest-topics', async (c) => {
  try {
    const { version = '全版本融合课程体系', grade, subject, keyword, imageUrls = [] } = await c.req.json();
    if (!keyword) return c.json({ error: '请输入关键词' }, 400);
    if (!Array.isArray(imageUrls)) return c.json({ error: 'imageUrls 必须是数组' }, 400);
    const systemPrompt = `你是一位资深的${subject}教师，精通新课标与主流教材共性体系（当前采用：${version}）。
根据用户关键词生成 4-6 个符合${grade}认知水平、具体且可操作的知识点，按重要性排序。每行一个，不要编号或补充说明。`;
    const userPrompt = `课程体系：${version}\n年级：${grade}\n科目：${subject}\n关键词：${keyword}\n\n请生成知识点建议。`;
    const content = await generateContent(c.env, systemPrompt, userPrompt, { imageUrls });
    const topics = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^[\d\-*.、]+/.test(line))
      .slice(0, 6);
    return c.json({ topics });
  } catch (error) {
    console.error('生成知识点建议失败:', error.message);
    return c.json({ error: `生成失败：${error.message}` }, 500);
  }
});

app.post('/continue', async (c) => {
  let request;
  try {
    request = normalizeContinuationRequest(await c.req.json());
  } catch (error) {
    return c.json({ error: error.message, code: 'INVALID_CONTINUATION_REQUEST' }, 400);
  }

  try {
    const session = c.get('session');
    if (!await verifyPaperContinuationGrant(session, request.continuationToken, c.env)) {
      return c.json({
        error: CONTINUATION_GRANT_INVALID_MESSAGE,
        code: 'CONTINUATION_GRANT_INVALID',
        trialCreditsRemaining: getRemainingTrialCredits(session)
      }, 403);
    }

    const strictGenerator = createExamGenerator({
      invokeAI: (systemPrompt, userPrompt, options) => generateContent(c.env, systemPrompt, userPrompt, options),
      getMaxTokens: () => normalizeMaxTokens(c.env?.AI_MAX_TOKENS),
      logger: console,
      batchConcurrency: 1
    });
    const exam = await strictGenerator.generateExam({
      version: request.version,
      grade: request.grade,
      subject: request.subject,
      topics: request.job.topic,
      examPoints: request.job.examPoint,
      difficulty: request.job.difficulty,
      questionTypes: TYPE_LABELS[request.job.questionType],
      expectedQuestionType: request.job.questionType,
      questionCount: request.job.questionCount,
      difficultyPrompt: getDifficultyPrompt(request.job.difficulty, request.grade, request.subject),
      imageUrls: request.imageUrls
    });
    const merged = mergeGeneratedExams(
      [{ job: request.job, exam }],
      request.subject,
      request.examType,
      request.topicConfigs
    );
    merged.trialCreditsRemaining = getRemainingTrialCredits(session);
    merged.continuationToken = await issuePaperContinuationGrant(session, c.env);
    return c.json(merged);
  } catch (error) {
    console.error('继续生成3题失败:', error.message);
    return c.json({
      error: `继续生成失败：${error.message}`,
      code: error.code || 'EXAM_CONTINUATION_FAILED'
    }, 500);
  }
});

app.post('/generate', async (c) => {
  try {
    const body = await c.req.json();
    const {
      version = '全版本融合课程体系',
      grade,
      subject,
      examType = 'final',
      imageUrls = []
    } = body || {};
    if (!grade || !subject) return c.json({ error: '缺少必填参数: grade, subject' }, 400);
    if (!Array.isArray(imageUrls)) return c.json({ error: 'imageUrls 必须是数组' }, 400);

    let topicConfigs;
    try {
      topicConfigs = normalizeTopicConfigs(body || {});
    } catch (error) {
      return c.json({ error: error.message }, 400);
    }
    const totalQuestions = countConfiguredQuestions(topicConfigs);
    if (totalQuestions < 1 || totalQuestions > MAX_TOTAL_QUESTIONS) {
      return c.json({ error: `整张试卷题目总数需在 1-${MAX_TOTAL_QUESTIONS} 题之间` }, 400);
    }

    const session = c.get('session');
    const consumeResult = consumeTrialCredit(session);
    if (!consumeResult.allowed) {
      return c.json({
        error: TRIAL_EXHAUSTED_MESSAGE,
        code: 'TRIAL_CREDITS_EXHAUSTED',
        trialCreditsRemaining: 0
      }, 403);
    }
    await updateSessionCookie(c, session);

    const strictGenerator = createExamGenerator({
      invokeAI: (systemPrompt, userPrompt, options) => generateContent(c.env, systemPrompt, userPrompt, options),
      getMaxTokens: () => normalizeMaxTokens(c.env?.AI_MAX_TOKENS),
      logger: console,
      // 同一命题任务内批次串行，优先保证结构与内容质量。
      batchConcurrency: 1
    });
    const jobs = buildGenerationJobs(topicConfigs);
    const results = await runWithConcurrency(jobs, 2, async (job) => {
      const exam = await strictGenerator.generateExam({
        version,
        grade,
        subject,
        topics: job.topic,
        examPoints: job.examPoint,
        difficulty: job.difficulty,
        questionTypes: TYPE_LABELS[job.questionType],
        expectedQuestionType: job.questionType,
        questionCount: job.questionCount,
        difficultyPrompt: getDifficultyPrompt(job.difficulty, grade, subject),
        imageUrls
      });
      return { job, exam };
    });

    const merged = mergeGeneratedExams(results, subject, examType, topicConfigs);
    merged.trialCreditsRemaining = getRemainingTrialCredits(session);
    merged.continuationToken = await issuePaperContinuationGrant(session, c.env);
    await updateSessionCookie(c, session);
    return c.json(merged);
  } catch (error) {
    console.error('生成试卷失败:', error.message);
    return c.json({
      error: `生成失败：${error.message}`,
      code: error.code || 'EXAM_GENERATION_FAILED'
    }, 500);
  }
});

function normalizeMaxTokens(value) {
  const parsed = Number.parseInt(value || '8000', 10);
  return Number.isInteger(parsed) && parsed >= 256 ? Math.min(parsed, 32000) : 8000;
}

export { app as examRoutes };
