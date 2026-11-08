import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ATTESTATION_KEY_FRAGMENT,
  NSIDS,
  getBestOnlyScoreRkey,
  verifyRecordAttestation
} from '@opengaming/sdk';
import {
  FLAPPYSKY_ACHIEVEMENTS,
  FLAPPYSKY_LEADERBOARD
} from '../src/achievements-catalog.js';
import {
  createEmptyStats,
  evaluateFlappyskyAchievements,
  validateRunPayload
} from '../src/achievements-rules.js';
import { createFlappyskyApp } from '../server.mjs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

test('Flappysky catalog defines all 14 XP-free achievements, SVG icons, and 1 All-Time Best Score leaderboard', async () => {
  assert.equal(FLAPPYSKY_ACHIEVEMENTS.length, 14);

  const expectedIds = [
    'first-flight',
    'play-10',
    'play-50',
    'play-100',
    'score-50',
    'score-100',
    'score-250',
    'likes-50',
    'likes-100',
    'likes-250',
    'play-desktop',
    'play-mobile',
    'ratioed-by-love',
    'touch-grass'
  ];
  assert.deepEqual(
    FLAPPYSKY_ACHIEVEMENTS.map((a) => a.id),
    expectedIds
  );

  for (const ach of FLAPPYSKY_ACHIEVEMENTS) {
    assert.equal('xp' in ach, false, `Achievement ${ach.id} must not have XP`);
    const diskPath = join(PROJECT_ROOT, ach.iconPath.replace(/^\//, ''));
    await access(diskPath);
    const svg = await readFile(diskPath, 'utf8');
    assert.match(svg, /<svg\b/);
  }

  // Check Touch Grass matches exact reference achievement
  const touchGrass = FLAPPYSKY_ACHIEVEMENTS.find((a) => a.id === 'touch-grass');
  assert.ok(touchGrass);
  assert.equal(touchGrass.title, 'Touch Grass');
  assert.equal(
    touchGrass.description,
    'Bonked straight into the ground without clearing a single post.'
  );
  assert.equal(touchGrass.tier, 'bronze');
  assert.equal(touchGrass.hidden, true);

  // Check helper icons exist
  for (const extra of ['assets/achievements/locked-secret.svg', 'assets/achievements/high-score.svg']) {
    const svg = await readFile(join(PROJECT_ROOT, extra), 'utf8');
    assert.match(svg, /<svg\b/);
  }

  // Check single All-Time Best Score leaderboard
  assert.equal(FLAPPYSKY_LEADERBOARD.id, 'high-score');
  assert.deepEqual(FLAPPYSKY_LEADERBOARD.timeframes, ['allTime']);
  assert.equal(FLAPPYSKY_LEADERBOARD.recordPolicy, 'bestOnly');
  assert.equal(FLAPPYSKY_LEADERBOARD.sortOrder, 'largerIsBetter');
});

test('Rule engine evaluates all 14 achievements, incremental step progress, live milestones, and run plausibility', () => {
  // 1. Validate run payload checks
  assert.equal(validateRunPayload({ posts: 0, likes: 1, score: 1, cause: 'ground', platform: 'desktop' }).valid, true);
  assert.equal(validateRunPayload({ posts: 5, likes: 3, score: 99, cause: 'post', platform: 'desktop' }).valid, false);
  assert.equal(validateRunPayload({ posts: 0, likes: 12, score: 12, cause: 'post', platform: 'desktop' }).valid, false);
  assert.equal(validateRunPayload({ posts: -1, likes: 1, score: 0, cause: 'post', platform: 'desktop' }).valid, false);

  // 2. Touch Grass negative vs positive cases
  const postZeroCrash = evaluateFlappyskyAchievements({
    previousStats: createEmptyStats(),
    run: { posts: 0, likes: 0, score: 0, cause: 'post', platform: 'desktop' }
  });
  assert.equal(postZeroCrash.allUnlockedIds.includes('touch-grass'), false);
  assert.equal(postZeroCrash.allUnlockedIds.includes('first-flight'), true);
  assert.equal(postZeroCrash.allUnlockedIds.includes('play-desktop'), true);

  const groundAfterOnePost = evaluateFlappyskyAchievements({
    previousStats: createEmptyStats(),
    run: { posts: 1, likes: 0, score: 1, cause: 'ground', platform: 'desktop' }
  });
  assert.equal(groundAfterOnePost.allUnlockedIds.includes('touch-grass'), false);

  const trueTouchGrass = evaluateFlappyskyAchievements({
    previousStats: createEmptyStats(),
    run: { posts: 0, likes: 0, score: 0, cause: 'ground', platform: 'mobile' }
  });
  assert.equal(trueTouchGrass.allUnlockedIds.includes('touch-grass'), true);
  assert.equal(trueTouchGrass.allUnlockedIds.includes('play-mobile'), true);

  // 3. Heart Over Hurdles (`ratioed-by-love`: likes > posts)
  const equalLikesPosts = evaluateFlappyskyAchievements({
    previousStats: createEmptyStats(),
    run: { posts: 5, likes: 5, score: 10, cause: 'post', platform: 'desktop' }
  });
  assert.equal(equalLikesPosts.allUnlockedIds.includes('ratioed-by-love'), false);

  const moreLikesThanPosts = evaluateFlappyskyAchievements({
    previousStats: createEmptyStats(),
    run: { posts: 4, likes: 5, score: 9, cause: 'post', platform: 'desktop' }
  });
  assert.equal(moreLikesThanPosts.allUnlockedIds.includes('ratioed-by-love'), true);

  // 4. Live mid-flight milestones do not increment gamesPlayed prematurely
  const midFlight = evaluateFlappyskyAchievements({
    previousStats: { gamesPlayed: 3, totalLikes: 48, bestScore: 20, playedDesktop: true, playedMobile: false },
    alreadyUnlockedIds: ['first-flight', 'play-desktop'],
    liveRun: { score: 52, likes: 3 }
  });
  assert.equal(midFlight.stats.gamesPlayed, 3);
  assert.deepEqual(
    midFlight.newlyUnlocked.map((a) => a.id),
    ['score-50', 'likes-50']
  );

  // 5. Cumulative flights (10, 50, 100), cumulative likes (50, 100, 250), and high scores (50, 100, 250)
  const nearCenturion = evaluateFlappyskyAchievements({
    previousStats: { gamesPlayed: 99, totalLikes: 245, bestScore: 120, playedDesktop: true, playedMobile: true },
    alreadyUnlockedIds: [
      'first-flight',
      'play-10',
      'play-50',
      'score-50',
      'score-100',
      'likes-50',
      'likes-100',
      'play-desktop',
      'play-mobile'
    ],
    run: { posts: 200, likes: 55, score: 255, cause: 'post', platform: 'desktop' }
  });
  assert.equal(nearCenturion.stats.gamesPlayed, 100);
  assert.equal(nearCenturion.stats.totalLikes, 300);
  assert.equal(nearCenturion.stats.bestScore, 255);
  assert.deepEqual(
    nearCenturion.newlyUnlocked.map((a) => a.id),
    ['play-100', 'score-250', 'likes-250']
  );
  assert.equal(nearCenturion.progressMap['play-100'].currentSteps, 100);
  assert.equal(nearCenturion.progressMap['likes-250'].currentSteps, 250);
});

test('Server HTTP endpoints, did:web XRPC repo, cryptographic attestations, bestOnly leaderboard, and PDS hydration work end-to-end', async (t) => {
  const publicOrigin = 'https://flappysky.symmetricalboy.com';
  const app = await createFlappyskyApp({
    dbPath: ':memory:',
    publicOrigin,
    appViewUrls: []
  });

  await new Promise((resolveListen) => app.server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => {
    app.server.close();
    app.db.close();
  });

  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Health & did:web verification
  const healthRes = await fetch(`${baseUrl}/health`);
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.status, 'ok');
  assert.equal(health.gameDid, 'did:web:flappysky.symmetricalboy.com');
  assert.equal(health.achievements, 14);
  assert.equal(health.leaderboard, 'high-score');

  const didDocRes = await fetch(`${baseUrl}/.well-known/did.json`);
  assert.equal(didDocRes.status, 200);
  const didDoc = await didDocRes.json();
  assert.equal(didDoc.id, 'did:web:flappysky.symmetricalboy.com');
  const vm = didDoc.verificationMethod.find((m) =>
    m.id.endsWith(ATTESTATION_KEY_FRAGMENT)
  );
  assert.ok(vm?.publicKeyMultibase);
  const publishedDidKey = `did:key:${vm.publicKeyMultibase}`;
  assert.equal(publishedDidKey, app.authority.publicDidKey);

  const atprotoDidText = await (await fetch(`${baseUrl}/.well-known/atproto-did`)).text();
  assert.equal(atprotoDidText, 'did:web:flappysky.symmetricalboy.com');

  // 2. OAuth confidential client metadata + logo PNG
  const metaRes = await fetch(`${baseUrl}/oauth/client-metadata.json`);
  assert.equal(metaRes.status, 200);
  const meta = await metaRes.json();
  assert.equal(meta.client_id, `${publicOrigin}/oauth/client-metadata.json`);
  assert.match(meta.scope, /games\.opengaming\.achievement\.unlock/);
  assert.match(meta.scope, /games\.opengaming\.leaderboard\.score/);

  const logoRes = await fetch(`${baseUrl}/oauth/logo.png`);
  assert.equal(logoRes.status, 200);
  const logoBytes = Buffer.from(await logoRes.arrayBuffer());
  assert.deepEqual(logoBytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // 3. Read-only ATProto PDS XRPC endpoints (`listRecords`, `getRecord`, `getBlob`)
  const achRecordsRes = await fetch(
    `${baseUrl}/xrpc/com.atproto.repo.listRecords?collection=${encodeURIComponent(NSIDS.AchievementDefinition)}`
  );
  assert.equal(achRecordsRes.status, 200);
  const achRecordsData = await achRecordsRes.json();
  assert.equal(achRecordsData.records.length, 14);

  const touchGrassRecRes = await fetch(
    `${baseUrl}/xrpc/com.atproto.repo.getRecord?collection=${encodeURIComponent(NSIDS.AchievementDefinition)}&rkey=touch-grass`
  );
  assert.equal(touchGrassRecRes.status, 200);
  const touchGrassRec = await touchGrassRecRes.json();
  assert.equal(touchGrassRec.value.title, 'Touch Grass');
  assert.equal(touchGrassRec.value.hidden, true);

  const blobCid = touchGrassRec.value.icon.ref.$link;
  const blobRes = await fetch(
    `${baseUrl}/xrpc/com.atproto.sync.getBlob?cid=${encodeURIComponent(blobCid)}`
  );
  assert.equal(blobRes.status, 200);
  assert.equal(blobRes.headers.get('content-type'), 'image/png');
  const blobBytes = Buffer.from(await blobRes.arrayBuffer());
  assert.deepEqual(blobBytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const lbRecordsRes = await fetch(
    `${baseUrl}/xrpc/com.atproto.repo.listRecords?collection=${encodeURIComponent(NSIDS.LeaderboardDefinition)}`
  );
  const lbRecordsData = await lbRecordsRes.json();
  assert.equal(lbRecordsData.records.length, 1);
  assert.deepEqual(lbRecordsData.records[0].value.timeframes, ['allTime']);
  assert.equal(lbRecordsData.records[0].value.recordPolicy, 'bestOnly');

  // 4. Static assets & security boundaries
  const svgRes = await fetch(`${baseUrl}/assets/achievements/touch-grass.svg`);
  assert.equal(svgRes.status, 200);
  const blockedServerRes = await fetch(`${baseUrl}/server.mjs`);
  assert.equal(blockedServerRes.status, 404);
  const blockedDbRes = await fetch(`${baseUrl}/src/server/db.mjs`);
  assert.equal(blockedDbRes.status, 404);

  // 5. Mock Player PDS Repository + Signed Record Verification via @opengaming/sdk
  const playerUser = {
    did: 'did:plc:testpilotflappysky001',
    handle: 'pilot.symmetricalboy.com',
    displayName: 'Sky Pilot',
    avatar: null
  };
  const mockPdsRepo = new Map(); // key: `${collection}/${rkey}` -> { uri, value }
  const mockAgent = {
    com: {
      atproto: {
        repo: {
          async putRecord({ repo, collection, rkey, record }) {
            const uri = `at://${repo}/${collection}/${rkey}`;
            mockPdsRepo.set(`${collection}/${rkey}`, { uri, value: record });
            return { data: { uri, cid: 'bafyreimockcid' } };
          },
          async listRecords({ collection }) {
            const records = [];
            for (const [key, entry] of mockPdsRepo.entries()) {
              if (key.startsWith(`${collection}/`)) {
                records.push(entry);
              }
            }
            return { data: { records } };
          }
        }
      }
    }
  };

  // Run #1: Collect 1 Like before clearing Post #1, then bonk into ground!
  // Should unlock: first-flight, play-desktop, ratioed-by-love, touch-grass + best score 1 pt!
  const sync1 = await app.authority.syncPlayerRunAndAchievements({
    user: playerUser,
    agent: mockAgent,
    run: { posts: 0, likes: 1, score: 1, cause: 'ground', platform: 'desktop' }
  });

  assert.deepEqual(
    sync1.newlySignedUnlocks.map((u) => u.id).sort(),
    ['first-flight', 'play-desktop', 'ratioed-by-love', 'touch-grass']
  );
  assert.equal(sync1.signedScoreResult?.score, 1);
  assert.equal(sync1.signedScoreResult?.displayScore, '1 pt');

  // Cryptographically verify every single PDS record written by Flappysky against `/.well-known/did.json`!
  for (const [, entry] of mockPdsRepo.entries()) {
    const verification = await verifyRecordAttestation({
      record: entry.value,
      playerDid: playerUser.did,
      recordUri: entry.uri,
      expectedIssuerDid: didDoc.id,
      publicDidKey: publishedDidKey
    });
    assert.equal(
      verification.verified,
      true,
      `Failed cryptographic attestation verification for ${entry.uri}: ${verification.message}`
    );
  }

  // Run #2: High-flying mobile run scoring 105 (60 posts + 45 likes)
  const sync2 = await app.authority.syncPlayerRunAndAchievements({
    user: playerUser,
    agent: mockAgent,
    run: { posts: 60, likes: 45, score: 105, cause: 'post', platform: 'mobile' }
  });
  assert.deepEqual(
    sync2.newlySignedUnlocks.map((u) => u.id).sort(),
    ['play-mobile', 'score-100', 'score-50']
  );
  assert.equal(sync2.signedScoreResult?.score, 105);
  assert.equal(sync2.signedScoreResult?.displayScore, '105 pts');

  const expectedScoreRkey = getBestOnlyScoreRkey(app.authority.leaderboardUri);
  assert.equal(
    mockPdsRepo.get(`${NSIDS.LeaderboardScore}/${expectedScoreRkey}`)?.value.score,
    105
  );

  // Run #3: Lower score (12 pts) must NOT overwrite the `bestOnly` 105 pts record,
  // while cumulative likes (1 + 45 + 6 = 52) MUST unlock `likes-50`!
  const sync3 = await app.authority.syncPlayerRunAndAchievements({
    user: playerUser,
    agent: mockAgent,
    run: { posts: 6, likes: 6, score: 12, cause: 'post', platform: 'desktop' }
  });
  assert.equal(sync3.signedScoreResult, null);
  assert.deepEqual(
    sync3.newlySignedUnlocks.map((u) => u.id),
    ['likes-50']
  );
  assert.equal(
    mockPdsRepo.get(`${NSIDS.LeaderboardScore}/${expectedScoreRkey}`)?.value.score,
    105
  );

  // Verify `/api/opengaming/leaderboard` returns #1 Sky Pilot with 105 pts
  const lbApiRes = await fetch(`${baseUrl}/api/opengaming/leaderboard?scope=public`);
  assert.equal(lbApiRes.status, 200);
  const lbApiData = await lbApiRes.json();
  assert.equal(lbApiData.leaderboard.timeframe, 'allTime');
  assert.equal(lbApiData.leaderboard.recordPolicy, 'bestOnly');
  assert.equal(lbApiData.entries.length, 1);
  assert.equal(lbApiData.entries[0].rank, 1);
  assert.equal(lbApiData.entries[0].score, 105);
  assert.equal(lbApiData.entries[0].displayScore, '105 pts');

  // 6. Verify portable PDS hydration into a brand-new server DB sharing the same signing key
  const savedPrivKey = app.db
    .prepare('SELECT value FROM kv_store WHERE key = ?')
    .get('attestation_private_key').value;
  process.env.OPENGAMING_PRIVATE_KEY = savedPrivKey;
  try {
    const freshApp = await createFlappyskyApp({
      dbPath: ':memory:',
      publicOrigin,
      appViewUrls: []
    });
    t.after(() => freshApp.db.close());

    await freshApp.authority.hydratePlayerFromPds({
      user: playerUser,
      agent: mockAgent
    });

    const hydrated = freshApp.authority.getStoredPlayerSnapshot(playerUser.did);
    assert.equal(hydrated.completion.unlockedCount, 8);
    assert.equal(hydrated.bestScoreEntry?.score, 105);
  } finally {
    delete process.env.OPENGAMING_PRIVATE_KEY;
  }
});
