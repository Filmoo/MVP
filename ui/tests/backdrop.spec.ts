import { expect, type Page, test } from "@playwright/test";
import { openApp, settle } from "./app";

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
