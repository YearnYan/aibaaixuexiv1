const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// 缓存知识库数据
let unifiedKnowledgeCache = null;

function loadUnifiedKnowledgeBase() {
    if (unifiedKnowledgeCache) return unifiedKnowledgeCache;
    try {
        const filePath = path.join(__dirname, '../../docs/教材知识点', '全版本融合知识库.json');
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        unifiedKnowledgeCache = data;
        return data;
    } catch (e) {
        console.error('加载融合知识库失败:', e.message);
        return null;
    }
}

// 获取可用教材版本列表
router.get('/versions', (req, res) => {
    // 兼容旧前端接口：当前系统已切换为融合知识库
    res.json({ versions: ['全版本融合'] });
});

// 获取指定年级、科目的知识点（新格式：知识点-考点映射）
router.get('/topics', (req, res) => {
    const { grade, subject, includeExamPoints } = req.query;
    if (!grade || !subject) {
        return res.status(400).json({ error: '缺少参数: grade, subject' });
    }

    const data = loadUnifiedKnowledgeBase();
    if (!data) {
        return res.json({ topics: [] });
    }

    const gradeData = data[grade];
    if (!gradeData || !gradeData[subject]) {
        return res.json({ topics: [] });
    }

    const subjectData = gradeData[subject];
    const topicsData = subjectData['知识点'] || subjectData.topics || [];
    const shouldIncludeExamPoints = String(includeExamPoints || '').toLowerCase() === 'true';

    // 默认仅返回知识点名称，降低前端暴露业务知识图谱的风险
    if (!shouldIncludeExamPoints) {
        return res.json({
            topics: topicsData
                .map((topicItem) => {
                    if (typeof topicItem === 'string') {
                        return topicItem;
                    }
                    return topicItem?.name || '';
                })
                .filter(Boolean)
        });
    }

    // 返回新格式：每个知识点包含name和examPoints
    res.json({
        topics: topicsData
    });
});

// 获取指定知识点的考点（用于联动）
router.get('/exam-points', (req, res) => {
    const { grade, subject, topic } = req.query;
    if (!grade || !subject || !topic) {
        return res.status(400).json({ error: '缺少参数: grade, subject, topic' });
    }

    const data = loadUnifiedKnowledgeBase();
    if (!data) {
        return res.json({ examPoints: [] });
    }

    const gradeData = data[grade];
    if (!gradeData || !gradeData[subject]) {
        return res.json({ examPoints: [] });
    }

    const subjectData = gradeData[subject];
    const topicsData = subjectData['知识点'] || subjectData.topics || [];

    // 查找匹配的知识点
    const matchedTopic = topicsData.find(t => t.name === topic);

    res.json({
        examPoints: matchedTopic ? matchedTopic.examPoints : []
    });
});

// 获取题型知识库（支持按学段、科目、年级过滤）
router.get('/question-types', (req, res) => {
    const { grade, subject } = req.query;
    try {
        const filePath = path.join(__dirname, '../../docs/教材知识点/题型知识库.json');
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (!grade || !subject) {
            return res.json(data);
        }

        // 从年级名称推断学段和年级编号
        let stage = '', gradeNum = '';
        if (grade.startsWith('小学')) {
            stage = '小学';
            gradeNum = grade.replace('小学', '');
        } else if (grade.startsWith('初中')) {
            stage = '初中';
            gradeNum = grade.replace('初中', '');
        } else if (grade.startsWith('高中')) {
            stage = '高中';
            gradeNum = grade.replace('高中', '');
        }

        const stageData = data[stage];
        if (!stageData || !stageData[subject]) {
            // 兜底：返回通用题型
            return res.json({ questionTypes: getDefaultQuestionTypes(stage, subject) });
        }

        const subjectTypes = stageData[subject]['题型'] || [];
        // 按年级过滤
        const filtered = subjectTypes
            .filter(t => !t.grades || t.grades.includes(gradeNum))
            .map(t => t.name);

        if (filtered.length === 0) {
            return res.json({ questionTypes: getDefaultQuestionTypes(stage, subject) });
        }

        res.json({ questionTypes: filtered });
    } catch (e) {
        console.error('加载题型知识库失败:', e.message);
        res.json({ questionTypes: ['选择题', '填空题', '解答题'] });
    }
});

// 兜底题型方案
function getDefaultQuestionTypes(stage, subject) {
    const fallback = {
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

    return fallback?.[stage]?.[subject] || ['选择题', '填空题', '解答题'];
}

module.exports = router;
