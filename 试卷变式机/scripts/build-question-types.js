const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(
  PROJECT_ROOT,
  'docs',
  '教材知识点',
  '题型知识库.json'
);

const G1_TO_G6 = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
const G1_TO_G3 = ['一年级', '二年级', '三年级'];

const QUESTION_TYPES = {
  小学: {
    语文: {
      题型: [
        { name: '拼音辨析题', grades: ['一年级', '二年级'] },
        { name: '识字写字题', grades: G1_TO_G6 },
        { name: '词语运用题', grades: ['二年级', '三年级', '四年级', '五年级', '六年级'] },
        { name: '句子排序与仿写', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '古诗文默写', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '阅读理解', grades: ['二年级', '三年级', '四年级', '五年级', '六年级'] },
        { name: '非连续性文本阅读', grades: ['四年级', '五年级', '六年级'] },
        { name: '看图写话', grades: ['一年级', '二年级', '三年级'] },
        { name: '习作表达', grades: ['三年级', '四年级', '五年级', '六年级'] }
      ]
    },
    数学: {
      题型: [
        { name: '选择题', grades: ['二年级', '三年级', '四年级', '五年级', '六年级'] },
        { name: '填空题', grades: G1_TO_G6 },
        { name: '判断题', grades: G1_TO_G6 },
        { name: '计算题', grades: G1_TO_G6 },
        { name: '操作题', grades: ['一年级', '二年级', '三年级', '四年级'] },
        { name: '作图题', grades: ['二年级', '三年级', '四年级', '五年级', '六年级'] },
        { name: '应用题', grades: G1_TO_G6 },
        { name: '阅读理解应用题', grades: ['四年级', '五年级', '六年级'] }
      ]
    },
    英语: {
      题型: [
        { name: '听力题', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '词汇选择题', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '情景交际题', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '连词成句', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '阅读理解', grades: ['四年级', '五年级', '六年级'] },
        { name: '补全对话', grades: ['四年级', '五年级', '六年级'] },
        { name: '看图写句', grades: ['四年级', '五年级', '六年级'] }
      ]
    },
    物理: {
      题型: [
        { name: '科学启蒙选择题', grades: ['五年级', '六年级'] },
        { name: '观察记录题', grades: ['五年级', '六年级'] }
      ]
    },
    化学: {
      题型: [
        { name: '生活化学常识题', grades: ['五年级', '六年级'] },
        { name: '实验安全判断题', grades: ['五年级', '六年级'] }
      ]
    },
    生物: {
      题型: [
        { name: '生命现象观察题', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '识图判断题', grades: ['四年级', '五年级', '六年级'] }
      ]
    },
    地理: {
      题型: [
        { name: '地图认读题', grades: ['四年级', '五年级', '六年级'] },
        { name: '方位判断题', grades: ['三年级', '四年级', '五年级', '六年级'] }
      ]
    },
    历史: {
      题型: [
        { name: '历史常识选择题', grades: ['五年级', '六年级'] },
        { name: '时间排序题', grades: ['五年级', '六年级'] }
      ]
    },
    政治: {
      题型: [
        { name: '判断题', grades: G1_TO_G6 },
        { name: '选择题', grades: G1_TO_G6 },
        { name: '情境分析题', grades: ['三年级', '四年级', '五年级', '六年级'] },
        { name: '简答题', grades: ['四年级', '五年级', '六年级'] }
      ]
    }
  },
  初中: {
    语文: {
      题型: [
        { name: '基础知识选择题', grades: G1_TO_G3 },
        { name: '古诗文默写', grades: G1_TO_G3 },
        { name: '文言文阅读', grades: G1_TO_G3 },
        { name: '现代文阅读', grades: G1_TO_G3 },
        { name: '非连续性文本阅读', grades: G1_TO_G3 },
        { name: '名著阅读', grades: G1_TO_G3 },
        { name: '综合性学习', grades: G1_TO_G3 },
        { name: '作文', grades: G1_TO_G3 }
      ]
    },
    数学: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '填空题', grades: G1_TO_G3 },
        { name: '计算化简题', grades: G1_TO_G3 },
        { name: '解答题', grades: G1_TO_G3 },
        { name: '证明题', grades: ['二年级', '三年级'] },
        { name: '作图题', grades: G1_TO_G3 },
        { name: '实践应用题', grades: G1_TO_G3 },
        { name: '压轴综合题', grades: ['二年级', '三年级'] }
      ]
    },
    英语: {
      题型: [
        { name: '听力题', grades: G1_TO_G3 },
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '完形填空', grades: G1_TO_G3 },
        { name: '阅读理解', grades: G1_TO_G3 },
        { name: '还原句子/选句填空', grades: ['二年级', '三年级'] },
        { name: '语篇填空', grades: ['二年级', '三年级'] },
        { name: '补全对话', grades: G1_TO_G3 },
        { name: '书面表达', grades: G1_TO_G3 }
      ]
    },
    物理: {
      题型: [
        { name: '选择题', grades: ['二年级', '三年级'] },
        { name: '填空题', grades: ['二年级', '三年级'] },
        { name: '作图题', grades: ['二年级', '三年级'] },
        { name: '实验探究题', grades: ['二年级', '三年级'] },
        { name: '计算题', grades: ['二年级', '三年级'] },
        { name: '综合分析题', grades: ['三年级'] }
      ]
    },
    化学: {
      题型: [
        { name: '选择题', grades: ['三年级'] },
        { name: '填空题', grades: ['三年级'] },
        { name: '化学方程式书写题', grades: ['三年级'] },
        { name: '实验探究题', grades: ['三年级'] },
        { name: '推断题', grades: ['三年级'] },
        { name: '工艺流程题', grades: ['三年级'] },
        { name: '计算题', grades: ['三年级'] }
      ]
    },
    生物: {
      题型: [
        { name: '选择题', grades: ['一年级', '二年级'] },
        { name: '填空题', grades: ['一年级', '二年级'] },
        { name: '识图题', grades: ['一年级', '二年级'] },
        { name: '实验探究题', grades: ['一年级', '二年级'] },
        { name: '资料分析题', grades: ['二年级'] },
        { name: '简答题', grades: ['一年级', '二年级'] }
      ]
    },
    地理: {
      题型: [
        { name: '选择题', grades: ['一年级', '二年级'] },
        { name: '填空题', grades: ['一年级', '二年级'] },
        { name: '读图分析题', grades: ['一年级', '二年级'] },
        { name: '区域综合题', grades: ['二年级'] },
        { name: '简答题', grades: ['一年级', '二年级'] }
      ]
    },
    历史: {
      题型: [
        { name: '选择题', grades: G1_TO_G3 },
        { name: '材料解析题', grades: G1_TO_G3 },
        { name: '时序排序题', grades: G1_TO_G3 },
        { name: '史料实证题', grades: ['二年级', '三年级'] },
        { name: '小论文/论述题', grades: ['三年级'] }
      ]
    },
    政治: {
      题型: [
        { name: '选择题', grades: G1_TO_G3 },
        { name: '判断题', grades: ['一年级', '二年级'] },
        { name: '材料分析题', grades: G1_TO_G3 },
        { name: '辨析题', grades: ['二年级', '三年级'] },
        { name: '探究实践题', grades: G1_TO_G3 },
        { name: '综合论述题', grades: ['三年级'] }
      ]
    }
  },
  高中: {
    语文: {
      题型: [
        { name: '现代文阅读Ⅰ', grades: G1_TO_G3 },
        { name: '现代文阅读Ⅱ', grades: G1_TO_G3 },
        { name: '文言文阅读', grades: G1_TO_G3 },
        { name: '古代诗歌阅读', grades: G1_TO_G3 },
        { name: '名篇名句默写', grades: G1_TO_G3 },
        { name: '语言文字运用', grades: G1_TO_G3 },
        { name: '作文', grades: G1_TO_G3 }
      ]
    },
    数学: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '多项选择题', grades: G1_TO_G3 },
        { name: '填空题', grades: G1_TO_G3 },
        { name: '解答题', grades: G1_TO_G3 },
        { name: '选考题（参数方程与极坐标）', grades: ['三年级'] },
        { name: '选考题（不等式选讲）', grades: ['三年级'] }
      ]
    },
    英语: {
      题型: [
        { name: '听力题', grades: G1_TO_G3 },
        { name: '阅读理解', grades: G1_TO_G3 },
        { name: '七选五', grades: G1_TO_G3 },
        { name: '完形填空', grades: G1_TO_G3 },
        { name: '语法填空', grades: G1_TO_G3 },
        { name: '应用文写作', grades: G1_TO_G3 },
        { name: '读后续写', grades: ['二年级', '三年级'] },
        { name: '短文改错（旧高考省份）', grades: ['三年级'] }
      ]
    },
    物理: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '多项选择题', grades: G1_TO_G3 },
        { name: '实验题', grades: G1_TO_G3 },
        { name: '计算题', grades: G1_TO_G3 },
        { name: '选考综合题', grades: ['三年级'] },
        { name: '压轴综合题', grades: ['三年级'] }
      ]
    },
    化学: {
      题型: [
        { name: '选择题', grades: G1_TO_G3 },
        { name: '填空题', grades: G1_TO_G3 },
        { name: '工艺流程题', grades: G1_TO_G3 },
        { name: '实验综合题', grades: G1_TO_G3 },
        { name: '反应原理综合题', grades: ['二年级', '三年级'] },
        { name: '有机推断题', grades: ['二年级', '三年级'] },
        { name: '计算题', grades: ['二年级', '三年级'] }
      ]
    },
    生物: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '多项选择题', grades: G1_TO_G3 },
        { name: '填空题', grades: G1_TO_G3 },
        { name: '实验探究题', grades: G1_TO_G3 },
        { name: '遗传分析题', grades: ['二年级', '三年级'] },
        { name: '稳态与生态综合题', grades: ['二年级', '三年级'] }
      ]
    },
    历史: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '材料分析题', grades: G1_TO_G3 },
        { name: '开放论证题', grades: ['二年级', '三年级'] },
        { name: '历史小论文', grades: ['三年级'] }
      ]
    },
    地理: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '多项选择题', grades: ['二年级', '三年级'] },
        { name: '读图分析题', grades: G1_TO_G3 },
        { name: '区域综合题', grades: G1_TO_G3 },
        { name: '人地关系论证题', grades: ['三年级'] }
      ]
    },
    政治: {
      题型: [
        { name: '单项选择题', grades: G1_TO_G3 },
        { name: '多项选择题', grades: ['二年级', '三年级'] },
        { name: '材料分析题', grades: G1_TO_G3 },
        { name: '辨析题', grades: ['二年级', '三年级'] },
        { name: '探究与实践题', grades: G1_TO_G3 },
        { name: '综合论述题', grades: ['三年级'] }
      ]
    }
  }
};

function main() {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(QUESTION_TYPES, null, 2), 'utf8');
  console.log(`[题型知识库已生成] ${OUTPUT_FILE}`);
}

main();
