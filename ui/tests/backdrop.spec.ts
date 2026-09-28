import type { Page } from "@playwright/test";
// Brings the window.__SCOUT_MOCK__ declaration into scope.
import type {} from "../src/data/mock";
import { lockInImport } from "../src/data/mock/import-fixtures";
import { expect, openApp, settle, test, trackErrors } from "./app";

// The WebGL backdrop (src/design/backdrop): which level renders, fallbacks, and that it renders
// on demand only. Render costs and idle silence are budgeted in perf.spec.ts.

const effects = (page: Page) => page.evaluate(() => document.documentElement.dataset.effects);
const fallback = (page: Page) => page.evaluate(() => document.documentElement.dataset.effectsFallback);
const renders = (page: Page) => page.evaluate(() => performance.getEntriesByName("backdrop").length);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shellBackground = (page: Page) => page.locator("[data-ambient-host]").evaluate((el) => getComputedStyle(el).backgroundImage);

/** Luminance of the window's top center with all content hidden: the light itself. */
async function lightAtTop(page: Page): Promise<number> {
  await page.addStyleTag({
    content: "main, header, nav { visibility: hidden !important; backdrop-filter: none !important }",
  });
  await frames(page);
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  const shot = await page.screenshot({ clip: { x: size.width / 2 - 20, y: 60, width: 40, height: 40 } });
  return page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
    return sum / (d.length / 4);
  }, shot.toString("base64"));
}

test("auto: the shader draws the light behind the shell, in place of the CSS gradients", async ({ page }) => {
  await openApp(page);
  expect(await effects(page)).toBe("shader");
  const canvas = page.getByTestId("backdrop");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("aria-hidden", "true");
  expect(await shellBackground(page)).toBe("none");
  // Half resolution, scaled up by CSS.
  const size = await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height, c.clientWidth, c.clientHeight]);
  expect(size).toEqual([640, 400, 1280, 800]);
  // It really draws: the light is well above the bare background (#0d0e15, luminance ≈ 14).
  expect(await lightAtTop(page)).toBeGreaterThan(24);
});

test("no WebGL: the CSS light stays, and says why", async ({ page }) => {
  await openApp(page, { webgl: "missing" });
  expect(await effects(page)).toBe("css");
  expect(await fallback(page)).toBe("no-webgl");
  await expect(page.getByTestId("backdrop")).toBeHidden();
  expect(await shellBackground(page)).toContain("radial-gradient");
  expect(await renders(page)).toBe(0);
  expect(await lightAtTop(page)).toBeGreaterThan(24);
});

test("the speed probe decides on its own and says why when it declines", async ({ page }) => {
  await openApp(page, { webgl: "probe", freezeClock: false });
  const probe = await page.evaluate(() => performance.getEntriesByName("backdrop:probe")[0]?.duration);
  expect(probe).toBeGreaterThan(0);
  if ((probe ?? 0) > 8) {
    expect(await effects(page)).toBe("css");
    expect(await fallback(page)).toBe("slow");
  } else {
    expect(await effects(page)).toBe("shader");
  }
});

test("light: today's gradients, no shader", async ({ page }) => {
  await openApp(page, { effects: "light" });
  expect(await effects(page)).toBe("css");
  expect(await fallback(page)).toBeUndefined();
  await expect(page.getByTestId("backdrop")).toBeHidden();
  expect(await shellBackground(page)).toContain("radial-gradient");
});

test("off: no light and no blur at all", async ({ page }) => {
  await openApp(page, { effects: "off" });
  expect(await effects(page)).toBe("flat");
  expect(await shellBackground(page)).toBe("none");
  expect(
    await page
      .locator("header")
      .first()
      .evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toBe("none");
  expect(await renders(page)).toBe(0);
});

test("renders on demand: on scroll, resize and view changes, never at rest", async ({ page }) => {
  await openApp(page, { freezeClock: false });
  await page.waitForTimeout(300);
  const rest = await renders(page);
  await page.waitForTimeout(1_000);
  expect(await renders(page), "at rest").toBe(rest);

  await page.mouse.move(500, 500);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => renders(page), { message: "scrolling moves the glass" }).toBeGreaterThan(rest);

  const scrolled = await renders(page);
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(() => renders(page), { message: "resizing" }).toBeGreaterThan(scrolled);
  const canvas = await page.getByTestId("backdrop").evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(canvas).toEqual([550, 380]);

  const resized = await renders(page);
  await page.evaluate(() => {
    window.location.hash = "/settings";
  });
  await settle(page);
  await expect.poll(() => renders(page), { message: "new glass panes" }).toBeGreaterThan(resized);
  await page.waitForTimeout(800); // the page light glides to the new view (600 ms), then stops

  // A scroller without glass inside doesn't wake it.
  const before = await renders(page);
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;width:10px;height:10px;overflow:auto";
    box.innerHTML = '<div style="height:100px"></div>';
    document.body.appendChild(box);
    box.scrollTop = 50;
  });
  await frames(page);
  await frames(page);
  expect(await renders(page)).toBe(before);
});

test("a lost GPU context falls back to the CSS light, and comes back", async ({ page }) => {
  await openApp(page);
  const lose = (restore: boolean) =>
    page.getByTestId("backdrop").evaluate((c: HTMLCanvasElement, r) => {
      // The extension can't be fetched from a lost context: keep the one that lost it.
      const w = window as { __lose?: WEBGL_lose_context | null | undefined };
      w.__lose ??= c.getContext("webgl")?.getExtension("WEBGL_lose_context");
      if (r) w.__lose?.restoreContext();
      else w.__lose?.loseContext();
    }, restore);
  await lose(false);
  await expect.poll(() => effects(page)).toBe("css");
  expect(await fallback(page)).toBe("context-lost");
  expect(await shellBackground(page)).toContain("radial-gradient");
  await lose(true);
  await expect.poll(() => effects(page)).toBe("shader");
  expect(await fallback(page)).toBeUndefined();
});

// Liquid glass over the page (src/design/liquid): SVG lenses as backdrop filters, only with the shader.

/** The title bar's glass layer: its backdrop filter, and the lens it points to (if any). */
const barGlass = (page: Page) =>
  page
    .locator("header > [aria-hidden=true]")
    .first()
    .evaluate((el) => {
      const id = /url\("?#([\w-]+)"?\)/.exec(getComputedStyle(el).backdropFilter)?.[1];
      const lens = id ? document.getElementById(id) : null;
      return {
        filter: getComputedStyle(el).backdropFilter,
        displacements: lens ? lens.querySelectorAll("feDisplacementMap").length : 0,
        slices: lens ? lens.querySelectorAll("feImage").length : 0,
      };
    });

test("liquid glass: the title bar bends the page under its rim with the shader", async ({ page }) => {
  await openApp(page);
  // The lens builder loads with the first lens.
  await expect.poll(async () => (await barGlass(page)).filter).toContain("url(");
  const full = await barGlass(page);
  // One displaced copy (no colour split over text); the bar only has its lower rim (one slice).
  expect(full.displacements).toBe(1);
  expect(full.slices).toBe(1);
});

for (const [name, options, expected] of [
  ["light", { effects: "light" }, /^blur\(/],
  ["off", { effects: "off" }, /^none$/],
  ["no WebGL", { webgl: "missing" }, /^blur\(/],
] as const) {
  test(`liquid glass: ${name} keeps the title bar's plain frost`, async ({ page }) => {
    await openApp(page, options);
    expect((await barGlass(page)).filter).toMatch(expected);
  });
}

test("liquid glass: the rail's lens sits on the current section and glides to the next", async ({ page, t }) => {
  await openApp(page, { freezeClock: false });
  const lens = page.getByTestId("rail-lens");
  const over = async (label: string) => {
    const [l, i] = await Promise.all([lens.boundingBox(), page.getByRole("link", { name: label }).boundingBox()]);
    return l && i ? Math.hypot(l.x - i.x, l.y - i.y) : Number.POSITIVE_INFINITY;
  };
  expect(await over(t.nav.home.label)).toBeLessThan(1);
  await page.getByRole("link", { name: t.nav.settings.label }).click();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  expect(await over(t.nav.settings.label)).toBeLessThan(1);
  // At rest again: nothing animates.
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

/**
 * Every element that lenses the page right now, with the shadows it carries. An SVG backdrop
 * filter shares its element with inset shadows only: Chromium shifts the filter by the reach of
 * an outer one (the lens then bends the wrong part of the page).
 */
const lensShadows = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-liquid]")]
      .filter((el) => getComputedStyle(el).backdropFilter.includes("url("))
      .map((el) => ({
        kind: el.dataset.liquid,
        where: el.parentElement?.dataset.testid ?? el.parentElement?.className ?? "",
        // One entry per shadow ("none" when there is none).
        shadows: getComputedStyle(el)
          .boxShadow.split(/,(?![^(]*\))/)
          .map((s) => s.trim()),
      })),
  );

const outerShadows = (lenses: Awaited<ReturnType<typeof lensShadows>>) =>
  lenses.flatMap((l) => l.shadows.filter((s) => s !== "none" && !s.includes("inset")).map((s) => `${l.kind} in ${l.where}: ${s}`));

test("liquid glass: nothing that lenses the page carries an outer shadow", async ({ page, t }) => {
  const errors = trackErrors(page);
  await openApp(page);
  // Title bar, rail lens, rank pane over the art.
  await expect.poll(async () => (await lensShadows(page)).length).toBeGreaterThanOrEqual(3);
  expect(outerShadows(await lensShadows(page))).toEqual([]);
  // The search panel over the page.
  await page.getByTestId("search-input").click();
  await page.keyboard.type("ahri");
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await expect.poll(async () => (await lensShadows(page)).filter((l) => l.kind === "panel").length).toBeGreaterThanOrEqual(2);
  expect(outerShadows(await lensShadows(page))).toEqual([]);
  await page.keyboard.press("Escape");
  // A toast.
  await page.evaluate((result) => window.__SCOUT_MOCK__?.emit("import", result), lockInImport);
  await expect(page.getByTestId("toast")).toBeVisible();
  expect(outerShadows(await lensShadows(page))).toEqual([]);
  // Settings: segment thumbs, and a switch held down.
  await page.getByRole("link", { name: t.nav.settings.label }).click();
  const toggle = page.getByRole("switch", { name: t.settings.app.closeToTray.title });
  await toggle.scrollIntoViewIfNeeded();
  const box = await toggle.boundingBox();
  if (!box) throw new Error("no switch");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(toggle).toHaveAttribute("data-pressed", "");
  await expect.poll(() => toggle.locator("span").evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("url(");
  expect(outerShadows(await lensShadows(page))).toEqual([]);
  await page.mouse.up();
  // Stats pages: segmented thumbs.
  await page.getByRole("link", { name: t.nav.tierList.label }).click();
  await expect(page.getByTestId("queue-switch")).toBeVisible();
  expect(outerShadows(await lensShadows(page))).toEqual([]);
  expect(errors).toEqual([]);
});

test("liquid glass: a held switch turns its knob into a lens, released it's solid again", async ({ page, t }) => {
  await openApp(page, { view: "/settings" });
  const toggle = page.getByRole("switch", { name: t.settings.app.closeToTray.title });
  const knobFilter = () => toggle.locator("span").evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(await knobFilter()).toBe("none");
  // The pointer goes where the switch is on screen.
  await toggle.scrollIntoViewIfNeeded();
  const box = await toggle.boundingBox();
  if (!box) throw new Error("no switch");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(toggle).toHaveAttribute("data-pressed", "");
  expect(await knobFilter()).toContain("url(");
  await page.mouse.up();
  await expect(toggle).not.toHaveAttribute("data-pressed");
  expect(await knobFilter()).toBe("none");
});
