// One-time local setup: generates .env.local with a random session secret
// (if missing) and creates + seeds the database. Safe to re-run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const envPath = path.join(root, '.env.local');

// Line-anchored check: a glued "FOO=barSESSION_SECRET=..." (hand-edited file
// without a trailing newline) must NOT count as configured.
const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
if (!/^SESSION_SECRET=.+$/m.test(existingEnv)) {
  const secret = crypto.randomBytes(32).toString('hex');
  // Never glue onto a previous line that lacks a trailing newline.
  const prefix = existingEnv.length > 0 && !existingEnv.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(envPath, `${prefix}SESSION_SECRET=${secret}\n`);
  console.log('Generated SESSION_SECRET in .env.local');
} else {
  console.log('.env.local already has SESSION_SECRET — keeping it');
}

// Verify the file actually carries a SESSION_SECRET line before claiming success.
if (!/^SESSION_SECRET=.+$/m.test(fs.readFileSync(envPath, 'utf8'))) {
  console.error('setup: .env.local still has no usable SESSION_SECRET line — aborting.');
  process.exit(1);
}

const seed = spawnSync('node', ['scripts/seed.mjs'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
console.log('Setup complete. Start the app with: npm run build && npm start');
