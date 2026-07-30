import { mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const outputDir = path.join(projectRoot, 'dist', 'cloudflare-assets');
const assetFiles = ['index.html', 'app.js', 'styles.css', 'admin.html', 'admin.js'];
const pdfJsSourceDir = path.join(projectRoot, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const pdfJsOutputDir = path.join(outputDir, 'vendor', 'pdfjs');
const pdfJsFiles = ['pdf.mjs', 'pdf.worker.mjs'];

if (!outputDir.startsWith(path.join(projectRoot, 'dist') + path.sep)) {
  throw new Error('Cloudflare 静态资源输出目录不在 dist 内，已停止构建。');
}

await mkdir(outputDir, { recursive: true });

for (const entry of await readdir(outputDir, { withFileTypes: true })) {
  if (!assetFiles.includes(entry.name)) {
    await rm(path.join(outputDir, entry.name), { recursive: true, force: true });
  }
}

for (const file of assetFiles) {
  await copyFile(path.join(publicDir, file), path.join(outputDir, file));
}

await mkdir(pdfJsOutputDir, { recursive: true });
for (const file of pdfJsFiles) {
  await copyFile(path.join(pdfJsSourceDir, file), path.join(pdfJsOutputDir, file));
}

console.log(`Cloudflare 静态资源已同步：${assetFiles.join(', ')}；PDF.js：${pdfJsFiles.join(', ')}`);
