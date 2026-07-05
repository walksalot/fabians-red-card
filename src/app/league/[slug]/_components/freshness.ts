/**
 * Shared live-feed staleness threshold. A live card/node whose last feed
 * update is older than this keeps its score but drops the pulsing red lockup
 * for a calm "awaiting result" — no pulsing dot on a heartbeat nobody can
 * vouch for. One constant so Today and the bracket never contradict each
 * other. Display-only.
 */
export const STALE_FEED_MS = 12 * 60 * 1000;
