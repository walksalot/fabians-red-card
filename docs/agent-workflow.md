# Agent Workflow

This repository follows the agent project blueprint for Codex and Claude Code.

## Source of Truth

The Git remote is the portable source of truth. Files that should work across
multiple laptops, Codex cloud, Claude cloud, SSH hosts, or fresh worktrees must
be committed to the repo unless they are secrets.

## Run Locations

- Codex app Local: use for direct foreground work in this checkout.
- Codex app Worktree: use for isolated parallel Codex work; Codex manages the
  worktree under its own home directory.
- Codex cloud: use for GitHub-backed remote tasks with setup configured in the
  Codex cloud environment.
- Claude Code local CLI/Desktop: use native Claude worktrees for parallel work.
- Claude Code web/cloud: use only committed repo config and cloud environment
  settings; local user config does not travel automatically.

## Worktree Checklist

1. Confirm branch and status:
   ```bash
   git status --short --branch
   git remote -v
   git worktree list
   ```
2. Create a native tool worktree, not an ad hoc copy.
3. Run the repo setup command inside the worktree.
4. Keep ignored copied files explicit in `.worktreeinclude`.
5. Commit or open a PR before moving work between machines.

## Cloud Checklist

1. Commit `AGENTS.md`, `CLAUDE.md`, setup scripts, and tests.
2. Configure package installs and service startup in the cloud environment.
3. Store secrets only in the provider's environment/secrets UI.
4. Do not assume local global skills, local MCP servers, or local auth state.
