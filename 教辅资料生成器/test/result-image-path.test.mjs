import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPlatformRoutePrefix,
  getPlatformSiteKey,
  resolveResultImageUrl,
} from '../public/result-image-path.js';

test('主站模式把生成图片映射到当前子站代理路径', () => {
  assert.equal(
    resolveResultImageUrl('/generated/batch/page.png', 'teaching-aid'),
    '/apps/teaching-aid/generated/batch/page.png',
  );
});

test('独立模式和非生成资源保持原地址', () => {
  assert.equal(resolveResultImageUrl('/generated/batch/page.png'), '/generated/batch/page.png');
  assert.equal(
    resolveResultImageUrl('/generated/batch/page.png', '', { pathname: '/' }),
    '/generated/batch/page.png',
  );
  assert.equal(resolveResultImageUrl('https://cdn.example/image.png', 'teaching-aid'), 'https://cdn.example/image.png');
  assert.equal(resolveResultImageUrl('data:image/png;base64,AAAA', 'teaching-aid'), 'data:image/png;base64,AAAA');
});

test('没有元标签时按本地中文子站路径补齐图片地址', () => {
  const locationRef = { pathname: '/教辅资料生成器/' };
  assert.equal(getPlatformRoutePrefix(locationRef), '/教辅资料生成器');
  assert.equal(
    resolveResultImageUrl('/generated/batch/page.png', '', locationRef),
    '/教辅资料生成器/generated/batch/page.png',
  );
});

test('浏览器返回编码后的中文路径时仍保持代理前缀', () => {
  const locationRef = { pathname: '/%E6%95%99%E8%BE%85%E8%B5%84%E6%96%99%E7%94%9F%E6%88%90%E5%99%A8/' };
  assert.equal(
    resolveResultImageUrl('/generated/batch/page.png', '', locationRef),
    '/%E6%95%99%E8%BE%85%E8%B5%84%E6%96%99%E7%94%9F%E6%88%90%E5%99%A8/generated/batch/page.png',
  );
});

test('没有元标签时按 apps 子站路径补齐图片地址', () => {
  const locationRef = { pathname: '/apps/teaching-aid/' };
  assert.equal(getPlatformRoutePrefix(locationRef), '/apps/teaching-aid');
  assert.equal(
    resolveResultImageUrl('/generated/batch/page.png', '', locationRef),
    '/apps/teaching-aid/generated/batch/page.png',
  );
});

test('已有子站前缀的图片地址不会重复拼接', () => {
  const locationRef = { pathname: '/教辅资料生成器/' };
  assert.equal(
    resolveResultImageUrl('/教辅资料生成器/generated/batch/page.png', '', locationRef),
    '/教辅资料生成器/generated/batch/page.png',
  );
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
