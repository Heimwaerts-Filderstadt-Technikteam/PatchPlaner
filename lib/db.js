// SQLite-Datenbank (node:sqlite, ab Node 22.13 ohne Flag)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  // Alte Datenbank aus der Zeit als „PatchPlan“ übernehmen
  const file = path.join(dataDir, 'patchplaner.db'), old = path.join(dataDir, 'patchplan.db');
  if (!fs.existsSync(file) && fs.existsSync(old)) for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(old + ext)) fs.renameSync(old + ext, file + ext);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
     pass_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, settings TEXT NOT NULL DEFAULT '{}',
     created INTEGER NOT NULL, last_login INTEGER);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created INTEGER NOT NULL, expires INTEGER NOT NULL, ua TEXT);
   CREATE TABLE password_resets (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
   CREATE TABLE teams (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
   CREATE TABLE team_members (
     team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL DEFAULT 'member', created INTEGER NOT NULL, PRIMARY KEY (team_id, user_id));
   CREATE TABLE team_invites (
     token TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, email TEXT,
     invited_by TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL);
   CREATE TABLE projects (
     id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
     name TEXT NOT NULL, color TEXT, notes TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL);
   CREATE TABLE plans (
     id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
     project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, name TEXT NOT NULL, job_id TEXT, venue TEXT,
     rig_date TEXT, event_date TEXT, archived INTEGER NOT NULL DEFAULT 0, is_template INTEGER NOT NULL DEFAULT 0,
     data TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, share_token TEXT UNIQUE, share_enabled INTEGER NOT NULL DEFAULT 0,
     thumb TEXT, stats TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, updated_by TEXT);
   CREATE INDEX plans_owner ON plans(owner_id); CREATE INDEX plans_team ON plans(team_id);
   CREATE TABLE plan_assets (
     id TEXT PRIMARY KEY, plan_id TEXT REFERENCES plans(id) ON DELETE CASCADE, kind TEXT NOT NULL, mime TEXT NOT NULL,
     filename TEXT, file TEXT NOT NULL, w INTEGER, h INTEGER, meta TEXT, created INTEGER NOT NULL);
   CREATE TABLE pack_checks (
     plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, key TEXT NOT NULL, user_id TEXT, at INTEGER NOT NULL,
     PRIMARY KEY (plan_id, key));
   CREATE TABLE gear (
     id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE, team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
     name TEXT NOT NULL, manufacturer TEXT, model TEXT, category TEXT NOT NULL DEFAULT 'Eigene', color TEXT,
     ports TEXT NOT NULL DEFAULT '[]', elements TEXT NOT NULL DEFAULT '[]', image TEXT, gear_id TEXT, notes TEXT,
     is_public INTEGER NOT NULL DEFAULT 0, is_builtin INTEGER NOT NULL DEFAULT 0, source_id TEXT, uses INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL, updated INTEGER NOT NULL);
   CREATE INDEX gear_owner ON gear(owner_id); CREATE INDEX gear_public ON gear(is_public);
   CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);`,
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  let row = db.prepare('SELECT v FROM schema_version').get();
  if (!row) { db.prepare('INSERT INTO schema_version (v) VALUES (0)').run(); row = { v: 0 }; }
  for (let i = row.v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.prepare('UPDATE schema_version SET v = ?').run(i + 1); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
