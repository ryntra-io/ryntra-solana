// A stock from the private balance and a pool's fees back into it, on the stand's page for the eyes: desk
// 1440×900 and phone 390×844, English and Ukrainian, and once with the «i» of the band's line opened → <out>/*.jpg
//   node terminal/stocks/private/shots.mjs [out] [baseUrl]
// The stand runs with both switches: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`. It reads and
// signs nothing; no wallet.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-372");
const base = process.argv[3] ?? "http://localhost:3372";
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
    await page.goto(`${base}/terminal/kit/private-stock?lang=${lang}`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForSelector("[data-private-stock-stand] [data-private-band]", { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, `private-stock-${size.name}-${lang}.jpg`), quality: 86, fullPage: true });
    // The ticket's part (the action panel, last on the page) with the «i» of the band's line open: why the stock lands in
    // the wallet.
    const ticket = page.locator("[data-private-stock-stand] [data-private-stock='private']").last();
    await ticket.scrollIntoViewIfNeeded();
    await ticket.locator("[data-private-band] ~ div button[aria-expanded]").first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `private-stock-${size.name}-${lang}-why.jpg`), quality: 86, fullPage: false });
    console.log(`${size.name}-${lang}: ${await page.locator("[data-private-band]").count()} bands`);
    await context.close();
  }
}
await browser.close();
