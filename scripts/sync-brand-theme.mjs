import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceTheme = path.join(rootDir, 'brand', 'aiba-brand.css');
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.server-dist',
  'assets',
  'build',
  'dist',
  'node_modules',
  'output',
  'tmp',
]);
const ignoredRootDirectories = new Set(['brand', 'docs', 'platform', 'scripts', '.learnings']);
const ignoredHtmlNames = new Set(['test.html']);
const protectedPlatformPages = new Set(['admin.html', 'ai-config-admin.html', 'points-admin.html']);

const rootEntries = await readdir(rootDir, { withFileTypes: true });
const toolDirectories = rootEntries
  .filter((entry) => entry.isDirectory() && !ignoredRootDirectories.has(entry.name) && !entry.name.startsWith('.'))
  .map((entry) => path.join(rootDir, entry.name));

let htmlCount = 0;
let themeCount = 0;

for (const toolDir of toolDirectories) {
  const htmlFiles = await findHtmlFiles(toolDir);
  for (const htmlPath of htmlFiles) {
    if (
      path.basename(toolDir) === '教辅资料生成器' &&
      path.basename(path.dirname(htmlPath)) === 'public' &&
      protectedPlatformPages.has(path.basename(htmlPath))
    ) {
      continue;
    }
    await injectThemeLink(htmlPath);
    await copyThemeNextTo(htmlPath);
    htmlCount += 1;
    themeCount += 1;
  }
}

await syncNextTheme();

console.log(`品牌主题已接入 ${htmlCount} 个 HTML 入口，写入 ${themeCount + 1} 份运行时样式。`);

async function findHtmlFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findHtmlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html') && !ignoredHtmlNames.has(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function injectThemeLink(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  if (!html.includes('</head>')) throw new Error(`HTML 缺少 </head>：${htmlPath}`);
  const additions = [];
  if (!html.includes('rel="icon"') && !html.includes("rel='icon'")) {
    additions.push('    <link rel="icon" href="data:," data-aiba-icon />');
  }
  if (!html.includes('data-aiba-brand')) {
    additions.push('    <link rel="stylesheet" href="./aiba-brand.css" data-aiba-brand />');
  }
  if (additions.length === 0) return;
  await writeFile(htmlPath, html.replace('</head>', `${additions.join('\n')}\n  </head>`), 'utf8');
}

async function copyThemeNextTo(htmlPath) {
  const target = path.join(path.dirname(htmlPath), 'aiba-brand.css');
  await copyFile(sourceTheme, target);
}

async function syncNextTheme() {
  const appDir = path.join(rootDir, '考前抢分清单器', 'app');
  const targetTheme = path.join(appDir, 'aiba-brand.css');
  const globalsPath = path.join(appDir, 'globals.css');
  await mkdir(appDir, { recursive: true });
  await copyFile(sourceTheme, targetTheme);
  const globals = await readFile(globalsPath, 'utf8');
  const importLine = '@import "./aiba-brand.css";';
  if (!globals.includes(importLine)) {
    await writeFile(globalsPath, `${importLine}\n\n${globals}`, 'utf8');
  }
}
