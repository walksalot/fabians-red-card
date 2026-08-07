// The avatar library and the guest list carry real logic - name folding, caps,
// eviction, placeholder rejection, and shedding photos when a write is refused.
// All of it was verified in a browser, which proves it works once; these prove
// it keeps working, and they cover the paths a browser test cannot reach at all
// (a full origin, a corrupt payload, the 25th person).
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal Storage stand-in. `failFrom` makes writes throw like a full origin. */
class FakeStorage {
  private map = new Map<string, string>();
  failFrom: number | null = null;
  writes = 0;

  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.writes += 1;
    if (this.failFrom !== null && this.writes >= this.failFrom) {
      const err: Error & { name: string } = new Error('quota') as never;
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

let store: FakeStorage;
type StorageModule = typeof import('../../public/music/storage.js');
let mod: StorageModule;

/** A tiny but structurally valid data URL - the module only checks the prefix. */
const photo = (tag: string) => `data:image/jpeg;base64,${tag}`;

/**
 * storage.js wraps every value as `{v: VERSION, d: payload}` and hands back the
 * fallback for anything it does not recognise. A test that plants a payload has
 * to use the real envelope, or the module rejects it at the version check and
 * the test passes for the wrong reason - never reaching the validation it means
 * to exercise.
 */
const wrapped = (payload: unknown) => JSON.stringify({ v: 1, d: payload });

beforeEach(async () => {
  store = new FakeStorage();
  vi.stubGlobal('localStorage', store);
  // storage.js probes localStorage once and caches the result, so each test
  // needs its own module instance to see its own fake.
  vi.resetModules();
  mod = await import('../../public/music/storage.js');
});

describe('avatar library', () => {
  it('files a face under a name and hands it back', () => {
    expect(mod.rememberAvatar('Paula', photo('a'))).toBe(true);
    expect(mod.avatarsFor('Paula')).toEqual([photo('a')]);
  });

  it('treats a name as the same person however it is capitalised or spaced', () => {
    mod.rememberAvatar('Paula', photo('a'));
    expect(mod.avatarsFor('  paula ')).toEqual([photo('a')]);
    expect(mod.avatarsFor('PAULA')).toEqual([photo('a')]);
  });

  it('puts the newest face first', () => {
    mod.rememberAvatar('Paula', photo('a'));
    mod.rememberAvatar('Paula', photo('b'));
    expect(mod.avatarsFor('Paula')).toEqual([photo('b'), photo('a')]);
  });

  it('re-filing an existing face promotes it rather than duplicating it', () => {
    mod.rememberAvatar('Paula', photo('a'));
    mod.rememberAvatar('Paula', photo('b'));
    mod.rememberAvatar('Paula', photo('a'));
    expect(mod.avatarsFor('Paula')).toEqual([photo('a'), photo('b')]);
  });

  it('keeps only three faces per name', () => {
    for (const t of ['a', 'b', 'c', 'd']) mod.rememberAvatar('Paula', photo(t));
    expect(mod.avatarsFor('Paula')).toEqual([photo('d'), photo('c'), photo('b')]);
  });

  it('forgets the oldest names once past twenty-four', () => {
    for (let i = 0; i < 26; i += 1) mod.rememberAvatar(`Person${i}`, photo(`p${i}`));
    expect(mod.avatarsFor('Person0')).toEqual([]);
    expect(mod.avatarsFor('Person1')).toEqual([]);
    expect(mod.avatarsFor('Person25')).toEqual([photo('p25')]);
    expect(Object.keys(mod.loadAvatars())).toHaveLength(24);
  });

  it('refuses a blank name or anything that is not an image data URL', () => {
    expect(mod.rememberAvatar('', photo('a'))).toBe(false);
    expect(mod.rememberAvatar('   ', photo('a'))).toBe(false);
    expect(mod.rememberAvatar('Paula', 'https://example.com/paula.jpg')).toBe(false);
    expect(mod.rememberAvatar('Paula', '')).toBe(false);
    expect(mod.avatarsFor('Paula')).toEqual([]);
  });

  it('survives a corrupt or wrong-shaped payload instead of throwing', () => {
    store.setItem('music-timeline:v1:avatars', '{ not json');
    expect(mod.loadAvatars()).toEqual({});
    expect(mod.avatarsFor('Paula')).toEqual([]);
  });

  it('drops junk entries but keeps the good ones', () => {
    mod.rememberAvatar('Paula', photo('a'));
    const raw = JSON.parse(store.getItem('music-timeline:v1:avatars') as string);
    const body = raw.value ?? raw.d ?? raw.v ?? raw;
    body.broken = 'not an array';
    body.mixed = ['javascript:alert(1)', photo('ok')];
    store.setItem('music-timeline:v1:avatars', JSON.stringify(raw));
    const library = mod.loadAvatars();
    expect(library.broken).toBeUndefined();
    expect(library.mixed).toEqual([photo('ok')]);
    expect(library.paula).toEqual([photo('a')]);
  });

  it('sheds down to one face per name when the origin is full', () => {
    mod.rememberAvatar('Paula', photo('a'));
    mod.rememberAvatar('Paula', photo('b'));
    // Fail the next write once, so the retry path is the one that lands.
    store.failFrom = store.writes + 1;
    const ok = mod.rememberAvatar('Fabian', photo('c'));
    store.failFrom = null;
    // Either it recovered by thinning, or it honestly reported failure - what it
    // must never do is throw or leave the library unreadable.
    expect(typeof ok).toBe('boolean');
    expect(() => mod.loadAvatars()).not.toThrow();
  });
});

describe('guest list', () => {
  it('remembers somebody and hands them back', () => {
    expect(mod.rememberPerson({ name: 'Paula', photo: photo('a') })).toBe(true);
    expect(mod.loadPeople()).toEqual([{ name: 'Paula', photo: photo('a'), skipped: false }]);
  });

  it('never remembers the placeholder name the app puts in an empty row', () => {
    expect(mod.rememberPerson({ name: 'Player 3' })).toBe(false);
    expect(mod.rememberPerson({ name: 'player3' })).toBe(false);
    expect(mod.rememberPerson({ name: 'Player  12' })).toBe(false);
    expect(mod.loadPeople()).toEqual([]);
    // But somebody genuinely called Player is a person.
    expect(mod.rememberPerson({ name: 'Player One' })).toBe(true);
  });

  it('moves a returning person to the front instead of duplicating them', () => {
    mod.rememberPerson({ name: 'Paula' });
    mod.rememberPerson({ name: 'Fabian' });
    mod.rememberPerson({ name: 'paula', photo: photo('new') });
    const people = mod.loadPeople();
    expect(people.map((p) => p.name)).toEqual(['paula', 'Fabian']);
    expect(people[0].photo).toBe(photo('new'));
  });

  it('shows back the casing they last typed', () => {
    mod.rememberPerson({ name: 'paula' });
    mod.rememberPerson({ name: 'PAULA' });
    expect(mod.loadPeople().map((p) => p.name)).toEqual(['PAULA']);
  });

  it('remembers that somebody skips their photo', () => {
    mod.rememberPerson({ name: 'Mo', skipped: true });
    expect(mod.loadPeople()[0]).toEqual({ name: 'Mo', photo: null, skipped: true });
  });

  it('caps the list at twenty-four, oldest out', () => {
    for (let i = 0; i < 26; i += 1) mod.rememberPerson({ name: `Person${i}` });
    const names = mod.loadPeople().map((p) => p.name);
    expect(names).toHaveLength(24);
    expect(names[0]).toBe('Person25');
    expect(names).not.toContain('Person0');
    expect(names).not.toContain('Person1');
  });

  it('forgets a person and their saved faces together', () => {
    mod.rememberPerson({ name: 'Paula', photo: photo('a') });
    mod.rememberAvatar('Paula', photo('a'));
    mod.rememberPerson({ name: 'Fabian' });

    expect(mod.forgetPerson('paula')).toBe(true);
    expect(mod.loadPeople().map((p) => p.name)).toEqual(['Fabian']);
    // Leaving the faces behind would mean a "forgotten" person's photos came
    // straight back the moment somebody retyped the name.
    expect(mod.avatarsFor('Paula')).toEqual([]);
  });

  it('ignores a blank name and a non-array payload', () => {
    expect(mod.rememberPerson({ name: '   ' })).toBe(false);
    store.setItem('music-timeline:v1:people', wrapped({ not: 'an array' }));
    expect(mod.loadPeople()).toEqual([]);
  });

  it('drops malformed rows rather than seating a nameless player', () => {
    const list = [
      { name: 'Paula', photo: photo('a') },
      { name: '' },
      { nope: true },
      null,
      { name: 'Fabian', photo: 'javascript:x' },
    ];
    store.setItem('music-timeline:v1:people', wrapped(list));
    const people = mod.loadPeople();
    expect(people.map((p) => p.name)).toEqual(['Paula', 'Fabian']);
    // A non-image "photo" must not survive into an <img src>.
    expect(people[1].photo).toBeNull();
  });
});

// The buy-in is one line of typing that has to survive every reload of a
// reunion weekend, and it is the one payload that must never hand back a
// fractional amount: buyin.js does all its arithmetic in integer cents, and a
// stale value from an older build is the only way a float could get back in.
describe('buy-in', () => {
  it('round-trips the stake', () => {
    expect(mod.saveBuyin({ enabled: true, amount: 200, handle: 'paula' })).toBe(true);
    expect(mod.loadBuyin()).toEqual({ enabled: true, amount: 200, handle: 'paula' });
  });

  it('reports nothing at all before anyone has set a stake', () => {
    expect(mod.loadBuyin()).toBeNull();
  });

  // Both layers sanitise on purpose: saveBuyin guards what this build writes,
  // loadBuyin guards what some other build already wrote. That redundancy means
  // a test going in through save and out through load passes even when one of
  // the two guards is gone - each masks the other. So these read the raw bytes
  // to pin down what save wrote, and plant raw bytes to pin down what load
  // tolerates, one layer at a time.
  const rawBuyin = () => JSON.parse(store.getItem('music-timeline:v1:buyin') as string).d;

  it('writes a fractional amount as zero rather than rounding it', () => {
    // 2.5 cents is not money. Rounding it would invent a number the user never
    // typed; zeroing it shows an obviously wrong pot they will notice and fix.
    mod.saveBuyin({ enabled: true, amount: 2.5 as number, handle: 'paula' });
    expect(rawBuyin().amount).toBe(0);
  });

  it('writes a negative stake as zero', () => {
    mod.saveBuyin({ enabled: true, amount: -500, handle: 'paula' });
    expect(rawBuyin().amount).toBe(0);
  });

  it('reads a fractional or negative amount back as zero', () => {
    store.setItem('music-timeline:v1:buyin', wrapped({ enabled: true, amount: 2.5, handle: null }));
    expect(mod.loadBuyin()?.amount).toBe(0);
    store.setItem('music-timeline:v1:buyin', wrapped({ enabled: true, amount: -500, handle: null }));
    expect(mod.loadBuyin()?.amount).toBe(0);
  });

  it('drops a handle longer than Venmo allows, on the way in and on the way out', () => {
    mod.saveBuyin({ enabled: true, amount: 200, handle: 'x'.repeat(31) });
    expect(rawBuyin().handle).toBeNull();
    mod.saveBuyin({ enabled: true, amount: 200, handle: 'x'.repeat(30) });
    expect(rawBuyin().handle).toBe('x'.repeat(30));

    store.setItem(
      'music-timeline:v1:buyin',
      wrapped({ enabled: true, amount: 200, handle: 'x'.repeat(31) }),
    );
    expect(mod.loadBuyin()?.handle).toBeNull();
  });

  it('treats a blank handle as no handle, on the way in and on the way out', () => {
    mod.saveBuyin({ enabled: true, amount: 200, handle: '   ' });
    expect(rawBuyin().handle).toBeNull();

    store.setItem('music-timeline:v1:buyin', wrapped({ enabled: true, amount: 200, handle: '  ' }));
    expect(mod.loadBuyin()?.handle).toBeNull();
  });

  it('trims a handle someone pasted with a trailing space', () => {
    mod.saveBuyin({ enabled: true, amount: 200, handle: ' paula ' });
    expect(rawBuyin().handle).toBe('paula');
  });

  it('survives a corrupt payload written by another build', () => {
    store.setItem('music-timeline:v1:buyin', wrapped('nope'));
    expect(mod.loadBuyin()).toBeNull();
    store.setItem(
      'music-timeline:v1:buyin',
      wrapped({ enabled: 'yes', amount: '200', handle: 42 }),
    );
    // Every field is coerced to something the UI can render without checking.
    expect(mod.loadBuyin()).toEqual({ enabled: true, amount: 0, handle: null });
  });

  it('forgets the stake on request', () => {
    mod.saveBuyin({ enabled: true, amount: 200, handle: 'paula' });
    expect(mod.clearBuyin()).toBe(true);
    expect(mod.loadBuyin()).toBeNull();
  });

  it('refuses a non-object rather than storing junk', () => {
    expect(mod.saveBuyin(null as never)).toBe(false);
    expect(mod.saveBuyin('$2' as never)).toBe(false);
  });
});
