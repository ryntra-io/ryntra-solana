// The Pulse's cards and the Market's table for the eyes: 1440×900 and 390×844, English and Ukrainian → <out>/*.jpg and
// <out>/pulse-report.txt. The engine's recorded answers stand in for the live ones (the Pulse of 17.11, aged to now; the
// table from Jupiter's recorded lists through the engine's own `listCoins`), so the frames are the same on any stand.
//   node terminal/market/pulse-shots.mjs <out> [baseUrl]
// No wallet is connected: nothing is signed. `PRESS_CHROME` may point at a Chrome of its own.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listCoins } from "../../lib/market-depth/model.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/pulse");
const base = process.argv[3] ?? "http://localhost:3101";
mkdirSync(out, { recursive: true });

const PULSE = JSON.parse(readFileSync(new URL("./fixtures/pulse-2026-11-17.json", import.meta.url), "utf8"));
const JUP = JSON.parse(readFileSync(new URL("../../lib/market-depth/fixtures/jupiter-2026-11-17.json", import.meta.url), "utf8"));
const ANSWERS = [JUP.toptrending1h, JUP.toptraded1h, JUP.toporganicscore1h, JUP.searchPrestocks, JUP.searchSpacex].filter(Array.isArray);

/* The recorded Pulse, moved in time so its newest coin was born two minutes ago. */
const newest = Math.max(...PULSE.new.map((row) => Date.parse(row.firstPoolAt ?? "") || 0));
const shift = Date.now() - newest - 2 * 60_000;
const moved = (iso) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : iso);
const aged = (row) => ({ ...row, firstPoolAt: moved(row.firstPoolAt), graduatedAt: moved(row.graduatedAt), ryntra: row.ryntra ? { ...row.ryntra, launchedAt: moved(row.ryntra.launchedAt) } : null });

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = (process.env.SIZES ?? "desk,phone").split(",").map((name) => ({ desk: { name: "desk", width: 1440, height: 900, mobile: false }, phone: { name: "phone", width: 390, height: 844, mobile: true } })[name]);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    await context.route("**/api/spot/pulse?**", (route) => {
      const feed = new URL(route.request().url()).searchParams.get("feed");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: (PULSE[feed] ?? []).map(aged) }) });
    });
    await context.route("**/api/v1/market/depth?**", (route) => {
      const q = new URL(route.request().url()).searchParams;
      const list = q.get("list") ?? "trending";
      const kind = q.get("kind") ?? "all";
      const window = q.get("window") ?? "1h";
      const coins = list === "saved" ? [] : listCoins(list, window, ANSWERS, new Set(), kind).slice(0, 50);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ list, kind, window, coins, readAt: new Date().toISOString() }) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // What the browser said went wrong, besides a picture the closed network did not load.
    page.on("console", (message) => message.type() === "error" && !/Failed to load resource/.test(message.text()) && errors.push(message.text().slice(0, 300)));
    const name = (state) => path.join(out, `${state}-${size.name}-${lang}.jpg`);
    const shot = async (state) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: name(state), quality: 86, type: "jpeg" });
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("[data-terminal='pulse'] [data-card]", { timeout: 120_000 }).catch(() => {});
    await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const pulse = page.locator("[data-terminal='pulse']");
    await pulse.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84));
    if (size.mobile) await tap(pulse.locator("[role='tab']").nth(1));
    await page.mouse.move(2, 2);
    await page.waitForTimeout(800);
    const facts = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("[data-terminal='pulse'] [data-card]")];
      // A ticker cut by the card would scroll inside its own box.
      const cut = cards.map((card) => card.querySelector("a")).filter((a) => a && a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent);
      return {
        side: document.documentElement.scrollWidth - window.innerWidth,
        cards: cards.length,
        riskLines: document.querySelectorAll("[data-terminal='pulse'] [data-card] button[data-level]").length,
        tickersCut: cut,
        dashes: cards.filter((card) => /(^|\s)—(\s|$)/.test(card.textContent ?? "")).length,
      };
    });
    report.push(`${size.name}/${lang}: ${JSON.stringify(facts)}`);
    await shot("pulse");

    // The facts behind a card's sign.
    const sign = pulse.locator("button[data-level='warn']").first();
    if (await sign.count()) {
      await tap(sign);
      await page.waitForTimeout(500);
      await shot("pulse-facts");
      await page.keyboard.press("Escape").catch(() => {});
      await tap(pulse.locator("h2"));
      await page.waitForTimeout(300);
    }
    // A column's own filter.
    const filter = pulse.locator("button[aria-haspopup='dialog']").first();
    if (await filter.count()) {
      await tap(filter);
      await page.waitForTimeout(500);
      await shot("pulse-filter");
      await page.keyboard.press("Escape").catch(() => {});
      await tap(pulse.locator("h2"));
      await page.waitForTimeout(300);
    }
    // A column scrolled past its first five cards.
    const body = pulse.locator("[data-pulse-body]").nth(size.mobile ? 0 : 1);
    if (await body.count()) {
      await body.evaluate((el) => el.scrollTo({ top: 360 }));
      await page.waitForTimeout(500);
      await shot("pulse-scrolled");
      await body.evaluate((el) => el.scrollTo({ top: 0 }));
    }
    // The table of memes: its age column.
    await page.goto(`${base}/?lang=${lang}&tab=meme`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("[data-terminal='depth'] [role='row'] a[href^='/coin/'], [data-terminal='depth'] [role='listitem']", { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.locator("[data-terminal='depth']").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84));
    await page.waitForTimeout(600);
    report.push(`${size.name}/${lang}/meme: heads ${JSON.stringify(await page.locator("[data-terminal='depth'] [role='columnheader']").allTextContents())}`);
    await shot("market-meme");
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "pulse-report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
