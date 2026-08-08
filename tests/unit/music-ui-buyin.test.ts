// The winner screen pays from a stake SNAPSHOT taken at Shuffle & start
// ('buyin-active'), never from the live setup draft - editing the buy-in in a
// setup that was never started used to rewrite the pot of the game being
// resumed, Venmo handle and all. These drive the real ui.js wiring through the
// same minimal DOM stand-in as music-ui-roster.test.ts, because the browser
// repro is a whole game long and the contract is three storage reads.
//
// The second block covers the versioned save guard: persist() carries a write
// counter inside the payload, and a tab whose counter is behind the stored one
// must refuse to write (a stale second tab used to time-machine the game).
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Minimal Storage stand-in (same shape as music-storage.test.ts uses). */
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

/** The least DOM ui.js needs to boot headless - see music-ui-roster.test.ts. */
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
    body: {
      dataset: {} as Record<string, string>,
      style: { setProperty() {} },
    },
  };
  const win = {
    location: {
      search: '?debug=1&seed=42',
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

/** A [data-action] button as the delegated click handler sees one. */
function actionButton(action: string, dataset: Record<string, string> = {}) {
  const node = {
    dataset: { action, ...dataset },
    disabled: false,
    getAttribute: () => null,
    closest: (selector: string) => (selector === '[data-action]' ? node : null),
  };
  return node;
}

type Draft = {
  name: string;
  photo: string | null;
  skipped: boolean;
  pending: boolean;
};
type Seam = {
  view: {
    stale: boolean;
    setup: {
      players: Draft[];
      buyin: { enabled: boolean; amount: number; handle: string };
      target: number;
      mode: string;
    };
  };
  state: { turn: number; phase: string } | null;
};

let store: FakeStorage;
let listeners: Record<string, Listener[]>;
type StorageModule = typeof import('../../public/music/storage.js');
let storage: StorageModule;
let seam: Seam;

const fire = (type: string, target: unknown) => {
  for (const fn of listeners[type] ?? [])
    fn({ type, target, preventDefault() {} });
};

/** Two skipped-photo players and a $3 stake, then Shuffle & start. */
function startStakedGame() {
  seam.view.setup.players.length = 2;
  for (const draft of seam.view.setup.players) draft.skipped = true;
  seam.view.setup.players[0].name = 'Eve';
  seam.view.setup.players[1].name = 'Fin';
  seam.view.setup.buyin.enabled = true;
  seam.view.setup.buyin.amount = 300;
  seam.view.setup.buyin.handle = '@host';
  fire('click', actionButton('start-game'));
}

beforeEach(async () => {
  vi.resetModules();
  store = new FakeStorage();
  const dom = fakeDom();
  listeners = dom.listeners;
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('document', dom.doc);
  vi.stubGlobal('window', dom.win);

  storage = await import('../../public/music/storage.js');
  await import('../../public/music/ui.js');
  fire('DOMContentLoaded', dom.doc);
  seam = (dom.win as unknown as { __timeline: Seam }).__timeline;
});

describe('the stake snapshot', () => {
  it('is written at Shuffle & start and does not follow later draft edits', () => {
    startStakedGame();
    expect(seam.state?.phase).toBe('turn-start');

    const stake = storage.get('buyin-active') as {
      enabled: boolean;
      amount: number;
      handle: string | null;
    };
    expect(stake).toMatchObject({ enabled: true, amount: 300, handle: 'host' });

    // The kid fiddling with a NEW setup draft mid-game: the snapshot the win
    // screen pays from must not move.
    seam.view.setup.buyin.enabled = true;
    seam.view.setup.buyin.amount = 2000;
    seam.view.setup.buyin.handle = '@kid-who-fiddled';
    const after = storage.get('buyin-active') as {
      amount: number;
      handle: string | null;
    };
    expect(after.amount).toBe(300);
    expect(after.handle).toBe('host');
  });

  it('records a disabled stake for a game started with the switch off', () => {
    seam.view.setup.players.length = 2;
    for (const draft of seam.view.setup.players) draft.skipped = true;
    fire('click', actionButton('start-game'));

    const stake = storage.get('buyin-active') as { enabled: boolean };
    expect(stake.enabled).toBe(false);
  });

  it('survives Play again until the next game actually starts', () => {
    startStakedGame();
    expect(storage.get('buyin-active')).not.toBeNull();
    // Play again only navigates. The finished record - winner, recap, pot -
    // must survive a reload during post-game setup (paying the pot in Venmo
    // reloads the tab on most phones), so nothing is cleared at tap time.
    fire('click', actionButton('play-again'));
    expect(storage.get('buyin-active')).not.toBeNull();
    expect(storage.loadGame()).not.toBeNull();

    // Shuffle & start is the moment the old record is genuinely replaced.
    for (const draft of seam.view.setup.players) draft.skipped = true;
    fire('click', actionButton('start-game'));
    const stake = storage.get('buyin-active') as { amount: number } | null;
    expect(stake).not.toBeNull();
    const game = storage.loadGame() as { phase: string };
    expect(game.phase).not.toBe('game-over');
  });
});

describe('the versioned save guard', () => {
  it('numbers every write through the payload', () => {
    startStakedGame();
    const first = storage.loadGame() as { __writes: number };
    expect(first.__writes).toBe(1);

    // Drawing + selecting a gap both persist; the counter only ever climbs.
    fire('click', actionButton('select-gap', { gapIndex: '0' }));
    const second = storage.loadGame() as { __writes: number; card: unknown };
    expect(second.__writes).toBeGreaterThan(first.__writes);
    expect(second.card).toBeTruthy();
  });

  it('refuses to write over a save from a tab that is ahead, and goes stale', () => {
    startStakedGame();

    // Another tab moved the game on: same save slot, higher counter.
    const foreign = {
      ...(storage.loadGame() as Record<string, unknown>),
      __writes: 7,
    };
    storage.set('game', foreign);

    // This (now stale) tab tries to act. The write must be refused - the
    // stored payload keeps the foreign counter - and the tab locks itself.
    fire('click', actionButton('select-gap', { gapIndex: '0' }));
    expect((storage.loadGame() as { __writes: number }).__writes).toBe(7);
    expect(seam.view.stale).toBe(true);

    // A stale tab accepts no further game input.
    const before = storage.loadGame();
    fire('click', actionButton('select-gap', { gapIndex: '0' }));
    expect(storage.loadGame()).toEqual(before);
  });
});

describe('the setup draft', () => {
  it('restores options on boot and never restores an empty filter selection', async () => {
    storage.set('setup', {
      target: 15,
      mode: 'coop',
      mistakeLimit: 4,
      decades: [],
      genres: ['pop', 'not-a-genre'],
      streakBonus: true,
      buyin: { enabled: true, amount: 500, handle: '@ann' },
    });

    vi.resetModules();
    const dom = fakeDom();
    listeners = dom.listeners;
    vi.stubGlobal('document', dom.doc);
    vi.stubGlobal('window', dom.win);
    await import('../../public/music/ui.js');
    fire('DOMContentLoaded', dom.doc);
    const fresh = (dom.win as unknown as { __timeline: Seam }).__timeline;

    const setup = fresh.view.setup as unknown as {
      target: number;
      mode: string;
      mistakeLimit: number;
      decades: number[];
      genres: string[];
      streakBonus: boolean;
      buyin: { enabled: boolean; amount: number; handle: string };
    };
    expect(setup.target).toBe(15);
    expect(setup.mode).toBe('coop');
    expect(setup.mistakeLimit).toBe(4);
    // [] means "everything" to the filter, so the draft keeps the full set...
    expect(setup.decades.length).toBeGreaterThan(0);
    // ...and unknown genres are dropped, known ones kept.
    expect(setup.genres).toEqual(['pop']);
    expect(setup.streakBonus).toBe(true);
    expect(setup.buyin).toEqual({ enabled: true, amount: 500, handle: '@ann' });
  });
});
