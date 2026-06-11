// One-time local setup: generates .env.local with a random session secret
// (if missing) and creates + seeds the database. Safe to re-run.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const envPath = path.join(root, '.env.local');

if (!fs.existsSync(envPath) || !fs.readFileSync(envPath, 'utf8').includes('SESSION_SECRET=')) {
  const secret = crypto.randomBytes(32).toString('hex');
  fs.appendFileSync(envPath, `SESSION_SECRET=${secret}\n`);
  console.log('Generated SESSION_SECRET in .env.local');
} else {
  console.log('.env.local already has SESSION_SECRET — keeping it');
}

const seed = spawnSync('node', ['scripts/seed.mjs'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
console.log('Setup complete. Start the app with: npm run build && npm start');
