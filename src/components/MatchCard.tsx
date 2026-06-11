'use client';

import { useState, type FormEvent } from 'react';
import type { PointsBreakdown } from '@/lib/scoring';
import { Badge } from './Badge';
import { Countdown, LocalKickoff } from './Countdown';
import { ScoreInput } from './ScoreInput';
import { errorMessage } from './client-api';

export type FirstTeam = 'home' | 'away' | 'none';

export interface MatchCardMatch {
  id: number;
  stage: string;
  groupLetter?: string | null;
  homePlaceholder?: string | null;
  awayPlaceholder?: string | null;
  kickoffUtc: string;
  matchday: string;
  venue?: string;
  city?: string;
  status: string; // 'scheduled' | 'finished'
  homeScore?: number | null;
  awayScore?: number | null;
  firstScorer?: string | null;
  firstScoringTeam?: string | null; // 'home' | 'away' | 'none'
}

export interface MatchCardTeam {
  id?: number;
  name: string;
  code?: string;
}

export interface MatchCardPick {
  predHome: number;
  predAway: number;
  predScorer: string | null;
  predFirstTeam: FirstTeam | null;
}

export interface MatchCardProps {
  match: MatchCardMatch;
  teams: { home: MatchCardTeam | null; away: MatchCardTeam | null };
  pick: MatchCardPick | null;
  locked: boolean;
  /** This entry's matchday booster sits on this match. */
  boosted: boolean;
  /** Booster cannot be (re)assigned (e.g. previous boosted match already kicked off). */
  boosterDisabled?: boolean;
  /** My points breakdown — pass when the match is finished and a pick existed. */
  points?: PointsBreakdown | null;
  onSave?: (pick: MatchCardPick) => void | Promise<void>;
  onToggleBooster?: () => void | Promise<void>;
}

const STAGE_LABELS: Record<string, string> = {
  group: 'Group stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  third: 'Third place',
  final: 'Final',
};

function stageLabel(match: MatchCardMatch): string {
  if (match.stage === 'group' && match.groupLetter) {
    return `Group ${match.groupLetter}`;
  }
  return STAGE_LABELS[match.stage] ?? match.stage;
}

function teamName(
  team: MatchCardTeam | null,
  placeholder: string | null | undefined,
  fallback: string,
): string {
  return team?.name ?? placeholder ?? fallback;
}

function firstTeamLabel(
  value: string | null | undefined,
  homeName: string,
  awayName: string,
): string | null {
  if (value === 'home') return homeName;
  if (value === 'away') return awayName;
  if (value === 'none') return 'No goals';
  return null;
}

function PickSummary({
  pick,
  homeName,
  awayName,
}: {
  pick: MatchCardPick;
  homeName: string;
  awayName: string;
}) {
  const parts: string[] = [`${pick.predHome}–${pick.predAway}`];
  if (pick.predScorer) parts.push(`Scorer: ${pick.predScorer}`);
  const ft = firstTeamLabel(pick.predFirstTeam, homeName, awayName);
  if (ft) parts.push(`First: ${ft}`);
  return (
    <p className="text-sm text-zinc-400">
      <span className="text-zinc-500">Your pick</span>{' '}
      <span className="font-medium text-zinc-200">{parts.join(' · ')}</span>
    </p>
  );
}

function Breakdown({ points }: { points: PointsBreakdown }) {
  const rows: Array<[string, number]> = [
    ['Exact score', points.exact],
    ['Outcome', points.outcome],
    ['First scorer', points.scorer],
    ['First team', points.firstTeam],
    ['Underdog', points.underdog],
  ];
  const hasMultiplier =
    points.roundMultiplier !== 1 || points.boosterMultiplier !== 1;
  return (
    <div className="mt-3 rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between">
            <dt className="text-zinc-400">{label}</dt>
            <dd
              className={`tabular-nums ${
                value > 0 ? 'font-semibold text-emerald-400' : 'text-zinc-600'
              }`}
            >
              +{value}
            </dd>
          </div>
        ))}
      </dl>
      {hasMultiplier ? (
        <p className="mt-2 text-xs text-zinc-500">
          ×{points.roundMultiplier} round · ×{points.boosterMultiplier} booster
        </p>
      ) : null}
      <div className="mt-2 flex items-baseline justify-between border-t border-zinc-800 pt-2">
        <span className="text-sm font-medium text-zinc-300">Points</span>
        <span
          className={`text-lg font-bold tabular-nums ${
            points.total > 0 ? 'text-emerald-400' : 'text-zinc-500'
          }`}
        >
          {points.total}
        </span>
      </div>
    </div>
  );
}

export function MatchCard({
  match,
  teams,
  pick,
  locked,
  boosted,
  boosterDisabled,
  points,
  onSave,
  onToggleBooster,
}: MatchCardProps) {
  const homeName = teamName(teams.home, match.homePlaceholder, 'Home');
  const awayName = teamName(teams.away, match.awayPlaceholder, 'Away');
  const finished = match.status === 'finished';

  const [home, setHome] = useState(pick ? String(pick.predHome) : '');
  const [away, setAway] = useState(pick ? String(pick.predAway) : '');
  const [scorer, setScorer] = useState(pick?.predScorer ?? '');
  const [firstTeam, setFirstTeam] = useState<FirstTeam | ''>(
    pick?.predFirstTeam ?? '',
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  );
  const [boosterBusy, setBoosterBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function touch() {
    if (saveState === 'saved') setSaveState('idle');
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saveState === 'saving') return;
    setError(null);
    const predHome = Number(home);
    const predAway = Number(away);
    if (
      home.trim() === '' ||
      away.trim() === '' ||
      !Number.isInteger(predHome) ||
      !Number.isInteger(predAway) ||
      predHome < 0 ||
      predHome > 20 ||
      predAway < 0 ||
      predAway > 20
    ) {
      setError('Enter both scores (0–20).');
      return;
    }
    setSaveState('saving');
    try {
      await onSave?.({
        predHome,
        predAway,
        predScorer: scorer.trim() === '' ? null : scorer.trim(),
        predFirstTeam: firstTeam === '' ? null : firstTeam,
      });
      setSaveState('saved');
    } catch (err) {
      setError(errorMessage(err));
      setSaveState('idle');
    }
  }

  async function handleBooster() {
    if (!onToggleBooster || boosterBusy) return;
    setError(null);
    setBoosterBusy(true);
    try {
      await onToggleBooster();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBoosterBusy(false);
    }
  }

  const resultFirstTeam = firstTeamLabel(
    match.firstScoringTeam,
    homeName,
    awayName,
  );

  return (
    <article className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
      {/* Header: stage + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          {stageLabel(match)}
        </span>
        <span className="flex items-center gap-2">
          {boosted ? <Badge>2× Booster</Badge> : null}
          {finished ? (
            <Badge tone="zinc">Full time</Badge>
          ) : locked ? (
            <Badge tone="red">In progress</Badge>
          ) : (
            <Countdown kickoffUtc={match.kickoffUtc} />
          )}
        </span>
      </div>

      {/* Teams + score */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-100">
          {homeName}
        </span>
        <span className="shrink-0 text-center">
          {finished ? (
            <span className="text-2xl font-bold text-zinc-100 tabular-nums">
              {match.homeScore}–{match.awayScore}
            </span>
          ) : (
            <span className="text-sm font-medium text-zinc-500">vs</span>
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-base font-semibold text-zinc-100">
          {awayName}
        </span>
      </div>

      {/* Meta: kickoff (viewer-local) + venue */}
      <p className="mt-1.5 text-xs text-zinc-500">
        <LocalKickoff iso={match.kickoffUtc} />
        {match.venue ? ` · ${match.venue}` : ''}
        {match.city ? `, ${match.city}` : ''}
      </p>

      {finished ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-zinc-400">
            First goal:{' '}
            <span className="font-medium text-zinc-200">
              {match.firstScoringTeam === 'none'
                ? 'none (0–0)'
                : (match.firstScorer ?? 'unknown')}
              {match.firstScoringTeam !== 'none' && resultFirstTeam
                ? ` (${resultFirstTeam})`
                : ''}
            </span>
          </p>
          {pick ? (
            <PickSummary pick={pick} homeName={homeName} awayName={awayName} />
          ) : (
            <p className="text-sm text-red-400">No pick made.</p>
          )}
          {pick && points ? <Breakdown points={points} /> : null}
        </div>
      ) : locked ? (
        <div className="mt-3 space-y-2">
          {pick ? (
            <PickSummary pick={pick} homeName={homeName} awayName={awayName} />
          ) : (
            <p className="text-sm text-red-400">Locked — no pick made.</p>
          )}
          <p className="text-xs text-zinc-500">
            Picks are locked at kickoff.
          </p>
        </div>
      ) : (
        <form
          data-testid={`pick-form-${match.id}`}
          onSubmit={handleSubmit}
          className="mt-4 space-y-3"
        >
          <div className="flex items-end justify-center gap-3">
            <ScoreInput
              label={homeName}
              testId="pick-home"
              value={home}
              onChange={(v) => {
                setHome(v);
                touch();
              }}
            />
            <span className="pb-4 text-lg text-zinc-600">–</span>
            <ScoreInput
              label={awayName}
              testId="pick-away"
              value={away}
              onChange={(v) => {
                setAway(v);
                touch();
              }}
            />
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              First goalscorer (optional)
            </span>
            <input
              data-testid="pick-scorer"
              type="text"
              value={scorer}
              onChange={(e) => {
                setScorer(e.target.value);
                touch();
              }}
              placeholder="e.g. Mbappé"
              className="h-12 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              First team to score (optional)
            </span>
            <select
              data-testid="pick-first-team"
              value={firstTeam}
              onChange={(e) => {
                setFirstTeam(e.target.value as FirstTeam | '');
                touch();
              }}
              className="h-12 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-zinc-100 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">No prediction</option>
              <option value="home">{homeName}</option>
              <option value="away">{awayName}</option>
              <option value="none">No goals (0–0)</option>
            </select>
          </label>

          <button
            type="button"
            data-testid="booster-toggle"
            aria-pressed={boosted}
            onClick={handleBooster}
            disabled={!onToggleBooster || boosterDisabled || boosterBusy}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold transition-colors disabled:opacity-50 ${
              boosted
                ? 'border-emerald-400 bg-emerald-400/10 text-emerald-400'
                : 'border-zinc-700 bg-zinc-950 text-zinc-300'
            }`}
          >
            {boosted ? '2× Booster on this match' : 'Use 2× Booster here'}
          </button>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            data-testid="pick-save"
            disabled={saveState === 'saving'}
            className="h-12 w-full rounded-xl bg-emerald-400 font-semibold text-zinc-950 transition-transform active:scale-[.99] disabled:opacity-50"
          >
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : 'Save pick'}
          </button>
        </form>
      )}
    </article>
  );
}

export default MatchCard;
