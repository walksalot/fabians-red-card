import { getDb } from '@/db';
import { runSync } from '@/lib/sync/espn-sync';
import { jsonErr, jsonOk } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

/**
 * Manual / platform-cron trigger for one auto-results pass. The in-process
 * scheduler (instrumentation.ts) already runs this every minute on an always-on
 * host; this endpoint exists for platforms that prefer an external cron, or to
 * force a refresh. Protected by CRON_SECRET so it can't be hammered publicly —
 * when CRON_SECRET is unset the endpoint is disabled (returns 404-equivalent).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonErr('Not enabled', 404);
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    new URL(req.url).searchParams.get('key');
  if (provided !== secret) return jsonErr('Unauthorized', 401);

  const summary = await runSync(getDb());
  return jsonOk(summary);
}
