const express = require('express');
const router = express.Router();
const { generateTopicSuggestions, generateExam } = require('../services/ai');
const { extractUploadedExamFiles } = require('../services/uploaded-exam-files');
const { generateVariantExamFromUpload } = require('../services/uploaded-exam-variant');
const { getDifficultyPrompt } = require('../prompts/difficulty-levels');
const { consumeTrialCredit, getRemainingTrialCredits } = require('../middleware/security');

const EXAM_TYPE_NAMES = {
  quiz: '随堂小测', unit: '单元测试',
  midterm: '期中考试', final: '期末考试', mock: '模拟考试'
};
const TRIAL_EXHAUSTED_MESSAGE = '如需继续使用，请联系：赛博工头微信 aigongtou666';

function clampLevel(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(10, parsed));
}

/**
 * POST /api/exam/suggest-topics
 * AI生成知识点建议
 */
router.post('/suggest-topics', async (req, res) => {
  try {
    const { version, grade, subject, keyword, imageUrls = [] } = req.body;
    if (!keyword) {
      return res.status(400).json({ error: '请输入关键词' });
    }
    if (!Array.isArray(imageUrls)) {
      return res.status(400).json({ error: 'imageUrls 必须是数组' });
    }

    console.log(`[AI] 生成知识点建议: ${version} ${grade} ${subject} "${keyword}"`);
    const topics = await generateTopicSuggestions({ version, grade, subject, keyword, imageUrls });
    res.json({ topics });
  } catch (error) {
    console.error('生成知识点建议失败:', error.message);
    res.status(500).json({ error: '生成失败: ' + error.message });
  }
});

/**
 * POST /api/exam/generate
 * AI生成试卷题目
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      version = '全版本融合课程体系',
      grade,
      subject,
      topic,
      examPoint,
      difficulty = 8,
      examType = 'final',
      questionTypes = [],
      questionCount = 10,
      imageUrls = []
    } = req.body;

    if (!grade || !subject || !topic) {
      return res.status(400).json({ error: '缺少必填参数: grade, subject, topic' });
    }
    if (!Array.isArray(imageUrls)) {
      return res.status(400).json({ error: 'imageUrls 必须是数组' });
    }

    // 每次点击“生成题目”扣减1体验积分
    const session = req.securitySession;
    const consumeResult = consumeTrialCredit(session);
    if (!consumeResult.allowed) {
      return res.status(403).json({
        error: TRIAL_EXHAUSTED_MESSAGE,
        code: 'TRIAL_CREDITS_EXHAUSTED',
        trialCreditsRemaining: 0
      });
    }

    const safeQuestionCount = Math.max(1, Math.min(30, parseInt(questionCount) || 15));

    const difficultyPrompt = getDifficultyPrompt(
      parseInt(difficulty), grade, subject
    );

    // 构建题型描述
    let questionTypesDesc = EXAM_TYPE_NAMES[examType] || '考试';
    if (questionTypes && questionTypes.length > 0) {
      questionTypesDesc += `，包含以下题型：${questionTypes.join('、')}`;
    }

    console.log(`[AI] 生成试卷: ${version} ${grade} ${subject} "${topic}" 难度${difficulty} 题型[${questionTypes.join(',')}] 数量${safeQuestionCount}`);

    const exam = await generateExam({
      version,
      grade,
      subject,
      topics: topic,
      examPoints: examPoint || topic,
      difficulty: parseInt(difficulty),
      questionTypes: questionTypesDesc,
      questionCount: safeQuestionCount,
      difficultyPrompt,
      imageUrls
    });

    exam.trialCreditsRemaining = getRemainingTrialCredits(session);

    res.json(exam);
  } catch (error) {
    console.error('生成试卷失败:', error.message);
    res.status(500).json({ error: '生成失败: ' + error.message });
  }
});

/**
 * POST /api/exam/generate-from-upload
 * 上传完整原卷，解析后生成逐题对应的变式试卷
 */
router.post('/generate-from-upload', async (req, res) => {
  try {
    const {
      files = [],
      variantDifficulty = 8,
      variationCoefficient = 6
    } = req.body || {};
    const safeVariantDifficulty = clampLevel(variantDifficulty, 8);
    const safeVariationCoefficient = clampLevel(variationCoefficient, 6);

    const session = req.securitySession;
    const consumeResult = consumeTrialCredit(session);
    if (!consumeResult.allowed) {
      return res.status(403).json({
        error: TRIAL_EXHAUSTED_MESSAGE,
        code: 'TRIAL_CREDITS_EXHAUSTED',
        trialCreditsRemaining: 0
      });
    }

    const extracted = await extractUploadedExamFiles(files);
    console.log(`[AI] 上传原卷变式出卷: 文件${extracted.sources.length}个，视觉输入${extracted.imageUrls.length}张，难度${safeVariantDifficulty}，变式系数${safeVariationCoefficient}`);

    const exam = await generateVariantExamFromUpload({
      ...extracted,
      variantDifficulty: safeVariantDifficulty,
      variationCoefficient: safeVariationCoefficient
    });
    exam.trialCreditsRemaining = getRemainingTrialCredits(session);

    res.json(exam);
  } catch (error) {
    console.error('上传原卷变式出卷失败:', error.message);
    const status = /请至少上传|不支持文件|超过|为空|没有读取/.test(error.message) ? 400 : 500;
    res.status(status).json({ error: '生成失败: ' + error.message });
  }
});

module.exports = router;
