// DLMM Pro among the pools of «Earn», for the eyes: the «Pool reward» card, the pool's row, its ticket and
// the range by bins → <out>/<state>-<size>-<lang>.jpg
//   node terminal/earn/pro-shots.mjs [out] [baseUrl]
// A stand built with the terminal's switches and DLMM Pro's open on devnet (`NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open`,
// `RYNTRA_EARN_PRO=devnet`), then `next start`. Every figure is the stand's own engine: the pools of the catalogue,
// DLMM Pro's piers and bins read from devnet's chain. A guest: no wallet, nothing is built or signed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-309");
const base = process.argv[3] ?? "http://localhost:3121";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const ALL = [
  { name: "xl", width: 2560, height: 1440, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const WORDS = { en: { card: "DLMM Pro", tune: "Adjust" }, uk: { card: "DLMM Pro", tune: "Налаштувати" } };
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const shot = async (state) => {
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
    };
    const w = WORDS[lang];
    await page.goto(`${base}/earn`, { waitUntil: "domcontentloaded" });
    const card = page.locator("button[aria-pressed]:visible").filter({ hasText: w.card }).first();
    const there = await card.waitFor({ timeout: 120_000 }).then(() => true, () => false);
    await page.waitForTimeout(2500);
    await shot("pools");
    if (!there) {
      report.push(`${size.name}/${lang}: no «${w.card}» card`);
      await context.close();
      continue;
    }
    report.push(`${size.name}/${lang} card: ${(await card.innerText()).replace(/\s+/g, " ")}`);
    // The card picks the pool and opens its ticket: on a desk beside the list, on a phone as its sheet.
    await card.click();
    await page.waitForTimeout(3500);
    const ticket = size.mobile ? page.locator("[data-earn='sheet']") : page.locator("aside section").first();
    await ticket.waitFor({ timeout: 30_000 }).catch(() => {});
    await shot("pro-ticket");
    const tune = ticket.locator("[data-earn-range='tune']").first();
    if (await tune.count()) {
      await tune.click();
      await page.locator("[data-earn-range='editor']").first().waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      if (!size.mobile) await shot("pro-bins");
      else {
        await page.locator("[data-earn-range='editor']").first().scrollIntoViewIfNeeded().catch(() => {});
        await shot("pro-bins");
      }
      report.push(`${size.name}/${lang} range: «${await ticket.locator("[data-earn-range='line']").first().innerText().catch(() => "")}» · income ${await ticket.locator("[data-earn-income]").count()}`);
    } else report.push(`${size.name}/${lang}: no «${w.tune}» on the ticket`);
    if (errors.length) report.push(`${size.name}/${lang} errors: ${errors.join(" | ").slice(0, 400)}`);
    await context.close();
  }
}
await browser.close();
console.log(report.join("\n"));
