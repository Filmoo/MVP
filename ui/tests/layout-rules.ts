/**
 * In-page layout audit. Runs inside the browser via page.evaluate, so it must be
 * self-contained (no imports, no closures over test code).
 */
export interface Violation {
  rule: string;
  element: string;
  detail: string;
}

export function auditLayout(): Violation[] {
  const violations: Violation[] = [];
  const vw = window.innerWidth;
  const TOL = 1; // subpixel tolerance

  const describe = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && node.id !== "root" && depth < 4; depth++, node = node.parentElement) {
      const widget = node.getAttribute("data-widget") ?? node.getAttribute("data-testid");
      const cls = typeof node.className === "string" ? node.className.split(/\s+/).filter(Boolean)[0] : undefined;
      parts.unshift(`${node.tagName.toLowerCase()}${widget ? `[${widget}]` : cls ? `.${cls.replace(/_[a-zA-Z0-9-]+$/, "")}` : ""}`);
      if (widget) break;
    }
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${parts.join(" > ")}${text ? ` "${text}"` : ""}`;
  };

  const isRendered = (el: Element): boolean => {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const inScrollX = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll") return p.tagName.toLowerCase() !== "main";
    }
    return false;
  };

  const hasOwnText = (el: Element): boolean =>
    [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);

  // 1. Nothing scrolls horizontally at page level.
  if (document.documentElement.scrollWidth > vw + TOL) {
    violations.push({ rule: "page-hscroll", element: "html", detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` });
  }
  const main = document.querySelector("main");
  if (main && main.scrollWidth > main.clientWidth + TOL) {
    violations.push({ rule: "main-hscroll", element: "main", detail: `scrollWidth ${main.scrollWidth} > ${main.clientWidth}` });
  }

  const all = [...document.querySelectorAll("#root *")].filter(isRendered) as HTMLElement[];

  for (const el of all) {
    if (el instanceof SVGElement) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    // 2. Content spilling out of a box that doesn't clip or scroll.
    if (cs.overflowX === "visible" && cs.display !== "inline" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + TOL) {
      violations.push({
        rule: "content-overflow",
        element: describe(el),
        detail: `content ${el.scrollWidth}px in ${el.clientWidth}px box`,
      });
    }

    // 3. Text cut off without an ellipsis.
    if (
      hasOwnText(el) &&
      (cs.overflowX === "hidden" || cs.overflowX === "clip") &&
      cs.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + TOL
    ) {
      violations.push({
        rule: "clipped-text",
        element: describe(el),
        detail: `text ${el.scrollWidth}px in ${el.clientWidth}px, no ellipsis`,
      });
    }

    // 4. Truncated text squeezed to (almost) nothing.
    if (hasOwnText(el) && cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + TOL && el.clientWidth < 40) {
      violations.push({ rule: "text-collapsed", element: describe(el), detail: `only ${el.clientWidth}px visible of ${el.scrollWidth}px` });
    }

    // 5. Elements pushed outside the window.
    if (cs.position !== "fixed" && (r.right > vw + TOL || r.left < -TOL) && !inScrollX(el)) {
      violations.push({
        rule: "offscreen",
        element: describe(el),
        detail: `x ${Math.round(r.left)}→${Math.round(r.right)} outside 0→${vw}`,
      });
    }

    // 6. Readable text only.
    if (hasOwnText(el) && Number.parseFloat(cs.fontSize) < 11) {
      violations.push({ rule: "tiny-text", element: describe(el), detail: `font-size ${cs.fontSize}` });
    }

    // 7. Siblings in flex/grid layouts never overlap.
    if (/^(inline-)?(flex|grid)$/.test(cs.display)) {
      const kids = ([...el.children] as HTMLElement[]).filter((k) => {
        if (!isRendered(k)) return false;
        const p = getComputedStyle(k).position;
        return p !== "absolute" && p !== "fixed";
      });
      const rects = kids.map((k) => k.getBoundingClientRect());
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i] as DOMRect;
          const b = rects[j] as DOMRect;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > TOL && oy > TOL) {
            violations.push({
              rule: "overlap",
              element: describe(el),
              detail: `${describe(kids[i] as Element)} overlaps ${describe(kids[j] as Element)} by ${Math.round(ox)}×${Math.round(oy)}px`,
            });
          }
        }
      }
    }
  }

  // 8. Widgets keep a usable size (a `hideable` one may be hidden outright, never squeezed).
  for (const w of document.querySelectorAll<HTMLElement>("[data-widget]")) {
    if (w.hasAttribute("data-hideable") && getComputedStyle(w).display === "none") continue;
    const r = w.getBoundingClientRect();
    if (r.width < 160 || r.height < 40) {
      violations.push({ rule: "widget-squeezed", element: describe(w), detail: `${Math.round(r.width)}×${Math.round(r.height)}px` });
    }
  }

  return violations;
}
