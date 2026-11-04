// Earn's notes for review (CITY-100) → <out>/notes-<state>-<lang>-<size>.jpg.
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open npm run dev, then
//   node city/lib/earn/notes-shots.mjs [out=docs/shots/city-100] [baseUrl=http://localhost:3000] [--fresh]
// A desk (1440) and a phone (375), in English and Ukrainian: Settings → Notifications with the «Earn» group, its «i»
// open (where «a note can arrive late» is said — never on the screen), and Earn's banners standing in the city through
// the development hook `window.__cityNotify` with the words `notes.ts` gives them. No wallet is connected; it signs
// nothing and asks the engine for nothing but what the city reads. A shot already on disk is kept unless `--fresh`:
// with a software GPU a frame takes minutes.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { earnNoteText } from "./notes.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-100");
const base = process.argv[3] ?? "http://localhost:3000";
const fresh = process.argv.includes("--fresh");
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const LANGS = ["en", "uk"];
const HOUR = 3_600_000;
const EVENTS = [
  { kind: "range", id: "range:P1", pair: "JitoSOL–SOL" },
  { kind: "dividend", id: "dividend:x", stage: "ahead", ticker: "TSLAx", inMs: 2 * 24 * HOUR },
  { kind: "weekend", id: "weekend:x", tickers: ["NVDAx", "TSLAx"] },
];

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${size.name}/${lang}: ${e}`));
    await page.addInitScript(() => localStorage.setItem("ryntra.city.firstHint", "1"));
    const file = (state) => path.join(out, `notes-${state}-${lang}-${size.name}.jpg`);
    const has = (state) => !fresh && existsSync(file(state));
    const shot = (state) => page.screenshot({ path: file(state), type: "jpeg", quality: 86, timeout: 480_000, animations: "disabled" });

    // Settings → Notifications: the «Earn» group in the table, then its «i», where the late note is said.
    if (!has("table") || !has("details")) {
      await page.goto(`${base}/?open=settings&lang=${lang}`, { waitUntil: "load", timeout: 240_000 });
      await page.locator("canvas").first().waitFor({ state: "attached", timeout: 240_000 });
      await page.locator("[data-city-settings]").waitFor({ timeout: 120_000 });
      // A software GPU draws a frame in seconds: no element is «stable» by Playwright's measure, so the stand clicks and
      // scrolls through the DOM itself.
      await page.locator("[data-city-settings] nav button").nth(2).click({ force: true });
      // The skyline behind the glass: a software GPU draws its first frames slowly.
      await page.waitForTimeout(size.mobile ? 4_000 : 8_000);
      const group = page.locator("[data-settings-table] [role='group']", { hasText: lang === "uk" ? "Заробіток" : "Earn" }).first();
      await group.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.mouse.move(2, size.height - 2);
      await page.waitForTimeout(600);
      await shot("table");
      const info = page.locator("section[aria-labelledby='settings-notifications'] button[aria-controls]").first();
      await info.evaluate((el) => {
        el.scrollIntoView({ block: "start" });
        el.click();
      });
      await page.waitForTimeout(600);
      await shot("details");
    }

    // Earn's banners in the city. A banner stands six seconds and a frame here takes minutes: once the city has settled,
    // the stand holds them — no six-second timer starts from then on — so the frame catches them standing.
    if (!has("banners")) {
      await page.goto(`${base}/?lang=${lang}`, { waitUntil: "load", timeout: 240_000 });
      await page.locator("canvas").first().waitFor({ state: "attached", timeout: 240_000 });
      await page.waitForFunction(() => typeof window.__cityNotify === "function", null, { timeout: 120_000 });
      await page.waitForTimeout(size.mobile ? 4_000 : 8_000);
      const notes = EVENTS.map((event) => ({ kind: event.kind, ...earnNoteText(event, lang) }));
      await page.evaluate((list) => {
        const plain = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...rest) => (ms === 6_000 ? 0 : plain(fn, ms, ...rest));
        for (const note of list) window.__cityNotify({ kind: note.kind, title: note.title, line: note.line || null });
      }, notes);
      await page.locator("[data-city-banners]").waitFor({ state: "attached", timeout: 180_000 });
      await page.waitForTimeout(1_200);
      await shot("banners");
    }
    await context.close();
  }
}

await browser.close();
if (errors.length) console.log(errors.join("\n"));
console.log(`shots → ${out}`);
