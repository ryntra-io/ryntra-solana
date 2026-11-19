// One page for every section: every
// section's screen side by side — a desk 2560×1440, 1920×1080 and 1440×900, a phone 390×844, English and Ukrainian — and where its
// page stands, measured: the page's box, its head's line, the action panel and the side column.
//
//   node terminal/shell/page-shots.mjs <outDir> [base]        base defaults to http://localhost:3111
//
// Public pages only: no wallet is connected, nothing is signed. The report (`page.json`) holds every screen's boxes; on
// a desk every action page stands at the same place, as wide as the others, its head on the same line — the run lists
// every one that does not, and every phone that scrolls sideways.
//   ONLY=swap,launch-new — a few screens;  SIZES=ultra,wide,desk,phone;  LANGS=uk,en
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-311");
const base = process.argv[3] ?? "http://localhost:3111";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

/** Every section's screen: its name in the files, its address, the page's kind by the shared template, and the head's tab to
 *  press where the address does not name it. */
const SCREENS = [
  ["swap", "/swap", "action"],
  ["bridge", "/bridge", "action"],
  ["launch-new", "/launch", "action"],
  ["launch-mine", "/launch?tab=mine", "action"],
  ["launch-fresh", "/launch?tab=fresh", "action"],
  ["earn", "/earn", "action"],
  ["earn-staking", "/earn?tab=staking", "action"],
  ["earn-lending", "/earn?tab=lending", "action"],
  ["earn-mine", "/earn?tab=mine", "action"],
  ["agents", "/agent", "action"],
  // «Bots»: each bot a page of its own.
  ["bots-recurring", "/bots/recurring", "action"],
  ["bots-grid", "/bots/grid", "action"],
  ["bots-ladder", "/bots/ladder", "action"],
  ["bots-signals", "/bots/signals", "action"],
  ["portfolio", "/portfolio", "action"],
  ["market", "/", "desk"],
  ["market-saved", "/?tab=saved", "desk"],
  ["spot", "/coin/So11111111111111111111111111111111111111112", "desk"],
];
const SIZES = [
  { name: "ultra", width: 2560, height: 1440, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name) => (process.env[name] ?? "").split(",").filter(Boolean);
const only = list("ONLY");
const sizes = list("SIZES");
const langs = list("LANGS").length ? list("LANGS") : ["uk", "en"];

/** Runs in the page: where the page, its head, its action panel and its side column stand. */
function measure() {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const page = document.querySelector("[data-page]");
  const title = document.querySelector("[data-page-head] h1") ?? document.querySelector("main h1");
  const wide = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth;
  return {
    kind: page?.getAttribute("data-page") ?? null,
    page: box(page),
    head: box(document.querySelector("[data-page-head]")),
    title: box(title),
    titleText: title?.textContent?.trim() ?? null,
    main: box(document.querySelector("[data-page-main]")),
    side: box(document.querySelector("[data-page-side]")),
    sideways: wide > 1 ? wide : 0,
  };
}

const report = {};
const wrong = [];
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
    const page = await context.newPage();
    const seen = [];
    for (const [name, where, kind, tab] of SCREENS) {
      if (only.length && !only.includes(name)) continue;
      const tag = `${name}-${size.name}-${lang}`;
      try {
        const join = where.includes("?") ? "&" : "?";
        await page.goto(`${base}${where}${join}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForSelector("[data-terminal='rail'], [data-terminal='tabs']", { state: "attached", timeout: 60_000 }).catch(() => {});
        await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(4500);
        if (tab !== undefined && !size.mobile) {
          await page.locator("[data-page-head] [role='tab']").nth(tab).click();
          await page.waitForTimeout(800);
        }
        await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 80 });
        const at = await page.evaluate(measure);
        report[tag] = { url: page.url(), ...at };
        if (at.sideways) wrong.push(`${tag}: the page scrolls sideways by ${at.sideways}px`);
        if (!size.mobile && at.kind !== kind) wrong.push(`${tag}: the page is «${at.kind}», the template says «${kind}»`);
        if (!size.mobile && kind === "action") seen.push({ tag, ...at });
        console.log(tag, at.kind ?? "-", JSON.stringify({ page: at.page, title: at.title, main: at.main, side: at.side }));
      } catch (error) {
        report[tag] = { error: String(error).slice(0, 300) };
        wrong.push(`${tag}: ${String(error).slice(0, 160)}`);
        console.log(tag, "ERROR", String(error).slice(0, 200));
      }
    }
    // Every action page of one size stands at the same place: the page's left edge and width, the title's line.
    const first = seen.find((at) => at.page && at.title);
    for (const at of seen) {
      if (!first || !at.page || !at.title) continue;
      if (Math.abs(at.page.x - first.page.x) > 1 || Math.abs(at.page.w - first.page.w) > 1) wrong.push(`${at.tag}: the page stands at ${at.page.x}/${at.page.w}, ${first.tag} at ${first.page.x}/${first.page.w}`);
      if (Math.abs(at.title.y - first.title.y) > 1 || Math.abs(at.title.x - first.title.x) > 1) wrong.push(`${at.tag}: the title stands at ${at.title.x},${at.title.y}, ${first.tag} at ${first.title.x},${first.title.y}`);
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "page.json"), JSON.stringify({ base, wrong, report }, null, 2));
console.log(wrong.length ? `\n${wrong.length} wrong:\n${wrong.join("\n")}` : "\nevery action page stands at one place");
process.exitCode = wrong.length ? 1 : 0;
