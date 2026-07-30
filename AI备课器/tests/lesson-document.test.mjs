import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonDocumentToText, normalizeLessonDocument } from '../src/lessonDocument.js';

test('旧版专业教案可以转换为 13 个可编辑动态模块', () => {
  const plan = normalizeLessonDocument({
    title: '函数教案',
    standardsAlignment: { courseStandard: '理解函数关系' },
    flow: [{ name: '函数探究', time: 45 }],
    blackboard: '函数图像'
  }, { grade: '八年级', subject: '数学', period: '第1课时', duration: 45 });

  assert.equal(plan.documentVersion, 3);
  assert.equal(plan.sections.length, 13);
  assert.equal(plan.sections[0].title, '课程标准与课时定位');
  assert.equal(plan.sections[5].blocks[0].type, 'timeline');
  assert.equal(plan.cover.meta[0].value, '八年级 · 数学');
});

test('显式模块清单是最终结果，不会补回旧版固定模块', () => {
  const fallback = normalizeLessonDocument({ title: '原教案', flow: [{ name: '原环节', time: 45 }] }, { duration: 45 });
  const removedAll = normalizeLessonDocument({
    title: '空白研讨稿',
    cover: { title: '空白研讨稿' },
    sections: []
  }, { duration: 45 }, fallback);
  const custom = normalizeLessonDocument({
    title: '自定义教案',
    sections: [{ id: 'custom', title: '自定义模块', layout: 'two-column', blocks: [{ type: 'mystery', content: '仍需可读' }] }]
  }, { duration: 45 }, fallback);

  assert.deepEqual(removedAll.sections, []);
  assert.deepEqual(custom.sections.map((section) => section.title), ['自定义模块']);
  assert.equal(custom.sections[0].blocks[0].type, 'paragraph');
  assert.match(custom.sections[0].blocks[0].text, /仍需可读/);
});

test('动态教案复制文本保持模块标题和顺序', () => {
  const text = lessonDocumentToText({
    title: '全局修改测试',
    cover: { title: '全局修改测试', meta: [] },
    sections: [
      { id: 'b', title: '先展示结论', blocks: [{ type: 'paragraph', text: '结论正文' }] },
      { id: 'a', title: '再展示证据', blocks: [{ type: 'table', headers: ['证据', '说明'], rows: [['实验', '数据']] }] }
    ]
  });

  assert.ok(text.indexOf('先展示结论') < text.indexOf('再展示证据'));
  assert.match(text, /结论正文/);
  assert.match(text, /证据\t说明/);
});

test('图片地址只接受 HTTPS 和安全图片 Data URL', () => {
  const plan = normalizeLessonDocument({
    sections: [{
      id: 'images', title: '图片', blocks: [
        { type: 'image', src: 'javascript:alert(1)', alt: '危险图片' },
        { type: 'image', src: 'http://example.com/a.png', alt: '非安全图片' },
        { type: 'image', src: 'https://example.com/a.png', alt: '安全图片' },
        { type: 'image', src: 'data:image/png;base64,AAAA', alt: '内嵌图片' }
      ]
    }]
  });

  assert.equal(plan.sections[0].blocks[0].src, '');
  assert.equal(plan.sections[0].blocks[1].src, '');
  assert.equal(plan.sections[0].blocks[2].src, 'https://example.com/a.png');
  assert.equal(plan.sections[0].blocks[3].src, 'data:image/png;base64,AAAA');
});

test('旧版多行 SVG 板书转换后保持为完整富内容，不再按行拆散', () => {
  const blackboard = `<svg viewBox="0 0 120 60">
    <rect width="120" height="60" fill="#173f34" />
    <text x="10" y="30">函数图像</text>
  </svg>`;
  const plan = normalizeLessonDocument({ title: '函数教案', blackboard });
  const boardSection = plan.sections.find((section) => section.id === 'blackboard');

  assert.equal(boardSection.layout, 'blackboard');
  assert.equal(boardSection.blocks.length, 1);
  assert.equal(boardSection.blocks[0].type, 'paragraph');
  assert.equal(boardSection.blocks[0].text, blackboard);
});
