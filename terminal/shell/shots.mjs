// The terminal's frame and kit for the eyes, at 1440×900 and 390×844, in English and Ukrainian → <out>/*.jpg
//   node terminal/shell/shots.mjs [out] [baseUrl]
// A stand runs with the switch on its kit: NEXT_PUBLIC_RYNTRA_TERMINAL=stand npm run dev. The system Chrome draws the
// page (PRESS_CHROME may point at another). Only the market's read and the coins' logos reach the stand; every other
// read answers 503 at once, so no slow route holds the browser's connections. No wallet is connected and nothing is
// signed: the shots stop where a person would decide.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-terminal-shell");
const base = process.argv[3] ?? "http://localhost:3251";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const SAY = { en: "buy JUP for 50", uk: "купити JUP на 50" };
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
    await context.route("**/api/**", (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/city" || pathname.startsWith("/api/icon/")) return route.continue();
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const shot = async (state) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());

    await page.goto(`${base}/terminal/kit/market?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector(size.mobile ? "[data-terminal='tabs'] a[aria-current='page']" : "[role='table']", { timeout: 180_000 });
    // The live read replaces the bundled market once; the shot waits for it, or for the bundled one if the read is slow.
    await page.waitForResponse((res) => res.url().includes("/api/city"), { timeout: 20_000 }).catch(() => {});
    await settle();
    await shot("kit-market");

    // A client-side move between shelves keeps the page; the browser's Back walks back the same way.
    await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
    const swap = page.locator(size.mobile ? "[data-terminal='tabs'] a[href$='/terminal/kit/swap']" : "[data-terminal='rail'] a[href$='/terminal/kit/swap']");
    await tap(swap);
    await page.waitForURL(/\/terminal\/kit\/swap/);
    await page.goBack();
    await page.waitForURL(/\/terminal\/kit\/market/);
    report.push(`${size.name}/${lang}: move and Back without a reload — ${await page.evaluate(() => window.__sameDocument === true)}`);
    if (!size.mobile) await page.mouse.move(size.width / 2, size.height - 4);

    // The agent's line: the rows for a sentence, then the shelf it opens with the sentence handed over.
    const line = page.getByRole("combobox").first();
    if (size.mobile) await tap(line);
    else await page.keyboard.press("Control+k");
    await line.fill(SAY[lang]);
    await page.waitForSelector("[role='listbox']:not([hidden]) [role='option']", { timeout: 20_000 });
    await shot("agent-rows");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    await settle();
    await shot("agent-handed");

    // The events under the bell.
    await tap(page.locator("[data-terminal='bell']"));
    await page.waitForSelector("[role='dialog']", { timeout: 10_000 });
    await shot("events");
    await page.keyboard.press("Escape");

    if (size.mobile) {
      // The sections sheet behind the mark: the wallet, the shelves without a tab, the city, the language.
      await tap(page.locator("[data-terminal='mark']"));
      await page.waitForSelector("[role='dialog'][aria-modal='true']", { timeout: 10_000 });
      await shot("sheet");
      // The wallet from the sheet: its list stays open under the finger (no wallet in this browser: where to get one).
      await tap(page.locator("[role='dialog'][aria-modal='true'] button").nth(1));
      await page.waitForSelector("[role='dialog'][aria-modal='true'] a[href*='phantom']", { timeout: 10_000 });
      // A second tap inside the list — where the pick was once cancelled under the finger — keeps it.
      await tap(page.locator("[role='dialog'][aria-modal='true'] p").first());
      await page.waitForTimeout(800);
      report.push(`${size.name}/${lang}: the sheet's wallet list stays open — ${await page.locator("[role='dialog'][aria-modal='true'] a[href*='phantom']").count() === 1}`);
      await shot("sheet-wallet");
      await page.keyboard.press("Escape");
      await tap(page.locator("[data-terminal='tabs'] a[href$='/terminal/kit/agents']"));
      await page.waitForURL(/\/terminal\/kit\/agents/);
      await settle();
      await shot("tab-agent");
    } else {
      // «More»: the language and the site's pages; the wallet's door.
      await tap(page.locator("[data-terminal='more']"));
      await page.waitForSelector("[role='dialog']", { timeout: 10_000 });
      await shot("more");
      await page.keyboard.press("Escape");
      await tap(page.locator("[data-terminal='wallet']"));
      await page.waitForTimeout(1500);
      await shot("wallet");
    }

    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
console.log(report.join("\n"));
