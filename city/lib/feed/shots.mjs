// The live event feed's screens for review (CITY-66), at 1440×860 and 390×844 → <out>/feed-<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open npm run dev, then: node city/lib/feed/shots.mjs [out] [baseUrl]
// The figures on these screens are fixtures: the city's read is the bundled snapshot (26.10) served as a live read
// stamped now, with the docks' pools dated in the last hour; the launches are the development stand-in (`?launch=stub`);
// the Harbor's pools are its recorded Meteora catalogue (16.10). The live pass on real reads is the stand's.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG } from "../districts/harbor/test-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-66");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const ALL = [
  { name: "desk", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

/** The snapshot as a live read made now; the docks' pools opened in the last hour. */
function liveRead(now) {
  let k = 0;
  const towers = SNAPSHOT.towers.map((t) => (t.district === "docks" ? { ...t, launchedAt: new Date(now - (8 + 7 * k++) * 60_000).toISOString() } : t));
  return { towers, fetchedAt: new Date(now).toISOString(), source: "live" };
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const failures = [];

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU|404/.test(m.text()) && errors.push(m.text()));
  const shot = async (state) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `feed-${state}-${size.name}.jpg`), type: "jpeg", quality: 80 });
  };

  // The first-visit hint is already learned, so it does not stand over the feed.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ryntra.city.firstHint", "1");
    } catch {}
  });
  await page.route(/\/api\/city(\?.*)?$/, (route) => route.fulfill({ json: liveRead(Date.now()) }));
  await page.route(/\/api\/city\/harbor$/, (route) => route.fulfill({ json: { pools: harborPools(CATALOG), at: new Date().toISOString() } }));

  await page.goto(`${base}/?launch=stub&quality=low`, { waitUntil: "domcontentloaded" });
  const feed = page.locator("[data-city-feed]");
  await feed.waitFor({ timeout: 120_000 });
  // The first read and the stand-in's launches fill the feed.
  await page.waitForFunction(() => document.querySelectorAll("[data-city-feed] li").length >= 4, null, { timeout: 120_000 });
  // The city's opening moments pass first.
  await page.waitForTimeout(9_000);

  if (size.mobile) await shot("strip");
  else await shot("column");

  // A second read a minute later: a coin rises, and its event arrives on top with its glow.
  await page.evaluate(() => {
    const city = window.__city.getState();
    const snap = city.snapshot;
    const pick = snap.towers.find((t) => t.verified && t.district === "strip" && t.liquidity > 1e6) ?? snap.towers[0];
    const towers = snap.towers.map((t) => (t.id === pick.id ? { ...t, change1h: 14.6, price: t.price * 1.05 } : t));
    city.setSnapshot({ ...snap, towers, fetchedAt: new Date().toISOString() });
  });

  if (size.mobile) {
    await page.locator("[data-city-feed] button[aria-label='All events']").click();
    await page.waitForTimeout(400);
    await shot("list");
  } else {
    await page.waitForTimeout(500);
    await shot("arrival");
  }

  // The «i»: each event's source and clock time.
  await page.locator("[data-city-feed] button[aria-label='Sources and times']").click();
  await shot("sources");
  await page.locator("[data-city-feed] button[aria-label='Sources and times']").click();

  // The gear: «Show on home».
  await page.locator("[data-city-feed] button[aria-label='Show on home']").click();
  await shot("settings");

  // A moment with the flashing on: the banner shows — the read's biggest 24-hour riser, with its own figure.
  const play = () =>
    page.evaluate(() => {
      const city = window.__city.getState();
      const t = city.layout.towers
        .map((p) => p.tower)
        .filter((x) => x.verified && x.district !== "docks")
        .sort((a, b) => b.change24h - a.change24h)[0];
      city.play({ kind: "pump", towerId: t.id, symbol: t.symbol, value: `+${t.change24h.toFixed(1)}% · 24H`, title: "PUMP" });
    });
  // On a phone the open list owns the frame (no banner over it): the moments are checked with the strip folded.
  const fold = async (open) => {
    if (!size.mobile) return;
    await page.locator(`[data-city-feed] button[aria-label='${open ? "All events" : "Fewer events"}']`).click();
    await page.waitForTimeout(300);
  };
  await fold(false);
  await play();
  await page.waitForTimeout(900);
  const bannerOn = await page.locator("[class*='cutinSlab']").count();
  await page.screenshot({ path: path.join(out, `feed-banner-on-${size.name}.jpg`), type: "jpeg", quality: 80 });
  await page.waitForTimeout(2000);

  // Flashing off: the same moment, no banner, the live dot still.
  await fold(true);
  await page.locator("[data-city-feed] button[role='switch']").last().click();
  if (size.mobile) await shot("flash-switch");
  await fold(false);
  await play();
  await page.waitForTimeout(900);
  const bannerOff = await page.locator("[class*='cutinSlab']").count();
  const mark = await page.evaluate(() => document.documentElement.dataset.cityFlash);
  const kept = await page.evaluate(() => localStorage.getItem("ryntra.city.feed"));
  await page.screenshot({ path: path.join(out, `feed-flash-off-${size.name}.jpg`), type: "jpeg", quality: 80 });
  if (bannerOn !== 1) failures.push(`${size.name}: the banner did not show with the flashing on (${bannerOn})`);
  if (bannerOff !== 0) failures.push(`${size.name}: the banner showed with the flashing off (${bannerOff})`);
  if (mark !== "off") failures.push(`${size.name}: html[data-city-flash] is ${mark}`);
  if (kept !== JSON.stringify({ flashing: false })) failures.push(`${size.name}: the choice was kept as ${kept}`);

  // Kept on the device: a reload keeps the flashing off.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.cityFlash !== undefined, null, { timeout: 120_000 });
  const after = await page.evaluate(() => document.documentElement.dataset.cityFlash);
  if (after !== "off") failures.push(`${size.name}: after a reload html[data-city-flash] is ${after}`);
  await page.waitForFunction(() => document.querySelectorAll("[data-city-feed] li").length >= 1, null, { timeout: 120_000 });

  // A tap on a mover's event: the camera flies to its tower and its card opens.
  if (size.mobile) await page.locator("[data-city-feed] button[aria-label='All events']").click();
  const target = page.locator("[data-city-feed] li button[aria-label*='Fly to it']").first();
  await target.click();
  await page.waitForTimeout(2200);
  const selected = await page.evaluate(() => window.__city.getState().selectedId);
  if (!selected) failures.push(`${size.name}: a tap on an event picked no tower`);
  await shot("tap");

  if (errors.length) failures.push(`${size.name}: ${errors.join(" | ")}`);
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`shots in ${out}`);
