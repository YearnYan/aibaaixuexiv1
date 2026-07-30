const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const KNOWLEDGE_DIR = path.join(PROJECT_ROOT, 'docs', '教材知识点');
const OUTPUT_FILE = path.join(KNOWLEDGE_DIR, '全版本融合知识库.json');

const ALLOWED_SUBJECTS = new Set([
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '地理',
  '历史',
  '政治'
]);

const GRADE_ORDER = [
  '小学一年级',
  '小学二年级',
  '小学三年级',
  '小学四年级',
  '小学五年级',
  '小学六年级',
  '初中一年级',
  '初中二年级',
  '初中三年级',
  '高中一年级',
  '高中二年级',
  '高中三年级'
];

const SUBJECT_ORDER = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '地理',
  '历史',
  '政治'
];

const MANUAL_ADDITIONS = {
  小学一年级: {
    语文: [
      {
        name: '看图识字与句式扩展',
        examPoints: ['图文对应识字', '用“谁在做什么”组织完整句']
      }
    ],
    数学: [
      {
        name: '生活情境中的数感建立',
        examPoints: ['数量比较与估计', '生活场景列式']
      }
    ]
  },
  小学二年级: {
    语文: [
      {
        name: '句子仿写与表达完整性',
        examPoints: ['关键词仿写', '语序正确与句意连贯']
      }
    ],
    数学: [
      {
        name: '乘除法情境建模',
        examPoints: ['一步乘除应用题', '图示到算式转换']
      }
    ]
  },
  小学三年级: {
    英语: [
      {
        name: '基础语块与情境对话',
        examPoints: ['日常问答匹配', '情境补全句子']
      }
    ]
  },
  小学四年级: {
    英语: [
      {
        name: '读图写句与简单语篇',
        examPoints: ['看图写句', '关键信息提取']
      }
    ]
  },
  小学五年级: {
    英语: [
      {
        name: '语法基础迁移（时态与人称）',
        examPoints: ['一般现在时与一般过去时区分', '人称代词正确使用']
      }
    ]
  },
  小学六年级: {
    语文: [
      {
        name: '小升初衔接阅读策略',
        examPoints: ['段落主旨提炼', '关键信息定位']
      }
    ],
    数学: [
      {
        name: '综合应用题分步求解',
        examPoints: ['条件转化', '多步列式与检验']
      }
    ],
    英语: [
      {
        name: '语篇阅读与写作衔接',
        examPoints: ['阅读后信息整合', '短文写作结构']
      }
    ]
  },
  初中一年级: {
    语文: [
      {
        name: '非连续性文本阅读（图表与短文整合）',
        examPoints: ['图文信息对照', '关键信息筛选与概括']
      },
      {
        name: '古诗文比较阅读',
        examPoints: ['意象与情感比较', '关键字词含义迁移']
      }
    ],
    数学: [
      {
        name: '数轴与绝对值综合',
        examPoints: ['数轴表示与比较', '绝对值化简与分类讨论']
      },
      {
        name: '一元一次方程应用建模',
        examPoints: ['实际问题设未知数', '方程求解与结果解释']
      }
    ],
    英语: [
      {
        name: '一般现在时语境运用',
        examPoints: ['主谓一致', '频度副词位置']
      },
      {
        name: '任务型阅读信息匹配',
        examPoints: ['细节定位', '同义替换识别']
      }
    ],
    生物: [
      {
        name: '细胞结构与功能辨析',
        examPoints: ['动植物细胞比较', '结构与功能对应']
      },
      {
        name: '显微镜规范操作',
        examPoints: ['对光与调焦步骤', '实验现象记录']
      }
    ],
    地理: [
      {
        name: '经纬网定位与时区估算',
        examPoints: ['经纬度判读', '地方时与区时换算']
      },
      {
        name: '地形图判读与比例尺',
        examPoints: ['等高线分析', '比例尺与距离计算']
      }
    ],
    历史: [
      {
        name: '古代文明时空框架',
        examPoints: ['朝代时序梳理', '文明特征比较']
      },
      {
        name: '史料实证入门',
        examPoints: ['材料信息提取', '史料与结论对应']
      }
    ],
    政治: [
      {
        name: '规则意识与法治观念',
        examPoints: ['规则与自由关系', '依法办事情境判断']
      },
      {
        name: '集体生活与责任担当',
        examPoints: ['集体规则冲突处理', '责任认知与行动方案']
      }
    ]
  },
  初中二年级: {
    语文: [
      {
        name: '说明文阅读（说明方法与顺序）',
        examPoints: ['说明方法作用分析', '说明顺序判断']
      },
      {
        name: '文言实词虚词迁移运用',
        examPoints: ['一词多义', '句式与翻译']
      }
    ],
    数学: [
      {
        name: '一次函数图像性质综合',
        examPoints: ['图像信息读取', '函数关系与实际问题']
      },
      {
        name: '全等三角形证明策略',
        examPoints: ['判定定理选用', '规范书写证明过程']
      }
    ],
    英语: [
      {
        name: '现在完成时语境运用',
        examPoints: ['for/since搭配', '过去与现在联系表达']
      },
      {
        name: '语篇填空上下文推断',
        examPoints: ['逻辑衔接词识别', '词性与语义匹配']
      }
    ],
    物理: [
      {
        name: '机械效率实验与误差分析',
        examPoints: ['实验变量控制', '误差来源判断']
      },
      {
        name: '光学作图与成像规律',
        examPoints: ['平面镜与透镜作图', '像距焦距关系']
      }
    ],
    生物: [
      {
        name: '遗传与变异基础',
        examPoints: ['性状与基因关系', '遗传现象解释']
      },
      {
        name: '生态系统能量流动',
        examPoints: ['食物链食物网分析', '生态平衡判断']
      }
    ],
    地理: [
      {
        name: '中国区域地理综合判读',
        examPoints: ['区域特征归纳', '自然与人文因素分析']
      },
      {
        name: '气候类型判读',
        examPoints: ['气温降水图识别', '气候成因分析']
      }
    ],
    历史: [
      {
        name: '近代化探索比较',
        examPoints: ['改革路径比较', '历史影响评价']
      },
      {
        name: '世界近代史阶段特征',
        examPoints: ['重要事件时序', '因果链条分析']
      }
    ],
    政治: [
      {
        name: '宪法与公民权利义务',
        examPoints: ['权利义务统一', '法治案例分析']
      },
      {
        name: '公共参与与社会责任',
        examPoints: ['社会热点观点表达', '解决方案设计']
      }
    ]
  },
  初中三年级: {
    语文: [
      {
        name: '议论文论证方法辨析',
        examPoints: ['论点论据关系', '论证思路梳理']
      },
      {
        name: '综合性学习任务群',
        examPoints: ['信息整合表达', '应用文写作规范']
      }
    ],
    数学: [
      {
        name: '二次函数最值与图像变换',
        examPoints: ['顶点法求最值', '平移伸缩变换']
      },
      {
        name: '圆与相似综合压轴',
        examPoints: ['几何模型构建', '多结论推导']
      }
    ],
    英语: [
      {
        name: '读写结合与提纲写作',
        examPoints: ['审题立意', '段落衔接与句式提升']
      },
      {
        name: '完形填空逻辑链分析',
        examPoints: ['语篇主线把握', '上下文语义推断']
      }
    ],
    物理: [
      {
        name: '电学综合计算与电路故障',
        examPoints: ['串并联综合计算', '故障诊断推理']
      },
      {
        name: '力学综合实验设计',
        examPoints: ['实验方案优化', '数据处理与结论表达']
      }
    ],
    化学: [
      {
        name: '工艺流程题信息提取',
        examPoints: ['流程节点分析', '条件控制与产率判断']
      },
      {
        name: '离子共存与推断综合',
        examPoints: ['离子反应判断', '定性定量推断']
      }
    ],
    历史: [
      {
        name: '近现代史材料综合',
        examPoints: ['多材料比较', '历史结论论证']
      },
      {
        name: '开放性历史小论文',
        examPoints: ['观点-史实-论证结构', '时空观念应用']
      }
    ],
    政治: [
      {
        name: '时政材料观点提炼',
        examPoints: ['政策理解', '观点归纳与表达']
      },
      {
        name: '跨单元综合探究',
        examPoints: ['多知识点迁移', '问题解决方案']
      }
    ]
  },
  高中一年级: {
    语文: [
      {
        name: '信息类文本多文本比较',
        examPoints: ['观点异同辨析', '论证链条还原']
      },
      {
        name: '古代诗歌意象与情感链',
        examPoints: ['意象作用分析', '情感变化概括']
      }
    ],
    数学: [
      {
        name: '函数零点与二分法',
        examPoints: ['零点存在性判断', '二分法迭代求近似值']
      },
      {
        name: '三角函数图像变换',
        examPoints: ['周期振幅相位分析', '图像与解析式互化']
      }
    ],
    英语: [
      {
        name: '七选五篇章结构',
        examPoints: ['段落主题句匹配', '逻辑连接词推断']
      },
      {
        name: '应用文写作审题与格式',
        examPoints: ['任务点覆盖', '语域与格式规范']
      }
    ],
    物理: [
      {
        name: '牛顿运动定律多过程问题',
        examPoints: ['受力分析与运动过程分段', '临界条件求解']
      },
      {
        name: '运动图像综合分析',
        examPoints: ['v-t与x-t图像判读', '图像面积斜率物理意义']
      }
    ],
    化学: [
      {
        name: '元素周期律综合应用',
        examPoints: ['位置-结构-性质关联', '周期表推断题']
      },
      {
        name: '离子反应方程式正误判断',
        examPoints: ['守恒检验', '反应条件判定']
      }
    ],
    生物: [
      {
        name: '分子与细胞实验设计',
        examPoints: ['对照实验设计', '变量控制与结果解释']
      },
      {
        name: '光合作用与呼吸作用曲线',
        examPoints: ['曲线识读', '环境因素影响分析']
      }
    ],
    地理: [
      {
        name: '地球运动综合判读',
        examPoints: ['昼夜长短变化', '正午太阳高度计算']
      },
      {
        name: '大气环流与气候成因',
        examPoints: ['环流模式识别', '气候分布解释']
      }
    ],
    历史: [
      {
        name: '中外历史纲要比较阅读',
        examPoints: ['阶段特征比较', '历史脉络构建']
      },
      {
        name: '史料解释与历史论证',
        examPoints: ['材料证据提炼', '观点论证完整性']
      }
    ],
    政治: [
      {
        name: '经济生活图表解读',
        examPoints: ['图表信息提取', '经济逻辑表达']
      },
      {
        name: '哲学原理情境迁移',
        examPoints: ['原理匹配', '方法论应用']
      }
    ]
  },
  高中二年级: {
    语文: [
      {
        name: '论述类文本论证链分析',
        examPoints: ['论证结构拆解', '论证有效性判断']
      },
      {
        name: '文言文断句与翻译',
        examPoints: ['实词虚词语法功能', '重点句式翻译']
      }
    ],
    数学: [
      {
        name: '空间向量与立体几何',
        examPoints: ['空间关系证明', '夹角与距离计算']
      },
      {
        name: '导数单调性与最值',
        examPoints: ['导数符号分析', '函数最值求解']
      }
    ],
    英语: [
      {
        name: '语法填空词性转换',
        examPoints: ['构词法应用', '句法结构判断']
      },
      {
        name: '读后续写情节衔接',
        examPoints: ['情节延展逻辑', '语言连贯与细节描写']
      }
    ],
    物理: [
      {
        name: '电磁感应综合',
        examPoints: ['法拉第定律应用', '图像与电路联合分析']
      },
      {
        name: '实验数据处理与不确定度',
        examPoints: ['数据拟合', '误差与不确定度表达']
      }
    ],
    化学: [
      {
        name: '化学平衡图像综合',
        examPoints: ['平衡移动判断', '图像信息反推条件']
      },
      {
        name: '电化学综合应用',
        examPoints: ['原电池与电解池判定', '电极反应书写']
      }
    ],
    生物: [
      {
        name: '遗传概率与系谱图',
        examPoints: ['遗传方式判断', '概率计算']
      },
      {
        name: '生态系统稳定性分析',
        examPoints: ['反馈调节机制', '生态恢复策略']
      }
    ],
    地理: [
      {
        name: '人文地理区位分析',
        examPoints: ['区位因素评价', '产业布局判断']
      },
      {
        name: '统计图表综合',
        examPoints: ['多图联判', '数据趋势解释']
      }
    ],
    历史: [
      {
        name: '近现代国际关系专题',
        examPoints: ['事件关联分析', '国际格局演变']
      },
      {
        name: '史料比较与观点论证',
        examPoints: ['异源史料比对', '论证严密性']
      }
    ],
    政治: [
      {
        name: '法律与逻辑专题应用',
        examPoints: ['案例法理分析', '逻辑谬误识别']
      },
      {
        name: '材料论证题分层作答',
        examPoints: ['观点分层', '理论-材料-结论闭环']
      }
    ]
  },
  高中三年级: {
    语文: [
      {
        name: '任务驱动作文结构化表达',
        examPoints: ['任务约束识别', '论证结构与语言提升']
      },
      {
        name: '文学类文本深度鉴赏',
        examPoints: ['叙事艺术分析', '主题意蕴阐释']
      }
    ],
    数学: [
      {
        name: '圆锥曲线与导数综合',
        examPoints: ['参数化处理', '最值与范围证明']
      },
      {
        name: '概率统计建模',
        examPoints: ['分布模型选择', '统计推断与决策']
      }
    ],
    英语: [
      {
        name: '高考读后续写高级表达',
        examPoints: ['场景化词块', '复杂句与衔接手段']
      },
      {
        name: '续写逻辑与人物弧光',
        examPoints: ['情节推进', '人物动机一致性']
      }
    ],
    物理: [
      {
        name: '选考模块综合题',
        examPoints: ['多模块联动建模', '分步求解策略']
      },
      {
        name: '压轴计算多模型耦合',
        examPoints: ['临界极值分析', '过程分段与近似处理']
      }
    ],
    化学: [
      {
        name: '有机推断与合成路线',
        examPoints: ['官能团转化', '反应路径设计']
      },
      {
        name: '工艺流程与陌生方程式',
        examPoints: ['流程信息整合', '陌生反应方程式书写']
      }
    ],
    生物: [
      {
        name: '稳态与调节综合',
        examPoints: ['神经-体液-免疫联动', '稳态失衡解释']
      },
      {
        name: '实验探究开放题',
        examPoints: ['方案设计', '结果预测与反思']
      }
    ],
    地理: [
      {
        name: '区域可持续发展评价',
        examPoints: ['资源环境约束分析', '政策方案设计']
      },
      {
        name: '综合题多维度作答',
        examPoints: ['自然-经济-社会联动', '分层表达']
      }
    ],
    历史: [
      {
        name: '史论结合开放性问答',
        examPoints: ['史实支撑观点', '多角度论证']
      },
      {
        name: '历史小论文结构化论证',
        examPoints: ['论题确立', '论据组织与结论提升']
      }
    ],
    政治: [
      {
        name: '时政热点与理论对接',
        examPoints: ['热点归类', '理论条目精准匹配']
      },
      {
        name: '探究题多角度论证',
        examPoints: ['经济政治文化生态综合', '方案可行性分析']
      }
    ]
  }
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTopicName(name) {
  return normalizeText(name).replace(/[，。；：！、]+$/g, '');
}

function normalizeSubject(subject) {
  const name = normalizeText(subject);
  if (name === '道德与法治') return '政治';
  return name;
}

function ensureTopicContainer(container, grade, subject, topicName) {
  if (!container[grade]) container[grade] = {};
  if (!container[grade][subject]) container[grade][subject] = {};
  if (!container[grade][subject][topicName]) {
    container[grade][subject][topicName] = {
      name: topicName,
      examPoints: new Set()
    };
  }
  return container[grade][subject][topicName];
}

function mergeFromVersionFile(container, filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const topKeys = Object.keys(raw);
  const root = topKeys.length === 1 ? raw[topKeys[0]] : raw;

  for (const [grade, subjectMap] of Object.entries(root || {})) {
    for (const [subjectRaw, subjectData] of Object.entries(subjectMap || {})) {
      const subject = normalizeSubject(subjectRaw);
      if (!ALLOWED_SUBJECTS.has(subject)) continue;

      const topics = subjectData?.知识点 || subjectData?.topics || [];
      for (const topicItem of topics) {
        const topicName = normalizeTopicName(
          typeof topicItem === 'string' ? topicItem : topicItem?.name
        );
        if (!topicName) continue;

        const holder = ensureTopicContainer(container, grade, subject, topicName);
        const examPoints = Array.isArray(topicItem?.examPoints)
          ? topicItem.examPoints
          : [];
        for (const point of examPoints) {
          const normalizedPoint = normalizeText(point);
          if (normalizedPoint) holder.examPoints.add(normalizedPoint);
        }
      }
    }
  }
}

function applyManualAdditions(container) {
  for (const [grade, subjectMap] of Object.entries(MANUAL_ADDITIONS)) {
    for (const [subject, additions] of Object.entries(subjectMap || {})) {
      if (!ALLOWED_SUBJECTS.has(subject)) continue;
      for (const item of additions) {
        const topicName = normalizeTopicName(item.name);
        if (!topicName) continue;
        const holder = ensureTopicContainer(container, grade, subject, topicName);
        for (const point of item.examPoints || []) {
          const normalizedPoint = normalizeText(point);
          if (normalizedPoint) holder.examPoints.add(normalizedPoint);
        }
      }
    }
  }
}

function toOutputJson(container) {
  const output = {};

  const sortedGrades = Object.keys(container).sort((a, b) => {
    const ai = GRADE_ORDER.indexOf(a);
    const bi = GRADE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'zh-CN');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  for (const grade of sortedGrades) {
    output[grade] = {};
    const subjectMap = container[grade];
    const sortedSubjects = Object.keys(subjectMap).sort((a, b) => {
      const ai = SUBJECT_ORDER.indexOf(a);
      const bi = SUBJECT_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b, 'zh-CN');
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    for (const subject of sortedSubjects) {
      const topics = Object.values(subjectMap[subject]).map((topic) => {
        const examPoints = Array.from(topic.examPoints)
          .map((p) => normalizeText(p))
          .filter(Boolean);
        examPoints.sort((x, y) => x.localeCompare(y, 'zh-CN'));
        return {
          name: topic.name,
          examPoints
        };
      });

      topics.sort((x, y) => x.name.localeCompare(y.name, 'zh-CN'));

      output[grade][subject] = {
        知识点: topics
      };
    }
  }

  return output;
}

function printSummary(output) {
  let subjectCount = 0;
  let topicCount = 0;
  let examPointCount = 0;

  for (const grade of Object.keys(output)) {
    for (const subject of Object.keys(output[grade])) {
      subjectCount += 1;
      const topics = output[grade][subject]?.知识点 || [];
      topicCount += topics.length;
      for (const topic of topics) {
        examPointCount += (topic.examPoints || []).length;
      }
    }
  }

  console.log(`[融合完成] 年级: ${Object.keys(output).length}`);
  console.log(`[融合完成] 年级-科目组合: ${subjectCount}`);
  console.log(`[融合完成] 知识点总数: ${topicCount}`);
  console.log(`[融合完成] 考点总数: ${examPointCount}`);
  console.log(`[输出文件] ${OUTPUT_FILE}`);
}

function main() {
  const sourceFiles = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter(
      (fileName) =>
        fileName.endsWith('.json') &&
        fileName.includes('版') &&
        !fileName.includes('题型')
    );

  if (sourceFiles.length === 0) {
    throw new Error('未找到可融合的教材版本知识库文件');
  }

  const merged = {};
  for (const sourceFile of sourceFiles) {
    const filePath = path.join(KNOWLEDGE_DIR, sourceFile);
    mergeFromVersionFile(merged, filePath);
  }

  applyManualAdditions(merged);

  const output = toOutputJson(merged);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  printSummary(output);
}

main();
