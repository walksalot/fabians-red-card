'use client';

import { useState, type FormEvent } from 'react';
import {
  apiSend,
  formatKickoffEt,
  formatMatchday,
  groupByMatchday,
  STAGE_LABELS,
  type AdminMatch,
} from './shared';

interface Props {
  matches: AdminMatch[]; // kickoff-ordered
  nowMs: number; // clock.now() from the server — never the browser clock
}

export default function ResultsEntry({ matches, nowMs }: Props) {
  if (matches.length === 0) {
    return <p className="text-sm text-zinc-400">No matches in the schedule yet.</p>;
  }
  const days = groupByMatchday(matches);
  return (
    <div className="space-y-3">
      {days.map((day) => {
        const finishedCount = day.matches.filter((m) => m.status === 'finished').length;
        const allFinished = finishedCount === day.matches.length;
        const isPast = day.matches.every((m) => Date.parse(m.kickoffUtc) < nowMs);
        // Past, fully-entered days start collapsed; anything still needing a result stays open.
        const defaultOpen = !(isPast && allFinished);
        return (
          <details
            key={day.matchday}
            open={defaultOpen}
            className="rounded-xl border border-zinc-800 bg-zinc-950/40"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden">
              <span>{formatMatchday(day.matchday)}</span>
              <span
                className={`text-xs font-normal ${allFinished ? 'text-emerald-400' : 'text-zinc-500'}`}
              >
                {finishedCount}/{day.matches.length} entered
              </span>
            </summary>
            <div className="space-y-2 px-2 pb-2">
              {day.matches.map((m) => (
                <ResultForm key={m.id} match={m} nowMs={nowMs} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ResultForm({ match, nowMs }: { match: AdminMatch; nowMs: number }) {
  const [home, setHome] = useState(match.homeScore !== null ? String(match.homeScore) : '');
  const [away, setAway] = useState(match.awayScore !== null ? String(match.awayScore) : '');
  const [scorer, setScorer] = useState(match.firstScorer ?? '');
  const [firstTeam, setFirstTeam] = useState<'home' | 'away' | 'none'>(
    match.firstScoringTeam ?? 'home',
  );
  const [finished, setFinished] = useState(match.status === 'finished');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const zeroZero =
    home.trim() !== '' && away.trim() !== '' && Number(home) === 0 && Number(away) === 0;
  // 0-0 means nobody scored: first team to score is forced to 'none'.
  const effectiveFirstTeam: 'home' | 'away' | 'none' = zeroZero ? 'none' : firstTeam;

  function onScores(h: string, a: string) {
    setHome(h);
    setAway(a);
    if (h.trim() !== '' && a.trim() !== '' && Number(h) === 0 && Number(a) === 0) {
      setFirstTeam('none');
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const h = Number(home.trim());
    const a = Number(away.trim());
    if (
      home.trim() === '' ||
      away.trim() === '' ||
      !Number.isInteger(h) ||
      !Number.isInteger(a) ||
      h < 0 ||
      a < 0
    ) {
      setMsg({ kind: 'err', text: 'Enter both scores' });
      return;
    }
    const trimmedScorer = scorer.trim();
    setSaving(true);
    setMsg(null);
    const res = await apiSend('/api/results', 'POST', {
      matchId: match.id,
      homeScore: h,
      awayScore: a,
      firstScorer: zeroZero || trimmedScorer === '' ? null : trimmedScorer,
      firstScoringTeam: zeroZero ? 'none' : effectiveFirstTeam,
    });
    setSaving(false);
    if (res.ok) {
      setFinished(true);
      setMsg({ kind: 'ok', text: 'Saved ✓' });
      window.setTimeout(() => setMsg(null), 2500);
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  }

  const kickedOff = Date.parse(match.kickoffUtc) <= nowMs;
  const chip = finished
    ? { text: 'FT', cls: 'bg-emerald-500/15 text-emerald-400' }
    : kickedOff
      ? { text: 'In play', cls: 'bg-amber-500/15 text-amber-400' }
      : { text: formatKickoffEt(match.kickoffUtc), cls: 'bg-zinc-800 text-zinc-400' };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      data-testid={`result-form-${match.id}`}
      className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${chip.cls}`}>{chip.text}</span>
        <span>
          M{match.id} · {STAGE_LABELS[match.stage]}
        </span>
        <span className="ml-auto truncate">{match.city}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{match.homeName}</span>
        <input
          data-testid={`result-home-${match.id}`}
          aria-label={`${match.homeName} score`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={home}
          onChange={(e) => onScores(e.target.value, away)}
          className="w-12 rounded-lg border border-zinc-700 bg-zinc-950 px-1 py-1.5 text-center text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
        />
        <span className="text-zinc-600">–</span>
        <input
          data-testid={`result-away-${match.id}`}
          aria-label={`${match.awayName} score`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={away}
          onChange={(e) => onScores(home, e.target.value)}
          className="w-12 rounded-lg border border-zinc-700 bg-zinc-950 px-1 py-1.5 text-center text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
        />
        <span className="min-w-0 flex-1 truncate text-right text-sm text-zinc-100">
          {match.awayName}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid={`result-scorer-${match.id}`}
          aria-label="First goalscorer"
          type="text"
          autoComplete="off"
          placeholder="First scorer"
          value={scorer}
          onChange={(e) => setScorer(e.target.value)}
          disabled={zeroZero}
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none disabled:opacity-50"
        />
        <select
          data-testid={`result-firstteam-${match.id}`}
          aria-label="First team to score"
          value={effectiveFirstTeam}
          onChange={(e) => {
            if (!zeroZero) setFirstTeam(e.target.value as 'home' | 'away' | 'none');
          }}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
        >
          <option value="home">First: home</option>
          <option value="away">First: away</option>
          <option value="none">First: none (0-0)</option>
        </select>
        <button
          type="submit"
          data-testid={`result-save-${match.id}`}
          disabled={saving}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 active:scale-95 disabled:opacity-60"
        >
          {saving ? 'Saving…' : finished ? 'Edit result' : 'Save result'}
        </button>
        {msg && (
          <span
            className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
            role="status"
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
