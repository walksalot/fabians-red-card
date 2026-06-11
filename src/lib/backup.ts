/**
 * Automatic database backups — zero admin effort. Uses SQLite's online backup
 * (safe while the app is running) to copy the live DB into .data/backups, keeps
 * the most recent N, and only runs once per calendar day (tracked in app_state).
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { now } from '@/lib/clock';
import { getAppState, setAppState } from '@/lib/sync/espn-sync';
import type { Db } from '@/db';

const KEEP = 14; // two weeks of daily backups

function dbFilePath(): string | null {
  const p = process.env.DB_PATH ?? '.data/app.db';
  return p === ':memory:' ? null : path.resolve(p);
}

/** Force a backup now. Returns the written path, or null if the DB is in-memory. */
export function runBackup(): string | null {
  const src = dbFilePath();
  if (!src || !fs.existsSync(src)) return null;
  const dir = path.join(path.dirname(src), 'backups');
  fs.mkdirSync(dir, { recursive: true });

  const stamp = now().toISOString().replace(/[:.]/g, '-');
  // Named after the source file (league-2026-…), so backups of different
  // database files are never mistaken for one another.
  const base = path.basename(src, '.db');
  const dest = path.join(dir, `${base}-${stamp}.db`);

  // online backup: consistent snapshot without locking out the running app
  const handle = new Database(src, { readonly: true });
  try {
    handle.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    handle.close();
  }

  // prune oldest beyond KEEP
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  return dest;
}

/** Run a backup only if none has been taken today (America/New_York calendar day). */
export function runBackupIfDue(db: Db): string | null {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now());
  if (getAppState(db, 'lastBackupDay') === today) return null;
  const result = runBackup();
  if (result) setAppState(db, 'lastBackupDay', today);
  return result;
}
