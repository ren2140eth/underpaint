import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No backend: every page is static, strokes are fetched in the browser.
  output: "export",
  images: { unoptimized: true },
  // Next writes AGENTS.md and CLAUDE.md into the repo on `next dev`. This repo
  // is public and carries production code only.
  agentRules: false,
};

export default nextConfig;
