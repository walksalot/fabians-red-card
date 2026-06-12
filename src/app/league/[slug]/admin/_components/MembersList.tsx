'use client';

import { useState } from 'react';
import { apiSend, type AdminMember } from './shared';

interface Props {
  slug: string;
  members: AdminMember[];
  currentUserId: number;
}

export default function MembersList({ slug, members: initialMembers, currentUserId }: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Freshly generated one-time reset link, shown once per request. */
  const [resetLink, setResetLink] = useState<{ userId: number; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function onResetClick(member: AdminMember) {
    setError(null);
    setCopied(false);
    setBusyId(member.userId);
    const res = await apiSend<{ path: string }>(
      `/api/leagues/${slug}/members/${member.userId}/reset-link`,
      'POST',
    );
    setBusyId(null);
    if (res.ok) {
      setResetLink({ userId: member.userId, url: `${window.location.origin}${res.data.path}` });
    } else {
      setError(res.error);
    }
  }

  async function copyResetLink() {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink.url);
      setCopied(true);
    } catch {
      // selection fallback: the input below is selectable
    }
  }

  async function onRemoveClick(member: AdminMember) {
    setError(null);
    // First tap arms the confirm step; second tap on the same button removes.
    if (confirmId !== member.userId) {
      setConfirmId(member.userId);
      return;
    }
    setBusyId(member.userId);
    const res = await apiSend(`/api/leagues/${slug}/members/${member.userId}`, 'DELETE');
    setBusyId(null);
    setConfirmId(null);
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-brand-bright">{error}</p>}
      <ul className="divide-y divide-zinc-800">
        {members.map((m) => {
          const isYou = m.userId === currentUserId;
          const confirming = confirmId === m.userId;
          return (
            <li key={m.userId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {m.displayName}
                  {m.role === 'admin' && (
                    <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                      admin
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  @{m.username} · {m.entryCount} {m.entryCount === 1 ? 'entry' : 'entries'}
                </p>
              </div>
              {isYou ? (
                <span className="shrink-0 text-xs text-zinc-500">you</span>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    data-testid={`member-reset-${m.username}`}
                    disabled={busyId === m.userId}
                    onClick={() => onResetClick(m)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:bg-emerald-400/10 hover:text-emerald-300 active:scale-95 disabled:opacity-60"
                  >
                    Reset password
                  </button>
                  {confirming && (
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`member-remove-${m.username}`}
                    disabled={busyId === m.userId}
                    onClick={() => onRemoveClick(m)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-60 ${
                      confirming
                        ? 'bg-brand text-white'
                        : // Quiet at rest — destructive red only appears on
                          // intent (hover/confirm), not eleven times down a list.
                          'text-zinc-500 hover:bg-brand/10 hover:text-brand-bright'
                    }`}
                  >
                    {busyId === m.userId
                      ? 'Removing…'
                      : confirming
                        ? 'Confirm remove'
                        : 'Remove'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {resetLink ? (
        <div
          data-testid="reset-link-box"
          className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-3"
        >
          <p className="text-xs font-semibold text-emerald-300">
            One-time reset link for @
            {members.find((m) => m.userId === resetLink.userId)?.username ?? 'member'} — send it
            to them directly. Works once, expires in 24 hours.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={resetLink.url}
              onFocus={(e) => e.target.select()}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-300"
            />
            <button
              type="button"
              onClick={copyResetLink}
              className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-zinc-500">
        Removing a member deletes their entries, picks, boosters and points in this league.
        Reset password makes a one-time link to send them — you never see their password.
      </p>
    </div>
  );
}
