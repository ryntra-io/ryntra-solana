// The reward for a pool's liquidity on the Launch screen for the eyes: the form with the reward on — its one
// line before the signature — and its «i» open, at 1440×900 and 390×844, in English and Ukrainian
// → <out>/reward-{line,info}-{desk,phone}-{en,uk}.jpg and <out>/report.json
//   node terminal/launch/pro-rewards/shots.mjs <out> [baseUrl]
// A stand with the terminal's switch, Launch's own and the reward's open:
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_LAUNCH=open NEXT_PUBLIC_RYNTRA_CITY_POOL_LAUNCH=open
//   NEXT_PUBLIC_RYNTRA_POOL_LAUNCH_REWARDS=open RYNTRA_POOL_LAUNCH_REWARDS=open RYNTRA_LAUNCH_STAND=devnet next dev
// No wallet is connected and nothing is built, signed or sent: the line is the screen's own before the signature.
// PRESS_CHROME may name the browser; the Chromium of Playwright otherwise.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "reward-shots");
const base = process.argv[3] ?? "http://localhost:3257";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("A stand at localhost only.");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = { states: [], lines: {}, errors: [] };

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(`${size.name}-${lang}: ${error}`));
    const visible = (selector) => page.locator(selector).filter({ visible: true }).first();
    await page.goto(`${base}/launch`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await visible("[data-launch-screen]").waitFor({ timeout: 120_000 });
    await page.locator("[data-launch-ready]").first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await visible("[data-launch-name]").fill("Kite");
    await visible("[data-launch-symbol]").fill("KITE").catch(() => {});
    await visible("[data-launch-ready=pool]").click();
    await visible("[data-launch-opening] [role=radio]:nth-child(2)").click();
    await visible("[data-launch-reward] [role=switch]").click();
    await visible("[data-reward-line]").waitFor({ timeout: 10_000 });
    report.lines[`${size.name}-${lang}`] = await visible("[data-reward-line]").innerText();
    const shot = async (state) => {
      await page.waitForTimeout(500);
      const file = path.join(out, `${state}-${size.name}-${lang}.jpg`);
      await page.screenshot({ path: file, quality: 88, type: "jpeg" });
      report.states.push({ state, size: size.name, lang, file: path.basename(file) });
    };
    /* The reward's block in the middle of the window: its switch, its choices and its line. */
    const centre = async (selector) => {
      await page.evaluate((sel) => {
        const node = [...document.querySelectorAll(sel)].find((each) => each.offsetParent !== null);
        node?.scrollIntoView({ block: "center" });
      }, selector);
      await page.waitForTimeout(400);
    };
    await centre("[data-launch-reward]");
    await shot("reward-line");
    await visible("[data-launch-reward] button[aria-expanded]").click();
    await page.waitForTimeout(400);
    await centre("[data-launch-reward]");
    await shot("reward-info");
    await context.close();
  }
}
writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
