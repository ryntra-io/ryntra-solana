// «Result» on the kit's stand, for the eyes: node terminal/portfolio/pnl/shots.mjs <out> <stand>
//   → <out>/stand-<size>-<lang>.jpg (the whole stand), <out>/<state>-<size>-<lang>.jpg (each state), <out>/how-…
//     (the «i» open), and <out>/report.txt: the page's sideways scroll, the amber actions, errors on the page.
// The stand: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` (`next dev` or `next build` + `next start`). Every figure on it is
// counted by `portfolioPnl` from the stand's wallets (`stand.ts`); nothing is read from a wallet or signed.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

const [out = "docs/shots/city-348", base = "http://localhost:3348"] = process.argv.slice(2);
const SIZES = [
  { name: "1920", width: 1920, height: 1080, mobile: false },
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];
const LANGS = ["en", "uk"];
const STATES = ["live", "older", "partial", "making", "none", "other", "empty-own", "empty-other", "reading", "failed"];

mkdirSync(out, { recursive: true });
const report = [];
/* A Chrome of the machine's own when the installed Playwright has none (`PRESS_CHROME`), as the other shelves' shots. */
const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
    await page.goto(`${base}/terminal/kit/pnl?lang=${lang}`, { waitUntil: "networkidle", timeout: 300_000 });
    await page.waitForSelector('[data-pnl-state="live"]', { timeout: 120_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
    await page.waitForTimeout(600);
    const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);
    await page.screenshot({ path: file("stand"), quality: 82, type: "jpeg", fullPage: true });
    for (const state of STATES) {
      const at = page.locator(`[data-pnl-state="${state}"]`);
      await at.scrollIntoViewIfNeeded();
      await at.screenshot({ path: file(state), quality: 86, type: "jpeg" });
    }
    /* The «i» of the live block, open. */
    const live = page.locator('[data-pnl-state="live"]');
    await live.locator("button[aria-expanded]").first().click();
    await page.waitForTimeout(200);
    await live.screenshot({ path: file("how"), quality: 86, type: "jpeg" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const amber = await page.evaluate(() => [...document.querySelectorAll('[data-pnl-state] button, [data-pnl-state] a')].filter((node) => getComputedStyle(node).backgroundImage.includes("gradient")).length);
    report.push(`${size.name}/${lang}: sideways scroll ${overflow}px; amber actions in the blocks ${amber}; page errors ${errors.length ? errors.join(" | ").slice(0, 400) : "none"}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
