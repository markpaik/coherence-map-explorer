// Source-data errata, plain cluster and domain names, and glossary Table 3
// (2026-09 findings 40 and 47, and the A-SSE.B.3.c / 1.OA.C.6 text errors).
// data/raw/data.js stays frozen. The fixes live in scripts/errata.json and in
// the pipeline, and these tests read what the pipeline shipped.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeHTML } from "entities";
import {
  applyErratum,
  glossaryDef,
  plainName,
  sanitizeField,
  type Erratum,
} from "../scripts/build-graph";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DATA = resolve(ROOT, "public/data");
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "HS"];

interface Node {
  id: string;
  code: string;
  grade: string;
  strand: string;
  domainName: string;
}
interface Detail {
  desc?: string;
  example?: string;
  progressions?: string;
  clusterName?: string;
}
interface SearchDoc {
  id: string;
  code: string;
  text: string;
  domainName: string;
  clusterName: string;
}

const core: { nodes: Node[] } = JSON.parse(readFileSync(resolve(DATA, "graph-core.json"), "utf8"));
const shards: Record<string, Record<string, Detail>> = Object.fromEntries(
  GRADES.map((g) => [g, JSON.parse(readFileSync(resolve(DATA, `details/${g}.json`), "utf8"))]),
);
const search: SearchDoc[] = JSON.parse(readFileSync(resolve(DATA, "search.json"), "utf8"));
const errata: { text: Erratum[]; glossaryTables: Record<string, { def: string }> } = JSON.parse(
  readFileSync(resolve(ROOT, "scripts/errata.json"), "utf8"),
);

const nodeByCode = new Map(core.nodes.map((n) => [n.code, n]));
function detailOf(code: string): Detail {
  const n = nodeByCode.get(code);
  expect(n, `${code} is a node`).toBeDefined();
  return shards[n!.grade][n!.id];
}
const searchOf = (code: string): SearchDoc => search.find((d) => d.code === code)!;

// Every glossary definition the shards ship, decoded the way the browser reads
// the attribute, with the standard it sits in.
const defs: { code: string; def: string }[] = [];
for (const n of core.nodes) {
  const e = shards[n.grade][n.id];
  for (const f of [e.desc, e.example, e.progressions]) {
    for (const m of (f ?? "").matchAll(/data-def="([^"]*)"/g)) defs.push({ code: n.code, def: decodeHTML(m[1]) });
  }
}

const TABLE_3 =
  "The rules that hold for all numbers: the associative, commutative, and distributive properties, and the identity and inverse properties of addition and multiplication. From the CCSS Glossary, Table 3.";
const ENTITY = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);/;

describe("source errata (scripts/errata.json)", () => {
  it("leaves the frozen snapshot byte-identical to the SHA-256 in PROVENANCE.md", () => {
    const provenance = readFileSync(resolve(ROOT, "data/raw/PROVENANCE.md"), "utf8");
    const recorded = /SHA-256:\*\*\s*`([0-9a-f]{64})`/.exec(provenance)?.[1];
    const actual = createHash("sha256").update(readFileSync(resolve(ROOT, "data/raw/data.js"))).digest("hex");
    expect(recorded).toBeDefined();
    expect(actual).toBe(recorded);
  });

  it("names a real standard, field, raw text, fix, and citation, and each raw text occurs once", () => {
    const raw = readFileSync(resolve(ROOT, "data/raw/data.js"), "utf8")
      .trim()
      .replace(/^window\.cc\s*=\s*/, "")
      .replace(/;\s*$/, "");
    const standards: Record<string, Record<string, string>> = JSON.parse(raw).standards;
    expect(errata.text.map((e) => e.code).sort()).toEqual(["1.OA.C.6", "A-SSE.B.3.c"]);
    for (const e of errata.text) {
      for (const k of ["code", "field", "raw", "corrected", "why", "source", "citation"] as const) {
        expect(typeof e[k], `${e.code}.${k}`).toBe("string");
      }
      expect(e.raw).not.toBe(e.corrected);
      expect(e.source).toMatch(/^https:\/\//);
      const id = nodeByCode.get(e.code)!.id;
      expect(standards[id][e.field].split(e.raw).length - 1, e.code).toBe(1);
    }
  });

  it("A-SSE.B.3.c ships 1/12 as the exponent of 1.15, inside the outer 12t exponent", () => {
    const desc = detailOf("A-SSE.B.3.c").desc!;
    expect(desc).toContain("(1.15<sup>1/12</sup>)<sup>12t</sup> ≈ 1.012<sup>12t </sup>");
    expect(desc).not.toContain("1.151/12");
    // The hover card and Browse snippet read it the way the published standard does.
    expect(searchOf("A-SSE.B.3.c").text).toContain("(1.15^(1/12))^(12t) ≈ 1.012^(12t) to reveal");
  });

  it("1.OA.C.6 ships no escaped <\\p> text, and no shard does", () => {
    expect(detailOf("1.OA.C.6").example).toContain("5+3 = 8 so it is also a 10.</p>");
    for (const g of GRADES) expect(JSON.stringify(shards[g]), g).not.toMatch(/&lt;\\\\?\/?p&gt;/);
  });

  it("applyErratum fails loudly when the raw text is missing or repeated", () => {
    const e: Erratum = {
      code: "X",
      field: "desc",
      raw: "ab",
      corrected: "a$&b",
      why: "",
      source: "",
      citation: "",
    };
    expect(applyErratum("xaby", e)).toBe("xa$&by"); // a literal replacement, no $ patterns
    expect(() => applyErratum("xy", e)).toThrow(/found it 0 times/);
    expect(() => applyErratum("ab ab", e)).toThrow(/found it 2 times/);
    expect(() => applyErratum(undefined, e)).toThrow(/found it 0 times/);
  });
});

describe("cluster and domain names ship as plain text", () => {
  const clusterNames: [string, string][] = [];
  const domainNames: [string, string][] = [];
  for (const n of core.nodes) {
    domainNames.push([n.code, n.domainName]);
    const c = shards[n.grade][n.id].clusterName;
    if (c !== undefined) clusterNames.push([n.code, c]);
  }
  for (const d of search) {
    clusterNames.push([d.code, d.clusterName]);
    domainNames.push([d.code, d.domainName]);
  }

  it("no clusterName or domainName carries a tag, an entity, or a dangling footnote marker", () => {
    expect(clusterNames.length).toBe(960);
    for (const [code, name] of [...clusterNames, ...domainNames]) {
      expect(name, code).not.toContain("<");
      expect(name, code).not.toMatch(ENTITY);
      expect(name, code).not.toMatch(/\*$/);
      expect(name, code).toBe(name.trim());
      expect(name.length, code).toBeGreaterThan(0);
    }
  });

  it("reads the six marked-up clusters as their words", () => {
    expect(detailOf("1.OA.B.3").clusterName).toBe(
      "Understand And Apply Properties Of Operations And The Relationship Between Addition And Subtraction.",
    );
    expect(detailOf("2.NBT.B.5").clusterName).toBe(
      "Use Place Value Understanding And Properties Of Operations To Add And Subtract.",
    );
    // 3.NBT.A carried a footnote paragraph after the heading.
    expect(detailOf("3.NBT.A.1").clusterName).toBe(
      "Use Place Value Understanding And Properties Of Operations To Perform Multi-Digit Arithmetic.",
    );
    expect(searchOf("7.EE.A.2").clusterName).toBe("Use Properties Of Operations To Generate Equivalent Expressions.");
  });

  it("drops the starred domain twins, so each strand lists a domain once", () => {
    expect(nodeByCode.get("4.NF.A.1")!.domainName).toBe("Number And Operations-Fractions");
    expect(nodeByCode.get("4.NBT.A.1")!.domainName).toBe("Number And Operations In Base Ten");
    const number = new Set(core.nodes.filter((n) => n.strand === "number").map((n) => n.domainName));
    for (const name of number) expect(number.has(`${name}*`), name).toBe(false);
  });

  it("plainName strips tags, decodes entities once, drops the footnote block, and trims", () => {
    expect(
      plainName(
        'Use <a id="[3]" name="[3]">Properties Of Operations</a> To Add.*</p>\r\n\r\n<p>&nbsp;</p>\r\n\r\n<p><sup>*A range of algorithms may be used.</sup></p>\r\n',
      ),
    ).toBe("Use Properties Of Operations To Add.");
    expect(plainName("Ratios &amp; Proportional Relationships")).toBe("Ratios & Proportional Relationships");
    expect(plainName("Number And Operations-Fractions*")).toBe("Number And Operations-Fractions");
    expect(plainName("Work With Numbers 11–19 To Gain Foundations For Place Value.")).toBe(
      "Work With Numbers 11–19 To Gain Foundations For Place Value.",
    );
    expect(plainName(undefined)).toBe("");
  });
});

describe("glossary definitions", () => {
  it("no definition is a bare table pointer like [3]", () => {
    expect(defs.length).toBeGreaterThan(100);
    for (const { code, def } of defs) expect(def, code).not.toMatch(/^\[\d+\]$/);
  });

  it("no definition starts or ends with a straight quote mark", () => {
    for (const { code, def } of defs) {
      expect(def, code).not.toMatch(/^"/);
      expect(def, code).not.toMatch(/"$/);
    }
  });

  it('"properties of operations" carries the designer\'s Table 3 definition in all 23 standards', () => {
    expect(errata.glossaryTables["[3]"].def).toBe(TABLE_3);
    const withTable3 = new Set(defs.filter((d) => d.def === TABLE_3).map((d) => d.code));
    expect(withTable3.size).toBe(23);
    expect(withTable3.has("1.OA.B.3")).toBe(true);
    expect(withTable3.has("7.NS.A.2.c")).toBe(true);
    expect(detailOf("1.OA.B.3").desc).toMatch(/<span class="term" data-def="The rules that hold[^"]*Table 3\.">properties of operations<\/span>/);
  });

  it("keeps a closing quote that belongs to a quotation (1.OA.C.6 counting on)", () => {
    const countingOn = defs.find((d) => d.code === "1.OA.C.6" && d.def.startsWith("A strategy for finding"));
    expect(countingOn?.def.endsWith("There are eleven books now.”")).toBe(true);
  });

  it("the unwrapped definitions keep their words", () => {
    const expanded = defs.find((d) => d.code === "2.NBT.A.3" && d.def.includes("expanded form"))?.def;
    expect(expanded).toBe(
      "A multi-digit number is expressed in expanded form when it is written as a sum of single-digit multiples of powers of ten. For example, 643 = 600 + 40 + 3.",
    );
  });

  it("glossaryDef maps [3], unwraps a quoted pair, and refuses an unmapped table pointer", () => {
    expect(glossaryDef("[3]")).toBe(TABLE_3);
    expect(glossaryDef('"A whole number."')).toBe("A whole number.");
    expect(glossaryDef('saying “eight.”')).toBe('saying “eight.”');
    expect(glossaryDef("The numbers 0, 1, 2, 3, ….")).toBe("The numbers 0, 1, 2, 3, ….");
    expect(() => glossaryDef("[7]")).toThrow(/no definition in scripts\/errata\.json/);
  });

  it("sanitizeField turns a [3] anchor into a term span with the Table 3 definition", () => {
    const out = sanitizeField('<p>use <a id="[3]" name="[3]">properties of operations</a>.</p>');
    expect(out).toBe(`<p>use <span class="term" data-def="${TABLE_3}">properties of operations</span>.</p>`);
  });
});
