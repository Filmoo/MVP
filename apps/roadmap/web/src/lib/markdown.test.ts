import { describe, expect, it } from "vitest";
import { inline, parse, plain, safeHref } from "./markdown";

describe("inline markdown", () => {
  it("reads bold, italic, code and links", () => {
    expect(inline("a **bold** and *it* with `x<y>`")).toEqual([
      { t: "text", v: "a " },
      { t: "strong", c: [{ t: "text", v: "bold" }] },
      { t: "text", v: " and " },
      { t: "em", c: [{ t: "text", v: "it" }] },
      { t: "text", v: " with " },
      { t: "code", v: "x<y>" },
    ]);
    expect(inline("[PR](https://github.com/Filmoo/MVP/pull/1)")).toEqual([
      { t: "link", href: "https://github.com/Filmoo/MVP/pull/1", c: [{ t: "text", v: "PR" }] },
    ]);
  });

  it("keeps unsafe links as text", () => {
    expect(inline("[x](javascript:alert(1))")[0]).toEqual({ t: "text", v: "x" });
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("mailto:owner@example.com")).toBe("mailto:owner@example.com");
    expect(inline("<script>alert(1)</script>")).toEqual([{ t: "text", v: "<script>alert(1)</script>" }]);
  });

  it("links bare URLs without their trailing punctuation", () => {
    expect(inline("see https://mvpgg.com/versions.")).toEqual([
      { t: "text", v: "see " },
      { t: "link", href: "https://mvpgg.com/versions", c: [{ t: "text", v: "mvpgg.com/versions" }] },
      { t: "text", v: "." },
    ]);
  });

  it("leaves snake_case alone", () => {
    expect(inline("riot_api and match_v5_timeline")).toEqual([{ t: "text", v: "riot_api and match_v5_timeline" }]);
  });
});

describe("blocks", () => {
  it("reads headings, lists, quotes, code and paragraphs", () => {
    const blocks = parse("# Title\n\nText on\ntwo lines.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```\ncode()\n```\n\n---");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "quote", "pre", "hr"]);
    expect(blocks[1]).toEqual({ t: "p", c: [{ t: "text", v: "Text on" }, { t: "br" }, { t: "text", v: "two lines." }] });
    expect(blocks[5]).toEqual({ t: "pre", v: "code()" });
  });

  it("gives a plain preview", () => {
    expect(plain("## Why\nPatch **over** patch.")).toBe("Why");
    expect(plain("Gold, `damage` and XP.\n\nMore.")).toBe("Gold, damage and XP.");
    expect(plain("- a\n- b")).toBe("a · b");
    expect(plain("")).toBe("");
  });
});
