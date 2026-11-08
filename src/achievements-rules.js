/**
 * Deterministic Flappysky Achievement & Stat Evaluation Engine
 * Shared across browser gameplay (`src/achievements.js`), server attestation authority
 * (`src/server/opengaming-authority.mjs`), and automated tests (`tests/opengaming.test.mjs`).
 */

import { FLAPPYSKY_ACHIEVEMENTS } from './achievements-catalog.js';

export function createEmptyStats() {
  return {
    gamesPlayed: 0,
    totalLikes: 0,
    bestScore: 0,
    playedDesktop: false,
    playedMobile: false
  };
}

export function normalizeStats(raw = {}) {
  const gamesPlayed = Math.max(0, Math.trunc(Number(raw.gamesPlayed) || 0));
  const totalLikes = Math.max(0, Math.trunc(Number(raw.totalLikes) || 0));
  const bestScore = Math.max(0, Math.trunc(Number(raw.bestScore) || 0));
  return {
    gamesPlayed,
    totalLikes,
    bestScore,
    playedDesktop: Boolean(raw.playedDesktop),
    playedMobile: Boolean(raw.playedMobile)
  };
}

/**
 * Validate a single completed game run payload for plausibility before signing attestations.
 */
export function validateRunPayload(run) {
  if (!run || typeof run !== 'object') {
    return { valid: false, reason: 'Run payload must be an object.' };
  }
  const posts = Number(run.posts);
  const likes = Number(run.likes);
  const score = Number(run.score);

  if (!Number.isInteger(posts) || posts < 0 || posts > 9999) {
    return { valid: false, reason: 'Invalid posts count.' };
  }
  if (!Number.isInteger(likes) || likes < 0 || likes > 9999) {
    return { valid: false, reason: 'Invalid likes count.' };
  }
  if (!Number.isInteger(score) || score !== posts + likes || score < 0 || score > 9999) {
    return { valid: false, reason: 'Score must equal posts + likes and remain within [0, 9999].' };
  }
  // At most 1 Like spawns per post section (+ up to 4 pre-seeded horizon sections)
  if (likes > posts + 5) {
    return { valid: false, reason: 'Implausible likes-to-posts ratio for Flappysky physics.' };
  }

  const cause = run.cause === 'ground' ? 'ground' : 'post';
  const platform = run.platform === 'mobile' ? 'mobile' : 'desktop';

  return {
    valid: true,
    run: {
      posts,
      likes,
      score,
      cause,
      platform
    }
  };
}

/**
 * Merge a completed run (and/or guest cumulative baseline) into player stats and determine:
 * - all achievements now unlocked (both newly unlocked and previously eligible)
 * - updated incremental step progress for multi-step achievements (`play-10/50/100`, `likes-50/100/250`)
 */
export function evaluateFlappyskyAchievements({
  previousStats = createEmptyStats(),
  alreadyUnlockedIds = [],
  run = null,
  liveRun = null
} = {}) {
  const prev = normalizeStats(previousStats);
  const unlockedSet = new Set(alreadyUnlockedIds);

  let nextStats = { ...prev };
  if (run) {
    nextStats = {
      gamesPlayed: prev.gamesPlayed + 1,
      totalLikes: prev.totalLikes + Math.max(0, Math.trunc(run.likes || 0)),
      bestScore: Math.max(prev.bestScore, Math.max(0, Math.trunc(run.score || 0))),
      playedDesktop: prev.playedDesktop || run.platform === 'desktop',
      playedMobile: prev.playedMobile || run.platform === 'mobile'
    };
  }

  const effectiveScore = liveRun
    ? Math.max(nextStats.bestScore, Math.trunc(liveRun.score || 0))
    : run
      ? Math.max(nextStats.bestScore, Math.trunc(run.score || 0))
      : nextStats.bestScore;

  const effectiveTotalLikes = liveRun
    ? nextStats.totalLikes + Math.max(0, Math.trunc(liveRun.likes || 0))
    : nextStats.totalLikes;

  const newlyUnlocked = [];
  const allEligibleIds = new Set(unlockedSet);
  const progressMap = {};

  for (const ach of FLAPPYSKY_ACHIEVEMENTS) {
    let eligible = false;

    switch (ach.id) {
      case 'first-flight':
        eligible = nextStats.gamesPlayed >= 1;
        break;
      case 'play-10':
        eligible = nextStats.gamesPlayed >= 10;
        break;
      case 'play-50':
        eligible = nextStats.gamesPlayed >= 50;
        break;
      case 'play-100':
        eligible = nextStats.gamesPlayed >= 100;
        break;
      case 'score-50':
        eligible = effectiveScore >= 50;
        break;
      case 'score-100':
        eligible = effectiveScore >= 100;
        break;
      case 'score-250':
        eligible = effectiveScore >= 250;
        break;
      case 'likes-50':
        eligible = effectiveTotalLikes >= 50;
        break;
      case 'likes-100':
        eligible = effectiveTotalLikes >= 100;
        break;
      case 'likes-250':
        eligible = effectiveTotalLikes >= 250;
        break;
      case 'play-desktop':
        eligible = nextStats.playedDesktop || (liveRun?.platform === 'desktop');
        break;
      case 'play-mobile':
        eligible = nextStats.playedMobile || (liveRun?.platform === 'mobile');
        break;
      case 'ratioed-by-love':
        eligible = Boolean(run && run.likes > run.posts);
        break;
      case 'touch-grass':
        eligible = Boolean(run && run.cause === 'ground' && run.posts === 0);
        break;
      default:
        break;
    }

    if (ach.stepsNeeded) {
      const rawSteps =
        ach.statKey === 'gamesPlayed'
          ? nextStats.gamesPlayed
          : ach.statKey === 'totalLikes'
            ? effectiveTotalLikes
            : 0;
      progressMap[ach.id] = {
        currentSteps: Math.min(ach.stepsNeeded, Math.max(0, rawSteps)),
        stepsNeeded: ach.stepsNeeded
      };
    }

    if (eligible) {
      allEligibleIds.add(ach.id);
      if (!unlockedSet.has(ach.id)) {
        newlyUnlocked.push(ach);
      }
    }
  }

  return {
    stats: nextStats,
    newlyUnlocked,
    allUnlockedIds: Array.from(allEligibleIds),
    progressMap
  };
}
