// Task / worked-example URL helpers: https upgrade + honest source labels.

import { describe, it, expect } from "vitest";
import { httpsUpgrade, sourceHostName, sourceLinkLabel } from "../src/ui/urls";

describe("httpsUpgrade", () => {
  it("promotes bare http:// to https://", () => {
    expect(httpsUpgrade("http://tasks.illustrativemathematics.org/1")).toBe(
      "https://tasks.illustrativemathematics.org/1",
    );
  });
  it("leaves https and other schemes untouched", () => {
    expect(httpsUpgrade("https://x.org/a")).toBe("https://x.org/a");
    expect(httpsUpgrade("/data/details/4.json")).toBe("/data/details/4.json");
  });
  it("does not rewrite http inside the path", () => {
    expect(httpsUpgrade("https://x.org/go?u=http://y")).toBe(
      "https://x.org/go?u=http://y",
    );
  });
});

describe("sourceHostName / sourceLinkLabel", () => {
  it("names Illustrative Mathematics from its host (incl. subdomains)", () => {
    expect(sourceHostName("https://tasks.illustrativemathematics.org/7")).toBe(
      "Illustrative Mathematics",
    );
    expect(sourceLinkLabel("http://illustrativemathematics.org/7")).toBe(
      "Open full task at Illustrative Mathematics",
    );
  });
  it("names Achieve the Core", () => {
    expect(sourceHostName("https://achievethecore.org/x")).toBe("Achieve the Core");
  });
  it("falls back to the bare domain for unknown hosts", () => {
    expect(sourceHostName("https://www.example.com/x")).toBe("example.com");
    expect(sourceLinkLabel("https://foo.bar/x")).toBe("Open full task at foo.bar");
  });
  it("degrades gracefully on an unparseable URL", () => {
    expect(sourceHostName("not a url")).toBe("the source");
  });
});
