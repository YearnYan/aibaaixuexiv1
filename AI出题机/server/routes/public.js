const express = require('express');
const router = express.Router();

const DIFFICULTY_NAMES = {
  1: '基础识记',
  2: '简单理解',
  3: '基础应用',
  4: '熟练应用',
  5: '综合应用',
  6: '灵活变通',
  7: '深度分析',
  8: '综合创新',
  9: '竞赛入门',
  10: '竞赛难题'
};

/**
 * GET /api/public/config
 * 返回前端展示层配置，不返回任何核心业务规则
 */
router.get('/config', (req, res) => {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isProduction = nodeEnv === 'production';

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    difficultyNames: DIFFICULTY_NAMES,
    antiInspect: {
      disableContextMenu: isProduction,
      disableDevtoolsShortcuts: isProduction
    }
  });
});

module.exports = router;
