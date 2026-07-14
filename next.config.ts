import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // A package-lock.json also exists higher in this developer's home tree.
  // Pinning the app root prevents Turbopack from watching and resolving from
  // that unrelated directory in local development and CI worktrees.
  turbopack: {
    root: appRoot,
  },
  // The dev-tools indicator floats bottom-left and physically covers the first
  // bottom-tab on phone-sized viewports (breaks taps in dev and in e2e runs).
  devIndicators: false,
};

export default nextConfig;
