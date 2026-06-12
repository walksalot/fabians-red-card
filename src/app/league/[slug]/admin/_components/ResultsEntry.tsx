'use client';

import { useState, type FormEvent } from 'react';
import { codeToFlagEmoji } from '../../_components/flags';
import {
  apiSend,
  formatKickoffEt,
  formatMatchday,
  groupByMatchday,
  matchdayOf,
  STAGE_LABELS,
  type AdminMatch,
} from './shared';
import { adminSelectCls, Chevron } from './ui';

/** App-standard compact input styling (mirrors PickForm's field system).
    min-h-10 keeps every row control at the 40px tap floor — the admin enters
    104 results from a phone, and the Save/Clear buttons beside them are 40px. */
const scoreInputCls =
  'min-h-10 w-12 rounded-xl border border-zinc-700 bg-zinc-950/60 px-1 py-1.5 text-center text-sm text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30';
// No flex-1 here: the flex shorthand would override the basis-full that puts
// the scorer input on its own row (saved names must never clip at 390px).
const textInputCls =
  'min-h-10 min-w-0 rounded-xl border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-sm text-zinc-100 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 disabled:opacity-50';

/** Compact fixture label: flag + FIFA code; full name only for TBD/placeholders. */
function TeamTag({
  name,
  code,
  align,
}: {
  name: string;
  code: string | null;
  align: 'left' | 'right';
}) {
  const flag = codeToFlagEmoji(code);
  if (!code) {
    // Knockout placeholders ("Group A runners-up") don't fit the slot sized
    // for 3-letter codes — wrap to two smaller lines instead of truncating
    // both sides to the identical "Group …".
    return (
      <span
        title={name}
        className={`line-clamp-2 min-w-0 flex-1 text-xs leading-tight text-zinc-300 ${
          align === 'right' ? 'text-right' : ''
        }`}
      >
        {name}
      </span>
    );
  }
  return (
    <span
      title={name}
      className={`flex min-w-0 flex-1 items-center gap-1.5 ${
        align === 'right' ? 'justify-end' : ''
      }`}
    >
      {align === 'left' && flag ? (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {flag}
        </span>
      ) : null}
      <span className="text-sm font-semibold uppercase tracking-wide text-zinc-100">
        {code}
      </span>
      {align === 'right' && flag ? (
        <span aria-hidden="true" className="shrink-0 text-base leading-none">
          {flag}
        </span>
      ) : null}
    </span>
  );
}

interface Props {
  matches: AdminMatch[]; // kickoff-ordered
  nowMs: number; // clock.now() from the server — never the browser clock
}

export default function ResultsEntry({ matches, nowMs }: Props) {
  if (matches.length === 0) {
    return <p className="text-sm text-zinc-400">No matches in the schedule yet.</p>;
  }
  const days = groupByMatchday(matches);
  const todayNY = matchdayOf(nowMs);
  // First matchday strictly after today — the one the admin preps next.
  const nextMatchday = days.find((d) => d.matchday > todayNY)?.matchday ?? null;
  // The day the admin acts on now: today if it has fixtures, else the next
  // matchday. Carries the #results-today anchor the sticky nav jumps to.
  const focusMatchday = days.some((d) => d.matchday === todayNY)
    ? todayNY
    : nextMatchday;
  return (
    <div className="space-y-3">
      {focusMatchday !== null ? (
        <a
          href="#results-today"
          className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-3 py-1.5 text-xs font-semibold text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          Jump to {focusMatchday === todayNY ? 'today' : 'next matchday'}
          <Chevron className="h-3 w-3 text-zinc-500" />
        </a>
      ) : null}
      {days.map((day) => {
        const finishedCount = day.matches.filter((m) => m.status === 'finished').length;
        const allFinished = finishedCount === day.matches.length;
        const isPast = day.matches.every((m) => Date.parse(m.kickoffUtc) < nowMs);
        // Open only what the admin acts on now: past days still missing results,
        // today, and the next matchday. Everything else starts collapsed.
        const defaultOpen =
          (isPast && !allFinished) ||
          day.matchday === todayNY ||
          day.matchday === nextMatchday;
        return (
          <details
            key={day.matchday}
            id={day.matchday === focusMatchday ? 'results-today' : undefined}
            open={defaultOpen}
            className="group scroll-mt-28 rounded-xl border border-zinc-800 bg-zinc-950/40"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden [&::marker]:hidden">
              <span>{formatMatchday(day.matchday)}</span>
              <span className="flex items-center gap-2">
                {/* Emerald "N/N entered ✓" marks a complete (collapsed) day —
                    the check makes "nothing left to do here" scannable. */}
                <span
                  className={`text-xs font-normal ${allFinished ? 'text-emerald-400' : 'text-zinc-500'}`}
                >
                  {finishedCount}/{day.matches.length} entered
                  {allFinished ? ' ✓' : ''}
                </span>
                <Chevron className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" />
              </span>
            </summary>
            <div className="space-y-2 px-2 pb-2">
              {day.matches.map((m) => (
                <ResultForm key={m.id} match={m} nowMs={nowMs} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function ResultForm({ match, nowMs }: { match: AdminMatch; nowMs: number }) {
  const [home, setHome] = useState(match.homeScore !== null ? String(match.homeScore) : '');
  const [away, setAway] = useState(match.awayScore !== null ? String(match.awayScore) : '');
  const [scorer, setScorer] = useState(match.firstScorer ?? '');
  // '' = unentered. Defaulting to 'home' let an admin save "first team: home"
  // without ever choosing it — every blank form looked pre-filled.
  const [firstTeam, setFirstTeam] = useState<'' | 'home' | 'away' | 'none'>(
    match.firstScoringTeam ?? '',
  );
  const [finished, setFinished] = useState(match.status === 'finished');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Last-saved field values (purely presentational): the Save/Edit button only
  // goes solid emerald once the form is dirty, so 100+ result rows don't render
  // as a wall of green. Updated on every confirmed save / clear.
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({
    home: match.homeScore !== null ? String(match.homeScore) : '',
    away: match.awayScore !== null ? String(match.awayScore) : '',
    scorer: match.firstScorer ?? '',
    firstTeam: (match.firstScoringTeam ?? '') as '' | 'home' | 'away' | 'none',
  }));

  const zeroZero =
    home.trim() !== '' && away.trim() !== '' && Number(home) === 0 && Number(away) === 0;
  // 0-0 means nobody scored: first team to score is forced to 'none'.
  const effectiveFirstTeam: '' | 'home' | 'away' | 'none' = zeroZero
    ? 'none'
    : firstTeam;

  function onScores(h: string, a: string) {
    setHome(h);
    setAway(a);
    if (h.trim() !== '' && a.trim() !== '' && Number(h) === 0 && Number(a) === 0) {
      setFirstTeam('none');
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const h = Number(home.trim());
    const a = Number(away.trim());
    if (
      home.trim() === '' ||
      away.trim() === '' ||
      !Number.isInteger(h) ||
      !Number.isInteger(a) ||
      h < 0 ||
      a < 0
    ) {
      setMsg({ kind: 'err', text: 'Enter both scores' });
      return;
    }
    // The select starts on a placeholder — goals were scored, so the admin
    // must actively say who scored first (no silent 'home' default).
    if (!zeroZero && effectiveFirstTeam === '') {
      setMsg({ kind: 'err', text: 'Pick the first team to score' });
      return;
    }
    const trimmedScorer = scorer.trim();
    setSaving(true);
    setMsg(null);
    const res = await apiSend('/api/results', 'POST', {
      matchId: match.id,
      homeScore: h,
      awayScore: a,
      firstScorer: zeroZero || trimmedScorer === '' ? null : trimmedScorer,
      firstScoringTeam: zeroZero ? 'none' : effectiveFirstTeam,
    });
    setSaving(false);
    if (res.ok) {
      setFinished(true);
      setSavedSnapshot({
        home,
        away,
        scorer,
        firstTeam: zeroZero ? 'none' : effectiveFirstTeam,
      });
      setMsg({ kind: 'ok', text: 'Saved ✓' });
      window.setTimeout(() => setMsg(null), 2500);
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  }

  // Undo path for a fat-fingered save on the wrong row: clears the result,
  // reverts the match to 'scheduled' and removes its points everywhere.
  async function onClear() {
    if (!window.confirm('Clear this result? Points for this match will be removed.')) {
      return;
    }
    setSaving(true);
    setMsg(null);
    const res = await apiSend('/api/results/clear', 'POST', { matchId: match.id });
    setSaving(false);
    if (res.ok) {
      setFinished(false);
      // Server-side the result is gone — whatever sits in the inputs is unsaved.
      setSavedSnapshot({ home: '', away: '', scorer: '', firstTeam: '' });
      setMsg({ kind: 'ok', text: 'Result cleared' });
      window.setTimeout(() => setMsg(null), 2500);
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  }

  const dirty =
    home !== savedSnapshot.home ||
    away !== savedSnapshot.away ||
    scorer !== savedSnapshot.scorer ||
    effectiveFirstTeam !== savedSnapshot.firstTeam;

  const kickedOff = Date.parse(match.kickoffUtc) <= nowMs;
  const chip = finished
    ? { text: 'FT', cls: 'bg-emerald-500/15 text-emerald-400' }
    : kickedOff
      ? // Brand red = live, everywhere — same tone as the member app's chips.
        { text: 'In play', cls: 'bg-brand/10 text-brand-bright ring-1 ring-inset ring-brand/30' }
      : { text: formatKickoffEt(match.kickoffUtc), cls: 'bg-zinc-800 text-zinc-400' };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      data-testid={`result-form-${match.id}`}
      className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
        {/* Status chips never break internally — the city truncates first. */}
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${chip.cls}`}
        >
          {chip.text}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          Match {match.id} · {STAGE_LABELS[match.stage]}
        </span>
        <span className="ml-auto min-w-0 truncate">{match.city}</span>
      </div>

      <div className="flex items-center gap-2">
        <TeamTag name={match.homeName} code={match.homeCode} align="left" />
        <input
          data-testid={`result-home-${match.id}`}
          aria-label={`${match.homeName} score`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={home}
          onChange={(e) => onScores(e.target.value, away)}
          className={scoreInputCls}
        />
        <span className="text-zinc-600">–</span>
        <input
          data-testid={`result-away-${match.id}`}
          aria-label={`${match.awayName} score`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={away}
          onChange={(e) => onScores(home, e.target.value)}
          className={scoreInputCls}
        />
        <TeamTag name={match.awayName} code={match.awayCode} align="right" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* basis-full: the scorer gets its own row so saved names never clip
            at 390px; the select + Save button form the second row. */}
        <input
          data-testid={`result-scorer-${match.id}`}
          aria-label="First goalscorer"
          type="text"
          autoComplete="off"
          placeholder="First scorer"
          value={scorer}
          onChange={(e) => setScorer(e.target.value)}
          disabled={zeroZero}
          className={`${textInputCls} basis-full`}
        />
        <span className="relative">
          <select
            data-testid={`result-firstteam-${match.id}`}
            aria-label="First team to score"
            value={effectiveFirstTeam}
            onChange={(e) => {
              if (!zeroZero) {
                setFirstTeam(e.target.value as '' | 'home' | 'away' | 'none');
              }
            }}
            className={adminSelectCls}
          >
            <option value="" disabled>
              First team to score…
            </option>
            <option value="home">First: home</option>
            <option value="away">First: away</option>
            <option value="none">First: none (0-0)</option>
          </select>
          <Chevron className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
        </span>
        <button
          type="submit"
          data-testid={`result-save-${match.id}`}
          disabled={saving}
          className={`min-h-10 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-60 ${
            dirty
              ? // Unsaved edits in this form — the one row that earns solid green.
                'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
              : 'border border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10'
          }`}
        >
          {saving ? 'Saving…' : finished ? 'Edit result' : 'Save result'}
        </button>
        {finished && (
          <button
            type="button"
            data-testid={`result-clear-${match.id}`}
            onClick={onClear}
            disabled={saving}
            className="min-h-10 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800/60 active:scale-95 disabled:opacity-60"
          >
            Clear
          </button>
        )}
        {msg && (
          <span
            className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-brand-bright'}`}
            role="status"
          >
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
