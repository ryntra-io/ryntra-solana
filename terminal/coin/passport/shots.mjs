// The coin's passport on the stand's page for the eyes, at 1920×1080, 1440×900 and 390×844, in English and
// Ukrainian, and once with every fact opened behind «i» → <out>/*.jpg
//   node terminal/coin/passport/shots.mjs [out] [baseUrl]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand`. The page shows an old coin, a fresh coin on its
// curve, a coin without its creator, a coin with a risk, and one live read of JUP through the public reads. Reads only,
// no wallet. `PRESS_CHROME` names a browser of its own; without it Playwright's own is used.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-347");
const base = process.argv[3] ?? "http://localhost:3347";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});

const SIZES = [
  { name: "1920", width: 1920, height: 1080, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    // The frame keeps reading (the market, the live coin): the page is taken once the four coins' lines stand.
    await page.goto(`${base}/terminal/kit/passport?lang=${lang}`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForFunction(() => document.querySelectorAll("[role='group']").length >= 4, null, { timeout: 120_000 });
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: path.join(out, `passport-${size.name}-${lang}.jpg`), quality: 88, fullPage: true });
    // The list behind «i» of the coin with a risk (the fourth coin).
    const info = page.locator("[role='group'] button[aria-expanded]").nth(3);
    if (await info.count()) {
      await info.scrollIntoViewIfNeeded();
      await info.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `passport-${size.name}-${lang}-facts.jpg`), quality: 88, fullPage: false });
    }
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${size.name}-${lang}: ${await page.locator("[role='group']").count()} lines${wide ? " — the page scrolls sideways" : ""}`);
    await context.close();
  }
}
await browser.close();
