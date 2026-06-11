import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-tools indicator floats bottom-left and physically covers the first
  // bottom-tab on phone-sized viewports (breaks taps in dev and in e2e runs).
  devIndicators: false,
};

export default nextConfig;
