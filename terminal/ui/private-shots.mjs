// The private kit on its stand's page for the eyes, at 1920×1080 and 390×844, in English and Ukrainian;
// then the counter behind the band's «i» opened, and the toggle turned in the page's head → <out>/*.jpg
//   node terminal/ui/private-shots.mjs [out] [baseUrl]
// A stand runs with both switches on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`. Reads
// only, no wallet: nothing on the page signs or sends.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-339");
const base = process.argv[3] ?? "http://localhost:3339";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});

const SIZES = [
  { name: "1920", width: 1920, height: 1080, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];

for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    await page.goto(`${base}/terminal/kit/private?lang=${lang}`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForSelector("[data-private-stand]", { timeout: 120_000 });
    // The live counter answers, or says it could not read (a stand without the server's key).
    await page.waitForFunction(() => document.querySelector("[data-count='live'] [data-private-count]")?.getAttribute("data-private-count") !== "reading", null, { timeout: 60_000 }).catch(() => console.log(`${size.name}-${lang}: the live counter did not answer`));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `kit-${size.name}-${lang}.jpg`), quality: 88, fullPage: true });
    // The band's «i»: the ring's counter, as a person opens it before a signature.
    await page.locator("aside [data-private-band] button[aria-label]").last().click();
    await page.waitForTimeout(500);
    await page.locator("aside [data-private-band]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `band-info-${size.name}-${lang}.jpg`), quality: 88, fullPage: false });
    await page.keyboard.press("Escape");
    // The toggle in the page's head, turned: private from now on.
    await page.locator("[data-page-head] [role=switch]").click();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `head-${size.name}-${lang}.jpg`), quality: 88, clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 360) } });
    console.log(`${size.name}-${lang}: ${await page.locator("[data-private-band]").count()} bands, head ${await page.locator("[data-page-head] [role=switch]").getAttribute("aria-checked")}`);
    await context.close();
  }
}
await browser.close();
