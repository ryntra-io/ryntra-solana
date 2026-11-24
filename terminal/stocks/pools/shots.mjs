// A stock's pools for the eyes, on the recorded reads: the stand's page at 1920×1080, 1440×900 and 390×844,
// in English and Ukrainian; at 1440 once more with «All pools» opened and with «i» opened → <out>/*.jpg
//   node terminal/stocks/pools/shots.mjs [out] [baseUrl]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` (and, to see the deposit offered,
// `NEXT_PUBLIC_RYNTRA_EARN_DLMM_STOCKS=open` and `NEXT_PUBLIC_RYNTRA_EARN_PRO_STOCKS=open` — the stand offers it anyway).
// The page reads nothing: ANT and TSLAx stand on `lib/stocks/pools-shelf.fixture.json`. Reads only, no wallet.
// `PRESS_CHROME` names a Chrome to drive; without it, the Chromium Playwright brings.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-366");
const base = process.argv[3] ?? "http://localhost:3366";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});

const SIZES = [
  { name: "1920", width: 1920, height: 1080, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    // A stand has no network: the logo routes have nothing to give. They answer «none» once the page is alive, so the
    // kit's logo hears it and the letter disc stands, as on a coin without a logo.
    await page.route(/\/api\/(icon\/|spot\/icon)/, (route) => new Promise((done) => setTimeout(done, 2_500)).then(() => route.fulfill({ status: 404, body: "" })));
    await page.goto(`${base}/terminal/kit/stock-pools?lang=${lang}`, { waitUntil: "load", timeout: 300_000 });
    await page.waitForSelector("section[data-stock-pools]", { timeout: 120_000 });
    await page.waitForTimeout(4_000);
    await page.screenshot({ path: path.join(out, `stand-${size.name}-${lang}.jpg`), quality: 86, fullPage: true });
    const shelves = await page.locator("section[data-stock-pools]").count();
    const rows = await page.locator("section[data-stock-pools] li").count();
    if (size.name === "1440" || size.name === "390") {
      const ant = page.locator("[data-case='ant-open'] section[data-stock-pools]");
      await ant.locator("button[aria-expanded='false']").last().click();
      await page.waitForTimeout(3_000);
      await ant.screenshot({ path: path.join(out, `all-${size.name}-${lang}.jpg`), quality: 86 });
      await ant.locator("button[aria-expanded]").first().click();
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: path.join(out, `why-${size.name}-${lang}.jpg`), quality: 86, fullPage: false });
    }
    console.log(`${size.name}-${lang}: ${shelves} shelves, ${rows} rows`);
    await context.close();
  }
}
await browser.close();
