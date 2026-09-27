import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Static checks on container queries: mistakes here fail silently in the browser.
const SRC = join(import.meta.dirname, "../../src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

const files = cssFiles(SRC).map((path) => ({
  name: relative(SRC, path),
  css: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
}));

/** `name -> selectors` of the rules that declare `container: name / ...`. */
function declaredContainers(css: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [, selectors = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = /(?:^|;)\s*container(?:-name)?\s*:\s*([\w-]+)/.exec(body)?.[1];
    if (!name) continue;
    const set = found.get(name) ?? new Set();
    for (const s of selectors.split(",")) set.add(s.trim());
    found.set(name, set);
  }
  return found;
}

/** `[name, selectors styled inside @container name (...)]` for every container query. */
function containerQueries(css: string): Array<[string, string[]]> {
  const queries: Array<[string, string[]]> = [];
  for (const [, name = "", body = ""] of css.matchAll(/@container\s+([\w-]+)[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) {
    const selectors = [...body.matchAll(/([^{}]+)\{/g)].flatMap(([, s = ""]) => s.split(",").map((x) => x.trim()));
    queries.push([name, selectors]);
  }
  return queries;
}

describe("container queries", () => {
  it("never style the element that is the container (queries only reach descendants)", () => {
    const problems: string[] = [];
    for (const file of files) {
      const containers = declaredContainers(file.css);
      for (const [name, selectors] of containerQueries(file.css)) {
        for (const selector of selectors) {
          if (containers.get(name)?.has(selector)) problems.push(`${file.name}: @container ${name} styles ${selector}, its own container`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("only query containers that exist", () => {
    const declared = new Set(files.flatMap((file) => [...declaredContainers(file.css).keys()]));
    const unknown = files.flatMap((file) =>
      containerQueries(file.css)
        .filter(([name]) => !declared.has(name))
        .map(([name]) => `${file.name}: @container ${name}`),
    );
    expect(unknown).toEqual([]);
  });

  it("finds the containers it checks", () => {
    const declared = new Set(files.flatMap((file) => [...declaredContainers(file.css).keys()]));
    expect([...declared]).toEqual(expect.arrayContaining(["page", "teams", "suggestions", "matches"]));
  });
});
