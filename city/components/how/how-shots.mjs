// «How it works» for review (CITY-43): the menu (☰), the lessons' window over the city, a lesson's details, a film
// playing, «Try» opening its function, and the page /how-it-works — on a desk (1440×900) and a phone (375×812), English
// and Ukrainian → <out>/<name>.jpg
//   npm run dev      then      node city/components/how/how-shots.mjs [out] [baseUrl]
// PHASE=today: the build as it stands with no lesson — the menu has no row, the page leads into the city.
// PHASE=lessons (default): with lessons placed by scripts/city/how-films.mjs (for review, a test film may stand in).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-43");
const base = process.argv[3] ?? "http://localhost:3000";
const phase = process.env.PHASE ?? "lessons";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const want = (name) => !ONLY || ONLY.has(name);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
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

const shot = async (page, name) => {
  await frames(page);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 82 });
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
  await page.waitForFunction(() => typeof window.__guides?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 480_000 });
  await page.waitForFunction(() => window.__skyline?.ready === true, null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  // A stand without a GPU draws the 3D city in software, and its frames hold the page's thread: once the city has
  // drawn, its frame loop slows to one frame in 1.5 s, so the panels answer the taps and paint before each picture.
  if (process.env.SLOW_CITY !== "0") await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 1500);
  });
  const later = page.getByRole("button", { name: /^(Later|Пізніше|Got it|Зрозуміло)$/ });
  if (await later.first().isVisible().catch(() => false)) await later.first().click({ timeout: 10_000, force: true }).catch(() => {});
  await page.waitForTimeout(2000);
  return { ctx, page };
}

const menuButton = (page) => page.locator("[data-city-menu] > button").first();

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const tag = `${lang}-${size.name}`;
    if (phase === "today") {
      const { ctx, page } = await city(size, lang);
      await menuButton(page).click();
      await page.locator("#city-menu").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2000);
      const rows = await page.locator("[data-city-menu-guides]").count();
      console.log(`${tag}: lessons row in the menu: ${rows}`);
      await shot(page, `today-menu-${tag}`);
      const res = await page.goto(`${base}/how-it-works`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      console.log(`${tag}: /how-it-works → ${new URL(page.url()).pathname} (${res?.status()})`);
      await ctx.close();
      continue;
    }
    if (want(`city-${tag}`)) {
      const { ctx, page } = await city(size, lang);
      await menuButton(page).click();
      await page.locator("[data-city-menu-guides]").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2000);
      await shot(page, `menu-${tag}`);
      await page.locator("[data-city-menu-guides]").click();
      await page.locator("[data-city-guides] [data-guide]").first().waitFor({ timeout: 120_000 });
      await settle(page, 2000);
      await shot(page, `window-${tag}`);
      // A lesson's steps behind «Details».
      const first = page.locator("[data-city-guides] [data-guide]").first();
      await first.locator("button[aria-expanded]").click();
      await page.waitForTimeout(2000);
      await shot(page, `details-${tag}`);
      // The film, in the browser's own player.
      await first.locator("button[aria-expanded]").click();
      await first.locator("button").first().click();
      await first.locator("video").waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => {
        const v = document.querySelector("[data-city-guides] video");
        return v && v.currentTime > 2.5;
      }, null, { timeout: 60_000 }).catch(() => {});
      await shot(page, `playing-${tag}`);
      // «Try» on buying from a tower: the trade window opens on a tower of the city.
      const trade = page.locator('[data-city-guides] [data-guide="trade"]');
      if (await trade.count()) {
        await trade.locator("button").last().scrollIntoViewIfNeeded();
        await trade.getByRole("button", { name: /^(Try it|Спробувати)$/ }).click();
        await page.waitForTimeout(3000);
        await shot(page, `try-${tag}`);
      }
      await ctx.close();
    }
    if (want(`page-${tag}`)) {
      const { ctx, page } = await context(size, lang);
      await page.goto(`${base}/how-it-works`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.locator("[data-city-doc] [data-guide]").first().waitFor({ timeout: 120_000 });
      await settle(page, 1500);
      await shot(page, `page-${tag}`);
      await ctx.close();
    }
  }
}

await browser.close();
if (errors.length) {
  console.log("page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
