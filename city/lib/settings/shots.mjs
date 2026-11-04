// The settings window and the notification centre for review (CITY-87) → <out>/settings-<state>-<size>.jpg.
//   npm run dev, then
//   node city/lib/settings/shots.mjs [out=docs/shots/city-87] [baseUrl=http://localhost:3000]
// With the switches as on production — NEXT_PUBLIC_RYNTRA_CITY_SPOT=open, NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE=exit — and
// NEXT_PUBLIC_RYNTRA_CITY_BEACONS=device, the table lists stops, beacons and the liquidation risk.
// It opens `/?open=settings` on a desk (1440) and a phone (390), walks the sections by their own buttons, and stands
// two banners through the development hook `window.__cityNotify` (a lit beacon, the liquidation risk). No wallet is
// connected: the honest no-wallet states. It signs nothing and asks the engine for nothing but what the city reads.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-87");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${size.name}: ${e}`));
  await page.addInitScript(() => localStorage.setItem("ryntra.city.firstHint", "1"));
  await page.goto(`${base}/?open=settings`, { waitUntil: "load", timeout: 240_000 });
  await page.locator("canvas").first().waitFor({ state: "attached", timeout: 240_000 });
  await page.locator("[data-city-settings]").waitFor({ timeout: 120_000 });
  // The skyline behind the glass: a software GPU draws its first frames slowly.
  await page.waitForTimeout(size.mobile ? 4_000 : 8_000);
  const shot = (state) => page.screenshot({ path: path.join(out, `settings-${state}-${size.name}.jpg`), type: "jpeg", quality: 86, timeout: 180_000, animations: "disabled" });

  await shot("notifications");
  // The liquidation risk's row: open the cap under «Stops» to show the «how often» choice.
  const stops = page.locator("[data-city-settings] button", { hasText: /^(Stops|Стопи)$/ }).first();
  if (await stops.count()) {
    await stops.click();
    await page.waitForTimeout(300);
  }
  await page.locator("[data-city-settings] [data-settings-table]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("notifications-table");
  // Guard's row: the liquidation risk, with a lock where «off» is (where the Exchange stands: exit or open).
  const guard = page.locator("[data-settings-table] [data-locked]");
  if (await guard.count()) {
    await guard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot("notifications-guard");
  }

  for (const section of ["trading", "display", "wallet", "security"]) {
    const index = ["wallet", "trading", "notifications", "layouts", "language", "sound", "display", "security"].indexOf(section);
    await page.locator("[data-city-settings] nav button").nth(index).click();
    await page.mouse.move(2, size.height - 2);
    await page.waitForTimeout(1_500);
    await shot(section);
  }

  // Two banners where the person put them (top right by default): a lit beacon, and the liquidation risk, which stays.
  await page.evaluate(() => {
    const say = window.__cityNotify;
    say?.({ kind: "beacons", title: "Beacon lit · BONK", tower: null });
    say?.({ kind: "liquidation", title: "Liquidation risk", line: "Phoenix may start cancelling this account’s resting orders to free margin." });
  });
  await page.locator("[data-city-banners] [role='alert']").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await shot("banners");
  await context.close();
}

await browser.close();
if (errors.length) console.log(errors.join("\n"));
console.log(`shots → ${out}`);
