// Every shipped math span must render in KaTeX with no red error text.
//
// The 2026-09 audit found 33 formulas that the client rendered as red KaTeX
// errors (28 `\mbox`, 2 stray `$`, 2 spec-less `array`, 1 inline `align`) and
// 34 bare environments (eqnarray*, eqnarray, aligned, array) that auto-render
// never picked up, so readers saw raw LaTeX. The fixes live in the pipeline
// (build-graph's MATH_SPAN bare-environment branch, redelimitMath, and
// katexCompatible). This suite renders the shipped shards the way the client
// does (tests/katex-client.ts) and fails on any red error or raw LaTeX.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeField } from "../scripts/build-graph";
import { CLIENT_OPTIONS, DISPLAY_ENV, renderLikeClient } from "./katex-client";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA = resolve(ROOT, "public/data");
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
const HTML_FIELDS = ["desc", "example", "progressions"];

const core: { nodes: { id: string; code: string }[] } = JSON.parse(
  readFileSync(resolve(DATA, "graph-core.json"), "utf8"),
);
const codeById = new Map(core.nodes.map((n) => [n.id, n.code]));

interface Rendered {
  where: string;
  formulas: ReturnType<typeof renderLikeClient>["formulas"];
  rawTex: string[];
}
const rendered: Rendered[] = [];
for (const g of GRADES) {
  const shard: Record<string, Record<string, unknown>> = JSON.parse(
    readFileSync(resolve(DATA, `details/${g}.json`), "utf8"),
  );
  for (const [id, entry] of Object.entries(shard)) {
    for (const field of HTML_FIELDS) {
      const html = entry[field];
      if (typeof html !== "string") continue;
      rendered.push({ where: `${codeById.get(id)}.${field}`, ...renderLikeClient(html) });
    }
  }
}

describe("KaTeX render of the shipped corpus (client options)", () => {
  it("uses the client's own options: delimiters, throwOnError, ignored classes, env wrapper", () => {
    for (const file of ["src/ui/panel.ts", "src/ui/browse.ts"]) {
      const src = readFileSync(resolve(ROOT, file), "utf8");
      expect(src, file).toContain('{ left: "\\\\[", right: "\\\\]", display: true }');
      expect(src, file).toContain('{ left: "\\\\(", right: "\\\\)", display: false }');
      expect(src, file).toContain(`throwOnError: ${CLIENT_OPTIONS.throwOnError}`);
      expect(src, file).toContain('ignoredClasses: ["term"]');
      expect(src, file).toContain(DISPLAY_ENV.source);
    }
  });

  it("finds the corpus math (thousands of formulas)", () => {
    const count = rendered.reduce((n, r) => n + r.formulas.length, 0);
    expect(count).toBeGreaterThan(6500);
  });

  it("renders every shipped math span with zero KaTeX errors", () => {
    const errors = rendered.flatMap((r) =>
      r.formulas
        .filter((f) => f.error)
        .map((f) => `${r.where}: ${f.error!.slice(0, 90)} :: ${f.tex.slice(0, 80)}`),
    );
    expect(errors).toEqual([]);
  });

  it("leaves no raw LaTeX in the visible text", () => {
    const raw = rendered.flatMap((r) => r.rawTex.map((t) => `${r.where}: ${t}`));
    expect(raw).toEqual([]);
  });
});

describe("pipeline rewrites MathJax-only LaTeX to its KaTeX equivalent", () => {
  it("delimits a bare environment in prose as display math", () => {
    const out = sanitizeField("<p>So</p>\\begin{align} a &amp;= b \\end{align} and more");
    expect(out).toContain("\\[\\begin{align} a &amp;= b \\end{align}\\]");
    expect(renderLikeClient(out).formulas).toHaveLength(1);
  });

  it("writes \\mbox as \\text", () => {
    const out = sanitizeField("<p>$$\\mbox{perimeter of a rectangle} = 2(l+w)$$</p>");
    expect(out).toContain("\\[\\text{perimeter of a rectangle} = 2(l+w)\\]");
  });

  it("writes eqnarray as a display-style rcl array", () => {
    const out = sanitizeField("<div>\\begin{eqnarray*} x &amp;=&amp; 2 \\\\ y &amp;=&amp; 3 \\end{eqnarray*}</div>");
    expect(out).toContain(
      "\\[\\begin{darray}{rcl} x &amp;=&amp; 2 \\\\ y &amp;=&amp; 3 \\end{darray}\\]",
    );
    const [f] = renderLikeClient(out).formulas;
    expect(f.error).toBeUndefined();
  });

  it("sets a spec-less array as a centred matrix, dropping the token MathJax read as the spec", () => {
    const binom = sanitizeField("<div>$$ \\left( \\begin{array} &amp;6 \\\\ 3 \\end{array} \\right) $$</div>");
    expect(binom).toContain("\\left( \\begin{matrix}6 \\\\ 3 \\end{matrix} \\right)");
    const area = sanitizeField(
      "<div>\\begin{array} \\mbox{\\rm Area}(\\Delta AFM) &amp;= \\frac{s}{2}\\\\ &amp;= s. \\end{array}</div>",
    );
    expect(area).toContain("\\begin{matrix}{\\rm Area}(\\Delta AFM) &amp;= \\frac{s}{2}");
    expect(area).toContain("\\end{matrix}");
    // A proper spec is left alone.
    expect(sanitizeField("<p>$$\\begin{array}{cc} 1 &amp; 2 \\end{array}$$</p>")).toContain(
      "\\begin{array}{cc} 1 &amp; 2 \\end{array}",
    );
  });

  it("escapes a stray dollar amount in math, but not a $ inside \\text", () => {
    const money = sanitizeField("<p>$$\\$235,000r = $10,000$$</p>");
    expect(money).toContain("\\[\\$235,000r = \\$10,000\\]");
    const text = sanitizeField("<p>$$ r \\text{ is a multiple of $30$} $$</p>");
    expect(text).toContain("\\text{ is a multiple of $30$}");
  });

  it("sets an inline span holding only an align as display math", () => {
    const out = sanitizeField("<p>$\\begin{align} h &amp;= 1 \\\\ &amp;= 2 \\end{align}$</p>");
    expect(out).toContain("\\[\\begin{align} h &amp;= 1 \\\\ &amp;= 2 \\end{align}\\]");
    const [f] = renderLikeClient(out).formulas;
    expect(f.display).toBe(true);
    expect(f.error).toBeUndefined();
  });
});
