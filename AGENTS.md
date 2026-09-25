# Fabian's Red Card — World Cup 2026 prediction-pool site

Private login-gated league site (Next.js + Drizzle) where the friend group predicts exact
scores and first goalscorers on a live leaderboard. The predictions/ORACLE workflow
authenticates against this site — it consumes `/rules` and `/today` via the `wc_session`
cookie flow documented in the predictions repo's `AGENTS.md`. Dev `npm run dev`; tests
`npm run test` (vitest) + `npm run test:e2e` (Playwright).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Working here

- Install with `npx npm@11 ci`: the lockfile needs npm >= 11, and Node 22's bundled npm 10 fails with a misleading "Missing: esbuild… from lock file".
- `npm run setup` writes `.env.local` and creates `.data/app.db` with all 104 matches, printing the admin login on first run; `npm run seed` re-seeds and never overwrites results or users.
- CI runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then `npm run test:e2e` and `npm run test:e2e:gameplay` one after the other (servers on ports 3100/3200; never run both suites at once, `npm run test:e2e:all` runs them in sequence).
- `CONTRACTS.md` is the contract for schema, services, API envelope and Next 16 conventions; logic reads time from `now()` in `@/lib/clock` (e2e pins it with `FAKE_NOW`), never `new Date()`.
- Merging to `main` deploys to the live league on Railway (https://fabians-red-card-production.up.railway.app); `main` has no branch protection or ruleset, so a PR can merge with red checks.
- Never run `scripts/verify-prod.mjs`: it writes to the live league (launch-day only).
