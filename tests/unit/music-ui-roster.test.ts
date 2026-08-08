// The setup screen's name input used to file the row's photo into the avatar
// library on EVERY keystroke - typing "Chris" stored the face under "c", "ch",
// "chr"... and the library's 24-name cap then evicted every real person a
// family had accumulated. The fix files on the commit only (the 'change' event,
// which fires on blur/Enter) while still reading the library per keystroke.
// These tests drive the real ui.js input wiring through a minimal DOM stand-in,
// because the browser repro is exactly "type three prefixes, blur once".
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

const photo = (tag: string) => `data:image/jpeg;base64,${tag}`;

type Listener = (event: unknown) => void;

/**
 * The least DOM ui.js needs to boot headless: a document that collects
 * listeners (readyState 'loading' defers init until we fire DOMContentLoaded
 * ourselves), a body with a dataset, and getElementById that finds nothing -
 * every render path in ui.js tolerates a missing node.
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

/** A name input inside a roster row, as the delegated handler sees them. */
function nameInput(playerIndex: number) {
  const row = {
    dataset: { playerIndex: String(playerIndex) },
    querySelector: () => null,
  };
  return {
    dataset: { role: 'player-name' },
    value: '',
    closest: (selector: string) => (selector === '[data-player-index]' ? row : null),
  };
}

let store: FakeStorage;
let listeners: Record<string, Listener[]>;
type StorageModule = typeof import('../../public/music/storage.js');
let storage: StorageModule;
// The debug seam ui.js publishes as window.__timeline when ?debug=1 is set.
let seam: { view: { setup: { players: Array<{ name: string; photo: string | null }> } } };

const fire = (type: string, target: unknown) => {
  for (const fn of listeners[type] ?? []) fn({ type, target });
};

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
  // readyState was 'loading', so init() is parked behind DOMContentLoaded.
  fire('DOMContentLoaded', dom.doc);
  seam = (dom.win as unknown as { __timeline: typeof seam }).__timeline;
});

describe('renaming a player with a photo', () => {
  it('files the face under the finished name only, on blur - never per keystroke', () => {
    // A library the family has accumulated, and a photo on row 2.
    storage.rememberAvatar('Ana', photo('ana'));
    const draft = seam.view.setup.players[1];
    draft.photo = photo('mo');
    draft.name = 'Mo';
    storage.rememberAvatar('Mo', photo('mo'));

    const input = nameInput(1);
    for (const typed of ['C', 'Ch', 'Chris']) {
      input.value = typed;
      fire('input', input);
    }
    // Nothing filed yet: prefixes must never become library names.
    expect(Object.keys(storage.loadAvatars()).sort()).toEqual(['ana', 'mo']);

    // Blur commits ('change' fires on blur for a text input).
    fire('change', input);

    const names = Object.keys(storage.loadAvatars()).sort();
    expect(names).toEqual(['ana', 'chris', 'mo']);
    expect(storage.avatarsFor('Chris')).toContain(photo('mo'));
    // The accumulated library survived the rename.
    expect(storage.avatarsFor('Ana')).toContain(photo('ana'));
  });

  it('persists the typed name to the roster draft without waiting for another photo/skip action', async () => {
    const draft = seam.view.setup.players[0];
    draft.name = 'Ana';
    storage.savePlayers([{ name: 'Ana', photo: null, skipped: true }]);

    const input = nameInput(0);
    input.value = 'Annie';
    fire('input', input);
    // The keystroke save is debounced (~500ms), so a reload shortly after
    // typing restores what was on the screen.
    await new Promise((resolve) => setTimeout(resolve, 650));

    const saved = storage.loadPlayers() as Array<{ name: string }>;
    expect(saved[0].name).toBe('Annie');
  });
});
