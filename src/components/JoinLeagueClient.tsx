'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthForm, type AuthMode } from './AuthForm';
import { errorMessage, postJson } from './client-api';

/**
 * Invite-funnel client: signed-in friends get a one-tap join button; new friends
 * register (or toggle to login) and are joined + navigated in the same flow.
 */
export function JoinLeagueClient({
  token,
  slug,
  leagueName,
  signedIn,
}: {
  token: string;
  slug: string;
  leagueName: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('register');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Joins the league then navigates. Throws on failure (caller shows the error). */
  async function join() {
    await postJson(`/api/join/${encodeURIComponent(token)}`);
    router.push(`/league/${slug}/today`);
    router.refresh();
  }

  async function joinAsSignedInUser() {
    setError(null);
    setBusy(true);
    try {
      await join();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (signedIn) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          data-testid="join-league"
          onClick={joinAsSignedInUser}
          disabled={busy}
          className="h-12 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:scale-[.99] disabled:opacity-50"
        >
          {busy ? 'Joining…' : `Join ${leagueName}`}
        </button>
        {error ? <p className="text-sm text-brand-bright">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthForm
        mode={mode}
        submitLabel={
          mode === 'register' ? 'Create account & join' : 'Sign in & join'
        }
        onSuccess={join}
      />
      <p className="text-center text-sm text-zinc-400">
        {mode === 'register' ? 'Already have an account?' : 'New here?'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'register' ? 'login' : 'register');
            setError(null);
          }}
          className="rounded font-semibold text-emerald-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          {mode === 'register' ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </div>
  );
}

export default JoinLeagueClient;
