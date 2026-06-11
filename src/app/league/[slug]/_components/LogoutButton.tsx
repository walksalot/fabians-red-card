'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the request fails, send them to the login screen.
    }
    router.push('/login');
  }

  return (
    <div className="pt-2">
      <button
        type="button"
        data-testid="logout"
        onClick={logout}
        disabled={busy}
        className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/5 hover:text-brand-bright disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-brand-bright/90 transition-colors group-hover:text-brand-bright"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        {busy ? 'Signing out…' : 'Log out'}
      </button>
    </div>
  );
}
