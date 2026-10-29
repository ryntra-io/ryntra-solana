// A window of the city on another screen (CITY-75) for review → <out>/out-<state>.jpg: the city with its chart out and
// the window beside it, both ways — Document Picture-in-Picture (Chrome, Edge) and a page of its own (Firefox, Safari;
// here Chromium with Picture-in-Picture taken away) — the window brought back, and the phone with no way out.
//   NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE=open npm run dev, then
//   xvfb-run -a node city/lib/window/out-shots.mjs [out=docs/shots/city-75] [baseUrl]
// A full Chromium, not the headless shell: the shell has no Picture-in-Picture. No wallet is connected; nothing is signed.
// STAND_CANDLES=1 answers the chart's bars on the stand itself (a box whose network cannot reach the engine's source):
// a quiet walk around the tower's price, so the shots show the chart drawing out there. Never in the product.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-75");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.PRESS_CHROME || undefined,
  args: ["--use-gl=angle", `--use-angle=${process.env.PRESS_ANGLE ?? "swiftshader"}`, "--ignore-gpu-blocklist", "--window-size=1440,960"],
});
const errors = [];
const DESK = { width: 1440, height: 860 };

async function context_(viewport, { noPip = false, phone = false } = {}) {
  // On a computer the page takes the browser window's size, so a window out there opens at the size it asks for.
  const ctx = await browser.newContext(phone ? { viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: null });
  if (noPip) await ctx.addInitScript(() => Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }));
  await standCandles(ctx);
  return ctx;
}

/**
 * The stand's bars, answered inside the page by its own `fetch` (never by Playwright's routing: it holds back the
 * requests of a Picture-in-Picture document, its style sheets among them — an artefact of the tool, not of the city).
 */
async function standCandles(ctx) {
  if (process.env.STAND_CANDLES !== "1") return;
  await ctx.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      let url;
      try {
        url = new URL(input instanceof Request ? input.url : String(input), location.href);
      } catch {
        return real(input, init);
      }
      if (url.pathname !== "/api/spot/candles") return real(input, init);
      const tf = url.searchParams.get("tf") ?? "15m";
      const step = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1D": 86400 }[tf] ?? 900;
      const end = Math.floor(Date.now() / 1000 / step) * step;
      let price = 101.25;
      let seed = 7;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const candles = [];
      for (let i = 180; i > 0; i -= 1) {
        const open = price;
        const close = Math.max(1, open * (1 + (rand() - 0.49) * 0.012));
        const high = Math.max(open, close) * (1 + rand() * 0.004);
        const low = Math.min(open, close) * (1 - rand() * 0.004);
        candles.push({ time: end - i * step, open, high, low, close, volume: Math.round(20_000 + rand() * 90_000) });
        price = close;
      }
      const body = { timeframe: tf, candles, pool: { name: "SOL / USDC" }, observedAt: new Date().toISOString(), stale: false, source: { label: "stand" } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    };
  });
}

async function city(context, query = "?windows=demo") {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`city: ${e}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`city: ${m.text().slice(0, 300)}`));
  await page.addInitScript(() => localStorage.setItem("ryntra.city.firstHint", "1"));
  await page.goto(`${base}/${query}`, { waitUntil: "load", timeout: 180_000 });
  await page.locator("canvas").first().waitFor({ state: "attached", timeout: 240_000 });
  await page.locator("[data-city-chart]").first().waitFor({ timeout: 240_000 });
  await page.waitForTimeout(3_000);
  return page;
}

/**
 * The chart out onto another screen from its frame's button; the window out there, as Playwright sees it. Under Xvfb the
 * very first browser window a fresh browser opens is sometimes never reported to Playwright, though the page got its
 * handle: then the chart is brought back from the tray and sent out once more.
 */
async function sendOut(context, page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const opened = context.waitForEvent("page", { timeout: 12_000 }).catch(() => null);
    await page.locator('[data-window="chart"] button[aria-label="Open in a new window"]').click({ timeout: 30_000 });
    const out = await opened;
    if (out) return out;
    const back = page.locator('button[aria-label="Bring Chart back"]');
    if (await back.count()) await back.click();
    await page.locator('[data-window="chart"] button[aria-label="Open in a new window"]').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
  }
  throw new Error("the chart did not go out");
}

/** The size the window asked for, as a window manager gives it on a real desk (Xvfb has none of its own). */
async function sizeOut(context, out) {
  try {
    const cdp = await context.newCDPSession(out);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: 720, height: 600 } });
  } catch (e) {
    console.warn(`the window out there keeps its size (${String(e).slice(0, 120)})`);
  }
}

const shot = async (page, name) => sharp(await page.screenshot({ type: "png" })).webp({ quality: 82 }).toFile(path.join(out, `out-${name}.webp`));

/** The city and the window out there side by side, as two screens stand on a desk. */
async function together(context, left, right, name) {
  const a = (await left.screenshot({ type: "jpeg", quality: 90 })).toString("base64");
  const b = (await right.screenshot({ type: "jpeg", quality: 90 })).toString("base64");
  const page = await context.newPage();
  await page.setViewportSize({ width: 2240, height: 900 });
  await page.setContent(
    `<body style="margin:0;overflow:hidden;background:#050409;display:flex;gap:28px;align-items:center;justify-content:center;height:100vh">` +
      `<img src="data:image/jpeg;base64,${a}" style="height:760px;max-width:1300px;object-fit:contain;border-radius:6px;box-shadow:0 30px 80px #000">` +
      `<img src="data:image/jpeg;base64,${b}" style="height:600px;max-width:740px;object-fit:contain;border-radius:6px;box-shadow:0 30px 80px #000;outline:1px solid #ff681c55">` +
      `</body>`,
  );
  await page.waitForTimeout(300);
  await shot(page, name);
  await page.close();
}

// ---------- The first way: Document Picture-in-Picture ----------
{
  const context = await context_(DESK);
  const page = await city(context);
  await shot(page, "frame-button");
  const pip = await sendOut(context, page);
  await sizeOut(context, pip);
  await pip.locator('[data-window-out="pip"] [data-city-chart]').waitFor({ timeout: 60_000 });
  await pip.waitForTimeout(3_000);
  if (await page.locator('[data-window="chart"]').count()) errors.push("pip: the chart's frame stayed in the city");
  if (!(await page.locator('button[aria-label="Bring Chart back"]').count())) errors.push("pip: no way back in the city");
  const canvas = await pip.locator("canvas").count();
  if (!canvas) errors.push("pip: no chart canvas out there");
  await shot(page, "pip-city");
  await shot(pip, "pip-window");
  await together(context, page, pip, "pip-together");

  // Back in one tap, from the window out there: it closes and the chart stands in the city where it stood.
  await pip.locator('button[aria-label="Back to the city"]').click();
  await page.waitForTimeout(800);
  if (!(await page.locator('[data-window="chart"]').count())) errors.push("pip: the chart did not come back");
  if (!pip.isClosed()) errors.push("pip: the window out there stayed open");
  const memory = await page.evaluate(() => localStorage.getItem("ryntra.city.windows.out.v1"));
  if (!memory || JSON.parse(memory).out.length) errors.push(`pip: memory after coming back: ${memory}`);
  await shot(page, "pip-back");
  await context.close();
}

// ---------- The second way: a page of its own (no Picture-in-Picture, as in Firefox and Safari) ----------
{
  const context = await context_(DESK, { noPip: true });
  const page = await city(context);
  const tab = await sendOut(context, page);
  await sizeOut(context, tab);
  tab.on("pageerror", (e) => errors.push(`tab: ${e}`));
  await tab.waitForLoadState("load");
  if (!/\/window\?id=chart&tower=/.test(tab.url())) errors.push(`tab: opened ${tab.url()}`);
  await tab.locator('[data-window-out="tab"] [data-city-chart]').waitFor({ timeout: 240_000 });
  await tab.waitForTimeout(4_000);
  if (await tab.locator("canvas[data-engine], [class*=CityCanvas]").count()) errors.push("tab: the 3D city is drawn on the window's page");
  await shot(page, "tab-city");
  await shot(tab, "tab-window");
  await together(context, page, tab, "tab-together");

  // The tray in the city brings it back: the page is told over the channel and closes.
  await page.locator('button[aria-label="Bring Chart back"]').click();
  await page.waitForTimeout(1_000);
  if (!(await page.locator('[data-window="chart"]').count())) errors.push("tab: the chart did not come back");
  if (!tab.isClosed()) errors.push("tab: the page out there stayed open");

  // Out again, then the person closes that page: the chart comes back by itself.
  const second = await sendOut(context, page);
  await second.waitForLoadState("load");
  await second.waitForTimeout(2_000);
  await second.close({ runBeforeUnload: true });
  await page.waitForTimeout(1_500);
  if (!(await page.locator('[data-window="chart"]').count())) errors.push("tab: closing the page did not bring the chart back");
  await context.close();
}

// ---------- A phone: no way out ----------
{
  const context = await context_({ width: 390, height: 844 }, { phone: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`phone: ${e}`));
  await page.addInitScript(() => localStorage.setItem("ryntra.city.firstHint", "1"));
  await page.goto(`${base}/?windows=demo`, { waitUntil: "load", timeout: 180_000 });
  await page.locator('[aria-label="Open windows"] [role="tab"]').first().waitFor({ timeout: 180_000 });
  await page.getByRole("tab", { name: "Chart" }).click();
  await page.locator("[data-city-chart]").first().waitFor({ timeout: 180_000 });
  await page.waitForTimeout(3_000);
  if (await page.locator('button[aria-label="Open in a new window"]').count()) errors.push("phone: a way out on a phone");
  await shot(page, "phone");
  await context.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`shots → ${out}`);
