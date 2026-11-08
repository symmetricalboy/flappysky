#!/usr/bin/env node
/**
 * Optional CLI utility to publish Flappysky's `games.atmosphere.define`, 14 `games.opengaming.achievement.definition`s,
 * and `games.opengaming.leaderboard.definition` (`high-score`) directly to a `did:plc` ATProto PDS account.
 *
 * Note: By default, Flappysky serves its canonical definitions directly via `did:web:flappysky.symmetricalboy.com`
 * from `server.mjs`, requiring zero manual publishing steps!
 *
 * Usage:
 *   ATPROTO_IDENTIFIER=flappysky.symmetricalboy.com ATPROTO_PASSWORD=xxxx-xxxx-xxxx-xxxx npm run publish-defs
 */

import { AtpAgent } from '@atproto/api';
import { NSIDS, createOpenGamingLexicons } from '@opengaming/sdk';
import {
  FLAPPYSKY_ACHIEVEMENTS,
  FLAPPYSKY_GAME_RKEY,
  FLAPPYSKY_LEADERBOARD,
  FLAPPYSKY_LEADERBOARD_RKEY
} from '../src/achievements-catalog.js';
import { generatePngIconBlob } from '../src/server/png-icons.mjs';

const service = process.env.ATPROTO_SERVICE || 'https://bsky.social';
const identifier = process.env.ATPROTO_IDENTIFIER;
const password = process.env.ATPROTO_PASSWORD;
const publicUrl = process.env.PUBLIC_URL || 'https://flappysky.symmetricalboy.com';

if (!identifier || !password) {
  console.error('Set ATPROTO_IDENTIFIER and ATPROTO_PASSWORD to publish definitions to a PDS.');
  process.exit(1);
}

const lexicons = createOpenGamingLexicons();
const agent = new AtpAgent({ service });
const login = await agent.login({ identifier, password });
const repoDid = login.data.did;
const nowIso = new Date().toISOString();

console.log(`Authenticated as ${login.data.handle} (${repoDid})`);

const gameLogo = await generatePngIconBlob({
  bg1: [2, 132, 199],
  bg2: [29, 78, 216],
  accent: [255, 255, 255],
  motif: 'butterfly'
});
const gameUpload = await agent.uploadBlob(gameLogo.bytes, { encoding: 'image/png' });

const gameUri = `at://${repoDid}/games.atmosphere.define/${FLAPPYSKY_GAME_RKEY}`;
await agent.com.atproto.repo.putRecord({
  repo: repoDid,
  collection: 'games.atmosphere.define',
  rkey: FLAPPYSKY_GAME_RKEY,
  validate: false,
  record: {
    $type: 'games.atmosphere.define',
    name: 'Flappysky',
    tagline: 'Flutter between blue posts (+1) and collect floating heart Likes (+1) across the Atmosphere.',
    url: publicUrl,
    icon: gameUpload.data.blob,
    category: 'browser',
    status: 'live',
    createdAt: nowIso
  }
});
console.log(`Published game: ${gameUri}`);

for (const ach of FLAPPYSKY_ACHIEVEMENTS) {
  const iconPng = await generatePngIconBlob(ach.palette);
  const uploaded = await agent.uploadBlob(iconPng.bytes, { encoding: 'image/png' });
  const record = {
    $type: NSIDS.AchievementDefinition,
    game: gameUri,
    title: ach.title,
    description: ach.description,
    requirement: ach.requirement,
    icon: uploaded.data.blob,
    iconAlt: ach.iconAlt,
    tier: ach.tier,
    hidden: Boolean(ach.hidden),
    ...(ach.stepsNeeded ? { stepsNeeded: ach.stepsNeeded } : {}),
    listOrder: ach.listOrder,
    createdAt: nowIso
  };
  lexicons.assertValidRecord(NSIDS.AchievementDefinition, record);

  await agent.com.atproto.repo.putRecord({
    repo: repoDid,
    collection: NSIDS.AchievementDefinition,
    rkey: ach.id,
    validate: false,
    record
  });
  console.log(`Published achievement [${ach.tier}]: ${ach.title} (${ach.id})`);
}

const lbPng = await generatePngIconBlob(FLAPPYSKY_LEADERBOARD.palette);
const lbUpload = await agent.uploadBlob(lbPng.bytes, { encoding: 'image/png' });
const lbRecord = {
  $type: NSIDS.LeaderboardDefinition,
  game: gameUri,
  name: FLAPPYSKY_LEADERBOARD.name,
  description: FLAPPYSKY_LEADERBOARD.description,
  icon: lbUpload.data.blob,
  iconAlt: FLAPPYSKY_LEADERBOARD.iconAlt,
  sortOrder: FLAPPYSKY_LEADERBOARD.sortOrder,
  scoreFormat: FLAPPYSKY_LEADERBOARD.scoreFormat,
  timeframes: FLAPPYSKY_LEADERBOARD.timeframes,
  recordPolicy: FLAPPYSKY_LEADERBOARD.recordPolicy,
  scoreMin: FLAPPYSKY_LEADERBOARD.scoreMin,
  scoreMax: FLAPPYSKY_LEADERBOARD.scoreMax,
  listOrder: FLAPPYSKY_LEADERBOARD.listOrder,
  createdAt: nowIso
};
lexicons.assertValidRecord(NSIDS.LeaderboardDefinition, lbRecord);

await agent.com.atproto.repo.putRecord({
  repo: repoDid,
  collection: NSIDS.LeaderboardDefinition,
  rkey: FLAPPYSKY_LEADERBOARD_RKEY,
  validate: false,
  record: lbRecord
});
console.log(`Published leaderboard: ${FLAPPYSKY_LEADERBOARD.name}`);
