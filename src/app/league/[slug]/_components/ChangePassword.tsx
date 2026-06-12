'use client';

import { useState, type FormEvent } from 'react';

/** Collapsible self-serve password change on the Profile screen. */
export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      });
      const json: { ok: boolean; error?: string } | null = await res.json().catch(() => null);
      if (json?.ok) {
        setDone(true);
        setCurrent('');
        setNext('');
        setOpen(false);
      } else {
        setError(json?.error ?? 'Could not change the password.');
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
      <button
        type="button"
        data-testid="change-password-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setDone(false);
        }}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-zinc-200"
      >
        Change password
        <span className="text-xs text-zinc-500">{open ? '▴' : '▾'}</span>
      </button>
      {done ? (
        <p className="mt-2 text-xs font-medium text-emerald-400">Password updated ✓</p>
      ) : null}
      {open ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-2">
          <input
            data-testid="cp-current"
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
          />
          <input
            data-testid="cp-next"
            type="password"
            autoComplete="new-password"
            placeholder="New password (8+ characters)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
          />
          <button
            data-testid="cp-submit"
            type="submit"
            disabled={busy || current.length === 0 || next.length === 0}
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Update password'}
          </button>
          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}
