// The buy-in module is the one place in the party game where a rounding error
// is not a cosmetic bug: it is a number a family reads off a phone and then
// actually pays each other. So these tests lean hard on the arithmetic (money
// in binary floating point is the classic defect - see the float trap block),
// on every shape a person might type a Venmo handle in, and on every path that
// returns null. A wrong pot is worse than no pot, and a broken payment link
// pasted into the family group chat is worse than no link, so "returns null"
// is a feature with its own coverage here.
import { describe, expect, it } from 'vitest';
import {
  MAX_CENTS,
  MAX_NOTE_CHARS,
  MAX_PER_PLAYER_CENTS,
  MAX_PLAYERS,
  dollarsToCents,
  formatMoney,
  normaliseHandle,
  potFor,
  venmoPayUrl,
} from '../../public/music/buyin.js';

/** potFor's success shape, so a test can reach into it without a null check. */
function pot(amount: unknown, playerCount: unknown) {
  const result = potFor({ amount, playerCount });
  if (!result) throw new Error(`potFor rejected ${String(amount)} x ${String(playerCount)}`);
  return result;
}

/** dollarsToCents, for the cases that are meant to succeed. */
function cents(input: unknown): number {
  const result = dollarsToCents(input);
  if (result === null) throw new Error(`dollarsToCents rejected ${String(input)}`);
  return result;
}

describe('formatMoney', () => {
  it('renders integer cents as dollars', () => {
    expect(formatMoney(200)).toBe('$2.00');
    expect(formatMoney(800)).toBe('$8.00');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(1234)).toBe('$12.34');
  });

  it('treats its argument as CENTS, not dollars', () => {
    // This is the assertion that fails first if anyone ever "simplifies" the
    // module to a dollars-based representation: 6 is six cents, not six
    // dollars, and 600 is the pot, not six hundred dollars.
    expect(formatMoney(6)).toBe('$0.06');
    expect(formatMoney(600)).toBe('$6.00');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('keeps the cents column even for exact dollars', () => {
    expect(formatMoney(1600)).toBe('$16.00');
  });

  it('drops a bare ".00" when asked to be compact', () => {
    expect(formatMoney(800, { compact: true })).toBe('$8');
    expect(formatMoney(0, { compact: true })).toBe('$0');
    // ...but never when there are real cents to show.
    expect(formatMoney(250, { compact: true })).toBe('$2.50');
    expect(formatMoney(805, { compact: true })).toBe('$8.05');
  });

  it('groups thousands', () => {
    expect(formatMoney(100000)).toBe('$1,000.00');
    expect(formatMoney(10000000)).toBe('$100,000.00');
    expect(formatMoney(100000, { compact: true })).toBe('$1,000');
  });

  it('renders a negative as a signed amount', () => {
    expect(formatMoney(-600)).toBe('-$6.00');
    expect(formatMoney(-5)).toBe('-$0.05');
  });

  it('returns null for anything that is not whole cents', () => {
    // A non-integer here means someone did dollar arithmetic upstream, which
    // is precisely the defect this module exists to prevent - so it refuses to
    // render rather than printing a plausible-looking wrong number.
    expect(formatMoney(6.5)).toBeNull();
    expect(formatMoney(0.1 + 0.2)).toBeNull();
    expect(formatMoney(NaN)).toBeNull();
    expect(formatMoney(Infinity)).toBeNull();
    expect(formatMoney(-Infinity)).toBeNull();
    expect(formatMoney('600')).toBeNull();
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney({})).toBeNull();
  });
});

describe('the float trap', () => {
  it('confirms the trap is real in this runtime', () => {
    // If these ever stop being true, JavaScript changed, not us.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(2.1 * 3).not.toBe(6.3);
    expect(5.6 * 3).not.toBe(16.8);
    expect(String(0.29 * 3)).toBe('0.8699999999999999');
  });

  it('adds and multiplies money without drift', () => {
    expect(cents(0.1) + cents(0.2)).toBe(30);
    expect(formatMoney(cents(0.1) + cents(0.2))).toBe('$0.30');
    expect(formatMoney(cents(2.1) * 3)).toBe('$6.30');
    expect(formatMoney(cents(0.29) * 3)).toBe('$0.87');
    expect(formatMoney(cents(5.6) * 3)).toBe('$16.80');
  });

  it('never renders a pot with a floating point tail', () => {
    // The stated nightmare: "$2 x 3 players" showing as $5.999999999999999.
    // Sweep the amounts and party sizes a reunion actually uses and demand
    // that every rendered string is money-shaped.
    const moneyShaped = /^\$\d{1,3}(,\d{3})*(\.\d{2})?$/;
    for (const dollars of [0, 0.05, 0.29, 1, 1.15, 2, 2.1, 2.5, 5, 10, 12.34]) {
      for (let players = 1; players <= MAX_PLAYERS; players += 1) {
        const result = pot(cents(dollars), players);
        expect(result.total, `${dollars} x ${players}`).toMatch(moneyShaped);
        expect(result.totalCents, `${dollars} x ${players}`).toBe(cents(dollars) * players);
      }
    }
  });

  it('gets $2 a head exactly right at every table size', () => {
    expect(pot(200, 1).total).toBe('$2');
    expect(pot(200, 3).total).toBe('$6');
    expect(pot(200, 4).total).toBe('$8');
    expect(pot(200, 8).total).toBe('$16');
  });
});

describe('dollarsToCents', () => {
  it('reads a plain number of dollars', () => {
    expect(dollarsToCents(2)).toBe(200);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(2.5)).toBe(250);
    expect(dollarsToCents(2.1)).toBe(210);
    expect(dollarsToCents(12.34)).toBe(1234);
  });

  it('rounds binary drift away at the boundary', () => {
    // A number reaching us is usually the output of arithmetic elsewhere.
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(5.6 * 3)).toBe(1680);
    expect(dollarsToCents(2.1 * 3)).toBe(630);
  });

  it('parses a typed string without going near a float', () => {
    expect(dollarsToCents('2')).toBe(200);
    expect(dollarsToCents('2.50')).toBe(250);
    expect(dollarsToCents('2.5')).toBe(250);
    expect(dollarsToCents('$2.50')).toBe(250);
    expect(dollarsToCents('  2.50  ')).toBe(250);
    expect(dollarsToCents('.50')).toBe(50);
    expect(dollarsToCents('0.29')).toBe(29);
    expect(dollarsToCents('2,000')).toBe(200000);
    expect(dollarsToCents('-2')).toBe(-200);
    expect(dollarsToCents('-$2.50')).toBe(-250);
  });

  it('refuses a typed value with impossible precision', () => {
    // Rounding "2.005" to either 200 or 201 would be a guess about what a
    // person meant, so we do not.
    expect(dollarsToCents('2.005')).toBeNull();
    expect(dollarsToCents('2.4999')).toBeNull();
  });

  it('returns null for anything that is not money', () => {
    expect(dollarsToCents('')).toBeNull();
    expect(dollarsToCents('   ')).toBeNull();
    expect(dollarsToCents('$')).toBeNull();
    expect(dollarsToCents('.')).toBeNull();
    expect(dollarsToCents('-')).toBeNull();
    expect(dollarsToCents('two dollars')).toBeNull();
    expect(dollarsToCents('2 dollars')).toBeNull();
    expect(dollarsToCents('2$50')).toBeNull();
    expect(dollarsToCents(NaN)).toBeNull();
    expect(dollarsToCents(Infinity)).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
    expect(dollarsToCents({})).toBeNull();
    expect(dollarsToCents(true)).toBeNull();
  });

  it('returns null for an absurd amount', () => {
    expect(dollarsToCents(MAX_CENTS / 100)).toBe(MAX_CENTS);
    expect(dollarsToCents(MAX_CENTS / 100 + 1)).toBeNull();
    expect(dollarsToCents('999999999')).toBeNull();
    expect(dollarsToCents('9'.repeat(300))).toBeNull();
  });
});

describe('potFor', () => {
  it('describes the reunion case', () => {
    const result = pot(200, 4);
    expect(result).toEqual({
      playerCount: 4,
      perPlayerCents: 200,
      totalCents: 800,
      perPlayer: '$2',
      total: '$8',
      label: 'Pot: $8 with 4 players',
    });
  });

  it('handles a single player without saying "1 players"', () => {
    const result = pot(200, 1);
    expect(result.totalCents).toBe(200);
    expect(result.label).toBe('Pot: $2 with 1 player');
  });

  it('handles eight players', () => {
    const result = pot(200, 8);
    expect(result.totalCents).toBe(1600);
    expect(result.label).toBe('Pot: $16 with 8 players');
  });

  it('allows a free game', () => {
    const result = pot(0, 4);
    expect(result.totalCents).toBe(0);
    expect(result.perPlayer).toBe('$0');
    expect(result.label).toBe('Pot: $0 with 4 players');
  });

  it('keeps odd buy-ins exact', () => {
    expect(pot(250, 3).label).toBe('Pot: $7.50 with 3 players');
    expect(pot(5, 7).label).toBe('Pot: $0.35 with 7 players');
  });

  it('returns null for a negative buy-in', () => {
    expect(potFor({ amount: -1, playerCount: 4 })).toBeNull();
    expect(potFor({ amount: -200, playerCount: 4 })).toBeNull();
  });

  it('returns null for a buy-in that is not whole cents', () => {
    // 2.5 is a caller who thinks in dollars; taking it would silently make
    // every pot 100x too small.
    expect(potFor({ amount: 2.5, playerCount: 4 })).toBeNull();
    expect(potFor({ amount: NaN, playerCount: 4 })).toBeNull();
    expect(potFor({ amount: Infinity, playerCount: 4 })).toBeNull();
    expect(potFor({ amount: '200', playerCount: 4 })).toBeNull();
    expect(potFor({ amount: null, playerCount: 4 })).toBeNull();
    expect(potFor({ playerCount: 4 })).toBeNull();
  });

  it('returns null for an absurd buy-in', () => {
    expect(pot(MAX_PER_PLAYER_CENTS, 1).totalCents).toBe(MAX_PER_PLAYER_CENTS);
    expect(potFor({ amount: MAX_PER_PLAYER_CENTS + 1, playerCount: 1 })).toBeNull();
  });

  it('returns null for an impossible player count', () => {
    expect(potFor({ amount: 200, playerCount: 0 })).toBeNull();
    expect(potFor({ amount: 200, playerCount: -1 })).toBeNull();
    expect(potFor({ amount: 200, playerCount: 2.5 })).toBeNull();
    expect(potFor({ amount: 200, playerCount: NaN })).toBeNull();
    expect(potFor({ amount: 200, playerCount: '4' })).toBeNull();
    expect(potFor({ amount: 200 })).toBeNull();
    expect(pot(200, MAX_PLAYERS).playerCount).toBe(MAX_PLAYERS);
    expect(potFor({ amount: 200, playerCount: MAX_PLAYERS + 1 })).toBeNull();
  });

  it('returns null rather than throwing when handed nothing', () => {
    expect(potFor(undefined)).toBeNull();
    expect(potFor(null)).toBeNull();
    expect(potFor({})).toBeNull();
    expect(potFor('200')).toBeNull();
  });
});

describe('normaliseHandle', () => {
  it('passes a bare handle through', () => {
    expect(normaliseHandle('paula')).toBe('paula');
    expect(normaliseHandle('paula_1')).toBe('paula_1');
    expect(normaliseHandle('paula-quinn')).toBe('paula-quinn');
    expect(normaliseHandle('Paula99')).toBe('Paula99');
  });

  it('strips a leading at-sign', () => {
    expect(normaliseHandle('@paula')).toBe('paula');
  });

  it('trims surrounding whitespace and keeps the typed case', () => {
    // Venmo handles are not case sensitive, so there is nothing to gain by
    // mangling what the person actually typed.
    expect(normaliseHandle(' Paula ')).toBe('Paula');
    expect(normaliseHandle('\t@Paula\n')).toBe('Paula');
  });

  it('reads a handle out of a pasted profile URL', () => {
    expect(normaliseHandle('venmo.com/u/paula')).toBe('paula');
    expect(normaliseHandle('https://venmo.com/u/paula')).toBe('paula');
    expect(normaliseHandle('http://venmo.com/u/paula')).toBe('paula');
    expect(normaliseHandle('https://www.venmo.com/paula')).toBe('paula');
    expect(normaliseHandle('https://account.venmo.com/u/Paula-Q')).toBe('Paula-Q');
    expect(normaliseHandle('venmo.com/paula')).toBe('paula');
    expect(normaliseHandle('HTTPS://VENMO.COM/u/paula')).toBe('paula');
  });

  it('ignores a trailing slash, query string or fragment on a URL', () => {
    expect(normaliseHandle('https://venmo.com/u/paula/')).toBe('paula');
    expect(normaliseHandle('https://venmo.com/paula?txn=pay&amount=2.00')).toBe('paula');
    expect(normaliseHandle('https://venmo.com/u/paula#about')).toBe('paula');
    expect(normaliseHandle(' https://venmo.com/u/paula/ ')).toBe('paula');
  });

  it('returns null for empty input', () => {
    expect(normaliseHandle('')).toBeNull();
    expect(normaliseHandle('   ')).toBeNull();
    expect(normaliseHandle('@')).toBeNull();
    expect(normaliseHandle(' @ ')).toBeNull();
  });

  it('returns null when there is a space inside', () => {
    expect(normaliseHandle('pau la')).toBeNull();
    expect(normaliseHandle('paula smith')).toBeNull();
    expect(normaliseHandle('@paula smith')).toBeNull();
  });

  it('returns null for characters Venmo does not allow', () => {
    expect(normaliseHandle('paula.smith')).toBeNull();
    expect(normaliseHandle('paula@example.com')).toBeNull();
    expect(normaliseHandle('paula!')).toBeNull();
    expect(normaliseHandle('@@paula')).toBeNull();
    // Accented and Cyrillic look-alikes: written as escapes so this file
    // stays ASCII, and rejected because Venmo takes neither.
    expect(normaliseHandle('paul\u00e1')).toBeNull();
    expect(normaliseHandle('\u0440aula')).toBeNull();
  });

  it('returns null for an absurd length', () => {
    expect(normaliseHandle('p'.repeat(30))).toBe('p'.repeat(30));
    expect(normaliseHandle('p'.repeat(31))).toBeNull();
    expect(normaliseHandle('@' + 'p'.repeat(31))).toBeNull();
    expect(normaliseHandle('p'.repeat(5000))).toBeNull();
    expect(normaliseHandle(`https://venmo.com/u/${'p'.repeat(500)}`)).toBeNull();
  });

  it('returns null for a URL that is not a Venmo profile', () => {
    expect(normaliseHandle('https://example.com/paula')).toBeNull();
    expect(normaliseHandle('https://venmo.com.evil.test/paula')).toBeNull();
    expect(normaliseHandle('venmo://users/paula')).toBeNull();
    expect(normaliseHandle('javascript://venmo.com/paula')).toBeNull();
    expect(normaliseHandle('https://venmo.com')).toBeNull();
    expect(normaliseHandle('https://venmo.com/')).toBeNull();
    expect(normaliseHandle('https://venmo.com/u/paula/extra')).toBeNull();
    expect(normaliseHandle('https://venmo.com/code/abc123')).toBeNull();
    expect(normaliseHandle('paula/')).toBeNull();
    expect(normaliseHandle('/paula')).toBeNull();
  });

  it('returns null for anything that is not a string', () => {
    expect(normaliseHandle(null)).toBeNull();
    expect(normaliseHandle(undefined)).toBeNull();
    expect(normaliseHandle(42)).toBeNull();
    expect(normaliseHandle({})).toBeNull();
    expect(normaliseHandle(['paula'])).toBeNull();
  });
});

describe('venmoPayUrl', () => {
  it('builds a pay link for the pot', () => {
    expect(venmoPayUrl({ handle: 'paula', amount: 800, note: 'Timeline pot' })).toBe(
      'https://venmo.com/paula?txn=pay&amount=8.00&note=Timeline%20pot',
    );
  });

  it('normalises the handle on the way in', () => {
    const expected = 'https://venmo.com/paula?txn=pay&amount=8.00';
    expect(venmoPayUrl({ handle: '@paula', amount: 800 })).toBe(expected);
    expect(venmoPayUrl({ handle: ' paula ', amount: 800 })).toBe(expected);
    expect(venmoPayUrl({ handle: 'https://venmo.com/u/paula', amount: 800 })).toBe(expected);
  });

  it('renders the amount as decimal dollars, never as cents', () => {
    expect(venmoPayUrl({ handle: 'paula', amount: 5 })).toContain('amount=0.05');
    expect(venmoPayUrl({ handle: 'paula', amount: 630 })).toContain('amount=6.30');
    expect(venmoPayUrl({ handle: 'paula', amount: 1600 })).toContain('amount=16.00');
    expect(venmoPayUrl({ handle: 'paula', amount: 100000 })).toContain('amount=1000.00');
  });

  it('asks Venmo to pay, not to charge', () => {
    expect(venmoPayUrl({ handle: 'paula', amount: 800 })).toContain('txn=pay');
    expect(venmoPayUrl({ handle: 'paula', amount: 800 })).not.toContain('txn=charge');
  });

  it('percent-encodes a note containing spaces and an ampersand', () => {
    const url = venmoPayUrl({
      handle: 'paula',
      amount: 800,
      note: 'Music Timeline & pizza',
    });
    expect(url).toBe(
      'https://venmo.com/paula?txn=pay&amount=8.00&note=Music%20Timeline%20%26%20pizza',
    );
    // The ampersand must not survive raw, or it splits the query and Venmo
    // sees a note of "Music Timeline" plus a junk parameter.
    expect(url).not.toContain('& pizza');
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('note')).toBe('Music Timeline & pizza');
    expect(parsed.searchParams.get('amount')).toBe('8.00');
    expect(parsed.searchParams.get('txn')).toBe('pay');
    expect([...parsed.searchParams.keys()]).toEqual(['txn', 'amount', 'note']);
  });

  it('percent-encodes the other characters a memo picks up', () => {
    const url = venmoPayUrl({
      handle: 'paula',
      amount: 800,
      note: 'pot #1: Ana + Jo/Bo 100% ?done',
    });
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('note')).toBe('pot #1: Ana + Jo/Bo 100% ?done');
    expect(url).toContain('%23');
    expect(url).toContain('%2B');
    expect(url).not.toContain('#1');
  });

  it('leaves the note off when there is nothing to say', () => {
    expect(venmoPayUrl({ handle: 'paula', amount: 800 })).toBe(
      'https://venmo.com/paula?txn=pay&amount=8.00',
    );
    expect(venmoPayUrl({ handle: 'paula', amount: 800, note: '' })).not.toContain('note=');
    expect(venmoPayUrl({ handle: 'paula', amount: 800, note: '   ' })).not.toContain('note=');
    expect(venmoPayUrl({ handle: 'paula', amount: 800, note: 42 })).not.toContain('note=');
  });

  it('trims and clips an over-long note to what Venmo accepts', () => {
    const url = venmoPayUrl({
      handle: 'paula',
      amount: 800,
      note: `  ${'a'.repeat(MAX_NOTE_CHARS + 500)}  `,
    });
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('note')).toBe('a'.repeat(MAX_NOTE_CHARS));
  });

  it('returns null when the handle is missing or cannot be one', () => {
    // The pot still exists in this case - potFor is unaffected - there is just
    // no link to offer.
    expect(venmoPayUrl({ amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: '', amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: '   ', amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: null, amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: 'pau la', amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula.smith', amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: 'https://example.com/paula', amount: 800 })).toBeNull();
    expect(venmoPayUrl({ handle: 'p'.repeat(31), amount: 800 })).toBeNull();
    // ...and the pot itself is still fine without a payee.
    expect(pot(200, 4).label).toBe('Pot: $8 with 4 players');
  });

  it('returns null rather than a broken link for a bad amount', () => {
    expect(venmoPayUrl({ handle: 'paula', amount: 0 })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula', amount: -800 })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula', amount: 8.5 })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula', amount: '800' })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula', amount: NaN })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula', amount: Infinity })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula' })).toBeNull();
    expect(venmoPayUrl({ handle: 'paula', amount: MAX_CENTS })).toContain('amount=100000.00');
    expect(venmoPayUrl({ handle: 'paula', amount: MAX_CENTS + 1 })).toBeNull();
  });

  it('returns null rather than throwing when handed nothing', () => {
    expect(venmoPayUrl(undefined)).toBeNull();
    expect(venmoPayUrl(null)).toBeNull();
    expect(venmoPayUrl({})).toBeNull();
    expect(venmoPayUrl('paula')).toBeNull();
  });
});

describe('the whole reunion flow', () => {
  it('goes from a typed buy-in to a link someone can pay', () => {
    const perPlayer = cents('$2.00');
    const result = pot(perPlayer, 4);
    expect(result.label).toBe('Pot: $8 with 4 players');
    expect(
      venmoPayUrl({
        handle: ' @Paula ',
        amount: result.totalCents,
        note: `${result.label} & winner takes it`,
      }),
    ).toBe(
      'https://venmo.com/Paula?txn=pay&amount=8.00&note=Pot%3A%20%248%20with%204%20players%20%26%20winner%20takes%20it',
    );
  });
});
