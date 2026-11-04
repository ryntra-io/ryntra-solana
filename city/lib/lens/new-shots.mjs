// «New» over the whole of Solana and «Маяк» (CITY-142) for review: the rings over the city with the network's launches in
// the Docks and the beacon's light, then the same launches as a list (the beacon on top, every launchpad, Ryntra's own
// marked), and the «i» behind it — at 1440×900 and 375×812, on the development stand-in (`?launch=stub`, made-up
// launches only; nothing is read from or sent to the network) → <out>/new-<view>-<size>[-<lang>].png
//   npm run dev      then      node city/lib/lens/new-shots.mjs [out] [baseUrl]
// CHROME=<path> runs a Chromium of its own (a cloud session: /opt/pw-browsers/chromium). LANGS=en,uk picks the languages (both by default); SIZES=desk,phone the sizes.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/new-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const SETTLE = Number(process.env.SETTLE ?? 8000);

const gl = process.env.PRESS_CHROME ? ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || process.env.CHROME || undefined, args: gl });
const report = [];

for (const lang of LANGS) {
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
    await page.addInitScript(() => {
      window.localStorage.setItem("ryntra.city.firstHint", "1");
      window.localStorage.setItem("ryntra.city.lens", "all");
    });
    await page.goto(`${base}/?launch=stub&quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__newLaunches?.getState === "function" && (window.__city?.getState().layout.towers.length ?? 0) > 0, null, { timeout: 240_000 });
    await page.evaluate(() => window.__city.getState().enter());
    // The rings' first read, the beacon's flows and the Docks laid in.
    await page.waitForFunction(() => window.__newLaunches.getState().status === "live", null, { timeout: 120_000 });
    for (const name of [/^Later$/, /^Пізніше$/]) {
      const later = page.getByRole("button", { name });
      if (await later.first().isVisible().catch(() => false)) await later.first().click();
    }
    await page.evaluate(() => window.__lens.getState().pick("new"));
    await page.waitForFunction(() => window.__newLaunches.getState().lighthouse !== null, null, { timeout: 60_000 }).catch(() => {});
    // The lens's own frame (lensShot), put at once: a software GL draws too few frames for the camera's glide.
    await page.evaluate((portrait) => {
      const { layout } = window.__city.getState();
      const stages = window.__newLaunches.getState().stages;
      const set = layout.towers.filter((t) => t.tower.district === "docks" || stages.has(t.tower.id));
      const cx = set.reduce((a, t) => a + t.x, 0) / set.length;
      const cz = set.reduce((a, t) => a + t.z, 0) / set.length;
      const spread = Math.max(...set.map((t) => Math.hypot(t.x - cx, t.z - cz) + t.width));
      const top = Math.max(...set.map((t) => t.height));
      const len = Math.hypot(cx, cz) || 1;
      const [dx, dz] = [cx / len, cz / len];
      const distance = Math.min(260, Math.max(56, spread * 2.1 + top * 0.9) * (portrait ? 1.45 : 1));
      const lookY = Math.max(4, top * 0.45);
      const steep = 0.3 + 0.45 * Math.min(1, Math.max(0, (30 - top) / 20));
      window.__cityView?.([cx + dx * distance * 0.55, lookY + distance * steep, cz + dz * distance * 0.55], [cx * 0.7, lookY, cz * 0.7]);
    }, size.mobile);
    await page.waitForTimeout(SETTLE);
    const suffix = `${size.name}-${lang}`;
    await page.screenshot({ path: path.join(out, `new-rings-${suffix}.png`), timeout: 180_000 });
    const state = await page.evaluate(() => {
      const st = window.__newLaunches.getState();
      const docks = window.__city.getState().layout.towers.filter((t) => t.tower.district === "docks").length;
      return { rings: { fresh: st.rings.fresh.length, near: st.rings.near.length, graduated: st.rings.graduated.length }, lighthouse: st.lighthouse, docks, towers: window.__city.getState().layout.towers.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    // A DOM click: the software-rendered canvas leaves too few frames for Playwright's own checks of a tap.
    await page.evaluate(() => document.querySelector("[data-lens-list-toggle]").click());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, `new-list-${suffix}.png`), timeout: 180_000 });
    const panel = await page.locator("[data-city-new-list]").boundingBox();
    if (size.mobile) {
      await page.evaluate(() => document.querySelector('[data-city-new-list] [role="tab"][data-stage="near"]').click());
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, `new-list-near-${suffix}.png`), timeout: 180_000 });
    }
    await page.evaluate(() => document.querySelector("[data-city-new-list] [data-new-about]").click());
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `new-about-${suffix}.png`), timeout: 180_000 });
    const toggle = await page.locator("[data-lens-list-toggle]").boundingBox();
    report.push({ lang, size: size.name, ...state, panel, toggle, errors });
    await context.close();
  }
}
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
