// Service worker for the Music Timeline game: makes the app shell available
// offline so a game already loaded keeps working when the wifi hiccups, and so
// it can be added to a phone's home screen and opened like a real app.
//
// NOT REGISTERED HERE - ui.js owns registration. The snippet it needs, for
// reference (only outside file://, where service workers are unavailable and
// the call throws):
//
//   if ('serviceWorker' in navigator && location.protocol !== 'file:') {
//     window.addEventListener('load', () => {
//       navigator.serviceWorker.register('./sw.js').catch(() => {});
//     });
//   }
//
// Two rules run this file:
//   1. The app shell is served from the cache first and refreshed behind the
//      response (stale-while-revalidate), because a song game must not wait on
//      a network round trip between turns - but it must not pin a returning
//      player to the first build they ever loaded either. Do not "simplify"
//      this back to plain cache-first; see the note in the fetch handler.
//   2. The audio itself is never cached - stale bytes would be worse than none,
//      and a preview per card would not fit anyway. The *answers* are:
//      previews.json is part of the shell below, which is what makes an offline
//      reload able to resolve a card at all.
// Everything else follows from "a bad cache must never be able to lock a family
// out of the game": the version below changes whenever the shell changes, old
// caches are deleted on activate, and a new worker takes over immediately
// instead of waiting for every tab to close.

// Bump this on any deploy that must reach returning players immediately. It is a
// belt to the stale-while-revalidate braces below: changing it changes this file,
// which is the only thing that makes a browser reinstall the worker at all.
const VERSION = 'v14-qa6';
const CACHE = `music-timeline-${VERSION}`;
const CACHE_PREFIX = 'music-timeline-';

// Relative so the same worker serves the game at "/" (scripts/music-server.mjs)
// and at "/music/" (the Next app) without edits - these resolve against this
// file's own URL.
const SHELL = [
  './',
  './index.html',
  './listen.html',
  './app.css',
  './listen.css',
  './manifest.json',
  './icon.svg',
  './apple-touch-icon.png',
  // Load-bearing, not an extra: this is the build-time answer for the deck.
  // Without it audio.js falls through to a live iTunes lookup, so a family that
  // loaded the game once and then lost the wifi could not play a single song.
  // It used to arrive here only via runtime caching, which meant it took TWO
  // online loads before the game was genuinely offline-capable.
  './previews.json',
  // The typography, vendored rather than fetched from Google. Precached for the
  // same reason previews.json is: runtime caching alone means the first wifi
  // drop falls back to system fonts, so the game would look right only from the
  // SECOND load. latin-ext is included deliberately - the deck carries accented
  // artists (Ruben Blades, Los del Rio) and players type accented names.
  './fonts.css',
  './fonts/paytone-one-400-latin.woff2',
  './fonts/paytone-one-400-latin-ext.woff2',
  './fonts/sora-variable-latin.woff2',
  './fonts/sora-variable-latin-ext.woff2',
  './fonts/ibm-plex-mono-500-latin.woff2',
  './fonts/ibm-plex-mono-500-latin-ext.woff2',
  './fonts/ibm-plex-mono-600-latin.woff2',
  './fonts/ibm-plex-mono-600-latin-ext.woff2',
  './qr.js',
  './engine.js',
  './deck.js',
  './audio.js',
  './storage.js',
  './confetti.js',
  // Every ES module index.html imports has to be here. A missing entry is not a
  // degraded feature offline, it is a blank page: the browser fails the import
  // and ui.js never runs at all.
  './sfx.js',
  './buyin.js',
  './ui.js',
  './listen.js',
];

// Hosts that must always go straight to the network: song lookups and the audio
// previews themselves.
const NETWORK_ONLY_HOSTS = [
  'itunes.apple.com',
  'audio-ssl.itunes.apple.com',
  'mzstatic.com',
  'apple.com',
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // How hard to hit the network depends on WHY this install is running:
      //
      // - First-ever install (no active worker, no old cache): the page that
      //   registered us finished downloading this exact shell seconds ago, so
      //   default HTTP-cache semantics reuse those bytes instead of downloading
      //   the whole game a second time. Before this distinction existed, every
      //   install used `cache: 'reload'` and a family's first visit paid for
      //   the shell twice (~2.5 MB moved for ~1.3 MB of app).
      //
      // - Update install (a VERSION bump reaching a returning player): here
      //   `cache: 'reload'` is load-bearing, do not "simplify" it away. The LAN
      //   server (scripts/music-server.mjs) marks the shell immutable for a
      //   year WITHOUT validators, so a default-mode fetch would happily
      //   install year-old bytes out of the HTTP cache and `no-cache` could
      //   not revalidate them. Skipping the HTTP cache entirely is the only
      //   thing that makes a new VERSION actually get new bytes - and it costs
      //   nothing extra here, because a returning player's page load was served
      //   from the old SW cache, not the network, so there is no double fetch
      //   to avoid on this path.
      //
      // If a first install ever did race a genuinely stale HTTP cache, the
      // stale-while-revalidate fetch handler below refreshes every shell file
      // behind its first use anyway - a bad copy can outlive neither the next
      // load nor the next VERSION bump, so nobody gets locked out.
      const names = await caches.keys();
      const isUpdate =
        Boolean(self.registration.active) ||
        names.some((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE);
      const fetchMode = isUpdate ? 'reload' : 'default';
      // One at a time, failures tolerated: addAll() rejects the whole install if
      // a single file 404s, and a half-written checkout (or a game served
      // without listen.js yet) should not leave players with no worker at all.
      // Anything missed here is picked up by the runtime cache on first use.
      await Promise.all(
        SHELL.filter((path) => path !== './').map(async (path) => {
          try {
            const response = await fetch(new Request(path, { cache: fetchMode }));
            if (!response.ok) return;
            // Both servers answer './' with index.html, and HTML is no-store
            // everywhere, so filling both cache keys from ONE fetch saves a
            // full second download of the document on every install.
            if (path === './index.html') await cache.put('./', response.clone());
            await cache.put(path, response);
          } catch {
            /* offline or missing file - runtime caching will fill it in */
          }
        }),
      );
    })(),
  );
  // Don't sit in "waiting" behind an old worker: the old one may be the reason
  // someone is stuck.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Lets a page tell a waiting worker to take over right away (e.g. an
// "update available - tap to reload" affordance in ui.js).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isNetworkOnly(url)) return; // straight to the network, never cached
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) {
        // Stale-while-revalidate, NOT plain cache-first. Cache-first was a trap:
        // a worker only reinstalls when sw.js's own bytes change, so bumping
        // VERSION was the only thing that could ever refresh the shell - and a
        // deploy that did not touch this file left every returning player pinned
        // to the build they first loaded, forever. They keep the instant cached
        // response here; the copy behind it is refreshed for the next load.
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(new Request(request, { cache: 'no-cache' }));
              if (fresh.ok && fresh.type === 'basic') {
                const cache = await caches.open(CACHE);
                await cache.put(request, fresh.clone());
              }
            } catch {
              // Offline or blocked: the cached copy already went out, so there
              // is nothing to recover from and nothing worth reporting.
            }
          })(),
        );
        return cached;
      }

      try {
        const response = await fetch(request);
        // Only cache real, complete, same-origin responses. Opaque and partial
        // ones are exactly what poisons a cache.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        // Offline. A navigation still gets the app shell so the game opens;
        // anything else honestly fails.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return new Response('Offline, and this file was never cached.', {
          status: 504,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
    })(),
  );
});
