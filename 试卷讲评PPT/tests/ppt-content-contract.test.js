const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const aiJson = fs.readFileSync(path.join(root, 'public', 'ai-json.js'), 'utf8');

assert.match(html, /id="explanationPathToggle"/u, '生成前必须提供讲解路径开关');
assert.match(html, /id="answerVisibilityToggle"\s+checked/u, '正确答案开关必须默认开启');
assert.match(html, /id="explanationPathToggle"\s+checked/u, '讲解路径开关必须默认开启');
assert.match(app, /hasExplanationPathVisible/u, '预览和导出必须读取讲解路径开关');
assert.match(app, /viewModel\.showExplanationPath \? `<section class="analysis-zone/u, '关闭时不得渲染讲解路径');
assert.match(styles, /\.slide-content\.layout-choice\.explanation-hidden/u, '关闭讲解路径后必须释放版面空间');

assert.doesNotMatch(styles, /\.option-item\s+svg\s*\{/u, '不得把 MathJax 公式 SVG 强制缩成图标尺寸');
assert.match(styles, /\.option-item\s*>\s*svg\s*\{/u, '正确项图标样式只能命中直属图标');

assert.match(app, /选择题必须完整返回全部 options/u, '识别契约必须要求完整选项');
assert.match(app, /extractChoiceAnswerLetters/u, '缺失 correct 标记时必须从答案或解析恢复正确项');
assert.match(app, /normalizeBooleanFlag/u, '字符串 false 不得被 Boolean\("false"\) 误判为真');
assert.match(app, /AI_RESPONSE_EMPTY/u, '空题目数组必须被明确拒绝');
assert.match(html, /ai-json\.js/u, '页面必须在主脚本前加载 AI JSON 解析模块');

const processFilesFunction = app.match(
    /async function processFiles[\s\S]*?\n\}\n\nfunction validateFiles/u
)?.[0] || '';
const requestFunction = app.match(
    /async function postJSONWithRetry[\s\S]*?\n\}\n\nasync function callAIAPI/u
)?.[0] || '';
assert.match(app, /function createUsageOperationKey\(\)/u, '每次上传必须创建独立计费操作号');
assert.match(
    processFilesFunction,
    /options\.usageOperationKey \|\| createUsageOperationKey\(\)/u,
    '重试必须复用原操作号，新上传才创建新操作号'
);
assert.match(
    processFilesFunction,
    /identifyQuestionsWithAI\([\s\S]*?usageOperationKey[\s\S]*?completeUsageOperation\(usageOperationKey\)/u,
    '同一次上传的全部 AI 批次必须共享操作号并在成功后关闭'
);
assert.match(
    app,
    /headers\['X-HZQ-Usage-Operation'\] = usageOperationKey/u,
    '每个 AI 批次必须携带操作级计费请求头'
);
assert.match(
    requestFunction,
    /buildAIRequestHeaders\(usageOperationKey\)/u,
    '拆批与重试请求必须继续使用同一个操作号'
);
assert.doesNotMatch(
    processFilesFunction,
    /files\.length\s*[*]\s*[^;]*(?:credit|point|积分)|(?:credit|point)\w*\s*[*]\s*files\.length/iu,
    '积分成本不得与上传文件数量相乘'
);

assert.equal(
    fs.readFileSync(path.join(root, 'app.js'), 'utf8'),
    app,
    '根目录与 public 的运行脚本必须保持一致'
);
assert.equal(
    fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
    html,
    '根目录与 public 的页面必须保持一致'
);
assert.equal(
    fs.readFileSync(path.join(root, 'styles.css'), 'utf8'),
    styles,
    '根目录与 public 的样式必须保持一致'
);
assert.equal(
    fs.readFileSync(path.join(root, 'ai-json.js'), 'utf8'),
    aiJson,
    '根目录与 public 的 AI JSON 解析模块必须保持一致'
);

console.log('PPT 内容完整性契约测试通过');
