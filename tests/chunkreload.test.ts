// Stale-chunk recovery guard (src/state/chunkreload.ts), redteam finding 54:
// after a deploy an open tab lost math and search for the whole session. main.ts
// reloads once on `vite:preloadError`; this pins the guard that keeps that
// reload from looping.

import { describe, it, expect } from "vitest";
import { claimChunkReload, CHUNK_RELOAD_KEY, type FlagStore } from "../src/state/chunkreload";

function memoryStore(): FlagStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const BUILD_A = "https://example.test/assets/index-AAAA.js";
const BUILD_B = "https://example.test/assets/index-BBBB.js";

describe("claimChunkReload", () => {
  it("allows the first reload for a build and records it", () => {
    const s = memoryStore();
    expect(claimChunkReload(() => s, BUILD_A)).toBe(true);
    expect(s.data.get(CHUNK_RELOAD_KEY)).toBe(BUILD_A);
  });

  it("declines a second reload into the same build (no loop)", () => {
    const s = memoryStore();
    expect(claimChunkReload(() => s, BUILD_A)).toBe(true);
    expect(claimChunkReload(() => s, BUILD_A)).toBe(false);
    expect(claimChunkReload(() => s, BUILD_A)).toBe(false);
  });

  it("allows one more reload after a new deploy (a different build)", () => {
    const s = memoryStore();
    expect(claimChunkReload(() => s, BUILD_A)).toBe(true);
    expect(claimChunkReload(() => s, BUILD_B)).toBe(true);
    expect(claimChunkReload(() => s, BUILD_B)).toBe(false);
  });

  it("never reloads when storage is blocked (no guard, so no automatic reload)", () => {
    const blocked = (): FlagStore => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(claimChunkReload(blocked, BUILD_A)).toBe(false);
    const throwsOnWrite: FlagStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(claimChunkReload(() => throwsOnWrite, BUILD_A)).toBe(false);
  });
});
