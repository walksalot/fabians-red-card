'use client';

import { useState } from 'react';
import { apiSend, STAGE_LABELS, type AdminMatch, type AdminTeam } from './shared';

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

const selectCls =
  'min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none';

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
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-[11px] text-zinc-500">
        M{match.id} · {STAGE_LABELS[match.stage]} · {match.matchday}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid={`ko-home-${match.id}`}
          aria-label={`Home team for match ${match.id}`}
          value={homeId}
          onChange={(e) => setHomeId(e.target.value)}
          className={selectCls}
        >
          <option value="">{match.homeName}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.code})
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-600">vs</span>
        <select
          data-testid={`ko-away-${match.id}`}
          aria-label={`Away team for match ${match.id}`}
          value={awayId}
          onChange={(e) => setAwayId(e.target.value)}
          className={selectCls}
        >
          <option value="">{match.awayName}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.code})
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`ko-save-${match.id}`}
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 active:scale-95 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Assign teams'}
        </button>
        {msg && (
          <span
            role="status"
            className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
