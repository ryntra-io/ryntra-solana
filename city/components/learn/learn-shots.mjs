// «Learn» (CITY-202) for review: every chapter of the window, desk and phone, English and Ukrainian, on the real GPU.
//   node city/components/learn/learn-shots.mjs [out=docs/shots/city-202] [baseUrl=http://localhost:3000]   (npm run dev running)
// → <out>/<lang>-<size>-<nn>-<slug>.png, plus the list on a phone and «How it works inside» open on the agent's chapter.
// The window opens through the development hook window.__learn (`city/lib/learn/store.ts`); the city's controls never change.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-202");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });
const SLUGS = ["city", "search-ask", "trade", "launch", "agent", "strategies", "earn", "money", "partners", "phone", "security"];
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
for (const lang of (process.env.LANGS ?? "en,uk").split(",")) {
  for (const s of SIZES) {
    const context = await browser.newContext({ locale: lang === "uk" ? "uk-UA" : "en-US", viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window.__city?.getState().layout.towers.length ?? 0) > 0 && window.__learn, null, { timeout: 180_000 });
    await page.waitForTimeout(4000);
    if (s.mobile) {
      await page.evaluate(() => window.__learn.getState().show(null));
      await page.waitForSelector("[data-learn]", { timeout: 60_000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, `${lang}-${s.name}-00-list.png`) });
    }
    for (const [i, slug] of SLUGS.entries()) {
      await page.evaluate((x) => window.__learn.getState().show(x), slug);
      await page.waitForSelector(`[data-chapter="${slug}"]`, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.querySelectorAll("[data-learn] img")].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, `${lang}-${s.name}-${String(i + 1).padStart(2, "0")}-${slug}.png`) });
      if (slug === "agent") {
        await page.locator(`[data-chapter="agent"] button[aria-expanded]`).click();
        await page.locator(`[data-chapter="agent"] button[aria-expanded]`).scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, `${lang}-${s.name}-05-agent-inside.png`) });
      }
    }
    if (!s.mobile) {
      // The window on the whole screen: the chapters on the left, the chapter on the right.
      await page.evaluate(() => window.__learn.getState().show("agent"));
      await page.getByRole("button", { name: /^(Full screen|На весь екран)$/ }).first().click().catch(() => console.log("no full screen button"));
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `${lang}-${s.name}-05-agent-full.png`) });
    }
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(lang, s.name, wide ? "SCROLLS SIDEWAYS" : "fits", errors.length ? errors.slice(0, 3) : "no errors");
    await context.close();
  }
}
await browser.close();
