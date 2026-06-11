import type { ReactNode } from 'react';
import TabBar from '@/components/TabBar';
import JoinPrompt from './_components/JoinPrompt';
import { loadLeagueContext } from './_components/league-data';

export default async function LeagueLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { league, isMember } = await loadLeagueContext(slug);

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <h1 className="mx-auto w-full max-w-md text-lg font-semibold tracking-tight">
          {league.name}
        </h1>
      </header>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-28 pt-4">
        {isMember ? (
          children
        ) : (
          <JoinPrompt slug={slug} leagueName={league.name} />
        )}
      </main>
      <TabBar />
    </div>
  );
}
