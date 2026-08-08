# Music Timeline (game-song)

This repo's identity, commands, layout, live URL, and upstream re-sync rule live in
`AGENTS.md` — read its header before touching game code. Key invariants: the game stays
dependency-free (static ES modules, no framework, no build step); all rules live in the
pure seeded reducer `public/music/engine.js`; `public/music/index.html`'s header comment
is the DOM contract; hard-offset shadows only (enforced by `npm run check-design`).

<!-- agent-project-blueprint:start -->
## Agent Project Blueprint

This repository is prepared for Claude Code and Codex across local, worktree,
cloud, SSH, and multi-machine workflows.

- Follow the repo `AGENTS.md` rules when using Codex, and this `CLAUDE.md`
  file when using Claude Code.
- Prefer native Claude Code worktrees: `claude --worktree <name>` in the CLI,
  automatic worktrees in Desktop, and `isolation: worktree` for subagents that
  edit files in parallel.
- A worktree is a fresh checkout. Re-run this repo's setup command in each new
  worktree, and keep any copied ignored files explicit in `.worktreeinclude`.
- Cloud sessions only receive committed repo files plus cloud environment
  configuration. Do not assume local `~/.claude` files, local MCP config, or
  local credentials exist there.
- Before coding, check `git status --short --branch`, `git remote -v`, and
  `git worktree list` so parallel agents do not collide.
<!-- agent-project-blueprint:end -->
