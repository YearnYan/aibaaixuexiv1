import { sanitizeBlackboard } from './lessonText.js';
import { splitRichContent, svgToAccessibleText } from './scientificText.js';
import { createEditableWordMath } from './wordMath.js';
import { createDynamicLessonDocxBlob } from './exportDynamicDocx.js';
import { isDynamicLessonDocument, normalizeLessonDocument } from './lessonDocument.js';

const DOC_GREEN = '1F6B55';
const DOC_GREEN_DARK = '173F34';
const DOC_GOLD = 'B28B2D';
const DOC_TEXT = '293A34';
const DOC_MUTED = '68756F';
const DOC_LINE = 'CDDAD4';
const DOC_FILL = 'EAF2EE';

function cleanList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
}

function asObjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

function joinFilled(values, separator = ' · ') {
  return values.map((value) => String(value || '').trim()).filter(Boolean).join(separator);
}

export async function createLessonDocxBlob(plan, form, options = {}) {
  if (isDynamicLessonDocument(plan)) return createDynamicLessonDocxBlob(normalizeLessonDocument(plan, form), form, options);
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    HeadingLevel,
    LevelFormat,
    Math: WordMath,
    MathFraction,
    MathRadical,
    MathRoundBrackets,
    MathRun,
    MathSquareBrackets,
    MathSubScript,
    MathSubSuperScript,
    MathSuperScript,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType
  } = await import('docx');

  const border = { style: BorderStyle.SINGLE, size: 4, color: DOC_LINE };
  const cellMargins = { top: 100, bottom: 100, left: 120, right: 120 };
  const normalText = (text, options = {}) => new TextRun({ text: String(text || ''), color: DOC_TEXT, size: 22, ...options });
  const richRuns = (text, options = {}) => splitRichContent(text).flatMap((segment) => {
    if (segment.type === 'text') return segment.value ? [normalText(segment.value, options)] : [];
    if (segment.type === 'svg') return [normalText(svgToAccessibleText(segment.value), { ...options, italic: true, color: DOC_MUTED })];
    return [createEditableWordMath(segment.value, {
      Math: WordMath,
      MathFraction,
      MathRadical,
      MathRoundBrackets,
      MathRun,
      MathSquareBrackets,
      MathSubScript,
      MathSubSuperScript,
      MathSuperScript
    })];
  });
  const bodyParagraph = (text, options = {}) => new Paragraph({
    spacing: { after: 120, line: 300 },
    children: richRuns(text),
    ...options
  });
  const labeledParagraph = (label, text) => new Paragraph({
    spacing: { after: 100, line: 300 },
    children: [
      ...richRuns(`${label}：`, { bold: true, color: DOC_GREEN_DARK }),
      ...richRuns(text)
    ]
  });
  const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({
    heading: level,
    keepNext: true,
    children: [new TextRun({ text, bold: true })]
  });
  const numbered = (items, reference) => cleanList(items).map((item) => new Paragraph({
    numbering: { reference, level: 0 },
    spacing: { after: 80, line: 300 },
    children: richRuns(String(item).replace(/^\d+[.、]\s*/, ''))
  }));
  const bullet = (items) => cleanList(items).map((item) => new Paragraph({
    numbering: { reference: 'lesson-bullets', level: 0 },
    spacing: { after: 80, line: 300 },
    children: richRuns(item)
  }));
  const itemHeading = (text, meta = '') => new Paragraph({
    heading: HeadingLevel.HEADING_3,
    keepNext: true,
    spacing: { before: 160, after: 90 },
    children: [
      ...richRuns(text, { bold: true, color: DOC_GREEN_DARK }),
      ...(meta ? [new TextRun({ text: `    ${meta}`, bold: true, color: DOC_GOLD, size: 20 })] : [])
    ]
  });
  const metaCell = (text, isLabel = false, width = 2340) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: cellMargins,
    shading: isLabel ? { fill: DOC_FILL, type: ShadingType.CLEAR } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      children: richRuns(text, { bold: isLabel, color: isLabel ? DOC_GREEN_DARK : DOC_TEXT, size: 20 })
    })]
  });

  const standards = plan.standardsAlignment || {};
  const learner = plan.learnerProfile || {};
  const goals = cleanList(plan.goals);
  const goalEvidence = asObjects(plan.goalEvidence).length
    ? asObjects(plan.goalEvidence)
    : goals.map((goal) => ({ goal, evidence: '课堂学习任务中的可观察产出。', successCriteria: '依据目标要求完成，并能说明理由。' }));
  const strategies = cleanList(plan.breakthroughStrategies);
  const preparation = cleanList(plan.preparation);
  const flow = asObjects(plan.flow);
  const questionChain = asObjects(plan.questionChain).length
    ? asObjects(plan.questionChain)
    : cleanList(plan.questions).map((question) => ({ question, intent: '检查目标达成情况。', expectedResponse: '能结合学习内容作答。', followUp: '请补充证据或说明理由。' }));
  const practice = asObjects(plan.practice).length
    ? asObjects(plan.practice)
    : cleanList(plan.practice).map((text, index) => ({ level: `任务 ${index + 1}`, text }));
  const homeworkDesign = asObjects(plan.homeworkDesign).length
    ? asObjects(plan.homeworkDesign)
    : cleanList(plan.homework).map((task, index) => ({ level: index ? '选做' : '必做', task, purpose: '巩固课堂学习成果。', estimatedMinutes: '', feedback: '教师结合完成情况反馈。' }));
  const rubric = asObjects(plan.assessmentRubric).length
    ? asObjects(plan.assessmentRubric)
    : cleanList(plan.evaluation).map((achieved, index) => ({ dimension: `评价维度 ${index + 1}`, achieved, developing: '在提示下基本完成。', evidence: '课堂学习产出。' }));
  const observationPoints = cleanList(plan.observationPoints);
  const contingencies = cleanList(plan.contingencies);
  const reflection = cleanList(plan.reflection);
  const title = plan.title || `《${form.lesson || '本课'}》备课方案`;

  const documentChildren = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 100 },
      children: [new TextRun({ text: '教 师 备 课 教 案', bold: true, color: DOC_GOLD, size: 20, characterSpacing: 120 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: richRuns(title, { bold: true, color: DOC_GREEN_DARK, size: 38 })
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({ text: '课标对齐 · 学情诊断 · 任务驱动 · 教学评一致', color: DOC_MUTED, size: 20 })]
    }),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      indent: { size: 120, type: WidthType.DXA },
      columnWidths: [1300, 3380, 1300, 3380],
      rows: [
        new TableRow({ children: [metaCell('年级学科', true, 1300), metaCell(joinFilled([form.grade, form.subject]), false, 3380), metaCell('课时安排', true, 1300), metaCell(joinFilled([form.period, `${form.duration || 45}分钟`]), false, 3380)] }),
        new TableRow({ children: [metaCell('教材章节', true, 1300), metaCell(form.textbook || '', false, 3380), metaCell('课堂方式', true, 1300), metaCell(form.style || '', false, 3380)] })
      ]
    }),
    bodyParagraph('', { spacing: { after: 100 } }),
    heading('一、课程标准与课时定位'),
    labeledParagraph('课标依据', standards.courseStandard || '请结合当前学段、学科课程标准与教材版本复核。'),
    labeledParagraph('核心素养', standards.coreLiteracy || '请结合学科课程标准补充。'),
    labeledParagraph('单元定位', standards.unitPosition || '请结合单元目标补充。'),
    labeledParagraph('课时价值', standards.lessonValue || '请结合本课时在单元中的作用补充。'),
    heading('二、学情诊断'),
    bodyParagraph(plan.learningAnalysis || '请结合班级实际补充学情分析。'),
    labeledParagraph('已有基础', cleanList(learner.priorKnowledge).join('；')),
    labeledParagraph('学习障碍', cleanList(learner.learningGaps).join('；')),
    labeledParagraph('常见误区', cleanList(learner.misconceptions).join('；')),
    labeledParagraph('差异与支持', cleanList(learner.differences).join('；')),
    heading('三、教学目标与达成证据')
  ];

  goalEvidence.forEach((item, index) => {
    documentChildren.push(
      itemHeading(`${index + 1}. ${item.goal || goals[index] || `学习目标 ${index + 1}`}`),
      labeledParagraph('学习证据', item.evidence || '课堂学习任务中的可观察产出。'),
      labeledParagraph('成功标准', item.successCriteria || '依据目标要求完成，并能说明理由。')
    );
  });

  documentChildren.push(
    heading('四、教学重点、难点与突破'),
    ...String(plan.focus || '').split('\n').filter(Boolean).map((line) => bodyParagraph(line)),
    ...numbered(strategies, 'strategy-numbering'),
    heading('五、教学准备'),
    ...bullet(preparation),
    heading('六、教学过程')
  );

  flow.forEach((row, index) => {
    documentChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        spacing: { before: 180, after: 100 },
        children: [
          normalText(`${String(index + 1).padStart(2, '0')}  `, { bold: true, color: DOC_GREEN_DARK }),
          ...richRuns(row.name || `教学环节 ${index + 1}`, { bold: true, color: DOC_GREEN_DARK }),
          new TextRun({ text: `    ${row.time || 0} 分钟`, bold: true, color: DOC_GOLD, size: 20 })
        ]
      }),
      labeledParagraph('任务目标', row.taskGoal || '完成本环节学习任务。'),
      labeledParagraph('情境 / 任务', row.context || '围绕本课内容开展学习任务。'),
      labeledParagraph('教师活动', row.teacherAction || row.activity || ''),
      labeledParagraph('学生活动', row.studentAction || row.activity || ''),
      labeledParagraph('学习产出', row.learningProduct || '形成可检查的课堂产出。'),
      labeledParagraph('支架与分层', row.scaffold || '根据学生差异提供提示和进阶任务。'),
      labeledParagraph('设计意图', row.design || ''),
      labeledParagraph('观察与评价', row.evaluation || row.design || '')
    );
  });

  documentChildren.push(heading('七、递进问题链'));
  questionChain.forEach((item, index) => {
    documentChildren.push(
      itemHeading(`Q${index + 1}  ${item.question || `问题 ${index + 1}`}`),
      labeledParagraph('设计意图', item.intent || '检查目标达成情况。'),
      labeledParagraph('预期要点', item.expectedResponse || '能结合学习内容作答。'),
      labeledParagraph('追问纠偏', item.followUp || '请补充证据或说明理由。')
    );
  });

  documentChildren.push(heading('八、随堂分层练习'));
  practice.forEach((item, index) => {
    documentChildren.push(
      itemHeading(item.level || `任务 ${index + 1}`),
      bodyParagraph(item.text || String(item)),
      labeledParagraph('设计目的', item.purpose || '检查并巩固本课目标。'),
      labeledParagraph('成功标准', item.successCriteria || '依据任务要求完整作答。'),
      labeledParagraph('答案要点', item.referenceAnswer || '答案开放，请依据学习目标和成功标准评价。')
    );
  });

  documentChildren.push(heading('九、分层作业与反馈'));
  homeworkDesign.forEach((item, index) => {
    const timeLabel = item.estimatedMinutes ? `预计 ${item.estimatedMinutes} 分钟` : '';
    documentChildren.push(
      itemHeading(`${item.level || `作业 ${index + 1}`}｜${item.task || ''}`, timeLabel),
      labeledParagraph('设计目的', item.purpose || '巩固课堂学习成果。'),
      labeledParagraph('反馈方式', item.feedback || '教师结合完成情况提供具体反馈。')
    );
  });
  documentChildren.push(
    bodyParagraph('作业预计用时需计入学生当天各学科作业总量，由教师结合学校要求和班级实际调整。', {
      spacing: { before: 120, after: 160 },
      children: [new TextRun({ text: '作业总量提示：', bold: true, color: DOC_GOLD, size: 19 }), new TextRun({ text: '作业预计用时需计入学生当天各学科作业总量，由教师结合学校要求和班级实际调整。', color: DOC_MUTED, size: 19 })]
    }),
    heading('十、板书设计'),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      indent: { size: 120, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        margins: { top: 180, bottom: 180, left: 220, right: 220 },
        shading: { fill: 'F0F7F3', type: ShadingType.CLEAR },
        borders: { top: border, bottom: border, left: border, right: border },
        children: sanitizeBlackboard(plan.blackboard).split('\n').filter(Boolean).map((line) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 90 }, children: richRuns(line, { bold: true, color: DOC_GREEN_DARK }) }))
      })] })]
    }),
    bodyParagraph('', { spacing: { after: 80 } }),
    heading('十一、教学评价量规')
  );

  rubric.forEach((item, index) => {
    documentChildren.push(
      itemHeading(`${index + 1}. ${item.dimension || `评价维度 ${index + 1}`}`),
      labeledParagraph('目标达成', item.achieved || ''),
      labeledParagraph('发展中', item.developing || ''),
      labeledParagraph('证据来源', item.evidence || '')
    );
  });

  documentChildren.push(
    heading('十二、课堂观察与应变预案'),
    itemHeading('课堂观察点'),
    ...numbered(observationPoints, 'observation-numbering'),
    itemHeading('课堂应变预案'),
    ...numbered(contingencies, 'contingency-numbering'),
    heading('十三、课后反思'),
    ...reflection.map((item) => labeledParagraph(item, '____________________________________________________________')),
    bodyParagraph('教师可在课后依据目标达成证据、学生典型错误和课堂时间记录修订本教案，并将改进措施用于下一课时。', {
      spacing: { before: 220, after: 0 },
      children: [new TextRun({ text: '使用提示：', bold: true, color: DOC_GOLD, size: 19 }), new TextRun({ text: '教师可在课后依据目标达成证据、学生典型错误和课堂时间记录修订本教案，并将改进措施用于下一课时。', color: DOC_MUTED, size: 19 })]
    })
  );

  const decimalConfig = (reference) => ({
    reference,
    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }]
  });
  const doc = new Document({
    creator: '教师备课器',
    title,
    description: 'AI 生成的可编辑 K12 专业备课教案',
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22, color: DOC_TEXT }, paragraph: { spacing: { after: 120, line: 300 } } },
        heading1: { run: { font: 'Microsoft YaHei', size: 32, bold: true, color: DOC_GREEN }, paragraph: { spacing: { before: 360, after: 200 }, keepNext: true } },
        heading2: { run: { font: 'Microsoft YaHei', size: 26, bold: true, color: DOC_GREEN_DARK }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
        heading3: { run: { font: 'Microsoft YaHei', size: 24, bold: true, color: DOC_GOLD }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true } }
      }
    },
    numbering: {
      config: [
        decimalConfig('strategy-numbering'),
        decimalConfig('observation-numbering'),
        decimalConfig('contingency-numbering'),
        { reference: 'lesson-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] }
      ]
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, right: 900, bottom: 900, left: 900, header: 420, footer: 420 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: richRuns(joinFilled([joinFilled([form.grade, form.subject], ''), form.lesson]), { color: DOC_MUTED, size: 17 }) })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['教师备课教案  ·  第 ', PageNumber.CURRENT, ' 页'], color: DOC_MUTED, size: 17 })] })] }) },
      children: documentChildren
    }]
  });

  return Packer.toBlob(doc);
}

export async function exportLessonDocx(plan, form) {
  const blob = await createLessonDocxBlob(plan, form);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${String(form.lesson || '备课教案').replace(/[\\/:*?"<>|]/g, '-')}-${form.period || ''}.docx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
