const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');
const { createCanvas } = require('@napi-rs/canvas');
const JSZip = require('jszip');
const { createApp } = require('../server/app');
const { analyzeWithAi, getChatUrl } = require('../server/ai-client');
const { parseQuestionFile } = require('../server/file-parser');
const { normalizeMathText, normalizeReportMath, splitMathSegments, validateReportMath } = require('../server/math-content');
const { buildDocx, buildReportHtml } = require('../server/report-export');
const { reportSchema } = require('../server/schemas');
const { latexToOmml } = require('../server/word-math');
const exportPayloadFixture = require('./fixtures/cross-subject-export.json');

const app = createApp();

function createExportPayload() {
  return structuredClone(exportPayloadFixture);
}

function countFormulas(value) {
  if (typeof value === 'string') {
    return splitMathSegments(normalizeMathText(value)).filter((segment) => segment.type === 'math').length;
  }
  if (Array.isArray(value)) return value.reduce((total, item) => total + countFormulas(item), 0);
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((total, item) => total + countFormulas(item), 0);
  }
  return 0;
}

function countExpectedWordFormulas(report) {
  const affected = report.timeline.filter((item) => item.stepNumber > report.firstError.stepNumber);
  const chainItems = affected.length ? affected : report.timeline.filter((item) => item.status === '未判断');
  return countFormulas(report) + countFormulas(chainItems.map((item) => item.detail));
}

test('健康检查返回服务状态', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.service, 'ai-error-diagnosis');
});

test('主页面与配置页面可访问', async () => {
  const [main, settings] = await Promise.all([
    request(app).get('/').expect(200),
    request(app).get('/settings.html').expect(200),
  ]);
  assert.match(main.text, /AI 错因判断/);
  assert.match(settings.text, /连接你的分析模型/);
});

test('公开配置永不返回 API 密钥', async () => {
  const response = await request(app).get('/api/config').expect(200);
  assert.equal(response.body.ok, true);
  assert.equal(Object.hasOwn(response.body.config, 'apiKey'), false);
  assert.equal(typeof response.body.config.hasApiKey, 'boolean');
});

test('配置接口拒绝无效 URL', async () => {
  const response = await request(app)
    .put('/api/config')
    .send({
      provider: 'custom',
      baseUrl: '不是网址',
      model: 'test-model',
      temperature: 0.2,
      timeoutMs: 90000,
    })
    .expect(400);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
});

test('分析接口要求上传题目文件', async () => {
  const response = await request(app)
    .post('/api/analyze')
    .field('subject', '数学')
    .expect(422);
  assert.equal(response.body.code, 'FILE_PARSE_ERROR');
});

test('图片可完成解析并转换为视觉模型输入', async () => {
  const canvas = createCanvas(120, 80);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 120, 80);
  context.fillStyle = '#111111';
  context.font = '18px sans-serif';
  context.fillText('1 + 1 = 3', 12, 44);
  const image = await canvas.encode('png');

  const parsed = await parseQuestionFile({
    originalname: '题目.png',
    buffer: image,
  });

  assert.equal(parsed.text, '');
  assert.equal(parsed.images.length, 1);
  assert.match(parsed.images[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.deepEqual(parsed.warnings, []);
});

test('Chat Completions 地址拼接兼容根地址与完整地址', () => {
  assert.equal(getChatUrl('https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions');
  assert.equal(getChatUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
});

test('AI 客户端可修复 JSON 字符串中的单反斜杠 LaTeX', async (context) => {
  const modelReport = createExportPayload().report;
  modelReport.errorTypeReason = String.raw`错误使用了 \frac{1}{2}`;
  const rawReport = JSON.stringify(modelReport).replace('\\\\frac', '\\frac');
  const mockServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: rawReport } }] }));
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => mockServer.close(resolve)));

  const report = await analyzeWithAi({
    provider: 'custom',
    baseUrl: `http://127.0.0.1:${mockServer.address().port}/v1`,
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0.2,
    timeoutMs: 10000,
  }, {
    subject: '数学',
    studentAnswer: '测试答案',
    correctAnswer: '测试正确答案',
    standardProcess: '',
    scoringCriteria: '',
    selfAssessment: '',
  }, { text: '测试题目', images: [] });

  assert.match(report.errorTypeReason, /\\frac/u);
});

test('信息不足报告必须使用步骤 0 且不伪造首错', () => {
  const report = {
    firstError: { stepNumber: 0, stepName: '无法确定', description: '缺少学生过程', impact: '无法判断错误链' },
    evidence: '只提供了最终答案，没有作答过程',
    errorType: '信息不足，无法确定',
    errorTypeReason: '缺少判断首错所需的直接证据',
    timeline: [1, 2, 3, 4].map((stepNumber, index) => ({
      stepNumber,
      stepName: ['题意读取', '方法选择', '列式计算', '最终答案'][index],
      status: '未判断',
      detail: '没有足够证据',
    })),
    comparison: { studentJudgment: '未提供', aiJudgment: '信息不足，无法确定', conclusion: '无法比较' },
    correction: { action: '补充完整作答过程', rationale: '需要直接证据', checklist: ['保留原答案', '补充每一步过程'] },
    needsTeacherReview: true,
    reviewReason: '需要教师核对原始答卷',
    confidence: 0.2,
  };
  assert.equal(reportSchema.safeParse(report).success, true);

  report.firstError.stepNumber = 2;
  assert.equal(reportSchema.safeParse(report).success, false);
});

test('AI 客户端可从兼容接口生成并校验完整报告', async (context) => {
  const modelReport = {
    firstError: { stepNumber: 2, stepName: '方法选择', description: '使用了错误公式', impact: '后续列式和答案均受影响' },
    evidence: '学生写出了 a+b÷2，而不是 (a+b)÷2',
    errorType: '方法选择错误',
    errorTypeReason: '运算前选择的表达式结构错误',
    timeline: [
      { stepNumber: 1, stepName: '题意读取', status: '正确', detail: '条件读取完整' },
      { stepNumber: 2, stepName: '方法选择', status: '首次出错', detail: '公式选择错误' },
      { stepNumber: 3, stepName: '列式计算', status: '受影响', detail: '基于错误公式计算' },
      { stepNumber: 4, stepName: '最终答案', status: '受影响', detail: '结果随之错误' },
    ],
    comparison: { studentJudgment: '运算粗心', aiJudgment: '方法选择错误', conclusion: '两者不一致' },
    correction: { action: '先用括号写出完整公式', rationale: '先纠正方法再计算', checklist: ['圈出两个量', '写出带括号公式'] },
    needsTeacherReview: false,
    reviewReason: '',
    confidence: 0.91,
  };
  let requestPath = '';
  const mockServer = http.createServer((req, res) => {
    requestPath = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelReport) } }] }));
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => mockServer.close(resolve)));

  const address = mockServer.address();
  const report = await analyzeWithAi({
    provider: 'custom',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0.2,
    timeoutMs: 10000,
  }, {
    subject: '数学',
    studentAnswer: 'a+b÷2',
    correctAnswer: '(a+b)÷2',
    standardProcess: '',
    scoringCriteria: '',
    selfAssessment: '运算粗心',
  }, { text: '求两个数的平均数', images: [] });

  assert.equal(requestPath, '/v1/chat/completions');
  assert.equal(report.errorType, '方法选择错误');
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('跨学科公式统一规范化并通过 KaTeX 与 mhchem 校验', () => {
  const normalized = normalizeReportMath(createExportPayload().report);
  assert.deepEqual(validateReportMath(normalized), []);
  assert.match(normalized.evidence, /\\ce\{2H2 \+ O2 -> 2H2O\}/);
  assert.match(normalized.errorTypeReason, /30\^\\circ\\mathrm\{N\}/);
  assert.equal(normalizeMathText('速度关系 v=s/t。'), '速度关系 \\(v=s/t\\)。');

  const invalid = { ...normalized, evidence: '错误公式：\\(\\frac{1}{\\)' };
  assert.equal(validateReportMath(invalid).length, 1);
});

test('PDF 报告模板内联公式并禁止完整模块跨页切割', async () => {
  const html = await buildReportHtml(createExportPayload());
  assert.match(html, /break-inside:\s*avoid-page/);
  assert.match(html, /page-break-inside:\s*avoid/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-mathml"/);
  assert.match(html, /class="katex-html"/);
});

test('Word 报告正文和全部公式均为原生可编辑结构', async () => {
  const payload = createExportPayload();
  const { buffer, filename } = await buildDocx(payload);
  assert.match(filename, /^AI错因诊断报告-跨学科验收-20260718\.docx$/);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /AI 错因诊断报告/);
  assert.match(documentXml, /方法选择错误/);
  assert.equal((documentXml.match(/<m:oMath\b/g) || []).length, countExpectedWordFormulas(payload.report));
  assert.match(documentXml, /<m:f>/);
  assert.match(documentXml, /<m:rad>/);
  assert.match(documentXml, /<m:sSub>/);
  assert.match(documentXml, /<m:sSup>/);
  assert.doesNotMatch(documentXml, /<w:drawing\b|r:embed=|AIOMML|m:val="undefined"/);
  const mediaFiles = Object.keys(zip.files).filter((name) => /^word\/media\//.test(name) && !zip.files[name].dir);
  assert.deepEqual(mediaFiles, []);
});

test('Word 原生公式对抗样例保持正确结构并拒绝不可转换排版', async () => {
  const cases = [
    [String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`, /<m:f>[\s\S]*<m:rad>/],
    [String.raw`\int_{0}^{\infty}e^{-x}\,dx`, /<m:nary>/],
    [String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, /<m:m>/],
    [String.raw`\ce{Ca^{2+} + CO3^{2-} -> CaCO3 v}`, /<m:sSup>[\s\S]*<m:sSub>[\s\S]*↓/],
    [String.raw`\ce{CH3COOH <=> CH3COO- + H+}`, /⇌/],
  ];

  for (const [latex, expectedStructure] of cases) {
    const omml = await latexToOmml(latex);
    assert.match(omml, /^<m:oMath\b/);
    assert.match(omml, expectedStructure);
    assert.doesNotMatch(omml, /<w:drawing\b|r:embed=|m:val="undefined"/);
  }

  const chemistry = await latexToOmml(String.raw`\ce{2H2 + O2 -> 2H2O}`);
  assert.doesNotMatch(chemistry, /<m:t[^>]*>A<\/m:t>/);
  await assert.rejects(() => latexToOmml(String.raw`\phantom{x}+1`), /不支持非化学公式/);
});

test('PDF 与 Word 导出接口返回可下载的正确文件类型', async () => {
  const payload = createExportPayload();
  const docxResponse = await request(app)
    .post('/api/export/docx')
    .send(payload)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.match(docxResponse.headers['content-type'], /application\/vnd\.openxmlformats/);
  assert.match(docxResponse.headers['content-disposition'], /filename\*=UTF-8''/);
  assert.equal(docxResponse.body.subarray(0, 2).toString(), 'PK');

  const pdfResponse = await request(app)
    .post('/api/export/pdf')
    .send(payload)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.match(pdfResponse.headers['content-type'], /application\/pdf/);
  assert.equal(pdfResponse.body.subarray(0, 4).toString(), '%PDF');
});
