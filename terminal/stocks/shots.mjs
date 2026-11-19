// A stock's facts on the stand's page for the eyes, at 2560×1440, 1920×1080 and 390×844, in English and
// Ukrainian, and once with the issuer's terms opened behind «i» → <out>/*.jpg
//   node terminal/stocks/shots.mjs [out] [baseUrl]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand`. The page shows the exchange open, the exchange
// closed with a dividend guard ahead, a coin that is no stock (nothing), the detail above a ticket's action with the
// risk line, and one live read of TSLAx through `GET /api/v1/stocks/pool-facts`. Reads only, no wallet.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-328");
const base = process.argv[3] ?? "http://localhost:3328";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "2560", width: 2560, height: 1440, mobile: false },
  { name: "1920", width: 1920, height: 1080, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    await page.goto(`${base}/terminal/kit/stock-facts?lang=${lang}`, { waitUntil: "networkidle", timeout: 180_000 });
    // The live read is the fourth detail on the page; it comes once the door answers.
    await page.waitForFunction(() => document.querySelectorAll("section[data-session]").length >= 4, null, { timeout: 120_000 }).catch(() => console.log(`${size.name}-${lang}: the live read did not come`));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `facts-${size.name}-${lang}.jpg`), quality: 88, fullPage: true });
    if (lang === "uk" && size.name !== "2560") {
      await page.locator("section[data-session='closed'] button[aria-expanded]").first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `facts-${size.name}-${lang}-terms.jpg`), quality: 88, fullPage: false });
    }
    console.log(`${size.name}-${lang}: ${await page.locator("section[data-session]").count()} details`);
    await context.close();
  }
}
await browser.close();
