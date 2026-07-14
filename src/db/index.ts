import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
export { schema };

let cached: { dbPath: string; db: Db } | null = null;

/** App database singleton. Path from DB_PATH (default .data/app.db); migrations auto-applied. */
export function getDb(): Db {
  const dbPath = process.env.DB_PATH ?? '.data/app.db';
  if (cached && cached.dbPath === dbPath) return cached.db;
  if (dbPath !== ':memory:') {
    // DB_PATH may intentionally point outside the app in production. It is a
    // runtime data location, not a build input for Turbopack to trace.
    fs.mkdirSync(
      path.dirname(path.resolve(/* turbopackIgnore: true */ dbPath)),
      { recursive: true },
    );
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  cached = { dbPath, db };
  return db;
}

/** Fresh in-memory database with migrations applied — one per call, for tests. */
export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return db;
}
