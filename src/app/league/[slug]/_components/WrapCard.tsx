import { formatMatchdayShort, formatPoints } from './format';

/**
 * Matchday Wrap — the day's recap card (server-rendered). One hero line
 * (day winner) over a strictly numeric fact rail, closed by the whole
 * league's day at a glance as a tiny bar strip. Read-side only.
 */

export interface WrapCardView {
  matchday: string;
  matchCount: number;
  entryCount: number;
  winners: Array<{ label: string; total: number }>;
  /** Top single-match haul: every holder (ties are common), 1+ fixtures. */
  biggest: { labels: string[]; points: number; fixtures: string[] } | null;
  exactCount: number;
  blankedCount: number;
  soleCalls: Array<{ label: string; fixture: string }>;
  /** Every entry's day total, descending — the bar strip. */
  bars: number[];
}

function RowIcon({ kind }: { kind: 'burst' | 'bone' | 'target' | 'ice' }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'burst':
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </svg>
      );
    case 'bone':
      return (
        <svg {...common}>
          <path d="M7 10a2.5 2.5 0 1 1 2-4 2.5 2.5 0 1 1 4 2l-2 2 2 2a2.5 2.5 0 1 1-4 2 2.5 2.5 0 1 1-2-4l1-1Z" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case 'ice':
      return (
        <svg {...common}>
          <path d="M12 3v18M5 6.5l14 11M19 6.5l-14 11" />
        </svg>
      );
  }
}

export default function WrapCard({ wrap }: { wrap: WrapCardView }) {
  const max = wrap.bars[0] ?? 0;
  return (
    <div className="card p-4" data-testid={`wrap-${wrap.matchday}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Matchday wrap · {formatMatchdayShort(wrap.matchday)}
        </p>
        <span className="chip bg-zinc-800/80 text-zinc-300 ring-1 ring-inset ring-white/10">
          {wrap.matchCount} {wrap.matchCount === 1 ? 'match' : 'matches'}
        </span>
      </div>

      {wrap.winners.length > 0 ? (
        <div className="flex items-center gap-3 border-b border-white/5 pb-3">
          <span aria-hidden="true" className="text-2xl leading-none">
            🏆
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold text-zinc-50">
              {wrap.winners.map((w) => w.label).join(' & ')}
            </p>
            <p className="text-xs text-zinc-400">
              {wrap.winners.length > 1 ? 'shared the day' : 'won the day'}
            </p>
          </div>
          <p className="shrink-0 font-display text-xl font-bold tabular-nums text-emerald-400">
            +{formatPoints(wrap.winners[0].total)}
          </p>
        </div>
      ) : (
        <p className="border-b border-white/5 pb-3 text-sm text-zinc-400">
          Nobody scored — the day beat the whole league.
        </p>
      )}

      <div className="space-y-0.5 pt-1">
        {wrap.biggest ? (
          <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
            <span className="w-5 shrink-0 text-center text-zinc-400">
              <RowIcon kind="burst" />
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-400">
              Biggest haul —{' '}
              <span className="font-semibold text-zinc-100">
                {/* Ties are the norm (a popular exact score pays everyone the
                    same), so name one, name two, or count the crowd — echoing
                    the hero line's "shared the day" voice. */}
                {wrap.biggest.labels.length <= 2
                  ? wrap.biggest.labels.join(' & ')
                  : `shared by ${wrap.biggest.labels.length}`}
              </span>{' '}
              on{' '}
              {wrap.biggest.fixtures.length === 1 ? (
                <span className="score-token">{wrap.biggest.fixtures[0]}</span>
              ) : (
                `${wrap.biggest.fixtures.length} games`
              )}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-zinc-200">
              +{formatPoints(wrap.biggest.points)}
            </span>
          </div>
        ) : null}
        {wrap.soleCalls.slice(0, 2).map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1.5 text-[13px]">
            <span className="w-5 shrink-0 text-center text-zinc-400">
              <RowIcon kind="bone" />
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-400">
              Only <span className="font-semibold text-zinc-100">{s.label}</span> called{' '}
              <span className="score-token">{s.fixture}</span>
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
          <span className="w-5 shrink-0 text-center text-zinc-400">
            <RowIcon kind="target" />
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-400">Exact scores landed</span>
          <span className="shrink-0 font-bold tabular-nums text-zinc-200">{wrap.exactCount}</span>
        </div>
        {wrap.blankedCount > 0 ? (
          <div className="flex items-center gap-2.5 py-1.5 text-[13px]">
            <span className="w-5 shrink-0 text-center text-zinc-400">
              <RowIcon kind="ice" />
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-400">Blanked the whole day</span>
            <span className="shrink-0 font-bold tabular-nums text-zinc-200">
              {wrap.blankedCount} of {wrap.entryCount}
            </span>
          </div>
        ) : null}
      </div>

      {max > 0 ? (
        <>
          <div className="mt-2 flex h-10 items-end gap-[3px]" aria-hidden="true">
            {wrap.bars.map((v, i) => (
              <span
                key={i}
                className={`min-h-[2px] flex-1 rounded-t-[3px] ${
                  i === 0
                    ? 'bg-emerald-400'
                    : v > 0
                      ? 'bg-emerald-400/25'
                      : 'bg-white/10'
                }`}
                style={{ height: `${v > 0 ? Math.max(8, (v / max) * 100) : 5}%` }}
              />
            ))}
          </div>
          <p className="mt-1 text-center text-[10px] text-zinc-500">
            everyone&apos;s day, best → quietest
          </p>
        </>
      ) : null}
    </div>
  );
}
