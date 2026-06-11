// Builds a read-only static demo of the app for GitHub Pages by mirroring the
// rendered HTML of a running production server (rich demo data) and stripping
// all JavaScript. Every screen looks exactly like the real app and tab
// navigation works as plain links; forms are inert (it's a preview).
//
// Usage: BASE_URL=http://localhost:3300 OUT=.pages-demo BASE_PATH=/fabians-red-card node scripts/build-pages-demo.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3300';
const OUT = path.resolve(process.env.OUT ?? '.pages-demo');
const BASE_PATH = process.env.BASE_PATH ?? '/fabians-red-card'; // GitHub Pages project base

const SLUG = 'fabians-red-card';
const LEAGUE = `/league/${SLUG}`;

const PAGES = [
  { route: '/login', as: null },
  { route: '/register', as: null },
  { route: '/join/demo-invite-2026', as: null },
  { route: `${LEAGUE}/today`, as: 'sofia' },
  { route: `${LEAGUE}/table`, as: 'sofia' },
  { route: `${LEAGUE}/rules`, as: 'sofia' },
  { route: `${LEAGUE}/history`, as: 'sofia' },
  { route: `${LEAGUE}/profile`, as: 'sofia' },
  { route: `${LEAGUE}/admin`, as: 'admin' },
];

const BANNER = `<div style="position:sticky;top:0;z-index:9999;background:#7f1d1d;color:#fecaca;font:600 12px/1.4 system-ui;padding:8px 14px;text-align:center">
Read-only preview with sample data — buttons &amp; forms are disabled here. The real league is fully interactive. <a href="https://github.com/walksalot/fabians-red-card" style="color:#fff;text-decoration:underline">Get the app</a>
</div>`;

async function loginCookie(username, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = /wc_session=[^;]+/.exec(setCookie);
  if (!m) throw new Error(`no session cookie for ${username}`);
  return m[0];
}

function rewrite(html) {
  let out = html;
  // strip every script tag (no hydration, no router, no broken API calls)
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script\b[^>]*\/>/gi, '');
  // strip preload hints for the now-removed JS
  out = out.replace(/<link\b[^>]*rel="preload"[^>]*as="script"[^>]*>/gi, '');
  // rebase absolute paths for the Pages project subpath
  out = out.replace(/(href|src)="\//g, `$1="${BASE_PATH}/`);
  // normalize page links to directory form so Pages serves index.html
  out = out.replace(
    new RegExp(`href="${BASE_PATH}/(login|register|league/${SLUG}/(?:today|table|rules|history|profile|admin))"`, 'g'),
    (_, p) => `href="${BASE_PATH}/${p}/"`,
  );
  // neutralize forms (no JS anyway; prevent accidental GET submits)
  out = out.replace(/<form\b/gi, '<form onsubmit="return false" ');
  // inject preview banner after <body ...>
  out = out.replace(/(<body[^>]*>)/i, `$1${BANNER}`);
  return out;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const cookies = {
  sofia: await loginCookie('sofia', 'demo-pass'),
  admin: await loginCookie('admin', 'demo-admin'),
};

for (const { route, as } of PAGES) {
  const res = await fetch(`${BASE}${route}`, {
    headers: as ? { cookie: cookies[as] } : {},
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
  const html = rewrite(await res.text());
  const dir = path.join(OUT, route.replace(/^\//, ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  console.log(`mirrored ${route} (${as ?? 'logged out'})`);
}

// root index → straight into the good stuff
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${BASE_PATH}${LEAGUE}/today/">
<title>Fabian's Red Card — demo</title><a href="${BASE_PATH}${LEAGUE}/today/">Open the demo</a>`,
);

// static assets: copy the production build's static dir; rebase url(/_next/…)
// inside CSS (fonts) for the subpath
const staticSrc = path.resolve('.next/static');
const staticDst = path.join(OUT, '_next/static');
fs.cpSync(staticSrc, staticDst, { recursive: true });
// Walk everything we copied: drop JS (no scripts in the mirror), rebase
// url(/_next/…) inside every CSS file (Turbopack emits CSS under chunks/).
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (/\.(js|js\.map)$/.test(entry.name)) {
      fs.rmSync(p, { force: true });
    } else if (entry.name.endsWith('.css')) {
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('url(/_next/', `url(${BASE_PATH}/_next/`));
    }
  }
}
walk(staticDst);

// favicon + .nojekyll (without it, Pages' Jekyll drops the _next directory!)
try {
  const fav = await fetch(`${BASE}/favicon.ico`);
  if (fav.ok) fs.writeFileSync(path.join(OUT, 'favicon.ico'), Buffer.from(await fav.arrayBuffer()));
} catch { /* favicon is optional */ }
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`\nStatic demo built at ${OUT}`);
