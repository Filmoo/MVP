/**
 * The markdown descriptions and comments are written in, parsed to a small tree the UI renders
 * with elements (never innerHTML): paragraphs, headings, lists, quotes, code, rules; bold,
 * italic, code, links and bare URLs. Links keep http(s) and mailto only; anything else is text.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "pre"; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "hr" };

/** A link target we accept, or null. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(trimmed) ? trimmed : null;
}

const BARE_URL = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/;

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ t: "text", v: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const char = text[i] ?? "";
    if (char === "\\" && i + 1 < text.length && /[\\`*_[\]()#>-]/.test(text[i + 1] ?? "")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      out.push({ t: "strong", c: inline(strong[2] ?? "") });
      i += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![*_])/.exec(rest);
    if (em && (char === "*" || !/\w/.test(text[i - 1] ?? ""))) {
      flush();
      out.push({ t: "em", c: inline(em[2] ?? "") });
      i += em[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flush();
      const href = safeHref(link[2] ?? "");
      if (href) out.push({ t: "link", href, c: inline(link[1] ?? "") });
      else out.push({ t: "text", v: link[1] ?? "" });
      i += link[0].length;
      continue;
    }
    const bare = BARE_URL.exec(rest);
    if (bare && bare.index === 0 && !/\w/.test(text[i - 1] ?? "")) {
      flush();
      out.push({ t: "link", href: bare[0], c: [{ t: "text", v: bare[0].replace(/^https?:\/\//, "") }] });
      i += bare[0].length;
      continue;
    }
    if (char === "\n") {
      flush();
      out.push({ t: "br" });
      i += 1;
      continue;
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

const ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^\s{0,3}```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s{0,3}```/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i += 1;
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    const heading = /^\s{0,3}(#{1,3})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ t: "h", level: (heading[1]?.length ?? 1) as 1 | 2 | 3, c: inline(heading[2] ?? "") });
      i += 1;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i += 1;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i] ?? "")) quoted.push((lines[i++] ?? "").replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ t: "quote", c: parse(quoted.join("\n")) });
      continue;
    }
    const first = ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[1] ?? "");
      const items: Inline[][] = [];
      let current: string[] = [];
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const item = ITEM.exec(next);
        if (item && /\d/.test(item[1] ?? "") === ordered) {
          if (current.length) items.push(inline(current.join("\n")));
          current = [item[2] ?? ""];
        } else if (next.trim() && /^\s+/.test(next)) {
          current.push(next.trim());
        } else {
          break;
        }
        i += 1;
      }
      if (current.length) items.push(inline(current.join("\n")));
      blocks.push(ordered ? { t: "ol", items, start: Number.parseInt(first[1] ?? "1", 10) || 1 } : { t: "ul", items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (!next.trim() || /^\s{0,3}(```|#{1,3}\s|>)/.test(next) || ITEM.test(next)) break;
      paragraph.push(next.trim());
      i += 1;
    }
    blocks.push({ t: "p", c: inline(paragraph.join("\n")) });
  }
  return blocks;
}

/** The first paragraph's plain words (card previews, the inbox). */
export function plain(source: string): string {
  const text = (nodes: Inline[]): string =>
    nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? " " : text(n.c))).join("");
  for (const block of parse(source)) {
    if (block.t === "p" || block.t === "h") return text(block.c);
    if (block.t === "ul" || block.t === "ol") return block.items.map(text).join(" · ");
  }
  return "";
}
