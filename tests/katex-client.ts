/**
 * Render a shipped HTML field the way the client does, with no browser.
 *
 * The client (src/ui/panel.ts, src/ui/browse.ts) assigns the field through
 * innerHTML, wraps bare display environments in \[…\], then runs KaTeX
 * auto-render with its own delimiter list and `throwOnError: false`. A parse
 * error then shows the reader red source text (`span.katex-error`) instead of
 * math. This helper runs the REAL auto-render over a minimal DOM stand-in:
 * - the HTML is tokenized into elements and text nodes, with one entity decode
 *   per text node (the innerHTML decode),
 * - wrapBareEnvironments is a copy of the client's,
 * - katex.render is swapped for renderToString with the same options, so every
 *   formula auto-render finds is rendered exactly as the client would.
 *
 * Keep CLIENT_OPTIONS, DISPLAY_ENV, and DELIMITED_SPAN in step with the client.
 */
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";
import { decodeHTML } from "entities";

export const CLIENT_OPTIONS = {
  delimiters: [
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
  ],
  throwOnError: false,
  ignoredClasses: ["term"],
};

// Copied from the client's wrapBareEnvironments.
export const DISPLAY_ENV =
  /\\begin\{(align\*?|alignat\*?|gather\*?|equation\*?|multline\*?|split|cases)\}[\s\S]*?\\end\{\1\}/g;
const DELIMITED_SPAN = /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;

export interface RenderedFormula {
  tex: string;
  display: boolean;
  /** KaTeX's error message when the formula rendered as red error text. */
  error?: string;
}

type FakeNode = FakeText | FakeElement;

class FakeText {
  readonly nodeType = 3;
  parent: FakeElement | FakeFragment | null = null;
  constructor(public data: string) {}
  get textContent(): string {
    return this.data;
  }
  get nextSibling(): FakeNode | null {
    return siblingAfter(this);
  }
  remove(): void {
    detach(this);
  }
}

class FakeFragment {
  childNodes: FakeNode[] = [];
  appendChild(n: FakeNode): FakeNode {
    n.parent = this;
    this.childNodes.push(n);
    return n;
  }
}

class FakeElement {
  readonly nodeType = 1;
  parent: FakeElement | FakeFragment | null = null;
  childNodes: FakeNode[] = [];
  className = "";
  constructor(public nodeName: string) {}
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  get nextSibling(): FakeNode | null {
    return siblingAfter(this);
  }
  appendChild(n: FakeNode): FakeNode {
    n.parent = this;
    this.childNodes.push(n);
    return n;
  }
  replaceChild(next: FakeNode | FakeFragment, old: FakeNode): void {
    const i = this.childNodes.indexOf(old);
    const incoming = next instanceof FakeFragment ? next.childNodes.splice(0) : [next];
    for (const n of incoming) n.parent = this;
    this.childNodes.splice(i, 1, ...incoming);
  }
  remove(): void {
    detach(this);
  }
}

function siblingAfter(n: FakeNode): FakeNode | null {
  const kids = n.parent?.childNodes ?? [];
  return kids[kids.indexOf(n) + 1] ?? null;
}
function detach(n: FakeNode): void {
  const kids = n.parent?.childNodes;
  if (kids) kids.splice(kids.indexOf(n), 1);
  n.parent = null;
}

const VOID = new Set(["br", "img", "hr", "wbr", "input", "col", "area"]);

/** Build the element tree innerHTML would build for sanitizer output. */
function parse(html: string): FakeElement {
  const root = new FakeElement("DIV");
  const stack: FakeElement[] = [root];
  const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+|<)/g;
  for (const m of html.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      const last = top.childNodes[top.childNodes.length - 1];
      const text = decodeHTML(m[4]);
      if (last instanceof FakeText) last.data += text;
      else top.appendChild(new FakeText(text));
      continue;
    }
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((e) => e.nodeName.toLowerCase()).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const el = new FakeElement(name.toUpperCase());
    const cls = /\bclass="([^"]*)"/.exec(m[3]);
    if (cls) el.className = decodeHTML(cls[1]);
    top.appendChild(el);
    if (!VOID.has(name) && !m[3].trim().endsWith("/")) stack.push(el);
  }
  return root;
}

function textNodes(el: FakeElement, out: FakeText[] = []): FakeText[] {
  for (const c of el.childNodes) {
    if (c instanceof FakeText) out.push(c);
    else textNodes(c, out);
  }
  return out;
}

/** The client's wrapBareEnvironments, over the stand-in tree. */
function wrapBareEnvironments(root: FakeElement): void {
  for (const t of textNodes(root)) {
    if (!t.data.includes("\\begin{")) continue;
    const spans: [number, number][] = [];
    DELIMITED_SPAN.lastIndex = 0;
    for (let m = DELIMITED_SPAN.exec(t.data); m; m = DELIMITED_SPAN.exec(t.data)) {
      spans.push([m.index, m.index + m[0].length]);
    }
    t.data = t.data.replace(DISPLAY_ENV, (m, _env, offset: number) => {
      if (spans.some(([a, b]) => offset >= a && offset < b)) return m;
      return `\\[${m}\\]`;
    });
  }
}

// KaTeX's default errorColor. The client does not set its own.
const ERROR_COLOR = "#cc0000";

/**
 * The red text a reader would see for this formula, or undefined when it
 * renders clean. With `throwOnError: false` KaTeX shows a failure two ways:
 * - a parse error turns the whole formula into `span.katex-error` (red source
 *   text, the message in its title),
 * - an unknown command (`\mbox` in KaTeX 0.17) renders as its own name in red
 *   while the rest of the formula renders.
 */
function renderError(tex: string, opts: katex.KatexOptions): string | undefined {
  const out = katex.renderToString(tex, opts);
  const parse = /class="katex-error"[^>]*title="([^"]*)"/.exec(out);
  if (parse) return decodeHTML(parse[1]);
  if (!out.includes(ERROR_COLOR)) return undefined;
  const names = [...out.matchAll(/mathcolor="#cc0000"><mtext>([^<]*)<\/mtext>/g)].map((m) =>
    decodeHTML(m[1]),
  );
  return `Unknown command rendered in red: ${names.join(", ") || "(unnamed)"}`;
}

export interface ClientRender {
  /** Every formula auto-render found, with the red error each one shows. */
  formulas: RenderedFormula[];
  /**
   * LaTeX left in the visible text after rendering: a command (`\begin`,
   * `\frac`) or a math delimiter that auto-render never picked up, which the
   * reader sees as raw source.
   */
  rawTex: string[];
}

// Two or more letters: 1.OA.C.6's source prose carries a literal "<\p>" typo
// (`&lt;\p&gt;`), which is not LaTeX.
const RAW_TEX = /\\(?:[a-zA-Z]{2,}|[()[\]])/g;

/** Render one shipped HTML field the way the client does. */
export function renderLikeClient(html: string): ClientRender {
  const root = parse(html);
  wrapBareEnvironments(root);
  const formulas: RenderedFormula[] = [];
  const k = katex as unknown as { render: unknown };
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { render: k.render, document: g.document, Node: g.Node };
  k.render = (tex: string, _span: unknown, opts: katex.KatexOptions): void => {
    formulas.push({ tex, display: Boolean(opts.displayMode), error: renderError(tex, opts) });
  };
  g.document = {
    createDocumentFragment: () => new FakeFragment(),
    createTextNode: (s: string) => new FakeText(s),
    createElement: (name: string) => new FakeElement(name.toUpperCase()),
  };
  g.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  try {
    renderMathInElement(root as unknown as HTMLElement, CLIENT_OPTIONS);
  } finally {
    k.render = saved.render;
    g.document = saved.document;
    g.Node = saved.Node;
  }
  const rawTex: string[] = [];
  for (const t of textNodes(root)) {
    for (const m of t.data.matchAll(RAW_TEX)) {
      rawTex.push(t.data.slice(Math.max(0, m.index - 30), m.index + 50));
    }
  }
  return { formulas, rawTex };
}
