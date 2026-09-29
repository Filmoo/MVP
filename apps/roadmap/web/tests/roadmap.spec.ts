import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { allowConsole, card, column, drag, expect, open, reset, settle, still, test, undoFromToast } from "./app";

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("signed out, the page asks to sign in; the dev login opens the board", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Every feature, by version" })).toBeVisible();
  await expect(page.getByText("Sign in to see the roadmap")).toHaveCount(0);
  await page.getByRole("link", { name: "Sign in with GitHub" }).click();
  await expect(page.getByTestId("board")).toBeVisible();
  // The page tells robots to stay away.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
});

test("the board: a column per version with its progress and status lanes", async ({ page }) => {
  await open(page);
  await expect(page.locator("section[aria-label^='Version']")).toHaveCount(3);
  const v02 = column(page, "0.2");
  await expect(v02.getByText("Released · 28 Sep")).toBeVisible();
  await expect(v02.getByText("2/2 done")).toBeVisible();
  const v03 = column(page, "0.3");
  await expect(v03.getByText("1/4 done")).toBeVisible();
  await expect(v03.locator("[data-lane]")).toHaveCount(3);
  await expect(v03.locator('[data-lane="in_progress"] [data-feature]')).toHaveText([/Live names from Spectator-V5/]);
  const v04 = column(page, "0.4");
  await expect(v04.locator('[data-lane="proposed"] [data-feature]')).toHaveCount(2);
  // Rejected features stay out of the board until filtered in.
  await expect(card(page, "Ban suggestions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Proposals, 2 waiting" })).toBeVisible();
});

test("drag a card to another version, then undo", async ({ page }) => {
  await open(page);
  await drag(page, card(page, "Tier list trends"), column(page, "0.3").locator('[data-lane="accepted"]'));
  await expect(column(page, "0.3").locator('[data-lane="accepted"] [data-feature]')).toHaveText([
    /The website on mvpgg.com/,
    /Designed hover cards/,
    /Tier list trends/,
  ]);
  await expect(column(page, "0.4").locator("[data-feature]", { hasText: "Tier list trends" })).toHaveCount(0);
  // It stays there after a reload: the server has it.
  await page.reload();
  await expect(column(page, "0.3").locator("[data-feature]", { hasText: "Tier list trends" })).toBeVisible();
  await drag(page, card(page, "Tier list trends"), column(page, "0.4").locator('[data-lane="accepted"]'), "top");
  await expect(column(page, "0.4").locator('[data-lane="accepted"] [data-feature]').first()).toHaveText(/Tier list trends/);
  await undoFromToast(page, /Moved to 0.4/);
  await expect(column(page, "0.3").locator("[data-feature]", { hasText: "Tier list trends" })).toBeVisible();
});

test("drag between lanes changes the status; order within a lane follows the drop", async ({ page }) => {
  await open(page);
  const v03 = column(page, "0.3");
  await drag(page, card(page, "The website on mvpgg.com"), v03.locator('[data-lane="in_progress"]'));
  await expect(v03.locator('[data-lane="in_progress"] [data-feature]')).toHaveText([/Live names/, /The website on mvpgg.com/]);
  await expect(page.getByRole("status")).toContainText("Started “The website on mvpgg.com”");
  // Hover cards to the top of their lane.
  await drag(page, card(page, "Designed hover cards"), v03.locator('[data-lane="in_progress"]'), "top");
  await expect(v03.locator('[data-lane="in_progress"] [data-feature]').first()).toHaveText(/Designed hover cards/);
});

test("a failed change rolls back and says why", async ({ page }) => {
  allowConsole(page, /status of 500/);
  await open(page);
  await page.route("**/api/features/*/move", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "internal", message: "The disk is full." }),
    }),
  );
  await drag(page, card(page, "First signed release"), column(page, "0.3").locator('[data-lane="accepted"]'));
  await expect(page.getByRole("status")).toContainText("Couldn't move “First signed release”: The disk is full.");
  await expect(column(page, "0.4").locator("[data-feature]", { hasText: "First signed release" })).toBeVisible();
  await expect(column(page, "0.3").locator("[data-feature]", { hasText: "First signed release" })).toHaveCount(0);
});

test("proposals: accept or reject in one click, from the inbox or the card", async ({ page }) => {
  await open(page);
  await page.keyboard.press("i");
  const inbox = page.getByTestId("inbox");
  await expect(inbox.locator("[data-feature]")).toHaveCount(2);
  const first = inbox.locator("[data-feature]", { hasText: "Uptime alerts for the API" });
  await first.getByRole("combobox").selectOption({ label: "0.3" });
  await first.getByRole("button", { name: "Accept" }).click();
  await expect(inbox.locator("[data-feature]")).toHaveCount(1);
  await expect(column(page, "0.3").locator('[data-lane="accepted"] [data-feature]', { hasText: "Uptime alerts" })).toBeVisible();
  // The keyboard: R rejects the selected one.
  await inbox.locator("[data-feature]").first().click();
  await page.keyboard.press("r");
  await expect(inbox.getByText("Inbox zero")).toBeVisible();
  await expect(page.getByRole("button", { name: "Proposals, 0 waiting" })).toBeVisible();
  await undoFromToast(page, /Rejected/);
  await expect(inbox.locator("[data-feature]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(inbox).toHaveCount(0);
  // On the board, the card's own button.
  await card(page, "How the draft helper ranks picks").getByRole("button", { name: "Accept" }).click();
  await expect(column(page, "0.4").locator('[data-lane="accepted"] [data-feature]', { hasText: "How the draft helper" })).toBeVisible();
  await expect(column(page, "0.4").locator('[data-lane="proposed"]')).toHaveCount(0);
});

test("create a feature, remove it, undo, and Ctrl+Z", async ({ page }) => {
  await open(page);
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "New feature" });
  await dialog.getByLabel("Title").fill("Heatmaps of deaths");
  await dialog.getByLabel("Area").selectOption({ label: "Live" });
  await dialog.getByLabel("Title").press("Enter");
  const sheet = page.getByTestId("feature-sheet");
  await expect(sheet.getByRole("heading", { name: "Heatmaps of deaths" })).toBeVisible();
  await expect(column(page, "0.3").locator('[data-lane="accepted"] [data-feature]', { hasText: "Heatmaps of deaths" })).toBeVisible();

  await sheet.getByRole("button", { name: "Remove" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(card(page, "Heatmaps of deaths")).toHaveCount(0);
  await undoFromToast(page, /Removed “Heatmaps of deaths”/);
  await expect(card(page, "Heatmaps of deaths")).toBeVisible();

  // Delete on a selected card, then Ctrl+Z.
  await card(page, "First signed release").focus();
  await page.keyboard.press("Delete");
  await expect(card(page, "First signed release")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(card(page, "First signed release")).toBeVisible();
  await page.reload();
  await expect(card(page, "First signed release")).toBeVisible();
});

test("filters and search narrow every view and survive a reload", async ({ page }) => {
  await open(page);
  await page.keyboard.press("/");
  await page.keyboard.type("trends");
  await expect(page.getByTestId("board").locator("[data-feature]")).toHaveText([/Tier list trends/]);
  await expect(page).toHaveURL(/q=trends/);
  await page.reload();
  await expect(page.getByTestId("board").locator("[data-feature]")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page.getByRole("button", { name: /^Area/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /Live/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board").locator("[data-feature]")).toHaveText([/Live names/]);
  await expect(page.getByText(/1 of 10 features/)).toBeVisible();
  // Rejected ones only when asked for.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /^Status/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /Rejected/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board").locator("[data-feature]")).toHaveText([/Ban suggestions/]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /^Proposed by/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /Claude/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board").locator("[data-feature]")).toHaveCount(2);
  // The list and the roadmap follow the same filters.
  await page.keyboard.press("3");
  await expect(page.getByTestId("list").locator("[data-feature]")).toHaveCount(2);
  await page.keyboard.press("2");
  await expect(page.getByTestId("roadmap").locator("[data-feature]")).toHaveCount(2);
});

test("the command palette runs commands and finds features", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("go to roadmap");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByTestId("roadmap")).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.keyboard.type("signed release");
  await expect(palette.getByRole("option").first()).toContainText("First signed release");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("feature-sheet").getByRole("heading", { name: "First signed release" })).toBeVisible();

  // Actions on the selected feature: move it to another version.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("move to");
  await page.keyboard.press("Enter");
  await page.keyboard.type("0.3");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Moved to 0.3: “First signed release”");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("the keyboard walks the board and acts on the selection", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-feature]:focus")).toHaveCount(1);
  // To 0.4's first accepted card: right twice from 0.2, down past the proposals.
  await card(page, "Tier list trends").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("feature-sheet").getByRole("heading", { name: "Tier list trends" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feature-sheet")).toHaveCount(0);
  await expect(card(page, "Tier list trends")).toBeFocused();
  await page.keyboard.press("s");
  await expect(column(page, "0.4").locator('[data-lane="in_progress"] [data-feature]')).toHaveText([/Tier list trends/]);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(column(page, "0.3").locator('[data-lane="in_progress"] [data-feature]', { hasText: "Tier list trends" })).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(column(page, "0.3").locator('[data-lane="in_progress"] [data-feature]')).toHaveText([/Tier list trends/, /Live names/]);
  await page.keyboard.press("d");
  await expect(column(page, "0.3").locator('[data-lane="done"] [data-feature]', { hasText: "Tier list trends" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-feature]:focus")).toHaveCount(1);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the sheet edits title and description inline, takes comments and links", async ({ page }) => {
  await open(page);
  await card(page, "The website on mvpgg.com").click();
  const sheet = page.getByTestId("feature-sheet");
  await sheet.getByRole("heading", { name: "The website on mvpgg.com" }).click();
  await sheet.getByLabel("Title").fill("The website, mvpgg.com");
  await sheet.getByLabel("Title").press("Enter");
  await expect(sheet.getByRole("heading", { name: "The website, mvpgg.com" })).toBeVisible();
  await expect(sheet.locator("strong", { hasText: "every version" })).toBeVisible();

  await sheet.getByRole("button", { name: "Edit" }).click();
  await sheet.getByLabel("Description (markdown)").fill("Home, **versions**, privacy.\n\n- English\n- French");
  await sheet.getByLabel("Description (markdown)").press("Control+Enter");
  await expect(sheet.locator("strong", { hasText: "versions" })).toBeVisible();
  await expect(sheet.locator("li", { hasText: "French" })).toBeVisible();

  await sheet.getByLabel("Comment", { exact: true }).fill("Deploy after the **legal** review.");
  await sheet.getByRole("button", { name: "Comment" }).click();
  await expect(sheet.locator("strong", { hasText: "legal" })).toBeVisible();

  await sheet.getByRole("button", { name: "Link", exact: true }).click();
  await sheet.getByLabel("Link address").fill("https://github.com/Filmoo/MVP/commit/4714511");
  await sheet.getByLabel("Link label").fill("merge 4714511");
  await sheet.getByRole("button", { name: "Add link" }).click();
  await expect(sheet.getByRole("link", { name: "merge 4714511" })).toHaveAttribute("href", "https://github.com/Filmoo/MVP/commit/4714511");

  await sheet.getByRole("radio", { name: "In progress" }).click();
  await expect(sheet.locator("p", { hasText: "In progress" }).first()).toBeVisible();
  // Everything is in its history, newest first.
  await expect(sheet.locator("ol li").first()).toContainText("In progress");
  await page.reload();
  await expect(page.getByTestId("feature-sheet").getByRole("heading", { name: "The website, mvpgg.com" })).toBeVisible();
});

test("the list sorts and renames in place; the roadmap draws versions and opens features", async ({ page }) => {
  await open(page, "#/list");
  const list = page.getByTestId("list");
  await expect(list.locator("[data-feature]")).toHaveCount(10);
  await list.getByRole("button", { name: "Feature" }).click();
  await expect(list.locator("[data-feature]").first()).toContainText("Designed hover cards");
  await list.locator("[data-feature]", { hasText: "Designed hover cards" }).getByText("Designed hover cards").dblclick();
  await list.getByLabel("Title").fill("Hover cards, designed");
  await list.getByLabel("Title").press("Enter");
  await expect(list.locator("[data-feature]", { hasText: "Hover cards, designed" })).toBeVisible();

  await page.keyboard.press("2");
  const roadmap = page.getByTestId("roadmap");
  await expect(roadmap.locator("ol > li[data-state]")).toHaveCount(3);
  await expect(roadmap.locator('li[data-state="released"]')).toHaveCount(1);
  await expect(roadmap.locator('li[data-state="active"]')).toHaveCount(1);
  await roadmap.getByRole("button", { name: /Design & glass/ }).click();
  await expect(roadmap.locator("[data-feature]")).toHaveCount(2);
  await roadmap.locator("[data-feature]", { hasText: "Liquid glass" }).click();
  await expect(page.getByTestId("feature-sheet").getByRole("heading", { name: "Liquid glass" })).toBeVisible();
});

test("the activity log lists every change with who made it", async ({ page }) => {
  await open(page);
  await card(page, "How the draft helper ranks picks").getByRole("button", { name: "Reject" }).click();
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Activity log" }).click();
  const activity = page.getByTestId("activity");
  await expect(activity.locator("li").first()).toContainText("“How the draft helper ranks picks”: Proposed → Rejected");
  await expect(activity.locator("li").first()).toContainText("dev-admin");
  await expect(activity.getByText("Imported the roadmap from the docs")).toBeVisible();
});

test("Claude's command line proposes, works on accepted features and comments", async ({ page }) => {
  await open(page);
  const { token } = (await (await page.request.post("/api/dev/token")).json()) as { token: string };
  const script = resolve(import.meta.dirname, "../../../../scripts/roadmap.mjs");
  const env = { ...process.env, MVP_ROADMAP_URL: test.info().project.use.baseURL ?? "", MVP_ROADMAP_TOKEN: token };
  const run = async (...args: string[]) => (await promisify(execFile)(process.execPath, [script, ...args], { env })).stdout;

  const proposed = await run("propose", "Heatmaps of deaths", "--area", "live", "--version", "0.4", "--description", "From the timelines.");
  expect(proposed).toMatch(/^proposed #\d+ for 0\.4: Heatmaps of deaths/);
  const id = proposed.match(/#(\d+)/)?.[1] ?? "";
  expect(await run("list", "--status", "proposed")).toContain("Heatmaps of deaths (Claude)");
  const refused = await run("status", id, "accepted").catch((error: { stderr: string }) => error.stderr);
  expect(refused).toContain("the owner's call");
  const trends = (await run("list", "--json")).match(/"id": (\d+),\s+"title": "Tier list trends"/)?.[1] ?? "";
  expect(
    await run("status", trends, "in_progress", "--link", "https://github.com/Filmoo/MVP/commit/abc1234", "--label", "abc1234"),
  ).toContain("is in progress: Tier list trends (linked");
  expect(await run("comment", id, "Deaths by minute, from Match-V5 timelines.")).toContain(`commented on #${id}`);

  // Back in the page: the proposal waits in the inbox, the work moved along.
  await page.reload();
  await page.keyboard.press("i");
  await expect(page.getByTestId("inbox").locator("[data-feature]", { hasText: "Heatmaps of deaths" })).toBeVisible();
  await expect(column(page, "0.4").locator('[data-lane="in_progress"] [data-feature]', { hasText: "Tier list trends" })).toBeVisible();
});

const SIZES = [
  { width: 400, height: 800 },
  { width: 768, height: 900 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

test("every view lays out from 400 to 2560 px: no sideways page, nothing overlapping", async ({ page }) => {
  await open(page);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const view of ["board", "roadmap", "list"]) {
      await page.goto(`/#/${view}`);
      await expect(page.getByTestId(view)).toBeVisible();
      await settle(page);
      const at = `${view} @ ${size.width}`;
      const layout = await page.evaluate(() => {
        const header = [...document.querySelectorAll("[data-testid=topbar] > *")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const overlaps = header.some((a, i) =>
          header.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1),
        );
        // A narrow board starts scrolled to the version being built, so earlier columns sit off to
        // the left on purpose: the check is that some feature shows in full.
        const features = [...document.querySelectorAll("[data-view] [data-feature]")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const first = features.find((r) => r.left >= 0 && r.right <= window.innerWidth) ?? features[0];
        return {
          pageWidth: document.documentElement.scrollWidth,
          width: window.innerWidth,
          headerRight: Math.max(...header.map((r) => r.right)),
          overlaps,
          first: first ? { left: first.left, right: first.right, top: first.top } : null,
        };
      });
      expect(layout.pageWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(layout.width);
      expect(layout.headerRight, `${at}: the top bar spills`).toBeLessThanOrEqual(layout.width);
      expect(layout.overlaps, `${at}: top bar items overlap`).toBe(false);
      expect(layout.first, `${at}: a feature shows`).not.toBeNull();
      expect(layout.first?.left ?? -1, at).toBeGreaterThanOrEqual(0);
      expect(layout.first?.top ?? 9999, at).toBeLessThan(size.height);
    }
  }
  // Sheets and dialogs fit the narrowest window.
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto("/#/board?panel=inbox");
  await expect(page.getByTestId("inbox")).toBeVisible();
  await still(page);
  const inbox = await page.getByTestId("inbox").boundingBox();
  expect((inbox?.x ?? -1) >= 0 && (inbox?.width ?? 999) <= 400).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await still(page);
  const palette = await page.getByRole("dialog", { name: "Command palette" }).boundingBox();
  expect((palette?.x ?? -1) >= 0 && (palette?.x ?? 0) + (palette?.width ?? 999) <= 400).toBe(true);
});

test("idle means idle: nothing runs while nothing changes", async ({ page }) => {
  await open(page);
  for (const view of ["board", "roadmap"]) {
    await page.goto(`/#/${view}`);
    await expect(page.getByTestId(view)).toBeVisible();
    // Let the one-time entrance (rings filling, nodes landing) finish.
    await page.waitForTimeout(2_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const before = await metrics();
    await page.waitForTimeout(2_000);
    const after = await metrics();
    expect((after.LayoutCount ?? 0) - (before.LayoutCount ?? 0), `${view}: layouts at rest`).toBe(0);
    expect((after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0), `${view}: style work at rest`).toBe(0);
    expect(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000, `${view}: script at rest`).toBeLessThan(5);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(running, `${view}: running animations`).toBe(0);
    await cdp.detach();
  }
});
