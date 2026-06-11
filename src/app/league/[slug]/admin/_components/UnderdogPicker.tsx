'use client';

import { useState } from 'react';
import {
  apiSend,
  formatMatchday,
  groupByMatchday,
  type AdminMatch,
} from './shared';

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
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Flag the underdog of a match — entries that predict the underdog to win earn a +
        {underdogPoints} point bonus when the upset lands.
      </p>
      {days.map((day) => {
        const isPast = day.matches.every((m) => Date.parse(m.kickoffUtc) < nowMs);
        return (
          <details
            key={day.matchday}
            open={!isPast}
            className="rounded-xl border border-zinc-800 bg-zinc-950/40"
          >
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden">
              {formatMatchday(day.matchday)}
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
    <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-sm text-zinc-100">
        <span className="text-[11px] text-zinc-500">M{match.id} · </span>
        {match.homeName} <span className="text-zinc-500">vs</span> {match.awayName}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-sm text-zinc-300">
            <input
              type="radio"
              name={`underdog-${match.id}`}
              data-testid={`underdog-${match.id}-${opt.value}`}
              value={opt.value}
              checked={side === opt.value}
              onChange={() => choose(opt.value)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            <span className="max-w-32 truncate">{opt.label}</span>
          </label>
        ))}
        {saving && <span className="text-xs text-zinc-500">Saving…</span>}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
