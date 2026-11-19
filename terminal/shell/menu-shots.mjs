// The menu by groups for the eyes: the rail open, a group folded, the rail on its icons with a group's items
// beside it, the whole menu at its full height, and the phone's sheet — at 1440×900, 1920×1080 and 390×844, in English
// and Ukrainian → <out>/<tag>-*.jpg
//   node terminal/shell/menu-shots.mjs <out> <baseUrl> <tag>
// The system Chrome draws the page (PRESS_CHROME may point at another). No wallet is connected and nothing is signed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-302");
const base = process.argv[3] ?? "http://localhost:3102";
const tag = process.argv[4] ?? "after";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = (process.env.SIZES ?? "1440,1920,390").split(",").map((w) => (w === "390" ? { name: "phone", width: 390, height: 844, mobile: true } : { name: `desk${w}`, width: Number(w), height: w === "1920" ? 1080 : 900, mobile: false }));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const PAGE = process.env.PAGE ?? "/";
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const name = (state) => path.join(out, `${tag}-${state}-${size.name}-${lang}.jpg`);
    const shot = async (state, opts = {}) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: name(state), quality: 86, type: "jpeg", ...opts });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const join = PAGE.includes("?") ? "&" : "?";
    await page.goto(`${base}${PAGE}${join}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector(size.mobile ? "[data-terminal='tabs']" : "[data-terminal='rail']", { timeout: 180_000 });
    await settle();
    await shot("open");

    if (size.mobile) {
      await tap(page.locator("[data-terminal='menu-button']"));
      await page.waitForSelector("[role='dialog'][aria-modal='true']", { timeout: 10_000 });
      await shot("sheet");
      const sheetGroups = page.locator("[role='dialog'][aria-modal='true'] [aria-controls^='sheet-'][aria-expanded='false']");
      if ((await sheetGroups.count()) > 0) {
        await sheetGroups.first().tap();
        await page.waitForTimeout(300);
        await shot("sheet-two-groups");
      }
      await page.locator("[data-terminal='sheet-scroll']").evaluate((list) => list.scrollTo(0, list.scrollHeight));
      await shot("sheet-end");
    } else {
      const rail = page.locator("[data-terminal='rail']");
      const groups = rail.locator("[aria-controls^='menu-']");
      if ((await groups.count()) > 0) {
        const fits = await page.locator("[data-terminal='menu']").evaluate((menu) => menu.scrollHeight <= menu.clientHeight + 1);
        report.push(`${size.name}/${lang}: the menu fits without a scroll — ${fits}; open groups — ${await rail.locator("[aria-controls^='menu-'][aria-expanded='true']").count()}`);
        // A second group opened with a press; the first stays open, and the choice outlives a reload.
        const folded = rail.locator("[aria-controls^='menu-'][aria-expanded='false']");
        const second = (await folded.count()) > 2 ? folded.nth(2) : folded.first();
        const id = await second.getAttribute("aria-controls");
        await second.click();
        await page.mouse.move(size.width / 2, size.height / 2);
        await shot("two-groups");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-terminal='rail']");
        await settle();
        report.push(`${size.name}/${lang}: an opened group stays open after a reload — ${(await rail.locator(`[aria-controls='${id}']`).getAttribute("aria-expanded")) === "true"}`);
        await rail.locator(`[aria-controls='${id}']`).click();
      }
      // The rail hidden to the side with the arrow at its edge, and a group's items beside it.
      await page.locator("[data-terminal='rail-fold']").click();
      await page.mouse.move(size.width / 2, size.height / 2);
      await shot("rail-folded");
      if ((await groups.count()) > 0) {
        await groups.nth(2).click();
        await page.waitForTimeout(400);
        await shot("rail-folded-group");
        await page.keyboard.press("Escape");
      }
      await page.locator("[data-terminal='rail-fold']").click();
    }
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
console.log(report.join("\n"));
