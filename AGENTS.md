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

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
