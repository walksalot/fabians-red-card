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
