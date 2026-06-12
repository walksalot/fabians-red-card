'use client';

import { useState, type FormEvent } from 'react';
import { errorMessage, postJson } from './client-api';

export type AuthMode = 'login' | 'register';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
}

// No placeholder override — the global ::placeholder rule (zinc-500) keeps AA
// contrast. Same field recipe as PickForm's wideInputClass (zinc-950/60 well,
// zinc-700 border, emerald focus ring) — one input language app-wide.
const inputClass =
  'h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30';

/**
 * Shared login/register form. POSTs /api/auth/<mode>; the session cookie is set
 * by the API — the parent decides where to navigate via onSuccess.
 */
export function AuthForm({
  mode,
  submitLabel,
  onSuccess,
}: {
  mode: AuthMode;
  submitLabel?: string;
  onSuccess: (user: AuthUser) => void | Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const body =
        mode === 'register'
          ? { username, displayName, password }
          : { username, password };
      const data = await postJson<{ user: AuthUser }>(
        `/api/auth/${mode}`,
        body,
      );
      await onSuccess(data.user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">
          Username
        </span>
        <input
          data-testid="auth-username"
          type="text"
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="yourname"
          className={inputClass}
        />
      </label>

      {mode === 'register' ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">
            Display name
          </span>
          <input
            data-testid="auth-displayname"
            type="text"
            required
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How your friends know you"
            className={inputClass}
          />
        </label>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">
          Password
        </span>
        <input
          data-testid="auth-password"
          type="password"
          required
          autoComplete={
            mode === 'register' ? 'new-password' : 'current-password'
          }
          // State the 8+ rule up front when creating a password (the reset
          // page already does) — native minLength makes the browser the
          // first error path, same pattern as PickForm's score bounds.
          minLength={mode === 'register' ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            mode === 'register' ? '8+ characters' : '••••••••'
          }
          className={inputClass}
        />
      </label>

      {/* Always-rendered slot (one reserved text-sm line): the auth card is
          vertically centered, so popping the error in must not jump every
          field up by half the message height at the moment of failure. */}
      <p aria-live="polite" className="min-h-5 text-sm text-brand-bright">
        {error}
      </p>

      <button
        type="submit"
        data-testid="auth-submit"
        disabled={busy}
        className="h-12 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[.99] disabled:opacity-50"
      >
        {busy
          ? 'One moment…'
          : (submitLabel ?? (mode === 'register' ? 'Create account' : 'Sign in'))}
      </button>
    </form>
  );
}

export default AuthForm;
