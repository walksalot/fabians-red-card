'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json: { ok: boolean; error?: string } | null = await res.json().catch(() => null);
      if (json?.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError(json?.error ?? 'Could not reset the password.');
        setBusy(false);
      }
    } catch {
      setError('Network error — please try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      {/* Same field recipe as AuthForm (label eyebrow, zinc-950/60 well,
          emerald focus ring) — one input language across every auth screen. */}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">
          New password
        </span>
        <input
          data-testid="reset-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="8+ characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        />
      </label>
      <button
        data-testid="reset-submit"
        type="submit"
        disabled={busy || password.length === 0}
        className="h-12 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[.99] disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Set password & sign in'}
      </button>
      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
