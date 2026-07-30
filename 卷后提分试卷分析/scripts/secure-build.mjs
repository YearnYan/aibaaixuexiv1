import { build } from 'esbuild';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const appEntry = path.join(rootDir, 'public', 'app.js');

async function ensureEntryExists(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new Error(`不是文件：${filePath}`);
    }
  } catch (error) {
    throw new Error(`构建失败，未找到前端入口文件：${filePath}`, { cause: error });
  }
}

async function run() {
  await ensureEntryExists(appEntry);

  await build({
    entryPoints: [appEntry],
    outfile: appEntry,
    allowOverwrite: true,
    bundle: false,
    format: 'iife',
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
    target: ['es2020'],
    treeShaking: false,
    keepNames: false,
    drop: ['console', 'debugger']
  });

  // 兜底防泄露：移除 sourcemap 注释。
  // 即使未来构建参数被改动，也不会在产物尾部暴露 map 链接。
  const { readFile, writeFile } = await import('node:fs/promises');
  const source = await readFile(appEntry, 'utf8');
  const cleaned = source.replace(/\n?\/\/# sourceMappingURL=.*$/gm, '');
  if (cleaned !== source) {
    await writeFile(appEntry, cleaned, 'utf8');
  }

  process.stdout.write('secure-build: 完成（无 sourcemap，已压缩）。\n');
}

run().catch((error) => {
  process.stderr.write(`secure-build: 失败 - ${error.message}\n`);
  process.exitCode = 1;
});
