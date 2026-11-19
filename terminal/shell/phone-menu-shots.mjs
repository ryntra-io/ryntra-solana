// The phone's menu for the eyes: the header with its menu button, the menu sheet open on a few screens, the
// sheet scrolled to its end, a group opened — at 390×844 and 360×780 — and the desk's rail at 1920×1080 to show it stays
// as it was; in English and Ukrainian → <out>/<tag>-*.jpg
//   node terminal/shell/phone-menu-shots.mjs <out> <baseUrl> <tag>
// The same script shoots the site before the change (the menu opened by the mark) and after it (the menu button). The
// system Chrome draws the page (PRESS_CHROME may point at another). No wallet is connected and nothing is signed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-302b");
const base = process.argv[3] ?? "http://localhost:3139";
const tag = process.argv[4] ?? "after";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZE = {
  390: { name: "390", width: 390, height: 844, mobile: true },
  360: { name: "360", width: 360, height: 780, mobile: true },
  1920: { name: "1920", width: 1920, height: 1080, mobile: false },
};
const SIZES = (process.env.SIZES ?? "390,360,1920").split(",").map((w) => SIZE[w]);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
// The Swap lights «Trade»: its group stands open with Futures and Predictions, each with where it opens.
const PAGES = (process.env.PAGES ?? "/,/earn,/bots/grid,/swap").split(",");
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const report = [];
const slug = (page) => (page === "/" ? "home" : page.replace(/^\//, "").replace(/[/?=&]/g, "-"));

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      userAgent: size.mobile ? PHONE : undefined,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
      // Hydrated: the menu's choice is read (menu-fold.ts) — a tap before it would find no handler.
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-menu-ready"), null, { timeout: 60_000 }).catch(() => {});
      // A development stand's own badge is not the product's: kept out of the frame.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    for (const at of size.mobile ? PAGES : PAGES.slice(0, 2)) {
      const name = (state) => path.join(out, `${tag}-${size.name}-${lang}-${slug(at)}-${state}.jpg`);
      const shot = async (state) => {
        await page.waitForTimeout(500);
        await page.screenshot({ path: name(state), quality: 84, type: "jpeg" });
      };
      const join = at.includes("?") ? "&" : "?";
      await page.goto(`${base}${at}${join}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector(size.mobile ? "[data-terminal='tabs']" : "[data-terminal='rail']", { timeout: 180_000 });
      await settle();
      await shot("closed");
      if (!size.mobile) continue;
      // The menu's button where there is one; before it, the mark.
      const button = (await page.locator("[data-terminal='menu-button']").count()) ? page.locator("[data-terminal='menu-button']") : page.locator("[data-terminal='mark']");
      const box = await button.boundingBox();
      report.push(`${size.name}/${lang}${at}: the control that opens the menu — ${box ? `${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` : "none"}, «${await button.getAttribute("aria-label")}»`);
      await button.tap();
      const sheet = page.locator("[role='dialog'][aria-modal='true']");
      // A development stand may reload the page under the tap (a new build of it): settle and tap once more.
      await sheet.waitFor({ timeout: 10_000 }).catch(async () => {
        await settle();
        await button.tap();
        await sheet.waitFor({ timeout: 20_000 });
      });
      await shot("menu");
      const sheetBox = await sheet.boundingBox();
      report.push(`${size.name}/${lang}${at}: the sheet — ${sheetBox ? `${Math.round(sheetBox.width)}×${Math.round(sheetBox.height)} from ${Math.round(sheetBox.y)}` : "none"}; lit: ${(await sheet.locator("[aria-current='page']").allInnerTexts()).join(", ") || "—"}`);
      if (at === "/") {
        const folded = sheet.locator("[aria-controls^='sheet-'][aria-expanded='false']");
        if ((await folded.count()) > 1) {
          await folded.nth(1).tap();
          await page.waitForTimeout(300);
          await shot("menu-group");
        }
        await sheet.evaluate((el) => {
          const scroller = el.querySelector("[data-terminal='sheet-scroll']") ?? el;
          scroller.scrollTo(0, scroller.scrollHeight);
        });
        await shot("menu-end");
      }
      // Back closes it and leaves the page where it was.
      const before = page.url();
      await page.goBack({ waitUntil: "commit", timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(600);
      report.push(`${size.name}/${lang}${at}: Back — the sheet ${(await sheet.count()) ? "still open" : "closed"}, the page ${page.url() === before ? "kept" : `left for ${page.url()}`}`);
    }
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
console.log(report.join("\n"));
