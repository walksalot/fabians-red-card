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
      {error && <p className="text-sm text-red-400">{error}</p>}
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
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold active:scale-95 disabled:opacity-60 ${
                      confirming
                        ? 'bg-red-500 text-white'
                        : 'border border-red-500/40 text-red-400'
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
      <p className="text-xs text-zinc-500">
        Removing a member deletes their entries, picks, boosters and points in this league.
      </p>
    </div>
  );
}
