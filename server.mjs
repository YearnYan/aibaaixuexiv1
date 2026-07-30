import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'platform');
const port = readPort(process.env.PORT, 4173);
const host = process.env.BIND_HOST || '127.0.0.1';
const backendPort = readPort(process.env.PLATFORM_BACKEND_PORT, 5180);
const backendOrigin = new URL(process.env.PLATFORM_API_ORIGIN || `http://127.0.0.1:${backendPort}`);
const shouldStartBackend = !process.env.PLATFORM_API_ORIGIN;
const toolBindHost = process.env.TOOL_BIND_HOST || '127.0.0.1';

const toolDefinitions = [
  ['AI丢分诊断器', 5201, 'server.js'],
  ['AI提分空间评测器', 5202, 'server.js'],
  ['AI错因判断器', 5203, 'server/app.js'],
  ['AI得分点拆解器', 5204, 'server.js'],
  ['AI审题器', 5205, 'dist-server/server/index.js'],
  ['卷后提分试卷分析', 5206, '../scripts/static-tool-server.mjs', { STATIC_ROOT: '.' }],
  ['错题归因追分器', 5207, 'server/index.js'],
  ['知识查缺补漏器', 5208, 'server.js'],
  ['AI解题步骤器', 5209, 'server/index.js'],
  ['AI题型提分卡', 5210, 'server.js'],
  ['提分行动计划器', 5211, 'server.js'],
  ['考前抢分清单器', 5212, 'node_modules/next/dist/bin/next', {}, ['start']],
  ['题感训练提分器', 5213, 'server.js'],
  ['错题举一反三', 5214, 'server/index.js'],
  ['学习资料生成器', 5215, 'server.js'],
  ['AI出题机', 5216, 'server/index.js'],
  ['试卷变式机', 5217, 'server/index.js'],
  ['AI备课器', 5218, 'server.mjs'],
  ['教辅资料生成器', backendPort, null],
  ['试卷讲评PPT', 5220, 'server.js'],
  ['题卷重排WORD', 5221, 'scripts/run-vite.mjs', {}, ['start']],
].map(([name, toolPort, entry, env = {}, args = []]) => ({
  name,
  port: toolPort,
  entry,
  env,
  args,
}));
const toolRoutes = new Map(toolDefinitions.map((tool) => [`/${tool.name}`, tool]));

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

let backendProcess = null;
const toolProcesses = new Map();

if (shouldStartBackend) {
  backendProcess = spawn(process.execPath, ['server.js'], {
    cwd: path.join(rootDir, '教辅资料生成器'),
    env: {
      ...process.env,
      PORT: String(backendPort),
      BIND_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.stdout.on('data', (chunk) => process.stdout.write(`[平台后端] ${chunk}`));
  backendProcess.stderr.on('data', (chunk) => process.stderr.write(`[平台后端] ${chunk}`));
  backendProcess.on('exit', (code) => {
    if (code && code !== 0) console.error(`平台后端异常退出，退出码：${code}`);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname.startsWith('/api/')) {
      proxyApiRequest(request, response);
      return;
    }

    const toolRoute = decodeURIComponent(requestUrl.pathname).replace(/\/+$/u, '');
    const tool = toolRoutes.get(toolRoute);
    if (tool) {
      await launchTool(requestUrl, response, tool);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { ok: false, message: '不支持的请求方法' });
      return;
    }

    await serveStatic(request, response, requestUrl.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '平台服务处理失败' });
  }
});

server.listen(port, host, () => {
  console.log(`艾爸AI学习品牌站已启动：http://${host}:${port}`);
});

function proxyApiRequest(request, response) {
  const upstream = http.request({
    protocol: backendOrigin.protocol,
    hostname: backendOrigin.hostname,
    port: backendOrigin.port,
    path: request.url,
    method: request.method,
    headers: {
      ...request.headers,
      host: backendOrigin.host,
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on('error', (error) => {
    console.error(`平台 API 代理失败：${error.message}`);
    if (!response.headersSent) {
      sendJson(response, 502, { ok: false, message: '平台服务尚未就绪，请稍后重试' });
    } else {
      response.end();
    }
  });

  request.pipe(upstream);
}

async function launchTool(requestUrl, response, tool) {
  try {
    if (!await isPortOpen(tool.port)) {
      startToolProcess(tool);
      await waitForTool(tool);
    }

    const forwardedProtocol = String(requestUrl.protocol || 'http:');
    const target = `${forwardedProtocol}//${requestUrl.hostname}:${tool.port}/`;
    response.writeHead(302, {
      Location: target,
      'Cache-Control': 'no-store',
    });
    response.end();
  } catch (error) {
    console.error(`[${tool.name}] 启动失败：${error.message}`);
    sendJson(response, 503, {
      ok: false,
      message: `${tool.name} 暂时无法启动，请确认该子站依赖和生产构建已准备完成`,
    });
  }
}

function startToolProcess(tool) {
  if (!tool.entry || toolProcesses.has(tool.name)) return;

  const cwd = path.join(rootDir, tool.name);
  const entry = path.resolve(cwd, tool.entry);
  if (!existsSync(entry)) {
    throw new Error(`缺少启动入口：${entry}`);
  }

  const child = spawn(process.execPath, [entry, ...tool.args], {
    cwd,
    env: {
      ...process.env,
      ...loadPlatformAiEnvironment(),
      ...tool.env,
      PORT: String(tool.port),
      HOST: toolBindHost,
      BIND_HOST: toolBindHost,
      PLATFORM_API_ORIGIN: backendOrigin.origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  toolProcesses.set(tool.name, child);
  child.stdout.on('data', (chunk) => process.stdout.write(`[${tool.name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${tool.name}] ${chunk}`));
  child.on('exit', (code) => {
    toolProcesses.delete(tool.name);
    if (code && code !== 0) console.error(`[${tool.name}] 异常退出，退出码：${code}`);
  });
}

function loadPlatformAiEnvironment() {
  const configPath = path.join(rootDir, '教辅资料生成器', 'data', 'ai-config.json');
  if (!existsSync(configPath)) return {};

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const entries = Array.isArray(config?.rule?.entries) ? config.rule.entries : [];
    const entry = entries.find((item) => {
      const keys = Array.isArray(item?.apiKeys) ? item.apiKeys : [];
      return item?.baseUrl && item?.model && keys.some((key) => String(key || '').trim());
    });
    if (!entry) return {};

    const apiKeys = entry.apiKeys.map((key) => String(key || '').trim()).filter(Boolean);
    return {
      AI_API_KEY: apiKeys[0],
      AI_API_KEYS: apiKeys.join(','),
      AI_API_URL: String(entry.baseUrl).replace(/\/+$/u, ''),
      AI_MODEL: String(entry.model),
    };
  } catch (error) {
    console.error(`平台 AI 配置读取失败：${error.message}`);
    return {};
  }
}

async function waitForTool(tool) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(tool.port)) return;
    const child = toolProcesses.get(tool.name);
    if (child && child.exitCode !== null) {
      throw new Error(`子站进程已退出，退出码：${child.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待端口 ${tool.port} 就绪超时`);
}

function isPortOpen(targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function serveStatic(request, response, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relativePath);

  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    sendJson(response, 403, { ok: false, message: '禁止访问该路径' });
    return;
  }

  const finalPath = await resolveStaticFile(filePath);
  if (!finalPath) {
    sendJson(response, 404, { ok: false, message: '页面不存在' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes.get(path.extname(finalPath).toLowerCase()) || 'application/octet-stream',
    'Cache-Control': finalPath.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(finalPath).pipe(response);
}

async function resolveStaticFile(filePath) {
  if (!existsSync(filePath)) return null;
  const fileStat = await stat(filePath);
  if (fileStat.isFile()) return filePath;
  if (!fileStat.isDirectory()) return null;
  const indexPath = path.join(filePath, 'index.html');
  return existsSync(indexPath) ? indexPath : null;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function readPort(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function closeServers() {
  server.close();
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  for (const child of toolProcesses.values()) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', closeServers);
process.on('SIGTERM', closeServers);
