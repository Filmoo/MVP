import { resolve } from "node:path";
import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { FIXTURE_NOW } from "../src/data/mock/fixtures";
import { lockInImport } from "../src/data/mock/import-fixtures";
import type { ScenarioName } from "../src/data/mock/scenarios";
import { animationsDone, openApp, settle, test, VIEWS } from "./app";

// Screenshots for human/UI-agent review. Not asserted: layout, coherence and
// error specs are the gates. Output: reports/screenshots/<view>-<scenario>-<size>.png
const OUT = resolve(import.meta.dirname, "../../reports/screenshots");

const SHOTS = [
  {
    scenario: "default",
    sizes: [
      [1280, 800],
      [1920, 1080],
      [820, 760],
      [420, 800],
    ],
  },
  { scenario: "not-running", sizes: [[1280, 800]] },
  { scenario: "new-player", sizes: [[1280, 800]] },
  { scenario: "profile-error", sizes: [[1280, 800]] },
  {
    scenario: "extreme",
    sizes: [
      [1280, 800],
      [420, 800],
    ],
  },
] as const;

/**
 * The app scrolls inside <main>, so Playwright's fullPage sees one window's worth: grow the
 * window by what <main> hides, then capture.
 */
async function capture(page: Page, path: string, full: boolean): Promise<void> {
  if (full) {
    const hidden = await page.locator("main").evaluate((main) => main.scrollHeight - main.clientHeight);
    const size = page.viewportSize();
    if (size && hidden > 0) {
      await page.setViewportSize({ width: size.width, height: size.height + hidden });
      await settle(page);
    }
  }
  await page.screenshot({ path });
}

for (const { scenario, sizes } of SHOTS) {
  for (const [width, height] of sizes) {
    test(`home ${scenario} ${width}x${height}`, async ({ page }) => {
      await openApp(page, { scenario, width, height });
      // Narrow layouts scroll: capture the whole page so everything can be reviewed.
      await capture(page, `${OUT}/home-${scenario}-${width}x${height}.png`, width < 900);
    });
  }
}

for (const [width, height] of [
  [1280, 800],
  [1920, 1080],
  [820, 760],
  [420, 800],
] as const) {
  test(`draft champ-select ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "champ-select", width, height });
    await capture(page, `${OUT}/draft-champ-select-${width}x${height}.png`, width < 900);
  });
}

for (const view of VIEWS.slice(1)) {
  test(`${view} 1280x800`, async ({ page }) => {
    await openApp(page, { view });
    await page.screenshot({ path: `${OUT}/${view.slice(1)}-default-1280x800.png` });
  });
}

// Build imports: every state of the import bar, the lock-in toast, and the draft without stats.
for (const [width, height] of [
  [1280, 800],
  [420, 800],
] as const) {
  test(`draft import failures ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "import-failures", width, height });
    for (const name of ["Import item set", "Import spells", "Import runes"]) {
      await page.getByRole("button", { name }).click();
      await page.getByRole("button", { name }).and(page.locator(":not([aria-busy])")).waitFor();
    }
    await page.mouse.move(0, 0);
    await settle(page);
    await capture(page, `${OUT}/draft-import-failures-${width}x${height}.png`, false);
  });
}

test("draft import flash 1280x800", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "import-flash" });
  await page.getByRole("button", { name: "Import runes" }).click();
  await page.getByRole("button", { name: "Import spells" }).click();
  await page.getByTestId("import-spells").and(page.locator("[data-tone=warn]")).waitFor();
  await page.mouse.move(0, 0);
  await settle(page);
  await capture(page, `${OUT}/draft-import-flash-1280x800.png`, false);
});

test("draft import lock-in 1280x800", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "import-lock-in" });
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  await page.getByTestId("toast").waitFor();
  await settle(page);
  await capture(page, `${OUT}/draft-import-lock-in-1280x800.png`, false);
});

test("draft no stats 1280x800", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "draft-no-stats" });
  await capture(page, `${OUT}/draft-no-stats-1280x800.png`, false);
});

// Team compositions (the side panel's Teams tab) and ARAM: yours and the bench.
async function teamsTab(page: Page, label: string): Promise<void> {
  const tab = page.getByTestId("why-tabs").getByRole("radio", { name: label });
  if ((await tab.getAttribute("aria-checked")) !== "true") await tab.click();
  await page.locator("[data-widget=draft-comps] > *").first().waitFor();
  await page.mouse.move(0, 0);
  await animationsDone(page);
}

for (const [scenario, sizes] of [
  [
    "champ-select",
    [
      [1280, 720],
      [1920, 1080],
      [420, 800],
    ],
  ],
  [
    "aram-champ-select",
    [
      [1280, 720],
      [420, 800],
    ],
  ],
  ["draft-planning", [[1280, 720]]],
  ["draft-no-comps", [[1280, 720]]],
] as const) {
  for (const [width, height] of sizes) {
    test(`draft teams ${scenario} ${width}x${height}`, async ({ page, t }) => {
      await openApp(page, { view: "/draft", scenario, width, height });
      await teamsTab(page, t.why.tabs.teams);
      await capture(page, `${OUT}/draft-teams-${scenario}-${width}x${height}.png`, width < 900);
    });
  }
}

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`draft aram ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "aram-champ-select", width, height });
    await capture(page, `${OUT}/draft-aram-${width}x${height}.png`, false);
  });
}

test("draft aram 1280x720 bench pick", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "aram-champ-select", width: 1280, height: 720 });
  await page.getByTestId("suggestion").filter({ hasText: "Sion" }).click();
  await page.mouse.move(0, 0);
  await animationsDone(page);
  await capture(page, `${OUT}/draft-aram-1280x720-sion.png`, false);
});

test("draft champ-select 420x800 tapped", async ({ page }) => {
  await openApp(page, { view: "/draft", scenario: "champ-select", width: 420, height: 800 });
  await page.getByTestId("suggestion").filter({ hasText: "Shen" }).click();
  await capture(page, `${OUT}/draft-champ-select-420x800-tapped.png`, true);
});

const SETTINGS_SHOTS = [
  {
    scenario: "default",
    sizes: [
      [1920, 1080],
      [820, 760],
      [420, 800],
      [2560, 1440],
    ],
  },
  { scenario: "settings-custom", sizes: [[1280, 800]] },
  { scenario: "settings-error", sizes: [[1280, 800]] },
] as const;

for (const { scenario, sizes } of SETTINGS_SHOTS) {
  for (const [width, height] of sizes) {
    test(`settings ${scenario} ${width}x${height}`, async ({ page }) => {
      await openApp(page, { view: "/settings", scenario, width, height });
      await capture(page, `${OUT}/settings-${scenario}-${width}x${height}.png`, width < 900);
    });
  }
}

test("settings with Windows' transparency off 1280x800", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  await openApp(page, { view: "/settings" });
  await page.getByTestId("effects-fallback").scrollIntoViewIfNeeded();
  await capture(page, `${OUT}/settings-transparency-off-1280x800.png`, false);
});

test("settings save error 1280x800", async ({ page }) => {
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  await page.getByRole("switch", { name: "Close to tray" }).click();
  await page.getByRole("alert").waitFor();
  await page.mouse.move(0, 0);
  await animationsDone(page);
  await capture(page, `${OUT}/settings-save-error-1280x800.png`, false);
});

const WIDE_TO_NARROW = [
  [1280, 720],
  [1920, 1080],
  [820, 760],
  [420, 800],
] as const;

for (const [width, height] of WIDE_TO_NARROW) {
  test(`search open ${width}x${height}`, async ({ page }) => {
    await openApp(page, { width, height });
    await page.getByTestId("search-input").click();
    await page.keyboard.type("Ahri#EUW");
    await page.getByTestId("search-option").filter({ hasText: "Level" }).waitFor();
    await settle(page);
    await capture(page, `${OUT}/search-open-${width}x${height}.png`, false);
  });

  test(`player ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE", width, height });
    await capture(page, `${OUT}/player-default-${width}x${height}.png`, width < 900);
  });

  test(`live ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/live", scenario: "live", width, height });
    await capture(page, `${OUT}/live-ingame-${width}x${height}.png`, width < 900);
  });
}

test("search recent 1280x720", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "mvp.recent-searches.v1",
      JSON.stringify([
        { kind: "player", platform: "euw1", riotId: { gameName: "Blade Dancer", tagLine: "IRE" } },
        { kind: "champion", championId: 103 },
        { kind: "player", platform: "kr", riotId: { gameName: "Hide on bush", tagLine: "KR1" } },
      ]),
    );
  });
  await openApp(page, { width: 1280, height: 720 });
  await page.keyboard.press("Control+k");
  await page.getByTestId("search-panel").waitFor();
  await settle(page);
  await capture(page, `${OUT}/search-recent-1280x720.png`, false);
});

test("search slow lookup 1280x720", async ({ page }) => {
  await openApp(page, { scenario: "search-slow", width: 1280, height: 720 });
  await page.getByTestId("search-input").click();
  await page.keyboard.type("Fillmo#7272");
  await page.getByTestId("search-option").filter({ hasText: "Searching" }).waitFor();
  await page.screenshot({ path: `${OUT}/search-loading-1280x720.png` });
});

for (const scenario of ["live-scouting", "live-failed", "live-extreme"] as const) {
  test(`live ${scenario} 1280x720`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.clock.setFixedTime(new Date(FIXTURE_NOW));
    await page.goto(`/?scenario=${scenario}#/live`);
    await page.getByTestId("live-card").first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/live-${scenario}-1280x720.png` });
  });
}

for (const name of ["Nobody/404", "Busy/429", "Offline/0"] as const) {
  test(`player ${name} 1280x720`, async ({ page }) => {
    await openApp(page, { view: `/player/euw1/${name}`, width: 1280, height: 720 });
    await capture(page, `${OUT}/player-${name.replace("/", "-")}-1280x720.png`, false);
  });
}

test("player loading 1280x720", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?scenario=search-slow#/player/euw1/Blade%20Dancer/IRE");
  await page.locator("main [data-state=loading]").first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/player-loading-1280x720.png` });
});

// Stats pages: tier list, champion page, champion list, and their states.
for (const [width, height] of [
  [1280, 800],
  [1920, 1080],
  [820, 760],
  [420, 800],
] as const) {
  test(`tier list ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/tier-list", width, height });
    await capture(page, `${OUT}/tierlist-default-${width}x${height}.png`, width < 900);
  });

  test(`champion page ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/champions?id=103", width, height });
    await capture(page, `${OUT}/champion-ahri-${width}x${height}.png`, true);
  });

  test(`champion list ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/champions", width, height });
    await capture(page, `${OUT}/champions-list-${width}x${height}.png`, false);
  });
}

for (const { name, view } of [
  { name: "tierlist-aram", view: "/tier-list?queue=450" },
  { name: "tierlist-support", view: "/tier-list?queue=420&role=support" },
  { name: "champion-lux-support", view: "/champions?id=99" },
  { name: "champion-thresh", view: "/champions?id=412" },
  { name: "champion-lux-aram", view: "/champions?id=99&queue=450" },
  { name: "champion-no-games", view: "/champions?id=904" },
] as const) {
  test(`${name} 1280x800`, async ({ page }) => {
    await openApp(page, { view, width: 1280, height: 800 });
    await capture(page, `${OUT}/${name}-1280x800.png`, true);
  });
}

for (const scenario of ["stats-empty", "stats-offline"] as const) {
  for (const view of ["/tier-list", "/champions?id=103"]) {
    test(`${view} ${scenario} 1280x720`, async ({ page }) => {
      await openApp(page, { view, scenario, width: 1280, height: 720 });
      await capture(page, `${OUT}/${view.includes("tier") ? "tierlist" : "champion"}-${scenario}-1280x720.png`, false);
    });
  }
}

for (const view of ["/tier-list", "/champions?id=103"]) {
  test(`${view} loading 1280x720`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?scenario=stats-slow#${view}`);
    await page.locator("main [data-state=loading]").first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${view.includes("tier") ? "tierlist" : "champion"}-loading-1280x720.png` });
  });
}

for (const [width, height] of [
  [1280, 400],
  [420, 400],
] as const) {
  test(`build summary ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view: "/__harness?show=build-summary", width, height });
    await capture(page, `${OUT}/build-summary-${width}x${height}.png`, false);
  });
}

// Glass over scrolled content: the title bar (wide) and the floating tab bar (narrow) bend what
// passes under their rims and keep their labels on a calm middle.
for (const [view, width, height, by] of [
  ["/", 1280, 800, 200],
  ["/", 420, 800, 470],
  ["/tier-list", 420, 800, 300],
] as const) {
  test(`scrolled ${view} ${width}x${height}`, async ({ page }) => {
    await openApp(page, { view, width, height });
    await page.locator("main").evaluate((main, y) => main.scrollTo(0, y), by);
    await settle(page);
    const name = view === "/" ? "home" : view.slice(1);
    await page.screenshot({ path: `${OUT}/scrolled-${name}-${width}x${height}.png` });
  });
}

test("home match accepted toast 1280x800", async ({ page }) => {
  await openApp(page, { scenario: "match-accepted" });
  await page.getByTestId("toast").waitFor();
  await capture(page, `${OUT}/home-match-accepted-1280x800.png`, false);
});

// Notices, updates, crash reports.
for (const [width, height] of [
  [1280, 800],
  [420, 800],
] as const) {
  for (const scenario of ["banners", "update-available", "update-required"] as const) {
    test(`home ${scenario} ${width}x${height}`, async ({ page }) => {
      await openApp(page, { scenario, width, height });
      await capture(page, `${OUT}/home-${scenario}-${width}x${height}.png`, false);
    });
  }
}

test("live with banners 1280x800", async ({ page }) => {
  await openApp(page, { view: "/live", scenario: "banners" });
  await capture(page, `${OUT}/live-banners-1280x800.png`, false);
});

for (const scenario of ["crash-reports-on", "update-available", "update-downloading", "auto-accept-paused"] as const) {
  test(`settings ${scenario} 1280x800`, async ({ page }) => {
    await openApp(page, { view: "/settings", scenario });
    await capture(page, `${OUT}/settings-${scenario}-1280x800.png`, false);
  });
}

test("settings crash-reports-on 420x800", async ({ page }) => {
  await openApp(page, { view: "/settings", scenario: "crash-reports-on", width: 420, height: 800 });
  await capture(page, `${OUT}/settings-crash-reports-on-420x800.png`, true);
});

// Match rows: an opened game (its row scrolled to the top of the page), a grade's why, and the
// game's other states, in English and French (`fr-…`). `row`: which row, newest first.
async function gameShot(page: Page, name: string, opts: { scenario?: ScenarioName; width: number; height: number; row?: number }) {
  await openApp(page, { scenario: opts.scenario ?? "default", width: opts.width, height: opts.height });
  const row = page.locator("[data-testid=match-row] > button").nth(opts.row ?? 0);
  await row.click();
  if (opts.scenario !== "match-details-slow") {
    await page.getByTestId("game").locator("[data-testid=game-player], [role=alert]").first().waitFor();
  }
  await row.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.locator("main").evaluate((main) => main.scrollBy(0, -12));
  if (opts.scenario !== "match-details-slow") await settle(page);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}/${name}-${opts.width}x${opts.height}.png` });
}

async function whyShot(page: Page, name: string, width: number, height: number, row: number) {
  await openApp(page, { width, height });
  const grade = page.locator("[data-grade]").nth(row);
  await grade.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await grade.hover();
  await page.getByTestId("grade-why").waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT}/${name}-${width}x${height}.png` });
}

for (const lang of ["en", "fr"] as const) {
  test.describe(lang === "fr" ? "match rows in French" : "match rows", () => {
    if (lang === "fr") test.use({ locale: "fr-FR" });
    const prefix = lang === "fr" ? "fr-" : "";
    for (const [width, height] of [
      [1280, 800],
      [420, 800],
    ] as const) {
      test(`${prefix}home game open ${width}x${height}`, async ({ page }) => {
        await gameShot(page, `${prefix}home-game-open`, { width, height, row: 2 });
      });
      test(`${prefix}home grade why ${width}x${height}`, async ({ page }) => {
        await whyShot(page, `${prefix}home-grade-why`, width, height, 1);
      });
      test(`${prefix}home game extreme ${width}x${height}`, async ({ page }) => {
        await gameShot(page, `${prefix}home-game-extreme`, { scenario: "extreme", width, height });
      });
    }
    for (const scenario of ["match-details-error", "match-details-gone", "match-details-slow"] as const) {
      test(`${prefix}home ${scenario} 1280x800`, async ({ page }) => {
        await gameShot(page, `${prefix}home-${scenario}`, { scenario, width: 1280, height: 800 });
      });
    }
    test(`${prefix}player game open 1280x800`, async ({ page }) => {
      await openApp(page, { view: "/player/euw1/Blade%20Dancer/IRE" });
      const row = page.locator("[data-testid=match-row] > button").first();
      await row.click();
      await page.getByTestId("game-player").first().waitFor();
      await row.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await settle(page);
      await page.screenshot({ path: `${OUT}/${prefix}player-game-open-1280x800.png` });
    });
  });
}

// The main screens in French (the app follows the webview's language): fr-<screen>-<size>.png.
test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  const SCREENS = [
    { name: "home", view: "/", scenario: "default" },
    { name: "draft", view: "/draft", scenario: "champ-select" },
    { name: "draft-aram", view: "/draft", scenario: "aram-champ-select" },
    { name: "live", view: "/live", scenario: "live" },
    { name: "live-build", view: "/live?tab=build", scenario: "live" },
    { name: "champion", view: "/champions?id=103", scenario: "default" },
    { name: "champions", view: "/champions", scenario: "default" },
    { name: "tierlist", view: "/tier-list", scenario: "default" },
    { name: "settings", view: "/settings", scenario: "default" },
    { name: "player-404", view: "/player/euw1/Nobody/404", scenario: "default" },
    { name: "home-banners", view: "/", scenario: "banners" },
    { name: "home-update-required", view: "/", scenario: "update-required" },
    { name: "home-not-running", view: "/", scenario: "not-running" },
    { name: "tierlist-empty", view: "/tier-list", scenario: "stats-empty" },
    { name: "settings-custom", view: "/settings", scenario: "settings-custom" },
  ] as const;

  for (const { name, view, scenario } of SCREENS) {
    for (const [width, height] of [
      [1280, 800],
      [420, 800],
    ] as const) {
      test(`fr ${name} ${width}x${height}`, async ({ page, t }) => {
        await openApp(page, { view, scenario, width, height });
        // The lookup answers after the page's skeleton.
        if (name === "player-404") await page.getByRole("heading", { level: 1, name: t.players.notFound.title }).waitFor();
        await capture(page, `${OUT}/fr-${name}-${width}x${height}.png`, true);
      });
    }
  }

  test("fr search open 1280x720", async ({ page, t }) => {
    await openApp(page, { width: 1280, height: 720 });
    await page.getByTestId("search-input").click();
    await page.keyboard.type("Ahri#EUW");
    await page
      .getByTestId("search-option")
      .filter({ hasText: t.search.level(512, "EUW") })
      .waitFor();
    await settle(page);
    await capture(page, `${OUT}/fr-search-open-1280x720.png`, false);
  });

  test("fr draft import failures 1280x800", async ({ page, t }) => {
    await openApp(page, { view: "/draft", scenario: "import-failures" });
    for (const part of ["itemSet", "spells", "runes"] as const) {
      const name = t.imports.importPart(part);
      await page.getByRole("button", { name }).click();
      await page.getByRole("button", { name }).and(page.locator(":not([aria-busy])")).waitFor();
    }
    await page.mouse.move(0, 0);
    await settle(page);
    await capture(page, `${OUT}/fr-draft-import-failures-1280x800.png`, false);
  });

  test("fr draft import lock-in 1280x800", async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "import-lock-in" });
    await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
    await page.getByTestId("toast").waitFor();
    await settle(page);
    await capture(page, `${OUT}/fr-draft-import-lock-in-1280x800.png`, false);
  });

  for (const scenario of ["champ-select", "aram-champ-select", "draft-planning"] as const) {
    test(`fr draft teams ${scenario} 1280x720`, async ({ page, t }) => {
      await openApp(page, { view: "/draft", scenario, width: 1280, height: 720 });
      await teamsTab(page, t.why.tabs.teams);
      await capture(page, `${OUT}/fr-draft-teams-${scenario}-1280x720.png`, false);
    });
  }

  test("fr draft aram 1280x720 bench pick", async ({ page }) => {
    await openApp(page, { view: "/draft", scenario: "aram-champ-select", width: 1280, height: 720 });
    await page.getByTestId("suggestion").filter({ hasText: "Sion" }).click();
    await page.mouse.move(0, 0);
    await animationsDone(page);
    await capture(page, `${OUT}/fr-draft-aram-1280x720-sion.png`, false);
  });

  test("fr champion page 2560x1440", async ({ page }) => {
    await openApp(page, { view: "/champions?id=412", width: 2560, height: 1440 });
    await capture(page, `${OUT}/fr-champion-thresh-2560x1440.png`, false);
  });
});
