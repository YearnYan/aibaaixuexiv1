const http = require('node:http');

const port = Number(process.env.PORT || 56110);
const server = http.createServer((request, response) => {
  let requestBody = '';
  request.on('data', (chunk) => { requestBody += chunk; });
  request.on('end', () => {
    const payload = JSON.parse(requestBody || '{}');
    const count = Number(payload.count || 10);
    const questions = Array.from({ length: count }, (_item, index) => ({
      question: `第${index + 1}题：已知 \\(x=${index + 1}\\)，判断 \\(y=2x+1\\) 的变化规律。`,
      difficulty: 3,
      kp_choices: ['一次函数', '整式运算', '方程思想', '数形结合'],
      kp_answer: 0,
      method_choices: ['代入验证', '分类讨论', '反证分析', '作差比较'],
      method_answer: 0,
      trap_choices: ['忽略自变量变化', '混淆运算顺序', '遗漏题设条件', '误读函数关系'],
      trap_answer: 3,
      explanation: `把 \\(x=${index + 1}\\) 代入 \\(y=2x+1\\)，并根据系数 \\(2>0\\) 判断变化规律。`,
    }));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(questions));
  });
});

server.listen(port, '127.0.0.1');
