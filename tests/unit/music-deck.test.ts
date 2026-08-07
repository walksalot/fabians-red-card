// Deck integrity. The music game's whole premise is that the year printed on a card is
// the truth, so these assertions are less about code and more about guarding the data:
// a duplicate, a bad genre or a decade that disagrees with its year would quietly make
// the game unfair rather than crash it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECADES, DECK, GENRES, filterDeck } from '../../public/music/deck.js';

const previews: Record<string, { preview?: string } | undefined> = JSON.parse(
  readFileSync(new URL('../../public/music/previews.json', import.meta.url), 'utf8'),
);

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
  it('is big enough that a whole evening does not repeat itself', () => {
    // A single game consumes roughly 40-80 cards (measured by playing games
    // through the engine), so a 300-card deck started repeating by the third
    // game of the night. This floor is what keeps that from creeping back.
    expect(DECK.length).toBeGreaterThanOrEqual(550);
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

  it('never leans on one artist — four cards is the cap', () => {
    const counts = new Map<string, number>();
    for (const c of DECK) {
      const key = slug(c.artist);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // Four, not three: at 300 cards a third card by one artist was 1% of the
    // deck, and the cap was cutting genuinely famous songs. At 1080 it is under
    // half a percent, so the cap can afford to breathe without the deck starting
    // to feel like somebody's favourites list.
    const offenders = [...counts.entries()].filter(([, n]) => n > 4);
    expect(offenders).toEqual([]);
  });

  it('spreads across the decades so a timeline is actually placeable', () => {
    const perDecade = new Map<number, number>();
    for (const c of DECK) perDecade.set(c.decade, (perDecade.get(c.decade) ?? 0) + 1);
    // A player holding only 1960s and 1970s cards cannot make an interesting guess;
    // every decade the filter chips advertise has to be genuinely stocked.
    for (const decade of DECADES) {
      expect(perDecade.get(decade) ?? 0, `${decade}s`).toBeGreaterThanOrEqual(25);
    }
    expect(DECADES.length).toBeGreaterThanOrEqual(8);
  });

  it('can play every single card', () => {
    // The whole game is "listen to this, then guess". A card with no audio is
    // not a hard card, it is a dead turn - the player has to skip it and draw
    // again. Two cards had to be cut to make this true (Garth Brooks keeps his
    // catalogue out of the source Apple search, and one Green Day track is not
    // indexed there), and this is what stops another one creeping back in.
    const silent = DECK.filter((c) => !previews[c.id]?.preview);
    expect(silent.map((c) => c.id)).toEqual([]);
  });

  it('does not let rock and pop swallow the deck', () => {
    // The deck once ran 59% rock+pop, and it showed: games felt like the same
    // handful of songs every time. Everything else is what makes a round feel
    // different from the last one, so the balance is worth defending in a test
    // rather than trusting the next person who adds cards to remember it.
    const perGenre = new Map<string, number>();
    for (const c of DECK) perGenre.set(c.genre, (perGenre.get(c.genre) ?? 0) + 1);
    const bulk = (perGenre.get('rock') ?? 0) + (perGenre.get('pop') ?? 0);
    expect(bulk / DECK.length).toBeLessThan(0.5);

    // And the genres that make the deck feel wide have to actually be stocked,
    // not represented by a token card or two.
    for (const genre of ['jazz', 'reggae', 'metal', 'folk', 'country', 'latin', 'indie']) {
      expect(perGenre.get(genre) ?? 0, genre).toBeGreaterThanOrEqual(12);
    }
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
