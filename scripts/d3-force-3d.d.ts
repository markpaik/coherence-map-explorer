// d3-force-3d ships no type declarations and has no @types package.
// This build-time module is only used by scripts/build-graph.ts, so a
// permissive ambient declaration is sufficient to satisfy `tsc --noEmit`.
declare module "d3-force-3d";
