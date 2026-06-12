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
      <input
        data-testid="reset-password"
        type="password"
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-100"
      />
      <button
        data-testid="reset-submit"
        type="submit"
        disabled={busy || password.length === 0}
        className="h-11 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform active:scale-[.99] disabled:opacity-50"
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
