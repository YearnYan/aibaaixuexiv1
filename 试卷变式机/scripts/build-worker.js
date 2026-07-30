const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const projectRoot = process.cwd();
const workerEntry = path.join(projectRoot, 'worker', 'index.js');
const distDir = path.join(projectRoot, 'dist');
const outputPath = path.join(distDir, '_worker.js');

async function buildWorker() {
  // Ensure dist directory exists
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  await esbuild.build({
    entryPoints: [workerEntry],
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    platform: 'browser', // Cloudflare Workers use browser-like APIs
    outfile: outputPath,
    minify: true,
    sourcemap: false,
    conditions: ['worker', 'browser'],
    // JSON files will be bundled inline
    loader: {
      '.json': 'json'
    },
    // Mark node built-ins as external (Workers have nodejs_compat)
    external: [],
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    logLevel: 'info'
  });

  const stats = fs.statSync(outputPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`Worker 构建完成: dist/_worker.js (${sizeKB} KB)`);
}

buildWorker().catch((error) => {
  console.error('Worker 构建失败:', error.message);
  process.exit(1);
});
