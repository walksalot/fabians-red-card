import {
  DEFAULT_ROUND_MULTIPLIERS,
  DEFAULT_SCORING_RULES,
  type ScoringRules,
  type Stage,
} from '@/lib/scoring';
import { UNDERDOG_PROB_MAX } from '@/lib/sync/espn-sync';
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
    <section className="card p-4">
      <h2 className="text-base font-bold tracking-tight text-zinc-50">
        {title}
      </h2>
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
      name: 'Right result',
      points: rules.outcome,
      how: 'Consolation when you were not exact but called the right result — home win, draw, or away win. Never added on top of an exact score.',
    },
    {
      name: 'First goalscorer',
      points: rules.scorer,
      how: 'You named the first player to score — picked from one of the two squads. Spelling, accents, capitalization, and periods are forgiven ("MBAPPE" matches "Mbappé"), but it has to be the full name from the list.',
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
      {/* Same screen-header recipe as Today/History day headers — every league
          tab opens with an eyebrow over a bold title. */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
          How scoring works
        </p>
        <h2 className="font-display text-lg font-bold tracking-tight text-zinc-50">
          Rules
        </h2>
      </div>
      <Section title="Making picks">
        <p>
          For every match you predict three things: the <strong>exact final
          score</strong> (after 90 minutes plus stoppage time, or extra time in
          the knockouts — whatever the official result is), the{' '}
          <strong>first goalscorer</strong>, and the{' '}
          <strong>first team to score</strong>.
        </p>
        <p>
          <strong>Penalty shootouts don&rsquo;t count.</strong> A knockout tie
          that goes to penalties scores as the draw it was after extra time:
          shootout kicks never change the scoreline, the first goalscorer, or
          the first team to score — the shootout only decides who advances in
          the bracket.
        </p>
        <p>
          <strong>Picks lock at kickoff.</strong>{' '}
          You can change a pick as
          often as you like before the match starts — editing never affects
          tiebreaks, so tweak away — but the moment it kicks
          off the pick is frozen. No pick on a match means zero points for that
          match — no exceptions, no late entries, no &ldquo;my wifi
          died&rdquo;.
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
              <tr key={row.name} className="border-t border-white/5 align-top">
                <td className="py-2.5 pr-3">
                  <p className="font-semibold text-zinc-100">{row.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                    {row.how}
                  </p>
                </td>
                <td className="py-2.5 text-right">
                  <span className="inline-flex min-w-9 items-center justify-center rounded-lg bg-emerald-400/10 px-2 py-1 text-sm font-bold tabular-nums text-emerald-300 ring-1 ring-inset ring-emerald-400/25">
                    {row.points}
                  </span>
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
          match and every point you earn there counts{' '}
          <strong>×{league.boosterMultiplier}</strong>.
        </p>
        <p>
          You can move the booster to a different match on the same matchday —
          or remove it entirely — any time until the match currently holding it
          kicks off or has a result, whichever comes first. Last-minute moves
          are allowed and fair game. Once your boosted match kicks off (or its
          result is in), the booster is locked in for that day.
        </p>
      </Section>

      <Section title="Round multipliers">
        {STAGE_ORDER.every((stage) => (roundMultipliers[stage] ?? 1) === 1) ? (
          <p>
            Every round counts the same in this league — no stage multipliers
            (×1 across the board).
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-1 pr-2 font-semibold">Round</th>
                <th className="py-1 text-right font-semibold">Multiplier</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.map((stage) => (
                <tr key={stage} className="border-t border-white/5">
                  <td className="py-1.5 pr-2">{STAGE_LABELS[stage]}</td>
                  <td
                    className={`py-1.5 text-right font-semibold tabular-nums ${
                      (roundMultipliers[stage] ?? 1) !== 1
                        ? 'text-amber-300'
                        : 'text-zinc-400'
                    }`}
                  >
                    ×{roundMultipliers[stage] ?? 1}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Tiebreakers">
        {/* Points can never break a tie between entries that are LEVEL on
            points — listing it first contradicted the premise. */}
        <p>When entries are level on points, ties are broken in this order:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Most exact scores</li>
          <li>Most first-goalscorer hits</li>
          <li>Most correct outcomes (win/draw/loss)</li>
        </ol>
        <p>
          Still tied after all three? That&apos;s a genuine tie — tied players
          share the spot and split its prize money. No timestamps, no
          who-clicked-first.
        </p>
      </Section>

      <Section title="Prize pool">
        {league.buyInCents === 0 ? (
          // Mirror the Table's free-league special case — walking through
          // $0 × entries × payout percentages reads as a calculation bug and
          // contradicts the "Free league" card one tab over.
          <p>
            This is a free league — no buy-in, no pool. You&apos;re playing
            for bragging rights only.
          </p>
        ) : (
          <>
            <p>
              Buy-in is{' '}
              <strong>{formatCents(league.buyInCents, league.currency)}</strong>{' '}
              per entry. The pool is the buy-in multiplied by the number of
              entries, paid out as:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {payoutSplit.map((percent, i) => (
                <li key={i}>
                  <strong>{ordinal(i + 1)} place</strong> — {percent}% of the
                  pool
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-400">
              The pool is tracked here for bragging rights only — money
              changes hands in person, not through this app.
            </p>
          </>
        )}
      </Section>

      <Section title="Quick answers">
        <dl className="space-y-3">
          <div>
            <dt className="font-semibold text-zinc-100">
              Can I move or remove my booster?
            </dt>
            <dd className="mt-0.5 text-zinc-400">
              Yes — tap the armed booster to remove it, or tap another match
              that day to move it, any time until the boosted match kicks off
              or has a result (whichever comes first). Last-minute moves are
              allowed and fair game. A booster only multiplies points you
              earn — it can never cost you anything.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">
              Is there a penalty for wrong guesses?
            </dt>
            <dd className="mt-0.5 text-zinc-400">
              Never. Wrong scores, scorers, or first-team picks just earn zero
              for that part — points are never taken away.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">
              What if I skip the scorer or first-team pick?
            </dt>
            <dd className="mt-0.5 text-zinc-400">
              They&apos;re optional. Leaving them blank only skips those bonus
              points for that match.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">
              Do scorer names need exact spelling?
            </dt>
            <dd className="mt-0.5 text-zinc-400">
              Your scorer must be a player from one of the two squads — pick a
              name from the list. Spelling, accents, capitalization and periods
              are still forgiven, but bare last names no longer count: one word
              matching three Martínezes was a loophole, closed 2026-06-12.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">
              Who decides the underdog?
            </dt>
            <dd className="mt-0.5 text-zinc-400">
              {league.autoUnderdogEnabled !== 0
                ? `The betting odds do — a side with a win chance of ${Math.round(UNDERDOG_PROB_MAX * 100)}% or less is auto-flagged, and the flag freezes at kickoff.`
                : 'The admin flags underdogs by hand (none are flagged automatically right now).'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-zinc-100">
              How do results get entered?
            </dt>
            <dd className="mt-0.5 text-zinc-400">
              Automatically, as matches finish. The admin can correct anything
              by hand, and corrections recalculate everyone&apos;s points
              instantly.
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
