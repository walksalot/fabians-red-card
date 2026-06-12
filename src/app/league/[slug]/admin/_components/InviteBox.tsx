'use client';

import { useState, useSyncExternalStore } from 'react';

interface Props {
  inviteToken: string;
  memberCount: number;
}

const noopSubscribe = () => () => {};

/** window.location.origin, hydration-safe: '' on the server, real origin on the client. */
function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  );
}

export default function InviteBox({ inviteToken, memberCount }: Props) {
  // Render the path on the server, upgrade to an absolute URL on the client.
  const origin = useOrigin();
  const url = `${origin}/join/${inviteToken}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http/permissions) — leave the URL selectable.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Share this link — friends who open it can register and join in one step.
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="invite-url"
          className="min-w-0 flex-1 truncate rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-emerald-400 select-all"
        >
          {url}
        </code>
        <button
          type="button"
          data-testid="invite-copy"
          onClick={copy}
          className="min-h-10 shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-zinc-950 active:scale-95"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <p className="text-sm text-zinc-300">
        <span className="font-semibold text-zinc-100">{memberCount}</span>{' '}
        {memberCount === 1 ? 'member' : 'members'} in this league
      </p>
    </div>
  );
}
