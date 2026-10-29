// The home's screens for review, at 1440×900, 1280×720 and 390×844 → <out>/<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_ORACLE=open npm run dev -- -p 3137, then: node city/lib/city/home-shots.mjs [out] [baseUrl]
// The figures on these screens are fixtures: the city's read is the bundled snapshot served as a live read stamped now;
// the Predictions window's markets are its recorded fixture (districts/predict/test-fixtures.mjs). No wallet, no keys.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { discoverBody, eventBody } from "../districts/predict/test-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-home-2810");
const base = process.argv[3] ?? "http://localhost:3137";
const prefix = process.env.PREFIX ?? "";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "1280", width: 1280, height: 720, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const STATES = process.env.STATES ? new Set(process.env.STATES.split(",")) : null;
const want = (state) => !STATES || STATES.has(state);

const liveRead = (now) => ({ towers: SNAPSHOT.towers, fetchedAt: new Date(now).toISOString(), source: "live" });

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = async (state) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${prefix}${state}-${size.name}.jpg`), type: "jpeg", quality: 78 });
    report.push({ size: size.name, state, overlaps: await overlaps() });
  };
  /** What stands over what: every pair of the HUD's pieces and the open windows whose boxes cross. */
  const overlaps = () =>
    page.evaluate(() => {
      const visible = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05 && r.width > 4 && r.height > 4;
      };
      const pick = (sel, name) => [...document.querySelectorAll(sel)].filter(visible).map((el) => ({ name, el, r: el.getBoundingClientRect() }));
      // A CSS module's class by its own name: `<file>_<local>__<hash>` in development.
      const mod = (file, local, name) =>
        [...document.querySelectorAll(`[class*='${file}_${local}__']`)]
          .filter((el) => [...el.classList].some((c) => c.startsWith(`${file}_${local}__`)))
          .filter(visible)
          .map((el) => ({ name, el, r: el.getBoundingClientRect() }));
      const boxes = [
        ...pick("[data-city-feed] > *", "feed"),
        ...mod("hud", "cutinSlab", "banner"),
        ...pick("[data-city-hint]", "hint"),
        ...mod("hud", "slot", "homeCard"),
        ...mod("hud", "card", "towerCard"),
        ...pick("[role='dialog'], [aria-modal='true']", "window"),
        ...pick("[data-city-settings]", "settings"),
      ];
      const hits = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          // The same piece, or one inside the other, is not a pile-up.
          if (a.name === b.name || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (x > 2 && y > 2) hits.push(`${a.name}×${b.name}`);
        }
      return [...new Set(hits)];
    });
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, liveRead(Date.now())));
  await context.route("**/api/predictions/discover?*", (route) => json(route, discoverBody(Date.now())));
  await context.route("**/api/predictions/events/*", (route) => json(route, eventBody(route.request().url().split("/").pop())));

  await page.goto(`${base}/?quality=low`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.locator("[data-city-feed]").waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-city-feed] li").length >= 3, null, { timeout: 180_000 });
  // The opening moments pass and the first-visit hint shows.
  await page.waitForTimeout(9_000);
  if (want("home")) await shot("home");

  // The first-visit hint learned, so the windows below are seen as a returning visitor sees them.
  const hint = page.locator("[data-city-hint] button");
  if (await hint.count()) await hint.click();

  const play = () =>
    page.evaluate(() => {
      const city = window.__city.getState();
      const t = city.layout.towers.map((p) => p.tower).filter((x) => !x.verified)[0] ?? city.layout.towers[0].tower;
      city.play({ kind: "launch", towerId: t.id, symbol: null, value: "Unverified", title: "New tower" });
    });

  if (want("predict")) {
    await page.locator("nav button[aria-label='Predict']").click();
    await page.waitForTimeout(1500);
    await play();
    await shot("predict");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  if (want("tower") || want("trade")) {
    await page.evaluate(() => {
      const city = window.__city.getState();
      const t = city.layout.towers.map((p) => p.tower).filter((x) => x.verified).sort((a, b) => b.liquidity - a.liquidity)[2];
      city.select(t.id);
    });
    await page.waitForTimeout(1500);
    if (want("tower")) await shot("tower");
    if (want("trade")) {
      await page.locator("button", { hasText: /^(Buy|Trade) / }).first().click();
      await page.waitForTimeout(1200);
      await play();
      await shot("trade");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => window.__city.getState().select(null));
    await page.waitForTimeout(600);
  }

  if (want("money")) {
    // The window's code loads the first time it opens. A development server's hot update can leave the page with a
    // second copy of the window's store, so a window that does not stand is asked again on a fresh load.
    for (let attempt = 0; ; attempt++) {
      await page.waitForFunction(() => typeof window.__openMoney === "function", null, { timeout: 180_000 });
      await page.evaluate(() => window.__openMoney("portfolio"));
      const shown = await page.locator("[role='dialog'][aria-label='Money']").waitFor({ timeout: 90_000 }).then(() => true, () => false);
      if (shown) break;
      if (attempt === 3) throw new Error(`${size.name}: the Money window never opened`);
      await page.goto(`${base}/?quality=low`, { waitUntil: "domcontentloaded", timeout: 300_000 }).catch(() => {});
      await page.locator("[data-city-feed]").waitFor({ timeout: 180_000 });
      await page.waitForTimeout(6_000);
    }
    await page.waitForTimeout(1500);
    await play();
    await shot("money");
    await page.evaluate(() => window.__money.getState().close());
    await page.waitForTimeout(400);
  }

  if (want("settings")) {
    await page.locator("[data-city-top] button[aria-label='Menu']").click();
    await page.waitForTimeout(400);
    if (want("menu")) await shot("menu");
    const row = page.locator("#city-menu button", { hasText: "Settings" });
    if (await row.count()) {
      await row.click();
    } else {
      // Before the fix: the feed's own gear.
      await page.keyboard.press("Escape");
      if (size.mobile) await page.locator("[data-city-feed] button[aria-label='All events']").click();
      await page.locator("[data-city-feed] button[aria-label='Show on home']").click();
    }
    await shot("settings");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  if (want("arrivals")) {
    const later = page.locator("button[aria-label='Later'], button[aria-label='Close the Arrivals card']");
    const had = await later.count();
    if (had) await shot("arrivals");
    if (had) await later.first().click();
    // A reload: the same browser, a fresh page (the kept choices stay on the device).
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/?quality=low`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.locator("[data-city-feed]").waitFor({ timeout: 180_000 });
    await page.waitForTimeout(9_000);
    await shot("arrivals-reload");
  }

  if (errors.length) report.push({ size: size.name, errors });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
