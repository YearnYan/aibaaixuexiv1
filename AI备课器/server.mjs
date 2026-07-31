import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { parseModelJson } from './model-json.mjs';
import { normalizeLessonDocument } from './src/lessonDocument.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(ROOT, 'build');
const SUBSITE_NAV_FILE = join(ROOT, 'aiba-subsite-nav.js');
const SUBSITE_THEME_FILE = join(ROOT, 'aiba-brand.css');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json; charset=utf-8' };

const defaultPlan = {
  title: '《春》第一课时备课方案',
  standardsAlignment: {
    courseStandard: '依据义务教育语文课程标准关于第四学段阅读与鉴赏的要求，组织朗读、梳理、品味与表达活动；具体课标条目需由教师结合教材版本复核。',
    coreLiteracy: '语言运用、思维能力、审美创造、文化自信',
    unitPosition: '本课位于写景抒情类文本学习单元，承担建立“抓景物—品语言—悟情感”阅读路径的任务。',
    lessonValue: '第一课时重点完成整体感知、结构梳理和典型语言品析，为后续深入理解写景方法与情感表达奠定基础。'
  },
  learnerProfile: {
    priorKnowledge: ['能借助注释解决基础字词。', '有简单的写景文本阅读经验。'],
    learningGaps: ['赏析常停留在“生动形象”，缺少具体语言证据。', '容易割裂景物描写与作者情感。'],
    misconceptions: ['认为修辞名称就是赏析结论。', '概括结构时容易按自然段机械切分。'],
    differences: ['基础学生需要赏析句式支架，提升学生需要完成方法迁移和表达优化。']
  },
  learningAnalysis: '七年级学生对春景有丰富生活经验，也能完成基础字词和内容概括，但赏析往往停留在感受层面，缺少“词句证据—表达效果—情感指向”的完整推理。教学需通过示范批注、同伴交流和分层支架，让学生形成可迁移的写景散文阅读方法。',
  goals: ['能用“盼春—绘春—赞春”概括文章结构，并说出主要春景。', '能从动词、修辞或感官描写中选择一个角度，结合词句说明表达效果。', '能在 80 字左右的春景片段中运用至少一种本课学习的写景方法。'],
  goalEvidence: [
    { goal: '概括文章结构与主要春景', evidence: '结构图或三个小标题', successCriteria: '层次完整、顺序合理，能覆盖主要内容。' },
    { goal: '结合词句赏析语言', evidence: '一则“证据—方法—效果—情感”批注', successCriteria: '引用准确，至少说清一种表达方法及其作用。' },
    { goal: '迁移写景方法完成表达', evidence: '80 字春景片段', successCriteria: '至少使用一种课堂所学方法，描写具体且语句通顺。' }
  ],
  focus: '重点：品味多感官描写与修辞表达。\n难点：体会语言背后的情感，并迁移到自己的表达中。',
  breakthroughStrategies: ['用“写了什么—怎么写—产生什么效果—表达什么情感”四步批注支架化解赏析空泛。', '采用教师示范、同伴共评、独立迁移的渐进任务，帮助学生把阅读方法转化为表达能力。'],
  preparation: ['教师：准备课文朗读音频、春景图片与课堂任务单。', '学生：预习课文，圈画生字词和最有画面感的句子。', '资源：教材、学习单、投屏课件与随堂练习。'],
  questionChain: [
    { question: '作者依次写了哪些春景？这些内容为什么按这样的顺序安排？', intent: '检查整体感知与结构思维。', expectedResponse: '能概括春草、春花、春风、春雨、迎春等内容，并联系观察顺序或情感推进。', followUp: '如果调换其中两幅春景的位置，阅读感受会发生什么变化？' },
    { question: '“小草偷偷地从土里钻出来”中的“偷偷地”和“钻”能否删去？', intent: '引导学生用词语证据分析表达效果。', expectedResponse: '写出小草悄然萌发和旺盛生命力，也传达发现春意的惊喜。', followUp: '把“钻”换成“长”，表达效果有什么不同？' },
    { question: '结尾三个比喻分别突出春天什么特点？顺序能否调换？', intent: '理解语言、结构与情感升华的关系。', expectedResponse: '从新、生长、力量三个层次逐步推进，表现对春天和生命的赞美。', followUp: '你会选择什么意象赞美家乡的春天？为什么？' }
  ],
  questions: ['作者依次写了哪些春景？这些内容为什么按这样的顺序安排？', '“小草偷偷地从土里钻出来”中的“偷偷地”和“钻”能否删去？', '结尾三个比喻分别突出春天什么特点？顺序能否调换？'],
  practice: [
    { level: '基础层', text: '为“盼春—绘春—赞春”结构图补全主要春景。', purpose: '检查整体感知和结构概括。', successCriteria: '内容完整、位置正确。', referenceAnswer: '绘春部分包括春草、春花、春风、春雨和迎春等画面。' },
    { level: '提升层', text: '任选一句，从关键词、修辞或感官描写角度完成一则赏析批注。', purpose: '训练基于语言证据的赏析。', successCriteria: '包含原句证据、方法判断、表达效果和情感指向。', referenceAnswer: '答案开放，需依据文本并形成完整分析链。' },
    { level: '拓展层', text: '用两种感官描写校园春景，完成 80 字片段。', purpose: '迁移写景方法。', successCriteria: '至少包含两种感官和一个准确动词，表达有序。', referenceAnswer: '答案开放，可按观察角度和语言具体性评价。' }
  ],
  homeworkDesign: [
    { level: '必做', task: '整理课堂结构图和一则优秀赏析批注，订正课堂练习。', purpose: '巩固阅读路径和语言赏析方法。', estimatedMinutes: 12, feedback: '教师抽查结构图，批注按成功标准给出一条具体反馈。' },
    { level: '选做', task: '观察身边春景，完成 200 字片段，至少使用两种感官描写。', purpose: '把阅读所得迁移到真实表达。', estimatedMinutes: 18, feedback: '同伴互评后教师选择典型片段讲评；此用时需计入当天作业总量。' },
    { level: '挑战', task: '比较课文结尾三个比喻，改写一个适合家乡春天的新比喻并说明理由。', purpose: '发展审美判断和创造性表达。', estimatedMinutes: 8, feedback: '下一课时进行作品展示和口头点评。' }
  ],
  homework: ['完成课后练习一、二，朗读全文并录音自检。', '观察身边的春景，写一段 200 字左右的片段，至少使用两种感官描写。', '整理本节课的“写景表达”方法卡。'],
  blackboard: '春\n盼春 → 绘春 → 赞春\n多感官观察 · 修辞表达 · 情景交融',
  assessmentRubric: [
    { dimension: '结构概括', achieved: '能独立完整梳理结构并说明顺序依据。', developing: '能在提示下补全结构，但顺序依据不清。', evidence: '结构图、小标题和口头说明。' },
    { dimension: '语言赏析', achieved: '能引用词句并说清方法、效果与情感。', developing: '能判断方法，但缺少文本证据或效果分析。', evidence: '课堂批注、回答与同伴互评记录。' },
    { dimension: '方法迁移', achieved: '仿写具体有序，并准确使用所学方法。', developing: '能完成基本描写，但方法使用不明显或表达笼统。', evidence: '随堂片段和课后习作。' }
  ],
  evaluation: ['能独立完整梳理结构并说明顺序依据。', '能引用词句并说清方法、效果与情感。', '能在仿写中准确使用至少一种所学方法。'],
  observationPoints: ['哪些学生仍用“生动形象”替代具体分析？', '学生能否在同伴评价后依据标准修改批注？', '基础学生是否能借助支架完成表达，提升学生是否形成方法迁移？'],
  contingencies: ['若朗读与字词处理超时，保留核心语段品析，将拓展仿写调整为课后任务。', '若学生赏析普遍空泛，暂停小组展示，增加一例反例对比并再次使用四步支架。', '若课堂进度提前，增加结尾三个比喻的顺序辨析，深化结构与情感理解。'],
  reflection: ['目标达成情况', '学生卡点与典型错误', '时间安排调整', '下次教学改进'],
  flow: [
    { index: 1, name: '诊断导入', taskGoal: '激活生活经验并诊断学生的观察表达水平。', context: '以校园春景照片为真实情境，完成“我看见的春天”快速表达。', teacherAction: '展示春景照片，要求学生用一个具体词语描述，并追问观察依据。', studentAction: '独立观察后进行 20 秒口头表达，说明自己看见、听见或感受到的细节。', learningProduct: '一条包含具体景物和感官依据的口头表达。', scaffold: '基础学生使用“我看见/听见……，它让我感到……”句式；提升学生尝试使用准确动词。', activity: '创设春景情境并完成学情诊断。', design: '连接生活经验，暴露学生表达是否具体，为后续教学提供依据。', evaluation: '教师依据“具体景物+感官依据”快速判断，选取典型表达进入课文。', time: 5, tone: 'blue' },
    { index: 2, name: '初读建构', taskGoal: '扫清字词障碍并形成全文初步印象。', context: '带着“文章写了一个怎样的春天”完成第一次阅读。', teacherAction: '范读关键段落，提示停连和重音，发布字词与整体感知任务。', studentAction: '自由朗读，圈画疑难字词和反复出现的春景，用一句话概括全文感受。', learningProduct: '字词订正记录和一句话整体感受。', scaffold: '提供易错字音清单；允许基础学生从“温暖/生机/明亮”等词中选择并补充理由。', activity: '初读课文，解决字词并把握感情基调。', design: '先建立整体感受，再进入结构和语言分析。', evaluation: '检查字音、朗读流畅度及整体感受是否有文本依据。', time: 8, tone: 'green' },
    { index: 3, name: '梳理结构', taskGoal: '建立“盼春—绘春—赞春”的篇章结构。', context: '为文章制作一张可帮助同学快速理解的结构导图。', teacherAction: '组织同桌比较分段结果，追问每部分的核心动作和顺序依据。', studentAction: '默读分层，提取关键词，完成结构图并为绘春部分补写小标题。', learningProduct: '一张包含层次、小标题和顺序箭头的结构图。', scaffold: '提供“先写……再写……最后写……”框架；提升学生补充顺序安排的作用。', activity: '划分层次，梳理文章思路。', design: '让篇章结构可视化，训练概括和关系推理。', evaluation: '同伴依据“完整、准确、有顺序”三项标准互检，教师纠正机械分段。', time: 7, tone: 'yellow' },
    { index: 4, name: '证据品析', taskGoal: '形成基于语言证据的赏析方法。', context: '为“最有春天气息的句子”制作推荐卡。', teacherAction: '示范四步批注，呈现一则空泛反例，组织学生比较后独立批注。', studentAction: '选择关键词句，按“证据—方法—效果—情感”完成批注并小组互评。', learningProduct: '一张包含原句证据和完整分析链的赏析推荐卡。', scaffold: '基础学生使用四步表格；提升学生比较替换词语后的表达差异。', activity: '品读关键词句，赏析语言表达效果。', design: '以产出和标准推动深度阅读，避免只说“生动形象”。', evaluation: '用成功标准检查是否引用准确、方法恰当、效果具体、情感合理，并给出即时修改建议。', time: 12, tone: 'orange' },
    { index: 5, name: '朗读悟情', taskGoal: '通过朗读和比较理解景物描写中的情感。', context: '为班级朗读展示选择最能表现作者情感的语段。', teacherAction: '引导比较重音、节奏和语气，追问语言变化如何表现情感。', studentAction: '小组设计朗读方案，说明重音和停连依据并进行展示。', learningProduct: '一份带朗读标记的语段和一段依据说明。', scaffold: '提供重音、停连、语速提示；允许学生先听范读再尝试。', activity: '在朗读和比较中体会情感基调。', design: '把语言形式、朗读表现与情感理解贯通。', evaluation: '依据“处理合理、说明有据、情感一致”进行同伴评价。', time: 8, tone: 'purple' },
    { index: 6, name: '迁移表达', taskGoal: '把多感官观察和准确用词迁移到真实写作。', context: '为校园公众号写一段“今日春景”。', teacherAction: '出示校园场景，明确 80 字、两种感官和一个准确动词的要求，巡视点拨。', studentAction: '独立完成片段，同伴按标准圈出亮点并提出一条可执行修改建议。', learningProduct: '一段 80 字左右的校园春景和一条修改记录。', scaffold: '提供感官词库和动词替换表；提升学生尝试景中含情。', activity: '联系生活完成片段仿写。', design: '把阅读方法迁移为可观察的表达能力。', evaluation: '依据“两种感官+准确动词+表达有序”快速评价并收集代表性作品。', time: 3, tone: 'teal' },
    { index: 7, name: '回扣目标', taskGoal: '完成目标自评并形成课后学习闭环。', context: '用退出票回答“今天我学会了怎样读写景散文”。', teacherAction: '展示三项目标和成功标准，组织学生自评，说明分层作业选择规则。', studentAction: '提交一句方法总结和一项仍有疑问的内容，选择适合自己的作业。', learningProduct: '一张包含方法总结、疑问和目标自评的退出票。', scaffold: '提供“我学会了……，证据是……”句式。', activity: '梳理方法，完成目标达成自评。', design: '用学习证据结束课堂，为教师反思和下次教学提供数据。', evaluation: '教师课后按目标归类退出票，确定需要集体讲评和个别辅导的问题。', time: 2, tone: 'blue' }
  ]
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  response.end(JSON.stringify(payload));
}

function serveStatic(pathname, response) {
  const sharedFile = pathname === '/aiba-subsite-nav.js'
    ? SUBSITE_NAV_FILE
    : pathname === '/aiba-brand.css' ? SUBSITE_THEME_FILE : null;
  if (sharedFile && existsSync(sharedFile)) {
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(sharedFile)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    createReadStream(sharedFile).pipe(response);
    return;
  }
  const requested = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  let filePath = resolve(STATIC_DIR, `.${requested}`);
  if (!filePath.startsWith(resolve(STATIC_DIR))) return sendJson(response, 403, { error: '禁止访问' });
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(STATIC_DIR, 'index.html');
  if (!existsSync(filePath)) return sendJson(response, 503, { error: '前端尚未构建，请先运行 npm run build' });
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  createReadStream(filePath).pipe(response);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''; let size = 0;
    request.on('data', (chunk) => { size += chunk.length; if (size > 36_000_000) { reject(new Error('请求内容过大，上传资料总大小不能超过 24MB')); request.destroy(); return; } body += chunk; });
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('请求格式不是有效 JSON')); } });
    request.on('error', reject);
  });
}

function scientificNotationRules(subject = '') {
  const mathExample = JSON.stringify({ example: '函数 \\(f(x)=x^2\\)，且 \\(x\\in\\mathbb{R}\\)' });
  const chemistryExample = JSON.stringify({ example: '反应方程式 \\(\\ce{2H2 + O2 -> 2H2O}\\)' });
  return `学科符号与公式规范（当前学科：${subject || '未指定'}）：
1. 所有公式、方程、物理量关系、统计表达、化学式、遗传图式和地理坐标必须使用教材通行的正确符号，不得输出伪符号、乱码或编程表达式。
2. 行内公式使用 \\(...\\)，独立推导使用 \\[...\\]；最终 JSON 文本中的每个反斜杠必须正确转义。合法 JSON 示例：${mathExample}
3. 数学使用标准 LaTeX，如 \\frac、\\sqrt、上下标、集合、函数、极限、向量、矩阵、概率和统计符号；不要把 10^x、x_1、<= 作为未排版正文。
4. 物理量符号、矢量、上下标、希腊字母、单位和科学计数法必须符合学科规范；单位用 \\mathrm{}，数值与单位关系清楚。
5. 化学式、离子、电荷、同位素、物态、反应条件和方程式统一使用 mhchem 的 \\ce{}，合法 JSON 示例：${chemistryExample}
6. 生物中的基因型、染色体、蛋白质、生态统计和遗传概率使用规范斜体、上下标和公式；地理中的经纬度、比例尺、等值线、时区和统计表达使用标准角度、方向和单位。
7. 中文上下标或公式内中文必须写成 \\text{中文}，例如浮力写作 \\(F_{\\text{浮}}\\)、向上压力写作 \\(F_{\\text{向上}}\\)；禁止写成不存在的 \\浮、\\向上、\\向下 等命令。
8. 每一个 \\( 都必须有对应的 \\)，每一个 \\[ 都必须有对应的 \\]；禁止跨段遗漏闭合符。蕴含关系使用 \\Rightarrow，不要混用重复箭头或单独输出多行箭头。
9. 普通中文正文不要放进公式；只有真正的专业符号和公式使用 LaTeX。无法确定规范写法时改用准确中文说明，不得猜造符号。
10. 需要结构图、流程图、几何图或示意图时可以输出完整自包含 SVG；必须以 <svg> 开始、</svg> 结束，不使用 Markdown 代码围栏，不包含 script、foreignObject、事件属性、外链、外部图片或外部字体。颜色和线条使用 fill、stroke 等图形属性，不使用 style 标签。无法保证 SVG 完整闭合时改用准确的普通文本描述，绝不能输出残缺 SVG 源码。
11. SVG 的 text/tspan 中只能写浏览器可直接显示的教材规范普通文本或 Unicode 符号，例如 √、≥、⇒、∈、30°、H₂O、CO₂、F浮；严禁在 SVG 文字节点中写 \(...\)、\[...\]、$...$、\sqrt、\frac、\Rightarrow、\ge、\ce 等 LaTeX 定界符或控制命令。复杂公式应放在 SVG 相邻的 paragraph 中使用标准 LaTeX，SVG 只绘制图形和直接可读标注。
12. layout 为 blackboard 的模块外层已经提供完整黑板背景和边框。其中的 SVG 必须使用透明背景、紧凑 viewBox，禁止绘制覆盖整画布的背景矩形、整幅外边框、重复黑板、灰色底框或无教学意义的大面积留白；只绘制板书文字、分栏、坐标轴、几何图和关系线等教学内容。
13. 动态教案中的 SVG 只能放入 type 为 svg 的内容块，并写入 content 字段；禁止把 SVG 标签放入 paragraph、list、table、cards 或 timeline 的文本字段。初次生成结构中的 blackboard 如确需使用 SVG，整个字段必须是一段完整 SVG，不能与普通文字或代码围栏混合。
14. 在“对话优化教案”中，教师提到“图、图片、图示、示意图、结构图、流程图、关系图、概念图、思维导图、板书图、配图”等词，且没有明确要求照片、真实图片、插画、PNG、JPG、JPEG、位图、网络图片或图片地址时，一律理解为安全自包含 SVG，并使用 type 为 svg 的内容块。教师明确指定其他图片媒介时，按其明确要求执行。`;
}

function buildPrompt(form, files) {
  const material = (files || []).map((file) => `文件：${file.name}\n${file.text || '（未提取到文字，请结合文件名和其他输入完成方案）'}`).join('\n\n');
  return `你是一名熟悉中国 K12 课程标准、校本教研和课堂评价的学科教研员。请生成一份老师能够直接上课、参加集体备课、继续修改并导出 Word/PDF 的完整教案。必须只返回合法 JSON，不要 Markdown，不要代码围栏。\n\n输入：${JSON.stringify(form, null, 2)}\n\n补充资料：${material || '无'}\n\n质量原则：\n1. 以课程标准和核心素养为依据，但不得虚构课标编号或原文；资料未提供具体条目时使用概括性表述并提醒教师复核。\n2. 写清本课在单元中的位置和本课时独特价值，避免只复述课题。\n3. 学情必须区分已有基础、学习障碍、常见误区和学生差异。\n4. 教学目标使用可观察行为，2-5 项；每项目标绑定学习证据和成功标准，形成目标—活动—评价一致性。\n5. 课堂以真实或有意义的情境、问题、任务组织，尊重学生主体地位；每个环节写清任务目标、教师动作、学生动作、学习产出、支架、设计意图和评价反馈。\n6. 问题链由浅入深，每个问题给出设计意图、预期关键回答和追问。\n7. 练习与作业体现基础、提升和拓展差异；作业写预计时间、目的和反馈方式，避免机械重复、惩罚性和超课标难度，并提示纳入当天作业总量。\n8. 评价必须基于可见学习证据，兼顾过程性评价和改进性反馈。\n9. 内容宁可具体简洁，不写“培养能力”“加强练习”等无法执行和评价的空话。\n\n${scientificNotationRules(form.subject)}\n\nJSON 必须包含：title(string), standardsAlignment({courseStandard,coreLiteracy,unitPosition,lessonValue}), learnerProfile({priorKnowledge:string[],learningGaps:string[],misconceptions:string[],differences:string[]}), learningAnalysis(string), goals(string[]), goalEvidence({goal,evidence,successCriteria}[]), focus(string), breakthroughStrategies(string[]), preparation(string[]), flow({index,name,taskGoal,context,teacherAction,studentAction,learningProduct,scaffold,activity,design,evaluation,time,tone}[]), questionChain({question,intent,expectedResponse,followUp}[]), questions(string[]), practice({level,text,purpose,successCriteria,referenceAnswer}[]), homeworkDesign({level,task,purpose,estimatedMinutes,feedback}[]), homework(string[]), blackboard(string), assessmentRubric({dimension,achieved,developing,evidence}[]), evaluation(string[]), observationPoints(string[]), contingencies(string[]), reflection(string[])。flow.time 总和必须严格等于 ${Number(form.duration) || 45}，tone 只允许 blue/green/yellow/orange/purple/teal。`;
}

function buildOptimizePrompt(form, plan, messages) {
  const dialogue = (messages || []).slice(-20).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '').slice(0, 4000)
  }));
  return `你是一名正在和教师共同磨课的中国 K12 学科教研员，同时也是文档结构编辑器。请根据教师的多轮对话要求修改当前整份教案，并返回修改后的完整动态教案 JSON。不能只返回差异、建议或局部字段。\n\n备课表单：${JSON.stringify(form, null, 2)}\n\n当前完整动态教案：${JSON.stringify(plan, null, 2)}\n\n对话记录：${JSON.stringify(dialogue, null, 2)}\n\n最高优先级规则：\n1. 最后一条教师要求对整份教案全局有效。教师可以修改封面、标题、正文、模块名称、模块数量、模块顺序、内容、结构、排版、表格、卡片、图片和 SVG 图示。\n2. 教师明确要求新增、删除、合并、拆分、改名或重排模块时必须执行，禁止因为旧版教案有 13 个模块而补回被删除模块。13 个模块只是初始模板，不是固定结构。\n3. 未被要求修改的内容应尽量完整保留；但教师的明确删除或替换要求优先。\n4. 如果仍保留按分钟划分的教学过程，各环节时间总和应等于 ${Number(form.duration) || 45} 分钟；如果教师明确删除或整体替换教学过程，不要擅自重新添加固定教学过程。\n5. 在根节点增加 optimizationSummary，用一句中文准确说明本轮实际修改。\n\n必须返回以下动态教案 V3 根结构：\n{\n  "documentVersion": 3,\n  "title": "文档主标题",\n  "cover": {\n    "kicker": "封面眉题，可为空",\n    "title": "封面标题",\n    "subtitle": "封面副标题，可为空",\n    "meta": [{ "label": "字段名", "value": "字段值" }]\n  },\n  "appearance": {\n    "theme": "classic|academic|modern|minimal|blue",\n    "density": "compact|comfortable|spacious",\n    "pageLayout": "single|two-column"\n  },\n  "sections": [\n    {\n      "id": "稳定且唯一的英文或拼音标识",\n      "title": "模块标题",\n      "layout": "stack|two-column|three-column|grid|timeline|blackboard|table|gallery",\n      "blocks": []\n    }\n  ],\n  "footer": { "brand": "页尾品牌，可为空", "note": "页尾说明，可为空" },\n  "optimizationSummary": "本轮修改摘要"\n}\n\n可用内容块：\n- 段落：{ "type":"paragraph", "text":"富文本", "variant":"body|lead|note|callout|quote", "align":"left|center|right|justify" }\n- 列表：{ "type":"list", "items":["内容"], "style":"bullet|ordered|check", "columns":1 }\n- 键值信息：{ "type":"keyValue", "items":[{"label":"标签","value":"内容"}], "columns":2 }\n- 卡片：{ "type":"cards", "columns":3, "items":[{"title":"标题","subtitle":"副标题","meta":"补充信息","body":"正文","fields":[{"label":"标签","value":"内容"}]}] }\n- 时间线：{ "type":"timeline", "items":[{"title":"环节","meta":"5 分钟","body":"正文","fields":[{"label":"教师活动","value":"内容"}]}] }\n- 表格：{ "type":"table", "headers":["列名"], "rows":[["单元格"]] }\n- 图片：{ "type":"image", "src":"安全的 HTTPS 地址或图片 Data URL", "alt":"替代文本", "caption":"图注" }\n- SVG 图示：{ "type":"svg", "content":"<svg>...</svg>", "caption":"图注" }\n- 分隔线：{ "type":"divider" }\n\n新增教学示意图时优先使用完整自包含 SVG。禁止输出任意 HTML、脚本、CSS、Markdown 代码围栏或未列出的可执行内容。只返回完整合法 JSON。\n\n${scientificNotationRules(form.subject)}`;
}

const SCIENTIFIC_SUBJECTS = new Set(['数学', '物理', '化学', '生物', '地理', '科学', '信息科技']);

function containsUnformattedScientificNotation(value, subject) {
  if (!SCIENTIFIC_SUBJECTS.has(subject)) return false;
  const strings = [];
  const visit = (item) => {
    if (typeof item === 'string') strings.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return strings.some((item) => {
    const plain = item
      .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, '')
      .replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$]*?\$/g, '')
      .replace(/[“”‘’]/g, '');
    if (/\\(?:frac|sqrt|sum|int|lim|vec|ce|mathrm|mathbf|mathit|begin)\b/.test(plain)) return true;
    if (/(?:[A-Za-zΑ-Ωα-ω]\w*|\d+|\))\s*(?:\^|_[A-Za-z0-9{]|<=|>=|!=|==|->|<->|=>|=|<|>|×|÷)\s*(?:[A-Za-zΑ-Ωα-ω0-9(+-])/.test(plain)) return true;
    if (/\([A-Za-z0-9\s+\-*/^]+\)\s*\([A-Za-z0-9\s+\-*/^]+\)/.test(plain)) return true;
    return subject === '化学' && /\b(?:[A-Z][a-z]?\d*){2,}\b/.test(plain);
  });
}

async function ensureScientificNotation(config, form, value) {
  if (!containsUnformattedScientificNotation(value, form.subject)) return value;
  const prompt = `请只规范下面完整教案中的学科符号与公式，不改变教学目标、活动、时间、作业或评价内容。SVG 以外的真正专业公式改为标准 LaTeX 分隔格式，SVG 以外的化学式改为 mhchem；SVG 内必须遵守直接可读 Unicode 文字规则，普通中文保持原样。返回完整合法 JSON。\n\n${scientificNotationRules(form.subject)}\n\n当前教案：${JSON.stringify(value, null, 2)}`;
  try {
    return await callModel(config, prompt) || value;
  } catch {
    return value;
  }
}

const GENERATED_PLAN_FIELDS = [
  'title', 'document', 'cover', 'sections', 'standardsAlignment',
  'learnerProfile', 'learningAnalysis', 'goals', 'flow', 'questionChain',
  'practice', 'homeworkDesign', 'blackboard', 'assessmentRubric'
];

function hasGeneratedPlanFields(value) {
  return Boolean(value && typeof value === 'object' && GENERATED_PLAN_FIELDS.some((field) => Object.hasOwn(value, field)));
}

function unwrapGeneratedPlan(value) {
  let current = value;
  // 兼容部分模型在合法 JSON 外再包一层 plan/data，否则默认教案会掩盖真实结果。
  for (let depth = 0; depth < 3 && current && typeof current === 'object' && !hasGeneratedPlanFields(current); depth += 1) {
    const nested = ['plan', 'lessonPlan', 'data', 'result']
      .map((field) => current[field])
      .find((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (!nested || nested === current) break;
    current = nested;
  }
  return current;
}

function mergePlan(value, form) {
  value = unwrapGeneratedPlan(value);
  const plan = { ...defaultPlan, ...(value || {}) };
  const list = (input, fallback = []) => {
    const items = Array.isArray(input) ? input : String(input || '').split('\n');
    const cleaned = items.map((item) => String(item || '').trim()).filter(Boolean);
    return cleaned.length ? cleaned : structuredClone(fallback);
  };

  plan.standardsAlignment = { ...defaultPlan.standardsAlignment, ...(plan.standardsAlignment || {}) };
  plan.learnerProfile = {
    ...defaultPlan.learnerProfile,
    ...(plan.learnerProfile || {}),
    priorKnowledge: list(plan.learnerProfile?.priorKnowledge, defaultPlan.learnerProfile.priorKnowledge),
    learningGaps: list(plan.learnerProfile?.learningGaps, defaultPlan.learnerProfile.learningGaps),
    misconceptions: list(plan.learnerProfile?.misconceptions, defaultPlan.learnerProfile.misconceptions),
    differences: list(plan.learnerProfile?.differences, defaultPlan.learnerProfile.differences)
  };
  plan.goals = list(plan.goals, defaultPlan.goals).slice(0, 5);
  plan.goalEvidence = Array.isArray(value?.goalEvidence) && value.goalEvidence.length
    ? value.goalEvidence.map((item, index) => ({ goal: item.goal || plan.goals[index] || `目标${index + 1}`, evidence: item.evidence || '课堂学习产出', successCriteria: item.successCriteria || '能够独立完成并说明依据。' }))
    : plan.goals.map((goal, index) => ({ ...defaultPlan.goalEvidence[index % defaultPlan.goalEvidence.length], goal }));
  plan.breakthroughStrategies = list(plan.breakthroughStrategies, defaultPlan.breakthroughStrategies);
  plan.preparation = list(plan.preparation, defaultPlan.preparation);
  plan.reflection = list(plan.reflection, defaultPlan.reflection);
  plan.observationPoints = list(plan.observationPoints, defaultPlan.observationPoints);
  plan.contingencies = list(plan.contingencies, defaultPlan.contingencies);

  const rawQuestions = list(value?.questions, []);
  plan.questionChain = Array.isArray(value?.questionChain) && value.questionChain.length
    ? value.questionChain.map((item, index) => ({ ...defaultPlan.questionChain[index % defaultPlan.questionChain.length], ...item }))
    : (rawQuestions.length ? rawQuestions : defaultPlan.questions).map((question, index) => ({ ...defaultPlan.questionChain[index % defaultPlan.questionChain.length], question }));
  plan.questions = plan.questionChain.map((item) => item.question);

  plan.practice = Array.isArray(value?.practice) && value.practice.length
    ? value.practice.map((item, index) => ({ ...defaultPlan.practice[index % defaultPlan.practice.length], ...(typeof item === 'string' ? { text: item } : item) }))
    : structuredClone(defaultPlan.practice);

  const rawHomework = list(value?.homework, []);
  plan.homeworkDesign = Array.isArray(value?.homeworkDesign) && value.homeworkDesign.length
    ? value.homeworkDesign.map((item, index) => ({ ...defaultPlan.homeworkDesign[index % defaultPlan.homeworkDesign.length], ...item, estimatedMinutes: Math.max(1, Number(item.estimatedMinutes) || defaultPlan.homeworkDesign[index % defaultPlan.homeworkDesign.length].estimatedMinutes) }))
    : (rawHomework.length ? rawHomework : defaultPlan.homework).map((task, index) => ({ ...defaultPlan.homeworkDesign[index % defaultPlan.homeworkDesign.length], task }));
  plan.homework = plan.homeworkDesign.map((item) => item.task);

  const rawEvaluation = list(value?.evaluation, []);
  plan.assessmentRubric = Array.isArray(value?.assessmentRubric) && value.assessmentRubric.length
    ? value.assessmentRubric.map((item, index) => ({ ...defaultPlan.assessmentRubric[index % defaultPlan.assessmentRubric.length], ...item }))
    : (rawEvaluation.length ? rawEvaluation : defaultPlan.evaluation).map((achieved, index) => ({ ...defaultPlan.assessmentRubric[index % defaultPlan.assessmentRubric.length], achieved }));
  plan.evaluation = plan.assessmentRubric.map((item) => item.achieved);

  if (!Array.isArray(plan.flow) || plan.flow.length === 0) plan.flow = structuredClone(defaultPlan.flow);
  plan.title = plan.title || `《${form.lesson || '本课'}》${form.period || ''}备课方案`;
  plan.flow = plan.flow.map((row, index) => {
    const merged = { ...defaultPlan.flow[index % defaultPlan.flow.length], ...row };
    return {
      ...merged,
      index: index + 1,
      taskGoal: merged.taskGoal || `完成${merged.name || '本环节'}的学习目标。`,
      context: merged.context || merged.activity || '围绕本课核心问题完成学习任务。',
      teacherAction: merged.teacherAction || merged.activity || '组织并指导本环节学习活动。',
      studentAction: merged.studentAction || merged.activity || '按任务要求完成学习活动并展示结果。',
      learningProduct: merged.learningProduct || '形成可展示、可检查的课堂学习产出。',
      scaffold: merged.scaffold || '根据学生差异提供问题提示、示例或表达支架。',
      evaluation: merged.evaluation || merged.design || '根据学生课堂产出进行即时评价。',
      time: Number(merged.time) || 5
    };
  });
  const target = Number(form.duration) || 45;
  const total = plan.flow.reduce((sum, row) => sum + row.time, 0) || target;
  if (total !== target && target >= plan.flow.length) {
    let remaining = target;
    plan.flow = plan.flow.map((row, index) => {
      const rowsLeft = plan.flow.length - index - 1;
      const time = index === plan.flow.length - 1 ? remaining : Math.max(1, Math.min(Math.round(row.time / total * target), remaining - rowsLeft));
      remaining -= time;
      return { ...row, time };
    });
  }
  return plan;
}

function localPlan(form) {
  const lesson = form.lesson || '本课';
  const plan = structuredClone(defaultPlan);
  plan.title = `《${lesson}》${form.period || ''}备课方案`;
  plan.learningAnalysis = form.studentBase || plan.learningAnalysis;
  const goals = String(form.goals || '').split('\n').map((item) => item.replace(/^\d+[.、]\s*/, '')).filter(Boolean).slice(0, 5);
  if (goals.length) plan.goals = goals;
  plan.focus = `重点：${form.teachingFocus || '围绕教材核心内容组织学习。'}\n难点：${form.teachingDifficulty || '让学生将方法迁移到新的学习任务中。'}`;
  plan.flow = plan.flow.map((row) => ({ ...row, time: Math.round(row.time * (Number(form.duration || 45) / 45)) }));
  return mergePlan(plan, form);
}

async function requestModelContent(baseUrl, apiKey, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  let response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, response_format: { type: 'json_object' } })
  });
  if (!response.ok && (response.status === 400 || response.status === 404)) {
    response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`模型接口返回 ${response.status}：${errorText.slice(0, 180)}`);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('模型接口返回了无法解析的响应');
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回内容');
  return String(content);
}

async function callModel(config, prompt, images = []) {
  const platformManaged = process.env.PLATFORM_MODE === '1';
  const runtimeConfig = platformManaged ? {} : (config || {});
  const baseUrl = String(
    platformManaged
      ? (process.env.PLATFORM_AI_BASE_URL || process.env.OPENAI_BASE_URL)
      : (runtimeConfig.baseUrl || process.env.OPENAI_BASE_URL)
      || 'https://api.openai.com/v1',
  ).replace(/\/$/, '');
  const apiKey = platformManaged
    ? (process.env.PLATFORM_AI_API_KEY || process.env.OPENAI_API_KEY)
    : (runtimeConfig.apiKey || process.env.OPENAI_API_KEY);
  const model = platformManaged
    ? (process.env.PLATFORM_AI_MODEL || process.env.OPENAI_MODEL || 'platform-managed')
    : (runtimeConfig.model || process.env.OPENAI_MODEL || 'gpt-4o-mini');
  if (!apiKey) return null;
  const userContent = images.length ? [{ type: 'text', text: prompt }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'auto' } }))] : prompt;
  const body = {
    model,
    temperature: Number(runtimeConfig.temperature ?? .4),
    messages: [
      { role: 'system', content: '你只返回合法 JSON。专业公式可以使用 LaTeX，但 JSON 字符串中的反斜杠必须正确双写。不要输出 Markdown。' },
      { role: 'user', content: userContent }
    ]
  };
  const content = await requestModelContent(baseUrl, apiKey, body);
  try {
    return parseModelJson(content);
  } catch (firstError) {
    const repairBody = {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: '你是 JSON 修复器。只修复格式，不改写内容，只返回一个合法 JSON 对象。' },
        { role: 'user', content: `请修复下面内容中的非法转义、引号、换行或尾逗号：\n\n${content.slice(0, 80000)}` }
      ]
    };
    try {
      return parseModelJson(await requestModelContent(baseUrl, apiKey, repairBody));
    } catch {
      const error = new Error('AI 已生成内容，但返回格式异常；系统自动修复后仍无法解析，请点击生成按钮重试。');
      error.cause = firstError;
      throw error;
    }
  }
}

async function extractUploadedFiles(files) {
  const documents = [];
  const images = [];
  for (const file of files || []) {
    if (file.text) {
      documents.push({ name: file.name, text: String(file.text).slice(0, 30000) });
      continue;
    }
    if (!file.base64) {
      documents.push({ name: file.name, text: '文件内容为空。' });
      continue;
    }
    try {
      const buffer = Buffer.from(file.base64, 'base64');
      if (/\.pdf$/i.test(file.name)) {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        await parser.destroy();
        documents.push({ name: file.name, text: String(result.text || '').slice(0, 50000) });
      } else if (/\.docx$/i.test(file.name)) {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        documents.push({ name: file.name, text: String(result.value || '').slice(0, 50000) });
      } else if (/\.(png|jpe?g)$/i.test(file.name)) {
        const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
        images.push(`data:${mime};base64,${file.base64}`);
        documents.push({ name: file.name, text: '图片已作为视觉资料发送给模型。' });
      } else {
        documents.push({ name: file.name, text: '旧版 DOC 暂不支持解析，请另存为 DOCX 后上传。' });
      }
    } catch (error) {
      documents.push({ name: file.name, text: `资料解析失败：${error.message || '文件可能已损坏'}` });
    }
  }
  return { documents, images };
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }); response.end(); return; }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (request.method === 'GET') return serveStatic(url.pathname, response);
    if (request.method !== 'POST') return sendJson(response, 404, { error: 'Not Found' });
    const body = await readBody(request);
    if (url.pathname === '/api/test-connection') {
      const config = body.config || {};
      if (!config.apiKey && !process.env.OPENAI_API_KEY) return sendJson(response, 400, { error: '还没有填写 API Key' });
      const result = await callModel(config, '只返回 {"ok":true}，不要输出其他内容。');
      return sendJson(response, 200, { ok: true, model: config.model || process.env.OPENAI_MODEL || 'configured-model', result });
    }
    if (url.pathname === '/api/optimize') {
      const form = body.form || {};
      const config = body.config || {};
      const currentPlan = body.plan;
      const messages = Array.isArray(body.messages) ? body.messages.filter((message) => message && String(message.content || '').trim()).slice(-20) : [];
      if (!currentPlan || typeof currentPlan !== 'object') return sendJson(response, 400, { error: '缺少当前教案，无法进行 AI 优化' });
      if (!messages.some((message) => message.role === 'user')) return sendJson(response, 400, { error: '请先输入需要调整的内容' });
      if (!config.apiKey && !process.env.OPENAI_API_KEY) return sendJson(response, 400, { error: 'AI 优化服务尚未配置，请联系管理员' });
      try {
        const currentDocument = normalizeLessonDocument(currentPlan, form);
        const generated = await callModel(config, buildOptimizePrompt(form, currentDocument, messages));
        if (!generated) throw new Error('AI 优化服务尚未配置');
        const formatted = await ensureScientificNotation(config, form, generated);
        const { optimizationSummary, ...planValue } = formatted;
        return sendJson(response, 200, {
          source: 'ai',
          message: String(optimizationSummary || '已按你的要求更新教案，右侧内容已经同步。').slice(0, 300),
          plan: normalizeLessonDocument(planValue, form, currentDocument)
        });
      } catch (error) {
        return sendJson(response, 502, { error: error.message || 'AI 优化失败' });
      }
    }
    if (url.pathname === '/api/generate') {
      const form = body.form || {}; const config = body.config || {}; const extracted = await extractUploadedFiles(body.files);
      try {
        const generated = await callModel(config, buildPrompt(form, extracted.documents), extracted.images);
        if (!generated) return sendJson(response, 200, { source: 'local', plan: localPlan(form) });
        const formatted = await ensureScientificNotation(config, form, generated);
        const generatedPlan = unwrapGeneratedPlan(formatted);
        if (!hasGeneratedPlanFields(generatedPlan)) throw new Error('模型返回内容中缺少有效教案，请重新生成');
        return sendJson(response, 200, { source: 'ai', plan: mergePlan(generatedPlan, form) });
      } catch (error) {
        if (config.apiKey || process.env.OPENAI_API_KEY) return sendJson(response, 502, { error: error.message || '模型生成失败' });
        return sendJson(response, 200, { source: 'local', plan: localPlan(form) });
      }
    }
    return sendJson(response, 404, { error: 'Not Found' });
  } catch (error) {
    return sendJson(response, 400, { error: error.message || '请求处理失败' });
  }
});

server.listen(PORT, HOST, () => console.log(`教师备课器 API 已启动：http://localhost:${PORT}`));
