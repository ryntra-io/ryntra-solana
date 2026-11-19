// The Market — the home page and navigator — for the eyes: 1440×900, 1920×1080 and 390×844, English and
// Ukrainian → <out>/*.jpg and <out>/report.txt.
//   node terminal/market/market-shots.mjs <out> [baseUrl]
// `STATES=top,full` draws only the screen as it opens and the whole page (the live site before the change); the stand
// adds the filters panel, a quick buy's panel and, on a phone, the Pulse's tabs. No wallet is connected: nothing is
// signed. The system Chrome draws the page (PRESS_CHROME may point at another).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-301");
const base = process.argv[3] ?? "http://localhost:3101";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = (process.env.SIZES ?? "desk,wide,phone").split(",").map((name) => ({
  desk: { name: "desk", width: 1440, height: 900, mobile: false },
  wide: { name: "wide", width: 1920, height: 1080, mobile: false },
  phone: { name: "phone", width: 390, height: 844, mobile: true },
})[name]);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const STATES = new Set((process.env.STATES ?? "top,full,filters,quick,pulse").split(","));
const PREFIX = process.env.PREFIX ?? "after";
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
    // A quick buy's price: the engine's live quote on ryntra.io (a read — the stand holds no quote key); no wallet, no
    // order, nothing signed. `QUOTE_FROM=none` leaves the stand's own answer.
    const quoteFrom = process.env.QUOTE_FROM ?? "https://ryntra.io";
    if (quoteFrom !== "none") {
      await context.route("**/api/solana/swap/quote", async (route) => {
        const url = new URL(route.request().url());
        const answer = await fetch(`${quoteFrom}${url.pathname}${url.search}`, { method: route.request().method(), headers: { "content-type": "application/json" }, body: route.request().method() === "POST" ? route.request().postData() : undefined }).catch(() => null);
        if (!answer) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        return route.fulfill({ status: answer.status, contentType: "application/json", body: await answer.text() });
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const name = (state) => path.join(out, `${PREFIX}-${state}-${size.name}-${lang}.jpg`);
    const shot = async (state, full = false) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: name(state), quality: 84, type: "jpeg", fullPage: full });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("a[href^='/coin/']", { timeout: 180_000 }).catch(() => {});
    // The Pulse and the table are read: their first cards stand.
    await page.waitForSelector("[data-terminal='pulse'] a[href^='/coin/']", { timeout: 60_000 }).catch(() => {});
    await settle();
    const facts = await page.evaluate(() => ({
      side: document.documentElement.scrollWidth - window.innerWidth,
      height: document.documentElement.scrollHeight,
      rows: document.querySelectorAll("[data-terminal='depth'] [role='row']").length,
      cards: document.querySelectorAll("[data-terminal='pulse'] [data-card]").length,
      tiles: document.querySelectorAll("[data-terminal='tiles'] a").length,
      noLogo: [...document.querySelectorAll("[data-terminal='depth'] [role='row'], [data-terminal='pulse'] [data-card]")].filter((row) => !row.querySelector("img")).length,
    }));
    report.push(`${size.name}/${lang}: ${JSON.stringify(facts)}`);
    if (STATES.has("top")) await shot("top");
    if (STATES.has("full")) await shot("full", true);

    const depth = page.locator("[data-terminal='depth']");
    if (STATES.has("filters") && (await depth.count())) {
      await depth.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
      await tap(depth.locator("button[aria-haspopup='dialog']").first());
      await page.waitForTimeout(600);
      await shot("filters");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    }
    if (STATES.has("quick") && (await depth.count())) {
      const zap = depth.locator("button[data-zap]").nth(1);
      if (await zap.count()) {
        await zap.scrollIntoViewIfNeeded();
        await tap(zap);
        await page.waitForTimeout(3500);
        await shot("quick");
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    const pulse = page.locator("[data-terminal='pulse']");
    if (STATES.has("pulse") && size.mobile && (await pulse.count())) {
      await pulse.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70));
      await tap(pulse.locator("[role='tab']").nth(1));
      await page.waitForTimeout(800);
      await shot("pulse");
    }
    // Each kind of asset: its tab opened by the address, the table at the top of the window.
    if (STATES.has("kinds")) {
      for (const kind of ["meme", "crypto", "stock", "preipo"]) {
        await page.goto(`${base}/?lang=${lang}&tab=${kind}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
        await page.waitForSelector("[data-terminal='depth'] [role='row'] a[href^='/coin/'], [data-terminal='depth'] [role='listitem']", { timeout: 90_000 }).catch(() => {});
        await settle();
        const head = page.locator("[data-terminal='depth']");
        await head.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84));
        await page.waitForTimeout(700);
        report.push(`${size.name}/${lang}/${kind}: rows ${await page.locator("[data-terminal='depth'] [role='row'], [data-terminal='depth'] [role='listitem']").count()}`);
        await shot(`kind-${kind}`);
      }
    }
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, `${PREFIX}-report.txt`), `${report.join("\n")}\n`);
console.log(report.join("\n"));
