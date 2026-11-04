// CITY-191's screens for review: «New launches on Solana» as the city's window — as it opens from the «New» chip's list
// toggle, on the whole screen and stretched wide by its corner on a desk; on a phone the sheet, its other rings and the
// whole screen — in English and Ukrainian, at 1440×900 and 390×844 → <out>/<state>-<size>-<lang>.jpg, report.json.
// Before CITY-191 the list was a fixed panel: the same pass takes what it can of it (the list alone).
//   node city/lib/lens/new-window-shots.mjs [out] [baseUrl]      (PRESS_CHROME may point at a Chromium; SIZES, LANGS; QUERY=launch=stub on a dev stand)
// Read-only: the engine's own public Pulse; nothing is signed or sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/new-window-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "phone360", width: 360, height: 740, mobile: true },
];
const SIZES = ALL.filter((s) => (process.env.SIZES ?? "desk,phone").split(",").includes(s.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const SETTLE = Number(process.env.SETTLE ?? 16_000);
const chrome = process.env.PRESS_CHROME || `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1243/chrome-win64/chrome.exe`;
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const report = [];

for (const lang of LANGS) {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.addInitScript(() => {
      window.localStorage.setItem("ryntra.city.firstHint", "1");
      window.localStorage.setItem("ryntra.city.lens", "all");
    });
    await page.goto(`${base}/?lang=${lang}${process.env.QUERY ? `&${process.env.QUERY}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(SETTLE);
    for (const name of [/^Got it$/, /^Зрозуміло$/, /^Later$/, /^Пізніше$/]) {
      const button = page.getByRole("button", { name });
      if (await button.first().isVisible().catch(() => false)) await button.first().click().catch(() => {});
    }
    const shot = async (state) => {
      const file = `${state}-${size.name}-${lang}.jpg`;
      await page.screenshot({ path: path.join(out, file), quality: 84, timeout: 120_000 });
      const box = await page.evaluate(() => {
        const node = document.querySelector('[data-window="new-launches"]') ?? document.querySelector("[data-city-new-list]");
        const r = node?.getBoundingClientRect();
        return {
          box: r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          words: (node?.innerText ?? "").replace(/\n{2,}/g, "\n").slice(0, 600),
        };
      });
      report.push({ file, ...box });
      console.log(file, JSON.stringify(box.box));
    };
    await page.evaluate(() => document.querySelector('[data-lens="new"]').click());
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.querySelector("[data-lens-list-toggle]").click());
    // The window's contents (loaded on its first open), the pulse's first read, and the logos.
    await page.waitForSelector("[data-city-new-list] [data-new-about], [data-city-new-list][role=dialog]", { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(6000);
    await shot("list");
    const framed = await page.locator('[data-window="new-launches"]').count();
    if (framed) {
      if (size.mobile) {
        for (const stage of ["near", "graduated"]) {
          await page.evaluate((st) => document.querySelector(`[data-window="new-launches"] [role="tab"][data-stage="${st}"]`)?.click(), stage);
          await page.waitForTimeout(1200);
          await shot(`list-${stage}`);
        }
        await page.evaluate(() => document.querySelector(`[data-window="new-launches"] [role="tab"][data-stage="fresh"]`)?.click());
      } else {
        // Stretched: popped out of its bay, then pulled by its corner across the city.
        await page.evaluate(() => {
          const frame = document.querySelector('[data-window="new-launches"]');
          [...frame.querySelectorAll("button[aria-label]")].find((b) => /^(pop out|відкріпити)/i.test(b.getAttribute("aria-label")))?.click();
        });
        await page.waitForTimeout(1200);
        const corner = page.locator('[data-window="new-launches"] [data-handle="se"]');
        const nw = page.locator('[data-window="new-launches"] [data-handle="nw"]');
        if ((await corner.count()) && (await nw.count())) {
          const drag = async (box, x, y) => {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(x, y, { steps: 14 });
            await page.mouse.up();
            await page.waitForTimeout(900);
          };
          await drag(await nw.boundingBox(), 24, 140);
          await drag(await corner.boundingBox(), size.width - 24, size.height - 110);
          await page.waitForTimeout(800);
          await shot("stretched");
        }
      }
      // The frame's own «Full screen» (on a phone the sheet's): the head's one button that takes the screen.
      await page.evaluate(() => {
        const frame = document.querySelector('[data-window="new-launches"]');
        const full = [...frame.querySelectorAll("button[aria-label]")].find((b) => /full screen|на весь екран/i.test(b.getAttribute("aria-label")));
        full?.click();
      });
      await page.waitForTimeout(1500);
      await shot("full");
      // The one quiet control: the order and the launchpads.
      await page.evaluate(() => document.querySelector('[data-window="new-launches"] [data-new-filter]')?.click());
      await page.waitForTimeout(700);
      await shot("full-filter");
      await page.evaluate(() => document.querySelector('[data-window="new-launches"] [data-new-filter]')?.click());
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector('[data-window="new-launches"] [data-new-about]')?.click());
      await page.waitForTimeout(900);
      await shot("full-about");
    }
    report.at(-1).errors = errors;
    await context.close();
  }
}
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
