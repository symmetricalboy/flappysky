/**
 * Flappysky Client-Side Open Gaming Controller
 * Coordinates local Guest progress, live mid-flight milestone unlocks, ATProto OAuth / App Password
 * authentication, signed PDS record syncing, and All-Time Best Score leaderboard queries.
 */

import { FLAPPYSKY_ACHIEVEMENTS, FLAPPYSKY_LEADERBOARD } from './achievements-catalog.js';
import {
  createEmptyStats,
  evaluateFlappyskyAchievements,
  normalizeStats
} from './achievements-rules.js';

const STORAGE_KEY = 'flappysky_opengaming_state_v1';
const LEGACY_BEST_KEY = 'flappysky_best_score';

function loadLocalState() {
  let legacyBest = 0;
  try {
    legacyBest = Math.max(0, Number.parseInt(localStorage.getItem(LEGACY_BEST_KEY) || '0', 10) || 0);
  } catch {
    legacyBest = 0;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const stats = createEmptyStats();
      stats.bestScore = legacyBest;
      return {
        stats,
        unlocks: {},
        progress: {}
      };
    }
    const parsed = JSON.parse(raw);
    const stats = normalizeStats(parsed.stats);
    stats.bestScore = Math.max(stats.bestScore, legacyBest);
    return {
      stats,
      unlocks: parsed.unlocks && typeof parsed.unlocks === 'object' ? parsed.unlocks : {},
      progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {}
    };
  } catch {
    const stats = createEmptyStats();
    stats.bestScore = legacyBest;
    return {
      stats,
      unlocks: {},
      progress: {}
    };
  }
}

export class OpenGamingClient {
  constructor({ onStateUpdate, onAchievementUnlocked, onSyncStatus } = {}) {
    this.onStateUpdate = onStateUpdate;
    this.onAchievementUnlocked = onAchievementUnlocked;
    this.onSyncStatus = onSyncStatus;

    const saved = loadLocalState();
    this.stats = saved.stats;
    this.unlocks = saved.unlocks;
    this.progress = saved.progress;

    this.authenticated = false;
    this.user = null;
    this.catalog = {
      appViewUrl: 'https://opengaming.games',
      leaderboard: FLAPPYSKY_LEADERBOARD,
      achievements: FLAPPYSKY_ACHIEVEMENTS
    };
    this.syncing = false;
    this.lastRunUnlockedIds = [];
  }

  persistLocal() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          stats: this.stats,
          unlocks: this.unlocks,
          progress: this.progress
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  emitUpdate() {
    if (this.onStateUpdate) {
      this.onStateUpdate(this.getSummary());
    }
  }

  getSummary() {
    const total = FLAPPYSKY_ACHIEVEMENTS.length;
    const unlockedCount = FLAPPYSKY_ACHIEVEMENTS.filter((a) => Boolean(this.unlocks[a.id])).length;
    const completionPercent = total > 0 ? Math.floor((unlockedCount * 100) / total) : 0;

    const items = FLAPPYSKY_ACHIEVEMENTS.map((ach) => {
      const unlockInfo = this.unlocks[ach.id] || null;
      const progInfo = this.progress[ach.id] || (ach.stepsNeeded
        ? {
            currentSteps: Math.min(
              ach.stepsNeeded,
              ach.statKey === 'gamesPlayed'
                ? this.stats.gamesPlayed
                : ach.statKey === 'totalLikes'
                  ? this.stats.totalLikes
                  : 0
            ),
            stepsNeeded: ach.stepsNeeded
          }
        : null);

      return {
        ...ach,
        unlocked: Boolean(unlockInfo),
        unlockedAt: unlockInfo?.unlockedAt || null,
        recordUri: unlockInfo?.recordUri || null,
        attestationCid: unlockInfo?.attestationCid || null,
        verifiedOnPds: Boolean(unlockInfo?.recordUri),
        progress: progInfo
      };
    });

    return {
      authenticated: this.authenticated,
      user: this.user,
      syncing: this.syncing,
      stats: { ...this.stats },
      unlockedCount,
      totalAchievements: total,
      completionPercent,
      completed: unlockedCount === total,
      appViewUrl: this.catalog.appViewUrl || 'https://opengaming.games',
      issuerDid: this.catalog.issuerDid || null,
      items
    };
  }

  buildGuestBaseline() {
    return {
      ...this.stats,
      unlockedIds: Object.keys(this.unlocks)
    };
  }

  mergeServerPlayerSnapshot(player) {
    if (!player) return;
    if (player.stats) {
      this.stats = {
        gamesPlayed: Math.max(this.stats.gamesPlayed, player.stats.gamesPlayed || 0),
        totalLikes: Math.max(this.stats.totalLikes, player.stats.totalLikes || 0),
        bestScore: Math.max(this.stats.bestScore, player.stats.bestScore || 0),
        playedDesktop: Boolean(this.stats.playedDesktop || player.stats.playedDesktop),
        playedMobile: Boolean(this.stats.playedMobile || player.stats.playedMobile)
      };
    }

    if (player.bestScoreEntry?.score > this.stats.bestScore) {
      this.stats.bestScore = player.bestScoreEntry.score;
    }

    if (player.unlocks) {
      for (const [achId, data] of Object.entries(player.unlocks)) {
        const existing = this.unlocks[achId];
        this.unlocks[achId] = {
          unlockedAt: data.unlockedAt || existing?.unlockedAt || new Date().toISOString(),
          recordUri: data.recordUri || existing?.recordUri || null,
          attestationCid: data.attestationCid || existing?.attestationCid || null
        };
      }
    }

    if (player.progress) {
      for (const [achId, data] of Object.entries(player.progress)) {
        const prev = this.progress[achId]?.currentSteps || 0;
        if ((data.currentSteps || 0) >= prev) {
          this.progress[achId] = {
            currentSteps: data.currentSteps,
            stepsNeeded: data.stepsNeeded,
            recordUri: data.recordUri || null
          };
        }
      }
    }

    this.persistLocal();
    this.emitUpdate();
  }

  async init() {
    try {
      const res = await fetch('/api/opengaming/status', { credentials: 'same-origin' });
      if (!res.ok) {
        this.emitUpdate();
        return this.getSummary();
      }
      const data = await res.json();
      if (data.catalog) {
        this.catalog = data.catalog;
      }
      this.authenticated = Boolean(data.authenticated);
      this.user = data.user || null;
      if (data.player) {
        this.mergeServerPlayerSnapshot(data.player);
      }

      // If signed in and local guest stats have unsynced achievements or best score, sync automatically!
      if (this.authenticated) {
        const hasUnsyncedLocal =
          Object.values(this.unlocks).some((u) => !u.recordUri) ||
          (this.stats.bestScore > 0 && (!data.player?.bestScoreEntry || this.stats.bestScore > data.player.bestScoreEntry.score));
        if (hasUnsyncedLocal) {
          await this.syncToPds({ run: null });
        }
      }
    } catch {
      // Offline / static fallback works seamlessly with local state
    }

    this.emitUpdate();
    return this.getSummary();
  }

  /**
   * Check live mid-flight score and cumulative like milestones without mutating `gamesPlayed` yet.
   */
  checkLiveFlightMilestones({ score, likesRun }) {
    const nowIso = new Date().toISOString();
    const res = evaluateFlappyskyAchievements({
      previousStats: this.stats,
      alreadyUnlockedIds: Object.keys(this.unlocks),
      liveRun: { score, likes: likesRun }
    });

    if (res.newlyUnlocked.length > 0) {
      for (const ach of res.newlyUnlocked) {
        this.unlocks[ach.id] = {
          unlockedAt: nowIso,
          recordUri: null,
          attestationCid: null
        };
        if (!this.lastRunUnlockedIds.includes(ach.id)) {
          this.lastRunUnlockedIds.push(ach.id);
        }
        if (this.onAchievementUnlocked) {
          this.onAchievementUnlocked(ach);
        }
      }
      this.persistLocal();
      this.emitUpdate();
    }
  }

  resetRunTracking() {
    this.lastRunUnlockedIds = [];
  }

  /**
   * Finalize a completed flight, unlock any earned achievements, update step progress,
   * and sync signed ATProto records to the player's PDS if authenticated.
   */
  async recordCompletedRun({ score, posts, likes, cause, platform }) {
    const nowIso = new Date().toISOString();
    const run = {
      score: Math.max(0, Math.trunc(score || 0)),
      posts: Math.max(0, Math.trunc(posts || 0)),
      likes: Math.max(0, Math.trunc(likes || 0)),
      cause: cause === 'ground' ? 'ground' : 'post',
      platform: platform === 'mobile' ? 'mobile' : 'desktop'
    };

    const evaluation = evaluateFlappyskyAchievements({
      previousStats: this.stats,
      alreadyUnlockedIds: Object.keys(this.unlocks),
      run
    });

    this.stats = evaluation.stats;
    for (const [achId, prog] of Object.entries(evaluation.progressMap)) {
      this.progress[achId] = {
        ...this.progress[achId],
        currentSteps: prog.currentSteps,
        stepsNeeded: prog.stepsNeeded
      };
    }

    for (const ach of evaluation.newlyUnlocked) {
      this.unlocks[ach.id] = {
        unlockedAt: nowIso,
        recordUri: null,
        attestationCid: null
      };
      if (!this.lastRunUnlockedIds.includes(ach.id)) {
        this.lastRunUnlockedIds.push(ach.id);
      }
      if (this.onAchievementUnlocked) {
        this.onAchievementUnlocked(ach);
      }
    }

    this.persistLocal();
    this.emitUpdate();

    const runUnlocks = FLAPPYSKY_ACHIEVEMENTS.filter((a) =>
      this.lastRunUnlockedIds.includes(a.id)
    );

    if (this.authenticated) {
      this.syncToPds({ run }).catch(() => {});
    }

    return {
      runUnlocks,
      summary: this.getSummary()
    };
  }

  async syncToPds({ run = null } = {}) {
    if (!this.authenticated) return null;
    this.syncing = true;
    this.emitUpdate();
    if (this.onSyncStatus) this.onSyncStatus({ state: 'syncing' });

    try {
      const res = await fetch('/api/opengaming/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run,
          guestBaseline: this.buildGuestBaseline()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync records to PDS.');
      }
      if (data.player) {
        this.mergeServerPlayerSnapshot(data.player);
      }
      if (this.onSyncStatus) {
        this.onSyncStatus({
          state: 'synced',
          writes: data.pdsWrites?.length || 0
        });
      }
      return data;
    } catch (err) {
      if (this.onSyncStatus) {
        this.onSyncStatus({
          state: 'error',
          message: err?.message || 'PDS sync failed.'
        });
      }
      return null;
    } finally {
      this.syncing = false;
      this.emitUpdate();
    }
  }

  async startOAuthLogin(handle) {
    const res = await fetch('/api/auth/oauth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle })
    });
    const data = await res.json();
    if (!res.ok || !data.redirectUrl) {
      throw new Error(data.error || 'Unable to start ATProto OAuth login.');
    }
    window.location.assign(data.redirectUrl);
  }

  async loginWithAppPassword(identifier, password) {
    const res = await fetch('/api/auth/app-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier,
        password,
        guestBaseline: this.buildGuestBaseline()
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'App Password sign-in failed.');
    }
    this.authenticated = true;
    this.user = data.user;
    if (data.player) {
      this.mergeServerPlayerSnapshot(data.player);
    }
    this.emitUpdate();
    return data;
  }

  async logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    }).catch(() => {});
    this.authenticated = false;
    this.user = null;
    this.emitUpdate();
  }

  async fetchLeaderboard(scope = 'public') {
    const q = new URLSearchParams({ scope, limit: '50' });
    const res = await fetch(`/api/opengaming/leaderboard?${q.toString()}`, {
      credentials: 'same-origin'
    });
    if (!res.ok) {
      throw new Error('Unable to load leaderboard.');
    }
    return res.json();
  }
}
