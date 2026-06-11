import type { ReactNode } from 'react';
import Link from 'next/link';
import { RedCardMark } from '@/components/Brand';
import TabBar from '@/components/TabBar';
import { getLeaderboard } from '@/lib/services/leaderboard';
import JoinPrompt from './_components/JoinPrompt';
import PasswordJoinForm from './_components/PasswordJoinForm';
import { MEDAL_TEXT_TONES, formatPoints, ordinal } from './_components/format';
import { loadLeagueContext } from './_components/league-data';

export default async function LeagueLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { db, league, isMember, isAdmin, entries } = await loadLeagueContext(slug);
  const needsPassword = !isMember && league.joinPasswordHash !== null;

  // Glanceable identity for the header's right half: the member's rank +
  // points on every screen (first entry — the common single-entry case).
  const myEntryId = entries[0]?.id;
  const mine =
    isMember && myEntryId !== undefined
      ? (getLeaderboard(db, league.id).find((r) => r.entryId === myEntryId) ??
        null)
      : null;

  // Two-tone wordmark treatment: first word muted, the rest bright — the same
  // logo feel the auth screens use ("Fabian's" + "Red Card").
  const spaceAt = league.name.indexOf(' ');
  const nameLead = spaceAt > 0 ? league.name.slice(0, spaceAt) : null;
  const nameRest = spaceAt > 0 ? league.name.slice(spaceAt + 1) : league.name;

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      {/* Top inset keeps the wordmark clear of notches/status bars when the
          app is installed to the home screen (viewport-fit=cover is set). */}
      <header
        className="sticky top-0 z-20 border-b border-white/5 bg-zinc-950/80 px-4 pb-3 backdrop-blur-xl"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="mx-auto flex w-full max-w-md items-center gap-2.5">
          <RedCardMark className="h-6 w-6 shrink-0 drop-shadow-[0_2px_8px_rgba(229,72,77,0.4)]" />
          <h1 className="truncate font-display text-lg tracking-tight">
            {nameLead ? (
              <>
                <span className="font-medium text-zinc-400">{nameLead}</span>{' '}
              </>
            ) : null}
            <span className="font-bold text-zinc-50">{nameRest}</span>
          </h1>
          {/* "Where am I, how many points" without leaving the screen. */}
          {mine ? (
            <Link
              href={`/league/${slug}/profile`}
              aria-label={`You are ${ordinal(mine.rank)} with ${formatPoints(mine.total)} points — open profile`}
              className="ml-auto flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-zinc-900 px-2.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ring-white/10 transition-all duration-150 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 active:scale-95"
            >
              {/* Podium places carry their medal tint onto every screen. */}
              <span className={MEDAL_TEXT_TONES[mine.rank] ?? 'text-zinc-300'}>
                {ordinal(mine.rank)}
              </span>
              <span aria-hidden="true" className="text-zinc-400">
                ·
              </span>
              <span className="text-emerald-400">
                {formatPoints(mine.total)} pts
              </span>
            </Link>
          ) : null}
          {/* The commissioner's door — only the league admin sees it. */}
          {isAdmin ? (
            <Link
              href={`/league/${slug}/admin`}
              data-testid="header-admin"
              aria-label="Open the Admin panel"
              className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand/15 px-2.5 text-[11px] font-bold text-brand-bright ring-1 ring-inset ring-brand/40 transition-all duration-150 hover:bg-brand/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 active:scale-95 ${mine ? '' : 'ml-auto'}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
              Admin
            </Link>
          ) : null}
        </div>
        {/* Brand-red hairline carries the card identity onto every screen. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent"
        />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-28 pt-4">
        {isMember ? (
          children
        ) : needsPassword ? (
          <PasswordJoinForm slug={slug} leagueName={league.name} />
        ) : (
          <JoinPrompt slug={slug} leagueName={league.name} />
        )}
      </main>
      <TabBar />
    </div>
  );
}
