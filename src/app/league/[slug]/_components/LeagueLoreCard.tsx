import type { LeagueLore } from '@/lib/services/wrap';
import { formatPoints } from './format';

function shortDay(matchday: string): string {
  return new Date(`${matchday}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function factValue(value: number, prefix = ''): string {
  return `${prefix}${formatPoints(value)}`;
}

function namesOrCount(labels: string[]): string {
  if (labels.length <= 2) return labels.join(' & ');
  return `${labels.length} entries`;
}

/**
 * Tournament-to-date facts for the group chat. Server-rendered and read-only:
 * every number comes from matchPoints already banked by the scoring engine.
 */
export default function LeagueLoreCard({ lore }: { lore: LeagueLore }) {
  const maxPulse = Math.max(1, ...lore.pulse.map((day) => day.total));
  const biggestFixture = lore.biggestHaul
    ? lore.biggestHaul.fixtures.length === 1
      ? lore.biggestHaul.fixtures[0]
      : `${lore.biggestHaul.fixtures.length} matches`
    : null;

  const facts = [
    { id: 'exact', label: 'Perfect scores', value: factValue(lore.exactCount), tone: 'text-emerald-400' },
    { id: 'scorer', label: 'Scorer calls', value: factValue(lore.scorerHits), tone: 'text-amber-300' },
    { id: 'underdog', label: 'Underdog hits', value: factValue(lore.underdogHits), tone: 'text-brand-bright' },
    { id: 'booster', label: 'Booster lift', value: factValue(lore.boosterBonus, '+'), tone: 'text-emerald-400' },
  ];

  return (
    <section className="card overflow-hidden" data-testid="league-lore">
      <header className="border-b border-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-zinc-50">League lore</h2>
            <p className="mt-0.5 text-xs text-zinc-400">Completed matches only.</p>
          </div>
          <span className="chip bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-white/10">
            {lore.settledPicks} graded
          </span>
        </div>
      </header>

      <dl className="grid grid-cols-2 border-b border-white/5">
        {facts.map((fact, index) => (
          <div
            key={fact.label}
            className={`p-3.5 ${index % 2 === 0 ? 'border-r border-white/5' : ''} ${
              index < 2 ? 'border-b border-white/5' : ''
            }`}
          >
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              {fact.label}
            </dt>
            <dd
              data-testid={`league-lore-${fact.id}`}
              className={`mt-1 font-display text-2xl font-bold tabular-nums ${fact.tone}`}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      {lore.pulse.length > 0 ? (
        <div className="border-b border-white/5 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold text-zinc-200">League points tape</h3>
            <p className="text-[10px] text-zinc-400">
              latest {lore.pulse.length} matchday{lore.pulse.length === 1 ? '' : 's'}
            </p>
          </div>
          <ol
            aria-label="League points by recent matchday"
            className="mt-3 grid h-28 grid-flow-col auto-cols-fr items-end gap-1.5"
          >
            {lore.pulse.map((day) => {
              const isBest = Math.abs(day.total - maxPulse) < 0.000001;
              const height = day.total > 0 ? Math.max(8, (day.total / maxPulse) * 100) : 5;
              return (
                <li key={day.matchday} className="flex h-full min-w-0 flex-col items-center">
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      isBest ? 'text-emerald-300' : 'text-zinc-300'
                    }`}
                  >
                    {day.total > 0 ? `+${formatPoints(day.total)}` : '0'}
                  </span>
                  <span className="mt-1 flex min-h-0 w-full flex-1 items-end justify-center">
                    <span
                      aria-hidden="true"
                      className={`block w-full max-w-8 rounded-t-[4px] ${
                        day.total <= 0
                          ? 'bg-brand/45'
                          : isBest
                            ? 'bg-emerald-400'
                            : 'bg-zinc-600'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </span>
                  <time
                    dateTime={day.matchday}
                    className="mt-1.5 whitespace-nowrap text-[9px] font-semibold uppercase text-zinc-400"
                  >
                    {shortDay(day.matchday)}
                  </time>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div className="divide-y divide-white/5 px-4">
        {lore.biggestHaul && biggestFixture ? (
          <div className="flex items-start justify-between gap-3 py-3 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-200">Biggest single-match haul</p>
              <p className="mt-0.5 text-zinc-400">
                {namesOrCount(lore.biggestHaul.labels)} · {biggestFixture}
              </p>
            </div>
            <span className="shrink-0 font-display text-base font-bold tabular-nums text-emerald-400">
              +{formatPoints(lore.biggestHaul.points)}
            </span>
          </div>
        ) : null}

        {lore.latestLoneCall ? (
          <div className="flex items-start justify-between gap-3 py-3 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-200">Solo call</p>
              <p className="mt-0.5 text-zinc-400">
                Only <span className="text-zinc-200">{lore.latestLoneCall.label}</span> called{' '}
                <span className="score-token">{lore.latestLoneCall.fixture}</span>
              </p>
            </div>
            <span className="chip bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-white/10">
              {lore.loneCallCount} total
            </span>
          </div>
        ) : null}

        {lore.blankEntryDays > 0 ? (
          <div className="flex items-start justify-between gap-3 py-3 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-200">Cold showers</p>
              <p className="mt-0.5 text-zinc-400">Picked the day, scored nothing.</p>
            </div>
            <span className="shrink-0 font-display text-base font-bold tabular-nums text-brand-bright">
              {lore.blankEntryDays}
            </span>
          </div>
        ) : null}
      </div>

      <p className="border-t border-white/5 px-4 py-2.5 text-center text-[10px] text-zinc-400">
        {lore.settledMatches} match{lore.settledMatches === 1 ? '' : 'es'} with league picks
      </p>
    </section>
  );
}
