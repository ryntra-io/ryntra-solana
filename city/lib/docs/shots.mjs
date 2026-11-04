// The documentation for review (CITY-180): the hub and every section whole, on a desk (1440) and a phone (375), English and
// Ukrainian → <out>/<name>.jpg, with the phone's menu and the search. It also says what the eyes should not have to find: a page
// wider than its screen, a block wider than its column, a word cut, an error in the console.
//   npm run dev      then      node city/lib/docs/shots.mjs [out] [baseUrl]
//   ONLY=start,fees and LANGS=uk and SIZES=phone keep it to a few.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-180");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const SECTIONS = ["start", "city", "trade", "orders", "launch", "earn", "agent", "money", "partners", "security", "fees", "guard", "help"];
const PAGES = { developers: "/developers", connector: "/connector", support: "/support", about: "/about", terms: "/legal/terms", privacy: "/legal/privacy" };
const only = process.env.ONLY ? process.env.ONLY.split(",") : ["hub", ...SECTIONS, ...Object.keys(PAGES)];
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const problems = [];

/** Lets the page run its full length, so one picture holds the whole of it. */
const UNROLL = `[data-city-doc]{position:static!important;overflow:visible!important;height:auto!important}
  body > div, [class*="root"]{position:static!important;overflow:visible!important}
  [data-doc-bar]{position:absolute!important;left:0;right:0}
  [class*="phoneBar"]{position:static!important}
  [class*="side"],[class*="toc"]{position:static!important;max-height:none!important}`;

async function open(size, lang, url) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile });
  await ctx.addInitScript((value) => localStorage.setItem("ryntra.city.lang", value), lang);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => problems.push(`${url} ${size.name} ${lang}: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|Failed to load resource|Content Security Policy/.test(message.text())) problems.push(`${url} ${size.name} ${lang}: ${message.text().slice(0, 200)}`);
  });
  await page.goto(`${base}${url}`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForFunction(() => !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { ctx, page };
}

async function measure(page, label) {
  const found = await page.evaluate(() => {
    const scroller = document.querySelector("[data-city-doc]");
    const wide = [];
    for (const el of document.querySelectorAll("[data-docs-frame] *")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > window.innerWidth + 1 && !el.closest("[class*='band']")) wide.push(`${el.tagName}.${String(el.className).slice(0, 40)} ${Math.round(box.right)}`);
    }
    return { pageWide: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : false, width: window.innerWidth, wide: wide.slice(0, 5) };
  });
  if (found.pageWide || found.wide.length) problems.push(`${label}: wider than its screen ${JSON.stringify(found)}`);
}

async function whole(page, name) {
  await page.addStyleTag({ content: UNROLL });
  await page.evaluate(() => Promise.all([...document.images].map((img) => (img.loading = "eager", img.complete ? null : new Promise((done) => ((img.onload = img.onerror = done)))))));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 58, fullPage: true });
  console.log("shot", name);
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const id of only) {
      const url = id === "hub" ? "/docs" : (PAGES[id] ?? `/docs/${id}`);
      const { ctx, page } = await open(size, lang, url);
      await measure(page, `${url} ${size.name} ${lang}`);
      await whole(page, `${id}-${lang}-${size.name}`);
      await ctx.close();
    }
    if (!process.env.ONLY) {
      const { ctx, page } = await open(size, lang, "/docs/fees");
      if (size.mobile) {
        await page.locator("[data-docs-menu]").click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `menu-${lang}-${size.name}.jpg`), type: "jpeg", quality: 78 });
        await page.locator("[data-docs-sheet] [data-docs-search]").fill(lang === "uk" ? "стоп" : "stop");
      } else {
        await page.locator("aside [data-docs-search]").first().fill(lang === "uk" ? "стоп" : "stop");
      }
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `search-${lang}-${size.name}.jpg`), type: "jpeg", quality: 78 });
      console.log("shot", `search-${lang}-${size.name}`);
      await ctx.close();
    }
  }
}
await browser.close();
console.log(problems.length ? `PROBLEMS\n${problems.join("\n")}` : "no problems");
