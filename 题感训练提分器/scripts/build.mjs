import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const katexDistDir = path.join(rootDir, 'node_modules', 'katex', 'dist');

async function minifyFile(sourcePath, targetPath, loader) {
  const source = await readFile(sourcePath, 'utf8');
  const result = await transform(source, {
    loader,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    target: 'es2018'
  });
  await writeFile(targetPath, result.code, 'utf8');
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await Promise.all([
    minifyFile(path.join(rootDir, 'app.js'), path.join(distDir, 'app.js'), 'js'),
    minifyFile(path.join(rootDir, 'style.css'), path.join(distDir, 'style.css'), 'css'),
    copyFile(path.join(rootDir, 'index.html'), path.join(distDir, 'index.html'))
  ]);
  const publicKatexDir = path.join(distDir, 'vendor', 'katex');
  await cp(katexDistDir, publicKatexDir, { recursive: true });
  // 对页面固定公开路径，隔离 KaTeX 包内 contrib 目录结构。
  await copyFile(path.join(katexDistDir, 'contrib', 'mhchem.min.js'), path.join(publicKatexDir, 'mhchem.min.js'));

  console.log('[build] 完成，输出目录:', distDir);
}

build().catch((err) => {
  console.error('[build] 失败:', err);
  process.exitCode = 1;
});
