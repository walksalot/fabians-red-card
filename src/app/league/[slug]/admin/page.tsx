import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getSessionUser } from '@/lib/session';
import { nowMs } from '@/lib/clock';
import { UNDERDOG_PROB_MAX } from '@/lib/sync/espn-sync';
import InviteBox from './_components/InviteBox';
import SettingsForm from './_components/SettingsForm';
import MembersList from './_components/MembersList';
import ResultsEntry from './_components/ResultsEntry';
import KnockoutTeams from './_components/KnockoutTeams';
import UnderdogPicker from './_components/UnderdogPicker';
import { matchdayOf } from './_components/shared';
import type {
  AdminMatch,
  AdminMember,
  AdminTeam,
  LeagueSettings,
  ScoringRulesShape,
  StageKey,
} from './_components/shared';

/** Shared section-card recipe; scroll-mt clears the app header + sticky nav. */
const sectionCls = 'scroll-mt-28 rounded-2xl bg-zinc-900 p-4';

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
    homeCode:
      m.homeTeamId !== null ? (teamById.get(m.homeTeamId)?.code ?? null) : null,
    awayCode:
      m.awayTeamId !== null ? (teamById.get(m.awayTeamId)?.code ?? null) : null,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homePens: m.homePens,
    awayPens: m.awayPens,
    firstScorer: m.firstScorer,
    firstScoringTeam: m.firstScoringTeam as AdminMatch['firstScoringTeam'],
    underdogTeamId: m.underdogTeamId,
  }));

  // ALL knockout slots, assigned ones included — an admin must be able to
  // CORRECT a wrong assignment (the form previously hid a match the moment
  // both teams were set, making mistakes permanent).
  const knockoutMatches = adminMatches.filter((m) => m.stage !== 'group');
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
    autoUnderdogEnabled: league.autoUnderdogEnabled !== 0,
  };

  const now = nowMs();

  // "Results" jumps straight to today's (or the next) matchday accordion when
  // the tournament still has days ahead; otherwise it lands on the section.
  const todayNY = matchdayOf(now);
  const hasResultsFocus = adminMatches.some((m) => m.matchday >= todayNY);
  const sectionLinks = [
    { href: '#invite', label: 'Invite' },
    { href: '#settings', label: 'Settings' },
    { href: '#members', label: 'Members' },
    { href: hasResultsFocus ? '#results-today' : '#results', label: 'Results' },
    // "Knockouts", matching the section's "Knockout teams" heading — the old
    // "Fixtures" chip jumped to a section with a different name.
    { href: '#fixtures', label: 'Knockouts' },
    { href: '#underdog', label: 'Underdog' },
  ];

  return (
    // No own <main>/px-4/max-w wrapper — the league layout owns the shell;
    // doubling it doubled the gutters and the <main> landmark.
    <div className="space-y-5">
        <header className="space-y-1">
          {/* Shared screen-header recipe (Rules/Bracket): eyebrow over a
              display-face title. */}
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            Admin
          </p>
          <h1 className="font-display text-lg font-bold tracking-tight text-zinc-50">
            {league.name}
          </h1>
          <Link
            href={`/league/${slug}/today`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-800/60 px-3.5 text-xs font-semibold text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
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
              <path d="M19 12H5m6-7-7 7 7 7" />
            </svg>
            Back to Today
          </Link>
        </header>

        {/* Sticky section nav: the admin page is one long scroll — these chips
            anchor-jump to each block, sitting just below the app header. */}
        <nav
          aria-label="Admin sections"
          className="sticky top-[52px] z-10 -mx-4 border-b border-white/5 bg-zinc-950/85 px-4 py-2 backdrop-blur-xl"
        >
          {/* The scrollbar is hidden, so the right-edge fade is the affordance
              that more sections exist off-screen; pr-8 lets the last pill
              scroll clear of the mask. */}
          <div className="relative">
            <div className="flex gap-1.5 overflow-x-auto pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sectionLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  // before: pseudo-element lifts the 28px pill to the ~44px
                  // tap floor without growing the visual (layout.tsx's rank
                  // chip recipe).
                  className="relative shrink-0 whitespace-nowrap rounded-full bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  {l.label}
                </a>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-zinc-950"
            />
          </div>
        </nav>

        <section id="invite" className={sectionCls}>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Invite</h2>
          <InviteBox inviteToken={league.inviteToken} memberCount={members.length} />
        </section>

        <section id="settings" className={sectionCls}>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Settings</h2>
          <SettingsForm
            slug={slug}
            settings={settings}
            underdogPctMax={Math.round(UNDERDOG_PROB_MAX * 100)}
          />
        </section>

        <section id="members" className={sectionCls}>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Members</h2>
          <MembersList slug={slug} members={members} currentUserId={user.id} />
        </section>

        <section id="results" className={sectionCls}>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Results</h2>
          <ResultsEntry matches={adminMatches} nowMs={now} />
        </section>

        <section id="fixtures" className={sectionCls}>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Knockout teams</h2>
          <KnockoutTeams matches={knockoutMatches} teams={teamsList} />
        </section>

        <section id="underdog" className={sectionCls}>
          <h2 className="mb-3 text-base font-semibold text-zinc-100">Underdog</h2>
          <UnderdogPicker
            matches={underdogMatches}
            underdogPoints={settings.scoringRules.underdog}
            nowMs={now}
          />
        </section>
    </div>
  );
}
