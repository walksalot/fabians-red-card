'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

/** Collapsible self-serve password change on the Profile screen. */
export default function ChangePassword() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // The card sits at the bottom of Profile, so the revealed fields would
  // otherwise open underneath the fixed tab bar and look like a dead tap.
  // block:'end' honors the form's scroll-mb so the Update button clears the
  // bar ('nearest' was a no-op — the form was already "in view" behind it).
  useEffect(() => {
    if (open) {
      formRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [open]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Belt-and-braces: a failed submit pulls the message line back into view —
  // the form's scroll-mb keeps it clear of the fixed tab bar.
  useEffect(() => {
    if (error) {
      formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [error]);

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
        // min-h-11 (44px) — the bare text row was a 20px tap target.
        className="flex min-h-11 w-full items-center justify-between text-left text-sm font-semibold text-zinc-200"
      >
        Change password
        <span className="text-xs text-zinc-500">{open ? '▴' : '▾'}</span>
      </button>
      {done ? (
        <p className="mt-2 text-xs font-medium text-emerald-400">Password updated ✓</p>
      ) : null}
      {open ? (
        <form ref={formRef} onSubmit={onSubmit} className="mt-3 scroll-mb-24 space-y-2">
          {/* AuthForm's field recipe (label eyebrow + zinc-950/60 well) — one
              input language app-wide; placeholders alone vanish while typing. */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              Current password
            </span>
            <input
              data-testid="cp-current"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-sm text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              New password
            </span>
            <input
              data-testid="cp-next"
              type="password"
              autoComplete="new-password"
              placeholder="8+ characters"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-sm text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
            />
          </label>
          {/* Reserved slot ABOVE the button (AuthForm's recipe): below it the
              fixed tab bar covered the message entirely, so failed submits
              read as a dead button. */}
          <p aria-live="polite" role="alert" className="min-h-4 text-xs text-red-400">
            {error}
          </p>
          <button
            data-testid="cp-submit"
            type="submit"
            disabled={busy || current.length === 0 || next.length === 0}
            // h-11 (44px) — matches the tap floor and the inputs above; py-2
            // left it a squat 36px.
            className="h-11 w-full rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
