'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BracketNode, BracketSide } from '@/lib/bracket';
import { codeToFlagEmoji, shortTeamName } from './flags';
import { STAGE_LABELS, formatMatchdayShort } from './format';
import { STALE_FEED_MS } from './freshness';

/**
 * The knockout tree, two rounds at a time: each block shows a pair of feeder
 * games merging (connector elbows) into the game they feed. Winners emerald,
 * losers fade, live games pulse. "Follow a team" dims everything off that
 * team's road — nodes AND connectors travel together (the refined-prototype
 * spec). Display-only.
 */

const ROUND_PAIRS: Array<{ from: string; to: string }> = [
  { from: 'r32', to: 'r16' },
  { from: 'r16', to: 'qf' },
  { from: 'qf', to: 'sf' },
  { from: 'sf', to: 'final' },
];

function SideLine({
  side,
  live,
  compact = false,
}: {
  side: BracketSide;
  live: boolean;
  compact?: boolean;
}) {
  const name = side.team
    ? compact
      ? side.team.code
      : shortTeamName(side.team.name)
    : null;
  const tone = side.won
    ? 'text-emerald-400'
    : side.lost
      ? 'text-zinc-500'
      : live
        ? 'text-brand-bright'
        : 'text-zinc-200';
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 text-[13px] font-bold tabular-nums ${tone}`}
    >
      {side.team ? (
        <span aria-hidden="true" className="shrink-0 text-[15px] leading-none">
          {codeToFlagEmoji(side.team.code) ?? ''}
        </span>
      ) : null}
      <span className="min-w-0 truncate">
        {name ?? (
          // Same shortener Today and admin Results use — two side-by-side
          // "Winners Mat…" are indistinguishable at 390px.
          <span className="font-medium text-zinc-400">
            {side.placeholder ? shortTeamName(side.placeholder) : 'TBD'}
          </span>
        )}
      </span>
      {side.score !== null ? (
        <span className="ml-auto shrink-0 font-extrabold">
          {side.score}
          {side.pens !== null ? (
            // Shootout tally — "1 (4)" reads as the pool scores it: the tie
            // stays a draw, the parenthetical only names who advanced.
            <span className="font-semibold text-zinc-400"> ({side.pens})</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function NodeCard({
  node,
  slug,
  currentDay,
  followed,
  serverNowMs,
  picked = false,
  compact = false,
  entryQuery = '',
}: {
  node: BracketNode;
  slug: string;
  currentDay: string | null;
  followed: string | null;
  /** clock.now() on the server at render time — anchors feed staleness. */
  serverNowMs: number;
  /** This entry already has a pick on the node's match (display-only). */
  picked?: boolean;
  compact?: boolean;
  /** "&entry=N" when a non-default entry is selected — deep links keep it. */
  entryQuery?: string;
}) {
  const hit = followed !== null && node.possibleCodes.includes(followed);
  const dim = followed !== null && !hit;
  const linkable =
    node.status !== 'finished' &&
    currentDay !== null &&
    node.matchday >= currentDay;
  // "tap to pick" only when both slots are filled — the pick screen refuses
  // placeholder matches, so an unfilled node must not advertise the action.
  const pickable = linkable && node.home.team !== null && node.away.team !== null;
  // Frozen feed: keep the last score but drop the pulsing LIVE lockup for the
  // same calm "awaiting result" Today's cards use (shared STALE_FEED_MS) —
  // the two screens must never contradict each other.
  const stale =
    node.live &&
    node.liveUpdatedAt !== null &&
    serverNowMs - node.liveUpdatedAt > STALE_FEED_MS;
  const pulsing = node.live && !stale;
  const caption = node.live
    ? stale
      ? 'awaiting result'
      : `LIVE${node.liveClock ? ` · ${node.liveClock}` : ''}`
    : node.status === 'finished'
      ? node.decidedOnPens
        ? 'decided on penalties'
        : null
      : `${formatMatchdayShort(node.matchday)} · ${node.city}`;
  const body = (
    <>
      <SideLine side={node.home} live={pulsing} compact={compact} />
      <SideLine side={node.away} live={pulsing} compact={compact} />
      {caption ? (
        <span
          className={`mt-1 block text-[10px] font-semibold ${
            pulsing ? 'text-brand-bright' : 'text-zinc-500'
          }`}
        >
          {node.live ? (
            // Static dot + ping halo (LiveNow's pattern) — a lone animate-ping
            // dot is invisible for most of each cycle. Stale feeds keep only
            // the static dot, zinc: no pulse on an unvouched heartbeat.
            <span
              aria-hidden="true"
              className="relative mr-1 inline-block h-1.5 w-1.5 align-middle"
            >
              {pulsing ? (
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-75 motion-safe:animate-ping" />
              ) : null}
              <span
                className={`relative block h-1.5 w-1.5 rounded-full ${
                  pulsing ? 'bg-brand' : 'bg-zinc-600'
                }`}
              />
            </span>
          ) : null}
          {caption}
          {linkable && !node.live
            ? pickable
              ? picked
                ? ' · picked — tap to change'
                : ' · tap to pick'
              : ' · picks open when teams are set'
            : ''}
        </span>
      ) : null}
    </>
  );
  const cls = `block rounded-xl border px-2.5 py-2 transition-opacity duration-200 ${
    node.status === 'finished' || node.home.team
      ? 'border-white/[0.07] bg-gradient-to-b from-[#202024] to-[#18181b]'
      : 'border-dashed border-white/10 bg-zinc-900/40'
  } ${dim ? 'opacity-30' : ''} ${hit ? 'shadow-[0_0_0_1px_rgba(52,211,153,0.45)]' : ''}`;
  if (linkable) {
    return (
      <Link
        href={`/league/${slug}/today?day=${node.matchday}${entryQuery}`}
        data-testid={`bracket-node-${node.matchId}`}
        className={`${cls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60`}
      >
        {body}
      </Link>
    );
  }
  return (
    <div data-testid={`bracket-node-${node.matchId}`} className={cls}>
      {body}
    </div>
  );
}

/**
 * Connector elbow between a feeder pair and its child. Each arm lights and
 * dims with ITS OWN feeder's road, the shared stub into the child with the
 * child's — nodes AND connectors travel together at the arm level, so an
 * emerald arm never plugs into a dimmed feeder card.
 */
function Joint({
  arms,
  stub,
  active,
}: {
  /** [top, bottom] — each arm's feeder is on the followed road. */
  arms: [boolean, boolean];
  /** The child is on the followed road (lights the shared stub). */
  stub: boolean;
  /** A follow is active (unlit segments dim to opacity-30). */
  active: boolean;
}) {
  const strokeOf = (lit: boolean) =>
    lit ? 'rgba(52,211,153,.55)' : 'rgba(63,63,70,1)';
  const dimCls = (lit: boolean) =>
    `transition-opacity duration-200 ${active && !lit ? 'opacity-30' : ''}`;
  return (
    <span
      aria-hidden="true"
      className="relative block self-stretch"
      style={{ width: 20 }}
    >
      {/* Two stacked L-strokes meet at the midline; together they draw the
          same elbow the old single stroke did. */}
      <span
        className={`absolute left-0 rounded-tr-md border-2 border-b-0 border-l-0 ${dimCls(arms[0])}`}
        style={{ top: 26, bottom: '50%', width: 11, borderColor: strokeOf(arms[0]) }}
      />
      <span
        className={`absolute left-0 rounded-br-md border-2 border-l-0 border-t-0 ${dimCls(arms[1])}`}
        style={{ top: '50%', bottom: 26, width: 11, borderColor: strokeOf(arms[1]) }}
      />
      <span
        className={`absolute right-0 ${dimCls(stub)}`}
        style={{ left: 11, top: '50%', borderTop: `2px solid ${strokeOf(stub)}` }}
      />
    </span>
  );
}

export default function BracketTree({
  slug,
  nodes,
  currentDay,
  serverNowMs,
  pickedMatchIds = [],
  entryParam = null,
}: {
  slug: string;
  nodes: BracketNode[];
  currentDay: string | null;
  /** clock.now() on the server at render time — anchors feed staleness. */
  serverNowMs: number;
  /** Matches this entry already picked (drives "picked — tap to change"). */
  pickedMatchIds?: number[];
  /** Selected ?entry= value (multi-entry users) — deep links preserve it. */
  entryParam?: string | null;
}) {
  const [followed, setFollowed] = useState<string | null>(null);
  const byId = new Map(nodes.map((n) => [n.matchId, n]));
  const picked = new Set(pickedMatchIds);
  const entryQuery = entryParam ? `&entry=${encodeURIComponent(entryParam)}` : '';

  // Follow chips: teams still alive (possible in any unfinished node),
  // alphabetical by code. Falls back to every knockout team pre-results.
  const alive = new Set<string>();
  for (const n of nodes) {
    if (n.status !== 'finished') for (const c of n.possibleCodes) alive.add(c);
  }
  const chips = [...alive].sort();
  const nameOf = (code: string): string => {
    for (const n of nodes) {
      for (const s of [n.home, n.away]) {
        if (s.team?.code === code) return shortTeamName(s.team.name);
      }
    }
    return code;
  };

  const followedName = followed !== null ? nameOf(followed) : null;

  return (
    <div>
      {chips.length > 1 ? (
        <>
          <p className="mb-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-zinc-400">
            Two games feed one — follow the lines.{' '}
            <span className="font-bold text-zinc-200">Tap a team</span> to light
            up their road to the final.
          </p>
          <div
            className="-mx-4 mb-1 flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Follow a team"
          >
            {chips.map((code) => {
              const on = followed === code;
              return (
                <button
                  key={code}
                  type="button"
                  data-testid={`follow-${code}`}
                  aria-pressed={on}
                  aria-label={`Follow ${nameOf(code)}`}
                  onClick={() => setFollowed(on ? null : code)}
                  className={`flex min-h-10 flex-none items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors ${
                    on
                      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                      : 'border-white/[0.07] bg-zinc-900 text-zinc-300 hover:bg-zinc-800/70'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60`}
                >
                  <span aria-hidden="true" className="text-sm leading-none">
                    {codeToFlagEmoji(code) ?? ''}
                  </span>
                  <span>{code}</span>
                </button>
              );
            })}
          </div>
          <p
            className="mb-3 min-h-4 text-[11px] font-semibold text-emerald-300/90"
            aria-live="polite"
          >
            {followedName !== null
              ? `Following ${followedName} — tap again to clear`
              : ' '}
          </p>
        </>
      ) : null}

      {ROUND_PAIRS.map(({ from, to }) => {
        const children = nodes.filter((n) => n.stage === to);
        if (children.length === 0) return null;
        // Only render a transition once its feeder round exists.
        if (!nodes.some((n) => n.stage === from)) return null;
        return (
          <section key={to} className="mb-5">
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="text-sm font-extrabold text-zinc-100">
                {STAGE_LABELS[from] ?? from} → {STAGE_LABELS[to] ?? to}
              </h3>
            </div>
            <div className="space-y-3">
              {children.map((child) => {
                const feeders = child.feeders
                  .map((id) => byId.get(id))
                  .filter((n): n is BracketNode => n !== undefined);
                const childHit =
                  followed !== null && child.possibleCodes.includes(followed);
                // No resolvable feeders (data gap): render the game alone
                // rather than an empty column with a dangling connector.
                if (feeders.length === 0) {
                  return (
                    <NodeCard
                      key={child.matchId}
                      node={child}
                      slug={slug}
                      currentDay={currentDay}
                      followed={followed}
                      serverNowMs={serverNowMs}
                      picked={picked.has(child.matchId)}
                      entryQuery={entryQuery}
                    />
                  );
                }
                // Per-arm road hits — each connector arm lights with its own
                // feeder; a missing second feeder's arm follows the child.
                const armHits = feeders.map(
                  (f) => followed !== null && f.possibleCodes.includes(followed),
                );
                return (
                  <div
                    key={child.matchId}
                    className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1.05fr)] items-center"
                  >
                    <div className="flex flex-col justify-between gap-2.5">
                      {feeders.map((f) => (
                        <NodeCard
                          key={f.matchId}
                          node={f}
                          slug={slug}
                          currentDay={currentDay}
                          followed={followed}
                          serverNowMs={serverNowMs}
                          picked={picked.has(f.matchId)}
                          entryQuery={entryQuery}
                          compact
                        />
                      ))}
                    </div>
                    <Joint
                      arms={[armHits[0] ?? childHit, armHits[1] ?? childHit]}
                      stub={childHit}
                      active={followed !== null}
                    />
                    <NodeCard
                      node={child}
                      slug={slug}
                      currentDay={currentDay}
                      followed={followed}
                      serverNowMs={serverNowMs}
                      picked={picked.has(child.matchId)}
                      entryQuery={entryQuery}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {/* No 🏆 here — the trophy stays the wrap banner's day-winner symbol
          (today/page.tsx's glyph convention); the bracket keeps its own mark. */}
      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-zinc-400">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M2 4h4v3.5h3.5M2 12h4V8.5h3.5M9.5 8h4.5" />
        </svg>
        Fills in on its own as results land. Final · Jul 19 · MetLife Stadium
      </p>
    </div>
  );
}
