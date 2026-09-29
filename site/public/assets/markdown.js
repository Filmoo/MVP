// Release notes (markdown written on GitHub) → DOM nodes, built with createElement and text
// nodes only: nothing is ever parsed as HTML, so a note can't inject markup or scripts.
//
// Blocks: ATX and setext headings, paragraphs (a single newline is a line break, as on GitHub),
// lists (nested, ordered or not), fenced code, block quotes, rules. Inline: code, bold, italic,
// strikethrough, links, <autolinks>, bare URLs (this repository's pull requests, issues,
// commits and comparisons shortened the way GitHub shows them), @mentions, #123 references and
// backslash escapes. Raw HTML stays visible as text; HTML comments are dropped (GitHub puts one
// at the top of generated notes). Links keep http(s) and mailto only; images become links.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/;
const MENTION = /^@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![\w/-])/;
const ISSUE = /^#(\d{1,7})(?!\w)/;

const leading = (line) => line.length - line.trimStart().length;

/**
 * @param {string} source markdown
 * @param {{ repo?: string, headingLevel?: number }} options `repo` is `owner/name` (links to its
 *   issues, relative links to its files); the notes' biggest heading becomes `h{headingLevel}`.
 * @returns {DocumentFragment}
 */
export function renderMarkdown(source, options = {}) {
  const repo = options.repo ?? "Filmoo/MVP";
  const ctx = {
    repo,
    repoUrl: `https://github.com/${repo}`,
    base: `https://github.com/${repo}/blob/main/`,
    inLink: false,
  };
  const text = String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\t+/gm, (tabs) => "    ".repeat(tabs.length));
  const blocks = parseBlocks(text.split("\n"));
  const top = Math.min(7, ...headingLevels(blocks));
  const shift = (options.headingLevel ?? 3) - (top === 7 ? 1 : top);
  const fragment = document.createDocumentFragment();
  for (const block of blocks) fragment.append(renderBlock(block, { ...ctx, shift }, false));
  return fragment;
}

function headingLevels(blocks) {
  const levels = [];
  for (const block of blocks) {
    if (block.type === "h") levels.push(block.level);
    if (block.type === "quote") levels.push(...headingLevels(block.children));
    if (block.items) for (const item of block.items) levels.push(...headingLevels(item));
  }
  return levels;
}

function parseBlocks(lines) {
  const blocks = [];
  let paragraph = null;
  const flush = () => {
    if (paragraph) blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = null;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const setext = paragraph ? SETEXT.exec(line) : null;
    const fence = FENCE.exec(line)?.[1];
    const atx = ATX.exec(line);
    if (!line.trim()) {
      flush();
      i++;
    } else if (setext) {
      blocks.push({ type: "h", level: setext[1][0] === "=" ? 1 : 2, text: paragraph.join(" ") });
      paragraph = null;
      i++;
    } else if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence) && !lines[i].trim().slice(fence.length).trim())) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      i++;
    } else if (atx) {
      flush();
      blocks.push({ type: "h", level: atx[1].length, text: atx[2] ?? "" });
      i++;
    } else if (RULE.test(line)) {
      flush();
      blocks.push({ type: "hr" });
      i++;
    } else if (QUOTE.test(line)) {
      flush();
      const inner = [];
      for (; i < lines.length; i++) {
        const quoted = QUOTE.exec(lines[i]);
        if (!quoted) break;
        inner.push(quoted[1]);
      }
      blocks.push({ type: "quote", children: parseBlocks(inner) });
    } else if (ITEM.test(line)) {
      flush();
      const list = parseList(lines, i);
      blocks.push(list.block);
      i = list.next;
    } else {
      paragraph ??= [];
      paragraph.push(line);
      i++;
    }
  }
  flush();
  return blocks;
}

function parseList(lines, start) {
  const first = ITEM.exec(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const block = { type: ordered ? "ol" : "ul", start: ordered ? Number.parseInt(first[2], 10) : 1, items: [], loose: false };
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = indent + m[2].length + 1;
    const content = [m[3] ?? ""];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let next = i + 1;
        while (next < lines.length && !lines[next].trim()) next++;
        if (next < lines.length && leading(lines[next]) >= contentIndent) {
          content.push(...lines.slice(i, next).map(() => ""));
          block.loose = true;
          i = next;
          continue;
        }
        break;
      }
      const item = ITEM.exec(line);
      if (item && item[1].length <= indent) break;
      if (leading(line) > indent) {
        content.push(line.slice(Math.min(leading(line), contentIndent)));
        i++;
        continue;
      }
      // A plain line right under the item's text continues it (lazy continuation).
      if (!item && !FENCE.test(line) && !ATX.test(line) && !QUOTE.test(line) && content[content.length - 1].trim()) {
        content.push(line.trim());
        i++;
        continue;
      }
      break;
    }
    block.items.push(parseBlocks(content));
    // Blank lines between two items of this list: it goes on, loosely.
    let next = i;
    while (next < lines.length && !lines[next].trim()) next++;
    const sibling = next < lines.length ? ITEM.exec(lines[next]) : null;
    if (next > i && sibling && sibling[1].length === indent && /\d/.test(sibling[2]) === ordered) {
      block.loose = true;
      i = next;
    }
  }
  return { block, next: i };
}

function renderBlock(block, ctx, tight) {
  switch (block.type) {
    case "h": {
      const level = Math.min(6, Math.max(1, block.level + ctx.shift));
      const heading = document.createElement(`h${level}`);
      inline(heading, block.text.trim(), ctx);
      return heading;
    }
    case "p": {
      if (tight) {
        const fragment = document.createDocumentFragment();
        inline(fragment, block.text.trim(), ctx);
        return fragment;
      }
      const paragraph = document.createElement("p");
      inline(paragraph, block.text.trim(), ctx);
      return paragraph;
    }
    case "code": {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.text;
      pre.append(code);
      return pre;
    }
    case "hr":
      return document.createElement("hr");
    case "quote": {
      const quote = document.createElement("blockquote");
      for (const child of block.children) quote.append(renderBlock(child, ctx, false));
      return quote;
    }
    default: {
      const list = document.createElement(block.type);
      if (block.type === "ol" && block.start !== 1) list.start = block.start;
      for (const item of block.items) {
        const li = document.createElement("li");
        item.forEach((child, index) => {
          if (index > 0 && !block.loose && child.type === "p") li.append(document.createElement("br"));
          li.append(renderBlock(child, ctx, !block.loose));
        });
        list.append(li);
      }
      return list;
    }
  }
}

// ---------- Inline ----------

function inline(parent, text, ctx) {
  let buffer = "";
  const flush = () => {
    if (buffer) parent.append(document.createTextNode(buffer));
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);

    if (ch === "\\" && PUNCTUATION.test(text[i + 1] ?? "")) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      // GitHub shows every newline of a release note as a line break.
      buffer = buffer.replace(/[ \t]+$|\\$/, "");
      flush();
      parent.append(document.createElement("br"));
      i++;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(rest)[0];
      let close = text.indexOf(run, i + run.length);
      while (close !== -1 && text[close + run.length] === "`") close = text.indexOf(run, close + run.length + 1);
      if (close !== -1) {
        flush();
        const code = document.createElement("code");
        const body = text.slice(i + run.length, close);
        code.textContent = /^ .*[^ ].* $/.test(body) ? body.slice(1, -1) : body;
        parent.append(code);
        i = close + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }
    if ((ch === "[" || (ch === "!" && text[i + 1] === "[")) && !ctx.inLink) {
      const image = ch === "!";
      const link = parseLink(text, image ? i + 1 : i);
      if (link) {
        flush();
        const anchor = makeLink(link.url, ctx);
        if (anchor) {
          if (image) anchor.textContent = link.text || link.url;
          else inline(anchor, link.text, { ...ctx, inLink: true });
          parent.append(anchor);
        } else {
          inline(parent, link.text, ctx);
        }
        i = link.end;
        continue;
      }
    }
    const autolink = ch === "<" && !ctx.inLink ? AUTOLINK.exec(rest) : null;
    if (autolink) {
      flush();
      appendAutolink(parent, autolink[1], ctx);
      i += autolink[0].length;
      continue;
    }
    const emphasisEnd = ch === "*" || ch === "_" ? emphasis(parent, text, i, ctx, flush) : 0;
    if (emphasisEnd) {
      i = emphasisEnd;
      continue;
    }
    const strikeEnd = ch === "~" && text[i + 1] === "~" ? strike(parent, text, i, ctx, flush) : 0;
    if (strikeEnd) {
      i = strikeEnd;
      continue;
    }
    if (!ctx.inLink && startsWord(text, i)) {
      const url = ch === "h" || ch === "w" ? BARE_URL.exec(rest) : null;
      if (url) {
        const raw = trimUrl(url[0]);
        flush();
        appendAutolink(parent, raw.startsWith("www.") ? `https://${raw}` : raw, ctx);
        i += raw.length;
        continue;
      }
      const mention = ch === "@" ? MENTION.exec(rest) : null;
      if (mention) {
        flush();
        parent.append(anchor(`https://github.com/${mention[1]}`, mention[0]));
        i += mention[0].length;
        continue;
      }
      const issue = ch === "#" ? ISSUE.exec(rest) : null;
      if (issue) {
        flush();
        parent.append(anchor(`${ctx.repoUrl}/issues/${issue[1]}`, issue[0]));
        i += issue[0].length;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();
}

const startsWord = (text, i) => i === 0 || /[\s([{"'“‘*_~]/.test(text[i - 1]);

function emphasis(parent, text, i, ctx, flush) {
  const ch = text[i];
  const run = text[i + 1] === ch ? 2 : 1;
  const after = text[i + run];
  if (!after || /\s/.test(after)) return 0;
  if (ch === "_" && i > 0 && WORD.test(text[i - 1])) return 0;
  const marker = ch.repeat(run);
  let j = i + run;
  for (;;) {
    j = text.indexOf(marker, j);
    if (j === -1) return 0;
    const inWord = ch === "_" && WORD.test(text[j + run] ?? "");
    const partOfLonger = run === 1 && (text[j + 1] === ch || text[j - 1] === ch);
    if (j > i + run && !/\s/.test(text[j - 1]) && !inWord && !partOfLonger) break;
    j += 1;
  }
  flush();
  const element = document.createElement(run === 2 ? "strong" : "em");
  inline(element, text.slice(i + run, j), ctx);
  parent.append(element);
  return j + run;
}

function strike(parent, text, i, ctx, flush) {
  const close = text.indexOf("~~", i + 2);
  if (close <= i + 2 || /\s/.test(text[i + 2]) || /\s/.test(text[close - 1])) return 0;
  flush();
  const element = document.createElement("del");
  inline(element, text.slice(i + 2, close), ctx);
  parent.append(element);
  return close + 2;
}

/** `[text](destination "title")` starting at `start` (a `[`), or null. */
function parseLink(text, start) {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") i++;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) break;
  }
  if (depth !== 0 || text[i + 1] !== "(") return null;
  const label = text.slice(start + 1, i);
  let j = i + 2;
  while (text[j] === " ") j++;
  let url = "";
  if (text[j] === "<") {
    const close = text.indexOf(">", j);
    if (close === -1) return null;
    url = text.slice(j + 1, close);
    j = close + 1;
  } else {
    let parens = 0;
    const from = j;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (/\s/.test(ch)) break;
      if (ch === "(") parens++;
      if (ch === ")") {
        if (parens === 0) break;
        parens--;
      }
    }
    url = text.slice(from, j);
  }
  const title = /^\s+(?:"[^"]*"|'[^']*'|\([^)]*\))/.exec(text.slice(j));
  if (title) j += title[0].length;
  while (text[j] === " ") j++;
  if (text[j] !== ")") return null;
  return { text: label, url, end: j + 1 };
}

function safeHref(raw, ctx) {
  try {
    const url = new URL(raw.trim(), ctx.base);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") return url.href;
  } catch {
    // Not a URL: the text stays, without a link.
  }
  return null;
}

function anchor(href, label) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "nofollow noopener noreferrer";
  a.textContent = label;
  return a;
}

function makeLink(raw, ctx) {
  const href = safeHref(raw, ctx);
  return href ? anchor(href, "") : null;
}

function appendAutolink(parent, raw, ctx) {
  const href = safeHref(raw, ctx);
  if (href) parent.append(anchor(href, shortLabel(href, ctx)));
  else parent.append(document.createTextNode(raw));
}

/** Drops punctuation that ends a sentence rather than the URL, and unbalanced closing parentheses. */
function trimUrl(url) {
  let out = url.replace(/[.,:;!?'"*_~]+$/, "");
  while (out.endsWith(")") && (out.match(/\(/g) ?? []).length < (out.match(/\)/g) ?? []).length) out = out.slice(0, -1);
  return out;
}

/** GitHub's own short forms: `#12`, `owner/repo#12`, `a1b2c3d`, `v0.1.0...v0.2.0`. */
function shortLabel(href, ctx) {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues|commit|compare)\/([^?#\s]+)$/.exec(href);
  if (!m) return href;
  const [, owner, name, kind, rest] = m;
  const other = `${owner}/${name}`.toLowerCase() === ctx.repo.toLowerCase() ? "" : `${owner}/${name}`;
  if (kind === "pull" || kind === "issues") return /^\d+$/.test(rest) ? `${other}#${rest}` : href;
  if (kind === "commit") return other ? `${other}@${rest.slice(0, 7)}` : rest.slice(0, 7);
  let range = rest;
  try {
    range = decodeURIComponent(rest);
  } catch {
    // Keep it encoded.
  }
  return other ? `${other} ${range}` : range;
}
