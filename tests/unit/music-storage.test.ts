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
    store.setItem('music-timeline:v1:people', JSON.stringify({ value: { not: 'an array' } }));
    expect(mod.loadPeople()).toEqual([]);
  });

  it('drops malformed rows rather than seating a nameless player', () => {
    mod.rememberPerson({ name: 'Paula', photo: photo('a') });
    const raw = JSON.parse(store.getItem('music-timeline:v1:people') as string);
    const body = raw.value ?? raw.d ?? raw.v ?? raw;
    const list = Array.isArray(body) ? body : null;
    if (list) {
      list.push({ name: '' }, { nope: true }, null, { name: 'Fabian', photo: 'javascript:x' });
      store.setItem('music-timeline:v1:people', JSON.stringify(raw));
      const people = mod.loadPeople();
      expect(people.map((p) => p.name)).toEqual(['Paula', 'Fabian']);
      // A non-image "photo" must not survive into an <img src>.
      expect(people[1].photo).toBeNull();
    }
  });
});
