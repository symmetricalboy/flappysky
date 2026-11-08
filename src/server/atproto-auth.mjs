/**
 * Flappysky AT Protocol Authentication Service
 * Supports both:
 * 1. ATProto OAuth (`@atproto/oauth-client-node` + `JoseKey` with granular `games.opengaming.*` repo scopes)
 * 2. ATProto App Password fallback (`@atproto/api` `AtpAgent` resolved to the player's own `#atproto_pds`)
 */

import crypto from 'node:crypto';
import { Agent, AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { JoseKey } from '@atproto/jwk-jose';
import { NodeOAuthClient, requestLocalLock } from '@atproto/oauth-client-node';

export const SESSION_COOKIE_NAME = 'flappysky_og_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const OPENGAMING_OAUTH_SCOPE = [
  'atproto',
  'repo:games.opengaming.achievement.unlock?action=create&action=update',
  'repo:games.opengaming.achievement.progress?action=create&action=update',
  'repo:games.opengaming.leaderboard.score?action=create&action=update'
].join(' ');

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function normalizeHandleOrDid(raw = '') {
  return String(raw).trim().replace(/^@+/, '');
}

async function fetchPublicBskyProfile(actor) {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      did: data.did,
      handle: data.handle,
      displayName: data.displayName || data.handle,
      avatar: data.avatar || null
    };
  } catch {
    return null;
  }
}

export async function createAtprotoAuthService({ db, publicOrigin, port }) {
  const idResolver = new IdResolver();
  const parsedOrigin = new URL(publicOrigin);
  const isHttps = parsedOrigin.protocol === 'https:';

  // Persist ES256 OAuth client key in SQLite kv_store so JWKS stays stable across restarts
  const getKvStmt = db.prepare('SELECT value FROM kv_store WHERE key = ?');
  const setKvStmt = db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)');

  let oauthKey;
  const savedJwkRow = getKvStmt.get('oauth_private_jwk');
  if (savedJwkRow?.value) {
    oauthKey = await JoseKey.fromJWK(JSON.parse(savedJwkRow.value), 'flappysky-oauth-1');
  } else {
    oauthKey = await JoseKey.generate(['ES256'], 'flappysky-oauth-1');
    setKvStmt.run('oauth_private_jwk', JSON.stringify(oauthKey.privateJwk));
  }

  const loopbackRedirect = `http://127.0.0.1:${port}/oauth/callback`;
  const clientMetadata = isHttps
    ? {
        client_id: `${publicOrigin}/oauth/client-metadata.json`,
        client_name: 'Flappysky',
        client_uri: publicOrigin,
        logo_uri: `${publicOrigin}/oauth/logo.png`,
        redirect_uris: [`${publicOrigin}/oauth/callback`],
        grant_types: ['authorization_code', 'refresh_token'],
        scope: OPENGAMING_OAUTH_SCOPE,
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'ES256',
        dpop_bound_access_tokens: true,
        jwks_uri: `${publicOrigin}/oauth/jwks.json`
      }
    : {
        client_id: `http://localhost?redirect_uri=${encodeURIComponent(loopbackRedirect)}&scope=${encodeURIComponent(OPENGAMING_OAUTH_SCOPE)}`,
        client_name: 'Flappysky (Local)',
        redirect_uris: [loopbackRedirect],
        grant_types: ['authorization_code', 'refresh_token'],
        scope: OPENGAMING_OAUTH_SCOPE,
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true
      };

  const setStateStmt = db.prepare(
    'INSERT OR REPLACE INTO oauth_states (key, value, created_at) VALUES (?, ?, ?)'
  );
  const getStateStmt = db.prepare('SELECT value FROM oauth_states WHERE key = ?');
  const delStateStmt = db.prepare('DELETE FROM oauth_states WHERE key = ?');
  const pruneStateStmt = db.prepare('DELETE FROM oauth_states WHERE created_at < ?');

  const setOAuthSessStmt = db.prepare(
    'INSERT OR REPLACE INTO oauth_sessions (sub, value, updated_at) VALUES (?, ?, ?)'
  );
  const getOAuthSessStmt = db.prepare('SELECT value FROM oauth_sessions WHERE sub = ?');
  const delOAuthSessStmt = db.prepare('DELETE FROM oauth_sessions WHERE sub = ?');

  const oauthClient = new NodeOAuthClient({
    clientMetadata,
    ...(isHttps ? { keyset: [oauthKey] } : {}),
    requestLock: requestLocalLock,
    stateStore: {
      async set(key, value) {
        pruneStateStmt.run(Date.now() - 30 * 60 * 1000);
        setStateStmt.run(key, JSON.stringify(value), Date.now());
      },
      async get(key) {
        const row = getStateStmt.get(key);
        return row ? JSON.parse(row.value) : undefined;
      },
      async del(key) {
        delStateStmt.run(key);
      }
    },
    sessionStore: {
      async set(sub, session) {
        setOAuthSessStmt.run(sub, JSON.stringify(session), Date.now());
      },
      async get(sub) {
        const row = getOAuthSessStmt.get(sub);
        return row ? JSON.parse(row.value) : undefined;
      },
      async del(sub) {
        delOAuthSessStmt.run(sub);
      }
    }
  });

  const insertWebSessionStmt = db.prepare(`
    INSERT OR REPLACE INTO web_sessions (
      token, did, handle, display_name, avatar, auth_mode,
      pds_url, access_jwt, refresh_jwt, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getWebSessionStmt = db.prepare('SELECT * FROM web_sessions WHERE token = ?');
  const updateWebSessionJwtStmt = db.prepare(
    'UPDATE web_sessions SET access_jwt = ?, refresh_jwt = ? WHERE token = ?'
  );
  const deleteWebSessionStmt = db.prepare('DELETE FROM web_sessions WHERE token = ?');

  function makeSetCookieHeader(token, maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)) {
    const parts = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSec}`
    ];
    if (isHttps) parts.push('Secure');
    return parts.join('; ');
  }

  function clearSessionCookieHeader() {
    return makeSetCookieHeader('', 0);
  }

  async function resolveDidAndPds(identifier) {
    const clean = normalizeHandleOrDid(identifier);
    if (!clean) throw new Error('Please enter your Bluesky / ATProto handle or DID.');

    let did = clean.startsWith('did:') ? clean : null;
    if (!did) {
      try {
        did = await idResolver.handle.resolve(clean);
      } catch {
        // Fallback to public Bluesky XRPC handle resolver
      }
      if (!did) {
        const res = await fetch(
          `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(clean)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const body = await res.json();
          did = body.did;
        }
      }
    }

    let pdsUrl = 'https://bsky.social';
    let handle = clean;
    if (did) {
      try {
        const atpData = await idResolver.did.resolveAtprotoData(did);
        if (atpData?.pds) pdsUrl = atpData.pds;
        if (atpData?.handle) handle = atpData.handle;
      } catch {
        // Keep default fallback
      }
    }

    return { did, handle, pdsUrl };
  }

  async function startOAuthLogin(identifier) {
    const clean = normalizeHandleOrDid(identifier);
    if (!clean) {
      throw new Error('Please enter your Bluesky / ATProto handle (e.g. symmetricalboy.com).');
    }
    const authUrl = await oauthClient.authorize(clean, {
      scope: OPENGAMING_OAUTH_SCOPE
    });
    return authUrl.toString();
  }

  async function handleOAuthCallback(searchParams) {
    const { session } = await oauthClient.callback(searchParams);
    const did = session.did;

    const bskyProfile = await fetchPublicBskyProfile(did);
    let handle = bskyProfile?.handle || did;
    if (handle === did) {
      try {
        const atpData = await idResolver.did.resolveAtprotoData(did);
        if (atpData?.handle) handle = atpData.handle;
      } catch {
        // Ignore
      }
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    insertWebSessionStmt.run(
      token,
      did,
      handle,
      bskyProfile?.displayName || handle,
      bskyProfile?.avatar || null,
      'oauth',
      null,
      null,
      null,
      now,
      now + SESSION_TTL_MS
    );

    return {
      token,
      cookieHeader: makeSetCookieHeader(token),
      user: {
        did,
        handle,
        displayName: bskyProfile?.displayName || handle,
        avatar: bskyProfile?.avatar || null,
        authMode: 'oauth'
      }
    };
  }

  async function loginWithAppPassword(identifier, appPassword) {
    const cleanId = normalizeHandleOrDid(identifier);
    const cleanPass = String(appPassword || '').trim();
    if (!cleanId || !cleanPass) {
      throw new Error('Both handle and App Password are required.');
    }

    const { did: resolvedDid, pdsUrl } = await resolveDidAndPds(cleanId);
    const agent = new AtpAgent({ service: pdsUrl });
    const loginRes = await agent.login({
      identifier: resolvedDid || cleanId,
      password: cleanPass
    });

    const did = loginRes.data.did;
    const handle = loginRes.data.handle || cleanId;
    const bskyProfile = await fetchPublicBskyProfile(did);

    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    insertWebSessionStmt.run(
      token,
      did,
      bskyProfile?.handle || handle,
      bskyProfile?.displayName || handle,
      bskyProfile?.avatar || null,
      'app-password',
      pdsUrl,
      loginRes.data.accessJwt,
      loginRes.data.refreshJwt,
      now,
      now + SESSION_TTL_MS
    );

    return {
      token,
      cookieHeader: makeSetCookieHeader(token),
      user: {
        did,
        handle: bskyProfile?.handle || handle,
        displayName: bskyProfile?.displayName || handle,
        avatar: bskyProfile?.avatar || null,
        authMode: 'app-password'
      }
    };
  }

  function getSessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;

    const row = getWebSessionStmt.get(token);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      deleteWebSessionStmt.run(token);
      return null;
    }
    return row;
  }

  async function getAuthenticatedAgent(req) {
    const row = getSessionFromRequest(req);
    if (!row) return null;

    const user = {
      did: row.did,
      handle: row.handle,
      displayName: row.display_name || row.handle,
      avatar: row.avatar || null,
      authMode: row.auth_mode
    };

    if (row.auth_mode === 'oauth') {
      try {
        const oauthSession = await oauthClient.restore(row.did);
        const agent = new Agent(oauthSession);
        return { user, agent, sessionRow: row };
      } catch {
        deleteWebSessionStmt.run(row.token);
        return null;
      }
    }

    // App-password session
    const agent = new AtpAgent({
      service: row.pds_url || 'https://bsky.social',
      persistSession: (_evt, sess) => {
        if (sess?.accessJwt && sess?.refreshJwt) {
          updateWebSessionJwtStmt.run(sess.accessJwt, sess.refreshJwt, row.token);
        }
      }
    });

    try {
      await agent.resumeSession({
        did: row.did,
        handle: row.handle,
        accessJwt: row.access_jwt,
        refreshJwt: row.refresh_jwt,
        active: true
      });
      return { user, agent, sessionRow: row };
    } catch {
      deleteWebSessionStmt.run(row.token);
      return null;
    }
  }

  async function logoutRequest(req) {
    const row = getSessionFromRequest(req);
    if (row) {
      deleteWebSessionStmt.run(row.token);
      if (row.auth_mode === 'oauth') {
        try {
          await oauthClient.revoke(row.did);
        } catch {
          // Ignore upstream revocation failure
        }
      }
    }
    return clearSessionCookieHeader();
  }

  return {
    oauthClient,
    clientMetadata,
    jwks: oauthClient.jwks,
    isHttps,
    startOAuthLogin,
    handleOAuthCallback,
    loginWithAppPassword,
    getSessionFromRequest,
    getAuthenticatedAgent,
    logoutRequest,
    clearSessionCookieHeader,
    fetchPublicBskyProfile
  };
}
