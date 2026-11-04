// «AI chats» for review (CITY-170): the menu with its new row, the page as a window over the city (and with
// «Technical details» open), Developers with its door to it, and the page at its own address — on a desk (1440×900)
// and a phone (375×812), English and Ukrainian → <out>/<name>.jpg
//   npm run dev      then      node city/lib/pages/connector-shots.mjs [out] [baseUrl]
// A cloud session: CHROME=/opt/pw-browsers/chromium.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-170");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const want = (name) => !ONLY || ONLY.has(name);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];

async function context(size, lang) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
  await ctx.addInitScript((lang) => {
    try {
      window.localStorage.setItem("ryntra.city.lang", lang);
    } catch {}
  }, lang);
  await ctx.route("**/api/icon/*", (route) => route.fulfill({ status: 204 }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${size.name} ${lang}: ${e}`));
  return { ctx, page };
}

const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))).catch(() => {});

const shot = async (page, name, options = {}) => {
  await frames(page);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 82, ...options });
  console.log("shot", name);
};

const settle = (page, ms = 1500) =>
  page
    .waitForFunction(() => [...document.images].filter((img) => img.getBoundingClientRect().height > 0).every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 60_000 })
    .catch(() => {})
    .then(() => page.waitForTimeout(ms));

async function city(size, lang) {
  const { ctx, page } = await context(size, lang);
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(() => typeof window.__pages?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 480_000 });
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const later = page.getByRole("button", { name: /^(Later|Пізніше|Got it|Зрозуміло)$/ });
  if (await later.first().isVisible().catch(() => false)) await later.first().click({ timeout: 10_000, force: true }).catch(() => {});
  return { ctx, page };
}

const menuButton = (page) => page.locator("[data-city-menu] > button").first();

/** Opens the menu as a visitor does; a HUD still settling after the intro is clicked through on the second try. */
async function openMenu(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await menuButton(page).click({ timeout: 15_000, force: attempt > 0 }).catch(() => {});
    if (await page.locator("#city-menu").isVisible().catch(() => false)) return;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1500);
  }
  throw new Error("the menu did not open");
}
const AI_CHATS = /^(AI chats|AI-чати)$/;

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const tag = `${lang}-${size.name}`;
    if (want(`city-${tag}`)) {
      const { ctx, page } = await city(size, lang);
      await openMenu(page);
      await page.waitForTimeout(800);
      await shot(page, `menu-${tag}`);
      await page.locator("#city-menu").getByRole("button", { name: AI_CHATS }).click();
      const win = page.locator('[data-city-page="connector"]');
      await win.waitFor({ timeout: 120_000 });
      await settle(page, 2500);
      await shot(page, `window-connector-${tag}`);
      // Scrolled to what it does, privacy and limits.
      await win.evaluate((node) => node.closest("[data-where]")?.parentElement?.scrollBy?.(0, 520));
      await win.locator("details summary").scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, `window-connector-more-${tag}`);
      await win.locator("details summary").click();
      await page.waitForTimeout(500);
      await win.locator("details").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(400);
      await shot(page, `window-connector-details-${tag}`);
      if (lang === "en") {
        // Developers: the door to «AI chats».
        await page.evaluate(() => window.__pages.getState().closeAll());
        await page.evaluate(() => window.__pages.getState().show("developers"));
        await page.locator('[data-city-page="developers"]').waitFor({ timeout: 60_000 });
        await settle(page, 1500);
        await page.locator('[data-city-page="developers"]').getByRole("button", { name: /Ryntra in your AI chat/ }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await shot(page, `window-developers-door-${tag}`);
      }
      await ctx.close();
    }
    if (want(`page-${tag}`)) {
      const { ctx, page } = await context(size, lang);
      await page.goto(`${base}/connector`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.locator('[data-city-doc="connector"]').waitFor({ timeout: 120_000 });
      await settle(page, 1500);
      await shot(page, `page-connector-${tag}`);
      const scroller = page.locator('[data-city-doc="connector"]');
      await page.locator('[data-city-doc="connector"] details summary').click();
      await page.waitForTimeout(500);
      // The whole page, «Technical details» open: what a reader of the documentation sees end to end.
      const height = await scroller.evaluate((node) => node.scrollHeight);
      await page.setViewportSize({ width: size.width, height: Math.min(height, 4000) });
      await settle(page, 800);
      await shot(page, `page-connector-full-${tag}`);
      await ctx.close();
    }
  }
}

await browser.close();
if (errors.length) {
  console.log("page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
