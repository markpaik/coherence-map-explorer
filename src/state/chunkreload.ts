// Stale-chunk recovery rule. Kept free of DOM so it unit-tests in node
// (tests/chunkreload.test.ts); main.ts wires it to Vite's `vite:preloadError`.
//
// After a deploy, a tab that is still open asks for a lazy chunk (KaTeX,
// MiniSearch) by its OLD hashed name. That file is gone, and the browser keeps
// the failed module for the life of the page, so math and search stayed broken
// until a manual reload. One automatic reload fetches the new index.html and its
// new chunk names.
//
// The guard keys the reload to the running BUILD (main's own hashed URL), kept
// in sessionStorage. A reload is allowed once per build per tab: if the page
// has already reloaded into this build and a chunk still fails (a broken deploy,
// a dead network), the error surfaces to the normal failure UI instead of
// looping. A later deploy is a new build, so that tab can recover again.
// Storage that is missing or throws means no guard, so no automatic reload.

export const CHUNK_RELOAD_KEY = "cme-chunk-reload";

/** The two storage methods the guard reads (sessionStorage fits). */
export interface FlagStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Decide whether a failed chunk load should reload the page now, and record
 * the claim when it should. `store` is a getter because merely reading
 * `window.sessionStorage` can throw (blocked site data).
 */
export function claimChunkReload(store: () => FlagStore, build: string): boolean {
  try {
    const s = store();
    if (s.getItem(CHUNK_RELOAD_KEY) === build) return false;
    s.setItem(CHUNK_RELOAD_KEY, build);
    return true;
  } catch {
    return false;
  }
}
