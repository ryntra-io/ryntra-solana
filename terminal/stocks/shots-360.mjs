// The one line before a position's signature in a stock's DLMM Pro pool (ANT · SOL), on the stand's page for
// the eyes, at 1440×900 and 390×844, in English and Ukrainian, with the exchange open and closed, and once with «i»
// opened → <out>/*.jpg
//   node terminal/stocks/shots-360.mjs [out] [baseUrl]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand`. Reads only, no wallet.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-360");
const base = process.argv[3] ?? "http://localhost:3360";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    await page.goto(`${base}/terminal/kit/stock-facts?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForSelector("[data-stock-line]", { timeout: 300_000 });
    await page.waitForTimeout(800);
    const lines = page.locator("[data-stock-line]");
    console.log(`${size.name}-${lang}: ${await lines.count()} lines · ${(await lines.allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()).join(" | ")}`);
    /* The two panels of the line, the exchange open then closed, side by side as the stand lays them. */
    const first = lines.first();
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `line-${size.name}-${lang}.jpg`), quality: 88, fullPage: false });
    /* «i» of the closed exchange's line: the issuer, the hours, where it is not offered, the terms. */
    const closed = lines.nth(1);
    await closed.locator("button[aria-expanded]").click();
    await page.waitForTimeout(400);
    await closed.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `line-${size.name}-${lang}-why.jpg`), quality: 88, fullPage: false });
    await context.close();
  }
}
await browser.close();
