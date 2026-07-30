const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('前端固定十题且不存在后台预取和挑战模式', () => {
  assert.match(app, /var BATCH_SIZE = 10/u);
  assert.doesNotMatch(app, /pumpPipeline|activeGenerations|bufferWaiters|challenge|selectMode|state\.mode/u);
  assert.equal((app.match(/generateBatch\(/gu) || []).length, 3);
  assert.match(app, /if \(generationInProgress\) return;\s*generationInProgress = true;\s*if \(!\(await hasGenerationCredit\(\)\)\)/u);
  assert.match(app, /一次性生成10题/u);
  assert.match(app, /继续生成10题/u);
});

test('页面加载本地 KaTeX 与 mhchem，并只展示快速训练说明', () => {
  assert.match(html, /vendor\/katex\/katex\.min\.css/u);
  assert.match(html, /vendor\/katex\/katex\.min\.js/u);
  assert.match(html, /vendor\/katex\/mhchem\.min\.js/u);
  assert.doesNotMatch(html, /挑战模式|训练模式|data-mode/u);
  assert.match(html, /一次生成10题/u);
});
