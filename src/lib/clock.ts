/**
 * Single source of time for ALL game logic (pick locking, booster windows, "today" board).
 * FAKE_NOW lets tests and e2e runs pin the clock to a deterministic instant.
 */
export function now(): Date {
  const fake = process.env.FAKE_NOW;
  return fake ? new Date(fake) : new Date();
}

export function nowMs(): number {
  return now().getTime();
}
