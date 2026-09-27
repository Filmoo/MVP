/**
 * In-page design-token audit (self-contained: runs in the browser).
 * Every rendered element must use values from src/design/tokens.css.
 * Decorative subtrees opt out with the `data-free-style` attribute.
 */
export interface StyleViolation {
  property: string;
  value: string;
  element: string;
}

export function auditTokens(): StyleViolation[] {
  const root = getComputedStyle(document.documentElement);
  const tokens = (prefix: string) =>
    [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .flatMap((rule) => (rule instanceof CSSStyleRule && rule.selectorText === ":root" ? [...rule.style] : []))
      .filter((name) => name.startsWith(prefix))
      .map((name) => root.getPropertyValue(name).trim());

  // Normalize any CSS color to the computed rgb()/rgba() string.
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  const toRgb = (c: string) => {
    probe.style.color = "";
    probe.style.color = c;
    return getComputedStyle(probe).color;
  };
  const colorNames = ["--bg-", "--line-", "--text-", "--accent", "--win", "--loss", "--warn", "--good", "--tier-", "--rank-", "--role-"];
  const palette = new Set(
    colorNames
      .flatMap((p) => tokens(p))
      .filter((v) => v.startsWith("#"))
      .map(toRgb),
  );
  probe.remove();
  palette.add("rgba(0, 0, 0, 0)");

  const px = (values: string[]) => new Set(values.map((v) => Number.parseFloat(v)).filter((n) => !Number.isNaN(n)));
  const spacing = px(tokens("--space-"));
  spacing.add(0);
  const fontSizes = px(tokens("--text-").filter((v) => v.endsWith("px")));
  const radii = px(tokens("--radius-"));
  radii.add(0);
  const weights = new Set(["400", "500", "600", "700"]);

  const violations: StyleViolation[] = [];
  const seen = new Set<string>();
  const add = (property: string, value: string, el: Element) => {
    const cls = typeof el.className === "string" ? (el.className.split(/\s+/)[0] ?? "") : "";
    const element = `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    const key = `${property}|${value}|${element}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push({ property, value, element });
    }
  };

  for (const el of document.querySelectorAll("#root *")) {
    if (el.closest("[data-free-style]") || el.closest("svg")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;

    if (!fontSizes.has(Number.parseFloat(cs.fontSize))) add("font-size", cs.fontSize, el);
    if (!weights.has(cs.fontWeight)) add("font-weight", cs.fontWeight, el);

    for (const prop of [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "row-gap",
      "column-gap",
    ]) {
      const value = cs.getPropertyValue(prop);
      if (value === "normal" || value === "auto") continue;
      const n = Math.abs(Number.parseFloat(value));
      if (!Number.isNaN(n) && !spacing.has(n)) add(prop, value, el);
    }

    for (const prop of ["border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius"]) {
      const n = Number.parseFloat(cs.getPropertyValue(prop));
      if (!Number.isNaN(n) && !radii.has(n)) add(prop, cs.getPropertyValue(prop), el);
    }

    const colors: Array<[string, string]> = [
      ["color", cs.color],
      ["background-color", cs.backgroundColor],
    ];
    for (const side of ["top", "right", "bottom", "left"]) {
      if (Number.parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0)
        colors.push([`border-${side}-color`, cs.getPropertyValue(`border-${side}-color`)]);
    }
    for (const [prop, value] of colors) {
      if (!palette.has(value)) add(prop, value, el);
    }
  }
  return violations;
}
