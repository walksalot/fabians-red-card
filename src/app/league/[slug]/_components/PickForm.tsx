'use client';

import { useState, type FormEvent } from 'react';
import type { FirstTeam, PickView } from './types';

interface Props {
  entryId: number;
  matchId: number;
  homeName: string;
  awayName: string;
  initial: PickView | null;
}

type Status = 'idle' | 'saved' | 'error';

/** Score + first goalscorer + first team to score inputs for one unlocked match. */
export default function PickForm({
  entryId,
  matchId,
  homeName,
  awayName,
  initial,
}: Props) {
  const [home, setHome] = useState(initial ? String(initial.predHome) : '');
  const [away, setAway] = useState(initial ? String(initial.predAway) : '');
  const [scorer, setScorer] = useState(initial?.predScorer ?? '');
  const [firstTeam, setFirstTeam] = useState<'' | FirstTeam>(
    initial?.predFirstTeam ?? '',
  );
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const predHome = Number(home);
    const predAway = Number(away);
    if (
      !Number.isInteger(predHome) ||
      !Number.isInteger(predAway) ||
      predHome < 0 ||
      predHome > 20 ||
      predAway < 0 ||
      predAway > 20
    ) {
      setStatus('error');
      setError('Scores must be whole numbers from 0 to 20.');
      return;
    }
    setError(null);
    setStatus('saved'); // optimistic — reverted to an error below if the save fails
    try {
      const res = await fetch('/api/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId,
          matchId,
          predHome,
          predAway,
          predScorer: scorer.trim() === '' ? null : scorer.trim(),
          predFirstTeam: firstTeam === '' ? null : firstTeam,
        }),
      });
      const json: { ok: boolean; error?: string } | null = await res
        .json()
        .catch(() => null);
      if (!json || !json.ok) {
        setStatus('error');
        setError(json?.error ?? 'Could not save your pick.');
      }
    } catch {
      setStatus('error');
      setError('Network error — pick not saved.');
    }
  }

  const scoreInputClass =
    'w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-center text-zinc-100';
  const wideInputClass =
    'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100';

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          data-testid="pick-home"
          aria-label={`${homeName} goals`}
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          required
          value={home}
          onChange={(e) => setHome(e.target.value)}
          className={scoreInputClass}
        />
        <span className="text-zinc-500">–</span>
        <input
          data-testid="pick-away"
          aria-label={`${awayName} goals`}
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          required
          value={away}
          onChange={(e) => setAway(e.target.value)}
          className={scoreInputClass}
        />
      </div>
      <input
        data-testid="pick-scorer"
        aria-label="First goalscorer"
        type="text"
        placeholder="First goalscorer (optional)"
        value={scorer}
        onChange={(e) => setScorer(e.target.value)}
        className={wideInputClass}
      />
      <select
        data-testid="pick-first-team"
        aria-label="First team to score"
        value={firstTeam}
        onChange={(e) => setFirstTeam(e.target.value as '' | FirstTeam)}
        className={wideInputClass}
      >
        <option value="">First team to score (optional)</option>
        <option value="home">{homeName}</option>
        <option value="away">{awayName}</option>
        <option value="none">No goals (0–0)</option>
      </select>
      <div className="flex items-center gap-3">
        <button
          data-testid="pick-save"
          type="submit"
          className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Save pick
        </button>
        {status === 'saved' && (
          <span className="text-sm font-medium text-emerald-400">Saved ✓</span>
        )}
        {status === 'error' && error && (
          <span className="text-sm text-red-400">{error}</span>
        )}
      </div>
    </form>
  );
}
