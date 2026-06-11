'use client';

import { useRef, useState, type FormEvent } from 'react';
import {
  apiSend,
  STAGES,
  STAGE_LABELS,
  type LeagueSettings,
  type StageKey,
} from './shared';

const SCORING_FIELDS = [
  { key: 'exact', label: 'Exact score' },
  { key: 'outcome', label: 'Correct outcome' },
  { key: 'scorer', label: 'First goalscorer' },
  { key: 'firstTeam', label: 'First team to score' },
  { key: 'underdog', label: 'Underdog bonus' },
] as const;
type ScoringKey = (typeof SCORING_FIELDS)[number]['key'];

interface Toast {
  kind: 'ok' | 'err';
  text: string;
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none';
const numCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none';
const labelCls = 'block text-xs font-medium uppercase tracking-wide text-zinc-400';

export default function SettingsForm({
  slug,
  settings,
}: {
  slug: string;
  settings: LeagueSettings;
}) {
  const [name, setName] = useState(settings.name);
  const [isPrivate, setIsPrivate] = useState(settings.isPrivate);
  const [hasPassword, setHasPassword] = useState(settings.hasJoinPassword);
  const [joinPassword, setJoinPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [entries, setEntries] = useState(String(settings.entriesPerUser));
  const [buyIn, setBuyIn] = useState((settings.buyInCents / 100).toFixed(2));
  const [payout, setPayout] = useState<string[]>(() => {
    const split = [...settings.payoutSplit];
    while (split.length < 3) split.push(0);
    return split.map(String);
  });
  const [autoSync, setAutoSync] = useState(settings.autoSyncEnabled);
  const [booster, setBooster] = useState(String(settings.boosterMultiplier));
  const [rounds, setRounds] = useState<Record<StageKey, string>>(() => {
    const r = {} as Record<StageKey, string>;
    for (const s of STAGES) r[s] = String(settings.roundMultipliers[s]);
    return r;
  });
  const [scoring, setScoring] = useState<Record<ScoringKey, string>>(() => ({
    exact: String(settings.scoringRules.exact),
    outcome: String(settings.scoringRules.outcome),
    scorer: String(settings.scoringRules.scorer),
    firstTeam: String(settings.scoringRules.firstTeam),
    underdog: String(settings.scoringRules.underdog),
  }));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);

  function showToast(t: Toast) {
    setToast(t);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }

  // Live payout-split validation
  const splitFilled = payout.every((p) => p.trim() !== '');
  const splitNums = payout.map((p) => Number(p));
  const splitValid =
    splitFilled && splitNums.every((n) => Number.isInteger(n) && n >= 0);
  const splitSum = splitValid ? splitNums.reduce((a, b) => a + b, 0) : NaN;
  const splitOk = splitValid && splitSum === 100;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedName = name.trim();
    const entriesNum = Number(entries.trim());
    const buyInNum = Number(buyIn.trim());
    const boosterNum = Number(booster.trim());

    if (trimmedName === '') return showToast({ kind: 'err', text: 'League name is required' });
    if (!Number.isInteger(entriesNum) || entriesNum < 1 || entriesNum > 10)
      return showToast({ kind: 'err', text: 'Entries per user must be 1–10' });
    if (!Number.isFinite(buyInNum) || buyInNum < 0)
      return showToast({ kind: 'err', text: 'Buy-in must be a non-negative amount' });
    if (!splitOk)
      return showToast({ kind: 'err', text: 'Payout split must be whole percents summing to 100' });
    if (!Number.isFinite(boosterNum) || boosterNum <= 0)
      return showToast({ kind: 'err', text: 'Booster multiplier must be greater than 0' });

    const roundMultipliers = {} as Record<StageKey, number>;
    for (const s of STAGES) {
      const n = Number(rounds[s].trim());
      if (!Number.isFinite(n) || n <= 0)
        return showToast({ kind: 'err', text: `${STAGE_LABELS[s]} multiplier must be greater than 0` });
      roundMultipliers[s] = n;
    }

    const scoringRules = {} as Record<ScoringKey, number>;
    for (const f of SCORING_FIELDS) {
      const n = Number(scoring[f.key].trim());
      if (!Number.isFinite(n) || n < 0)
        return showToast({ kind: 'err', text: `${f.label} points must be 0 or more` });
      scoringRules[f.key] = n;
    }

    const body: Record<string, unknown> = {
      name: trimmedName,
      isPrivate,
      entriesPerUser: entriesNum,
      buyInCents: Math.round(buyInNum * 100),
      payoutSplit: splitNums,
      boosterMultiplier: boosterNum,
      roundMultipliers,
      scoringRules,
      autoSyncEnabled: autoSync,
    };
    if (clearPassword) body.joinPassword = null;
    else if (joinPassword.trim() !== '') body.joinPassword = joinPassword;

    setSaving(true);
    const res = await apiSend(`/api/leagues/${slug}/settings`, 'PATCH', body);
    setSaving(false);
    if (!res.ok) return showToast({ kind: 'err', text: res.error });

    if (clearPassword) setHasPassword(false);
    else if (joinPassword.trim() !== '') setHasPassword(true);
    setJoinPassword('');
    setClearPassword(false);
    showToast({ kind: 'ok', text: 'Settings saved — points recomputed' });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      {/* League basics */}
      <div className="space-y-1.5">
        <label htmlFor="admin-name" className={labelCls}>
          League name
        </label>
        <input
          id="admin-name"
          data-testid="admin-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
      </div>

      <label className="flex items-center gap-3 text-sm text-zinc-200">
        <input
          data-testid="admin-private"
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        Private league (invite link or password required)
      </label>

      {/* Join password */}
      <div className="space-y-1.5">
        <label htmlFor="admin-password" className={labelCls}>
          Join password
        </label>
        <input
          id="admin-password"
          data-testid="admin-password"
          type="text"
          autoComplete="off"
          placeholder={hasPassword ? 'Set a new password' : 'Set a password (optional)'}
          value={joinPassword}
          onChange={(e) => setJoinPassword(e.target.value)}
          disabled={clearPassword}
          className={`${inputCls} disabled:opacity-50`}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">
            {hasPassword ? 'A join password is currently set.' : 'No join password set.'}
          </p>
          {hasPassword && (
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(e) => setClearPassword(e.target.checked)}
                className="h-3.5 w-3.5 accent-red-500"
              />
              Clear password
            </label>
          )}
        </div>
      </div>

      {/* Entries + buy-in */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="admin-entries" className={labelCls}>
            Entries per user
          </label>
          <input
            id="admin-entries"
            data-testid="admin-entries"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            step={1}
            value={entries}
            onChange={(e) => setEntries(e.target.value)}
            className={numCls}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="admin-buyin" className={labelCls}>
            Buy-in ({settings.currency} $)
          </label>
          <input
            id="admin-buyin"
            data-testid="admin-buyin"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={buyIn}
            onChange={(e) => setBuyIn(e.target.value)}
            className={numCls}
          />
        </div>
      </div>

      {/* Payout split */}
      <div className="space-y-1.5">
        <span className={labelCls}>Payout split (%)</span>
        <div className="flex flex-wrap items-center gap-2">
          {payout.map((p, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                data-testid="admin-payout"
                aria-label={`Place ${i + 1} percent`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={p}
                onChange={(e) =>
                  setPayout(payout.map((x, j) => (j === i ? e.target.value : x)))
                }
                className="w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
              />
              {payout.length > 3 && (
                <button
                  type="button"
                  aria-label={`Remove place ${i + 1}`}
                  onClick={() => setPayout(payout.filter((_, j) => j !== i))}
                  className="rounded px-1 text-zinc-500 hover:text-red-400"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPayout([...payout, '0'])}
            className="rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300"
          >
            + place
          </button>
        </div>
        <p className={`text-xs ${splitOk ? 'text-emerald-400' : 'text-red-400'}`}>
          {splitValid
            ? splitOk
              ? 'Total: 100% ✓'
              : `Total: ${splitSum}% — must sum to 100`
            : 'Enter whole percents in every field'}
        </p>
      </div>

      {/* Automatic results */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
        <label className="flex items-start gap-3 text-sm text-zinc-200">
          <input
            data-testid="admin-autosync"
            type="checkbox"
            checked={autoSync}
            onChange={(e) => setAutoSync(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-500"
          />
          <span>
            Automatic results
            <span className="mt-0.5 block text-xs font-normal text-zinc-500">
              Fill final scores &amp; first scorer from the live feed automatically.
              Anything you enter by hand always wins and is never overwritten.
            </span>
          </span>
        </label>
      </div>

      {/* Multipliers */}
      <div className="space-y-1.5">
        <span className={labelCls}>Booster multiplier</span>
        <input
          data-testid="admin-booster"
          aria-label="Booster multiplier"
          type="number"
          inputMode="decimal"
          min={1}
          step="any"
          value={booster}
          onChange={(e) => setBooster(e.target.value)}
          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-sm text-zinc-100 focus:border-emerald-400 focus:outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <span className={labelCls}>Round multipliers</span>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {STAGES.map((s) => (
            <label key={s} className="space-y-1 text-center">
              <span className="block text-[11px] text-zinc-500">{STAGE_LABELS[s]}</span>
              <input
                data-testid={`admin-round-${s}`}
                aria-label={`${STAGE_LABELS[s]} multiplier`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={rounds[s]}
                onChange={(e) => setRounds({ ...rounds, [s]: e.target.value })}
                className={numCls}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Scoring */}
      <div className="space-y-1.5">
        <span className={labelCls}>Points</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SCORING_FIELDS.map((f) => (
            <label key={f.key} className="space-y-1 text-center">
              <span className="block text-[11px] text-zinc-500">{f.label}</span>
              <input
                data-testid={`admin-points-${f.key}`}
                aria-label={`${f.label} points`}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={scoring[f.key]}
                onChange={(e) => setScoring({ ...scoring, [f.key]: e.target.value })}
                className={numCls}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-zinc-500">
          Changing points or multipliers recomputes everyone&apos;s scores automatically.
        </p>
      </div>

      <button
        type="submit"
        data-testid="admin-save"
        disabled={saving}
        className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 active:scale-[0.99] disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg ${
            toast.kind === 'ok' ? 'bg-emerald-500 text-zinc-950' : 'bg-red-500 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}
    </form>
  );
}
