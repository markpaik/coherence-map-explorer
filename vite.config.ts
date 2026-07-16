import { defineConfig } from "vite";

// Coherence Map Explorer — Vite config.
// base '/' for root-served deployment (Cloudflare static assets).
// public/ (which holds generated data/) is copied to dist/ verbatim at build time.
export default defineConfig({
  base: "/",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 4096,
  },
});
