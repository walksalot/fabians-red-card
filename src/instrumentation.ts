/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * Starts the in-process schedulers so a plain `npm start` on any always-on host
 * needs NO external cron service:
 *   - auto-results poll: every 60s (the planner itself is cheap and idempotent;
 *     it only fetches dates that have unfinished matches in the next ~2 days, so
 *     outside match windows it makes zero network calls)
 *   - nightly backup: hourly check, backs up at most once per calendar day
 *
 * Guard rails: only in the Node.js runtime, never during build, and disabled
 * when SCHEDULER_DISABLED is set (the e2e runs pin the clock and don't want a
 * live feed poking the database).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SCHEDULER_DISABLED === '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { getDb } = await import('@/db');
  const { runSync } = await import('@/lib/sync/espn-sync');
  const { runBackupIfDue } = await import('@/lib/backup');

  const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 60_000);

  const tick = async () => {
    try {
      const summary = await runSync(getDb());
      if (summary.results || summary.teamFills) {
        console.log(
          `[auto-sync] ${summary.results} result(s), ${summary.teamFills} team fill(s), ${summary.liveUpdates} live update(s)`,
        );
      }
    } catch (err) {
      console.error('[auto-sync] pass failed:', err);
    }
  };

  const backupTick = async () => {
    try {
      const path = runBackupIfDue(getDb());
      if (path) console.log(`[backup] wrote ${path}`);
    } catch (err) {
      console.error('[backup] failed:', err);
    }
  };

  // a small delay so boot isn't blocked by a network call
  setTimeout(() => {
    void tick();
    void backupTick();
  }, 5_000);
  setInterval(() => void tick(), SYNC_INTERVAL_MS);
  setInterval(() => void backupTick(), 3_600_000);
  console.log(`[scheduler] started (sync every ${SYNC_INTERVAL_MS}ms, nightly backups on)`);
}
