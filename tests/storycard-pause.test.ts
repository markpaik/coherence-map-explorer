// The story pause control says what it does.
//
// Pause used to stop only the auto-advance, and its accessible name said so:
// "Pause auto-advance" / "Resume auto-advance". Since round 14 it also holds
// the map still (stories/storyclock.ts), so the name now names the action on
// the story. The name carries the state, so the button drops aria-pressed:
// "Play the story, toggle button, pressed" would say two opposite things.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { pauseControlLabel } from "../src/ui/storycard";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolvePath(HERE, "..", "src/ui/storycard.ts"), "utf8");

describe("story pause control: accessible name", () => {
  it("names the action on the story in both states", () => {
    expect(pauseControlLabel(false)).toBe("Pause the story");
    expect(pauseControlLabel(true)).toBe("Play the story");
  });

  it("the card uses the helper for the initial and the toggled name, never the old wording", () => {
    expect(src).toContain('pauseBtn.setAttribute("aria-label", pauseControlLabel(false));');
    expect(src).toContain('pauseBtn.setAttribute("aria-label", pauseControlLabel(paused));');
    expect(src).not.toContain('"Pause auto-advance"');
    expect(src).not.toContain('"Resume auto-advance"');
  });

  it("the name carries the state, so the button sets no aria-pressed", () => {
    expect(src).not.toMatch(/pauseBtn\.setAttribute\("aria-pressed"/);
  });

  it("keeps the existing visual: the pause and play glyphs", () => {
    expect(src).toContain('pauseBtn.textContent = paused ? "▶" : "⏸";');
  });
});
