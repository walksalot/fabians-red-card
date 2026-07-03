'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BracketNode, BracketSide } from '@/lib/bracket';
import { codeToFlagEmoji, shortTeamName } from './flags';
import { STAGE_LABELS, formatMatchdayShort } from './format';

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
          <span className="font-medium text-zinc-500">{side.placeholder ?? 'TBD'}</span>
        )}
      </span>
      {side.score !== null ? (
        <span className="ml-auto shrink-0 font-extrabold">{side.score}</span>
      ) : null}
    </span>
  );
}

function NodeCard({
  node,
  slug,
  currentDay,
  followed,
  compact = false,
}: {
  node: BracketNode;
  slug: string;
  currentDay: string | null;
  followed: string | null;
  compact?: boolean;
}) {
  const hit = followed !== null && node.possibleCodes.includes(followed);
  const dim = followed !== null && !hit;
  const pickable =
    node.status !== 'finished' &&
    currentDay !== null &&
    node.matchday >= currentDay;
  const caption = node.live
    ? `LIVE${node.liveClock ? ` · ${node.liveClock}` : ''}`
    : node.status === 'finished'
      ? node.decidedOnPens
        ? 'decided on penalties'
        : null
      : `${formatMatchdayShort(node.matchday)} · ${node.city}`;
  const body = (
    <>
      <SideLine side={node.home} live={node.live} compact={compact} />
      <SideLine side={node.away} live={node.live} compact={compact} />
      {caption ? (
        <span
          className={`mt-1 block text-[10px] font-semibold ${
            node.live ? 'text-brand-bright' : 'text-zinc-500'
          }`}
        >
          {node.live ? (
            <span
              aria-hidden="true"
              className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle motion-safe:animate-ping"
            />
          ) : null}
          {caption}
          {pickable && !node.live ? ' · tap to pick' : ''}
        </span>
      ) : null}
    </>
  );
  const cls = `block rounded-xl border px-2.5 py-2 transition-opacity duration-200 ${
    node.status === 'finished' || node.home.team
      ? 'border-white/[0.07] bg-gradient-to-b from-[#202024] to-[#18181b]'
      : 'border-dashed border-white/10 bg-zinc-900/40'
  } ${dim ? 'opacity-30' : ''} ${hit ? 'shadow-[0_0_0_1px_rgba(52,211,153,0.45)]' : ''}`;
  if (pickable) {
    return (
      <Link
        href={`/league/${slug}/today?day=${node.matchday}`}
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

/** Connector elbow between a feeder pair and its child; dims with the road. */
function Joint({ lit, dimmed }: { lit: boolean; dimmed: boolean }) {
  const stroke = lit ? 'rgba(52,211,153,.55)' : 'rgba(63,63,70,1)';
  return (
    <span
      aria-hidden="true"
      className={`relative block self-stretch transition-opacity duration-200 ${
        dimmed ? 'opacity-30' : ''
      }`}
      style={{ width: 20 }}
    >
      <span
        className="absolute left-0 rounded-r-md border-2 border-l-0"
        style={{ top: 26, bottom: 26, width: 11, borderColor: stroke }}
      />
      <span
        className="absolute right-0"
        style={{ left: 11, top: '50%', borderTop: `2px solid ${stroke}` }}
      />
    </span>
  );
}

export default function BracketTree({
  slug,
  nodes,
  currentDay,
}: {
  slug: string;
  nodes: BracketNode[];
  currentDay: string | null;
}) {
  const [followed, setFollowed] = useState<string | null>(null);
  const byId = new Map(nodes.map((n) => [n.matchId, n]));

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

  return (
    <div>
      {chips.length > 1 ? (
        <>
          <p className="mb-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-zinc-400">
            Two games feed one — follow the lines.{' '}
            <span className="font-bold text-zinc-200">Tap a team</span> to light
            up their road to the final.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-1.5">
            {chips.slice(0, 16).map((code) => {
              const on = followed === code;
              return (
                <button
                  key={code}
                  type="button"
                  data-testid={`follow-${code}`}
                  aria-pressed={on}
                  onClick={() => setFollowed(on ? null : code)}
                  className={`flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-2 text-xs font-bold transition-colors ${
                    on
                      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                      : 'border-white/[0.07] bg-zinc-900 text-zinc-300 hover:bg-zinc-800/70'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60`}
                >
                  <span aria-hidden="true">{codeToFlagEmoji(code) ?? ''}</span>
                  <span className="truncate">{nameOf(code)}</span>
                </button>
              );
            })}
          </div>
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
                          compact
                        />
                      ))}
                    </div>
                    <Joint lit={childHit} dimmed={followed !== null && !childHit} />
                    <NodeCard
                      node={child}
                      slug={slug}
                      currentDay={currentDay}
                      followed={followed}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="pb-2 text-center text-[11px] text-zinc-500">
        Fills in on its own as results land. 🏆 Final · Jul 19 · MetLife Stadium
      </p>
    </div>
  );
}
