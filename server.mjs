import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createFlappyskyDb } from './src/server/db.mjs';
import { createAtprotoAuthService } from './src/server/atproto-auth.mjs';
import { createOpenGamingAuthority } from './src/server/opengaming-authority.mjs';

const ROOT = resolve(import.meta.dirname);
const BLOCKED_ROOT_FILES = new Set([
  'server.mjs',
  'package.json',
  'package-lock.json',
  'railway.json'
]);
const BLOCKED_DIRS = new Set([
  'node_modules',
  'data',
  'vendor',
  'scripts',
  'tests'
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

function resolveDefaultPublicOrigin(port) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.trim().replace(/\/+$/, '');
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://flappysky.symmetricalboy.com';
  }
  return `http://127.0.0.1:${port}`;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('Request payload too large.');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function isSameOriginMutation(req, publicOrigin) {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site' && secFetchSite !== 'none') {
    return false;
  }
  const originHeader = req.headers.origin;
  if (!originHeader) return true;
  try {
    const reqHost = req.headers.host;
    const originUrl = new URL(originHeader);
    const pubUrl = new URL(publicOrigin);
    return originUrl.host === reqHost || originUrl.host === pubUrl.host;
  } catch {
    return false;
  }
}

export async function createFlappyskyApp({
  port = Number(process.env.PORT) || 3000,
  dbPath,
  publicOrigin,
  issuerDidOverride,
  appViewUrls
} = {}) {
  const resolvedOrigin = publicOrigin || resolveDefaultPublicOrigin(port);
  const db = createFlappyskyDb(dbPath);
  const authority = await createOpenGamingAuthority({
    db,
    publicOrigin: resolvedOrigin,
    issuerDidOverride,
    appViewUrls
  });
  const auth = await createAtprotoAuthService({
    db,
    publicOrigin: resolvedOrigin,
    port
  });

  const server = createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      let reqPath = decodeURIComponent(url.pathname);

      // 1. Health check
      if (reqPath === '/health' && (method === 'GET' || method === 'HEAD')) {
        const body = JSON.stringify({
          status: 'ok',
          gameDid: authority.issuerDid,
          achievements: authority.achievementEntries.length,
          leaderboard: 'high-score'
        });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(method === 'HEAD' ? undefined : body);
        return;
      }

      // 2. ATProto did:web + handle verification endpoints
      if (reqPath === '/.well-known/did.json' && (method === 'GET' || method === 'HEAD')) {
        const body = JSON.stringify(authority.didDocument, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300'
        });
        res.end(method === 'HEAD' ? undefined : body);
        return;
      }

      if (reqPath === '/.well-known/atproto-did' && (method === 'GET' || method === 'HEAD')) {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300'
        });
        res.end(method === 'HEAD' ? undefined : authority.issuerDid);
        return;
      }

      // 3. ATProto OAuth client metadata, JWKS, logo & callback
      if (reqPath === '/oauth/client-metadata.json' && method === 'GET') {
        sendJson(res, 200, auth.clientMetadata, { 'Access-Control-Allow-Origin': '*' });
        return;
      }

      if (reqPath === '/oauth/jwks.json' && method === 'GET') {
        sendJson(res, 200, auth.jwks, { 'Access-Control-Allow-Origin': '*' });
        return;
      }

      if (reqPath === '/oauth/logo.png' && (method === 'GET' || method === 'HEAD')) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400'
        });
        res.end(method === 'HEAD' ? undefined : authority.gameLogoBlob.bytes);
        return;
      }

      if (reqPath === '/oauth/callback' && method === 'GET') {
        try {
          const { cookieHeader, user } = await auth.handleOAuthCallback(url.searchParams);
          // Hydrate any prior achievements/scores from player's PDS on login
          try {
            const fakeReq = { headers: { cookie: cookieHeader.split(';')[0] } };
            const authCtx = await auth.getAuthenticatedAgent(fakeReq);
            if (authCtx) {
              await authority.hydratePlayerFromPds(authCtx);
            }
          } catch {
            // Non-fatal
          }
          res.writeHead(302, {
            'Set-Cookie': cookieHeader,
            Location: '/?auth=connected',
            'Cache-Control': 'no-store'
          });
          res.end();
        } catch (err) {
          const msg = encodeURIComponent(err?.message || 'OAuth authorization failed.');
          res.writeHead(302, {
            Location: `/?auth_error=${msg}`,
            'Cache-Control': 'no-store'
          });
          res.end();
        }
        return;
      }

      // 4. Read-only ATProto PDS XRPC endpoints for Flappysky's publisher definitions & icon blobs
      if (reqPath === '/xrpc/com.atproto.repo.describeRepo' && method === 'GET') {
        sendJson(
          res,
          200,
          {
            handle: authority.handle,
            did: authority.issuerDid,
            didDoc: authority.didDocument,
            collections: Array.from(authority.repoCollections.keys()),
            handleIsCorrect: true
          },
          { 'Access-Control-Allow-Origin': '*' }
        );
        return;
      }

      if (reqPath === '/xrpc/com.atproto.repo.listRecords' && method === 'GET') {
        const repo = url.searchParams.get('repo');
        const collection = url.searchParams.get('collection') || '';
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));

        if (repo && repo !== authority.issuerDid && repo !== authority.handle) {
          sendJson(res, 400, { error: 'InvalidRequest', message: `Unknown repo ${repo}` }, { 'Access-Control-Allow-Origin': '*' });
          return;
        }

        const list = authority.repoCollections.get(collection) || [];
        sendJson(
          res,
          200,
          {
            records: list.slice(0, limit).map((r) => ({
              uri: r.uri,
              cid: r.cid,
              value: r.value
            }))
          },
          { 'Access-Control-Allow-Origin': '*' }
        );
        return;
      }

      if (reqPath === '/xrpc/com.atproto.repo.getRecord' && method === 'GET') {
        const collection = url.searchParams.get('collection') || '';
        const rkey = url.searchParams.get('rkey') || '';
        const list = authority.repoCollections.get(collection) || [];
        const match = list.find((r) => r.rkey === rkey);
        if (!match) {
          sendJson(res, 404, { error: 'RecordNotFound', message: 'Record not found' }, { 'Access-Control-Allow-Origin': '*' });
          return;
        }
        sendJson(
          res,
          200,
          { uri: match.uri, cid: match.cid, value: match.value },
          { 'Access-Control-Allow-Origin': '*' }
        );
        return;
      }

      if (reqPath === '/xrpc/com.atproto.sync.getBlob' && (method === 'GET' || method === 'HEAD')) {
        const cid = url.searchParams.get('cid') || '';
        const blob = authority.blobsByCid.get(cid);
        if (!blob) {
          sendJson(res, 404, { error: 'BlobNotFound', message: 'Blob not found' }, { 'Access-Control-Allow-Origin': '*' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': blob.mimeType,
          'Content-Length': String(blob.size),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000, immutable'
        });
        res.end(method === 'HEAD' ? undefined : blob.bytes);
        return;
      }

      // 5. Open Gaming Game API & Auth endpoints
      if (reqPath === '/api/opengaming/status' && method === 'GET') {
        const authCtx = await auth.getAuthenticatedAgent(req);
        if (authCtx && url.searchParams.get('refresh') === '1') {
          await authority.hydratePlayerFromPds(authCtx);
        }
        sendJson(res, 200, {
          catalog: authority.getPublicCatalogPayload(),
          authenticated: Boolean(authCtx),
          user: authCtx?.user || null,
          player: authCtx ? authority.getStoredPlayerSnapshot(authCtx.user.did) : null
        });
        return;
      }

      if (reqPath === '/api/opengaming/leaderboard' && method === 'GET') {
        const scope = url.searchParams.get('scope') === 'social' ? 'social' : 'public';
        const limit = Number(url.searchParams.get('limit')) || 50;
        const sessRow = auth.getSessionFromRequest(req);
        const data = await authority.getLeaderboardEntries({
          scope,
          viewerDid: sessRow?.did || null,
          limit
        });
        sendJson(res, 200, data);
        return;
      }

      if (reqPath.startsWith('/api/') && method === 'POST') {
        if (!isSameOriginMutation(req, resolvedOrigin)) {
          sendJson(res, 403, { error: 'Cross-origin request forbidden.' });
          return;
        }

        if (reqPath === '/api/auth/oauth/login') {
          const body = await readJsonBody(req);
          try {
            const redirectUrl = await auth.startOAuthLogin(body.handle);
            sendJson(res, 200, { redirectUrl });
          } catch (err) {
            sendJson(res, 400, { error: err?.message || 'Unable to start ATProto OAuth sign-in.' });
          }
          return;
        }

        if (reqPath === '/api/auth/app-password') {
          const body = await readJsonBody(req);
          try {
            const { cookieHeader, user } = await auth.loginWithAppPassword(
              body.identifier,
              body.password
            );
            const fakeReq = { headers: { cookie: cookieHeader.split(';')[0] } };
            const authCtx = await auth.getAuthenticatedAgent(fakeReq);
            if (authCtx) {
              await authority.hydratePlayerFromPds(authCtx);
              if (body.guestBaseline) {
                await authority.syncPlayerRunAndAchievements({
                  user: authCtx.user,
                  agent: authCtx.agent,
                  guestBaseline: body.guestBaseline
                });
              }
            }
            sendJson(
              res,
              200,
              {
                ok: true,
                user,
                player: authority.getStoredPlayerSnapshot(user.did)
              },
              { 'Set-Cookie': cookieHeader }
            );
          } catch (err) {
            sendJson(res, 401, {
              error: err?.message || 'Invalid handle or App Password.'
            });
          }
          return;
        }

        if (reqPath === '/api/auth/logout') {
          const clearCookie = await auth.logoutRequest(req);
          sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
          return;
        }

        if (reqPath === '/api/opengaming/sync') {
          const authCtx = await auth.getAuthenticatedAgent(req);
          if (!authCtx) {
            sendJson(res, 401, { error: 'Sign in with your ATProto account to sync records to your PDS.' });
            return;
          }
          const body = await readJsonBody(req);
          try {
            const result = await authority.syncPlayerRunAndAchievements({
              user: authCtx.user,
              agent: authCtx.agent,
              run: body.run ?? null,
              guestBaseline: body.guestBaseline ?? null
            });
            sendJson(res, 200, {
              ok: true,
              newlySignedUnlocks: result.newlySignedUnlocks,
              signedScoreResult: result.signedScoreResult,
              pdsWrites: result.pdsWrites,
              player: result.snapshot
            });
          } catch (err) {
            sendJson(res, 400, { error: err?.message || 'Failed to sync Open Gaming records.' });
          }
          return;
        }
      }

      // 6. Static Frontend Asset Serving
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }

      if (reqPath === '/') reqPath = '/index.html';

      const segments = reqPath.split(/[\\/]+/).filter(Boolean);
      if (
        segments.some((seg) => seg.startsWith('.') || BLOCKED_DIRS.has(seg)) ||
        (segments[0] === 'src' && segments[1] === 'server')
      ) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(method === 'HEAD' ? undefined : 'Not Found');
        return;
      }

      const safeRel = normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '');
      const filePath = resolve(join(ROOT, safeRel));

      if (!filePath.startsWith(ROOT + sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(method === 'HEAD' ? undefined : 'Forbidden');
        return;
      }

      if (
        resolve(join(ROOT, basename(filePath))) === filePath &&
        BLOCKED_ROOT_FILES.has(basename(filePath))
      ) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(method === 'HEAD' ? undefined : 'Not Found');
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(method === 'HEAD' ? undefined : 'Not Found');
        return;
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = method === 'HEAD' ? undefined : await readFile(filePath);

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

  return { server, db, authority, auth, publicOrigin: resolvedOrigin };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const { server, authority, publicOrigin } = await createFlappyskyApp({ port });

  server.listen(port, '0.0.0.0', () => {
    console.log(`\n🦋 Flappysky + Open Gaming server running!`);
    console.log(`   Local:        http://localhost:${port}`);
    console.log(`   Public URL:   ${publicOrigin}`);
    console.log(`   Game DID:     ${authority.issuerDid}`);
    console.log(`   Signing Key:  ${authority.publicDidKey}`);
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`   Network:      http://${net.address}:${port}`);
        }
      }
    }

    // Announce publisher catalog to Open Gaming AppView after healthcheck cutover when running on public HTTPS
    setTimeout(() => {
      authority.notifyAppViews([]).catch(() => {});
    }, 6000).unref();
  });
}
