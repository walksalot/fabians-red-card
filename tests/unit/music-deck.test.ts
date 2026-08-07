// Deck integrity. The music game's whole premise is that the year printed on a card is
// the truth, so these assertions are less about code and more about guarding the data:
// a duplicate, a bad genre or a decade that disagrees with its year would quietly make
// the game unfair rather than crash it.
import { describe, expect, it } from 'vitest';
import { DECADES, DECK, GENRES, filterDeck } from '../../public/music/deck.js';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Apostrophes vanish rather than becoming separators, so "Ain't That a Shame"
    // slugs to `aint-that-a-shame` and not the unreadable `ain-t-that-a-shame`.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

describe('deck data', () => {
  it('is big enough to run several games without repeats', () => {
    // 8 players x 10 cards, plus the misses they will make along the way.
    expect(DECK.length).toBeGreaterThanOrEqual(200);
  });

  it('has unique ids', () => {
    const ids = DECK.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives every id from its own artist and title', () => {
    for (const c of DECK) {
      expect(c.id, `${c.artist} - ${c.title}`).toBe(`${slug(c.artist)}-${slug(c.title)}`);
    }
  });

  it('never lists the same song twice', () => {
    const keys = DECK.map((c) => `${slug(c.artist)}|${slug(c.title)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every year inside the recorded-music era', () => {
    for (const c of DECK) {
      expect(c.year, c.id).toBeGreaterThanOrEqual(1950);
      expect(c.year, c.id).toBeLessThanOrEqual(2025);
      expect(Number.isInteger(c.year), c.id).toBe(true);
    }
  });

  it('keeps decade consistent with year', () => {
    for (const c of DECK) {
      expect(c.decade, c.id).toBe(Math.floor(c.year / 10) * 10);
    }
  });

  it('only uses genres the setup screen offers as filter chips', () => {
    for (const c of DECK) expect(GENRES, c.id).toContain(c.genre);
  });

  it('never leans on one artist — three cards is the cap', () => {
    const counts = new Map<string, number>();
    for (const c of DECK) {
      const key = slug(c.artist);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const offenders = [...counts.entries()].filter(([, n]) => n > 3);
    expect(offenders).toEqual([]);
  });

  it('spreads across the decades so a timeline is actually placeable', () => {
    const perDecade = new Map<number, number>();
    for (const c of DECK) perDecade.set(c.decade, (perDecade.get(c.decade) ?? 0) + 1);
    // A player holding only 1960s and 1970s cards cannot make an interesting guess;
    // every decade the filter chips advertise has to be genuinely stocked.
    for (const decade of DECADES) {
      expect(perDecade.get(decade) ?? 0, `${decade}s`).toBeGreaterThanOrEqual(10);
    }
    expect(DECADES.length).toBeGreaterThanOrEqual(6);
  });

  it('advertises exactly the decades it stocks', () => {
    expect([...DECADES].sort((a, b) => a - b)).toEqual(
      [...new Set(DECK.map((c) => c.decade))].sort((a, b) => a - b),
    );
  });
});

describe('filterDeck', () => {
  it('treats empty filters as "everything" — that is what no chips selected means', () => {
    expect(filterDeck(DECK)).toHaveLength(DECK.length);
    expect(filterDeck(DECK, {})).toHaveLength(DECK.length);
    expect(filterDeck(DECK, { decades: [], genres: [] })).toHaveLength(DECK.length);
  });

  it('filters on decade', () => {
    const out = filterDeck(DECK, { decades: [1980] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.decade === 1980)).toBe(true);
  });

  it('filters on genre', () => {
    const out = filterDeck(DECK, { genres: ['rock'] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.genre === 'rock')).toBe(true);
  });

  it('intersects the two axes rather than unioning them', () => {
    const out = filterDeck(DECK, { decades: [1980, 1990], genres: ['pop'] });
    expect(out.every((c) => c.genre === 'pop' && (c.decade === 1980 || c.decade === 1990))).toBe(
      true,
    );
  });

  it('returns nothing for an impossible combination instead of throwing', () => {
    expect(filterDeck(DECK, { decades: [1950], genres: ['hiphop'] })).toEqual([]);
  });

  it('does not mutate the deck it was handed', () => {
    const before = DECK.length;
    filterDeck(DECK, { decades: [1970] });
    expect(DECK.length).toBe(before);
  });
});
