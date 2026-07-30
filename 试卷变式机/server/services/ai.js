// AI服务模块 - 使用 OpenAI SDK 兼容接口
const { AI_CONFIG } = require('../config/ai');
const { withClient } = require('./ai-key-pool');
const {
  FIGURE_OUTPUT_RULE,
  normalizeExamFigures,
  repairExamFigureIntegrity,
  assertExamFigureIntegrity,
} = require('../../shared/figure-integrity');
const {
  FORMULA_OUTPUT_RULE,
  parseAcademicJson,
  normalizeExamAcademicContent,
  repairExamAcademicContent,
  assertAcademicContentIntegrity,
} = require('../../shared/academic-content');

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || part.type !== 'text') return '';
      if (typeof part.text === 'string') return part.text;
      return part.text?.value || '';
    })
    .join('')
    .trim();
}

function buildUserMessageContent(userPrompt, options = {}) {
  const text = String(userPrompt || '').trim();
  const imageUrls = Array.isArray(options.imageUrls) ? options.imageUrls : [];

  if (!imageUrls.length) {
    return text;
  }

  const content = [];
  if (text) {
    content.push({ type: 'text', text });
  }

  for (const imageUrl of imageUrls) {
    if (!imageUrl || typeof imageUrl !== 'string') continue;
    content.push({
      type: 'image_url',
      image_url: { url: imageUrl }
    });
  }

  return content.length ? content : text;
}

/**
 * 调用 OpenAI SDK 生成内容（兼容图文输入）
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userPrompt - 用户提示词
 * @param {object} options - 可选配置
 * @returns {Promise<string>} AI生成的文本内容
 */
async function generateContent(systemPrompt, userPrompt, options = {}) {
  try {
    if (!AI_CONFIG.configured) {
      throw new Error('AI 接口尚未配置，请先在艾爸AI学习的 AI 配置后台完成设置');
    }
    const model = options.model || AI_CONFIG.model;
    const completion = await withClient((aiClient) => {
      return aiClient.chat.completions.create({
        model,
        temperature: options.temperature ?? AI_CONFIG.temperature,
        max_tokens: options.maxTokens || AI_CONFIG.maxTokens,
        messages: [
          { role: 'system', content: String(systemPrompt || '') },
          { role: 'user', content: buildUserMessageContent(userPrompt, options) }
        ]
      });
    });

    const text = extractTextContent(completion?.choices?.[0]?.message?.content);
    if (!text) {
      throw new Error('API返回空内容');
    }

    return text;
  } catch (error) {
    const status = error?.status || error?.response?.status;
    const reason = error?.error?.message || error?.message || '未知错误';
    if (status) {
      console.error(`AI API调用失败: ${status} ${reason}`);
      throw new Error(`AI生成失败: API返回 ${status} - ${reason}`);
    }

    console.error('AI API调用失败:', reason);
    throw new Error(`AI生成失败: ${reason}`);
  }
}

/**
 * 生成知识点建议
 * @param {object} params - 参数对象
 * @returns {Promise<Array<string>>} 知识点建议列表
 */
async function generateTopicSuggestions({
  version = '全版本融合课程体系',
  grade,
  subject,
  keyword,
  imageUrls = []
}) {
  const systemPrompt = `你是一位资深的${subject}教师，精通新课标与主流教材共性体系（当前采用：${version}）。
你的任务是根据用户输入的关键词，生成相关的知识点建议。

要求：
1. 生成4-6个相关知识点
2. 知识点要符合${grade}的学习水平
3. 知识点要具体、可操作
4. 按照重要性排序
5. 直接返回知识点列表，每行一个，不要编号`;

  const userPrompt = `课程体系：${version}
年级：${grade}
科目：${subject}
关键词：${keyword}

请生成相关的知识点建议：`;

  const content = await generateContent(systemPrompt, userPrompt, { imageUrls });

  // 解析返回的知识点列表
  const topics = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.match(/^[\d\-\*\.]+/)) // 过滤空行和编号
    .slice(0, 6); // 最多6个

  return topics;
}

/**
 * 生成试卷
 * @param {object} params - 试卷参数
 * @returns {Promise<object>} 试卷对象
 */
async function generateExam(params) {
  const {
    version = '全版本融合课程体系',
    grade,
    subject,
    topics,
    examPoints,
    difficulty,
    questionCount,
    questionTypes,
    difficultyPrompt,
    imageUrls = []
  } = params;

  const systemPrompt = `你是一位资深的${subject}教师，精通新课标与主流教材共性体系（当前采用：${version}）及试卷命题。

你的任务是生成一份高质量的${subject}试卷。

# 难度要求
${difficultyPrompt}

# 学科符号和公式格式要求（极其重要，必须严格遵守）
${FORMULA_OUTPUT_RULE}

# 图形要求（极其重要，必须严格遵守）

## 必须添加图形的情况（强制要求）：
1. **题干中明确提到图形**：
   - 包含"如图"、"图中"、"如图所示"、"下图"等字样
   - 包含"画出"、"作图"、"绘制"、"画图"等要求

2. **题目类型天然需要图形**：
   - 几何题：三角形、圆、多边形、立体图形等
   - 函数图像题：需要坐标系和函数曲线
   - 物理图：电路图、受力分析图、光路图、运动轨迹图
   - 化学图：分子结构图、实验装置图、化学反应图
   - 地理题：地图、示意图
   - 生物题：细胞结构图、器官图

## 可选添加图形的情况（辅助理解）：
- 复杂的数学关系（可用数轴、韦恩图、示意图辅助）
- 物理运动过程（可用轨迹图辅助）
- 数据关系（可用表格、柱状图辅助）

## 不需要图形的情况：
- 纯计算题（如：计算 $2+3=$）
- 纯概念题（如：什么是...？请解释...）
- 纯文字理解题
- 简单的代数运算

## 图形格式：
对于需要图形的题目，在figure字段中用纯文字描述图形内容。
${FIGURE_OUTPUT_RULE}
不要使用LaTeX/TikZ代码，只需要详细的文字描述。

figure字段示例：
{
  "figure": {
    "type": "图形类型（geometry/function/circuit/molecule/coordinate等）",
    "description": "详细的图形描述，必须具体到每个元素的位置、大小、关系、标注"
  }
}

图形类型参考：
- 数学：geometry(几何)、function(函数)、coordinate(坐标系)、numberline(数轴)、venn(韦恩图)
- 物理：force(受力)、circuit(电路)、optics(光路)、motion(运动)
- 化学：molecule(分子)、experiment(实验)、reaction(反应)
- 通用：table(表格)、flowchart(流程)、diagram(示意图)

**重要：只在真正需要图形时才添加figure字段，不要为了凑数而强加图形。**

# 思维链推导要求（极其重要——必须遵守）

你必须对每道题采用"先解题，后出题"的工作方法：
1. 先构思题干——明确已知条件和求解目标
2. 亲自完整解一遍这道题——逐步写出每一步计算过程和中间结果
3. 确认你的计算结果无误后，将其作为正确答案填入answer字段
4. 设计干扰选项（选择题）——分别模拟"符号搞错"、"公式记错"、"计算粗心"等常见错误，推导出每个错误选项的数值
5. 解析直接来源于你第2步的解题过程，不要另外编造

**你必须先在JSON之前输出每道题的推导验算过程（纯文本即可），然后再输出最终JSON。**
系统会自动提取JSON部分，推导过程不会展示给用户，但你必须写出来以确保答案正确。

# 输出格式要求
请严格按照以下JSON格式输出（推导过程之后），不要添加任何markdown标记或其他文字：

{
  "title": "试卷标题",
  "questions": [
    {
      "type": "choice",
      "title": "一、选择题（每题X分，共XX分）",
      "items": [
        {
          "index": 1,
          "stem": "已知函数 \\\\(f(x)=\\\\frac{x^2-1}{x+1}\\\\)，则 \\\\(\\\\lim_{x\\\\to-1}f(x)\\\\) 的值为（    ）",
          "options": [
            "A. \\\\(-2\\\\)",
            "B. \\\\(0\\\\)",
            "C. \\\\(1\\\\)",
            "D. 不存在"
          ],
          "answer": "A",
          "explanation": "化简得 \\\\(f(x)=\\\\frac{(x+1)(x-1)}{x+1}=x-1\\\\ (x\\\\ne-1)\\\\)，所以 \\\\(\\\\lim_{x\\\\to-1}f(x)=-2\\\\)。",
          "figure": { "type": "function", "description": "平面直角坐标系，x轴范围-3到3，y轴范围-4到4，画出函数图像；图像为直线，在坐标(-1,-2)处用空心圆标记间断点" }
        }
      ]
    },
    {
      "type": "fill",
      "title": "二、填空题（每空X分，共XX分）",
      "items": [
        {
          "index": 7,
          "stem": "若 \\\\(\\\\sin\\\\alpha+\\\\cos\\\\alpha=\\\\frac12\\\\)，则 \\\\(\\\\sin\\\\alpha\\\\cos\\\\alpha=\\\\underline{\\\\qquad}\\\\)",
          "answer": "\\\\(-\\\\frac38\\\\)",
          "explanation": "由 \\\\((\\\\sin\\\\alpha+\\\\cos\\\\alpha)^2=1+2\\\\sin\\\\alpha\\\\cos\\\\alpha=\\\\frac14\\\\)，得 \\\\(\\\\sin\\\\alpha\\\\cos\\\\alpha=-\\\\frac38\\\\)。"
        }
      ]
    },
    {
      "type": "calculation",
      "title": "三、计算题/解答题（每题X分，共XX分）",
      "items": [
        {
          "index": 11,
          "stem": "如图所示，在平面直角坐标系中，已知点 \\\\(A(1,2)\\\\)、\\\\(B(3,4)\\\\)，求线段 \\\\(AB\\\\) 的中点坐标和长度。",
          "answer": "中点坐标为 \\\\((2,3)\\\\)，长度为 \\\\(2\\\\sqrt2\\\\)",
          "explanation": "由中点公式得 \\\\(M(\\\\frac{1+3}{2},\\\\frac{2+4}{2})=(2,3)\\\\)；由距离公式得 \\\\(|AB|=\\\\sqrt{(3-1)^2+(4-2)^2}=2\\\\sqrt2\\\\)。",
          "figure": { "type": "coordinate", "description": "平面直角坐标系，x轴和y轴范围0到5，标注原点O，画出点A(1,2)和点B(3,4)，用实心圆标记，标注坐标，连接AB形成线段" }
        }
      ]
    }
  ],
  "answers": [
    "1. A 解析：\\\\(f(x)=x-1\\\\ (x\\\\ne-1)\\\\)，所以 \\\\(\\\\lim_{x\\\\to-1}f(x)=-2\\\\)。",
    "7. \\\\(-\\\\frac38\\\\) 解析：由恒等式计算可得 \\\\(\\\\sin\\\\alpha\\\\cos\\\\alpha=-\\\\frac38\\\\)。"
  ]
}

# 重要提示
1. 题目要符合${grade}学生的认知水平
2. 题目要有梯度，由易到难
3. 答案要准确、完整
4. 计算题要有详细的解题步骤
5. 只输出JSON，不要有其他内容
6. 如果题干中出现"如图"、"图中"等字样，该题必须有figure字段
7. 不需要图形的题目，不要添加figure字段（设为null或不写）
8. 学科符号和公式必须遵守上面的规范 LaTeX / mhchem 规则

# 【强制自检清单——你必须在生成每道题后逐项检查，不通过则必须修正后再输出】

1. **计算验证**：将题目中的所有数值代入公式，逐步手动验算，确认最终答案与你的验算结果完全一致。如果不一致，必须修正答案或修正题目数据。
2. **选项唯一正确**：选择题的4个选项必须有且仅有1个正确答案。你必须将正确答案代入题目条件进行验证，同时将每个错误选项也代入验证确认它们确实不满足条件。
3. **选项互斥且合理**：4个选项之间不能有语义重复或包含关系；错误选项必须是学生常见错误思路可能得到的结果，不能是明显荒谬的数值。
4. **单位完整一致**：题干、选项、答案、解析中涉及的所有物理量必须标注正确单位，且单位前后一致（不能题干用m，答案用cm却不说明）。
5. **数据自洽**：题干中给出的所有已知条件必须在解析中被使用，解析中引用的数据必须在题干中出现过，不能凭空出现新数据，也不能有题干给了但解析没用的多余数据。
6. **解析完整正确**：解析必须包含从已知条件到最终答案的完整推导链条，每一步变换都有依据（公式名称或定理名称），不能跳步。解析的最终结果必须与answer字段完全一致。
7. **题图一致**：如果题目包含figure字段，figure.description中描述的图形内容必须与题干完全匹配（图中的数值、标注、几何关系必须和题干一致）。
8. **科学常数准确**：所有物理常数（g≈9.8m/s²或10m/s²需明确）、化学方程式（必须配平）、数学公式（必须正确）不得出错。
9. **文字规范**：不得出现乱码、不完整的句子、缺字漏字、语病，所有题目必须语句通顺。
10. **难度匹配**：题目的实际解题复杂度必须匹配指定的难度等级，不能偏难或偏易。

# 【常见错误示例——严禁出现以下任何一种问题】

❌ **答案计算错误**：题目"物体从10m高处自由下落(g=10m/s²)，求落地时间"，正确应为t=√(2×10/10)=√2≈1.41s，但答案错写为"1.0s"或"2.0s"
❌ **答案与解析不一致**：解析推导出结果为-3/8，但answer字段写成了3/8（漏掉负号）
❌ **选项重复**：A选项和C选项表述相同含义，或数值完全相同
❌ **数据矛盾**：题目说"三角形三边长分别为3、4、8"，但3+4<8不能构成三角形
❌ **条件不足**：题目要求"求三角形面积"，但只给了一条边长，没给高或其他边角关系
❌ **单位遗漏**：速度写成"v=10"而不是"v=10m/s"，面积答案写"12"而不是"12cm²"
❌ **公式错误**：使用错误公式如"三角形面积=底×高"（漏掉÷2）
❌ **化学方程式未配平**：写出"H₂+O₂→H₂O"（未配平，正确应为2H₂+O₂→2H₂O）
❌ **解析跳步**：解析中从"由题意可知"直接跳到最终答案，没有中间推导过程
❌ **题干引用不存在的图**：题干写了"如图所示"但没有提供figure字段`;

  const topicsText = Array.isArray(topics) ? topics.join('、') : topics;
  const examPointsText = Array.isArray(examPoints) ? examPoints.join('、') : examPoints;

  // ======= 分批生成逻辑 =======
  const BATCH_SIZE = 5;
  const totalCount = questionCount || 15;
  const batchSizes = [];
  let remaining = totalCount;
  while (remaining > 0) {
    batchSizes.push(Math.min(BATCH_SIZE, remaining));
    remaining -= BATCH_SIZE;
  }

  console.log(`[分批生成] 总${totalCount}题，分${batchSizes.length}批: [${batchSizes.join(', ')}]`);

  // 预计算每批起始题号
  const batchStartIndexes = [];
  let cumIdx = 1;
  for (const size of batchSizes) {
    batchStartIndexes.push(cumIdx);
    cumIdx += size;
  }

  // 所有批次并行生成
  const batchPromises = batchSizes.map((batchSize, b) => {
    const startIdx = batchStartIndexes[b];

    const batchUserPrompt = `请生成${batchSize}道高质量试题（题号从第${startIdx}题开始编号）：

课程体系：${version}
年级：${grade}
科目：${subject}
知识点：${topicsText}
考点：${examPointsText}
难度等级：${difficulty}/10
题目数量：${batchSize}
题型要求：${questionTypes || '包含选择题、填空题、解答题'}

**核心要求：先推导验算，再输出JSON**
1. 对每道题，先写出完整的解题推导过程（纯文本）
2. 确认推导结果正确后，再将题目写入JSON
3. JSON中的answer和explanation必须与你的推导结果完全一致

**其他要求：**
- 图形要求：几何/函数/电路等题必须有figure字段；纯计算/概念题不要figure
- 公式格式：${FORMULA_OUTPUT_RULE}
- 分数、根式、向量、方程组、单位、化学式等必须写成可由前端渲染的规范 LaTeX / mhchem
- 题目要符合${grade}学生的认知水平
- 每道题生成后必须执行强制自检清单的全部10项检查

请先写出每道题的推导验算过程，然后输出JSON：`;

    console.log(`[分批生成] 第${b + 1}/${batchSizes.length}批并行启动，生成${batchSize}题...`);

    return generateContent(systemPrompt, batchUserPrompt, {
      maxTokens: 4000,
      temperature: 0.4,
      imageUrls
    }).then(content => {
      const batchExam = parseAIJson(content);
      const items = [];
      for (const group of (batchExam.questions || [])) {
        for (const item of (group.items || [])) {
          items.push({ type: group.type, item });
        }
      }
      console.log(`[分批生成] 第${b + 1}批完成，${items.length}题`);
      return items;
    }).catch(err => {
      console.error(`[分批生成] 第${b + 1}批失败:`, err.message);
      return []; // 单批失败不阻塞
    });
  });

  const batchResults = await Promise.all(batchPromises);
  const allItems = batchResults.flat();

  if (allItems.length === 0) {
    throw new Error('所有批次生成均失败，请重试');
  }

  // 合并所有批次为标准试卷结构
  let exam = buildExamFromItems(allItems, subject);
  console.log(`[分批生成] 合并完成，共${allItems.length}题`);

    // AI二次审核：对生成的题目进行质量审核和修正
    try {
      console.log('[AI审核] 开始二次审核...');
      exam = await reviewExam(exam, { grade, subject });
      console.log('[AI审核] 审核修正完成');
    } catch (reviewError) {
      // 审核失败不阻塞，使用原始生成结果
      console.warn('[AI审核] 审核失败，使用原始结果:', reviewError.message);
    }

    // 题图完整性修复：只对引用了视觉材料但缺少精准描述的题目发起定向修复。
    const figureIntegrity = await repairExamFigureIntegrity(exam, {
      requestRepair: async ({ systemPrompt: repairSystemPrompt, userPrompt: repairUserPrompt, maxTokens }) => {
        const repairContent = await generateContent(repairSystemPrompt, repairUserPrompt, {
          maxTokens,
          temperature: 0.15,
        });
        return parseAIJson(repairContent);
      },
      context: { subject, grade, difficulty },
      maxAttempts: 2,
    });
    const academicIntegrity = await repairExamAcademicContent(exam, {
      requestRepair: async ({ systemPrompt: repairSystemPrompt, userPrompt: repairUserPrompt, maxTokens }) => {
        const repairContent = await generateContent(repairSystemPrompt, repairUserPrompt, {
          maxTokens,
          temperature: 0,
        });
        return parseAIJson(repairContent);
      },
      context: { subject, grade },
      maxAttempts: 2,
    });
    if (academicIntegrity.fallbackPaths.length > 0) {
      console.warn('[AI公式] 定点返修未完全收敛，已安全移除孤立定界符:', academicIntegrity.fallbackPaths.join('、'));
    }
    assertAcademicContentIntegrity(exam);

    // 后处理：智能图形一致性检查
    postProcessFigures(exam);

    // 添加元数据
    exam.metadata = {
      version,
      grade,
      subject,
      topics: topicsText,
      examPoints: examPointsText,
      difficulty,
      figureIntegrityIssueCount: figureIntegrity.initialIssueCount,
      figureRepairedIndexes: figureIntegrity.repairedIndexes,
      academicIntegrityIssueCount: academicIntegrity.initialIssueCount,
      academicRepairedPaths: academicIntegrity.repairedPaths,
      academicFallbackPaths: academicIntegrity.fallbackPaths,
      generatedAt: new Date().toISOString()
    };

    return exam;
}

/**
 * AI二次审核：对生成的试卷进行质量审核和修正
 * @param {object} exam - 生成的试卷对象
 * @param {object} context - 上下文信息（grade, subject）
 * @returns {Promise<object>} 修正后的试卷对象
 */
async function reviewExam(exam, { grade, subject }) {
  const reviewSystemPrompt = `你是一位严格的${subject}试卷审核专家，专门负责检查和修正AI生成的试题中的错误。

你的唯一任务是：逐题审核以下试卷，找出并修正所有错误，确保每道题的题干、选项、答案、解析都100%准确。

# 审核流程（每道题必须执行）

1.【计算验证】将题目中的数值代入相关公式，从头到尾重新计算一遍，验证答案是否正确。如果你算出的结果与原答案不同，以你的计算结果为准进行修正。

2.【逻辑检查】检查题干条件是否自洽：
   - 给出的数据能否构成合理的题目（如三角形三边是否满足三角不等式）
   - 已知条件是否充分（能否唯一确定答案）
   - 是否存在数据矛盾

3.【选项检查】（仅选择题）
   - 将正确答案代入题目条件验证——确认它确实正确
   - 将每个错误选项也代入验证——确认它们确实错误
   - 检查选项之间是否有重复或包含关系

4.【答案与解析一致性】
   - 解析的最终结论是否与answer字段完全一致（包括正负号、单位、精度）
   - 解析的推导过程是否有跳步或错误

5.【单位与规范】
   - 所有物理量是否带有正确单位且前后一致
   - 化学方程式是否配平
   - 数学公式和定理是否正确引用

6.【题图一致】
   - 如果有figure字段，其description是否与题干匹配
   - 题干提到"如图"但没有figure的，移除"如图"字样

# 学科符号和公式格式要求
${FORMULA_OUTPUT_RULE}

# 输出要求
- 直接输出修正后的完整试卷JSON，格式与输入完全相同
- 对于没有问题的题目，原样保留，不要改动
- 对于有问题的题目，直接在原结构上修正
- 同时修正answers数组中对应的内容
- 只输出JSON，不要有任何其他文字、解释或markdown标记`;

  const reviewUserPrompt = `请严格审核以下${grade}${subject}试卷，逐题验算并修正所有错误：

${JSON.stringify(exam, null, 2)}

请输出修正后的完整试卷JSON：`;

  const reviewContent = await generateContent(reviewSystemPrompt, reviewUserPrompt, {
    maxTokens: 8000,
    temperature: 0.1
  });

  // 解析审核结果（复用parseAIJson）
  const reviewedExam = parseAIJson(reviewContent);

  // 验证审核结果结构完整性
  if (!reviewedExam.questions || !Array.isArray(reviewedExam.questions)) {
    throw new Error('审核结果缺少questions数组');
  }

  return reviewedExam;
}

/**
 * 从AI输出中提取并解析JSON（跳过思维链推导文本）
 */
function parseAIJson(content) {
  return parseAcademicJson(content);
}

/**
 * 将扁平题目列表构建为标准试卷结构
 */
function buildExamFromItems(allItems, subject) {
  const typeOrder = ['choice', 'fill', 'calculation'];
  const typeNames = { choice: '选择题', fill: '填空题', calculation: '计算题/解答题' };
  const typeLabels = ['一', '二', '三', '四', '五'];

  const groups = {};
  for (const { type, item } of allItems) {
    const t = typeOrder.includes(type) ? type : 'calculation';
    if (!groups[t]) groups[t] = [];
    groups[t].push(item);
  }

  const questions = [];
  const answers = [];
  let idx = 1;
  let groupIdx = 0;

  for (const type of typeOrder) {
    if (!groups[type] || groups[type].length === 0) continue;
    const items = groups[type];
    const label = typeLabels[groupIdx] || `${groupIdx + 1}`;

    for (const item of items) {
      item.index = idx;
      answers.push(`${idx}. ${item.answer || ''} 解析：${item.explanation || ''}`);
      idx++;
    }

    questions.push({
      type,
      title: `${label}、${typeNames[type] || type}`,
      items
    });
    groupIdx++;
  }

  return { title: `${subject}试卷`, questions, answers };
}

/**
 * 后处理：统一规范化题图并断言所有视觉引用都可独立还原。
 */
function postProcessFigures(exam) {
  normalizeExamFigures(exam);
  assertExamFigureIntegrity(exam);
}

module.exports = {
  generateContent,
  generateTopicSuggestions,
  generateExam
};
