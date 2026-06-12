'use client';

import { useState } from 'react';
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
  matches: AdminMatch[]; // r32+ matches that still have a placeholder side
  teams: AdminTeam[]; // all 48 teams, name-sorted
}

export default function KnockoutTeams({ matches, teams }: Props) {
  if (matches.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        All knockout matches have their teams assigned.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        As the bracket fills in, assign the qualified teams to each knockout slot.
      </p>
      {matches.map((m) => (
        <KnockoutRow key={m.id} match={m} teams={teams} />
      ))}
    </div>
  );
}

const selectCls = `w-full ${adminSelectCls}`;

function KnockoutRow({ match, teams }: { match: AdminMatch; teams: AdminTeam[] }) {
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
    if (res.ok) setMsg({ kind: 'ok', text: 'Teams assigned ✓' });
    else setMsg({ kind: 'err', text: res.error });
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
