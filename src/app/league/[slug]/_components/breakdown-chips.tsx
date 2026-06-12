import type { BreakdownView } from './types';
import { formatPoints } from './format';

/**
 * Shared points-breakdown chip language — the celebratory "how you scored"
 * row. Used by History's finished cards AND Today's just-finished cards so a
 * match's payoff moment reads identically on both timelines.
 */

export type ChipTone = 'score' | 'multiplier';

export function breakdownChips(
  b: BreakdownView,
): Array<{ label: string; tone: ChipTone }> {
  const chips: Array<{ label: string; tone: ChipTone }> = [];
  if (b.exact > 0)
    chips.push({ label: `Exact +${formatPoints(b.exact)}`, tone: 'score' });
  if (b.outcome > 0)
    // "Result", matching the "right result" name the live legend, the scoring
    // sheet and the Rules use for this category — never "outcome" here.
    chips.push({ label: `Result +${formatPoints(b.outcome)}`, tone: 'score' });
  if (b.scorer > 0)
    chips.push({ label: `Scorer +${formatPoints(b.scorer)}`, tone: 'score' });
  if (b.firstTeam > 0)
    chips.push({
      label: `First team +${formatPoints(b.firstTeam)}`,
      tone: 'score',
    });
  if (b.underdog > 0)
    chips.push({
      label: `Underdog +${formatPoints(b.underdog)}`,
      tone: 'score',
    });
  if (b.roundMultiplier !== 1)
    chips.push({ label: `×${b.roundMultiplier} round`, tone: 'multiplier' });
  if (b.boosterMultiplier !== 1)
    chips.push({
      label: `×${b.boosterMultiplier} booster`,
      tone: 'multiplier',
    });
  return chips;
}

export const CHIP_TONES: Record<ChipTone, string> = {
  score: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
  multiplier: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
};

/**
 * The deliberate zero statement — every zero-total finished state (no pick,
 * zero points, empty breakdown) renders this one muted chip, never a bare
 * "0 pts". Shared by History and Today so the zero reads identically.
 */
export function NoPointsChip() {
  return (
    <span className="chip bg-zinc-800/80 text-zinc-400 ring-1 ring-inset ring-white/10">
      No points this match
    </span>
  );
}

/**
 * The chip row itself (no wrapper — callers own layout/spacing). An empty
 * breakdown renders the single muted "No points this match" chip so a zero
 * still gets a deliberate statement, never a bare "0".
 */
export function BreakdownChips({ breakdown }: { breakdown: BreakdownView }) {
  const chips = breakdownChips(breakdown);
  if (chips.length === 0) {
    return <NoPointsChip />;
  }
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`chip ring-1 ring-inset ${CHIP_TONES[chip.tone]}`}
        >
          {chip.label}
        </span>
      ))}
    </>
  );
}
