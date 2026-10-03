// The style switcher (ui/styletoggle.ts): the boot deep link and stored choice,
// the three-choice radio group (ids, aria state, roving keyboard), and the
// strand swatches the chrome prints on dark cards.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HANGA_CREDIT,
  STYLE_CHOICES,
  STYLE_STORAGE_KEY,
  cardSwatch,
  createStyleToggle,
  readStoredStyle,
  resolveBootStyle,
  styleFromSlug,
  swatchVar,
  writeStoredStyle,
  type StyleStorage,
} from "../src/ui/styletoggle";
import { ART_CREDITS, HANGA, strandSwatch, type ArtStyle } from "../src/scene/artstyle";
import type { StrandId } from "../src/data";

// ---------------------------------------------------------------------------
// Deep link and persistence.

describe("styleFromSlug: only the three user choices resolve", () => {
  it("galaxy, washi, and dusk map to 0, 3, and 4", () => {
    expect(styleFromSlug("galaxy")).toBe(0);
    expect(styleFromSlug("washi")).toBe(3);
    expect(styleFromSlug("dusk")).toBe(4);
    expect(styleFromSlug(" Dusk ")).toBe(4);
  });
  it("the dormant styles and unknown values do not resolve", () => {
    for (const v of ["ringers", "fidenza", "blueprint", "transit", "", "3", "hanga", null, undefined]) {
      expect(styleFromSlug(v)).toBeNull();
    }
  });
});

describe("resolveBootStyle: ?style= wins, then the stored choice, else Galaxy", () => {
  it("a known ?style= loads that style", () => {
    expect(resolveBootStyle("washi", null)).toBe(3);
    expect(resolveBootStyle("dusk", null)).toBe(4);
  });
  it("?style=galaxy, unknown values, ringers, and fidenza all load style 0", () => {
    for (const v of ["galaxy", "nope", "ringers", "fidenza", ""]) expect(resolveBootStyle(v, null)).toBe(0);
  });
  it("an explicit ?style= wins over the stored value", () => {
    expect(resolveBootStyle("galaxy", "dusk")).toBe(0);
    expect(resolveBootStyle("washi", "dusk")).toBe(3);
    expect(resolveBootStyle("ringers", "dusk")).toBe(0);
  });
  it("with no parameter the stored choice applies, and junk falls back to 0", () => {
    expect(resolveBootStyle(null, "dusk")).toBe(4);
    expect(resolveBootStyle(null, "washi")).toBe(3);
    expect(resolveBootStyle(null, "fidenza")).toBe(0);
    expect(resolveBootStyle(null, null)).toBe(0);
  });
});

class MemStorage implements StyleStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}
const throwing: StyleStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("stored choice: cme.style, wrapped in try/catch", () => {
  it("writes the slug under cme.style and reads it back", () => {
    const m = new MemStorage();
    writeStoredStyle(() => m, 4);
    expect(STYLE_STORAGE_KEY).toBe("cme.style");
    expect(m.map.get("cme.style")).toBe("dusk");
    expect(readStoredStyle(() => m)).toBe("dusk");
    writeStoredStyle(() => m, 0);
    expect(m.map.get("cme.style")).toBe("galaxy");
  });
  it("never stores a dormant style", () => {
    const m = new MemStorage();
    writeStoredStyle(() => m, 1);
    writeStoredStyle(() => m, 2);
    expect(m.map.size).toBe(0);
  });
  it("a throwing or absent storage reads null and writes nothing, silently", () => {
    expect(readStoredStyle(() => throwing)).toBeNull();
    expect(() => writeStoredStyle(() => throwing, 3)).not.toThrow();
    expect(readStoredStyle(() => null)).toBeNull();
    expect(
      readStoredStyle(() => {
        throw new Error("no localStorage");
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The radio group, on a minimal DOM stand-in (no DOM library in this repo).

type Listener = (e: FakeEvent) => void;
interface FakeEvent {
  type: string;
  key?: string;
  target: FakeEl;
  defaultPrevented: boolean;
  preventDefault(): void;
}

class FakeEl {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  className = "";
  id = "";
  textContent = "";
  hidden = false;
  tabIndex = 0;
  type = "";
  constructor(
    readonly tagName: string,
    readonly doc: FakeDoc,
  ) {}
  classList = {
    toggle: (c: string, on?: boolean) => {
      const set = new Set(this.className.split(" ").filter(Boolean));
      const want = on ?? !set.has(c);
      if (want) set.add(c);
      else set.delete(c);
      this.className = [...set].join(" ");
      return want;
    },
    contains: (c: string) => this.className.split(" ").includes(c),
  };
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  append(...els: FakeEl[]): void {
    for (const e of els) this.appendChild(e);
  }
  appendChild(e: FakeEl): FakeEl {
    e.parent = this;
    this.children.push(e);
    return e;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  focus(): void {
    this.doc.activeElement = this;
  }
  /** Dispatch with bubbling, like a real event. */
  fire(type: string, init: { key?: string } = {}): FakeEvent {
    const e: FakeEvent = {
      type,
      key: init.key,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (let n: FakeEl | null = this; n; n = n.parent) for (const fn of n.listeners.get(type) ?? []) fn(e);
    return e;
  }
  click(): void {
    this.fire("click");
  }
  all(): FakeEl[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

class FakeDoc {
  activeElement: FakeEl | null = null;
  body = new FakeEl("body", this);
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }
}

describe("createStyleToggle: a three-choice radio group", () => {
  let doc: FakeDoc;
  const g = globalThis as unknown as { document?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = g.document;
    doc = new FakeDoc();
    g.document = doc;
  });
  afterEach(() => {
    g.document = saved;
  });

  function mount(initial: ArtStyle, variant: "free" | "story" = "free") {
    const chosen: ArtStyle[] = [];
    const handle = createStyleToggle({ choose: (s) => chosen.push(s), initial, variant });
    const root = handle.el as unknown as FakeEl;
    const nodes = root.all();
    const group = nodes.find((n) => n.getAttribute("role") === "radiogroup")!;
    const radios = nodes.filter((n) => n.getAttribute("role") === "radio");
    const label = nodes.find((n) => n.className === "style-label")!;
    const credit = nodes.find((n) => n.className === "style-credit")!;
    return { handle, root, group, radios, label, credit, chosen };
  }
  const checked = (radios: FakeEl[]) => radios.map((r) => r.getAttribute("aria-checked"));
  const tabs = (radios: FakeEl[]) => radios.map((r) => r.tabIndex);

  it("offers exactly Galaxy, Washi, Dusk, in that order, for styles 0, 3, 4", () => {
    expect(STYLE_CHOICES.map((c) => [c.label, c.style])).toEqual([
      ["Galaxy", 0],
      ["Washi", 3],
      ["Dusk", 4],
    ]);
    const { radios, root } = mount(0);
    expect(radios.map((r) => r.textContent)).toEqual(["Galaxy", "Washi", "Dusk"]);
    expect(root.parent).toBe(doc.body);
    expect(root.className).toBe("style-toggle");
  });

  it("the visible STYLE label names the radio group", () => {
    const { group, label } = mount(0);
    expect(label.textContent).toBe("Style");
    expect(label.id).not.toBe("");
    expect(group.getAttribute("aria-labelledby")).toBe(label.id);
  });

  it("aria-checked and the roving tabindex follow the active style", () => {
    const { radios, handle } = mount(3);
    expect(checked(radios)).toEqual(["false", "true", "false"]);
    expect(tabs(radios)).toEqual([-1, 0, -1]);
    handle.reflect(4);
    expect(checked(radios)).toEqual(["false", "false", "true"]);
    expect(tabs(radios)).toEqual([-1, -1, 0]);
    // A dormant debug style checks nothing; the first radio keeps Tab.
    handle.reflect(1);
    expect(checked(radios)).toEqual(["false", "false", "false"]);
    expect(tabs(radios)).toEqual([0, -1, -1]);
  });

  it("a click chooses that style; clicking the checked one is quiet", () => {
    const { radios, chosen } = mount(0);
    radios[2].click();
    expect(chosen).toEqual([4]);
    expect(checked(radios)).toEqual(["false", "false", "true"]);
    radios[2].click();
    expect(chosen).toEqual([4]);
    radios[0].click();
    expect(chosen).toEqual([4, 0]);
  });

  it("arrows, Home, and End move focus AND choose (the radio pattern), wrapping", () => {
    const { radios, chosen } = mount(0);
    radios[0].focus();
    let e = radios[0].fire("keydown", { key: "ArrowRight" });
    expect(e.defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(radios[1]);
    expect(chosen).toEqual([3]);
    radios[1].fire("keydown", { key: "ArrowDown" });
    expect(doc.activeElement).toBe(radios[2]);
    radios[2].fire("keydown", { key: "ArrowRight" }); // wraps to Galaxy
    expect(doc.activeElement).toBe(radios[0]);
    radios[0].fire("keydown", { key: "ArrowLeft" }); // wraps to Dusk
    expect(doc.activeElement).toBe(radios[2]);
    radios[2].fire("keydown", { key: "Home" });
    expect(doc.activeElement).toBe(radios[0]);
    radios[0].fire("keydown", { key: "End" });
    expect(doc.activeElement).toBe(radios[2]);
    expect(chosen).toEqual([3, 4, 0, 4, 0, 4]);
    expect(checked(radios)).toEqual(["false", "false", "true"]);
    expect(tabs(radios)).toEqual([-1, -1, 0]);
  });

  it("other keys are left alone (Tab leaves the group; Enter and Space click)", () => {
    const { radios, chosen } = mount(0);
    for (const key of ["Tab", "Enter", " ", "a"]) {
      const e = radios[0].fire("keydown", { key });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(chosen).toEqual([]);
  });

  it("the credit shows for Washi and Dusk only, with no link", () => {
    expect(HANGA_CREDIT).toBe("After Wada Sanzo, Oda Kazuma, and Utagawa Hiroshige");
    expect(ART_CREDITS[3].html).toBe(HANGA_CREDIT);
    expect(ART_CREDITS[4].html).toBe(HANGA_CREDIT);
    const { credit, handle } = mount(0);
    expect(credit.hidden).toBe(true);
    handle.reflect(3);
    expect(credit.hidden).toBe(false);
    expect(credit.textContent).toBe(HANGA_CREDIT);
    expect(credit.children.length).toBe(0);
    handle.reflect(4);
    expect(credit.hidden).toBe(false);
    handle.reflect(0);
    expect(credit.hidden).toBe(true);
  });

  it("the story copy mounts in its host with its own class", () => {
    const host = doc.createElement("section");
    const handle = createStyleToggle({ choose: () => {}, initial: 0, variant: "story", host: host as never });
    expect((handle.el as unknown as FakeEl).parent).toBe(host);
    expect((handle.el as unknown as FakeEl).className).toBe("style-pick");
    handle.dispose();
    expect(host.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Swatches on dark cards.

const STRANDS: StrandId[] = ["number", "algebra", "geometry", "data"];
const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const lum = ([r, g, b]: [number, number, number]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: [number, number, number], b: [number, number, number]): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** --surface (rgb 16 16 36 at 88%) over a field color. */
const glassOver = (field: number): [number, number, number] => {
  const f = rgb(field);
  const s = [16, 16, 36];
  return [0, 1, 2].map((i) => s[i] * 0.88 + f[i] * 0.12) as [number, number, number];
};
// The lightest field each style shows under a card, plus Browse's opaque --bg.
const CARDS: [string, [number, number, number]][] = [
  ["glass on washi paper", glassOver(HANGA.washi.bg)],
  ["glass on dusk slate", glassOver(HANGA.dusk.bottom)],
  ["browse --bg", rgb(0x050510)],
];

describe("chrome swatches on dark cards", () => {
  it("the Washi pigments themselves fall under 3:1 on the glass (why cards use Dusk's)", () => {
    const worst = Math.min(...STRANDS.map((s) => ratio(rgb(strandSwatch(s, 3)), CARDS[0][1])));
    expect(worst).toBeLessThan(3);
  });
  it("every card swatch clears 3:1 on every dark card, in all three user styles", () => {
    for (const style of [0, 3, 4] as ArtStyle[])
      for (const s of STRANDS)
        for (const [, bg] of CARDS) expect(ratio(rgb(cardSwatch(s, style)), bg)).toBeGreaterThanOrEqual(3);
  });
  it("Washi cards print the Dusk pigment set; Galaxy and Dusk print their own", () => {
    for (const s of STRANDS) {
      expect(cardSwatch(s, 3)).toBe(HANGA.dusk.pigment[s]);
      expect(cardSwatch(s, 4)).toBe(HANGA.dusk.pigment[s]);
      expect(cardSwatch(s, 0)).toBe(strandSwatch(s, 0));
    }
  });
  it("swatchVar falls back to the Galaxy color, so style 0 paints as before", () => {
    expect(swatchVar("number")).toBe(`var(--sw-number, #${strandSwatch("number", 0).toString(16).padStart(6, "0")})`);
  });
});

// ---------------------------------------------------------------------------
// Wiring guards: no entry point for the dormant styles and poses.

describe("wiring (source guards)", () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");
  const main = read("src/main.ts");
  const css = read("src/style.css");

  it("main mounts the free card and the story row, and boots from resolveBootStyle", () => {
    expect(main).toContain('variant: "free"');
    expect(main).toContain('variant: "story"');
    expect(main).toContain('resolveBootStyle(params.get("style"), readStoredStyle(styleStore))');
    // Only a reader's choice is stored; the deep link and the debug hook are not.
    expect(main.match(/writeStoredStyle\(/g)?.length).toBe(1);
  });

  it("the switcher module names no dormant style or pose", () => {
    const src = read("src/ui/styletoggle.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/ringers|fidenza|blueprint|transit/i);
  });

  it("the free card leaves the frame in a story, in Browse, and in OG capture", () => {
    expect(css).toMatch(/body\.storying \.style-toggle,\s*body\.og \.style-toggle,\s*body\.browsing \.style-toggle \{\s*display: none;/);
  });
});
