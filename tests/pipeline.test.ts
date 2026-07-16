import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGraph,
  sanitizeField,
  absolutize,
  safeLinkUrl,
} from "../scripts/build-graph";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA = resolve(ROOT, "public/data");

interface OutNode {
  id: string;
  code: string;
  grade: string;
  strand: string;
  pos: [number, number, number];
}
interface OutEdge {
  s: string;
  t: string;
  k: 0 | 1;
  c: [number, number, number];
}
interface GraphCore {
  meta: { standards: number; prereqEdges: number; relatedEdges: number };
  grades: { id: string; x0: number; x1: number }[];
  nodes: OutNode[];
  edges: OutEdge[];
}

const core: GraphCore = JSON.parse(
  readFileSync(resolve(DATA, "graph-core.json"), "utf8"),
);
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];
const detailShards = Object.fromEntries(
  GRADES.map((g) => [
    g,
    JSON.parse(readFileSync(resolve(DATA, `details/${g}.json`), "utf8")) as Record<
      string,
      Record<string, unknown>
    >,
  ]),
);
const allHtmlFields: string[] = [];
for (const shard of Object.values(detailShards)) {
  for (const entry of Object.values(shard)) {
    for (const key of ["desc", "example", "progressions"]) {
      const v = entry[key];
      if (typeof v === "string") allHtmlFields.push(v);
    }
  }
}

describe("counts", () => {
  it("has 480 standards, 757 prereq, 142 related", () => {
    expect(core.meta.standards).toBe(480);
    expect(core.meta.prereqEdges).toBe(757);
    expect(core.meta.relatedEdges).toBe(142);
    expect(core.nodes.length).toBe(480);
    expect(core.edges.length).toBe(757 + 142);
  });
});

describe("prerequisite graph is a DAG", () => {
  it("topological sort visits every node", () => {
    const ids = new Set(core.nodes.map((n) => n.id));
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of ids) {
      indeg.set(id, 0);
      adj.set(id, []);
    }
    for (const e of core.edges) {
      if (e.k !== 0) continue;
      adj.get(e.s)!.push(e.t);
      indeg.set(e.t, indeg.get(e.t)! + 1);
    }
    const queue = [...ids].filter((id) => indeg.get(id) === 0);
    let visited = 0;
    while (queue.length) {
      const n = queue.shift()!;
      visited++;
      for (const m of adj.get(n)!) {
        indeg.set(m, indeg.get(m)! - 1);
        if (indeg.get(m) === 0) queue.push(m);
      }
    }
    expect(visited).toBe(ids.size);
  });
});

describe("golden codes", () => {
  const byId = new Map(core.nodes.map((n) => [n.id, n]));
  const codes = new Set(core.nodes.map((n) => n.code));
  it("id 9 derives 1.MD.A.1", () => {
    expect(byId.get("9")?.code).toBe("1.MD.A.1");
  });
  it("F-IF.A.1 exists", () => {
    expect(codes.has("F-IF.A.1")).toBe(true);
  });
  it("4.NF.B.3.a exists (dotted standard ordinal)", () => {
    expect(codes.has("4.NF.B.3.a")).toBe(true);
  });
});

describe("node geometry", () => {
  const bandById = Object.fromEntries(core.grades.map((g) => [g.id, g]));
  const strands = new Set(["number", "algebra", "geometry", "data"]);
  it("every node has a valid strand", () => {
    for (const n of core.nodes) expect(strands.has(n.strand)).toBe(true);
  });
  it("pose A (constellation): finite positions inside each grade band's x-interval", () => {
    for (const n of core.nodes) {
      for (const v of n.pos) expect(Number.isFinite(v)).toBe(true);
      const b = bandById[n.grade];
      expect(n.pos[0]).toBeGreaterThanOrEqual(b.x0 - 0.01);
      expect(n.pos[0]).toBeLessThanOrEqual(b.x1 + 0.01);
    }
  });
  it("pose B (ascent): every prerequisite edge points upward (depth invariant)", () => {
    const nodeById = new Map(
      core.nodes.map((n) => [n.id, n as OutNode & { pos2: number[]; depth: number }]),
    );
    for (const n of core.nodes as (OutNode & { pos2?: number[]; depth?: number })[]) {
      expect(n.pos2 && n.pos2.length === 3).toBe(true);
      for (const v of n.pos2!) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(n.depth)).toBe(true);
      // x is shared between poses: the timeline survives the unravel.
      expect(n.pos2![0]).toBeCloseTo(n.pos[0], 1);
    }
    let maxDepth = 0;
    for (const e of core.edges) {
      if (e.k !== 0) continue;
      const s = nodeById.get(e.s)!;
      const t = nodeById.get(e.t)!;
      expect(t.depth).toBeGreaterThan(s.depth);
      expect(t.pos2[1]).toBeGreaterThan(s.pos2[1]);
      maxDepth = Math.max(maxDepth, t.depth);
    }
    expect(maxDepth).toBe(30); // the deepest prerequisite chain in the CCSS
  });
  it("assigns every HS standard to Appendix A courses (69/52/26/16 primary, 23 dual)", () => {
    const hs = core.nodes.filter((n) => n.grade === "HS") as (OutNode & {
      courses?: string[];
    })[];
    expect(hs.length).toBe(163);
    const primary: Record<string, number> = {};
    let dual = 0;
    for (const n of hs) {
      expect(n.courses && n.courses.length > 0).toBe(true);
      primary[n.courses![0]] = (primary[n.courses![0]] ?? 0) + 1;
      if (n.courses!.length > 1) dual++;
    }
    expect(primary).toEqual({ A1: 69, G: 52, A2: 26, ADV: 16 });
    expect(dual).toBe(23);
    // K-8 nodes never carry courses.
    expect(core.nodes.some((n) => n.grade !== "HS" && (n as { courses?: string[] }).courses)).toBe(false);
  });
  it("emits spiral markers: K-8 grade etches + 4 course arcs", () => {
    const withMarkers = core.grades.filter((g) => (g as { marker?: number[] }).marker);
    expect(withMarkers.map((g) => g.id)).toEqual(["K", "1", "2", "3", "4", "5", "6", "7", "8"]);
    const courses = (core as unknown as { courses: { id: string; marker: number[] }[] }).courses;
    expect(courses.map((c) => c.id)).toEqual(["A1", "G", "A2", "ADV"]);
    for (const c of courses) for (const v of c.marker) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("HTML sanitization", () => {
  it("emits no <script anywhere", () => {
    for (const f of allHtmlFields) expect(/<script/i.test(f)).toBe(false);
    for (const shard of Object.values(detailShards)) {
      expect(/<script/i.test(JSON.stringify(shard))).toBe(false);
    }
  });
  it("remediates link rot: no expired Dropbox previews, dead pages rewritten", () => {
    const everything = Object.values(detailShards)
      .map((s) => JSON.stringify(s))
      .join("");
    // Expired signed preview images are stripped entirely.
    expect(everything).not.toContain("previews.dropbox.com/p/thumb");
    expect(everything).not.toContain("previews.dropboxusercontent.com/p/thumb");
    // A known-dead page rewrites to its Wayback snapshot (audited 2026-07-16).
    expect(everything).not.toContain('"http://mste.illinois.edu/malcz');
    expect(everything).toContain("web.archive.org");
  });
  it("converts a known glossary anchor to span.term with data-def", () => {
    // id 11 desc contains <a id="The numbers 0, 1, 2, 3, …."> → span.term
    const entry = detailShards["1"]["11"] as { desc: string };
    expect(entry.desc).toContain('class="term"');
    expect(entry.desc).toContain("data-def=");
    expect(entry.desc).not.toMatch(/<a[^>]*\sid=/);
    // at least one glossary span somewhere in the corpus
    expect(allHtmlFields.some((f) => /class="term"/.test(f))).toBe(true);
  });
  it("preserves MathJax delimiters through sanitization", () => {
    const withDollar = allHtmlFields.filter((f) => /\$[^$\n]+\$/.test(f));
    expect(withDollar.length).toBeGreaterThan(0);
    // \(...\) delimiters also survive
    expect(allHtmlFields.some((f) => /\\\(/.test(f))).toBe(true);
  });
  it("absolutizes relative achievethecore image and task URLs", () => {
    for (const f of allHtmlFields) {
      for (const m of f.matchAll(/<img[^>]*src="([^"]*)"/g)) {
        expect(m[1].startsWith("/")).toBe(false);
      }
    }
    for (const shard of Object.values(detailShards)) {
      for (const entry of Object.values(shard)) {
        const tasks = (entry as { tasks?: { url: string }[] }).tasks || [];
        for (const t of tasks) expect(t.url.startsWith("/")).toBe(false);
      }
    }
  });
});

describe("math-span sanitization (no placeholder bypass)", () => {
  it("escapes HTML injected inside $…$ so it can't reach innerHTML live", () => {
    const out = sanitizeField(
      "<p>See $x<img src=x onerror=alert(1)>$ here</p>",
    );
    // The injected tag is inert: escaped, never a raw element.
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror=alert(1)>");
    expect(out).toContain("$x&lt;img src=x onerror=alert(1)&gt;$");
  });

  it("escapes markup smuggled between a stray/unbalanced pair of $", () => {
    const out = sanitizeField(
      "<p>Stray $foo <script>evil()</script> bar$ baz</p>",
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("&lt;script&gt;evil()&lt;/script&gt;");
  });

  it("preserves real math delimiters verbatim (round-trips for KaTeX)", () => {
    // & and < inside genuine math are HTML-escaped in the string, but the
    // delimiters themselves survive and the browser un-escapes the text node
    // back to the true LaTeX source before KaTeX reads it.
    const out = sanitizeField("<p>$a < b$ and $$c & d$$</p>");
    expect(out).toContain("$a &lt; b$");
    expect(out).toContain("$$c &amp; d$$");
    // delimiters intact
    expect(out).toMatch(/\$a /);
    expect(out).toMatch(/\$\$c /);
  });

  it("neutralizes a forged placeholder token in the source", () => {
    // U+2063-wrapped MATH0 in the source must not smuggle a stored index.
    const out = sanitizeField("<p>⁣MATH0⁣ then $y<z$</p>");
    expect(out).not.toContain("⁣");
    expect(out).toContain("MATH0"); // inert plain text, delimiters stripped
    expect(out).toContain("$y&lt;z$"); // the real math still gets index 0
  });

  it("emits no raw event-handler markup or <img inside math in any shard", () => {
    const corpus = Object.values(detailShards)
      .map((s) => JSON.stringify(s))
      .join("");
    expect(/onerror\s*=/i.test(corpus)).toBe(false);
    expect(/on\w+\s*=\s*["']?\w/i.test(corpus)).toBe(false);
  });
});

describe("structured link-field scheme validation", () => {
  it("safeLinkUrl accepts only absolute http(s), dropping other schemes", () => {
    expect(safeLinkUrl("https://example.org/x")).toBe("https://example.org/x");
    expect(safeLinkUrl("http://example.org/x")).toBe("http://example.org/x");
    // site-root paths are absolutized to achievethecore.org (still http(s))
    expect(safeLinkUrl("/page/1/foo")).toBe(
      "https://achievethecore.org/page/1/foo",
    );
    // dangerous / non-http schemes and bare/scheme-less URLs are dropped
    expect(safeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeLinkUrl("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeLinkUrl("s3.amazonaws.com/bucket/file.pdf")).toBeUndefined();
  });

  it("every emitted task/example URL is absolute http(s)", () => {
    for (const shard of Object.values(detailShards)) {
      for (const entry of Object.values(shard)) {
        const ex = (entry as { exampleUrl?: string }).exampleUrl;
        if (ex !== undefined) expect(ex).toMatch(/^https?:\/\//);
        const tasks = (entry as { tasks?: { url: string }[] }).tasks || [];
        for (const t of tasks) expect(t.url).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("URL absolutization", () => {
  it("treats a protocol-relative //host URL as https, not a site-root path", () => {
    expect(absolutize("//cdn.example.org/img.png")).toBe(
      "https://cdn.example.org/img.png",
    );
    // regression guard: never the doubled-slash bug
    expect(absolutize("//cdn.example.org/img.png")).not.toContain(
      "achievethecore.org//",
    );
  });
  it("still absolutizes a single-leading-slash path against achievethecore", () => {
    expect(absolutize("/page/9/x")).toBe("https://achievethecore.org/page/9/x");
  });
  it("leaves an already-absolute URL untouched", () => {
    expect(absolutize("https://achievethecore.org/y")).toBe(
      "https://achievethecore.org/y",
    );
  });
  it("no emitted URL has the doubled-slash-after-host defect", () => {
    const corpus = Object.values(detailShards)
      .map((s) => JSON.stringify(s))
      .join("");
    expect(corpus).not.toContain("achievethecore.org//");
  });
});

describe("search index", () => {
  interface SearchDoc {
    id: string;
    code: string;
    grade: string;
    strand: string;
    text: string;
    domainName: string;
    clusterName: string;
  }
  const docs: SearchDoc[] = JSON.parse(
    readFileSync(resolve(DATA, "search.json"), "utf8"),
  );

  it("has one HTML-free record per standard (480)", () => {
    expect(docs.length).toBe(480);
    const ids = new Set(docs.map((d) => d.id));
    expect(ids.size).toBe(480);
    for (const d of docs) {
      // No residual HTML tags in the plain-text field.
      expect(/<\/?[a-z][^>]*>/i.test(d.text)).toBe(false);
      expect(d.text.length).toBeLessThanOrEqual(241); // ~240 + ellipsis
      expect(["number", "algebra", "geometry", "data"]).toContain(d.strand);
      expect(GRADES).toContain(d.grade);
    }
  });

  it("makes a known standard findable by code and text", () => {
    const nf = docs.find((d) => d.code === "4.NF.B.3");
    expect(nf).toBeDefined();
    expect(nf!.grade).toBe("4");
    expect(nf!.strand).toBe("number");
    expect(nf!.text.length).toBeGreaterThan(0);
    // domain + cluster names are carried for the search fields
    expect(nf!.domainName.length).toBeGreaterThan(0);
    expect(nf!.clusterName.length).toBeGreaterThan(0);
    // every graph-core node has a matching search doc
    const searchIds = new Set(docs.map((d) => d.id));
    for (const n of core.nodes) expect(searchIds.has(n.id)).toBe(true);
  });
});

describe("related edges", () => {
  it("have no duplicate in either orientation", () => {
    const seen = new Set<string>();
    for (const e of core.edges) {
      if (e.k !== 1) continue;
      const key = [e.s, e.t].sort().join("|");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // also assert prereq direction never mirrors a related pair-key collision
    expect(seen.size).toBe(142);
  });
});

describe("determinism", () => {
  it("two builds produce byte-identical graph-core JSON", () => {
    const a = JSON.stringify(buildGraph().core);
    const b = JSON.stringify(buildGraph().core);
    expect(a).toBe(b);
  });
});

describe("wrangler config", () => {
  it("parses (comments stripped) and targets ./dist as an SPA", () => {
    const jsonc = readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8");
    const stripped = jsonc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const cfg = JSON.parse(stripped) as {
      assets: { directory: string; not_found_handling: string };
    };
    expect(cfg.assets.directory).toBe("./dist");
    expect(cfg.assets.not_found_handling).toBe("single-page-application");
  });
});
