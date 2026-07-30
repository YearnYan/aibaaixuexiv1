import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2];
const supportedModes = new Set(['install', 'build']);
if (!supportedModes.has(mode)) {
  throw new Error('用法：node scripts/run-workspaces.mjs <install|build>');
}

const ignoredDirectories = new Set([
  '.git',
  '.learnings',
  '.playwright-cli',
  'brand',
  'docs',
  'node_modules',
  'output',
  'platform',
  'scripts',
]);

const workspaces = [];
for (const entry of await readdir(rootDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue;
  const workspaceDir = path.join(rootDir, entry.name);
  const packagePath = path.join(workspaceDir, 'package.json');
  if (!existsSync(packagePath)) continue;

  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  if (mode === 'install' && !existsSync(path.join(workspaceDir, 'package-lock.json'))) continue;
  if (mode === 'build' && !packageJson.scripts?.build) continue;
  workspaces.push({ name: entry.name, directory: workspaceDir });
}

workspaces.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
const concurrency = mode === 'install' ? 3 : 2;
let cursor = 0;
let firstFailure = null;

await Promise.all(Array.from({ length: Math.min(concurrency, workspaces.length) }, runWorker));
if (firstFailure) throw firstFailure;

console.log(`${mode === 'install' ? '依赖安装' : '生产构建'}完成：${workspaces.length} 个子项目。`);

async function runWorker() {
  while (!firstFailure) {
    const index = cursor;
    cursor += 1;
    if (index >= workspaces.length) return;

    const workspace = workspaces[index];
    const args = mode === 'install' ? ['ci'] : ['run', 'build'];
    console.log(`[${index + 1}/${workspaces.length}] ${workspace.name}：npm ${args.join(' ')}`);
    try {
      await runNpm(args, workspace.directory);
    } catch (error) {
      firstFailure = new Error(`${workspace.name} 执行失败：${error.message}`);
    }
  }
}

function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const npmExecPath = process.env.npm_execpath;
    const executable = npmExecPath && existsSync(npmExecPath) ? process.execPath : 'npm';
    const commandArgs = npmExecPath && existsSync(npmExecPath) ? [npmExecPath, ...args] : args;
    const child = spawn(executable, commandArgs, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`退出码 ${code ?? 'unknown'}`));
    });
  });
}
