import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch workspace for ad-hoc analysis scripts (e.g. scoring sims run by
    // a separate session) — not part of the app build or its gates.
    "scratch/**",
    // Claude Code harness state (incl. nested worktrees with their own .next
    // build output) — never app code; each worktree lints itself.
    ".claude/**",
  ]),
]);

export default eslintConfig;
