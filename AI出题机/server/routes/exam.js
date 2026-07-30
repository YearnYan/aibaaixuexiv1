const express = require('express');
const { generateTopicSuggestions, generateExam } = require('../services/ai');
const { getDifficultyPrompt } = require('../prompts/difficulty-levels');
const {
  consumeTrialCredit,
  getRemainingTrialCredits,
  issuePaperContinuationGrant,
  verifyPaperContinuationGrant
} = require('../middleware/security');
const {
  MAX_TOTAL_QUESTIONS,
  TYPE_LABELS,
  buildGenerationJobs,
  countConfiguredQuestions,
  mergeGeneratedExams,
  normalizeContinuationRequest,
  normalizeTopicConfigs,
  runWithConcurrency
} = require('../../shared/exam-paper-config');

const router = express.Router();
const TRIAL_EXHAUSTED_MESSAGE = '如需继续使用，请联系：赛博工头微信 aigongtou666';
const CONTINUATION_GRANT_INVALID_MESSAGE = '当前组卷会话已过期，请重新生成整卷后再追加题目';

router.post('/suggest-topics', async (req, res) => {
  try {
    const { version, grade, subject, keyword, imageUrls = [] } = req.body || {};
    if (!keyword) return res.status(400).json({ error: '请输入关键词' });
    if (!Array.isArray(imageUrls)) return res.status(400).json({ error: 'imageUrls 必须是数组' });
    const topics = await generateTopicSuggestions({ version, grade, subject, keyword, imageUrls });
    return res.json({ topics });
  } catch (error) {
    console.error('生成知识点建议失败:', error.message);
    return res.status(500).json({ error: `生成失败：${error.message}` });
  }
});

router.post('/continue', async (req, res) => {
  let request;
  try {
    request = normalizeContinuationRequest(req.body || {});
  } catch (error) {
    return res.status(400).json({ error: error.message, code: 'INVALID_CONTINUATION_REQUEST' });
  }

  try {
    const session = req.securitySession;
    if (!verifyPaperContinuationGrant(session, request.continuationToken)) {
      return res.status(403).json({
        error: CONTINUATION_GRANT_INVALID_MESSAGE,
        code: 'CONTINUATION_GRANT_INVALID',
        trialCreditsRemaining: getRemainingTrialCredits(session)
      });
    }

    const exam = await generateExam({
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
    merged.continuationToken = issuePaperContinuationGrant(session);
    return res.json(merged);
  } catch (error) {
    console.error('继续生成3题失败:', error.message);
    return res.status(500).json({
      error: `继续生成失败：${error.message}`,
      code: error.code || 'EXAM_CONTINUATION_FAILED'
    });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const {
      version = '全版本融合课程体系',
      grade,
      subject,
      examType = 'final',
      imageUrls = []
    } = req.body || {};
    if (!grade || !subject) return res.status(400).json({ error: '缺少必填参数: grade, subject' });
    if (!Array.isArray(imageUrls)) return res.status(400).json({ error: 'imageUrls 必须是数组' });

    let topicConfigs;
    try {
      topicConfigs = normalizeTopicConfigs(req.body || {});
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const totalQuestions = countConfiguredQuestions(topicConfigs);
    if (totalQuestions < 1 || totalQuestions > MAX_TOTAL_QUESTIONS) {
      return res.status(400).json({ error: `整张试卷题目总数需在 1-${MAX_TOTAL_QUESTIONS} 题之间` });
    }

    const session = req.securitySession;
    const consumeResult = consumeTrialCredit(session);
    if (!consumeResult.allowed) {
      return res.status(403).json({
        error: TRIAL_EXHAUSTED_MESSAGE,
        code: 'TRIAL_CREDITS_EXHAUSTED',
        trialCreditsRemaining: 0
      });
    }

    const jobs = buildGenerationJobs(topicConfigs);
    console.log(`[AI] 严格多知识点组卷：${grade}${subject}，${topicConfigs.length} 个知识点，${jobs.length} 个任务，共 ${totalQuestions} 题`);
    // 最多并行两个独立命题任务；过高并发会增加供应商漏掉强制工具调用的概率。
    const results = await runWithConcurrency(jobs, 2, async (job) => {
      const exam = await generateExam({
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
    merged.continuationToken = issuePaperContinuationGrant(session);
    return res.json(merged);
  } catch (error) {
    console.error('生成试卷失败:', error.message);
    return res.status(500).json({
      error: `生成失败：${error.message}`,
      code: error.code || 'EXAM_GENERATION_FAILED'
    });
  }
});

module.exports = router;
