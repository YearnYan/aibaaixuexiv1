import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, repairJsonText } from '../model-json.mjs';

test('解析标准 JSON 和代码围栏', () => {
  assert.deepEqual(parseModelJson('```json\n{"ok":true,"title":"春"}\n```'), { ok: true, title: '春' });
});

test('修复字符串中的非法反斜杠转义', () => {
  const source = String.raw`{"formula":"用\\(a+b\\)表示","ok":true}`;
  const result = parseModelJson(source);
  assert.equal(result.formula, String.raw`用\(a+b\)表示`);
  assert.equal(result.ok, true);
});

test('修复字符串中的原始换行和未转义引号', () => {
  const source = `{"text":"第一行
第二行包含"关键证据"","ok":true}`;
  const result = parseModelJson(source);
  assert.equal(result.text, '第一行\n第二行包含"关键证据"');
});

test('修复对象和数组末尾多余逗号', () => {
  const repaired = repairJsonText('{"items":["一","二",],"meta":{"ok":true,},}');
  assert.deepEqual(JSON.parse(repaired), { items: ['一', '二'], meta: { ok: true } });
});

test('可以从模型解释文字中提取 JSON 对象', () => {
  assert.deepEqual(parseModelJson('以下是结果：\n{"ok":true}\n请查收。'), { ok: true });
});
