import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { expect, FRENCH_SIZES, isFrench, openApp, SIZES, settle, test, trackErrors } from "./app";
import { auditLayout } from "./layout-rules";

// The Settings page's search (views/settings/search.ts decides; these check the page follows).

const field = (page: Page) => page.getByTestId("settings-search");
const widget = (page: Page, name: string) => page.locator(`[data-widget=settings-${name}]`);
const CARDS = ["automation", "imports", "stats", "app", "about"] as const;

/** The cards on screen, in page order. */
async function shownCards(page: Page): Promise<string[]> {
  const shown: string[] = [];
  for (const card of CARDS) if (await widget(page, card).isVisible()) shown.push(card);
  return shown;
}

const saves = (page: Page) => page.evaluate(() => window.__SCOUT_MOCK__?.log.filter((c) => c.command === "update_settings").length ?? 0);

/** Whether the page kept a Ctrl+F for itself (the browser's find otherwise). */
const ctrlFTaken = (page: Page) =>
  page.evaluate(() => {
    const press = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(press);
    return press.defaultPrevented;
  });

test("settings search: typing keeps what matches, marked, and hides the rest", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  // The first word of the visual effects' title: "Visual", "Effets".
  const word = t.settings.app.effects.title.split(" ")[0] ?? "";
  await field(page).fill(word);
  await expect(page.getByTestId("setting-effects")).toBeVisible();
  await expect(page.getByRole("switch", { name: t.settings.app.closeToTray.title })).toBeHidden();
  expect(await shownCards(page)).toEqual(["app"]);
  await expect(widget(page, "app").locator("mark")).toHaveText([word]);
  // Every word typed must be found: one more that isn't leaves nothing.
  await field(page).fill(`${word} zzzz`);
  await expect(widget(page, "no-match")).toBeVisible();
  expect(await shownCards(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("settings search: a card's title keeps all its rows", async ({ page, t }) => {
  await openApp(page, { view: "/settings" });
  const words = t.settings.automation;
  await field(page).fill(words.title);
  for (const name of [words.autoAccept.title, words.bringToFront.title, words.autoSwitch.title]) {
    await expect(page.getByRole("switch", { name })).toBeVisible();
  }
  await expect(page.getByRole("slider", { name: words.delay })).toBeVisible();
  await expect(widget(page, "automation").locator("h2 mark")).toHaveText(words.title);
  await expect(widget(page, "imports")).toBeHidden();
});

test("settings search: typos, accents and the words players use find settings", async ({ page, locale }) => {
  await openApp(page, { view: "/settings" });
  const cases = isFrench(locale)
    ? [
        ["flou", "setting-effects"],
        ["tranparence", "setting-effects"],
        ["demarrage", "setting-launch-at-startup"],
        ["elo", "setting-stats-bracket"],
        ["summoners", "setting-import-spells"],
      ]
    : [
        ["blur", "setting-effects"],
        ["transparancy", "setting-effects"],
        ["francais", "setting-language"],
        ["elo", "setting-stats-bracket"],
        ["ready check", "setting-auto-accept"],
      ];
  for (const [query, testId] of cases) {
    await field(page).fill(query ?? "");
    await expect(page.getByTestId(testId ?? ""), query).toBeVisible();
    await expect(page.getByTestId("setting-close-to-tray"), query).toBeHidden();
  }
});

test("settings search: when nothing matches it says so, and clearing brings every setting back", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings" });
  await field(page).fill("zzzz");
  const none = widget(page, "no-match");
  await expect(none).toContainText(t.settings.search.noMatch("zzzz"));
  expect(await shownCards(page)).toEqual([]);
  await none.getByRole("button", { name: t.settings.search.clear }).click();
  await expect(field(page)).toHaveValue("");
  await expect(field(page)).toBeFocused();
  await expect(none).toHaveCount(0);
  expect(await shownCards(page)).toEqual([...CARDS]);

  // The field's own clear button (the browser's, at its right end) does the same.
  await field(page).fill("zzzz");
  await expect(none).toBeVisible();
  const box = await field(page).boundingBox();
  if (!box) throw new Error("no search field");
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2);
  await expect(field(page)).toHaveValue("");
  await expect(none).toHaveCount(0);
  expect(await shownCards(page)).toEqual([...CARDS]);
  expect(errors).toEqual([]);
});

test("settings search: only About found takes the settings' place", async ({ page }) => {
  await openApp(page, { view: "/settings", width: 1600, height: 900 });
  const about = widget(page, "about");
  const before = await about.boundingBox();
  await field(page).fill("logs");
  expect(await shownCards(page)).toEqual(["about"]);
  const alone = await about.boundingBox();
  const settingsLeft = (await page.locator("main h1").boundingBox())?.x;
  expect(alone?.x, "at the settings' left edge").toBe(settingsLeft);
  expect(Math.round(alone?.width ?? 0), "at its own width").toBe(Math.round(before?.width ?? -1));
});

test("settings search: Ctrl+F finds it, Escape clears it then leaves it, Tab reaches it", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  expect(await ctrlFTaken(page), "Ctrl+F stays the browser's elsewhere").toBe(false);
  await page.getByRole("link", { name: t.nav.settings.label }).click();
  await expect(field(page)).toBeVisible();

  await page.keyboard.press("Control+f");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("tray");
  const autoAccept = page.getByRole("switch", { name: t.settings.automation.autoAccept.title });
  await expect(autoAccept).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(field(page)).toHaveValue("");
  await expect(field(page)).toBeFocused();
  await expect(autoAccept).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(field(page)).not.toBeFocused();

  // Ctrl+K stays the title bar's search, from the field too.
  await field(page).fill("tray");
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("search-input")).toBeFocused();
  // Ctrl+F comes back with what was typed selected, to type over it.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("glass");
  await expect(field(page)).toHaveValue("glass");

  // In the tab order: right before the first setting.
  await field(page).fill("");
  await autoAccept.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(field(page)).toBeFocused();

  // Leaving the page gives Ctrl+F back.
  await page.getByRole("link", { name: t.nav.home.label }).click();
  await expect(field(page)).toHaveCount(0);
  expect(await ctrlFTaken(page)).toBe(false);
  expect(errors).toEqual([]);
});

test("settings search: searching saves and resets nothing, and ends with the page", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page, { view: "/settings", scenario: "settings-save-error" });
  // A failed save says why in its card; a search that hides the card, then shows it again, keeps it.
  await page.getByRole("switch", { name: t.settings.automation.autoAccept.title }).click();
  const alert = widget(page, "automation").getByRole("alert");
  await expect(alert).toBeVisible();
  const before = await saves(page);
  await field(page).fill("tray");
  await expect(alert).toBeHidden();
  await field(page).fill("");
  await expect(alert).toBeVisible();
  expect(await saves(page), "typing saves nothing").toBe(before);

  // Leaving Settings forgets the search.
  await field(page).fill("tray");
  await page.getByRole("link", { name: t.nav.home.label }).click();
  await page.getByRole("link", { name: t.nav.settings.label }).click();
  await expect(field(page)).toHaveValue("");
  expect(await shownCards(page)).toEqual([...CARDS]);
  expect(errors).toEqual([]);
});

test("settings search: lays out at every size, found or not", async ({ page, t }) => {
  // Four sizes, four searches each, settled and audited.
  test.slow();
  const errors = trackErrors(page);
  const queries = ["windows", "logs", t.settings.automation.title, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"];
  for (const size of SIZES.filter((s) => FRENCH_SIZES.has(s.name))) {
    await openApp(page, { view: "/settings", width: size.width, height: size.height });
    for (const query of queries) {
      await field(page).fill(query);
      await settle(page);
      expect(await page.evaluate(auditLayout), `${size.name} “${query}”`).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});
