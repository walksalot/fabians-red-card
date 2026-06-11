import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getSessionUser } from '@/lib/session';
import { nowMs } from '@/lib/clock';
import InviteBox from './_components/InviteBox';
import SettingsForm from './_components/SettingsForm';
import MembersList from './_components/MembersList';
import ResultsEntry from './_components/ResultsEntry';
import KnockoutTeams from './_components/KnockoutTeams';
import UnderdogPicker from './_components/UnderdogPicker';
import type {
  AdminMatch,
  AdminMember,
  AdminTeam,
  LeagueSettings,
  ScoringRulesShape,
  StageKey,
} from './_components/shared';

export const dynamic = 'force-dynamic';

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_ROUNDS: Record<StageKey, number> = {
  group: 1,
  r32: 1,
  r16: 1,
  qf: 1,
  sf: 1,
  third: 1,
  final: 1,
};

const DEFAULT_SCORING: ScoringRulesShape = {
  exact: 10,
  outcome: 2,
  scorer: 8,
  firstTeam: 2,
  underdog: 5,
};

export default async function AdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();
  const user = await getSessionUser(db);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/league/${slug}/admin`)}`);

  const league = db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.slug, slug))
    .get();
  if (!league) redirect('/');

  const membership = db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.leagueId, league.id),
        eq(schema.memberships.userId, user.id),
      ),
    )
    .get();
  const isAdmin = league.adminUserId === user.id || membership?.role === 'admin';
  if (!isAdmin) redirect(`/league/${slug}/today`);

  // --- Members (with usernames for member-remove-<username> testids) ---
  const memberRows = db
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.leagueId, league.id))
    .orderBy(asc(schema.memberships.createdAt))
    .all();

  const entryRows = db
    .select({ userId: schema.entries.userId })
    .from(schema.entries)
    .where(eq(schema.entries.leagueId, league.id))
    .all();
  const entryCounts = new Map<number, number>();
  for (const e of entryRows) {
    entryCounts.set(e.userId, (entryCounts.get(e.userId) ?? 0) + 1);
  }

  const members: AdminMember[] = memberRows.map((m) => ({
    userId: m.userId,
    username: m.username,
    displayName: m.displayName,
    role: m.role,
    entryCount: entryCounts.get(m.userId) ?? 0,
  }));

  // --- Matches + teams ---
  const teamRows = db.select().from(schema.teams).orderBy(asc(schema.teams.name)).all();
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const teamsList: AdminTeam[] = teamRows.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
  }));

  const matchRows = db
    .select()
    .from(schema.matches)
    .orderBy(asc(schema.matches.kickoffUtc), asc(schema.matches.id))
    .all();

  const adminMatches: AdminMatch[] = matchRows.map((m) => ({
    id: m.id,
    stage: m.stage as StageKey,
    matchday: m.matchday,
    kickoffUtc: m.kickoffUtc,
    venue: m.venue,
    city: m.city,
    status: m.status as AdminMatch['status'],
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeName:
      m.homeTeamId !== null
        ? (teamById.get(m.homeTeamId)?.name ?? 'TBD')
        : (m.homePlaceholder ?? 'TBD'),
    awayName:
      m.awayTeamId !== null
        ? (teamById.get(m.awayTeamId)?.name ?? 'TBD')
        : (m.awayPlaceholder ?? 'TBD'),
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    firstScorer: m.firstScorer,
    firstScoringTeam: m.firstScoringTeam as AdminMatch['firstScoringTeam'],
    underdogTeamId: m.underdogTeamId,
  }));

  const knockoutMatches = adminMatches.filter(
    (m) => m.stage !== 'group' && (m.homeTeamId === null || m.awayTeamId === null),
  );
  const underdogMatches = adminMatches.filter(
    (m) => m.homeTeamId !== null && m.awayTeamId !== null,
  );

  // --- Settings payload (never the password hash or invite token internals) ---
  const settings: LeagueSettings = {
    name: league.name,
    isPrivate: league.isPrivate !== 0,
    hasJoinPassword: league.joinPasswordHash !== null,
    entriesPerUser: league.entriesPerUser,
    buyInCents: league.buyInCents,
    currency: league.currency,
    payoutSplit: parseJson<number[]>(league.payoutSplit, [60, 30, 10]),
    scoringRules: {
      ...DEFAULT_SCORING,
      ...parseJson<Partial<ScoringRulesShape>>(league.scoringRules, {}),
    },
    boosterMultiplier: league.boosterMultiplier,
    roundMultipliers: {
      ...DEFAULT_ROUNDS,
      ...parseJson<Partial<Record<StageKey, number>>>(league.roundMultipliers, {}),
    },
    autoSyncEnabled: league.autoSyncEnabled !== 0,
  };

  const now = nowMs();

  return (
    <main className="min-h-dvh bg-zinc-950 pb-24 text-zinc-100">
      <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Admin
          </p>
          <h1 className="text-2xl font-bold">{league.name}</h1>
          <Link
            href={`/league/${slug}/today`}
            className="inline-block text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            ← Back to Today
          </Link>
        </header>

        <section className="rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Invite</h2>
          <InviteBox inviteToken={league.inviteToken} memberCount={members.length} />
        </section>

        <section className="rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Settings</h2>
          <SettingsForm slug={slug} settings={settings} />
        </section>

        <section className="rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Members</h2>
          <MembersList slug={slug} members={members} currentUserId={user.id} />
        </section>

        <section className="rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Results</h2>
          <ResultsEntry matches={adminMatches} nowMs={now} />
        </section>

        <section className="rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Knockout teams</h2>
          <KnockoutTeams matches={knockoutMatches} teams={teamsList} />
        </section>

        <section className="rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Underdog</h2>
          <UnderdogPicker
            matches={underdogMatches}
            underdogPoints={settings.scoringRules.underdog}
            nowMs={now}
          />
        </section>
      </div>
    </main>
  );
}
