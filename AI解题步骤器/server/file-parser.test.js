import { describe, expect, it } from 'vitest';
import { parseUploadedFile } from './file-parser.js';

describe('parseUploadedFile', () => {
  it('读取 UTF-8 文本题目', async () => {
    const result = await parseUploadedFile({
      originalname: '题目.txt',
      buffer: Buffer.from('已知 AB = AC，∠A = 40°，求 ∠B。'),
    });
    expect(result.kind).toBe('text');
    expect(result.text).toContain('求 ∠B');
  });

  it('拒绝扩展名与内容不一致的图片', async () => {
    await expect(parseUploadedFile({
      originalname: '伪装图片.png',
      buffer: Buffer.from('not an image'),
    })).rejects.toThrow('文件内容与扩展名不一致');
  });
});
