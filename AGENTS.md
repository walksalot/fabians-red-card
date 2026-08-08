# Music Timeline — phone-based song-dating party game

Official project home (Kris, 2026-08-08) of the Hitster-style game extracted from
walksalot/fabians-red-card (`public/music/` and friends, history preserved). The app is
dependency-free static ES modules in `public/music/` — no framework, no build step.
Dev server `npm run music` (file:// cannot work); tests `npm test` (Vitest);
design conformance `npm run check-design`. The DOM contract lives in the header
comment of `public/music/index.html`; all game rules live in the pure seeded reducer
`public/music/engine.js`. Read `docs/MUSIC-TIMELINE-HANDOFF.md` for the full map and
`qa/README.md` for the adversarial browser-QA harness.

Live deployment: https://music-timeline-walksalots-projects.vercel.app/index.html
(Vercel project `music-timeline`, team walksalots-projects).

Upstream note: an adversarial QA campaign may still be landing game fixes on
fabians-red-card branch `claude/phone-music-timeline-game-c96gtw`. Before starting new
game work, check that branch for commits newer than this repo's extraction and re-sync
first (procedure in README.md § Provenance and upstream).

<!-- agent-project-blueprint:start -->
## Agent Project Blueprint

This repository is structured so Codex and Claude Code can work from local
checkouts, native worktrees, cloud sessions, SSH hosts, and multiple machines
without relying on hidden local state.

- Treat the Git remote as the portable source of truth. Commit shared setup
  scripts, test commands, instructions, and non-secret configuration.
- Before mutating code, inspect `git status --short --branch`, `git remote -v`,
  and `git worktree list`; confirm the intended branch and run location.
- Use native tool worktrees by default: Codex app Worktree mode for Codex
  threads, and `claude --worktree <name>` or Claude Desktop automatic worktrees
  for Claude Code sessions.
- Do not depend on uncommitted files, user-global skills, local MCP settings,
  or machine-specific credentials for cloud work. Put portable behavior in the
  repo and configure secrets/environment in the cloud provider UI.
- Keep `AGENTS.md` and `CLAUDE.md` concise. Move longer playbooks to `docs/`.
<!-- agent-project-blueprint:end -->
