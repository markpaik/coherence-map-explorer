// Pure routing rules (src/state/routing.ts): hash parse/format, the deep-link
// router's gating decision, and the focus history push/replace rule. These
// encode findings 2 (Browse owns the phone deep link), 5 (guard the tour like a
// story), and 6 (push user opens, replace programmatic refocus; never loop).
// No DOM / window — the machine, main's router, the story player, and Browse all
// lean on this module, so the rules live and are tested in one place.

import { describe, it, expect } from "vitest";
import {
  parseHash,
  codeFromHash,
  storyIdFromHash,
  standardHref,
  storyHref,
  focusHistoryMode,
  decideRoute,
  type RouteContext,
} from "../src/state/routing";

describe("parseHash", () => {
  it("reads a standard link", () => {
    expect(parseHash("#/s/4.NF.B.3")).toEqual({ kind: "standard", code: "4.NF.B.3" });
    expect(parseHash("#/s/F-IF.A.1")).toEqual({ kind: "standard", code: "F-IF.A.1" });
  });
  it("reads a story link", () => {
    expect(parseHash("#/story/pandemic")).toEqual({ kind: "story", id: "pandemic" });
  });
  it("is 'none' for an empty or unrelated hash", () => {
    expect(parseHash("")).toEqual({ kind: "none" });
    expect(parseHash("#")).toEqual({ kind: "none" });
    expect(parseHash("#/other")).toEqual({ kind: "none" });
  });
  it("decodes percent-encoding in either scheme", () => {
    expect(parseHash("#/s/4.NF.B.3%2Fx")).toEqual({ kind: "standard", code: "4.NF.B.3/x" });
    expect(parseHash("#/story/a%20b")).toEqual({ kind: "story", id: "a b" });
  });
  it("story is matched before standard (distinct prefixes, no overlap)", () => {
    // A story id that itself contains "/s/" must still parse as a story.
    expect(parseHash("#/story/s/weird")).toEqual({ kind: "story", id: "s/weird" });
  });
});

describe("codeFromHash / storyIdFromHash", () => {
  it("project only their own scheme", () => {
    expect(codeFromHash("#/s/7.RP.A.2")).toBe("7.RP.A.2");
    expect(codeFromHash("#/story/x")).toBeNull();
    expect(codeFromHash("")).toBeNull();
    expect(storyIdFromHash("#/story/x")).toBe("x");
    expect(storyIdFromHash("#/s/7.RP.A.2")).toBeNull();
  });
});

describe("href builders (round-trip with parseHash)", () => {
  it("standardHref appends #/s/<code> to a base and round-trips", () => {
    expect(standardHref("4.NF.B.3", "/")).toBe("/#/s/4.NF.B.3");
    expect(standardHref("4.NF.B.3", "/app?x=1")).toBe("/app?x=1#/s/4.NF.B.3");
    expect(codeFromHash("#/s/4.NF.B.3")).toBe("4.NF.B.3");
  });
  it("storyHref appends #/story/<id> to a base and round-trips", () => {
    expect(storyHref("pandemic", "/")).toBe("/#/story/pandemic");
    expect(storyIdFromHash("#/story/pandemic")).toBe("pandemic");
  });
});

describe("focusHistoryMode (finding 6: push opens, replace refocus)", () => {
  it("defaults a fresh open to push and a same-node refocus to replace", () => {
    expect(focusHistoryMode(undefined, false)).toBe("push");
    expect(focusHistoryMode(undefined, true)).toBe("replace");
  });
  it("an explicit caller choice always wins (routers/tour/restore force replace)", () => {
    expect(focusHistoryMode("replace", false)).toBe("replace");
    expect(focusHistoryMode("push", true)).toBe("push");
  });
});

describe("decideRoute", () => {
  const base: RouteContext = {
    hash: "",
    storyRunning: false,
    tourRunning: false,
    browseOpen: false,
    focusedCode: null,
  };

  it("focuses a standard deep link when nothing owns the scene", () => {
    expect(decideRoute({ ...base, hash: "#/s/4.NF.B.3" })).toEqual({
      action: "focus",
      code: "4.NF.B.3",
    });
  });

  it("is a no-op when the hash already matches the focus (finding 6 loop guard)", () => {
    // A Back gesture fires popstate AND hashchange; re-focusing the standard the
    // machine is already on would loop / flicker, so an in-sync hash is noop.
    expect(
      decideRoute({ ...base, hash: "#/s/4.NF.B.3", focusedCode: "4.NF.B.3" }),
    ).toEqual({ action: "noop" });
  });

  it("re-focuses when the hash names a DIFFERENT standard than the focus", () => {
    expect(
      decideRoute({ ...base, hash: "#/s/7.RP.A.2", focusedCode: "4.NF.B.3" }),
    ).toEqual({ action: "focus", code: "7.RP.A.2" });
  });

  it("clears a focus when the hash empties (Back to base)", () => {
    expect(decideRoute({ ...base, hash: "", focusedCode: "4.NF.B.3" })).toEqual({
      action: "clear",
    });
  });

  it("is a no-op with no hash and no focus (already idle)", () => {
    expect(decideRoute(base)).toEqual({ action: "noop" });
  });

  it("ignores everything while a story runs", () => {
    expect(
      decideRoute({ ...base, hash: "#/s/4.NF.B.3", storyRunning: true }),
    ).toEqual({ action: "ignore" });
  });

  it("ignores everything while the tour runs (finding 5)", () => {
    // The router guarded stories but not the tour; an unguarded hashchange
    // mutated the scene under a running tour.
    expect(
      decideRoute({ ...base, hash: "#/s/4.NF.B.3", tourRunning: true }),
    ).toEqual({ action: "ignore" });
  });

  it("ignores a #/story/ hash (the player owns it, not the standard router)", () => {
    expect(decideRoute({ ...base, hash: "#/story/pandemic" })).toEqual({
      action: "ignore",
    });
  });

  it("delegates to Browse when its overlay owns navigation (finding 2)", () => {
    // On phones Browse handles #/s/<CODE>; the map router must not focus the
    // hidden map or open the covered panel (which stole assistive-tech focus).
    expect(
      decideRoute({ ...base, hash: "#/s/4.NF.B.3", browseOpen: true }),
    ).toEqual({ action: "ignore" });
  });

  it("story/tour ownership outranks Browse and a standard hash", () => {
    expect(
      decideRoute({
        hash: "#/s/4.NF.B.3",
        storyRunning: true,
        tourRunning: false,
        browseOpen: true,
        focusedCode: "1.OA.A.1",
      }),
    ).toEqual({ action: "ignore" });
  });
});
