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
    // The vendor chunk (three + postprocessing + camera-controls + troika) is
    // inherently ~950kB minified; it's split out on purpose for long-term
    // caching, so lift the warning ceiling above it rather than see it flagged.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Split the heavy 3D stack into its own long-cache vendor chunk. This
        // separates library code (rarely changes) from app code (changes often)
        // and clears the single-972kB-chunk warning. KaTeX / MiniSearch stay
        // lazy (their own dynamic-import chunks), so they're intentionally not
        // pinned here.
        manualChunks: {
          vendor: ["three", "postprocessing", "camera-controls", "troika-three-text"],
        },
      },
    },
  },
});
