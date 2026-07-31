import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicLessonDocument } from './DynamicLessonDocument.jsx';
import { exportLessonDocx } from './exportDocx';
import { exportLessonPdf } from './exportPdf';
import { sanitizeBlackboard } from './lessonText.js';
import { isDynamicLessonDocument, lessonDocumentToText, normalizeLessonDocument } from './lessonDocument.js';
import { RichText } from './RichText';
import './styles.css';
import '../aiba-brand.css';

const defaultForm = {
  grade: '',
  subject: '',
  lesson: '',
  period: '第1课时',
  duration: 45,
  textbook: '',
  studentBase: '',
  goals: '',
  teachingFocus: '',
  teachingDifficulty: '',
  style: '',
  requirements: ''
};

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
    misconceptions: ['认为指出修辞名称就是完成赏析。', '概括结构时容易按自然段机械切分。'],
    differences: ['基础学生需要赏析句式支架，提升学生需要完成方法迁移和表达优化。']
  },
  learningAnalysis: '七年级学生对春景有丰富生活经验，也能完成基础字词和内容概括，但赏析往往停留在感受层面，缺少“词句证据—表达效果—情感指向”的完整推理。教学需通过示范批注、同伴交流和分层支架，让学生形成可迁移的写景散文阅读方法。',
  goals: [
    '能用“盼春—绘春—赞春”概括文章结构，并说出主要春景。',
    '能从动词、修辞或感官描写中选择一个角度，结合词句说明表达效果。',
    '能在 80 字左右的春景片段中运用至少一种本课学习的写景方法。'
  ],
  goalEvidence: [
    { goal: '概括文章结构与主要春景', evidence: '结构图或三个小标题', successCriteria: '层次完整、顺序合理，能覆盖主要内容。' },
    { goal: '结合词句赏析语言', evidence: '一则“证据—方法—效果—情感”批注', successCriteria: '引用准确，至少说清一种表达方法及其作用。' },
    { goal: '迁移写景方法完成表达', evidence: '80 字春景片段', successCriteria: '至少使用一种课堂所学方法，描写具体且语句通顺。' }
  ],
  focus: '重点：品味多感官描写与修辞表达。\n难点：体会语言背后的情感，并迁移到自己的表达中。',
  breakthroughStrategies: ['用“写了什么—怎么写—产生什么效果—表达什么情感”四步批注支架化解赏析空泛。', '采用教师示范、同伴共评、独立迁移的渐进任务，帮助学生把阅读方法转化为表达能力。'],
  preparation: ['教师：准备课文朗读音频、春景图片与课堂任务单。', '学生：预习课文，圈画生字词和最有画面感的句子。', '资源：教材、学习单、投屏课件与随堂练习。'],
  questionChain: [
    { question: '作者依次写了哪些春景？这些内容为什么按这样的顺序安排？', intent: '检查整体感知与结构思维。', expectedResponse: '能概括主要春景，并联系观察顺序或情感推进。', followUp: '如果调换其中两幅春景的位置，阅读感受会发生什么变化？' },
    { question: '“小草偷偷地从土里钻出来”中的“偷偷地”和“钻”能否删去？', intent: '引导学生用词语证据分析表达效果。', expectedResponse: '写出小草悄然萌发和旺盛生命力，也传达发现春意的惊喜。', followUp: '把“钻”换成“长”，表达效果有什么不同？' },
    { question: '结尾三个比喻分别突出春天什么特点？顺序能否调换？', intent: '理解语言、结构与情感升华的关系。', expectedResponse: '从新、生长、力量三个层次逐步推进。', followUp: '你会选择什么意象赞美家乡的春天？为什么？' }
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
    { level: '挑战', task: '改写一个适合家乡春天的新比喻并说明理由。', purpose: '发展审美判断和创造性表达。', estimatedMinutes: 8, feedback: '下一课时进行作品展示和口头点评。' }
  ],
  homework: [
    '完成课后练习一、二，朗读全文并录音自检。',
    '观察身边的春景，写一段 200 字左右的片段，至少使用两种感官描写。',
    '整理本节课的“写景表达”方法卡。'
  ],
  blackboard: '春\n盼春 → 绘春 → 赞春\n多感官观察 · 修辞表达 · 情景交融',
  assessmentRubric: [
    { dimension: '结构概括', achieved: '能独立完整梳理结构并说明顺序依据。', developing: '能在提示下补全结构，但顺序依据不清。', evidence: '结构图、小标题和口头说明。' },
    { dimension: '语言赏析', achieved: '能引用词句并说清方法、效果与情感。', developing: '能判断方法，但缺少文本证据或效果分析。', evidence: '课堂批注、回答与同伴互评记录。' },
    { dimension: '方法迁移', achieved: '仿写具体有序，并准确使用所学方法。', developing: '能完成基本描写，但方法使用不明显或表达笼统。', evidence: '随堂片段和课后习作。' }
  ],
  evaluation: ['能准确概括文章结构并说出主要春景。', '能结合关键词句说明语言表达效果。', '能在仿写中至少使用一种课堂所学方法。'],
  observationPoints: ['哪些学生仍用“生动形象”替代具体分析？', '学生能否在同伴评价后依据标准修改批注？', '不同基础学生是否都获得了可见的进步证据？'],
  contingencies: ['若朗读与字词处理超时，保留核心语段品析，将拓展仿写调整为课后任务。', '若学生赏析普遍空泛，暂停展示，增加一例反例对比并再次使用四步支架。', '若课堂进度提前，增加结尾三个比喻的顺序辨析。'],
  reflection: ['目标达成情况', '学生卡点与典型错误', '时间安排调整', '下次教学改进'],
  flow: [
    { index: 1, name: '诊断导入', taskGoal: '激活生活经验并诊断观察表达水平。', context: '以校园春景照片完成“我看见的春天”快速表达。', teacherAction: '展示春景照片，要求学生用具体词语描述并追问依据。', studentAction: '独立观察后进行 20 秒口头表达，说明感官细节。', learningProduct: '一条包含具体景物和感官依据的口头表达。', scaffold: '提供“我看见/听见……，它让我感到……”句式。', activity: '创设春景情境并完成学情诊断。', design: '连接生活经验，为后续教学提供依据。', evaluation: '依据“具体景物+感官依据”快速判断。', time: 5, tone: 'blue' },
    { index: 2, name: '初读建构', taskGoal: '扫清字词障碍并形成全文初步印象。', context: '带着“文章写了一个怎样的春天”完成第一次阅读。', teacherAction: '范读关键段落，发布字词与整体感知任务。', studentAction: '自由朗读，圈画疑难字词并用一句话概括感受。', learningProduct: '字词订正记录和一句话整体感受。', scaffold: '提供易错字音清单和感受词提示。', activity: '初读课文，解决字词并把握感情基调。', design: '先建立整体感受，再进入结构和语言分析。', evaluation: '检查字音、朗读流畅度及概括依据。', time: 8, tone: 'green' },
    { index: 3, name: '梳理结构', taskGoal: '建立“盼春—绘春—赞春”的篇章结构。', context: '为文章制作一张快速理解的结构导图。', teacherAction: '组织比较分段结果，追问每部分的核心动作和顺序依据。', studentAction: '默读分层，完成结构图并补写小标题。', learningProduct: '包含层次、小标题和顺序箭头的结构图。', scaffold: '提供“先写……再写……最后写……”框架。', activity: '划分层次，梳理文章思路。', design: '让篇章结构可视化，训练概括和关系推理。', evaluation: '依据“完整、准确、有顺序”互检。', time: 7, tone: 'yellow' },
    { index: 4, name: '证据品析', taskGoal: '形成基于语言证据的赏析方法。', context: '为“最有春天气息的句子”制作推荐卡。', teacherAction: '示范四步批注并呈现空泛反例，组织比较。', studentAction: '完成“证据—方法—效果—情感”批注并互评。', learningProduct: '一张包含原句证据和完整分析链的赏析卡。', scaffold: '基础学生使用四步表格，提升学生比较替换词语。', activity: '品读关键词句，赏析表达效果。', design: '以产出和标准推动深度阅读。', evaluation: '按引用、方法、效果、情感四项标准反馈。', time: 12, tone: 'orange' },
    { index: 5, name: '朗读悟情', taskGoal: '通过朗读理解景物描写中的情感。', context: '为班级朗读展示选择最能表现情感的语段。', teacherAction: '引导比较重音、节奏和语气，追问语言依据。', studentAction: '设计朗读方案，说明依据并进行展示。', learningProduct: '带朗读标记的语段和依据说明。', scaffold: '提供重音、停连、语速提示。', activity: '在朗读和比较中体会情感基调。', design: '贯通语言形式、朗读表现与情感理解。', evaluation: '依据“处理合理、说明有据、情感一致”互评。', time: 8, tone: 'purple' },
    { index: 6, name: '迁移表达', taskGoal: '把观察和准确用词迁移到真实写作。', context: '为校园公众号写一段“今日春景”。', teacherAction: '明确 80 字、两种感官和一个准确动词的要求。', studentAction: '完成片段，同伴圈出亮点并提出修改建议。', learningProduct: '80 字校园春景和一条修改记录。', scaffold: '提供感官词库和动词替换表。', activity: '联系生活完成片段仿写。', design: '把阅读方法迁移为可观察的表达能力。', evaluation: '依据“两种感官+准确动词+表达有序”评价。', time: 3, tone: 'teal' },
    { index: 7, name: '回扣目标', taskGoal: '完成目标自评并形成学习闭环。', context: '用退出票回答“今天我学会了怎样读写景散文”。', teacherAction: '展示目标和标准，组织自评并说明分层作业。', studentAction: '提交方法总结、疑问和目标自评。', learningProduct: '包含方法、疑问和自评的退出票。', scaffold: '提供“我学会了……，证据是……”句式。', activity: '梳理方法，完成目标达成自评。', design: '用学习证据结束课堂并支持后续改进。', evaluation: '教师课后按目标归类退出票。', time: 2, tone: 'blue' }
  ]
};

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem('teacher-prep-ai-settings')) || {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
      temperature: 0.4
    };
  } catch {
    return { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', temperature: 0.4 };
  }
}

const initialDialogue = [{ role: 'assistant', content: '请告诉我希望怎样调整当前教案。我会保留完整结构，并直接更新右侧内容。' }];

function createInitialDialogue() {
  return initialDialogue.map((message) => ({ ...message }));
}

function joinFilled(values, separator = ' · ') {
  return values.map((value) => String(value || '').trim()).filter(Boolean).join(separator);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function Icon({ children, className = '' }) {
  return <span aria-hidden="true" className={`icon ${className}`}>{children}</span>;
}

function SettingsPage({ onBack }) {
  const [settings, setSettings] = useState(readSettings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const save = () => {
    localStorage.setItem('teacher-prep-ai-settings', JSON.stringify(settings));
    setMessage('配置已保存在本机浏览器');
    window.setTimeout(() => setMessage(''), 2400);
  };
  const testConnection = async () => {
    setTesting(true);
    setMessage('正在连接模型…');
    try {
      const response = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: settings }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '连接失败');
      setMessage(`连接成功：${data.model || settings.model}`);
    } catch (error) {
      setMessage(error.message || '连接失败，请检查地址和密钥');
    } finally {
      setTesting(false);
    }
  };

  return <main className="settings-page">
    <header className="settings-header">
      <button className="icon-button" title="返回教师备课器" onClick={onBack}><Icon>←</Icon></button>
      <div><p className="eyebrow">AI WORKSPACE / SETTINGS</p><h1>AI 配置</h1></div>
      <div className="header-spacer" />
      <span className="connection-dot"><i /> 本机配置</span>
    </header>
    <section className="settings-layout">
      <div className="settings-intro">
        <span className="settings-mark"><Icon>✦</Icon></span>
        <h2>让备课器连接<br />你常用的模型。</h2>
        <p>配置只保存在当前浏览器，不会写入项目文件。你可以使用 OpenAI 或任意兼容 Chat Completions 的模型服务。</p>
        <div className="settings-note"><Icon>⌁</Icon><span>推荐使用支持 JSON 输出的模型，生成结果会更稳定。</span></div>
      </div>
      <form className="settings-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label>模型服务商<select value={settings.provider} onChange={(event) => update('provider', event.target.value)}><option value="openai">OpenAI</option><option value="compatible">OpenAI 兼容接口</option></select></label>
        <label>API 地址<input value={settings.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" /></label>
        <label>模型名称<input value={settings.model} onChange={(event) => update('model', event.target.value)} placeholder="gpt-4o-mini" /></label>
        <label>API Key<div className="secret-input"><input type={showKey ? 'text' : 'password'} value={settings.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="sk-…" /><button type="button" onClick={() => setShowKey((value) => !value)} title={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? '隐' : '显'}</button></div></label>
        <label>生成温度 <span className="range-value">{settings.temperature}</span><input className="range" type="range" min="0" max="1" step="0.1" value={settings.temperature} onChange={(event) => update('temperature', Number(event.target.value))} /></label>
        <div className="settings-actions"><button type="button" className="secondary-button" onClick={testConnection} disabled={testing}><Icon>{testing ? '…' : '⌁'}</Icon>{testing ? '连接中' : '测试连接'}</button><button type="submit" className="primary-button"><Icon>✓</Icon>保存配置</button></div>
        {message && <p className="settings-message" role="status">{message}</p>}
      </form>
    </section>
  </main>;
}

function UploadBox({ files, onFiles, onRemove }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const addFiles = (list) => {
    const next = Array.from(list || []).slice(0, 6);
    if (next.length) onFiles(next);
  };
  return <div className="upload-area">
    <div className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
      <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.md" onChange={(event) => addFiles(event.target.files)} />
      <Icon className="upload-icon">⇧</Icon><strong>点击或拖拽文件到此处上传</strong><span>PDF / WORD / PNG / JPG / TXT</span>
    </div>
    {files.length > 0 && <div className="file-list">{files.map((file) => <div className="file-item" key={`${file.name}-${file.size}`}><Icon>▤</Icon><span title={file.name}>{file.name}</span><button title="移除文件" onClick={() => onRemove(file.name)}>×</button></div>)}</div>}
  </div>;
}

function Field({ label, children, hint }) {
  return <label className="field"><span className="field-label">{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

function InputPanel({ form, setForm, files, setFiles, onGenerate, generating }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <aside className="input-panel">
    <div className="brand-row"><div><h1>教师备课器</h1><span className="brand-subtitle">从教学目标开始，生成一堂可执行的课</span></div><span className="ai-badge static-badge"><Icon>✦</Icon><span>AI智能备课</span></span></div>
    <div className="input-section">
      <div className="section-heading"><Icon>▣</Icon><h2>基础信息</h2><span className="section-line" /></div>
      <div className="two-fields"><Field label="年级与科目"><div className="select-pair"><select value={form.grade} onChange={(event) => update('grade', event.target.value)}><option value="">请选择年级</option><option>一年级</option><option>二年级</option><option>三年级</option><option>四年级</option><option>五年级</option><option>六年级</option><option>七年级</option><option>八年级</option><option>九年级</option><option>高一</option><option>高二</option><option>高三</option></select><select value={form.subject} onChange={(event) => update('subject', event.target.value)}><option value="">请选择科目</option><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option><option>生物</option><option>历史</option><option>地理</option><option>道法</option><option>科学</option><option>信息科技</option></select></div></Field></div>
      <Field label="课题"><input value={form.lesson} onChange={(event) => update('lesson', event.target.value)} placeholder="例如：春" /></Field>
      <Field label="课时"><select value={form.period} onChange={(event) => update('period', event.target.value)}><option>第1课时</option><option>第2课时</option><option>单元复习课</option><option>试卷讲评课</option></select></Field>
      <Field label="学生基础"><textarea value={form.studentBase} onChange={(event) => update('studentBase', event.target.value)} rows="3" placeholder="请输入学生已有基础、学习障碍或差异情况" /></Field>
      <Field label="学习目标"><textarea value={form.goals} onChange={(event) => update('goals', event.target.value)} rows="4" placeholder="请输入本课学习目标" /></Field>
      <details className="advanced-settings">
        <summary><span>更多教学要求</span><small>{form.style || '未选择'}</small></summary>
        <Field label="课时长度" hint={`${form.duration} 分钟`}><input type="range" className="range" min="30" max="120" step="5" value={form.duration} onChange={(event) => update('duration', Number(event.target.value))} /></Field>
        <Field label="教材版本 / 章节"><input value={form.textbook} onChange={(event) => update('textbook', event.target.value)} placeholder="请输入教材版本和章节" /></Field>
        <Field label="教学重点"><textarea value={form.teachingFocus} onChange={(event) => update('teachingFocus', event.target.value)} rows="2" placeholder="请输入教学重点" /></Field>
        <Field label="教学难点"><textarea value={form.teachingDifficulty} onChange={(event) => update('teachingDifficulty', event.target.value)} rows="2" placeholder="请输入教学难点" /></Field>
        <Field label="课堂方式"><div className="style-options">{['讲授', '探究', '练习', '讨论', '混合模式'].map((style) => <button type="button" className={form.style === style ? 'active' : ''} key={style} onClick={() => update('style', style)}>{style}</button>)}</div></Field>
        <Field label="补充要求"><textarea value={form.requirements} onChange={(event) => update('requirements', event.target.value)} rows="3" placeholder="请输入其他教学要求" /></Field>
      </details>
      <div className="divider" />
      <Field label="上传教材或教辅"><UploadBox files={files} onFiles={setFiles} onRemove={(name) => setFiles((current) => current.filter((file) => file.name !== name))} /></Field>
      <div className="ready-status"><span className="status-check">✓</span><div><strong>{files.length ? '资料已就绪' : '输入内容已就绪'}</strong><span>{files.length ? `已添加 ${files.length} 个文件，将随请求发送` : '可以直接生成备课方案，也可以先上传教材'}</span></div></div>
      <button className="generate-button" onClick={onGenerate} disabled={generating}><Icon>{generating ? '…' : '✦'}</Icon>{generating ? 'AI 正在生成…' : '生成备课方案'}</button>
    </div>
  </aside>;
}

function DocumentSection({ number, title, children, className = '' }) {
  return <section className={`document-section ${className}`}><div className="document-section-title"><span>{String(number).padStart(2, '0')}</span><h2>{title}</h2></div>{children}</section>;
}

function LessonDocument({ plan, form, documentRef }) {
  const dynamicPlan = useMemo(() => isDynamicLessonDocument(plan) ? normalizeLessonDocument(plan, form) : null, [form, plan]);
  if (dynamicPlan) return <DynamicLessonDocument plan={dynamicPlan} documentRef={documentRef} />;
  const goals = Array.isArray(plan.goals) ? plan.goals : String(plan.goals || '').split('\n').filter(Boolean);
  const practice = Array.isArray(plan.practice) ? plan.practice : [];
  const preparation = Array.isArray(plan.preparation) ? plan.preparation : String(plan.preparation || '').split('\n').filter(Boolean);
  const reflection = Array.isArray(plan.reflection) ? plan.reflection : defaultPlan.reflection;
  const flow = Array.isArray(plan.flow) ? plan.flow : defaultPlan.flow;
  const standards = { ...defaultPlan.standardsAlignment, ...(plan.standardsAlignment || {}) };
  const learner = { ...defaultPlan.learnerProfile, ...(plan.learnerProfile || {}) };
  const goalEvidence = Array.isArray(plan.goalEvidence) ? plan.goalEvidence : goals.map((goal, index) => ({ ...defaultPlan.goalEvidence[index % defaultPlan.goalEvidence.length], goal }));
  const strategies = Array.isArray(plan.breakthroughStrategies) ? plan.breakthroughStrategies : defaultPlan.breakthroughStrategies;
  const questionChain = Array.isArray(plan.questionChain) ? plan.questionChain : defaultPlan.questionChain;
  const homeworkDesign = Array.isArray(plan.homeworkDesign) ? plan.homeworkDesign : defaultPlan.homeworkDesign;
  const rubric = Array.isArray(plan.assessmentRubric) ? plan.assessmentRubric : defaultPlan.assessmentRubric;
  const observationPoints = Array.isArray(plan.observationPoints) ? plan.observationPoints : defaultPlan.observationPoints;
  const contingencies = Array.isArray(plan.contingencies) ? plan.contingencies : defaultPlan.contingencies;
  const blackboard = sanitizeBlackboard(plan.blackboard);
  const profileGroups = [
    ['已有基础', learner.priorKnowledge],
    ['学习障碍', learner.learningGaps],
    ['常见误区', learner.misconceptions],
    ['差异与支持', learner.differences]
  ];
  return <article className="lesson-document" ref={documentRef}>
    <div className="document-cover"><p className="document-kicker">教 师 备 课 教 案</p><h1><RichText>{plan.title}</RichText></h1><p className="document-subtitle">课标对齐 · 学情诊断 · 任务驱动 · 教学评一致</p><dl className="document-meta"><div><dt>年级学科</dt><dd>{joinFilled([form.grade, form.subject])}</dd></div><div><dt>课时安排</dt><dd>{joinFilled([form.period, `${form.duration}分钟`])}</dd></div><div><dt>教材章节</dt><dd><RichText>{form.textbook}</RichText></dd></div><div><dt>课堂方式</dt><dd>{form.style}</dd></div></dl></div>
    <DocumentSection number={1} title="课程标准与课时定位"><div className="alignment-grid"><section><span>课标依据</span><p><RichText>{standards.courseStandard}</RichText></p></section><section><span>核心素养</span><p><RichText>{standards.coreLiteracy}</RichText></p></section><section><span>单元定位</span><p><RichText>{standards.unitPosition}</RichText></p></section><section><span>课时价值</span><p><RichText>{standards.lessonValue}</RichText></p></section></div></DocumentSection>
    <DocumentSection number={2} title="学情诊断"><p className="analysis-lead"><RichText>{plan.learningAnalysis}</RichText></p><div className="learner-profile-grid">{profileGroups.map(([label, items]) => <section key={label}><span>{label}</span><ul>{(Array.isArray(items) ? items : [items]).filter(Boolean).map((item, index) => <li key={index}><RichText>{item}</RichText></li>)}</ul></section>)}</div></DocumentSection>
    <DocumentSection number={3} title="教学目标与达成证据"><div className="goal-evidence-list">{goalEvidence.map((item, index) => <section key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><h3><RichText>{item.goal || goals[index]}</RichText></h3><p><strong>学习证据</strong><RichText>{item.evidence}</RichText></p><p><strong>成功标准</strong><RichText>{item.successCriteria}</RichText></p></div></section>)}</div></DocumentSection>
    <DocumentSection number={4} title="教学重点、难点与突破"><div className="focus-callout">{String(plan.focus || '').split('\n').filter(Boolean).map((line, index) => <p key={index}><RichText>{line}</RichText></p>)}</div><div className="strategy-list">{strategies.map((item, index) => <p key={index}><span>{index + 1}</span><RichText>{item}</RichText></p>)}</div></DocumentSection>
    <DocumentSection number={5} title="教学准备"><ul>{preparation.map((item, index) => <li key={index}><RichText>{item}</RichText></li>)}</ul></DocumentSection>
    <DocumentSection number={6} title="教学过程" className="flow-document-section"><div className="document-flow">{flow.map((row, index) => <section className="document-flow-step" key={`${row.index}-${row.name}`}><header><span>{String(index + 1).padStart(2, '0')}</span><h3><RichText>{row.name}</RichText></h3><time>{row.time} 分钟</time></header><div className="flow-task-band"><p><strong>任务目标</strong><RichText>{row.taskGoal}</RichText></p><p><strong>情境 / 任务</strong><RichText>{row.context}</RichText></p></div><div className="document-flow-body"><p><strong>教师活动</strong><RichText>{row.teacherAction || row.activity}</RichText></p><p><strong>学生活动</strong><RichText>{row.studentAction || row.activity}</RichText></p><p><strong>学习产出</strong><RichText>{row.learningProduct || '形成可检查的课堂产出。'}</RichText></p><p><strong>支架与分层</strong><RichText>{row.scaffold || '根据学生差异提供提示。'}</RichText></p><p><strong>设计意图</strong><RichText>{row.design}</RichText></p><p><strong>观察与评价</strong><RichText>{row.evaluation || row.design}</RichText></p></div></section>)}</div></DocumentSection>
    <DocumentSection number={7} title="递进问题链"><div className="question-chain-list">{questionChain.map((item, index) => <section key={index}><header><span>Q{index + 1}</span><h3><RichText>{item.question}</RichText></h3></header><div><p><strong>设计意图</strong><RichText>{item.intent}</RichText></p><p><strong>预期要点</strong><RichText>{item.expectedResponse}</RichText></p><p><strong>追问纠偏</strong><RichText>{item.followUp}</RichText></p></div></section>)}</div></DocumentSection>
    <DocumentSection number={8} title="随堂分层练习"><div className="document-practice professional-practice">{practice.map((item, index) => <section key={index}><span>{item.level || `任务${index + 1}`}</span><h3><RichText>{item.text || item}</RichText></h3><p><strong>设计目的</strong><RichText>{item.purpose}</RichText></p><p><strong>成功标准</strong><RichText>{item.successCriteria}</RichText></p><p><strong>答案要点</strong><RichText>{item.referenceAnswer}</RichText></p></section>)}</div></DocumentSection>
    <DocumentSection number={9} title="分层作业与反馈"><div className="homework-design">{homeworkDesign.map((item, index) => <section key={index}><header><span>{item.level}</span><time>约 {item.estimatedMinutes} 分钟</time></header><h3><RichText>{item.task}</RichText></h3><p><strong>设计目的</strong><RichText>{item.purpose}</RichText></p><p><strong>反馈方式</strong><RichText>{item.feedback}</RichText></p></section>)}</div><p className="workload-note">作业预计用时需计入学生当天各学科作业总量，由教师结合学校要求和班级实际调整。</p></DocumentSection>
    <DocumentSection number={10} title="板书设计"><div className="blackboard-preview">{blackboard.split('\n').filter(Boolean).map((line, index) => <p key={index}><RichText>{line}</RichText></p>)}</div></DocumentSection>
    <DocumentSection number={11} title="教学评价量规"><div className="rubric-table"><div className="rubric-head"><span>评价维度</span><span>目标达成</span><span>发展中</span><span>证据来源</span></div>{rubric.map((item, index) => <div className="rubric-row" key={index}><strong><RichText>{item.dimension}</RichText></strong><p><RichText>{item.achieved}</RichText></p><p><RichText>{item.developing}</RichText></p><p><RichText>{item.evidence}</RichText></p></div>)}</div></DocumentSection>
    <DocumentSection number={12} title="课堂观察与应变预案"><div className="implementation-grid"><section><h3>课堂观察点</h3><ul>{observationPoints.map((item, index) => <li key={index}><RichText>{item}</RichText></li>)}</ul></section><section><h3>课堂应变预案</h3><ul>{contingencies.map((item, index) => <li key={index}><RichText>{item}</RichText></li>)}</ul></section></div></DocumentSection>
    <DocumentSection number={13} title="课后反思"><div className="reflection-grid">{reflection.map((item, index) => <div key={index}><strong><RichText>{item}</RichText></strong><span aria-hidden="true" /></div>)}</div></DocumentSection>
    <footer className="document-footer"><span>教师备课器 · AI生成初稿</span><p>请结合教材、学生和真实课堂节奏进行专业调整</p></footer>
  </article>;
}

function ResultPanel({ plan, form, onOptimize, onExportWord, onExportPdf, onCopy, exportingWord, exportingPdf, documentRef }) {
  return <section className="result-panel">
    <header className="result-header"><div className="result-title"><span className="book-mark">▤</span><div><p className="eyebrow">EDITABLE LESSON DOCUMENT</p><h1>备课教案</h1><span>连续文档预览 · 可下载 Word / PDF</span></div></div><div className="result-actions"><button className="secondary-button" onClick={onOptimize}><Icon>✦</Icon>AI继续调整</button><button className="word-button" onClick={onExportWord} disabled={exportingWord || exportingPdf}><Icon>{exportingWord ? '…' : '↓'}</Icon>{exportingWord ? '正在生成' : '下载 Word'}</button><button className="pdf-button" onClick={onExportPdf} disabled={exportingPdf || exportingWord}><Icon>{exportingPdf ? '…' : '↓'}</Icon>{exportingPdf ? '正在排版' : '下载 PDF'}</button><button className="icon-button" title="复制方案" onClick={onCopy}><Icon>□</Icon></button></div></header>
    <div className="document-stage"><LessonDocument plan={plan} form={form} documentRef={documentRef} /></div>
  </section>;
}

function OptimizeDrawer({ onClose, onOptimize, optimizing, messages, setMessages }) {
  const [input, setInput] = useState('');
  const messagesRef = useRef(null);
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, optimizing]);
  const send = async () => {
    const content = input.trim();
    if (!content || optimizing) return;
    const nextMessages = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    try {
      const reply = await onOptimize(nextMessages);
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error.message || '这次修改没有完成，请重新说明调整要求。', error: true }]);
    }
  };
  return <div className="drawer-backdrop" onClick={onClose}><aside className="optimize-drawer chat-drawer" role="dialog" aria-modal="true" aria-label="AI优化教案" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">AI LESSON REFINEMENT</p><h2>对话优化教案</h2></div><button className="icon-button" onClick={onClose} title="关闭"><Icon>×</Icon></button></div><div className="chat-messages" ref={messagesRef}>{messages.map((message, index) => <div className={`chat-message ${message.role} ${message.error ? 'error' : ''}`} key={index}><span>{message.role === 'user' ? '你' : 'AI'}</span><p><RichText>{message.content}</RichText></p></div>)}{optimizing && <div className="chat-message assistant pending"><span>AI</span><p>正在根据当前教案重新组织内容…</p></div>}</div><div className="chat-composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } }} placeholder="例如：把探究环节增加到15分钟，并补充物理实验的安全提醒" rows="4" /><button className="primary-button" onClick={send} disabled={!input.trim() || optimizing}><Icon>{optimizing ? '…' : '↑'}</Icon>{optimizing ? '正在修改' : '发送并更新教案'}</button></div></aside></div>;
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast" role="status"><Icon>✓</Icon>{message}</div>;
}

function App() {
  const [view, setView] = useState(window.location.hash === '#settings' ? 'settings' : 'workspace');
  const [form, setForm] = useState(defaultForm);
  const [files, setFiles] = useState([]);
  const [plan, setPlan] = useState({ ...defaultPlan, duration: defaultForm.duration });
  const [generating, setGenerating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [toast, setToast] = useState('');
  // 优化记录只属于当前页面内的这一次备课，不跨刷新或新教案持久化。
  const [messages, setMessages] = useState(createInitialDialogue);
  const documentRef = useRef(null);

  useEffect(() => {
    const onHash = () => setView(window.location.hash === '#settings' ? 'settings' : 'workspace');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    try {
      // 清除旧版本遗留的跨刷新聊天记录，防止不同学科备课互相串线。
      localStorage.removeItem('teacher-prep-optimization-dialogue');
    } catch {
      // 本功能不依赖本地存储，浏览器限制存储时无需额外处理。
    }
  }, []);

  const goSettings = () => { window.location.hash = 'settings'; setView('settings'); };
  const goWorkspace = () => { window.location.hash = ''; setView('workspace'); };
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2400); };
  const generate = async () => {
    setGenerating(true);
    try {
      const totalFileSize = files.reduce((sum, file) => sum + file.size, 0);
      if (totalFileSize > 24 * 1024 * 1024) throw new Error('上传资料总大小不能超过 24MB');
      const filePayload = await Promise.all(files.map(async (file) => {
        let text = '';
        if (/\.(txt|md|csv|json)$/i.test(file.name)) text = await file.text();
        const needsBinary = /\.(pdf|docx|doc|png|jpe?g)$/i.test(file.name);
        const base64 = needsBinary ? await fileToBase64(file) : '';
        return { name: file.name, type: file.type, size: file.size, text: text.slice(0, 18000), base64 };
      }));
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form, files: filePayload, config: readSettings() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '生成失败');
      // 初次生成也立即进入动态文档管线，避免旧版按行渲染把多行 SVG 拆成源码。
      setPlan(normalizeLessonDocument(data.plan, form));
      setMessages(createInitialDialogue());
      setDrawerOpen(false);
      notify(data.source === 'local' ? '已生成演示方案，请配置模型以启用真实 AI' : '备课方案已生成');
    } catch (error) {
      notify(error.message || '生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  };
  const exportWord = async () => {
    setExportingWord(true);
    try {
      await exportLessonDocx(plan, form);
      notify('Word 教案已下载');
    } catch (error) {
      notify(error.message || 'Word 生成失败，请稍后重试');
    } finally {
      setExportingWord(false);
    }
  };
  const exportPdf = async () => {
    setExportingPdf(true);
    try {
      await exportLessonPdf(documentRef.current, form);
      notify('PDF 教案已下载');
    } catch (error) {
      notify(error.message || 'PDF 生成失败，请稍后重试');
    } finally {
      setExportingPdf(false);
    }
  };
  const optimizePlan = async (messages) => {
    setOptimizing(true);
    try {
      const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, plan, messages, config: readSettings() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI 修改失败');
      setPlan(normalizeLessonDocument(data.plan, form, plan));
      notify('教案已按对话更新');
      return data.message || '已按你的要求更新教案，右侧内容已经同步。';
    } finally {
      setOptimizing(false);
    }
  };
  const copyPlan = async () => {
    if (isDynamicLessonDocument(plan)) {
      try {
        await navigator.clipboard.writeText(lessonDocumentToText(plan, form));
        notify('教案正文已复制');
      } catch {
        notify('复制失败，请检查浏览器权限');
      }
      return;
    }
    const list = (value) => Array.isArray(value) ? value : [];
    const standards = plan.standardsAlignment || {};
    const learner = plan.learnerProfile || {};
    const goals = list(plan.goals);
    const goalEvidence = list(plan.goalEvidence).length ? plan.goalEvidence : goals.map((goal) => ({ goal }));
    const questionChain = list(plan.questionChain).length ? plan.questionChain : list(plan.questions).map((question) => ({ question }));
    const homeworkDesign = list(plan.homeworkDesign).length ? plan.homeworkDesign : list(plan.homework).map((task) => ({ task }));
    const rubric = list(plan.assessmentRubric).length ? plan.assessmentRubric : list(plan.evaluation).map((achieved) => ({ achieved }));
    const text = [
      plan.title,
      `年级学科：${joinFilled([form.grade, form.subject])}`,
      `课时安排：${joinFilled([form.period, `${form.duration}分钟`])}`,
      '', '一、课程标准与课时定位',
      `课标依据：${standards.courseStandard || ''}`,
      `核心素养：${standards.coreLiteracy || ''}`,
      `单元定位：${standards.unitPosition || ''}`,
      `课时价值：${standards.lessonValue || ''}`,
      '', '二、学情诊断', plan.learningAnalysis || '',
      `已有基础：${list(learner.priorKnowledge).join('；')}`,
      `学习障碍：${list(learner.learningGaps).join('；')}`,
      `常见误区：${list(learner.misconceptions).join('；')}`,
      `差异与支持：${list(learner.differences).join('；')}`,
      '', '三、教学目标与达成证据', ...goalEvidence.flatMap((item, index) => [`${index + 1}. ${item.goal || goals[index] || ''}`, `学习证据：${item.evidence || ''}`, `成功标准：${item.successCriteria || ''}`]),
      '', '四、教学重点、难点与突破', plan.focus || '', ...list(plan.breakthroughStrategies).map((item, index) => `${index + 1}. ${item}`),
      '', '五、教学准备', ...list(plan.preparation).map((item) => `- ${item}`),
      '', '六、教学过程', ...list(plan.flow).flatMap((row, index) => [
        `${index + 1}. ${row.name || ''}（${row.time || 0}分钟）`,
        `任务目标：${row.taskGoal || ''}`,
        `情境 / 任务：${row.context || ''}`,
        `教师活动：${row.teacherAction || row.activity || ''}`,
        `学生活动：${row.studentAction || row.activity || ''}`,
        `学习产出：${row.learningProduct || ''}`,
        `支架与分层：${row.scaffold || ''}`,
        `设计意图：${row.design || ''}`,
        `观察与评价：${row.evaluation || row.design || ''}`
      ]),
      '', '七、递进问题链', ...questionChain.flatMap((item, index) => [`Q${index + 1}：${item.question || ''}`, `设计意图：${item.intent || ''}`, `预期要点：${item.expectedResponse || ''}`, `追问纠偏：${item.followUp || ''}`]),
      '', '八、随堂分层练习', ...list(plan.practice).flatMap((item, index) => [`${item.level || `任务 ${index + 1}`}：${item.text || item}`, `设计目的：${item.purpose || ''}`, `成功标准：${item.successCriteria || ''}`, `答案要点：${item.referenceAnswer || ''}`]),
      '', '九、分层作业与反馈', ...homeworkDesign.flatMap((item, index) => [`${item.level || `作业 ${index + 1}`}：${item.task || ''}${item.estimatedMinutes ? `（约${item.estimatedMinutes}分钟）` : ''}`, `设计目的：${item.purpose || ''}`, `反馈方式：${item.feedback || ''}`]),
      '作业总量提示：预计用时需计入学生当天各学科作业总量，由教师结合学校要求和班级实际调整。',
      '', '十、板书设计', sanitizeBlackboard(plan.blackboard),
      '', '十一、教学评价量规', ...rubric.flatMap((item, index) => [`${index + 1}. ${item.dimension || ''}`, `目标达成：${item.achieved || ''}`, `发展中：${item.developing || ''}`, `证据来源：${item.evidence || ''}`]),
      '', '十二、课堂观察与应变预案',
      '课堂观察点：', ...list(plan.observationPoints).map((item, index) => `${index + 1}. ${item}`),
      '课堂应变预案：', ...list(plan.contingencies).map((item, index) => `${index + 1}. ${item}`),
      '', '十三、课后反思', ...list(plan.reflection).map((item) => `${item}：`)
    ].join('\n');
    try { await navigator.clipboard.writeText(text); notify('教案正文已复制'); } catch { notify('复制失败，请检查浏览器权限'); }
  };

  if (view === 'settings') return <SettingsPage onBack={goWorkspace} />;
  return <main className="app-shell"><InputPanel form={form} setForm={setForm} files={files} setFiles={setFiles} onGenerate={generate} generating={generating} /><ResultPanel plan={plan} form={form} onOptimize={() => setDrawerOpen(true)} onExportWord={exportWord} onExportPdf={exportPdf} onCopy={copyPlan} exportingWord={exportingWord} exportingPdf={exportingPdf} documentRef={documentRef} />{drawerOpen ? <OptimizeDrawer onClose={() => setDrawerOpen(false)} onOptimize={optimizePlan} optimizing={optimizing} messages={messages} setMessages={setMessages} /> : null}<Toast message={toast} /></main>;
}

createRoot(document.getElementById('root')).render(<App />);
