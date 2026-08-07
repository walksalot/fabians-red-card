// Zero-dependency LAN server for the Music Timeline game (public/music/).
//
// Why this exists: the game is meant to be played by a family sitting around one
// table with a phone each. Opening index.html from file:// only ever works on the
// device it lives on, and `npm run dev` boots the whole league app (database,
// session cookies) just to hand out four static files. This serves those files
// and nothing else, over the wifi everyone is already on, in one command.
//
//   node scripts/music-server.mjs [--port 4173]      (or PORT=4173, or -p 4173)
//
// The banner prints a scannable QR of the first LAN address, because reading an
// IP address out loud to four people is exactly the friction that stops a game
// from getting played.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
// Two roots, tried in order. The game is served AT THE ROOT so that "/" is the
// game and links stay short on a phone; public/ is the fallback so the odd
// shared asset (favicon, an svg) still resolves.
const MUSIC_ROOT = path.resolve(repoRoot, 'public', 'music');
const PUBLIC_ROOT = path.resolve(repoRoot, 'public');

const DEFAULT_PORT = 4173;
const PORT_ATTEMPTS = 11; // the requested port plus the next 10

// The banner's QR is drawn by the game's own encoder, so the code the terminal
// prints and the code the Play screen shows can never drift apart. Imported
// dynamically on purpose: a missing/broken qr.js should cost you a pretty
// banner, not the ability to serve the game.
let qrTerminal = null;
try {
  ({ qrTerminal } = await import(new URL('../public/music/qr.js', import.meta.url)));
} catch {
  qrTerminal = null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Cache policy. HTML is never cached so an edit to index.html shows up on the
 * next pull-to-refresh; sw.js is never cached because it is the app's own update
 * channel and a year-old copy pinned in the HTTP cache would freeze the game for
 * good. Everything else is immutable — the service worker fetches its shell with
 * `cache: 'reload'`, so it can still pick up new bytes when its version bumps.
 */
function cacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (ext === '.html' || base === 'sw.js') return 'no-store';
  return 'public, max-age=31536000, immutable';
}

/**
 * Resolve a URL path to a real file inside `root`, or null.
 *
 * The traversal guard is the whole point: resolve first, then require the result
 * to still sit under the root. `../` sequences, encoded ones (%2e%2e%2f), and
 * absolute-looking paths all collapse during resolve and get caught here.
 */
function resolveWithin(root, urlPath) {
  if (urlPath.includes('\0')) return null;
  const resolved = path.resolve(root, '.' + (urlPath.startsWith('/') ? urlPath : `/${urlPath}`));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    // Directory paths (including "/") get the index — a directory listing would
    // only ever expose the game's internals to a curious kid.
    const index = path.join(resolved, 'index.html');
    return fs.existsSync(index) ? index : null;
  }
  return stat.isFile() ? resolved : null;
}

/**
 * Map a request path to a file. `/app.css` and `/music/app.css` both resolve to
 * public/music/app.css so a URL copied out of this server still works when the
 * Next app serves the same game at /music/, and vice versa.
 */
function locate(urlPath) {
  const withoutMusic = urlPath === '/music' ? '/' : urlPath.replace(/^\/music(?=\/)/, '');
  return (
    resolveWithin(MUSIC_ROOT, withoutMusic) ??
    resolveWithin(MUSIC_ROOT, urlPath) ??
    resolveWithin(PUBLIC_ROOT, urlPath)
  );
}

function sendError(res, status, message) {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${status}</title><body style="font:16px/1.5 system-ui,sans-serif;background:#0b0b10;color:#eee;padding:2rem"><h1>${status}</h1><p>${message}</p><p><a style="color:#c084fc" href="/">Back to the game</a></p>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
    res.end();
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    sendError(res, 400, 'That address could not be understood.');
    return;
  }

  const file = locate(urlPath);
  if (!file) {
    sendError(res, 404, 'Nothing here.');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    sendError(res, 404, 'Nothing here.');
    return;
  }

  res.writeHead(200, {
    'content-type': contentType(file),
    'content-length': stat.size,
    'cache-control': cacheControl(file),
    // The types above are already correct; stop browsers guessing past them.
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** Every IPv4 address another phone on the same wifi could actually dial. */
function lanUrls(port) {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node reports family as 'IPv4' (string) on modern releases and 4 on some
      // older ones; accept both rather than silently printing nothing.
      const isV4 = addr.family === 'IPv4' || addr.family === 4;
      if (isV4 && !addr.internal) urls.push(`http://${addr.address}:${port}`);
    }
  }
  return urls;
}

/**
 * Listen on `port`, stepping forward through the next few ports if something
 * else already has it — a second copy of this server, or a stale one, should not
 * turn into a stack trace in front of the family.
 */
function listen(server, port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    // Both listeners come off before retrying: a stale 'listening' handler from
    // the failed attempt would fire on the *next* port and resolve with the old
    // number, so the banner would advertise a port nothing is listening on.
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    const onListening = () => {
      cleanup();
      resolve(port);
    };
    const onError = (err) => {
      cleanup();
      if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
        console.log(`Port ${port} is busy — trying ${port + 1}...`);
        listen(server, port + 1, attemptsLeft - 1).then(resolve, reject);
        return;
      }
      reject(err);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

function parsePort(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const inline = /^(?:--port|-p)=(.+)$/.exec(arg);
    const value = inline ? inline[1] : arg === '--port' || arg === '-p' ? argv[i + 1] : null;
    if (value == null) continue;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`Not a usable port: ${value}`);
      process.exit(1);
    }
    return port;
  }
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  return DEFAULT_PORT;
}

function banner(port) {
  const lan = lanUrls(port);
  const lines = [];
  lines.push('');
  lines.push('  Music Timeline — pass-the-phone song game');
  lines.push('');
  lines.push(`  This device   http://localhost:${port}`);
  if (lan.length > 0) {
    lan.forEach((url, i) => lines.push(`  ${i === 0 ? 'Same wifi   ' : '            '}  ${url}`));
  } else {
    lines.push('  Same wifi     (no network found — this machine looks offline)');
  }
  lines.push('');

  const qrTarget = lan[0];
  if (qrTarget && qrTerminal) {
    lines.push(`  Point a phone camera at this to open ${qrTarget}`);
    lines.push('');
    try {
      for (const row of qrTerminal(qrTarget)) lines.push(`  ${row}`);
      lines.push('');
    } catch (err) {
      lines.push(`  (could not draw the QR code: ${err.message})`);
      lines.push('');
    }
  } else if (qrTarget) {
    lines.push('  (QR code unavailable — public/music/qr.js could not be loaded)');
    lines.push('');
  }

  lines.push('  Everyone opens the same address. Press Ctrl+C to stop.');
  lines.push('');
  console.log(lines.join('\n'));
}

const server = http.createServer(handle);
// Phones sleeping mid-game shouldn't hold sockets open forever.
server.keepAliveTimeout = 30_000;

const port = await listen(server, parsePort(process.argv.slice(2)), PORT_ATTEMPTS).catch((err) => {
  console.error(`Could not start the music server: ${err.message}`);
  process.exit(1);
});

banner(port);

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(0);
  stopping = true;
  console.log('\nStopping the music server — thanks for playing.');
  // closeAllConnections so a phone holding a keep-alive socket open cannot make
  // Ctrl+C look like a hang.
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
