// «Earn», every tab on one layout, for the eyes → <out>/<tab>-<size>-<lang>.jpg, and the places measured:
// where the head, the list and the ticket stand on each tab, so a turn of the tabs is seen to move nothing.
//   node terminal/earn/layout-shots.mjs [out] [baseUrl] [source]
// `baseUrl` ryntra.io itself takes the live site as it is (the «before»); a stand (`next start`) takes every read from
// `source` (ryntra.io by default) with the site's own origin, as a browser on it asks. Reads only: the wallet is never
// connected, nothing is built or sent. SIZES=xl,wide,phone and LANGS=en,uk narrow the run.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-329");
const base = process.argv[3] ?? "http://localhost:3135";
const source = process.argv[4] ?? "https://ryntra.io";
const live = base.startsWith(source);
mkdirSync(out, { recursive: true });

const EXE = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: EXE, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "xl", width: 2560, height: 1440, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "lap", width: 1440, height: 900, mobile: false, only: true },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => (process.env.SIZES ? process.env.SIZES.split(",").includes(size.name) : !size.only));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const TABS = [
  ["pools", "/earn"],
  ["pro", "/pro"],
  ["staking", "/earn?tab=staking"],
  ["lending", "/earn?tab=lending"],
  ["mine", "/earn?tab=mine"],
];
const report = [];
const places = {};

async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/` } });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

/** Where the page's parts stand: the head, the tabs, the list's panel and the ticket's column. */
const measure = () => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width ? [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)] : null;
  };
  const page = document.querySelector("[data-page]");
  const head = document.querySelector("[data-page-head]");
  const main = document.querySelector("[data-earn-main]") ?? document.querySelector("[data-page-main]") ?? document.querySelector("[data-dlmm-list]");
  const side = document.querySelector("[data-earn-side]") ?? document.querySelector("[data-page-side]");
  const table = (main ?? document).querySelector("[role='table']");
  const rows = [...(main ?? document).querySelectorAll("[role='table'] [role='row']")].slice(1, 4).map((row) => Math.round(row.getBoundingClientRect().height));
  // A row's action cut by its column or its table: its words wider than its box, or its box past the table's edge.
  const edge = table?.getBoundingClientRect().right ?? Infinity;
  const clipped = [...(main ?? document).querySelectorAll("[role='table'] [data-earn-pick]")].filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > edge + 1).length;
  return { page: box(page), head: box(head), main: box(main), side: box(side), table: box(table), rows, clipped };
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    if (!live) {
      await context.route("**/api/**", fromSource);
      await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
    for (const [tab, where] of TABS) {
      await page.goto(`${base}${where}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 60_000 }).catch(() => {});
      await page.waitForSelector("[role='table'], [data-earn-blank]", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(6_000);
      const file = path.join(out, `${tab}-${size.name}-${lang}.jpg`);
      await page.screenshot({ path: file, quality: 86, type: "jpeg" });
      const at = await page.evaluate(measure);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      places[`${tab}-${size.name}-${lang}`] = { ...at, overflow };
      report.push(`${tab}-${size.name}-${lang}: main ${JSON.stringify(at.main)} side ${JSON.stringify(at.side)} table ${JSON.stringify(at.table)} rows ${at.rows.join("/")} · clipped ${at.clipped} · overflow ${overflow}`);
      // A phone: a tap on the first row's action opens the tab's ticket as a sheet.
      if (size.mobile && !live) {
        const hit = page.locator("[data-earn-pick]:visible").first();
        if (await hit.count()) {
          await hit.click().catch(() => {});
          await page.waitForTimeout(2_500);
          await page.screenshot({ path: path.join(out, `${tab}-sheet-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(400);
        }
      }
    }
    // A turn to DLMM Pro and back rewrites the address in place: the same desk stays mounted, the menu lights the tab.
    if (!size.mobile && !live) {
      await page.goto(`${base}/earn?tab=staking`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("[data-earn-desk]", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(3_000);
      await page.evaluate(() => (window.__earnDesk = document.querySelector("[data-earn-desk]")));
      const lit = () => page.evaluate(() => document.querySelector("a[aria-current='page']")?.textContent?.trim() ?? null);
      const steps = [];
      for (const name of [/DLMM Pro/, /^(Pools|Пули)/, /DLMM Pro/, /(My positions|Мої позиції|Positions|Позиції)/]) {
        await page.getByRole("tab", { name }).first().click();
        await page.waitForTimeout(1_200);
        const at = await page.evaluate(() => ({ path: location.pathname + location.search, same: window.__earnDesk?.isConnected === true, tab: document.querySelector("[data-earn-desk]")?.getAttribute("data-earn-desk") }));
        steps.push(`${at.tab}@${at.path} same=${at.same} lit=${await lit()}`);
      }
      report.push(`${size.name}/${lang} switch: ${steps.join(" → ")}`);
    }
    if (errors.length) report.push(`${size.name}/${lang} errors: ${errors.join(" | ").slice(0, 400)}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "places.json"), JSON.stringify(places, null, 1));
console.log(report.join("\n"));
