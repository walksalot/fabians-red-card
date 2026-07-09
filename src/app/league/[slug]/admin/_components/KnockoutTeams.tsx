'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  apiSend,
  formatKickoffEt,
  formatMatchday,
  STAGE_LABELS,
  type AdminMatch,
  type AdminTeam,
} from './shared';
import { adminSelectCls, Chevron } from './ui';

interface Props {
  matches: AdminMatch[]; // every r32+ match (assigned ones are correctable)
  teams: AdminTeam[]; // all 48 teams, name-sorted
}

export default function KnockoutTeams({ matches, teams }: Props) {
  // Open slots up top (the match-night job); already-assigned matches fold
  // into a corrections drawer so a mistaken assignment is never permanent.
  const open = matches.filter((m) => m.homeTeamId === null || m.awayTeamId === null);
  const assigned = matches.filter((m) => m.homeTeamId !== null && m.awayTeamId !== null);
  if (matches.length === 0) {
    return <p className="text-sm text-zinc-400">No knockout matches in the schedule.</p>;
  }
  return (
    <div className="space-y-3">
      {open.length > 0 ? (
        <>
          <p className="text-sm text-zinc-400">
            As the bracket fills in, assign the qualified teams to each knockout slot.
          </p>
          {open.map((m) => (
            <KnockoutRow key={m.id} match={m} teams={teams} />
          ))}
        </>
      ) : (
        <p className="text-sm text-zinc-400">
          All knockout matches have their teams assigned.
        </p>
      )}
      {assigned.length > 0 ? (
        <details className="group rounded-xl border border-zinc-800 bg-zinc-950/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden [&::marker]:hidden">
            <span>Assigned — correct a mistake</span>
            <span className="flex items-center gap-2">
              <span className="text-xs font-normal text-zinc-500">
                {assigned.length} match{assigned.length === 1 ? '' : 'es'}
              </span>
              <Chevron className="h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" />
            </span>
          </summary>
          <div className="space-y-2 px-2 pb-2">
            {assigned.map((m) => (
              <KnockoutRow key={m.id} match={m} teams={teams} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

const selectCls = `w-full ${adminSelectCls}`;

function KnockoutRow({ match, teams }: { match: AdminMatch; teams: AdminTeam[] }) {
  const router = useRouter();
  const [homeId, setHomeId] = useState(
    match.homeTeamId !== null ? String(match.homeTeamId) : '',
  );
  const [awayId, setAwayId] = useState(
    match.awayTeamId !== null ? String(match.awayTeamId) : '',
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save() {
    if (homeId === '' || awayId === '') {
      setMsg({ kind: 'err', text: 'Pick both teams' });
      return;
    }
    if (homeId === awayId) {
      setMsg({ kind: 'err', text: 'Teams must be different' });
      return;
    }
    setSaving(true);
    setMsg(null);
    const res = await apiSend('/api/matches/teams', 'POST', {
      matchId: match.id,
      homeTeamId: Number(homeId),
      awayTeamId: Number(awayId),
    });
    setSaving(false);
    if (res.ok) {
      setMsg({ kind: 'ok', text: 'Teams assigned ✓' });
      // Server truth changed (slots, downstream propagation, TBD states in
      // Results) — re-render the page data like the member-side forms do.
      router.refresh();
    } else setMsg({ kind: 'err', text: res.error });
  }

  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      {/* Kickoff time included (same as Results rows): cards are sorted by
          kickoff, so without it "Match 73, 76, 74, 75" reads as random. */}
      <p className="text-[11px] text-zinc-400">
        Match {match.id} · {STAGE_LABELS[match.stage]} ·{' '}
        {formatMatchday(match.matchday)} · {formatKickoffEt(match.kickoffUtc)}
      </p>
      {/* Stacked full-width selects with the slot qualifier as a label above
          each — side-by-side selects clipped "Group A runners-up" to "Group A
          rur" at 390px, and the qualifier appears nowhere else, so winners vs
          runners-up became guesswork across 32 knockout matches. */}
      <div className="space-y-2">
        <label className="block">
          <span
            title={match.homeName}
            className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
          >
            Home · {match.homeName}
          </span>
          <span className="relative block">
            <select
              data-testid={`ko-home-${match.id}`}
              aria-label={`Home team for match ${match.id} (${match.homeName})`}
              value={homeId}
              onChange={(e) => setHomeId(e.target.value)}
              className={selectCls}
            >
              <option value="">Choose team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </select>
            <Chevron className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
          </span>
        </label>
        <label className="block">
          <span
            title={match.awayName}
            className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
          >
            Away · {match.awayName}
          </span>
          <span className="relative block">
            <select
              data-testid={`ko-away-${match.id}`}
              aria-label={`Away team for match ${match.id} (${match.awayName})`}
              value={awayId}
              onChange={(e) => setAwayId(e.target.value)}
              className={selectCls}
            >
              <option value="">Choose team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </select>
            <Chevron className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`ko-save-${match.id}`}
          disabled={saving}
          onClick={save}
          // Quiet-secondary recipe (same as PickForm's "Update pick"): 20+ of
          // these stack vertically, so solid emerald stays reserved for the
          // page's real primaries (Save settings / Save result).
          className="min-h-10 rounded-xl bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-400/30 transition-colors hover:bg-emerald-400/20 active:scale-95 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Assign teams'}
        </button>
        {msg && (
          <span
            role="status"
            className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-brand-bright'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
