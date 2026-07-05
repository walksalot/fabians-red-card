'use client';

import { useState } from 'react';
import {
  apiSend,
  formatMatchday,
  groupByMatchday,
  matchdayOf,
  type AdminMatch,
} from './shared';
import { Chevron } from './ui';

type Side = 'none' | 'home' | 'away';

interface Props {
  matches: AdminMatch[]; // kickoff-ordered, both teams known
  underdogPoints: number; // league scoringRules.underdog
  nowMs: number; // clock.now() from the server
}

export default function UnderdogPicker({ matches, underdogPoints, nowMs }: Props) {
  if (matches.length === 0) {
    return <p className="text-sm text-zinc-400">No matches with confirmed teams yet.</p>;
  }
  const days = groupByMatchday(matches);
  // Open only today and the next matchday — flagging underdogs is a
  // just-before-kickoff job; far-future days start collapsed.
  const todayNY = matchdayOf(nowMs);
  const nextMatchday = days.find((d) => d.matchday > todayNY)?.matchday ?? null;
  // The day the admin acts on now (today, else the next matchday) — carries
  // the #underdog-today anchor the jump pill targets, mirroring ResultsEntry:
  // today's accordion can sit a full screen below weeks of past days.
  const focusMatchday = days.some((d) => d.matchday === todayNY)
    ? todayNY
    : nextMatchday;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Flag the underdog of a match — entries that predict the underdog to win earn a +
        {underdogPoints} point bonus when the upset lands.
      </p>
      {focusMatchday !== null ? (
        <a
          href="#underdog-today"
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-3 py-1.5 text-xs font-semibold text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          Jump to {focusMatchday === todayNY ? 'today' : 'next matchday'}
          <Chevron className="h-3 w-3 text-zinc-500" />
        </a>
      ) : null}
      {days.map((day) => {
        const defaultOpen =
          day.matchday === todayNY || day.matchday === nextMatchday;
        const flaggedCount = day.matches.filter(
          (m) => m.underdogTeamId !== null,
        ).length;
        return (
          <details
            key={day.matchday}
            id={day.matchday === focusMatchday ? 'underdog-today' : undefined}
            open={defaultOpen}
            className="group scroll-mt-28 rounded-xl border border-zinc-800 bg-zinc-950/40"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden [&::marker]:hidden">
              <span>{formatMatchday(day.matchday)}</span>
              <span className="flex items-center gap-2">
                {/* Per-day state at a glance — collapsed days would otherwise
                    hide whether the just-before-kickoff job is done. */}
                <span
                  className={`text-xs font-normal ${flaggedCount > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}
                >
                  {flaggedCount > 0
                    ? `${flaggedCount} flagged`
                    : '—'}
                </span>
                <Chevron className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" />
              </span>
            </summary>
            <div className="space-y-2 px-2 pb-2">
              {day.matches.map((m) => (
                <UnderdogRow key={m.id} match={m} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function initialSide(match: AdminMatch): Side {
  if (match.underdogTeamId === null) return 'none';
  if (match.underdogTeamId === match.homeTeamId) return 'home';
  if (match.underdogTeamId === match.awayTeamId) return 'away';
  return 'none';
}

function UnderdogRow({ match }: { match: AdminMatch }) {
  const [side, setSide] = useState<Side>(initialSide(match));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: Side) {
    if (saving || next === side) return;
    const prev = side;
    setSide(next); // optimistic — radios feel instant on match night
    setSaving(true);
    setError(null);
    const underdogTeamId =
      next === 'none' ? null : next === 'home' ? match.homeTeamId : match.awayTeamId;
    const res = await apiSend('/api/matches/underdog', 'POST', {
      matchId: match.id,
      underdogTeamId,
    });
    setSaving(false);
    if (!res.ok) {
      setSide(prev);
      setError(res.error);
    }
  }

  const options: Array<{ value: Side; label: string }> = [
    { value: 'none', label: 'None' },
    { value: 'home', label: match.homeName },
    { value: 'away', label: match.awayName },
  ];

  return (
    <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-sm text-zinc-100">
        <span className="text-[11px] text-zinc-400">Match {match.id} · </span>
        {match.homeName} <span className="text-zinc-500">vs</span> {match.awayName}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {options.map((opt) => (
          // min-h-10: the commissioner thumbs through ~104 of these rows on
          // match night — a bare 20px-tall label is half the mobile tap floor.
          <label
            key={opt.value}
            className="flex min-h-10 cursor-pointer items-center gap-1.5 text-sm text-zinc-300"
          >
            <input
              type="radio"
              name={`underdog-${match.id}`}
              data-testid={`underdog-${match.id}-${opt.value}`}
              value={opt.value}
              checked={side === opt.value}
              onChange={() => choose(opt.value)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            {/* max-w-56 fits the longest FIFA name ("Bosnia and Herzegovina")
                — the chip row flex-wraps, so a 128px cap just ellipsized names
                that had a whole empty row of space to use. */}
            <span className="max-w-56 truncate">{opt.label}</span>
          </label>
        ))}
        {saving && <span className="text-xs text-zinc-500">Saving…</span>}
      </div>
      {error && <p className="text-xs text-brand-bright">{error}</p>}
    </div>
  );
}
