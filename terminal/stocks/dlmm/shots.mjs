// The ticket of a stock's DLMM pool, two coins in, on the stand's page for the eyes, at 1440×900 and
// 390×844, in English and Ukrainian: the form before a wallet, the Review before the signature (and its «i» open), the
// issuer's pause, an add that landed → <out>/*.jpg
//   node terminal/stocks/dlmm/shots.mjs [out] [baseUrl]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand`. No wallet signs; nothing is sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-360-dlmm");
const base = process.argv[3] ?? "http://localhost:3360";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const STATES = ["form", "review", "paused", "done"];

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    for (const state of STATES) {
      await page.goto(`${base}/terminal/kit/dlmm-stock?state=${state}&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForSelector(state === "done" ? "[data-page-side] [role=status]" : "[data-dlmm-stock]", { timeout: 60_000 });
      await page.waitForTimeout(2500);
      const side = page.locator("[data-page-side]");
      if (await side.count()) await side.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, fullPage: size.mobile });
      if (state === "review") {
        /* «i» of the pool's details: what goes in of each coin, the deposit that comes back, the network. */
        const details = page.locator("[data-dlmm-stock] ~ * button[aria-expanded]").first();
        if (await details.count()) {
          await details.click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(out, `review-why-${size.name}-${lang}.jpg`), quality: 86, fullPage: size.mobile });
        }
      }
      const text = (await (await side.count() ? side.first() : page.locator("main")).innerText()).replace(/\s+/g, " ").trim();
      console.log(`${size.name}-${lang}-${state}: ${text.slice(0, 400)}`);
    }
    await context.close();
  }
}
await browser.close();
