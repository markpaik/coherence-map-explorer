// Pure URL helpers for task / worked-example links, shared by panel.ts and
// browse.ts (tests/urls.test.ts). Two jobs:
//   - httpsUpgrade: bare http:// task and attachment URLs are promoted to https
//     at render time (the data pipeline is out of scope here, and IM / Achieve
//     the Core both serve https).
//   - sourceLabel: the mystery "(source)" link becomes a plain, honest label
//     naming where it goes, derived from the URL's own host.

/** Promote a bare http:// URL to https://. Leaves https / other schemes alone. */
export function httpsUpgrade(url: string): string {
  return url.startsWith("http://") ? "https:" + url.slice("http:".length) : url;
}

// Friendly names for the hosts we actually link to; everything else falls back
// to its bare domain (www. stripped) so the label is still truthful.
const HOST_NAMES: Record<string, string> = {
  "illustrativemathematics.org": "Illustrative Mathematics",
  "tasks.illustrativemathematics.org": "Illustrative Mathematics",
  "achievethecore.org": "Achieve the Core",
  "tools.achievethecore.org": "Achieve the Core",
};

/** The publisher name for a URL's host, or the cleaned domain when unknown. */
export function sourceHostName(url: string): string {
  let host = "";
  try {
    host = new URL(httpsUpgrade(url)).hostname.toLowerCase();
  } catch {
    return "the source";
  }
  if (HOST_NAMES[host]) return HOST_NAMES[host];
  const bare = host.replace(/^www\./, "");
  // Known publisher on any subdomain (e.g. tasks.illustrativemathematics.org).
  for (const [known, name] of Object.entries(HOST_NAMES)) {
    if (bare === known || bare.endsWith("." + known)) return name;
  }
  return bare || "the source";
}

/** Full accessible label for a worked-example / task source link. */
export function sourceLinkLabel(url: string): string {
  return `Open full task at ${sourceHostName(url)}`;
}
