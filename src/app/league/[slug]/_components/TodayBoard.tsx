'use client';

import { useEffect, useState } from 'react';
import BoosterButton from './BoosterButton';
import PickForm from './PickForm';
import { STAGE_LABELS, formatKickoffEt, formatPoints } from './format';
import type { TodayMatchView } from './types';

interface Props {
  entryId: number;
  /** clock.now() on the server at render time — keeps countdowns honest under FAKE_NOW. */
  serverNowMs: number;
  boosterMultiplier: number;
  items: TodayMatchView[];
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Countdown({
  kickoffUtc,
  serverNowMs,
}: {
  kickoffUtc: string;
  serverNowMs: number;
}) {
  // Anchor ticking to the server clock so a pinned FAKE_NOW stays authoritative.
  const [nowVal, setNowVal] = useState<number | null>(null);
  useEffect(() => {
    const offset = Date.now() - serverNowMs;
    const tick = () => setNowVal(Date.now() - offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNowMs]);

  if (nowVal === null) return <span className="text-xs text-zinc-500">…</span>;
  const remaining = new Date(kickoffUtc).getTime() - nowVal;
  if (remaining <= 0) {
    return <span className="text-xs font-medium text-red-400">Kicked off</span>;
  }
  return (
    <span className="text-xs font-medium text-emerald-400">
      Locks in {formatRemaining(remaining)}
    </span>
  );
}

function PickSummary({ item }: { item: TodayMatchView }) {
  if (!item.myPick) {
    return <p className="text-sm text-zinc-500">No pick made.</p>;
  }
  const p = item.myPick;
  const first =
    p.predFirstTeam === null
      ? null
      : p.predFirstTeam === 'none'
        ? 'no goals'
        : p.predFirstTeam === 'home'
          ? item.homeName
          : item.awayName;
  return (
    <p className="text-sm text-zinc-300">
      Your pick:{' '}
      <span className="font-semibold">
        {p.predHome}–{p.predAway}
      </span>
      {p.predScorer ? <> · {p.predScorer}</> : null}
      {first ? <> · first: {first}</> : null}
    </p>
  );
}

export default function TodayBoard({
  entryId,
  serverNowMs,
  boosterMultiplier,
  items,
}: Props) {
  return (
    <div className="space-y-3">
      {items.map((m) => (
        <div
          key={m.matchId}
          data-testid={`pick-form-${m.matchId}`}
          className={`rounded-xl border bg-zinc-900 p-4 ${
            m.boosted ? 'border-emerald-500/60' : 'border-zinc-800'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">
                {m.homeName} vs {m.awayName}
              </p>
              <p className="text-xs text-zinc-500">
                {STAGE_LABELS[m.stage] ?? m.stage} ·{' '}
                {formatKickoffEt(m.kickoffUtc)} · {m.venue}, {m.city}
              </p>
            </div>
            {m.status === 'finished' ? (
              <span className="shrink-0 text-xs text-zinc-400">Full time</span>
            ) : m.locked ? (
              <span className="shrink-0 text-xs font-medium text-amber-400">
                In progress
              </span>
            ) : (
              <Countdown kickoffUtc={m.kickoffUtc} serverNowMs={serverNowMs} />
            )}
          </div>

          {m.status === 'finished' ? (
            <div className="mt-3 space-y-1">
              <p className="text-xl font-bold">
                {m.homeScore}–{m.awayScore}
              </p>
              {m.firstScorer && (
                <p className="text-xs text-zinc-400">
                  First scorer: {m.firstScorer}
                </p>
              )}
              <PickSummary item={m} />
              <p className="text-sm font-semibold text-emerald-400">
                {m.points
                  ? `+${formatPoints(m.points.total)} pts`
                  : m.myPick
                    ? 'Points pending'
                    : '0 pts'}
              </p>
            </div>
          ) : m.locked ? (
            <div className="mt-3">
              <PickSummary item={m} />
              <p className="mt-1 text-xs text-zinc-500">
                Picks are locked for this match.
              </p>
            </div>
          ) : (
            <PickForm
              entryId={entryId}
              matchId={m.matchId}
              homeName={m.homeName}
              awayName={m.awayName}
              initial={m.myPick}
            />
          )}

          <div className="mt-3 border-t border-zinc-800 pt-3">
            <BoosterButton
              entryId={entryId}
              matchday={m.matchday}
              matchId={m.matchId}
              boosted={m.boosted}
              disabled={m.boosterDisabled}
              multiplier={boosterMultiplier}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
