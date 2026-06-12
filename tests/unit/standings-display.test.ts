import { describe, expect, it } from 'vitest';
import { lastPlaceRank } from '@/app/league/[slug]/_components/standings-display';

const ranks = (...rs: number[]) => rs.map((rank) => ({ rank }));

describe('lastPlaceRank (red-card holder)', () => {
  it('unique ranks → the last rank holds the card', () => {
    expect(lastPlaceRank(ranks(1, 2, 3, 4))).toBe(4);
  });

  it('all tied on one rank → no last place, no card', () => {
    expect(lastPlaceRank(ranks(1, 1, 1))).toBeNull();
  });

  it('a two-way bottom tie → that shared rank holds the card (both rows)', () => {
    expect(lastPlaceRank(ranks(1, 2, 3, 3))).toBe(3);
  });

  it('single row → no card (no race yet)', () => {
    expect(lastPlaceRank(ranks(1))).toBeNull();
  });

  it('empty table → no card', () => {
    expect(lastPlaceRank([])).toBeNull();
  });
});
