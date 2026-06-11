import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { AchievementBadge } from '@/components/Badge';
import { RedCardMark } from '@/components/Brand';
import Monogram from '@/components/Monogram';
import { getEntryStats, getLeaderboard } from '@/lib/services/leaderboard';
import EntrySwitcher from '../_components/EntrySwitcher';
import LogoutButton from '../_components/LogoutButton';
import { MEDAL_TONES, formatPoints, ordinal } from '../_components/format';
import {
  loadLeagueContext,
  pickSelectedEntry,
} from '../_components/league-data';
import type {
  EntryStatsView,
  LeaderboardRowView,
} from '../_components/types';

type StatIconKind =
  | 'target'
  | 'boot'
  | 'check'
  | 'percent'
  | 'flame'
  | 'trophy'
  | 'pencil'
  | 'calendar';

function StatIcon({ kind }: { kind: StatIconKind }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'boot': // football
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8.2 15.6 10.8 14.2 15H9.8L8.4 10.8Z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M4.5 12.5 10 18 19.5 6.5" />
        </svg>
      );
    case 'percent':
      return (
        <svg {...common}>
          <path d="M19 5 5 19" />
          <circle cx="7" cy="7" r="2.5" />
          <circle cx="17" cy="17" r="2.5" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...common}>
          <path d="M12 3c1 3-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-1-3s3 1 3 4.5A6.5 6.5 0 0 1 12 20a6.5 6.5 0 0 1-6-6.5C6 8 11 7 12 3Z" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...common}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
          <path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4" />
          <path d="M12 13v4M8.5 20h7" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...common}>
          <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path d="m13.5 6.5 3 3" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
        </svg>
      );
  }
}

interface StatDef {
  label: string;
  value: string;
  icon: StatIconKind;
  accent: string;
}

/**
 * One stat cell inside the consolidated stats card — hairline dividers do the
 * grouping, so the cell itself carries no ring/gradient of its own.
 */
function StatCell({ stat, className }: { stat: StatDef; className: string }) {
  return (
    <div className={`p-3 ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className={stat.accent}>
          <StatIcon kind={stat.icon} />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          {stat.label}
        </p>
      </div>
      <p className="mt-1.5 text-xl font-extrabold tabular-nums text-zinc-50">
        {stat.value}
      </p>
    </div>
  );
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ entry?: string | string[] }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { db, league, user, entries } = ctx;

  const entry = pickSelectedEntry(entries, sp.entry);
  if (!entry) {
    return (
      <p className="text-zinc-400">No entry found for you in this league.</p>
    );
  }

  const stats = (await getEntryStats(db, entry.id)) as EntryStatsView;
  const rows = (await getLeaderboard(db, league.id)) as LeaderboardRowView[];
  const mine = rows.find((r) => r.entryId === entry.id);
  const finishedMatches = db
    .select()
    .from(schema.matches)
    .where(eq(schema.matches.status, 'finished'))
    .all();
  const finishedTotal = finishedMatches.length;

  // Recent form: this entry's points per finished matchday (last 5 days) —
  // the same day-subtotal History shows, compressed into scannable chips.
  const myPoints = db
    .select()
    .from(schema.matchPoints)
    .where(eq(schema.matchPoints.entryId, entry.id))
    .all();
  const dayOfMatch = new Map(finishedMatches.map((m) => [m.id, m.matchday]));
  const subtotalByDay = new Map<string, number>();
  for (const m of finishedMatches) {
    if (!subtotalByDay.has(m.matchday)) subtotalByDay.set(m.matchday, 0);
  }
  for (const p of myPoints) {
    const day = dayOfMatch.get(p.matchId);
    if (day === undefined) continue;
    subtotalByDay.set(day, (subtotalByDay.get(day) ?? 0) + p.total);
  }
  const formDays = [...subtotalByDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(-5)
    .map(([matchday, subtotal]) => ({ matchday, subtotal }));
  const formDayLabel = (matchday: string) =>
    new Date(`${matchday}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  // Emerald intensity scales with the day's haul so a +40 day visibly
  // outshines a +2 day; 0-point days stay muted zinc.
  const formChipTone = (subtotal: number) =>
    subtotal <= 0
      ? 'bg-zinc-800/60 text-zinc-500 ring-white/10'
      : subtotal < 10
        ? 'bg-emerald-400/[0.07] text-emerald-300/80 ring-emerald-400/15'
        : subtotal < 25
          ? 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30'
          : 'bg-emerald-400/25 text-emerald-200 ring-emerald-400/45';

  const rankTone = mine
    ? (MEDAL_TONES[mine.rank] ?? 'bg-zinc-800/80 text-zinc-300 ring-white/10')
    : null;

  return (
    <div className="space-y-4">
      {entries.length > 1 && (
        <EntrySwitcher
          entries={entries.map((e) => ({ id: e.id, label: e.label }))}
          currentId={entry.id}
        />
      )}

      {/* Hero: identity on the left, points on the right, red-card watermark behind */}
      <div className="card relative animate-fade-slide-in overflow-hidden p-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-5 -top-7 opacity-[0.09]"
        >
          <RedCardMark className="h-36 w-36 rotate-[14deg]" />
        </div>
        <div className="relative flex items-center gap-3">
          <Monogram name={user.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-zinc-50">
              {user.displayName}
              {entry.label !== user.displayName ? (
                <span className="font-medium text-zinc-400">
                  {' '}
                  · {entry.label}
                </span>
              ) : null}
            </p>
            {mine && rankTone ? (
              <span
                className={`chip mt-1 ring-1 ring-inset ${rankTone}`}
              >
                {ordinal(mine.rank)} of {rows.length}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-4xl font-bold tabular-nums leading-none tracking-tight text-emerald-400">
              {formatPoints(stats.total)}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              points
            </p>
          </div>
        </div>
      </div>

      {/* One surface for all eight stats: hairline-divided 2-col grid keeps
          the icon accents but drops eight separate rings/gradients — the page
          now reads as four objects (hero, stats, form, badges). Performance
          stats lead; bookkeeping (picks made / coverage) sits last.
          Accent discipline: emerald = scoring stats, amber = streaks/accuracy,
          brand red only for the current-streak flame. No off-palette hues. */}
      <div
        className="card grid animate-fade-slide-in grid-cols-2 overflow-hidden"
        style={{ animationDelay: '60ms' }}
      >
        {(
          [
            {
              label: 'Exact scores',
              value: String(stats.exactCount),
              icon: 'target',
              accent: 'text-emerald-400',
            },
            {
              label: 'Scorer hits',
              value: String(stats.scorerHits),
              icon: 'boot',
              accent: 'text-emerald-400',
            },
            {
              label: 'Outcomes',
              value: String(mine?.outcomeCount ?? 0),
              icon: 'check',
              accent: 'text-emerald-400',
            },
            {
              label: 'Accuracy',
              value: `${Math.round(stats.accuracyPct)}%`,
              icon: 'percent',
              accent: 'text-amber-300',
            },
            {
              label: 'Current streak',
              value: String(stats.currentStreak),
              icon: 'flame',
              accent: 'text-brand-bright',
            },
            {
              label: 'Best streak',
              value: String(stats.bestStreak),
              icon: 'trophy',
              accent: 'text-amber-300',
            },
            {
              label: 'Picks made',
              value: String(stats.picksMade),
              icon: 'pencil',
              accent: 'text-zinc-400',
            },
            {
              label: 'Matches covered',
              value: `${stats.finishedPicked}/${finishedTotal}`,
              icon: 'calendar',
              accent: 'text-emerald-400',
            },
          ] satisfies StatDef[]
        ).map((stat, i, all) => (
          <StatCell
            key={stat.label}
            stat={stat}
            // Hairline dividers, not per-tile rings: right edge on the left
            // column, bottom edge on every row but the last.
            className={`${i % 2 === 0 ? 'border-r border-white/5' : ''} ${
              i < all.length - 2 ? 'border-b border-white/5' : ''
            }`}
          />
        ))}
      </div>

      {formDays.length > 0 ? (
        <Link
          href={`/league/${slug}/history`}
          className="card block p-4 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 active:scale-[.99]"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              Recent form
            </h2>
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-zinc-400">
              History
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {formDays.map((d) => (
              <span
                key={d.matchday}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <span
                  className={`flex h-9 w-full items-center justify-center rounded-lg text-sm font-bold tabular-nums ring-1 ring-inset ${formChipTone(d.subtotal)}`}
                >
                  {d.subtotal > 0 ? `+${formatPoints(d.subtotal)}` : '0'}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {formDayLabel(d.matchday)}
                </span>
              </span>
            ))}
          </div>
        </Link>
      ) : null}

      <div className="card p-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
          Badges
        </h2>
        {stats.badges.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {stats.badges.map((badge, i) => (
              <AchievementBadge key={badge} name={badge} delayMs={i * 70} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            No badges yet — keep picking.
          </p>
        )}
      </div>

      <LogoutButton />
    </div>
  );
}
