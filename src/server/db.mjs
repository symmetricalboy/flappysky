/**
 * Flappysky Open Gaming SQLite Store (Node 24 built-in `node:sqlite`)
 * Persists attestation/OAuth keys, OAuth state/sessions, web sessions, and verified player records.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createFlappyskyDb(
  dbPath = process.env.DATABASE_PATH || resolve(import.meta.dirname, '..', '..', 'data', 'flappysky.sqlite')
) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_sessions (
      sub TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_sessions (
      token TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      handle TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      auth_mode TEXT NOT NULL,
      pds_url TEXT,
      access_jwt TEXT,
      refresh_jwt TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      did TEXT PRIMARY KEY,
      handle TEXT,
      display_name TEXT,
      avatar TEXT,
      games_played INTEGER NOT NULL DEFAULT 0,
      total_likes INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      played_desktop INTEGER NOT NULL DEFAULT 0,
      played_mobile INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verified_unlocks (
      did TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      achievement_uri TEXT NOT NULL,
      record_uri TEXT NOT NULL,
      attestation_cid TEXT NOT NULL,
      record_json TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (did, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS verified_progress (
      did TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      achievement_uri TEXT NOT NULL,
      current_steps INTEGER NOT NULL,
      steps_needed INTEGER NOT NULL,
      record_uri TEXT NOT NULL,
      record_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (did, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS verified_scores (
      did TEXT PRIMARY KEY,
      handle TEXT,
      display_name TEXT,
      avatar TEXT,
      score INTEGER NOT NULL,
      display_score TEXT NOT NULL,
      posts INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      record_uri TEXT NOT NULL,
      attestation_cid TEXT NOT NULL,
      record_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_verified_scores_rank
      ON verified_scores (score DESC, recorded_at ASC);
  `);

  return db;
}
