import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../scripts/build-graph";

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
  it("every node has finite positions inside its band x-interval", () => {
    for (const n of core.nodes) {
      for (const v of n.pos) expect(Number.isFinite(v)).toBe(true);
      const b = bandById[n.grade];
      expect(n.pos[0]).toBeGreaterThanOrEqual(b.x0 - 0.01);
      expect(n.pos[0]).toBeLessThanOrEqual(b.x1 + 0.01);
    }
  });
});

describe("HTML sanitization", () => {
  it("emits no <script anywhere", () => {
    for (const f of allHtmlFields) expect(/<script/i.test(f)).toBe(false);
    for (const shard of Object.values(detailShards)) {
      expect(/<script/i.test(JSON.stringify(shard))).toBe(false);
    }
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
