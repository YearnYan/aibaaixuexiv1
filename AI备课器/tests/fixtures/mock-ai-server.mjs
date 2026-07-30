import http from 'node:http';

const PORT = Number(process.env.MOCK_AI_PORT || 18999);

const plan = {
  optimizationSummary: '已根据对话增加跨学科公式示例和课堂评价。',
  title: '《二次函数的图像与性质》公式规范测试教案',
  standardsAlignment: {
    courseStandard: '通过函数图像理解变量关系，数学示例为 \\(y=ax^2+bx+c\\)。',
    coreLiteracy: '数学抽象、逻辑推理、数学建模',
    unitPosition: '从一次函数过渡到非线性函数模型。',
    lessonValue: '建立解析式、图像与实际情境之间的联系。'
  },
  learnerProfile: {
    priorKnowledge: ['会画直角坐标系和一次函数图像。'],
    learningGaps: ['容易把 \\(a\\) 的符号与开口方向割裂。'],
    misconceptions: ['误认为顶点横坐标始终为 \\(x=0\\)。'],
    differences: ['基础学生使用描点表，提升学生证明 \\(x=-\\frac{b}{2a}\\)。']
  },
  learningAnalysis: '学生能完成描点，但需要把图像特征与解析式 \\(y=a(x-h)^2+k\\) 建立对应关系。',
  goals: ['能指出 \\(y=a(x-h)^2+k\\) 的顶点、对称轴与开口方向。', '能比较参数变化并解释平移规律。', '能用函数模型解决真实问题。'],
  goalEvidence: [
    { goal: '识别图像特征', evidence: '图像标注单', successCriteria: '正确标出顶点 \\((h,k)\\) 和对称轴 \\(x=h\\)。' },
    { goal: '解释参数变化', evidence: '参数比较表', successCriteria: '能用图像证据解释 \\(a,h,k\\) 的作用。' },
    { goal: '完成模型应用', evidence: '情境解答', successCriteria: '列式、求解、检验和解释完整。' }
  ],
  focus: '重点：理解顶点式 \\(y=a(x-h)^2+k\\)。\n难点：从图像变化解释参数意义。',
  breakthroughStrategies: ['用同一坐标系比较三组函数。', '用物理公式 \\(\\vec{F}=m\\vec{a}\\) 示范量与符号的规范表达。'],
  preparation: ['教师：函数图像工具和任务单。', '学科符号校验：化学方程式 \\(\\ce{2H2 + O2 -> 2H2O}\\)。'],
  questionChain: [
    { question: '当 \\(a>0\\) 与 \\(a<0\\) 时图像有什么变化？', intent: '建立参数与开口方向的联系。', expectedResponse: '符号决定开口方向，绝对值影响开口大小。', followUp: '当 \\(|a|\\) 增大时为什么图像变窄？' },
    { question: '如何从 \\(y=2(x-1)^2-3\\) 直接读出顶点？', intent: '理解顶点式。', expectedResponse: '顶点为 \\((1,-3)\\)。', followUp: '对称轴怎样表示？' },
    { question: '为什么实际问题要检查定义域？', intent: '建立模型意识。', expectedResponse: '变量必须满足情境约束。', followUp: '结果不在定义域时怎样解释？' }
  ],
  questions: ['比较开口方向。', '读取顶点。', '检查定义域。'],
  practice: [
    { level: '基础层', text: '写出 \\(y=(x-2)^2+1\\) 的顶点和对称轴。', purpose: '巩固顶点式。', successCriteria: '顶点与对称轴均正确。', referenceAnswer: '顶点 \\((2,1)\\)，对称轴 \\(x=2\\)。' },
    { level: '提升层', text: '比较 \\(y=x^2\\) 与 \\(y=3x^2\\)。', purpose: '解释参数作用。', successCriteria: '包含图像证据。', referenceAnswer: '后者开口更窄。' },
    { level: '拓展层', text: '生物遗传示例：\\(\\mathrm{Aa}\\times\\mathrm{Aa}\\) 的分离比。', purpose: '检查跨学科上下标与字体。', successCriteria: '规范表达基因型。', referenceAnswer: '\\(1\\mathrm{AA}:2\\mathrm{Aa}:1\\mathrm{aa}\\)。' }
  ],
  homeworkDesign: [
    { level: '必做', task: '完成三道顶点式练习。', purpose: '巩固图像特征。', estimatedMinutes: 12, feedback: '按成功标准订正。' },
    { level: '选做', task: '地理坐标示例：标注 \\(30^\\circ\\mathrm{N},120^\\circ\\mathrm{E}\\)。', purpose: '检查角度和方向规范。', estimatedMinutes: 8, feedback: '课堂展示。' },
    { level: '挑战', task: '推导 \\(x=-\\frac{b}{2a}\\)。', purpose: '发展代数推理。', estimatedMinutes: 15, feedback: '教师批注关键步骤。' }
  ],
  homework: ['完成顶点式练习。'],
  blackboard: '二次函数\n\\[y=a(x-h)^2+k\\]\n顶点 \\((h,k)\\) · 对称轴 \\(x=h\\)',
  assessmentRubric: [
    { dimension: '图像识别', achieved: '准确读取顶点和对称轴。', developing: '需要提示。', evidence: '图像标注单。' },
    { dimension: '参数解释', achieved: '结合图像解释参数。', developing: '只能描述结果。', evidence: '比较表。' },
    { dimension: '模型应用', achieved: '完整检验并解释。', developing: '缺少情境解释。', evidence: '情境解答。' }
  ],
  evaluation: ['准确读取图像。', '解释参数作用。', '完成模型应用。'],
  observationPoints: ['是否能规范读写 \\(a,h,k\\)。', '是否主动检查定义域。', '是否用图像证据解释。'],
  contingencies: ['若描点超时，提供部分关键点。', '若公式混淆，回到图像逐项对应。'],
  reflection: ['公式和符号是否全部规范显示', '学生能否解释 \\(a,h,k\\) 的作用', '课堂时间是否合理', '下一课时如何改进'],
  flow: [
    { index: 1, name: '图像观察', taskGoal: '识别基本特征', context: '比较 \\(y=x^2\\) 与 \\(y=2x^2\\)', teacherAction: '展示图像并追问', studentAction: '观察并记录', learningProduct: '比较表', scaffold: '提供关键词', activity: '观察图像', design: '建立直观经验', evaluation: '检查证据', time: 10, tone: 'blue' },
    { index: 2, name: '参数探究', taskGoal: '解释参数作用', context: '探究 \\(y=a(x-h)^2+k\\)', teacherAction: '组织小组实验', studentAction: '改变参数并归纳', learningProduct: '参数规律表', scaffold: '提供变量控制表', activity: '参数实验', design: '建立数形联系', evaluation: '同伴互评', time: 20, tone: 'green' },
    { index: 3, name: '模型应用', taskGoal: '解决实际问题', context: '建立函数模型', teacherAction: '发布情境题', studentAction: '列式并检验', learningProduct: '完整解答', scaffold: '提供建模步骤', activity: '应用模型', design: '迁移方法', evaluation: '按量规评价', time: 15, tone: 'yellow' }
  ]
};

const svgBlackboardPlan = {
  ...plan,
  title: '《二次函数的图像与性质》SVG 板书回归教案',
  blackboard: String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" role="img">
    <rect width="800" height="450" fill="#173f34" rx="10" />
    <rect x="10" y="10" width="780" height="430" fill="none" stroke="#8d5b28" stroke-width="8" rx="6" />
    <text x="40" y="55" fill="#ffd700" font-size="24" font-weight="bold">跨学科符号与公式板书</text>
    <line x1="40" y1="72" x2="760" y2="72" stroke="#ffffff" stroke-width="2" />
    <text x="50" y="115" fill="#ffffff" font-size="18">数学：\(\sqrt{x-5} \ge 0 \Rightarrow x \ge 5\)</text>
    <text x="50" y="155" fill="#ffffff" font-size="18">物理：\(F_{\text{浮}}=\rho gV_{\text{排}}\)</text>
    <text x="50" y="195" fill="#ffffff" font-size="18">化学：\(\ce{CaCO3 -> CaO + CO2}\)</text>
    <text x="50" y="235" fill="#ffffff" font-size="18">生物：\(P_1=p^2+2pq\)</text>
    <text x="50" y="275" fill="#ffffff" font-size="18">地理：\(30^{\circ}N,120^{\circ}E\)</text>
    <path d="M430 390 Q520 275 610 390" fill="none" stroke="#4caf50" stroke-width="6" />
    <line x1="80" y1="360" x2="720" y2="360" stroke="#ffffff" stroke-width="2" />
    <line x1="520" y1="285" x2="520" y2="410" stroke="#ffffff" stroke-width="2" stroke-dasharray="6,6" />
  </svg>`
};

http.createServer((request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  const responsePlan = process.env.MOCK_AI_SVG === '1' ? svgBlackboardPlan : plan;
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responsePlan) } }] }));
}).listen(PORT, '127.0.0.1');
