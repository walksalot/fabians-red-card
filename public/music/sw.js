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
//   1. The app shell is cache-first, because a song game must not wait on a
//      network round trip between turns.
//   2. Nothing that resolves or streams a song is cached at all. Preview URLs
//      are signed and short-lived, the results are already cached in
//      localStorage by audio.js, and stale audio bytes would be worse than none.
// Everything else follows from "a bad cache must never be able to lock a family
// out of the game": the version below changes whenever the shell changes, old
// caches are deleted on activate, and a new worker takes over immediately
// instead of waiting for every tab to close.

const VERSION = 'v1';
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
  './qr.js',
  './engine.js',
  './deck.js',
  './audio.js',
  './storage.js',
  './confetti.js',
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
      // One at a time, failures tolerated: addAll() rejects the whole install if
      // a single file 404s, and a half-written checkout (or a game served
      // without listen.js yet) should not leave players with no worker at all.
      // Anything missed here is picked up by the runtime cache on first use.
      // `cache: 'reload'` skips the HTTP cache, which the LAN server marks
      // immutable - this is how a new VERSION actually gets new bytes.
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            const response = await fetch(new Request(path, { cache: 'reload' }));
            if (response.ok) await cache.put(path, response);
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
      if (cached) return cached;

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
