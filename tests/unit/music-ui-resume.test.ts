// The home screen's resume card comes from ui.js savedGame(), which used to
// trust engine deserialize() alone. deserialize vouches for the envelope
// (version, mode, phase, arrays) but not the contents, so a hand-edited save
// with hollow {} players and no turn rendered a "Turn undefined - ," resume
// card and resumed into a zombie game whose vinyl could only say "the deck is
// empty". These tests plant exactly that payload and assert it is discarded
// like any other corrupt save - and that a genuine save still comes back.
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal Storage stand-in (same shape as music-ui-roster.test.ts uses). */
class FakeStorage {
  private map = new Map<string, string>();

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
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

type Listener = (event: unknown) => void;

/**
 * The least DOM ui.js needs to boot headless (see music-ui-roster.test.ts):
 * every render path tolerates a missing node, so getElementById can answer
 * null and init() still walks renderHome - which is where savedGame() runs.
 */
function fakeDom() {
  const listeners: Record<string, Listener[]> = {};
  const collect = (type: string, fn: Listener) => {
    (listeners[type] ??= []).push(fn);
  };
  const doc = {
    readyState: 'loading',
    addEventListener: collect,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    body: { dataset: {} as Record<string, string>, style: { setProperty() {} } },
  };
  const win = {
    location: {
      search: '?debug=1',
      protocol: 'http:',
      hostname: '127.0.0.1',
      pathname: '/music/',
      origin: 'http://127.0.0.1',
    },
    addEventListener: collect,
    matchMedia: undefined,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  return { doc, win, listeners };
}

const GAME_KEY = 'music-timeline:v1:game';
const BUYIN_ACTIVE_KEY = 'music-timeline:v1:buyin-active';

/** The exact crafted payload from the finding: passes deserialize, is hollow. */
const HOLLOW_SAVE = JSON.stringify({
  v: 1,
  t: 1,
  d: {
    version: 1,
    mode: 'classic',
    phase: 'turn-start',
    players: [{}, {}],
    deck: [],
    discard: [],
  },
});

let store: FakeStorage;

async function boot() {
  vi.resetModules();
  const dom = fakeDom();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('document', dom.doc);
  vi.stubGlobal('window', dom.win);
  await import('../../public/music/ui.js');
  for (const fn of dom.listeners['DOMContentLoaded'] ?? []) fn({ type: 'DOMContentLoaded' });
}

beforeEach(() => {
  store = new FakeStorage();
});

describe('savedGame validation on boot', () => {
  it('discards a hollow save instead of offering a zombie resume', async () => {
    store.setItem(GAME_KEY, HOLLOW_SAVE);
    // The stake snapshot belongs to that save and goes with it.
    store.setItem(BUYIN_ACTIVE_KEY, JSON.stringify({ v: 1, t: 1, d: { enabled: true, amount: 200, handle: null } }));

    await boot();

    expect(store.getItem(GAME_KEY)).toBeNull();
    expect(store.getItem(BUYIN_ACTIVE_KEY)).toBeNull();
  });

  it('discards a save whose players have no timelines', async () => {
    // Named players, still no substance: resuming would crash leader() on the
    // first resize and stall every draw.
    store.setItem(
      GAME_KEY,
      JSON.stringify({
        v: 1,
        t: 1,
        d: {
          version: 1,
          mode: 'classic',
          phase: 'turn-start',
          turn: 3,
          players: [{ name: 'Ana' }, { name: 'Bob' }],
          deck: [],
          discard: [],
        },
      }),
    );

    await boot();

    expect(store.getItem(GAME_KEY)).toBeNull();
  });

  it('keeps a genuine save', async () => {
    const { createGame, serialize } = await import('../../public/music/engine.js');
    const deck = Array.from({ length: 12 }, (_, i) => ({
      id: `song-${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      year: 1960 + i * 3,
    }));
    const state = createGame({
      players: [{ name: 'Ana' }, { name: 'Bob' }],
      deck,
      targetCards: 5,
      mode: 'classic',
      seed: 7,
    });
    store.setItem(GAME_KEY, JSON.stringify({ v: 1, t: 1, d: JSON.parse(serialize(state)) }));

    await boot();

    expect(store.getItem(GAME_KEY)).not.toBeNull();
  });
});
