import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { API, DIGEST, mockGitHub, STABLE } from "./github";

type Lang = "en" | "fr";

const SIZES = [
  { name: "phone", width: 360, height: 740 },
  { name: "desktop", width: 1280, height: 800 },
];

const PAGES: { path: string; lang: Lang; twin: string; status?: number }[] = [
  { path: "/", lang: "en", twin: "/fr/" },
  { path: "/fr/", lang: "fr", twin: "/" },
  { path: "/versions/", lang: "en", twin: "/fr/versions/" },
  { path: "/fr/versions/", lang: "fr", twin: "/versions/" },
  { path: "/privacy/", lang: "en", twin: "/fr/confidentialite/" },
  { path: "/fr/confidentialite/", lang: "fr", twin: "/privacy/" },
  { path: "/terms/", lang: "en", twin: "/fr/conditions/" },
  { path: "/fr/conditions/", lang: "fr", twin: "/terms/" },
  { path: "/no-such-page", lang: "en", twin: "/fr/", status: 404 },
  { path: "/fr/nulle-part", lang: "fr", twin: "/", status: 404 },
];

/** Riot's line, word for word as the app shows it (Settings → About). */
function riotLine(lang: Lang): string {
  const source = readFileSync(new URL(`../../ui/src/i18n/${lang}-views.ts`, import.meta.url), "utf8");
  const line = /legal:\s*"([^"]+)"/.exec(source)?.[1];
  if (!line) throw new Error(`no legal line in ${lang}-views.ts`);
  return line;
}

const INSTALLER = STABLE.assets[3].browser_download_url;

/** Console errors, page errors, and requests to any site but this one and GitHub's API. */
function watch(page: Page) {
  const problems: string[] = [];
  const foreign: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "data:" && url.hostname !== "127.0.0.1" && url.hostname !== "api.github.com") foreign.push(request.url());
  });
  return { problems, foreign };
}

/** Every block that asks GitHub has settled on a state. */
const settled = (page: Page) => expect(page.locator("[data-states]:not([data-shown])")).toHaveCount(0);

for (const p of PAGES) {
  test(`${p.path} (${p.lang}) at phone and desktop widths`, async ({ page }) => {
    const seen = watch(page);
    await mockGitHub(page, API.releases);
    await page.setViewportSize(SIZES[0]);
    const response = await page.goto(p.path);
    expect(response?.status()).toBe(p.status ?? 200);
    await expect(page.locator("html")).toHaveAttribute("lang", p.lang);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("footer .legal")).toHaveText(riotLine(p.lang));
    const other = p.lang === "en" ? "fr" : "en";
    await expect(page.locator(`nav.lang a[hreflang="${other}"]`)).toHaveAttribute("href", p.twin);
    await expect(page.locator(`nav.lang a[hreflang="${p.lang}"]`)).toHaveAttribute("aria-current", "page");
    await settled(page);
    await page.evaluate(() => document.fonts.ready);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
          message: `no horizontal scroll at ${size.width} px`,
        })
        .toBe(0);
    }
    // A 404 page is a 404: the browser says so for the document itself.
    const problems = seen.problems.filter((text) => !(p.status === 404 && /status of 404/.test(text)));
    expect(problems).toEqual([]);
    expect(seen.foreign).toEqual([]);
  });
}

for (const size of SIZES) {
  test.describe(`${size.name}, ${size.width} px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test(`no layout shift when GitHub answers late`, async ({ page }) => {
      await page.addInitScript(() => {
        const shifts = { total: 0 };
        Object.defineProperty(window, "__shifts", { get: () => shifts.total });
        Object.defineProperty(window, "__resetShifts", { value: () => (shifts.total = 0) });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            if (!shift.hadRecentInput) shifts.total += shift.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await mockGitHub(page, API.releases, 900);
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Reflect.get(window, "__resetShifts")());
      await expect(page.locator('[data-states="download"]')).toHaveAttribute("data-shown", "ready");
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => Number(Reflect.get(window, "__shifts")))).toBeLessThan(0.001);
    });
  });
}

test("every link resolves", async ({ page, request }) => {
  await mockGitHub(page, API.releases);
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const p of PAGES.filter((p) => !p.status)) {
    await page.goto(p.path);
    await settled(page);
    const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      expect(href, `a link on ${p.path}`).not.toMatch(/^(javascript:|data:|$)/i);
      if (href.startsWith("#")) {
        await expect(page.locator(`[id="${href.slice(1)}"]`), `${href} on ${p.path}`).toHaveCount(1);
      } else if (href.startsWith("/")) {
        internal.add(href.split("#")[0]);
      } else {
        external.add(href);
      }
    }
  }
  for (const path of internal) expect((await request.get(path)).status(), path).toBe(200);
  for (const url of external) {
    expect(url).toMatch(/^https:\/\/(github\.com\/Filmoo(\/MVP)?([/?#]|$)|www\.riotgames\.com\/|docs\.github\.com\/)/);
  }
});

test("home: the download is the latest stable x64 installer", async ({ page }) => {
  await mockGitHub(page, API.releases);
  await page.goto("/");
  const ticket = page.locator('[data-states="download"]');
  await expect(ticket).toHaveAttribute("data-shown", "ready");
  const button = ticket.locator('[data-link="download"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("href", INSTALLER);
  await expect(ticket.locator('[data-field="tag"]')).toHaveText("v0.2.0");
  await expect(ticket.locator('[data-field="file"]')).toHaveText("MVP_0.2.0_x64-setup.exe");
  await expect(ticket.locator('[data-field="size"]')).toHaveText("9.8 MB");
  await expect(ticket.locator('[data-field="date"]')).toHaveText("29 September 2026");
  await expect(ticket.locator('[data-field="date"]')).toHaveAttribute("datetime", STABLE.published_at);
  await expect(ticket.locator('[data-field="digest"]')).toHaveText(`SHA-256 ${DIGEST}`);
  await expect(ticket.locator('[data-link="release"]')).toHaveAttribute("href", STABLE.html_url);
  await expect(page.locator('[data-states="notes"] [data-field="version"]')).toHaveText("0.2.0");
});

test("home in French: sizes in Mo, dates in French", async ({ page }) => {
  await mockGitHub(page, API.releases);
  await page.goto("/fr/");
  const ticket = page.locator('[data-states="download"]');
  await expect(ticket.locator('[data-field="size"]')).toHaveText("9,8 Mo");
  await expect(ticket.locator('[data-field="date"]')).toHaveText("29 septembre 2026");
  await expect(ticket.locator('[data-link="download"]')).toHaveAttribute("href", INSTALLER);
});

test("release notes render as markdown, never as HTML", async ({ page }) => {
  await mockGitHub(page, API.releases);
  await page.goto("/");
  const notes = page.locator('[data-states="notes"] [data-field="notes"]');
  await expect(notes.locator("h4")).toHaveText(["What's new", "Fixes"]);
  await expect(notes.locator("strong").first()).toHaveText("Draft helper");
  await expect(notes.locator("em")).toHaveText("reasons");
  await expect(notes.locator("code")).toHaveText("summoner spells");
  await expect(notes.locator("ul ul li")).toHaveText("Flash stays on your usual key (D or F).");
  await expect(notes.locator('a[href="https://github.com/Filmoo/MVP/pull/12"]')).toHaveText("#12");
  await expect(notes.locator('a[href="https://github.com/Filmoo"]')).toHaveText("@Filmoo");
  await expect(notes.locator('a[href="https://github.com/Filmoo/MVP/compare/v0.1.0...v0.2.0"]')).toHaveText("v0.1.0...v0.2.0");
  await expect(notes).toContainText("<img src=x onerror=alert(1)> stays text");
  await expect(notes).toContainText("and so does a bad link.");
  await expect(notes.locator("img, script, iframe, [onerror]")).toHaveCount(0);
  await expect(notes.locator('a:not([href^="https://"])')).toHaveCount(0);
  await expect(notes).not.toContainText("Release notes generated");
});

for (const [path, heading] of [
  ["/", "First release soon"],
  ["/fr/", "Première version bientôt"],
]) {
  test(`${path} before the first release`, async ({ page }) => {
    await mockGitHub(page, API.empty);
    await page.goto(path);
    const ticket = page.locator('[data-states="download"]');
    await expect(ticket).toHaveAttribute("data-shown", "none");
    await expect(ticket.getByRole("heading", { name: heading })).toBeVisible();
    await expect(ticket.locator(".penguin")).toBeVisible();
    await expect(ticket.locator('[data-link="download"]')).toBeHidden();
    await expect(ticket.locator('[data-field="preview"]')).toBeHidden();
    await expect(page.locator('[data-states="notes"]')).toHaveAttribute("data-shown", "none");
    await expect(page.locator(".sketch").first()).toBeHidden();
  });
}

test("home: with only a pre-release out, no download but a pointer to it", async ({ page }) => {
  await mockGitHub(page, API.previewOnly);
  await page.goto("/");
  const ticket = page.locator('[data-states="download"]');
  await expect(ticket).toHaveAttribute("data-shown", "none");
  await expect(ticket.locator('[data-field="preview"]')).toBeVisible();
});

test("GitHub refusing (rate limit) leads to GitHub itself", async ({ page }) => {
  await mockGitHub(page, API.rateLimited);
  await page.goto("/");
  const ticket = page.locator('[data-states="download"]');
  await expect(ticket).toHaveAttribute("data-shown", "error");
  await expect(ticket.getByRole("heading", { name: "GitHub didn’t answer" })).toBeVisible();
  await expect(ticket.locator('[data-state="error"] a')).toHaveAttribute("href", "https://github.com/Filmoo/MVP/releases");
  await expect(page.locator('[data-states="notes"]')).toHaveAttribute("data-shown", "error");
  await page.goto("/fr/versions/");
  await expect(page.locator('[data-states="versions"]')).toHaveAttribute("data-shown", "error");
  await expect(page.getByRole("heading", { name: "GitHub n’a pas répondu" })).toBeVisible();
});

test("versions: every release, newest first, with its installer", async ({ page }) => {
  await mockGitHub(page, API.releases);
  await page.goto("/versions/");
  const items = page.locator(".releases > li");
  await expect(items).toHaveCount(3);
  const [beta, stable, old] = [items.nth(0), items.nth(1), items.nth(2)];
  await expect(beta.locator('[data-field="tag"]')).toHaveText("v0.3.0-beta.1");
  await expect(beta.locator('[data-field="tag"]')).toHaveClass(/stamp-pre/);
  await expect(beta.locator('[data-field="pre"]')).toBeVisible();
  await expect(beta.locator('[data-field="latest"]')).toBeHidden();
  await expect(stable.locator('[data-field="latest"]')).toBeVisible();
  await expect(stable.locator('[data-field="pre"]')).toBeHidden();
  await expect(stable.locator("h2")).toHaveText("MVP 0.2.0");
  await expect(stable.locator(".md h3")).toHaveText(["What's new", "Fixes"]);
  await expect(stable.locator('[data-link="download"]')).toHaveAttribute("href", INSTALLER);
  await expect(stable.locator('[data-field="size"]')).toHaveText("9.8 MB");
  await expect(old.locator("h2")).toHaveText("v0.1.0");
  await expect(old.locator('[data-link="download"]')).toHaveCount(0);
  await expect(old.getByText("No notes for this version.")).toBeVisible();
});

test("versions before the first release: the penguin waits", async ({ page }) => {
  await mockGitHub(page, API.empty);
  await page.goto("/fr/versions/");
  const block = page.locator('[data-states="versions"]');
  await expect(block).toHaveAttribute("data-shown", "none");
  await expect(page.getByRole("heading", { name: "Pas encore de version" })).toBeVisible();
  await expect(block.locator('[data-state="none"] .penguin')).toBeVisible();
});

test("one request to GitHub per visit, shared by the pages", async ({ page }) => {
  const seen = await mockGitHub(page, API.releases);
  await page.goto("/");
  await expect(page.locator('[data-states="download"]')).toHaveAttribute("data-shown", "ready");
  await page.goto("/versions/");
  await expect(page.locator('[data-states="versions"]')).toHaveAttribute("data-shown", "ready");
  await page.goto("/fr/");
  await expect(page.locator('[data-states="download"]')).toHaveAttribute("data-shown", "ready");
  expect(seen.count).toBe(1);
});

test("French pages keep French typography", async ({ page }) => {
  await mockGitHub(page, API.empty);
  for (const p of PAGES.filter((p) => p.lang === "fr")) {
    await page.goto(p.path);
    await settled(page);
    // A regular space before : ; ! ? » or after «, or those marks glued to a word, is a fault.
    const faults = await page.evaluate(() => {
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("code, pre, script, style, template, .md")) continue;
        const text = node.textContent ?? "";
        for (const match of text.matchAll(/ [:;!?»]|« |«\S|\S[:;!?»](?!\/\/)/g))
          found.push(`“${match[0]}” in “${text.trim().slice(0, 70)}”`);
      }
      return found;
    });
    expect(faults, p.path).toEqual([]);
  }
});

test("the home page stays light: under 300 KB with its fonts", async ({ page }) => {
  await mockGitHub(page, API.releases);
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => document.fonts.ready);
  const bytes = await page.evaluate(() =>
    [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]
      .filter((entry) => entry.name.startsWith(location.origin))
      .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).transferSize, 0),
  );
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThan(300 * 1024);
});

test("nothing keeps moving once the page has loaded", async ({ page }) => {
  await mockGitHub(page, API.releases);
  await page.goto("/");
  await settled(page);
  const endless = await page.evaluate(
    () => document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY).length,
  );
  expect(endless).toBe(0);
});

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("nothing moves at all, not even while GitHub is asked", async ({ page }) => {
    await mockGitHub(page, API.hang);
    await page.goto("/");
    await expect(page.locator('[data-states="download"] [data-state="loading"]')).toHaveClass(/on/);
    const running = await page.evaluate(() =>
      document.getAnimations().map((animation) => {
        const name =
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation instanceof CSSTransition
              ? animation.transitionProperty
              : "script";
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return `${name} on ${target?.tagName.toLowerCase()}.${target?.getAttribute("class") ?? ""}`;
      }),
    );
    expect(running).toEqual([]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the pages point to GitHub, and the language switch works", async ({ page }) => {
    await page.goto("/");
    const ticket = page.locator('[data-states="download"]');
    await expect(ticket.locator('[data-state="static"]')).toBeVisible();
    await expect(ticket.locator('[data-state="loading"]')).toBeHidden();
    await expect(ticket.locator('[data-state="static"] a')).toHaveAttribute("href", "https://github.com/Filmoo/MVP/releases");
    await page.locator('nav.lang a[hreflang="fr"]').click();
    await expect(page).toHaveURL(/\/fr\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await page.goto("/fr/versions/");
    await expect(page.locator('[data-states="versions"] [data-state="static"]')).toBeVisible();
  });
});
