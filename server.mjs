import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = resolve(process.cwd());
const BLOCKED_ROOT_FILES = new Set([
  'server.mjs',
  'package.json',
  'package-lock.json',
  'railway.json'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let reqPath = decodeURIComponent(url.pathname);

    if (reqPath === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}');
      return;
    }

    if (reqPath === '/') reqPath = '/index.html';

    const segments = reqPath.split(/[\\/]+/).filter(Boolean);
    if (segments.some((seg) => seg.startsWith('.') || seg === 'node_modules')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Not Found');
      return;
    }

    const safeRel = normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = resolve(join(ROOT, safeRel));

    if (!filePath.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Forbidden');
      return;
    }

    if ( resolve(join(ROOT, basename(filePath))) === filePath && BLOCKED_ROOT_FILES.has(basename(filePath)) ) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Not Found');
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'Not Found');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = req.method === 'HEAD' ? undefined : await readFile(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🦋 Flappysky server running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   Network: http://${net.address}:${PORT}`);
      }
    }
  }
});
