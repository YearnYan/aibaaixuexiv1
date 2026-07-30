import { Hono } from 'hono';

const DIFFICULTY_NAMES = {
  1: '基础识记', 2: '简单理解', 3: '基础应用', 4: '熟练应用',
  5: '综合应用', 6: '灵活变通', 7: '深度分析', 8: '综合创新',
  9: '竞赛入门', 10: '竞赛难题'
};

const app = new Hono();

app.get('/config', (c) => {
  const isProduction = (c.env.NODE_ENV || '').toLowerCase() === 'production';
  c.header('Cache-Control', 'no-store');
  return c.json({
    difficultyNames: DIFFICULTY_NAMES,
    antiInspect: {
      disableContextMenu: isProduction,
      disableDevtoolsShortcuts: isProduction
    }
  });
});

export { app as publicRoutes };
