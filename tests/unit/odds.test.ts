import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  americanToProb,
  athleteIdFromRef,
  devig,
  formatPct,
  oddsForDisplay,
  parsePropBetsPage,
  parseScoreboardOdds,
} from '@/lib/odds';

const T = 1781300000000;

describe('americanToProb', () => {
  it('converts positive and negative american odds', () => {
    expect(americanToProb('+100')).toBeCloseTo(0.5, 5);
    expect(americanToProb('-100')).toBeCloseTo(0.5, 5);
    expect(americanToProb('+255')).toBeCloseTo(100 / 355, 5);
    expect(americanToProb('-110')).toBeCloseTo(110 / 210, 5);
    expect(americanToProb(320)).toBeCloseTo(100 / 420, 5);
  });
  it('rejects garbage', () => {
    expect(americanToProb('EVEN-ish')).toBeNull();
    expect(americanToProb(null)).toBeNull();
    expect(americanToProb('')).toBeNull();
  });
});

describe('devig', () => {
  it('normalizes to sum 1', () => {
    const out = devig([0.5238, 0.2899, 0.2381]); // -110 / +245 / +320 raw
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });
  it('equal legs split evenly', () => {
    const out = devig([0.5, 0.5, 0.5]);
    expect(out).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });
});

describe('parseScoreboardOdds (real captured payloads)', () => {
  const events = JSON.parse(
    readFileSync('tests/fixtures/espn-odds-20260612.json', 'utf8'),
  ) as Array<{ shortName: string; odds: unknown }>;

  it('parses every pre-match event completely with coherent probabilities', () => {
    for (const e of events) {
      const parsed = parseScoreboardOdds(e.odds, T);
      expect(parsed, e.shortName).not.toBeNull();
      const p = parsed!;
      expect(p.provider).toBe('DraftKings');
      expect(p.homeML).toMatch(/^[+-]\d+$/);
      expect(p.drawML).toMatch(/^[+-]\d+$/);
      expect(p.awayML).toMatch(/^[+-]\d+$/);
      expect(p.homeProb + p.drawProb + p.awayProb).toBeCloseTo(1, 10);
      expect(p.homeProb).toBeGreaterThan(0);
      expect(p.awayProb).toBeGreaterThan(0);
      expect(p.updatedAtMs).toBe(T);
    }
  });

  it('hosts are favored over their group-stage opponents in the captured data', () => {
    // June 12: Canada and USA both at home as clear favorites — a sanity check
    // that home/away legs aren't swapped in our parsing.
    for (const e of events) {
      const p = parseScoreboardOdds(e.odds, T)!;
      expect(p.homeProb, e.shortName).toBeGreaterThan(p.awayProb);
    }
  });

  it('returns null for knockout TBD slots (odds: [null])', () => {
    const ko = JSON.parse(
      readFileSync('tests/fixtures/espn-odds-knockout-tbd.json', 'utf8'),
    ) as { odds: unknown };
    expect(parseScoreboardOdds(ko.odds, T)).toBeNull();
  });

  it('returns null when a moneyline leg is missing', () => {
    expect(
      parseScoreboardOdds(
        [{ provider: { name: 'X' }, moneyline: { home: { close: { odds: '-110' } } } }],
        T,
      ),
    ).toBeNull();
  });

  it('falls back to the opening line when close is absent', () => {
    const p = parseScoreboardOdds(
      [
        {
          provider: { name: 'X' },
          moneyline: {
            home: { open: { odds: '+105' } },
            draw: { open: { odds: '+255' } },
            away: { close: { odds: '+320' } },
          },
        },
      ],
      T,
    );
    expect(p?.homeML).toBe('+105');
    expect(p?.awayML).toBe('+320');
  });
});

describe('parsePropBetsPage (real captured page)', () => {
  it('extracts first-goalscorer prices with athlete refs', () => {
    const page = JSON.parse(readFileSync('tests/fixtures/espn-propbets-page.json', 'utf8'));
    const items = parsePropBetsPage(page);
    expect(items.length).toBeGreaterThan(20);
    for (const it of items.slice(0, 5)) {
      expect(it.athleteRef).toContain('/athletes/');
      expect(it.american).toMatch(/^[+-]\d+$/);
      expect(athleteIdFromRef(it.athleteRef)).toMatch(/^\d+$/);
    }
  });
  it('is safe on garbage', () => {
    expect(parsePropBetsPage(null)).toEqual([]);
    expect(parsePropBetsPage({ items: 'nope' })).toEqual([]);
  });
});

describe('formatPct', () => {
  it('rounds for display', () => {
    expect(formatPct(0.557)).toBe('56%');
    expect(formatPct(0.185)).toBe('19%');
  });
});

describe('oddsForDisplay (server-side display gate)', () => {
  const FRESH_MS = 6 * 3600_000;
  const odds = { homeML: '-140', drawML: '+260', awayML: '+400' };
  const row = { oddsJson: JSON.stringify(odds), oddsUpdatedAt: T };

  it('returns parsed odds for an unlocked match with a fresh snapshot', () => {
    const out = oddsForDisplay(row, { nowMs: T + 1000, locked: false, freshMs: FRESH_MS });
    expect(out).toMatchObject(odds);
  });

  it('returns null for a locked match even when the snapshot is fresh', () => {
    // Regression: locked matches never render an odds strip, so their line
    // must not ship inside the serialized RSC payload either.
    expect(
      oddsForDisplay(row, { nowMs: T + 1000, locked: true, freshMs: FRESH_MS }),
    ).toBeNull();
  });

  it('returns null once the snapshot is older than freshMs', () => {
    expect(
      oddsForDisplay(row, { nowMs: T + FRESH_MS + 1, locked: false, freshMs: FRESH_MS }),
    ).toBeNull();
    // exactly at the boundary still counts as fresh
    expect(
      oddsForDisplay(row, { nowMs: T + FRESH_MS, locked: false, freshMs: FRESH_MS }),
    ).not.toBeNull();
  });

  it('returns null for absent or malformed stored rows', () => {
    const opts = { nowMs: T, locked: false, freshMs: FRESH_MS };
    expect(oddsForDisplay({ oddsJson: null, oddsUpdatedAt: T }, opts)).toBeNull();
    expect(oddsForDisplay({ oddsJson: '{}', oddsUpdatedAt: null }, opts)).toBeNull();
    expect(oddsForDisplay({ oddsJson: '{not json', oddsUpdatedAt: T }, opts)).toBeNull();
  });
});
