/** Display formatting helpers shared by league pages and their client components. */

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * matchday is a precomputed YYYY-MM-DD (America/New_York calendar date).
 * No year: the whole tournament is one summer, and the year was what pushed
 * the Today headline past 390px ("Thursday, June 11, 20…").
 */
export function formatMatchday(matchday: string): string {
  return new Date(`${matchday}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Wall-clock time in tournament-local (Eastern) time, labelled "ET".
 * Fixed locale + zone: SSR-safe, and every timestamp on a card reads in the
 * same timezone as its kickoff label.
 */
export function formatTimeEt(at: string | number | Date): string {
  const t = new Date(at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  return `${t} ET`;
}

/** Kickoff wall-clock time in tournament-local (Eastern) time. */
export function formatKickoffEt(kickoffUtc: string): string {
  return formatTimeEt(kickoffUtc);
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Gold / silver / bronze chip tones for podium places — one palette shared by
 * the leaderboard rank badges, payout chips, profile rank chip and header chip.
 */
export const MEDAL_TONES: Record<number, string> = {
  1: 'bg-amber-300/15 text-amber-300 ring-amber-300/40',
  // Silver gets a cool slate cast + brighter fill — plain zinc-300 was
  // indistinguishable from the default zinc-200 body text beside it.
  2: 'bg-slate-300/15 text-slate-200 ring-slate-300/40',
  3: 'bg-orange-400/10 text-orange-400 ring-orange-400/35',
};

/**
 * Text-only medal tints for rank ORDINALS (e.g. the header rank chip) — never
 * for metrics: the leaderboard PTS column stays neutral so one number column
 * reads in one color.
 */
export const MEDAL_TEXT_TONES: Record<number, string> = {
  1: 'text-amber-300',
  // Brighter + cooler than the zinc-200 default so 2nd reads as a metal.
  2: 'text-slate-100',
  3: 'text-orange-400',
};

export const STAGE_LABELS: Record<string, string> = {
  group: 'Group stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  third: 'Third-place play-off',
  final: 'Final',
};
