const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, 'src');
const distDir = path.join(projectRoot, 'dist');
const assetsDir = path.join(distDir, 'assets');
const navSource = path.resolve(projectRoot, '..', 'brand', 'aiba-subsite-nav.js');
const themeSource = path.resolve(projectRoot, '..', 'brand', 'aiba-brand.css');

const pages = [
  {
    templatePath: path.join(srcDir, 'index.html'),
    outputPath: path.join(distDir, 'index.html'),
    entryPoint: path.join(srcDir, 'app-entry.js')
  },
  {
    templatePath: path.join(srcDir, 'ai-config.html'),
    outputPath: path.join(distDir, 'ai-config.html'),
    entryPoint: path.join(srcDir, 'ai-config-entry.js')
  }
];

function removeLegacyTags(html) {
  let next = html.replace(
    /<link[^>]*href=["'][^"']*(?:style|ai-config)\.css[^"']*["'][^>]*>\s*/gi,
    ''
  );
  next = next.replace(
    /<script[^>]*src=["'][^"']*(?:app-entry|ai-config-entry)\.js[^"']*["'][^>]*>\s*<\/script>\s*/gi,
    ''
  );
  return next;
}

function injectAssetTags(html, jsFile, cssFile) {
  const tags = [];
  if (cssFile) {
    tags.push(`  <link rel="stylesheet" crossorigin href="./assets/${cssFile}">`);
  }
  tags.push(`  <script type="module" crossorigin src="./assets/${jsFile}"></script>`);

  if (!html.includes('</head>')) {
    throw new Error('页面模板缺少 </head>，无法注入构建产物');
  }
  return html.replace('</head>', `${tags.join('\n')}\n</head>`);
}

function pickOutputAssets(metafile, entryPoint) {
  const resolvedEntry = path.resolve(entryPoint);
  let jsOutput = '';
  let cssOutput = '';

  for (const [outputPath, outputInfo] of Object.entries(metafile.outputs || {})) {
    if (!outputInfo.entryPoint || path.resolve(outputInfo.entryPoint) !== resolvedEntry) continue;
    if (outputPath.endsWith('.js')) {
      jsOutput = outputPath;
      cssOutput = outputInfo.cssBundle || '';
      break;
    }
  }

  if (!jsOutput) throw new Error(`未找到 ${path.basename(entryPoint)} 的 JS 构建产物`);
  return {
    jsFile: path.basename(jsOutput),
    cssFile: cssOutput ? path.basename(cssOutput) : ''
  };
}

async function buildFrontend() {
  await fs.promises.rm(distDir, { recursive: true, force: true });
  await fs.promises.mkdir(assetsDir, { recursive: true });
  await fs.promises.copyFile(navSource, path.join(distDir, 'aiba-subsite-nav.js'));
  await fs.promises.copyFile(themeSource, path.join(distDir, 'aiba-brand.css'));

  const buildResult = await esbuild.build({
    entryPoints: pages.map((page) => page.entryPoint),
    bundle: true,
    format: 'esm',
    target: ['es2019'],
    minify: true,
    sourcemap: false,
    splitting: false,
    outdir: assetsDir,
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
    assetNames: '[name]-[hash]',
    metafile: true,
    logLevel: 'info',
    loader: {
      '.png': 'file',
      '.jpg': 'file',
      '.jpeg': 'file',
      '.webp': 'file',
      '.gif': 'file',
      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.otf': 'file'
    }
  });

  for (const page of pages) {
    const { jsFile, cssFile } = pickOutputAssets(buildResult.metafile, page.entryPoint);
    const templateHtml = await fs.promises.readFile(page.templatePath, 'utf8');
    const finalHtml = injectAssetTags(removeLegacyTags(templateHtml), jsFile, cssFile);
    await fs.promises.writeFile(page.outputPath, finalHtml, 'utf8');
    console.log(`页面构建完成: ${path.basename(page.outputPath)} -> ${jsFile}`);
  }
}

buildFrontend().catch((error) => {
  console.error('前端构建失败:', error.message);
  process.exit(1);
});
