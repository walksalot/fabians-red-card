// Container entrypoint for hosted deploys (Railway / Fly / any Docker host).
// Makes first-run completely hands-off for a non-technical owner:
//   1. Ensure a SESSION_SECRET that SURVIVES restarts — from the env var if the
//      host provides one, otherwise generated once and persisted on the data
//      volume (so logins don't break on every redeploy).
//   2. Create + migrate + seed the database on the persistent volume (seed is
//      idempotent — it never overwrites results or users on later boots).
//   3. Start the Next.js server.
//
// Configure on the host: a persistent volume mounted at /data, and the env var
// DB_PATH=/data/app.db. Everything else is automatic.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

const dbPath = process.env.DB_PATH ?? '/data/app.db';
const dataDir = path.dirname(path.resolve(dbPath));
fs.mkdirSync(dataDir, { recursive: true });

// 1. durable session secret
if (!process.env.SESSION_SECRET) {
  const secretFile = path.join(dataDir, '.session-secret');
  if (fs.existsSync(secretFile)) {
    process.env.SESSION_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    process.env.SESSION_SECRET = secret;
    console.log('[start] generated and persisted a new SESSION_SECRET on the data volume');
  }
}

// 2. migrate + seed (idempotent)
const seed = spawnSync('node', ['scripts/seed.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, DB_PATH: dbPath },
});
if (seed.status !== 0) {
  console.error('[start] seeding failed — aborting');
  process.exit(seed.status ?? 1);
}

// 3. start Next.js (honours PORT, set by the host)
const child = spawn('node', ['node_modules/next/dist/bin/next', 'start'], {
  stdio: 'inherit',
  env: { ...process.env, DB_PATH: dbPath },
});
child.on('exit', (code) => process.exit(code ?? 0));
