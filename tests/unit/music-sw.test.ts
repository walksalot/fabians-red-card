// The service worker precaches a hand-written list of files. Every time someone
// adds a module, that list has to grow with it - and forgetting is not a
// degraded-offline bug, it is a blank page: the browser fails the ES import and
// ui.js never runs at all. It also fails silently online, because the network
// quietly serves the missing file, so the only person who ever sees it is a
// player on a phone with no signal. That is exactly the person this app is for.
//
// So rather than trusting a human to keep two lists in sync, this walks the real
// import graph from index.html and demands the worker precaches all of it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MUSIC = join(__dirname, '../../public/music');
const read = (name: string) => readFileSync(join(MUSIC, name), 'utf8');

/** The paths inside sw.js's SHELL array, with the leading "./" stripped. */
function shellEntries(): Set<string> {
  const sw = read('sw.js');
  const block = /const SHELL = \[([\s\S]*?)\n\];/.exec(sw);
  if (!block) throw new Error('could not find the SHELL array in sw.js');
  const entries = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\.\//, ''));
  return new Set(entries);
}

/**
 * Every local module reachable from a set of entry points, following the
 * relative `import ... from './x.js'` edges. Bare specifiers are ignored - this
 * app has no dependencies, so anything non-relative would be a bug of its own.
 */
function moduleGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    let source: string;
    try {
      source = read(name);
    } catch {
      throw new Error(`${name} is imported but does not exist in public/music/`);
    }
    // Covers `import x from './y.js'`, `import './y.js'` and `export * from './y.js'`.
    for (const m of source.matchAll(/(?:from|import)\s*['"]\.\/([^'"]+\.js)['"]/g)) {
      queue.push(m[1]);
    }
  }
  return seen;
}

/** `<script type="module" src="...">` entry points declared by a page. */
function scriptSources(html: string): string[] {
  return [...html.matchAll(/<script[^>]*type="module"[^>]*src="\.\/([^"]+)"/g)].map((m) => m[1]);
}

/** `<link rel="stylesheet" href="...">` on a page. */
function styleSources(html: string): string[] {
  return [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
}

describe('service worker precache', () => {
  const shell = shellEntries();

  it('precaches both pages and their stylesheets', () => {
    for (const page of ['index.html', 'listen.html']) {
      expect(shell.has(page), `${page} is missing from the SHELL`).toBe(true);
      for (const href of styleSources(read(page))) {
        expect(shell.has(href), `${href} (from ${page}) is missing from the SHELL`).toBe(true);
      }
    }
  });

  it('precaches every module reachable from either page', () => {
    const entries = [...scriptSources(read('index.html')), ...scriptSources(read('listen.html'))];
    // A page with no module entry point means the regex above stopped matching
    // the real markup, which would make this whole suite vacuous.
    expect(entries.length).toBeGreaterThan(0);

    const missing = [...moduleGraph(entries)].filter((name) => !shell.has(name)).sort();
    expect(missing, `add these to the SHELL array in sw.js: ${missing.join(', ')}`).toEqual([]);
  });

  it('precaches every font the stylesheet asks for', () => {
    const fonts = [...read('fonts.css').matchAll(/url\(['"]?\.\/([^'")]+\.woff2)/g)].map((m) => m[1]);
    expect(fonts.length).toBeGreaterThan(0);
    const missing = fonts.filter((name) => !shell.has(name)).sort();
    expect(missing, `add these fonts to the SHELL array in sw.js: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not precache a file that no longer exists', () => {
    // The mirror failure: a renamed file left behind in the SHELL makes
    // addAll() reject, which fails the whole install and leaves the player with
    // no offline cache at all rather than an incomplete one.
    const gone = [...shell]
      .filter((name) => name !== '' && name !== './')
      .filter((name) => {
        try {
          readFileSync(join(MUSIC, name));
          return false;
        } catch {
          return true;
        }
      });
    expect(gone, `these SHELL entries do not exist: ${gone.join(', ')}`).toEqual([]);
  });
});
