const SECTION_LAYOUTS = new Set(['stack', 'two-column', 'three-column', 'grid', 'timeline', 'blackboard', 'table', 'gallery']);
const THEMES = new Set(['classic', 'academic', 'modern', 'minimal', 'blue']);
const DENSITIES = new Set(['compact', 'comfortable', 'spacious']);
const PAGE_LAYOUTS = new Set(['single', 'two-column']);
const PARAGRAPH_VARIANTS = new Set(['body', 'lead', 'note', 'callout', 'quote']);
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const LIST_STYLES = new Set(['bullet', 'ordered', 'check']);
const MAX_SECTIONS = 40;
const MAX_BLOCKS = 80;
const MAX_ITEMS = 100;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function richString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value.slice(0, 60000);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function positiveInteger(value, fallback = 1, maximum = 6) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function normalizeTextItems(value) {
  const source = Array.isArray(value) ? value : String(value || '').split('\n');
  return source
    .slice(0, MAX_ITEMS)
    .map((item) => richString(item).trim())
    .filter(Boolean);
}

function normalizeFields(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ITEMS).map((item) => ({
    label: richString(item?.label || item?.name || item?.title).trim(),
    value: richString(item?.value ?? item?.text ?? item?.content).trim()
  })).filter((item) => item.label || item.value);
}

function normalizeCardItem(value, index) {
  if (typeof value === 'string') return { title: `内容 ${index + 1}`, body: value, fields: [] };
  const item = value && typeof value === 'object' ? value : {};
  return {
    title: richString(item.title || item.name || item.label).trim(),
    subtitle: richString(item.subtitle).trim(),
    meta: richString(item.meta ?? item.time ?? item.duration).trim(),
    body: richString(item.body ?? item.text ?? item.content ?? item.description).trim(),
    fields: normalizeFields(item.fields || item.details || item.items)
  };
}

function readableUnknownBlock(block) {
  const entries = Object.entries(block || {}).filter(([key]) => key !== 'type');
  const text = entries.map(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return `${key}：${value}`;
    try {
      return `${key}：${JSON.stringify(value, null, 2)}`;
    } catch {
      return `${key}：`;
    }
  }).join('\n');
  return { type: 'paragraph', text, variant: 'note', align: 'left' };
}

function safeImageSource(value) {
  const source = richString(value).trim();
  if (/^https:\/\/[^\s]+$/i.test(source)) return source;
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(source)) return source.replace(/\s+/g, '');
  return '';
}

function normalizeBlock(value, index) {
  if (typeof value === 'string') return { type: 'paragraph', text: value, variant: 'body', align: 'left' };
  const block = value && typeof value === 'object' ? value : {};
  const rawType = richString(block.type || 'paragraph').trim();
  const aliases = {
    text: 'paragraph', richText: 'paragraph', quote: 'paragraph', note: 'paragraph',
    bulletList: 'list', orderedList: 'list', checklist: 'list',
    grid: 'cards', steps: 'timeline', flow: 'timeline', blackboard: 'paragraph'
  };
  const type = aliases[rawType] || rawType;

  if (type === 'paragraph') {
    const inferredVariant = ['quote', 'note'].includes(rawType) ? rawType : rawType === 'blackboard' ? 'callout' : block.variant;
    return {
      type,
      text: richString(block.text ?? block.value ?? block.content ?? block.body).trim(),
      variant: PARAGRAPH_VARIANTS.has(inferredVariant) ? inferredVariant : 'body',
      align: TEXT_ALIGNMENTS.has(block.align) ? block.align : 'left'
    };
  }

  if (type === 'list') {
    const inferredStyle = rawType === 'orderedList' ? 'ordered' : rawType === 'checklist' ? 'check' : block.style;
    return {
      type,
      items: normalizeTextItems(block.items ?? block.values ?? block.content),
      style: LIST_STYLES.has(inferredStyle) ? inferredStyle : 'bullet',
      columns: positiveInteger(block.columns, 1, 3)
    };
  }

  if (type === 'keyValue') {
    return { type, items: normalizeFields(block.items ?? block.fields), columns: positiveInteger(block.columns, 2, 4) };
  }

  if (type === 'cards' || type === 'timeline') {
    const items = Array.isArray(block.items) ? block.items : [];
    return {
      type,
      items: items.slice(0, MAX_ITEMS).map(normalizeCardItem),
      columns: type === 'timeline' ? 1 : positiveInteger(block.columns, 3, 4)
    };
  }

  if (type === 'table') {
    const headers = normalizeTextItems(block.headers || block.columns);
    const rows = Array.isArray(block.rows) ? block.rows.slice(0, MAX_ITEMS).map((row) => {
      const cells = Array.isArray(row) ? row : Object.values(row || {});
      return cells.slice(0, 12).map((cell) => richString(cell).trim());
    }) : [];
    return { type, headers, rows };
  }

  if (type === 'image') {
    return {
      type,
      src: safeImageSource(block.src || block.url),
      alt: richString(block.alt || block.title || `教学图片 ${index + 1}`).trim(),
      caption: richString(block.caption || block.description).trim()
    };
  }

  if (type === 'svg') {
    return {
      type,
      content: richString(block.content || block.svg || block.value).trim(),
      caption: richString(block.caption || block.description).trim()
    };
  }

  if (type === 'divider') return { type };
  return readableUnknownBlock(block);
}

function normalizeSection(value, index, usedIds) {
  const section = value && typeof value === 'object' ? value : {};
  const fallbackId = `section-${index + 1}`;
  let id = richString(section.id || fallbackId).trim().slice(0, 80) || fallbackId;
  if (usedIds.has(id)) id = `${id}-${index + 1}`;
  usedIds.add(id);
  let rawBlocks = section.blocks;
  if (!Array.isArray(rawBlocks)) {
    if (Array.isArray(section.content)) rawBlocks = section.content;
    else if (section.content !== undefined || section.text !== undefined) rawBlocks = [{ type: 'paragraph', text: section.content ?? section.text }];
    else rawBlocks = [];
  }
  return {
    id,
    title: richString(section.title || section.name || `模块 ${index + 1}`).trim() || `模块 ${index + 1}`,
    layout: SECTION_LAYOUTS.has(section.layout) ? section.layout : 'stack',
    blocks: rawBlocks.slice(0, MAX_BLOCKS).map(normalizeBlock)
  };
}

function legacyMeta(form) {
  return [
    { label: '年级学科', value: [form.grade, form.subject].filter(Boolean).join(' · ') },
    { label: '课时安排', value: [form.period, form.duration ? `${form.duration}分钟` : ''].filter(Boolean).join(' · ') },
    { label: '教材章节', value: form.textbook || '' },
    { label: '课堂方式', value: form.style || '' }
  ].filter((item) => item.value);
}

function profileFields(profile) {
  return [
    { label: '已有基础', value: normalizeTextItems(profile?.priorKnowledge).join('；') },
    { label: '学习障碍', value: normalizeTextItems(profile?.learningGaps).join('；') },
    { label: '常见误区', value: normalizeTextItems(profile?.misconceptions).join('；') },
    { label: '差异与支持', value: normalizeTextItems(profile?.differences).join('；') }
  ].filter((item) => item.value);
}

function legacySections(plan) {
  const standards = plan.standardsAlignment || {};
  const goals = normalizeTextItems(plan.goals);
  const goalEvidence = Array.isArray(plan.goalEvidence) && plan.goalEvidence.length
    ? plan.goalEvidence
    : goals.map((goal) => ({ goal }));
  const questionChain = Array.isArray(plan.questionChain) && plan.questionChain.length
    ? plan.questionChain
    : normalizeTextItems(plan.questions).map((question) => ({ question }));
  const homework = Array.isArray(plan.homeworkDesign) && plan.homeworkDesign.length
    ? plan.homeworkDesign
    : normalizeTextItems(plan.homework).map((task) => ({ task }));
  const rubric = Array.isArray(plan.assessmentRubric) && plan.assessmentRubric.length
    ? plan.assessmentRubric
    : normalizeTextItems(plan.evaluation).map((achieved) => ({ achieved }));

  return [
    {
      id: 'standards-alignment', title: '课程标准与课时定位', layout: 'two-column',
      blocks: [{ type: 'keyValue', columns: 2, items: [
        { label: '课标依据', value: standards.courseStandard || '' },
        { label: '核心素养', value: standards.coreLiteracy || '' },
        { label: '单元定位', value: standards.unitPosition || '' },
        { label: '课时价值', value: standards.lessonValue || '' }
      ] }]
    },
    {
      id: 'learner-profile', title: '学情诊断', layout: 'stack',
      blocks: [
        { type: 'paragraph', text: plan.learningAnalysis || '', variant: 'lead' },
        { type: 'keyValue', columns: 2, items: profileFields(plan.learnerProfile) }
      ]
    },
    {
      id: 'learning-goals', title: '教学目标与达成证据', layout: 'grid',
      blocks: [{ type: 'cards', columns: 2, items: goalEvidence.map((item, index) => ({
        title: item.goal || goals[index] || `学习目标 ${index + 1}`,
        fields: [
          { label: '学习证据', value: item.evidence || '' },
          { label: '成功标准', value: item.successCriteria || '' }
        ]
      })) }]
    },
    {
      id: 'focus-strategies', title: '教学重点、难点与突破', layout: 'stack',
      blocks: [
        { type: 'paragraph', text: plan.focus || '', variant: 'callout' },
        { type: 'list', style: 'ordered', items: normalizeTextItems(plan.breakthroughStrategies) }
      ]
    },
    { id: 'preparation', title: '教学准备', layout: 'stack', blocks: [{ type: 'list', items: normalizeTextItems(plan.preparation) }] },
    {
      id: 'teaching-flow', title: '教学过程', layout: 'timeline',
      blocks: [{ type: 'timeline', items: (Array.isArray(plan.flow) ? plan.flow : []).map((row, index) => ({
        title: row.name || `教学环节 ${index + 1}`,
        meta: row.time ? `${row.time} 分钟` : '',
        fields: [
          { label: '任务目标', value: row.taskGoal || '' },
          { label: '情境 / 任务', value: row.context || '' },
          { label: '教师活动', value: row.teacherAction || row.activity || '' },
          { label: '学生活动', value: row.studentAction || row.activity || '' },
          { label: '学习产出', value: row.learningProduct || '' },
          { label: '支架与分层', value: row.scaffold || '' },
          { label: '设计意图', value: row.design || '' },
          { label: '观察与评价', value: row.evaluation || '' }
        ]
      })) }]
    },
    {
      id: 'question-chain', title: '递进问题链', layout: 'stack',
      blocks: [{ type: 'cards', columns: 1, items: questionChain.map((item, index) => ({
        title: `Q${index + 1}  ${item.question || ''}`,
        fields: [
          { label: '设计意图', value: item.intent || '' },
          { label: '预期要点', value: item.expectedResponse || '' },
          { label: '追问纠偏', value: item.followUp || '' }
        ]
      })) }]
    },
    {
      id: 'practice', title: '随堂分层练习', layout: 'grid',
      blocks: [{ type: 'cards', columns: 3, items: (Array.isArray(plan.practice) ? plan.practice : []).map((item, index) => ({
        title: item.level || `任务 ${index + 1}`,
        body: item.text || richString(item),
        fields: [
          { label: '设计目的', value: item.purpose || '' },
          { label: '成功标准', value: item.successCriteria || '' },
          { label: '答案要点', value: item.referenceAnswer || '' }
        ]
      })) }]
    },
    {
      id: 'homework', title: '分层作业与反馈', layout: 'grid',
      blocks: [
        { type: 'cards', columns: 3, items: homework.map((item, index) => ({
          title: item.level || `作业 ${index + 1}`,
          meta: item.estimatedMinutes ? `约 ${item.estimatedMinutes} 分钟` : '',
          body: item.task || '',
          fields: [
            { label: '设计目的', value: item.purpose || '' },
            { label: '反馈方式', value: item.feedback || '' }
          ]
        })) },
        { type: 'paragraph', variant: 'note', text: '作业预计用时需计入学生当天各学科作业总量，由教师结合学校要求和班级实际调整。' }
      ]
    },
    { id: 'blackboard', title: '板书设计', layout: 'blackboard', blocks: [{ type: 'paragraph', text: plan.blackboard || '', align: 'center' }] },
    {
      id: 'assessment', title: '教学评价量规', layout: 'table',
      blocks: [{
        type: 'table',
        headers: ['评价维度', '目标达成', '发展中', '证据来源'],
        rows: rubric.map((item, index) => [item.dimension || `评价维度 ${index + 1}`, item.achieved || '', item.developing || '', item.evidence || ''])
      }]
    },
    {
      id: 'observation-contingency', title: '课堂观察与应变预案', layout: 'two-column',
      blocks: [
        { type: 'cards', columns: 1, items: [{ title: '课堂观察点', fields: normalizeTextItems(plan.observationPoints).map((value, index) => ({ label: `${index + 1}`, value })) }] },
        { type: 'cards', columns: 1, items: [{ title: '课堂应变预案', fields: normalizeTextItems(plan.contingencies).map((value, index) => ({ label: `${index + 1}`, value })) }] }
      ]
    },
    {
      id: 'reflection', title: '课后反思', layout: 'grid',
      blocks: [{ type: 'cards', columns: 2, items: normalizeTextItems(plan.reflection).map((title) => ({ title, body: '____________________________________________________________' })) }]
    }
  ];
}

function normalizeMeta(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 12).map((item) => ({
    label: richString(item?.label || item?.name).trim(),
    value: richString(item?.value ?? item?.text).trim()
  })).filter((item) => item.label || item.value);
}

export function isDynamicLessonDocument(plan) {
  return Boolean(plan && Array.isArray(plan.sections));
}

export function normalizeLessonDocument(value, form = {}, fallbackValue = null) {
  const rawValue = value?.document && typeof value.document === 'object' ? value.document : value;
  const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const fallback = fallbackValue && fallbackValue !== value
    ? normalizeLessonDocument(fallbackValue, form)
    : null;
  const sourceHasSections = hasOwn(source, 'sections') && Array.isArray(source.sections);
  const sectionSource = sourceHasSections
    ? source.sections
    : fallback?.sections || legacySections(source);
  const title = richString(source.title || source.cover?.title || fallback?.title || `《${form.lesson || '本课'}》备课方案`).trim();
  const fallbackCover = fallback?.cover || {};
  const coverSource = source.cover && typeof source.cover === 'object' ? source.cover : {};
  const defaultMeta = legacyMeta(form);
  const usedIds = new Set();

  return {
    documentVersion: 3,
    title,
    cover: {
      kicker: richString(coverSource.kicker ?? fallbackCover.kicker ?? '教 师 备 课 教 案').trim(),
      title: richString(coverSource.title || title).trim(),
      subtitle: richString(coverSource.subtitle ?? fallbackCover.subtitle ?? '课标对齐 · 学情诊断 · 任务驱动 · 教学评一致').trim(),
      meta: normalizeMeta(coverSource.meta, fallbackCover.meta || defaultMeta)
    },
    appearance: {
      theme: THEMES.has(source.appearance?.theme) ? source.appearance.theme : fallback?.appearance?.theme || 'classic',
      density: DENSITIES.has(source.appearance?.density) ? source.appearance.density : fallback?.appearance?.density || 'comfortable',
      pageLayout: PAGE_LAYOUTS.has(source.appearance?.pageLayout) ? source.appearance.pageLayout : fallback?.appearance?.pageLayout || 'single'
    },
    sections: sectionSource.slice(0, MAX_SECTIONS).map((section, index) => normalizeSection(section, index, usedIds)),
    footer: {
      brand: richString(source.footer?.brand ?? fallback?.footer?.brand ?? '教师备课器 · AI生成初稿').trim(),
      note: richString(source.footer?.note ?? fallback?.footer?.note ?? '请结合教材、学生和真实课堂节奏进行专业调整').trim()
    },
    duration: Number(form.duration) || Number(source.duration) || Number(fallback?.duration) || 45
  };
}

function blockTextLines(block) {
  if (block.type === 'paragraph') return block.text ? [block.text] : [];
  if (block.type === 'list') return block.items.map((item, index) => block.style === 'ordered' ? `${index + 1}. ${item}` : `${block.style === 'check' ? '□' : '-'} ${item}`);
  if (block.type === 'keyValue') return block.items.map((item) => `${item.label}${item.label ? '：' : ''}${item.value}`);
  if (block.type === 'cards' || block.type === 'timeline') {
    return block.items.flatMap((item, index) => [
      `${index + 1}. ${item.title || ''}${item.meta ? `（${item.meta}）` : ''}`,
      item.subtitle || '',
      item.body || '',
      ...item.fields.map((field) => `${field.label}${field.label ? '：' : ''}${field.value}`)
    ].filter(Boolean));
  }
  if (block.type === 'table') return [block.headers.join('\t'), ...block.rows.map((row) => row.join('\t'))].filter(Boolean);
  if (block.type === 'image') return [`[图片] ${block.alt || ''}`, block.caption || ''].filter(Boolean);
  if (block.type === 'svg') return [`[图示] ${block.caption || ''}`.trim()];
  return [];
}

export function lessonDocumentToText(plan, form = {}) {
  const documentPlan = normalizeLessonDocument(plan, form);
  const lines = [
    documentPlan.cover.title || documentPlan.title,
    documentPlan.cover.subtitle,
    ...documentPlan.cover.meta.map((item) => `${item.label}${item.label ? '：' : ''}${item.value}`)
  ].filter(Boolean);
  documentPlan.sections.forEach((section, index) => {
    lines.push('', `${index + 1}、${section.title}`);
    section.blocks.forEach((block) => lines.push(...blockTextLines(block)));
  });
  if (documentPlan.footer.note) lines.push('', documentPlan.footer.note);
  return lines.join('\n');
}

export const lessonDocumentContract = {
  sectionLayouts: [...SECTION_LAYOUTS],
  themes: [...THEMES],
  densities: [...DENSITIES],
  pageLayouts: [...PAGE_LAYOUTS]
};
