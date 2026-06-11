// Standalone database backup — `npm run backup`. Writes a timestamped copy of
// the live database into .data/backups using SQLite's online VACUUM INTO (safe
// while the app is running) and keeps the most recent 14. The running server
// also does this automatically once a day; this is for on-demand / external cron.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const KEEP = 14;
const src = path.resolve(process.env.DB_PATH ?? '.data/app.db');
if (!fs.existsSync(src)) {
  console.error(`backup: database not found at ${src}. Run \`npm run setup\` first.`);
  process.exit(1);
}

const dir = path.join(path.dirname(src), 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(dir, `app-${stamp}.db`);

const handle = new Database(src, { readonly: true });
try {
  handle.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
} finally {
  handle.close();
}

const backups = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith('app-') && f.endsWith('.db'))
  .sort();
for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) {
  fs.rmSync(path.join(dir, old), { force: true });
}

console.log(`backup: wrote ${dest} (${backups.length} kept, max ${KEEP}).`);
