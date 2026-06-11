import { createTestDb, type Db } from '@/db';

/** Fresh in-memory database with migrations applied. One per test for isolation. */
export function freshDb(): Db {
  return createTestDb();
}

/** Pin the logic clock (src/lib/clock) to a fixed instant for the duration of fn. */
export async function withFakeNow<T>(iso: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env.FAKE_NOW;
  process.env.FAKE_NOW = iso;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.FAKE_NOW;
    else process.env.FAKE_NOW = prev;
  }
}
