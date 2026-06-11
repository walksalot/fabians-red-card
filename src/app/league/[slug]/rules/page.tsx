import {
  DEFAULT_ROUND_MULTIPLIERS,
  DEFAULT_SCORING_RULES,
  type ScoringRules,
  type Stage,
} from '@/lib/scoring';
import { STAGE_LABELS, formatCents, ordinal } from '../_components/format';
import { loadLeagueContext } from '../_components/league-data';

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const STAGE_ORDER: Stage[] = ['group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-base font-semibold text-emerald-400">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-300">
        {children}
      </div>
    </section>
  );
}

export default async function RulesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await loadLeagueContext(slug);
  if (!ctx.isMember) return null; // layout renders the join prompt
  const { league } = ctx;

  const rules = parseJson<ScoringRules>(
    league.scoringRules,
    DEFAULT_SCORING_RULES,
  );
  const roundMultipliers = parseJson<Record<Stage, number>>(
    league.roundMultipliers,
    DEFAULT_ROUND_MULTIPLIERS,
  );
  const payoutSplit = parseJson<number[]>(league.payoutSplit, [60, 30, 10]);

  const scoringRows: Array<{ name: string; points: number; how: string }> = [
    {
      name: 'Exact score',
      points: rules.exact,
      how: 'Your predicted scoreline is identical to the final result.',
    },
    {
      name: 'Correct outcome',
      points: rules.outcome,
      how: 'Consolation when you were not exact but called the right result — home win, draw, or away win. Never added on top of an exact score.',
    },
    {
      name: 'First goalscorer',
      points: rules.scorer,
      how: 'You named the first player to score. Spelling, accents, capitalization, and periods are forgiven — "MBAPPE" matches "Mbappé".',
    },
    {
      name: 'First team to score',
      points: rules.firstTeam,
      how: 'You called which side scores first. Picking "No goals" counts when the match really ends 0–0.',
    },
    {
      name: 'Underdog bonus',
      points: rules.underdog,
      how: 'Only when the admin has flagged an underdog for the match: you predicted the underdog to win AND it actually won.',
    },
  ];

  return (
    <div className="space-y-4 pb-4">
      <Section title="Making picks">
        <p>
          For every match you predict three things: the <strong>exact final
          score</strong> (after 90 minutes plus stoppage time, or extra time in
          the knockouts — whatever the official result is), the{' '}
          <strong>first goalscorer</strong>, and the{' '}
          <strong>first team to score</strong>.
        </p>
        <p>
          <strong>Picks lock at kickoff.</strong> You can change a pick as
          often as you like before the match starts, but the moment it kicks
          off the pick is frozen. No pick on a match means zero points for that
          match — no exceptions, no late entries, no "my wifi died".
        </p>
      </Section>

      <Section title="Scoring">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-1 pr-2 font-semibold">Category</th>
              <th className="py-1 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {scoringRows.map((row) => (
              <tr key={row.name} className="border-t border-zinc-800 align-top">
                <td className="py-2 pr-2">
                  <p className="font-medium text-zinc-100">{row.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{row.how}</p>
                </td>
                <td className="py-2 text-right font-bold text-emerald-400">
                  {row.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-zinc-400">
          Your score for a match = (sum of the points you earned) × round
          multiplier × booster multiplier (if you boosted that match).
        </p>
      </Section>

      <Section title="The booster">
        <p>
          You get <strong>one booster per matchday</strong>. Place it on a
          match and every point you earn there is multiplied by{' '}
          <strong>×{league.boosterMultiplier}</strong>.
        </p>
        <p>
          You can move the booster to a different match on the same matchday as
          long as the match currently holding it has not kicked off. Once your
          boosted match kicks off, the booster is locked in for that day —
          choose wisely.
        </p>
      </Section>

      <Section title="Round multipliers">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-zinc-500">
              <th className="py-1 pr-2 font-semibold">Round</th>
              <th className="py-1 text-right font-semibold">Multiplier</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_ORDER.map((stage) => (
              <tr key={stage} className="border-t border-zinc-800">
                <td className="py-1.5 pr-2">{STAGE_LABELS[stage]}</td>
                <td className="py-1.5 text-right font-semibold text-zinc-100">
                  ×{roundMultipliers[stage] ?? 1}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Tiebreakers">
        <p>When entries are level, ties are broken in this order:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Most total points</li>
          <li>Most exact scores</li>
          <li>Most first-goalscorer hits</li>
          <li>
            Earliest pick submission — whoever last saved a pick earlier wins
            the tie. Decisiveness pays.
          </li>
        </ol>
      </Section>

      <Section title="Prize pool">
        <p>
          Buy-in is{' '}
          <strong>{formatCents(league.buyInCents, league.currency)}</strong>{' '}
          per entry. The pool is the buy-in multiplied by the number of
          entries, paid out as:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {payoutSplit.map((percent, i) => (
            <li key={i}>
              <strong>{ordinal(i + 1)} place</strong> — {percent}% of the pool
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-400">
          The pool is tracked here for bragging rights only — money changes
          hands in person, not through this app.
        </p>
      </Section>
    </div>
  );
}
