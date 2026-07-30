const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  areAllQuestionsSelected,
  setAllQuestionsSelected
} = require('../shared/question-selection');

test('全选状态只由题目总数和唯一 Set 状态派生', () => {
  const selected = new Set();
  assert.equal(areAllQuestionsSelected(selected, 0), false);
  assert.equal(areAllQuestionsSelected(selected, 3), false);

  setAllQuestionsSelected(selected, 3, true);
  assert.deepEqual([...selected], [0, 1, 2]);
  assert.equal(areAllQuestionsSelected(selected, 3), true);

  selected.delete(1);
  assert.equal(areAllQuestionsSelected(selected, 3), false);
  setAllQuestionsSelected(selected, 3, false);
  assert.equal(selected.size, 0);
});

test('全选操作处理非法题量且拒绝非 Set 状态', () => {
  const selected = new Set([99]);
  setAllQuestionsSelected(selected, -1, true);
  assert.equal(selected.size, 0);
  assert.throws(() => setAllQuestionsSelected([], 2, true), /必须是 Set/);
});

test('组卷栏包含可访问的全选按钮且题图尺寸契约不会被覆盖', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'src/app-entry.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');

  assert.match(html, /id="selectAllBtn"[^>]*aria-pressed="false"/);
  assert.match(entry, /bindEvent\('selectAllBtn', 'click', \(\) => window\.toggleSelectAllQuestions\(\)\)/);
  assert.match(main, /button\.textContent = allSelected \? '取消全选' : '全选'/);
  assert.match(main, /button\.setAttribute\('aria-pressed'/);

  const cardFigureRule = css.match(/\.question-card \.q-figure svg\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.match(cardFigureRule, /width:\s*280px/);
  assert.match(cardFigureRule, /height:\s*auto/);
  assert.match(cardFigureRule, /aspect-ratio:\s*4\s*\/\s*3/);
});

test('已有题目在其他内容生成期间仍可续题、选择和组卷', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');

  const progressFunction = main.match(/function updateFigureProgressBanner[\s\S]*?\n}\n\nasync function consumeUnifiedCredit/)?.[0] || '';
  const clickFunction = main.match(/function bindQuestionCardClicks[\s\S]*?\n}\n\nfunction updateContinuationButtons/)?.[0] || '';
  const buttonFunction = main.match(/function updateContinuationButtons[\s\S]*?\n}\n\nfunction setContinuationStatus/)?.[0] || '';
  const continueFunction = main.match(/async function continueGenerateForGroup[\s\S]*?\n}\n\nfunction buildFigureRequestPayload/)?.[0] || '';
  const countFunction = main.match(/function updateSelectedCount[\s\S]*?\n}\n\nfunction composeExam/)?.[0] || '';
  const composeFunction = main.match(/function composeExam[\s\S]*?\n}\n\nfunction getTypeOrder/)?.[0] || '';

  assert.match(progressFunction, /composeBtn\.disabled = state\.selectedQuestions\.size === 0;/);
  assert.doesNotMatch(clickFunction, /result-group\.is-appending/);
  assert.match(buttonFunction, /button\.disabled = state\.continuingGroupIds\.has\(button\.dataset\.groupId\);/);
  assert.doesNotMatch(buttonFunction, /figureLoading|figureFailedCount|formulaFailed/);
  assert.match(continueFunction, /state\.continuingGroupIds\.has\(groupId\)/);
  assert.doesNotMatch(continueFunction, /state\.figureLoading|state\.figureFailedCount|state\.formulaFailed/);
  assert.match(countFunction, /composeBtn'\)\.disabled = count === 0;/);
  assert.doesNotMatch(countFunction, /figureLoading|figureFailedCount|continuingGroupIds/);
  assert.doesNotMatch(composeFunction, /state\.continuingGroupIds|state\.figureLoading|state\.figureFailedCount/);
  assert.match(composeFunction, /item\?\.figure && !state\.figureCache\.has\(idx\)/);
  assert.doesNotMatch(css, /\.result-group\.is-appending\s+\.question-card/);
});
