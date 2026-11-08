/**
 * Flappysky Open Gaming Authority & SDK Integration Layer
 *
 * Responsibilities:
 * - Manages Flappysky's `did:web` (or `FLAPPYSKY_GAME_DID`) P-256 `#attestations` signing keypair via `@opengaming/sdk`.
 * - Generates, Lexicon-validates, and serves Flappysky's canonical ATProto records:
 *     - `games.atmosphere.define/flappysky`
 *     - 14 `games.opengaming.achievement.definition/*` records
 *     - 1 `games.opengaming.leaderboard.definition/high-score` record (`allTime`, `bestOnly`)
 * - Serves `/.well-known/did.json`, `/.well-known/atproto-did`, and read-only `/xrpc/com.atproto.repo.*` + `/xrpc/com.atproto.sync.getBlob`
 *   so `opengaming.games` (and any ATProto AppView) can verify Flappysky attestations directly!
 * - Evaluates runs, signs player `achievement.unlock`, `achievement.progress`, and `leaderboard.score` records
 *   using `@opengaming/sdk`, writes them to the player's PDS via `com.atproto.repo.putRecord`, and notifies `opengaming.games`.
 */

import { BlobRef, jsonToLex } from '@atproto/api';
import { encode as dagCborEncode, code as DAG_CBOR_CODEC } from '@ipld/dag-cbor';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import {
  ATTESTATION_KEY_FRAGMENT,
  NSIDS,
  calculateGameCompletion,
  createOpenGamingLexicons,
  createSignedProgress,
  createSignedScore,
  createSignedUnlock,
  evaluateScoreSubmission,
  formatScore,
  generateSigningKeys,
  getBestOnlyScoreRkey,
  getUnlockRkey,
  loadSigningKey,
  verifyRecordAttestation
} from '@opengaming/sdk';
import {
  FLAPPYSKY_ACHIEVEMENTS,
  FLAPPYSKY_GAME_RKEY,
  FLAPPYSKY_LEADERBOARD,
  FLAPPYSKY_LEADERBOARD_RKEY
} from '../achievements-catalog.js';
import {
  createEmptyStats,
  evaluateFlappyskyAchievements,
  normalizeStats,
  validateRunPayload
} from '../achievements-rules.js';
import { generatePngIconBlob } from './png-icons.mjs';

const CATALOG_CREATED_AT = '2026-11-08T00:00:00.000Z';
const DEVELOPER_DID = process.env.FLAPPYSKY_DEVELOPER_DID || 'did:plc:33d7gnwiagm6cimpiepefp72';

function toIpldValue(val) {
  if (Array.isArray(val)) return val.map(toIpldValue);
  if (val && typeof val === 'object') {
    if (val instanceof BlobRef) return val.ipld();
    if (CID.asCID(val) || val instanceof Uint8Array) return val;
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) out[k] = toIpldValue(v);
    }
    return out;
  }
  return val;
}

async function computeRecordCid(record) {
  const bytes = dagCborEncode(toIpldValue(jsonToLex(record)));
  const digest = await sha256.digest(bytes);
  return CID.createV1(DAG_CBOR_CODEC, digest).toString();
}

export async function createOpenGamingAuthority({
  db,
  publicOrigin,
  issuerDidOverride,
  appViewUrls = []
}) {
  const parsedOrigin = new URL(publicOrigin);
  // Standard did:web encoding: host with optional port %3A-encoded
  const defaultDidWeb = `did:web:${encodeURIComponent(parsedOrigin.host)}`;
  const issuerDid = issuerDidOverride || process.env.FLAPPYSKY_GAME_DID || defaultDidWeb;
  const handle = parsedOrigin.hostname;

  // Load or persist P-256 attestation keypair
  const getKvStmt = db.prepare('SELECT value FROM kv_store WHERE key = ?');
  const setKvStmt = db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)');

  let signingKey;
  let publicDidKey;
  if (process.env.OPENGAMING_PRIVATE_KEY) {
    signingKey = await loadSigningKey(process.env.OPENGAMING_PRIVATE_KEY);
    publicDidKey = signingKey.did();
  } else {
    const savedKey = getKvStmt.get('attestation_private_key');
    if (savedKey?.value) {
      signingKey = await loadSigningKey(savedKey.value);
      publicDidKey = signingKey.did();
    } else {
      const generated = await generateSigningKeys();
      setKvStmt.run('attestation_private_key', generated.privateKeyBase64url);
      signingKey = generated.keypair;
      publicDidKey = generated.publicDidKey;
    }
  }

  const publicKeyMultibase = publicDidKey.replace(/^did:key:/, '');
  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1'
    ],
    id: issuerDid,
    alsoKnownAs: [`at://${handle}`],
    verificationMethod: [
      {
        id: `${issuerDid}${ATTESTATION_KEY_FRAGMENT}`,
        type: 'Multikey',
        controller: issuerDid,
        publicKeyMultibase
      }
    ],
    service: [
      {
        id: '#atproto_pds',
        type: 'AtprotoPersonalDataServer',
        serviceEndpoint: publicOrigin
      }
    ]
  };

  // Validate all Open Gaming schemas via bundled @opengaming/sdk Lexicons
  const lexicons = createOpenGamingLexicons();

  // Generate spec-compliant PNG icon blobs + CIDs
  const blobsByCid = new Map();
  const gameLogoBlob = await generatePngIconBlob({
    bg1: [2, 132, 199],
    bg2: [29, 78, 216],
    accent: [255, 255, 255],
    motif: 'butterfly'
  });
  blobsByCid.set(gameLogoBlob.cid, gameLogoBlob);

  const gameUri = `at://${issuerDid}/games.atmosphere.define/${FLAPPYSKY_GAME_RKEY}`;
  const gameRecord = {
    $type: 'games.atmosphere.define',
    name: 'Flappysky',
    tagline: 'Flutter between blue posts (+1) and collect floating heart Likes (+1) across the Atmosphere.',
    description:
      'A Bluesky-inspired arcade web game demonstrating portable AT Protocol achievements, incremental milestones, and cryptographically signed leaderboards via @opengaming/sdk.',
    url: publicOrigin,
    icon: gameLogoBlob.blobRef,
    category: 'browser',
    status: 'live',
    developer: {
      name: 'symmetricalboy',
      did: DEVELOPER_DID,
      url: 'https://symmetricalboy.com'
    },
    createdAt: CATALOG_CREATED_AT
  };
  const gameRecordCid = await computeRecordCid(gameRecord);

  // Build & validate all 14 Achievement Definitions
  const achievementEntries = [];
  const achievementById = new Map();
  const achievementByUri = new Map();

  for (const item of FLAPPYSKY_ACHIEVEMENTS) {
    const iconBlob = await generatePngIconBlob(item.palette);
    blobsByCid.set(iconBlob.cid, iconBlob);

    const uri = `at://${issuerDid}/${NSIDS.AchievementDefinition}/${item.id}`;
    const record = {
      $type: NSIDS.AchievementDefinition,
      game: gameUri,
      title: item.title,
      description: item.description,
      requirement: item.requirement,
      icon: iconBlob.blobRef,
      iconAlt: item.iconAlt,
      tier: item.tier,
      hidden: Boolean(item.hidden),
      ...(item.stepsNeeded ? { stepsNeeded: item.stepsNeeded } : {}),
      listOrder: item.listOrder,
      createdAt: CATALOG_CREATED_AT
    };

    lexicons.assertValidRecord(NSIDS.AchievementDefinition, jsonToLex(record));
    const cid = await computeRecordCid(record);

    const entry = {
      id: item.id,
      rkey: item.id,
      uri,
      cid,
      catalog: item,
      iconBlob,
      record
    };
    achievementEntries.push(entry);
    achievementById.set(item.id, entry);
    achievementByUri.set(uri, entry);
  }

  // Build & validate the single Leaderboard Definition: All-Time Best Score (`allTime`, `bestOnly`)
  const lbBlob = await generatePngIconBlob(FLAPPYSKY_LEADERBOARD.palette);
  blobsByCid.set(lbBlob.cid, lbBlob);

  const leaderboardUri = `at://${issuerDid}/${NSIDS.LeaderboardDefinition}/${FLAPPYSKY_LEADERBOARD_RKEY}`;
  const leaderboardRecord = {
    $type: NSIDS.LeaderboardDefinition,
    game: gameUri,
    name: FLAPPYSKY_LEADERBOARD.name,
    description: FLAPPYSKY_LEADERBOARD.description,
    icon: lbBlob.blobRef,
    iconAlt: FLAPPYSKY_LEADERBOARD.iconAlt,
    sortOrder: FLAPPYSKY_LEADERBOARD.sortOrder,
    scoreFormat: FLAPPYSKY_LEADERBOARD.scoreFormat,
    timeframes: FLAPPYSKY_LEADERBOARD.timeframes,
    recordPolicy: FLAPPYSKY_LEADERBOARD.recordPolicy,
    scoreMin: FLAPPYSKY_LEADERBOARD.scoreMin,
    scoreMax: FLAPPYSKY_LEADERBOARD.scoreMax,
    listOrder: FLAPPYSKY_LEADERBOARD.listOrder,
    createdAt: CATALOG_CREATED_AT
  };
  lexicons.assertValidRecord(NSIDS.LeaderboardDefinition, jsonToLex(leaderboardRecord));
  const leaderboardRecordCid = await computeRecordCid(leaderboardRecord);

  // Organized collection map for read-only ATProto PDS XRPC endpoints
  const repoCollections = new Map([
    [
      'games.atmosphere.define',
      [{ uri: gameUri, cid: gameRecordCid, rkey: FLAPPYSKY_GAME_RKEY, value: gameRecord }]
    ],
    [
      NSIDS.AchievementDefinition,
      achievementEntries.map((e) => ({
        uri: e.uri,
        cid: e.cid,
        rkey: e.rkey,
        value: e.record
      }))
    ],
    [
      NSIDS.LeaderboardDefinition,
      [
        {
          uri: leaderboardUri,
          cid: leaderboardRecordCid,
          rkey: FLAPPYSKY_LEADERBOARD_RKEY,
          value: leaderboardRecord
        }
      ]
    ],
    [NSIDS.Revocation, []]
  ]);

  // Prepared SQLite statements for verified player state
  const getStatsStmt = db.prepare('SELECT * FROM player_stats WHERE did = ?');
  const upsertStatsStmt = db.prepare(`
    INSERT INTO player_stats (
      did, handle, display_name, avatar,
      games_played, total_likes, best_score, played_desktop, played_mobile, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(did) DO UPDATE SET
      handle = excluded.handle,
      display_name = excluded.display_name,
      avatar = excluded.avatar,
      games_played = MAX(player_stats.games_played, excluded.games_played),
      total_likes = MAX(player_stats.total_likes, excluded.total_likes),
      best_score = MAX(player_stats.best_score, excluded.best_score),
      played_desktop = MAX(player_stats.played_desktop, excluded.played_desktop),
      played_mobile = MAX(player_stats.played_mobile, excluded.played_mobile),
      updated_at = excluded.updated_at
  `);

  const listUnlocksStmt = db.prepare('SELECT * FROM verified_unlocks WHERE did = ?');
  const insertUnlockStmt = db.prepare(`
    INSERT OR IGNORE INTO verified_unlocks (
      did, achievement_id, achievement_uri, record_uri, attestation_cid, record_json, unlocked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const listProgressStmt = db.prepare('SELECT * FROM verified_progress WHERE did = ?');
  const upsertProgressStmt = db.prepare(`
    INSERT INTO verified_progress (
      did, achievement_id, achievement_uri, current_steps, steps_needed, record_uri, record_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(did, achievement_id) DO UPDATE SET
      current_steps = MAX(verified_progress.current_steps, excluded.current_steps),
      record_uri = excluded.record_uri,
      record_json = excluded.record_json,
      updated_at = excluded.updated_at
  `);

  const getScoreStmt = db.prepare('SELECT * FROM verified_scores WHERE did = ?');
  const upsertScoreStmt = db.prepare(`
    INSERT INTO verified_scores (
      did, handle, display_name, avatar, score, display_score, posts, likes,
      record_uri, attestation_cid, record_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(did) DO UPDATE SET
      handle = excluded.handle,
      display_name = excluded.display_name,
      avatar = excluded.avatar,
      score = excluded.score,
      display_score = excluded.display_score,
      posts = excluded.posts,
      likes = excluded.likes,
      record_uri = excluded.record_uri,
      attestation_cid = excluded.attestation_cid,
      record_json = excluded.record_json,
      recorded_at = excluded.recorded_at
    WHERE excluded.score > verified_scores.score
  `);

  const topScoresStmt = db.prepare(
    'SELECT * FROM verified_scores ORDER BY score DESC, recorded_at ASC LIMIT ?'
  );

  const resolvedAppViews = (
    appViewUrls.length > 0
      ? appViewUrls
      : (process.env.OPENGAMING_APPVIEW_URL || 'https://opengaming.games')
          .split(',')
          .map((s) => s.trim().replace(/\/+$/, ''))
          .filter(Boolean)
  );

  let publisherSyncedOnce = false;

  async function notifyAppViews(actorsToSync) {
    if (!publicOrigin.startsWith('https://')) return;
    const includePublisher = !publisherSyncedOnce;
    const actors = includePublisher ? [issuerDid, ...actorsToSync] : actorsToSync;

    for (const baseUrl of resolvedAppViews) {
      for (const actor of actors) {
        try {
          const res = await fetch(`${baseUrl}/api/sync-repo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor }),
            signal: AbortSignal.timeout(8000)
          });
          if (res.ok && actor === issuerDid) {
            publisherSyncedOnce = true;
          }
        } catch {
          // Non-fatal if AppView is redeploying
        }
      }
    }
  }

  function getStoredPlayerSnapshot(did) {
    const statsRow = getStatsStmt.get(did);
    const stats = statsRow
      ? {
          gamesPlayed: statsRow.games_played,
          totalLikes: statsRow.total_likes,
          bestScore: statsRow.best_score,
          playedDesktop: Boolean(statsRow.played_desktop),
          playedMobile: Boolean(statsRow.played_mobile)
        }
      : createEmptyStats();

    const unlockRows = listUnlocksStmt.all(did);
    const unlocks = {};
    const verifiedUnlockRecords = [];
    for (const r of unlockRows) {
      unlocks[r.achievement_id] = {
        unlockedAt: r.unlocked_at,
        recordUri: r.record_uri,
        attestationCid: r.attestation_cid
      };
      try {
        verifiedUnlockRecords.push(JSON.parse(r.record_json));
      } catch {
        // Ignore
      }
    }

    const progressRows = listProgressStmt.all(did);
    const progress = {};
    for (const r of progressRows) {
      progress[r.achievement_id] = {
        currentSteps: r.current_steps,
        stepsNeeded: r.steps_needed,
        updatedAt: r.updated_at,
        recordUri: r.record_uri
      };
    }

    const scoreRow = getScoreStmt.get(did);
    const bestScoreEntry = scoreRow
      ? {
          score: scoreRow.score,
          displayScore: scoreRow.display_score,
          posts: scoreRow.posts,
          likes: scoreRow.likes,
          recordUri: scoreRow.record_uri,
          attestationCid: scoreRow.attestation_cid,
          recordedAt: scoreRow.recorded_at
        }
      : null;

    const completion = calculateGameCompletion({
      game: gameUri,
      verifiedUnlocks: verifiedUnlockRecords,
      definitions: achievementEntries.map((e) => ({ uri: e.uri, record: e.record }))
    });

    return {
      stats,
      unlocks,
      progress,
      bestScoreEntry,
      completion
    };
  }

  /**
   * Hydrate any existing verified Flappysky records directly from a player's PDS repository
   * (portable across devices & browsers!).
   */
  async function hydratePlayerFromPds({ user, agent }) {
    try {
      const [unlockList, scoreList] = await Promise.all([
        agent.com.atproto.repo
          .listRecords({ repo: user.did, collection: NSIDS.AchievementUnlock, limit: 100 })
          .catch(() => ({ data: { records: [] } })),
        agent.com.atproto.repo
          .listRecords({ repo: user.did, collection: NSIDS.LeaderboardScore, limit: 50 })
          .catch(() => ({ data: { records: [] } }))
      ]);

      for (const item of unlockList.data.records || []) {
        const val = item.value;
        const defEntry = achievementByUri.get(val?.achievement);
        if (!defEntry) continue;

        const verification = await verifyRecordAttestation({
          record: val,
          playerDid: user.did,
          recordUri: item.uri,
          expectedIssuerDid: issuerDid,
          publicDidKey
        });
        if (verification.verified && verification.attestationCid) {
          insertUnlockStmt.run(
            user.did,
            defEntry.id,
            defEntry.uri,
            item.uri,
            verification.attestationCid,
            JSON.stringify(val),
            val.unlockedAt || new Date().toISOString()
          );
        }
      }

      for (const item of scoreList.data.records || []) {
        const val = item.value;
        if (val?.leaderboard !== leaderboardUri) continue;

        const verification = await verifyRecordAttestation({
          record: val,
          playerDid: user.did,
          recordUri: item.uri,
          expectedIssuerDid: issuerDid,
          publicDidKey
        });
        if (verification.verified && verification.attestationCid) {
          upsertScoreStmt.run(
            user.did,
            user.handle,
            user.displayName || user.handle,
            user.avatar || null,
            val.score,
            val.displayScore || formatScore(val.score, FLAPPYSKY_LEADERBOARD.scoreFormat),
            0,
            0,
            item.uri,
            verification.attestationCid,
            JSON.stringify(val),
            val.recordedAt || new Date().toISOString()
          );
        }
      }
    } catch {
      // Non-fatal hydration warning
    }
  }

  /**
   * Sign and sync a completed Flappysky run (and/or cumulative guest progress on sign-in)
   * to the authenticated player's PDS using `@opengaming/sdk`.
   */
  async function syncPlayerRunAndAchievements({
    user,
    agent = null,
    run = null,
    guestBaseline = null
  }) {
    const nowIso = new Date().toISOString();
    const snapshot = getStoredPlayerSnapshot(user.did);

    // Merge guest baseline stats safely (capped to plausible bounds) so players signing in after playing
    // as a guest immediately earn their signed ATProto records!
    let mergedBaseStats = { ...snapshot.stats };
    if (guestBaseline && typeof guestBaseline === 'object') {
      const normalizedGuest = normalizeStats(guestBaseline);
      mergedBaseStats = {
        gamesPlayed: Math.max(mergedBaseStats.gamesPlayed, Math.min(normalizedGuest.gamesPlayed, 50_000)),
        totalLikes: Math.max(mergedBaseStats.totalLikes, Math.min(normalizedGuest.totalLikes, 250_000)),
        bestScore: Math.max(mergedBaseStats.bestScore, Math.min(normalizedGuest.bestScore, 9999)),
        playedDesktop: mergedBaseStats.playedDesktop || normalizedGuest.playedDesktop,
        playedMobile: mergedBaseStats.playedMobile || normalizedGuest.playedMobile
      };
    }

    let validatedRun = null;
    if (run !== null && run !== undefined) {
      const check = validateRunPayload(run);
      if (!check.valid) {
        throw new Error(check.reason);
      }
      validatedRun = check.run;
    }

    const guestClaimedUnlockIds = Array.isArray(guestBaseline?.unlockedIds)
      ? guestBaseline.unlockedIds.filter((id) =>
          // Only allow guest carry-over for condition achievements that are plausible with their guest stats
          (id === 'touch-grass' && mergedBaseStats.gamesPlayed >= 1) ||
          (id === 'ratioed-by-love' && mergedBaseStats.totalLikes >= 1 && mergedBaseStats.gamesPlayed >= 1)
        )
      : [];

    const existingIds = Object.keys(snapshot.unlocks);
    const evaluation = evaluateFlappyskyAchievements({
      previousStats: mergedBaseStats,
      alreadyUnlockedIds: existingIds,
      run: validatedRun
    });

    // Include plausible guest-earned condition achievements not yet written to PDS
    for (const claimedId of guestClaimedUnlockIds) {
      if (!existingIds.includes(claimedId) && !evaluation.allUnlockedIds.includes(claimedId)) {
        evaluation.allUnlockedIds.push(claimedId);
        const entry = achievementById.get(claimedId);
        if (entry) evaluation.newlyUnlocked.push(entry.catalog);
      }
    }

    upsertStatsStmt.run(
      user.did,
      user.handle,
      user.displayName || user.handle,
      user.avatar || null,
      evaluation.stats.gamesPlayed,
      evaluation.stats.totalLikes,
      evaluation.stats.bestScore,
      evaluation.stats.playedDesktop ? 1 : 0,
      evaluation.stats.playedMobile ? 1 : 0,
      nowIso
    );

    const pdsWrites = [];
    const newlySignedUnlocks = [];

    // 1. Sign & write any unlocked achievements missing from `verified_unlocks`
    for (const achId of evaluation.allUnlockedIds) {
      if (snapshot.unlocks[achId]) continue;
      const defEntry = achievementById.get(achId);
      if (!defEntry) continue;

      const { record, attestationCid } = await createSignedUnlock({
        achievement: defEntry.uri,
        definitionCid: defEntry.cid,
        game: gameUri,
        playerDid: user.did,
        issuerDid,
        ...(defEntry.catalog.stepsNeeded ? { stepsCompleted: defEntry.catalog.stepsNeeded } : {}),
        unlockedAt: nowIso,
        signingKey
      });

      lexicons.assertValidRecord(NSIDS.AchievementUnlock, jsonToLex(record));

      const verifyRes = await verifyRecordAttestation({
        record,
        playerDid: user.did,
        expectedIssuerDid: issuerDid,
        publicDidKey
      });
      if (!verifyRes.verified) {
        throw new Error(`Self-verification failed for ${achId}: ${verifyRes.message}`);
      }

      const rkey = getUnlockRkey(defEntry.uri);
      const recordUri = `at://${user.did}/${NSIDS.AchievementUnlock}/${rkey}`;

      if (agent) {
        await agent.com.atproto.repo.putRecord({
          repo: user.did,
          collection: NSIDS.AchievementUnlock,
          rkey,
          record,
          validate: false
        });
        pdsWrites.push({ collection: NSIDS.AchievementUnlock, rkey, uri: recordUri });
      }

      insertUnlockStmt.run(
        user.did,
        achId,
        defEntry.uri,
        recordUri,
        attestationCid,
        JSON.stringify(record),
        nowIso
      );
      newlySignedUnlocks.push({
        id: achId,
        title: defEntry.catalog.title,
        tier: defEntry.catalog.tier,
        recordUri,
        attestationCid
      });
    }

    // 2. Sign & write incremental progress records for multi-step achievements not yet unlocked
    for (const [achId, prog] of Object.entries(evaluation.progressMap)) {
      if (evaluation.allUnlockedIds.includes(achId)) continue;
      if (prog.currentSteps <= 0) continue;

      const prevSteps = snapshot.progress[achId]?.currentSteps || 0;
      if (prog.currentSteps <= prevSteps) continue;

      const defEntry = achievementById.get(achId);
      if (!defEntry) continue;

      const { record } = await createSignedProgress({
        achievement: defEntry.uri,
        game: gameUri,
        currentSteps: prog.currentSteps,
        stepsNeeded: prog.stepsNeeded,
        playerDid: user.did,
        issuerDid,
        updatedAt: nowIso,
        signingKey
      });

      lexicons.assertValidRecord(NSIDS.AchievementProgress, jsonToLex(record));

      const rkey = getUnlockRkey(defEntry.uri);
      const recordUri = `at://${user.did}/${NSIDS.AchievementProgress}/${rkey}`;

      if (agent) {
        await agent.com.atproto.repo.putRecord({
          repo: user.did,
          collection: NSIDS.AchievementProgress,
          rkey,
          record,
          validate: false
        });
        pdsWrites.push({ collection: NSIDS.AchievementProgress, rkey, uri: recordUri });
      }

      upsertProgressStmt.run(
        user.did,
        achId,
        defEntry.uri,
        prog.currentSteps,
        prog.stepsNeeded,
        recordUri,
        JSON.stringify(record),
        nowIso
      );
    }

    // 3. Evaluate & sign All-Time Best Score (`bestOnly`, `allTime`)
    const candidateScore = validatedRun
      ? Math.max(validatedRun.score, evaluation.stats.bestScore)
      : evaluation.stats.bestScore;

    let signedScoreResult = null;
    if (candidateScore >= FLAPPYSKY_LEADERBOARD.scoreMin) {
      const existingScores = [];
      const existingRow = getScoreStmt.get(user.did);
      if (existingRow) {
        try {
          existingScores.push(JSON.parse(existingRow.record_json));
        } catch {
          // Ignore malformed row
        }
      }

      const decision = evaluateScoreSubmission({
        leaderboardUri,
        score: candidateScore,
        definition: leaderboardRecord,
        existingPlayerScores: existingScores
      });

      if (decision.shouldWrite) {
        const displayScore = formatScore(candidateScore, FLAPPYSKY_LEADERBOARD.scoreFormat);
        const tag = validatedRun && validatedRun.score === candidateScore
          ? `posts:${validatedRun.posts},likes:${validatedRun.likes}`
          : undefined;

        const { record, attestationCid } = await createSignedScore({
          leaderboard: leaderboardUri,
          definitionCid: leaderboardRecordCid,
          game: gameUri,
          playerDid: user.did,
          issuerDid,
          score: candidateScore,
          displayScore,
          tag,
          recordedAt: nowIso,
          signingKey
        });

        lexicons.assertValidRecord(NSIDS.LeaderboardScore, jsonToLex(record));

        const verifyScore = await verifyRecordAttestation({
          record,
          playerDid: user.did,
          expectedIssuerDid: issuerDid,
          publicDidKey
        });
        if (!verifyScore.verified) {
          throw new Error(`Score self-verification failed: ${verifyScore.message}`);
        }

        const rkey = decision.recommendedRkey || getBestOnlyScoreRkey(leaderboardUri);
        const recordUri = `at://${user.did}/${NSIDS.LeaderboardScore}/${rkey}`;

        if (agent) {
          await agent.com.atproto.repo.putRecord({
            repo: user.did,
            collection: NSIDS.LeaderboardScore,
            rkey,
            record,
            validate: false
          });
          pdsWrites.push({ collection: NSIDS.LeaderboardScore, rkey, uri: recordUri });
        }

        upsertScoreStmt.run(
          user.did,
          user.handle,
          user.displayName || user.handle,
          user.avatar || null,
          candidateScore,
          displayScore,
          validatedRun?.posts || 0,
          validatedRun?.likes || 0,
          recordUri,
          attestationCid,
          JSON.stringify(record),
          nowIso
        );

        signedScoreResult = {
          score: candidateScore,
          displayScore,
          recordUri,
          attestationCid
        };
      }
    }

    if (pdsWrites.length > 0) {
      notifyAppViews([user.did]).catch(() => {});
    }

    return {
      newlySignedUnlocks,
      signedScoreResult,
      pdsWrites,
      snapshot: getStoredPlayerSnapshot(user.did)
    };
  }

  /**
   * Fetch All-Time Best Score leaderboard (`allTime`), merging remote `opengaming.games` AppView
   * entries (including social follows filtering when `scope === 'social'`) with Flappysky's verified ledger.
   */
  async function getLeaderboardEntries({ scope = 'public', viewerDid = null, limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const mergedByDid = new Map();

    // 1. Local verified ledger entries
    let allowedSocialDids = null;
    if (scope === 'social' && viewerDid) {
      allowedSocialDids = new Set([viewerDid]);
      try {
        const followsRes = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${encodeURIComponent(viewerDid)}&limit=100`,
          { signal: AbortSignal.timeout(4500) }
        );
        if (followsRes.ok) {
          const data = await followsRes.json();
          for (const f of data.follows || []) {
            if (f.did) allowedSocialDids.add(f.did);
          }
        }
      } catch {
        // Fallback to viewer + remote AppView social query
      }
    }

    const localRows = topScoresStmt.all(200);
    for (const row of localRows) {
      if (allowedSocialDids && !allowedSocialDids.has(row.did)) continue;
      mergedByDid.set(row.did, {
        did: row.did,
        handle: row.handle || row.did,
        displayName: row.display_name || row.handle || row.did,
        avatar: row.avatar || null,
        score: row.score,
        displayScore: row.display_score,
        recordedAt: row.recorded_at,
        recordUri: row.record_uri,
        attestationCid: row.attestation_cid,
        verified: true
      });
    }

    // 2. Also query Open Gaming AppView XRPC (`games.opengaming.leaderboard.getScores`) for decentralized PDS writes
    for (const baseUrl of resolvedAppViews) {
      try {
        const q = new URLSearchParams({
          leaderboard: leaderboardUri,
          timeframe: 'allTime',
          scope: scope === 'social' && viewerDid ? 'social' : 'public',
          limit: String(safeLimit)
        });
        if (viewerDid) q.set('viewer', viewerDid);

        const res = await fetch(`${baseUrl}/xrpc/${NSIDS.LeaderboardGetScores}?${q.toString()}`, {
          signal: AbortSignal.timeout(3500)
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const entry of data.entries || []) {
          const did = entry.player?.did || entry.did;
          if (!did) continue;
          const prev = mergedByDid.get(did);
          if (!prev || entry.score > prev.score) {
            mergedByDid.set(did, {
              did,
              handle: entry.player?.handle || entry.handle || did,
              displayName: entry.player?.displayName || entry.player?.handle || did,
              avatar: entry.player?.avatar || null,
              score: entry.score,
              displayScore:
                entry.displayScore || formatScore(entry.score, FLAPPYSKY_LEADERBOARD.scoreFormat),
              recordedAt: entry.recordedAt,
              recordUri: entry.uri,
              attestationCid: entry.attestationCid || null,
              verified: true
            });
          }
        }
        break;
      } catch {
        // Try next AppView URL or rely on local verified ledger
      }
    }

    const sorted = Array.from(mergedByDid.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(a.recordedAt || '') - Date.parse(b.recordedAt || '');
    });

    const entries = sorted.slice(0, safeLimit).map((item, idx) => ({
      rank: idx + 1,
      ...item,
      isViewer: Boolean(viewerDid && item.did === viewerDid)
    }));

    return {
      leaderboard: {
        uri: leaderboardUri,
        name: FLAPPYSKY_LEADERBOARD.name,
        description: FLAPPYSKY_LEADERBOARD.description,
        timeframe: 'allTime',
        recordPolicy: 'bestOnly'
      },
      scope: scope === 'social' && viewerDid ? 'social' : 'public',
      entries
    };
  }

  function getPublicCatalogPayload() {
    return {
      issuerDid,
      publicDidKey,
      gameUri,
      leaderboardUri,
      appViewUrl: resolvedAppViews[0] || 'https://opengaming.games',
      leaderboard: {
        ...FLAPPYSKY_LEADERBOARD,
        uri: leaderboardUri,
        cid: leaderboardRecordCid
      },
      achievements: achievementEntries.map((e) => ({
        ...e.catalog,
        uri: e.uri,
        cid: e.cid
      }))
    };
  }

  return {
    issuerDid,
    handle,
    publicDidKey,
    signingKey,
    didDocument,
    gameUri,
    leaderboardUri,
    gameLogoBlob,
    blobsByCid,
    repoCollections,
    achievementEntries,
    getPublicCatalogPayload,
    getStoredPlayerSnapshot,
    hydratePlayerFromPds,
    syncPlayerRunAndAchievements,
    getLeaderboardEntries,
    notifyAppViews
  };
}
