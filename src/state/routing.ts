// Pure routing helpers — hash parsing / formatting and the gating decisions the
// deep-link router makes. Kept free of DOM / window so they unit-test in node
// (the machine, main's router, the story player, and Browse all lean on these,
// so the one place the rules live can't drift from the one place they're tested).
//
// Hash schemes (the whole vocabulary):
//   #/s/<CODE>     a focused standard (the machine owns this write)
//   #/story/<id>   a running/deep-linked story (the story player owns this write)
//   (no hash)      idle / Browse home

export type HashRoute =
  | { kind: "standard"; code: string }
  | { kind: "story"; id: string }
  | { kind: "none" };

export function parseHash(hash: string): HashRoute {
  const story = /^#\/story\/(.+)$/.exec(hash);
  if (story) return { kind: "story", id: decodeURIComponent(story[1]) };
  const std = /^#\/s\/(.+)$/.exec(hash);
  if (std) return { kind: "standard", code: decodeURIComponent(std[1]) };
  return { kind: "none" };
}

export function codeFromHash(hash: string): string | null {
  const r = parseHash(hash);
  return r.kind === "standard" ? r.code : null;
}

export function storyIdFromHash(hash: string): string | null {
  const r = parseHash(hash);
  return r.kind === "story" ? r.id : null;
}

/** `#/s/<CODE>` appended to a base (pathname+search). Not encoded — codes are
 *  URL-safe (`4.NF.B.3`, `F-IF.A.1`), matching the app's existing convention. */
export function standardHref(code: string, base: string): string {
  return `${base}#/s/${code}`;
}

/** `#/story/<id>` appended to a base (pathname+search). */
export function storyHref(id: string, base: string): string {
  return `${base}#/story/${id}`;
}

/**
 * How a focus hash-write records in browser history. An explicit caller choice
 * wins (the deep-link router / tour / story-exit restore pass "replace"); absent
 * one, a fresh open PUSHES a new entry so the system Back gesture unwinds the hop,
 * but re-focusing the already-focused node REPLACES so history never grows a
 * duplicate entry.
 */
export function focusHistoryMode(
  explicit: "push" | "replace" | undefined,
  refocusingSameNode: boolean,
): "push" | "replace" {
  return explicit ?? (refocusingSameNode ? "replace" : "push");
}

// --- deep-link router decision -------------------------------------------
// The standard router (`routeFromHash`) fires at boot and on every hashchange.
// It must (a) yield the scene to a running story or tour, (b) yield to Browse
// when the phone overlay owns navigation (else it steals assistive-tech focus
// into the covered map panel — the phone-deep-link double-handling bug), and
// (c) never re-focus a standard that is already focused (idempotent, so a
// popstate/hashchange that both fire on a Back gesture can't loop or flicker).

export interface RouteContext {
  hash: string;
  storyRunning: boolean;
  tourRunning: boolean;
  /** The Browse overlay is up and owns navigation (delegate to it). */
  browseOpen: boolean;
  /** Code of the currently focused standard, or null. */
  focusedCode: string | null;
}

export type RouteDecision =
  | { action: "ignore" } // a story / tour / Browse owns the scene
  | { action: "focus"; code: string } // route the map to this standard
  | { action: "clear" } // no hash and a focus is open — close it
  | { action: "noop" }; // already in sync — do nothing (loop guard)

export function decideRoute(ctx: RouteContext): RouteDecision {
  // Story / tour scripts own the camera + emphasis; the guided tour guards the
  // same way a story does (finding: an unguarded hashchange mutated the scene
  // under the tour).
  if (ctx.storyRunning || ctx.tourRunning) return { action: "ignore" };
  const route = parseHash(ctx.hash);
  if (route.kind === "story") return { action: "ignore" };
  // Browse owns phone navigation; the map router must not focus the hidden map
  // or open the covered panel (finding: it stole AT focus off the Browse view).
  if (ctx.browseOpen) return { action: "ignore" };
  if (route.kind === "standard") {
    if (ctx.focusedCode === route.code) return { action: "noop" };
    return { action: "focus", code: route.code };
  }
  return ctx.focusedCode !== null ? { action: "clear" } : { action: "noop" };
}
