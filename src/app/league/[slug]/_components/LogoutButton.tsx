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
    <button
      type="button"
      data-testid="logout"
      onClick={logout}
      disabled={busy}
      className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  );
}
