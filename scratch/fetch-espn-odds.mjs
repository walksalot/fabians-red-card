// Analysis-only helper (no app code touched): fetch the same free, key-less
// ESPN World Cup scoreboard feed the app's auto-sync uses (src/lib/sync/espn-sync.ts)
// for a range of dates, and save raw JSON per date under scratch/espn/.
// Usage: node scratch/fetch-espn-odds.mjs 20260611 20260627
import fs from 'node:fs';
import path from 'node:path';

const BASE =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const [startArg, endArg] = process.argv.slice(2);
if (!startArg || !endArg) {
  console.error('usage: node scratch/fetch-espn-odds.mjs YYYYMMDD YYYYMMDD');
  process.exit(1);
}

const outDir = path.resolve('scratch/espn');
fs.mkdirSync(outDir, { recursive: true });

function* dates(start, end) {
  const d = new Date(
    Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8)),
  );
  const stop = new Date(
    Date.UTC(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6, 8)),
  );
  while (d <= stop) {
    yield `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

let ok = 0;
for (const ymd of dates(startArg, endArg)) {
  const res = await fetch(`${BASE}?dates=${ymd}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`ESPN ${res.status} for ${ymd}`);
    continue;
  }
  const json = await res.json();
  const events = json.events ?? [];
  fs.writeFileSync(
    path.join(outDir, `scoreboard-${ymd}.json`),
    JSON.stringify(json),
  );
  const withOdds = events.filter((e) =>
    e.competitions?.[0]?.odds?.some((o) => o && typeof o === 'object'),
  ).length;
  console.log(`${ymd}: ${events.length} events, ${withOdds} with odds`);
  ok += 1;
  await new Promise((r) => setTimeout(r, 250)); // be gentle with the free feed
}
console.log(`done: ${ok} dates saved to scratch/espn/`);
