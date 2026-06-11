'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage, postJson } from './client-api';

// Same field recipe as PickForm's wideInputClass — one input language
// app-wide. No placeholder override (global ::placeholder keeps AA contrast).
const inputClass =
  'h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30';

/** Creates a league via POST /api/leagues, then navigates to its Today screen. */
export function CreateLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [buyIn, setBuyIn] = useState(''); // dollars, optional
  const [joinPassword, setJoinPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give your league a name.');
      return;
    }

    let buyInCents: number | undefined;
    if (buyIn.trim() !== '') {
      const dollars = Number(buyIn);
      if (!Number.isFinite(dollars) || dollars < 0) {
        setError('Buy-in must be a positive amount.');
        return;
      }
      buyInCents = Math.round(dollars * 100);
    }

    setBusy(true);
    try {
      const data = await postJson<{ league: { slug: string } }>(
        '/api/leagues',
        {
          name: trimmedName,
          ...(buyInCents !== undefined ? { buyInCents } : {}),
          ...(joinPassword.trim() !== ''
            ? { joinPassword: joinPassword.trim() }
            : {}),
        },
      );
      router.push(`/league/${data.league.slug}/today`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">
          League name
        </span>
        <input
          data-testid="create-league-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Lads, World Cup 2026"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">
          Buy-in per entry in dollars (optional)
        </span>
        <input
          data-testid="create-league-buyin"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={buyIn}
          onChange={(e) => setBuyIn(e.target.value)}
          placeholder="20"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">
          Join password (optional)
        </span>
        <input
          data-testid="create-league-password"
          type="text"
          autoComplete="off"
          value={joinPassword}
          onChange={(e) => setJoinPassword(e.target.value)}
          placeholder="Leave empty for invite-link only"
          className={inputClass}
        />
      </label>

      {error ? <p className="text-sm text-brand-bright">{error}</p> : null}

      <button
        type="submit"
        data-testid="create-league-submit"
        disabled={busy}
        className="h-12 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform active:scale-[.99] disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create league'}
      </button>
    </form>
  );
}

export default CreateLeagueForm;
