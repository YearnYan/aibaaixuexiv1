import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceTheme = path.join(rootDir, 'brand', 'aiba-brand.css');
const sourceNav = path.join(rootDir, 'brand', 'aiba-subsite-nav.js');
const sourceNavStyles = path.join(rootDir, 'brand', 'aiba-subsite-nav.css');
const sourceLegacyHzq = path.join(rootDir, 'brand', 'aiba-hzq-compat.js');
const sourceLegacyTheme = path.join(rootDir, 'brand', 'aiba-legacy-theme-compat.css');
const sourceLogo = path.join(rootDir, 'platform', 'assets', 'logo.jpg');
const brandVersion = '20260801-brand3';
const navVersion = '20260801-nav5';
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
    await injectNavStylesheet(htmlPath);
    await copyNavStylesNextTo(htmlPath);
    await injectNavScript(htmlPath);
    await copyNavNextTo(htmlPath);
    await copyLogoNextTo(htmlPath);
    await syncLegacySharedAssets(htmlPath, toolDir);
    htmlCount += 1;
    themeCount += 1;
  }
}

await syncNextTheme();
await syncBuiltArtifacts();

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
  const versioned = ensureBrandVersion(html);
  const additions = [];
  if (!versioned.includes('rel="icon"') && !versioned.includes("rel='icon'")) {
    additions.push('    <link rel="icon" href="data:," data-aiba-icon />');
  }
  if (!versioned.includes('data-aiba-brand')) {
    additions.push(`    <link rel="stylesheet" href="./aiba-brand.css?v=${brandVersion}" data-aiba-brand />`);
  }
  const next = additions.length === 0
    ? versioned
    : versioned.replace('</head>', `${additions.join('\n')}\n  </head>`);
  if (next !== html) await writeFile(htmlPath, next, 'utf8');
}

async function copyThemeNextTo(htmlPath) {
  const target = path.join(path.dirname(htmlPath), 'aiba-brand.css');
  await copyFile(sourceTheme, target);
}

async function injectNavStylesheet(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  if (!html.includes('</head>')) return;
  const versioned = ensureNavStyleVersion(html);
  if (versioned.includes('data-aiba-subsite-nav-style')) {
    if (versioned !== html) await writeFile(htmlPath, versioned, 'utf8');
    return;
  }
  const link = `    <link rel="stylesheet" href="./aiba-subsite-nav.css?v=${navVersion}" data-aiba-subsite-nav-style />\n`;
  await writeFile(htmlPath, versioned.replace('</head>', `${link}  </head>`), 'utf8');
}

async function injectNavScript(htmlPath) {
  const html = await readFile(htmlPath, 'utf8');
  if (!html.includes('</head>')) return;
  const versioned = ensureNavVersion(html);
  if (versioned !== html) {
    await writeFile(htmlPath, versioned, 'utf8');
    return;
  }
  if (html.includes('data-aiba-subsite-nav')) return;
  const script = `    <script src="./aiba-subsite-nav.js?v=${navVersion}" data-aiba-subsite-nav defer></script>\n`;
  await writeFile(htmlPath, html.replace('</head>', `${script}  </head>`), 'utf8');
}

async function copyNavNextTo(htmlPath) {
  const target = path.join(path.dirname(htmlPath), 'aiba-subsite-nav.js');
  await copyFile(sourceNav, target);
}

async function copyNavStylesNextTo(htmlPath) {
  const target = path.join(path.dirname(htmlPath), 'aiba-subsite-nav.css');
  await copyFile(sourceNavStyles, target);
}

async function copyLogoNextTo(htmlPath) {
  const target = path.join(path.dirname(htmlPath), 'aiba-logo.jpg');
  await copyFile(sourceLogo, target);
}

async function syncLegacySharedAssets(htmlPath, toolDir, force = false) {
  const html = await readFile(htmlPath, 'utf8');
  const sharedDir = path.join(path.dirname(htmlPath), 'shared');
  let sharedDirReady = false;

  if (force || /\/shared\/hzq\.js(?:[?"'])/u.test(html)) {
    await mkdir(sharedDir, { recursive: true });
    sharedDirReady = true;
    const target = path.join(sharedDir, 'hzq.js');
    const source = await resolveLegacySource(path.join(toolDir, 'shared', 'hzq.js'), sourceLegacyHzq);
    if (path.resolve(source) !== path.resolve(target)) await copyFile(source, target);
  }

  if (force || /\/shared\/jx-brand\.css(?:[?"'])/u.test(html)) {
    if (!sharedDirReady) await mkdir(sharedDir, { recursive: true });
    const target = path.join(sharedDir, 'jx-brand.css');
    const source = await resolveLegacySource(path.join(toolDir, 'shared', 'jx-brand.css'), sourceLegacyTheme);
    if (path.resolve(source) !== path.resolve(target)) await copyFile(source, target);
  }
}

async function resolveLegacySource(preferredPath, fallbackPath) {
  try {
    await access(preferredPath);
    return preferredPath;
  } catch {
    return fallbackPath;
  }
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

async function syncBuiltArtifacts() {
  let count = 0;

  for (const toolDir of toolDirectories) {
    for (const outputName of ['dist', 'build']) {
      const outputDir = path.join(toolDir, outputName);
      const indexPath = path.join(outputDir, 'index.html');

      let html;
      try {
        html = await readFile(indexPath, 'utf8');
      } catch {
        continue;
      }

      const versionedHtml = ensureNavStyleVersion(ensureBrandVersion(ensureNavVersion(html)));
      let htmlChanged = versionedHtml !== html;
      html = versionedHtml;
      const additions = [];
      if (!html.includes('data-aiba-brand')) {
        additions.push(`    <link rel="stylesheet" href="./aiba-brand.css?v=${brandVersion}" data-aiba-brand />`);
      }
      if (!html.includes('data-aiba-subsite-nav-style')) {
        additions.push(`    <link rel="stylesheet" href="./aiba-subsite-nav.css?v=${navVersion}" data-aiba-subsite-nav-style />`);
      }
      if (!html.includes('data-aiba-subsite-nav')) {
        additions.push('    <script src="./aiba-subsite-nav.js" data-aiba-subsite-nav defer></script>');
      }
      if (additions.length > 0) {
        if (!html.includes('</head>')) {
          throw new Error(`生成的 HTML 缺少 </head>：${indexPath}`);
        }
        html = html.replace('</head>', `${additions.join('\n')}\n  </head>`);
        htmlChanged = true;
      }
      if (htmlChanged) await writeFile(indexPath, html, 'utf8');

      await copyFile(sourceTheme, path.join(outputDir, 'aiba-brand.css'));
      await copyFile(sourceNav, path.join(outputDir, 'aiba-subsite-nav.js'));
      await copyFile(sourceNavStyles, path.join(outputDir, 'aiba-subsite-nav.css'));
      await copyFile(sourceLogo, path.join(outputDir, 'aiba-logo.jpg'));
      await syncLegacySharedAssets(indexPath, toolDir, true);
      count += 1;
    }
  }

  console.log(`已同步 ${count} 个生产构建目录的品牌导航资源`);
  return count;
}

function ensureNavVersion(html) {
  return html.replace(
    /(src=["'][^"']*aiba-subsite-nav\.js)(?:\?[^"']*)?(["'])/g,
    `$1?v=${navVersion}$2`,
  );
}

function ensureBrandVersion(html) {
  return html.replace(
    /(href=["'][^"']*aiba-brand\.css)(?:\?[^"']*)?(["'])/g,
    `$1?v=${brandVersion}$2`,
  );
}

function ensureNavStyleVersion(html) {
  return html.replace(
    /(href=["'][^"']*aiba-subsite-nav\.css)(?:\?[^"']*)?(["'])/g,
    `$1?v=${navVersion}$2`,
  );
}
