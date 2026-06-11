/**
 * Betting-odds cheat sheet — pure parsing & math. No I/O.
 *
 * Source shape: ESPN scoreboard `competitions[0].odds[0]` (DraftKings), with
 * american-format prices as signed strings under {moneyline.{home,draw,away}
 * .{open,close}.odds}, totals under {total.{over,under}.{open,close}} and the
 * line in `overUnder`. Knockout matches with TBD teams ship `odds: [null]`.
 *
 * Display philosophy (per design research): lead with de-vigged implied
 * probabilities (the language casuals actually read), keep american odds as
 * secondary context. De-vig = each leg's raw implied probability divided by
 * the sum of all three (multiplicative normalization).
 */

export interface MatchOdds {
  provider: string;
  /** American odds, current line (falls back to opening line per leg). */
  homeML: string;
  drawML: string;
  awayML: string;
  /** De-vigged win probabilities; sum to ~1. */
  homeProb: number;
  drawProb: number;
  awayProb: number;
  /** Goals total market (null when absent). */
  overUnder: number | null;
  overOdds: string | null;
  underOdds: string | null;
  /** Opening moneylines for movement display (null when absent). */
  openHomeML: string | null;
  openDrawML: string | null;
  openAwayML: string | null;
  updatedAtMs: number;
}

/** "+255" → 0.2817…, "-110" → 0.5238…; null for unparseable input. */
export function americanToProb(american: string | number | null | undefined): number | null {
  if (american === null || american === undefined) return null;
  const n =
    typeof american === 'number'
      ? american
      : Number.parseInt(String(american).replace('+', '').trim(), 10);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
}

/** Normalize raw implied probabilities so they sum to 1 (removes the vig). */
export function devig(raw: number[]): number[] {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return raw.map(() => 0);
  return raw.map((p) => p / sum);
}

export function formatPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untrusted external JSON */
function leg(obj: any, side: string): string | null {
  const close = obj?.moneyline?.[side]?.close?.odds;
  const open = obj?.moneyline?.[side]?.open?.odds;
  const v = close ?? open ?? null;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function openLeg(obj: any, side: string): string | null {
  const v = obj?.moneyline?.[side]?.open?.odds;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Parse one ESPN competition's odds array into a MatchOdds snapshot.
 * Returns null whenever the market is absent or incomplete (TBD knockout
 * slots, schema drift) — graceful absence is the contract.
 */
export function parseScoreboardOdds(
  oddsArray: unknown,
  updatedAtMs: number,
): MatchOdds | null {
  if (!Array.isArray(oddsArray)) return null;
  const o: any = oddsArray.find((x) => x && typeof x === 'object');
  if (!o) return null;

  const homeML = leg(o, 'home');
  const drawML = leg(o, 'draw');
  const awayML = leg(o, 'away');
  if (!homeML || !drawML || !awayML) return null;

  const rawProbs = [americanToProb(homeML), americanToProb(drawML), americanToProb(awayML)];
  if (rawProbs.some((p) => p === null)) return null;
  const [homeProb, drawProb, awayProb] = devig(rawProbs as number[]);

  const ou = typeof o.overUnder === 'number' ? o.overUnder : null;
  const overOdds = o?.total?.over?.close?.odds ?? o?.total?.over?.open?.odds ?? null;
  const underOdds = o?.total?.under?.close?.odds ?? o?.total?.under?.open?.odds ?? null;

  return {
    provider: typeof o?.provider?.name === 'string' ? o.provider.name : 'Sportsbook',
    homeML,
    drawML,
    awayML,
    homeProb,
    drawProb,
    awayProb,
    overUnder: ou,
    overOdds: typeof overOdds === 'string' ? overOdds : null,
    underOdds: typeof underOdds === 'string' ? underOdds : null,
    openHomeML: openLeg(o, 'home'),
    openDrawML: openLeg(o, 'draw'),
    openAwayML: openLeg(o, 'away'),
    updatedAtMs,
  };
}

/**
 * Server-side display gate for a stored odds snapshot. Returns the parsed
 * MatchOdds only when the match is still open for picks AND the snapshot is
 * fresh; null otherwise. Locked (kicked-off or finished) matches never render
 * an odds strip, so serializing their line would only leak it into the RSC
 * flight payload — gate it out before it reaches the client.
 */
export function oddsForDisplay(
  row: { oddsJson: string | null; oddsUpdatedAt: number | null },
  opts: { nowMs: number; locked: boolean; freshMs: number },
): MatchOdds | null {
  if (opts.locked) return null;
  if (!row.oddsJson || !row.oddsUpdatedAt) return null;
  if (opts.nowMs - row.oddsUpdatedAt > opts.freshMs) return null;
  try {
    return JSON.parse(row.oddsJson) as MatchOdds;
  } catch {
    return null;
  }
}

/** One first-goalscorer price extracted from a propBets page. */
export interface ScorerOddsItem {
  /** ESPN athlete $ref URL — resolved to a name by the fetcher (cached). */
  athleteRef: string;
  american: string;
}

/** Pull First Goalscorer items out of one ESPN propBets page. */
export function parsePropBetsPage(page: unknown): ScorerOddsItem[] {
  const items = (page as any)?.items;
  if (!Array.isArray(items)) return [];
  const out: ScorerOddsItem[] = [];
  for (const it of items) {
    if (it?.type?.name !== 'First Goalscorer') continue;
    const ref = it?.athlete?.$ref;
    const american = it?.current?.over?.american ?? it?.current?.american ?? null;
    if (typeof ref === 'string' && typeof american === 'string' && american.trim() !== '') {
      out.push({ athleteRef: ref, american: american.trim() });
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** ESPN athlete id from a $ref URL (".../athletes/102337?lang=…" → "102337"). */
export function athleteIdFromRef(ref: string): string | null {
  const m = /\/athletes\/(\d+)/.exec(ref);
  return m ? m[1] : null;
}
