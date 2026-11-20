// For the eyes: the Bots' pages, the Launch, the Swap, the Bridge and the Agents at 2560×1440, 1920×1080,
// 1440×900 and a 390×844 phone, English and Ukrainian → <out>/*.jpg, with a report (`axis.json`) of where each page's
// head and its form stand (one axis: the title's left edge and the form's), which menu item is lit, how much the page
// moved while it loaded (the browser's layout shifts, the first 8 s, and what moved) and where the home page's «Find new
// coins» leads.
//   node terminal/bots/axis-shots.mjs <out> [baseUrl] [source]        SIZES=w2560,w1920,w1440,phone  LANGS=uk,en  ONLY=…
// `source` (ryntra.io) answers every `/api/**` of a local stand, with its own origin — the stand has no keys; against
// ryntra.io itself (`baseUrl` = source) nothing is routed: the «before» frames. No wallet is connected; nothing signs.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-338");
const base = process.argv[3] ?? "http://localhost:3338";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });
const local = !base.startsWith(source);

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "w2560", width: 2560, height: 1440, mobile: false },
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "w1440", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name) => (process.env[name] ?? "").split(",").filter(Boolean);
const only = list("ONLY");
const sizes = list("SIZES");
const langs = list("LANGS").length ? list("LANGS") : ["uk", "en"];

const SCREENS = [
  ["bots", "/bots"],
  ["bots-recurring", "/bots/recurring"],
  ["bots-grid", "/bots/grid"],
  ["bots-ladder", "/bots/ladder"],
  ["bots-signals", "/bots/signals"],
  ["bots-autopilot", "/bots/autopilot"],
  ["launch", "/launch"],
  ["launch-fresh", "/launch?tab=fresh"],
  ["swap", "/swap"],
  ["bridge", "/bridge"],
  ["agent", "/agent"],
];

async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/` } });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

/** Before the page's own scripts: every layout shift of the load, with what moved. */
const WATCH = () => {
  window.__shifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const what = (entry.sources ?? []).map((one) => {
          const node = one.node;
          const name = node && node.nodeType === 1 ? `${node.tagName}.${String(node.className).split(" ")[0]}` : String(node?.nodeName ?? "?");
          return `${name} «${(node?.textContent ?? "").trim().slice(0, 30)}»`;
        });
        window.__shifts.push({ v: Math.round(entry.value * 10000) / 10000, t: Math.round(entry.startTime), what });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
};

/** Runs in the page: where its head and its form stand, which item of the menu is lit, and the load's shifts. */
function measure() {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const title = document.querySelector("[data-page-head] h1");
  const form = document.querySelector("[data-page-main] > *") ?? document.querySelector("[data-page-body] > *");
  const lit = [...document.querySelectorAll("[data-terminal='menu'] [aria-current='page']")].map((el) => el.textContent?.trim());
  const shifts = window.__shifts ?? [];
  const cls = Math.round(shifts.reduce((sum, one) => sum + one.v, 0) * 10000) / 10000;
  const wide = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth;
  return { title: box(title), form: box(form), side: box(document.querySelector("[data-page-side]")), lit, cls, shifts, sideways: wide > 1 ? wide : 0 };
}

const report = {};
for (const size of SIZES) {
  if (sizes.length && !sizes.includes(size.name)) continue;
  for (const lang of langs) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
      userAgent: size.mobile ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" : undefined,
    });
    if (local) await context.route("**/api/**", fromSource);
    await context.addInitScript(WATCH);
    const page = await context.newPage();
    for (const [name, where] of SCREENS) {
      if (only.length && !only.includes(name)) continue;
      const tag = `${size.name}-${lang}-${name}`;
      try {
        const join = where.includes("?") ? "&" : "?";
        await page.goto(`${base}${where}${join}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector("[data-page-head]", { state: "attached", timeout: 60_000 }).catch(() => {});
        await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(8000);
        await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 82 });
        const at = await page.evaluate(measure);
        report[tag] = { url: page.url(), ...at };
        console.log(tag, JSON.stringify({ title: at.title?.x, form: at.form?.x, side: at.side?.x, lit: at.lit, cls: at.cls }));
      } catch (error) {
        report[tag] = { error: String(error).slice(0, 300) };
        console.log(tag, "ERROR", String(error).slice(0, 200));
      }
    }
    // The home page's ready sentence «Find new coins»: where it leads, and what stands there.
    if (!only.length || only.includes("home")) {
      const tag = `${size.name}-${lang}-home`;
      try {
        await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector("[data-say]", { timeout: 60_000 });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 82 });
        const says = await page.$$eval("[data-say]", (els) => els.map((el) => `${el.getAttribute("data-say")}: ${el.textContent?.trim()}`));
        const scout = page.locator("[data-say='scout']");
        let led = null;
        if (await scout.count()) {
          await scout.first().click();
          await page.waitForURL((url) => !url.pathname.match(/^\/?$/), { timeout: 30_000 }).catch(() => {});
          await page.waitForTimeout(6000);
          led = page.url();
          await page.screenshot({ path: path.join(out, `${tag}-scout.jpg`), type: "jpeg", quality: 82 });
        }
        report[tag] = { says, led };
        console.log(tag, JSON.stringify({ says, led }));
      } catch (error) {
        report[tag] = { error: String(error).slice(0, 300) };
        console.log(tag, "ERROR", String(error).slice(0, 200));
      }
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "axis.json"), JSON.stringify({ base, report }, null, 2));
