// The home page and the Market's depth for the eyes: 1440×900, 1920×1080 and 390×844, English and
// Ukrainian, direction A and «Pro» → <out>/*.jpg and <out>/report.txt.
//   node terminal/market/depth-shots.mjs <out> [baseUrl]
// A stand runs as people will get it (NEXT_PUBLIC_RYNTRA_TERMINAL=open with the city's production switches). No wallet
// is connected: nothing is signed. The system Chrome draws the page (PRESS_CHROME may point at another).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-278");
const base = process.argv[3] ?? "http://localhost:3178";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = (process.env.SIZES ?? "desk,wide,phone").split(",").map((name) => ({
  desk: { name: "desk", width: 1440, height: 900, mobile: false },
  wide: { name: "wide", width: 1920, height: 1080, mobile: false },
  phone: { name: "phone", width: 390, height: 844, mobile: true },
})[name]);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const MODES = (process.env.MODES ?? "a,pro").split(",");
// The table's own «Columns»: mode «a» is the main set, «pro» all of them.
const COLUMNS = "ryntra.terminal.columns.market.v1";
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const mode of MODES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.mobile ? 2 : 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
      });
      await context.addInitScript(
        ({ key, pro }) => {
          try {
            localStorage.setItem(key, pro ? "all" : "main");
          } catch {}
        },
        { key: COLUMNS, pro: mode === "pro" },
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const name = (state) => path.join(out, `${state}-${mode}-${size.name}-${lang}.jpg`);
      const shot = async (state, full = false) => {
        await page.waitForTimeout(600);
        await page.screenshot({ path: name(state), quality: 84, type: "jpeg", fullPage: full });
      };
      const settle = async () => {
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1200);
      };
      const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
      const depth = page.locator("[data-terminal='depth']");

      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("[data-terminal='depth']", { timeout: 180_000 });
      // The list is read: its first row stands.
      await page.waitForSelector("[data-terminal='depth'] a[href^='/coin/']", { timeout: 90_000 }).catch(() => {});
      await settle();
      const rows = await depth.locator("a[href^='/coin/']").count();
      report.push(`${size.name}/${lang}/${mode}: rows ${rows}; side scroll ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}`);
      if (mode === "a") await shot("home");

      // The market: the depth section at the top of the window.
      await depth.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84));
      await page.waitForTimeout(500);
      await shot("market");

      if (mode === "a") {
        // Filters open.
        await tap(depth.locator("button[aria-expanded]").filter({ hasText: /Filters|Фільтри/ }).first());
        await page.waitForTimeout(400);
        await shot("filters");
        await page.keyboard.press("Escape").catch(() => {});
        await page.mouse.click(2, 2).catch(() => {});
        // A quick buy: the ticket takes the coin and the ready sum.
        const quick = depth.locator("button[aria-label*='SOL']").nth(1);
        if (await quick.count()) {
          await tap(quick);
          await page.waitForTimeout(2500);
          const typed = await page.locator("input[inputmode='decimal']").first().inputValue().catch(() => "?");
          report.push(`${size.name}/${lang}/${mode}: quick buy → field «${typed}»`);
          await shot("quick");
          if (size.mobile) await tap(page.locator("[role='dialog'] button").first()).catch(() => {});
        }
        // «New»: rarely verified — the empty list says so and shows them all in one tap.
        await tap(depth.locator("[role='tab']").nth(1));
        await page.waitForTimeout(3500);
        const showAll = depth.locator("button").filter({ hasText: /Show all|Показати всі/ });
        if (await showAll.count()) {
          await shot("fresh-verified");
          await tap(showAll.first());
          await page.waitForTimeout(800);
        }
        await shot("fresh");
        await page.evaluate(() => localStorage.removeItem("ryntra.terminal.market.depth.v1"));
      } else {
        await tap(depth.locator("[role='tab']").nth(2));
        await page.waitForTimeout(4000);
        await shot("gainers");
      }
      // The coin screen: A — the plain line and four tiles; Pro — candles, buys and sells, holders.
      await page.goto(`${base}/coin/So11111111111111111111111111111111111111112?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForTimeout(6000);
      await settle();
      await shot("coin");
      if (errors.length) report.push(`${size.name}/${lang}/${mode}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
