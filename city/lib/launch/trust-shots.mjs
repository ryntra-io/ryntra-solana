// A launch tower's flow for review (L3): the pills, the creator's strip and the method behind «i» in the tower's window
// (CITY-78), in English through the city's own link (`?lang=en`), on the development
// stand-in (`?launch=stub`), at 1440×860 and 390×844 → <out>/trust-<symbol>[-method]-<size>.png
//   node city/lib/launch/trust-shots.mjs [out] [baseUrl]      (npm run dev running; PRESS_CHROME may point at a Chromium)
// Made-up devnet-shaped answers only; nothing is sent anywhere.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/trust-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const errors = [];
for (const s of SIZES) {
  const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/?launch=stub&pace=0.2&quality=low&lang=en`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => window.__city?.getState().layout.towers.some((t) => t.tower.symbol === "NOVA"), null, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  for (const symbol of ["NOVA", "KITE", "MOTH", "OWL"]) {
    await page.evaluate((symbol) => {
      const st = window.__city.getState();
      st.select(st.layout.towers.find((t) => t.tower.symbol === symbol).tower.id);
    }, symbol);
    await page.getByRole("button", { name: "How these are counted" }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, `trust-${symbol.toLowerCase()}-${s.name}.png`), timeout: 180_000 });
    if (symbol === "NOVA") {
      // A DOM click: the software-rendered canvas leaves too few frames for Playwright's own checks of a tap.
      const tap = () => page.evaluate(() => document.querySelector('[aria-label="How these are counted"]').click());
      await tap();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `trust-nova-method-${s.name}.png`), timeout: 180_000 });
      await tap();
    }
  }
  await context.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`wrote ${out}`);
