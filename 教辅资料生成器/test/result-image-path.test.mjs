import assert from 'node:assert/strict';
import test from 'node:test';
import { getPlatformSiteKey, resolveResultImageUrl } from '../public/result-image-path.js';

test('主站模式把生成图片映射到当前子站代理路径', () => {
  assert.equal(
    resolveResultImageUrl('/generated/batch/page.png', 'teaching-aid'),
    '/apps/teaching-aid/generated/batch/page.png',
  );
});

test('独立模式和非生成资源保持原地址', () => {
  assert.equal(resolveResultImageUrl('/generated/batch/page.png'), '/generated/batch/page.png');
  assert.equal(resolveResultImageUrl('https://cdn.example/image.png', 'teaching-aid'), 'https://cdn.example/image.png');
  assert.equal(resolveResultImageUrl('data:image/png;base64,AAAA', 'teaching-aid'), 'data:image/png;base64,AAAA');
});

test('平台站点键只接受注入元标记中的安全格式', () => {
  const validDocument = {
    querySelector: () => ({ getAttribute: () => 'teaching-aid' }),
  };
  const invalidDocument = {
    querySelector: () => ({ getAttribute: () => '../other' }),
  };
  assert.equal(getPlatformSiteKey(validDocument), 'teaching-aid');
  assert.equal(getPlatformSiteKey(invalidDocument), '');
});
