import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const rootDir = path.resolve(process.cwd(), process.env.STATIC_ROOT || '.');
const port = readPort(process.env.PORT, 5206);
const host = process.env.BIND_HOST || process.env.HOST || '127.0.0.1';
const apiOrigin = new URL(process.env.PLATFORM_API_ORIGIN || 'http://127.0.0.1:5180');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (requestUrl.pathname.startsWith('/api/')) {
      proxyApiRequest(request, response);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { ok: false, message: '不支持的请求方法' });
      return;
    }

    await serveStatic(request, response, requestUrl.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: '静态子站服务处理失败' });
  }
});

server.listen(port, host, () => {
  console.log(`静态子站已启动：http://${host}:${port}`);
});

function proxyApiRequest(request, response) {
  const upstream = http.request({
    protocol: apiOrigin.protocol,
    hostname: apiOrigin.hostname,
    port: apiOrigin.port,
    path: request.url,
    method: request.method,
    headers: {
      ...request.headers,
      host: apiOrigin.host,
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.once('error', (error) => {
    console.error(`静态子站 API 代理失败：${error.message}`);
    if (!response.headersSent) {
      sendJson(response, 502, { ok: false, message: '平台接口暂时不可用' });
    } else {
      response.end();
    }
  });

  request.pipe(upstream);
}

async function serveStatic(request, response, pathname) {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  let filePath = path.resolve(rootDir, relativePath);
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) {
    sendJson(response, 403, { ok: false, message: '禁止访问该路径' });
    return;
  }

  if (existsSync(filePath) && (await stat(filePath)).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!existsSync(filePath)) {
    filePath = path.join(rootDir, 'index.html');
  }
  if (!existsSync(filePath) || !(await stat(filePath)).isFile()) {
    sendJson(response, 404, { ok: false, message: '页面不存在' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
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

function closeServer() {
  server.close();
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
