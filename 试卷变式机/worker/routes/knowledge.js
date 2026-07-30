import { Hono } from 'hono';
import knowledgeData from '../../docs/教材知识点/全版本融合知识库.json';
import questionTypesData from '../../docs/教材知识点/题型知识库.json';

const app = new Hono();

app.get('/versions', (c) => {
  return c.json({ versions: ['全版本融合'] });
});

app.get('/topics', (c) => {
  const { grade, subject, includeExamPoints } = c.req.query();
  if (!grade || !subject) {
    return c.json({ error: '缺少参数: grade, subject' }, 400);
  }

  const gradeData = knowledgeData[grade];
  if (!gradeData || !gradeData[subject]) {
    return c.json({ topics: [] });
  }

  const subjectData = gradeData[subject];
  const topicsData = subjectData['知识点'] || subjectData.topics || [];
  const shouldInclude = String(includeExamPoints || '').toLowerCase() === 'true';

  if (!shouldInclude) {
    return c.json({
      topics: topicsData
        .map(item => typeof item === 'string' ? item : item?.name || '')
        .filter(Boolean)
    });
  }

  return c.json({ topics: topicsData });
});

app.get('/exam-points', (c) => {
  const { grade, subject, topic } = c.req.query();
  if (!grade || !subject || !topic) {
    return c.json({ error: '缺少参数: grade, subject, topic' }, 400);
  }

  const gradeData = knowledgeData[grade];
  if (!gradeData || !gradeData[subject]) {
    return c.json({ examPoints: [] });
  }

  const subjectData = gradeData[subject];
  const topicsData = subjectData['知识点'] || subjectData.topics || [];
  const matched = topicsData.find(t => t.name === topic);

  return c.json({ examPoints: matched ? matched.examPoints : [] });
});

const DEFAULT_QUESTION_TYPES = {
  小学: {
    语文: ['识字写字题', '阅读理解', '习作表达'],
    数学: ['填空题', '计算题', '应用题'],
    英语: ['词汇选择题', '阅读理解', '情景交际题'],
    物理: ['科学启蒙选择题', '观察记录题'],
    化学: ['生活化学常识题', '实验安全判断题'],
    生物: ['生命现象观察题', '识图判断题'],
    地理: ['地图认读题', '方位判断题'],
    历史: ['历史常识选择题', '时间排序题'],
    政治: ['判断题', '情境分析题']
  },
  初中: {
    语文: ['文言文阅读', '现代文阅读', '作文'],
    数学: ['单项选择题', '填空题', '解答题'],
    英语: ['听力题', '阅读理解', '书面表达'],
    物理: ['选择题', '实验探究题', '计算题'],
    化学: ['选择题', '实验探究题', '推断题'],
    生物: ['选择题', '识图题', '实验探究题'],
    地理: ['选择题', '读图分析题', '简答题'],
    历史: ['选择题', '材料解析题', '小论文/论述题'],
    政治: ['选择题', '材料分析题', '探究实践题']
  },
  高中: {
    语文: ['现代文阅读Ⅰ', '古代诗歌阅读', '作文'],
    数学: ['单项选择题', '填空题', '解答题'],
    英语: ['阅读理解', '语法填空', '应用文写作'],
    物理: ['单项选择题', '实验题', '计算题'],
    化学: ['选择题', '工艺流程题', '实验综合题'],
    生物: ['单项选择题', '实验探究题', '稳态与生态综合题'],
    地理: ['单项选择题', '读图分析题', '区域综合题'],
    历史: ['单项选择题', '材料分析题', '开放论证题'],
    政治: ['单项选择题', '材料分析题', '综合论述题']
  }
};

app.get('/question-types', (c) => {
  const { grade, subject } = c.req.query();

  if (!grade || !subject) {
    return c.json(questionTypesData);
  }

  let stage = '', gradeNum = '';
  if (grade.startsWith('小学')) { stage = '小学'; gradeNum = grade.replace('小学', ''); }
  else if (grade.startsWith('初中')) { stage = '初中'; gradeNum = grade.replace('初中', ''); }
  else if (grade.startsWith('高中')) { stage = '高中'; gradeNum = grade.replace('高中', ''); }

  const stageData = questionTypesData[stage];
  if (!stageData || !stageData[subject]) {
    return c.json({ questionTypes: DEFAULT_QUESTION_TYPES?.[stage]?.[subject] || ['选择题', '填空题', '解答题'] });
  }

  const subjectTypes = stageData[subject]['题型'] || [];
  const filtered = subjectTypes
    .filter(t => !t.grades || t.grades.includes(gradeNum))
    .map(t => t.name);

  if (filtered.length === 0) {
    return c.json({ questionTypes: DEFAULT_QUESTION_TYPES?.[stage]?.[subject] || ['选择题', '填空题', '解答题'] });
  }

  return c.json({ questionTypes: filtered });
});

export { app as knowledgeRoutes };
