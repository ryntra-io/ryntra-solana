// The bots' release check of 19.11 for the eyes: the Grid's starting band over 8 loads (half of them with the live
// market read held back 4 s, so the pool answers first — the order that left every level over the price), and whether
// the Ladder's and the Grid's form and action stand on the first screen at 1440×900, 1366×768, 1920×1080 and a 390
// phone. → <out>/*.jpg and <out>/fit.json.
//   node terminal/bots/fit-shots.mjs <out> [baseUrl] [source]
// `source` (ryntra.io) answers every `/api/**` of the local stand with its own origin. No wallet; nothing signs.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/bots-fit");
const base = process.argv[3] ?? "http://localhost:3338";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });
const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Every `/api/**` from the source; the live market read (`/api/city`) held back `hold` ms where asked. */
const route = (hold) => async (r) => {
  const request = r.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") return r.fulfill({ status: 204, body: "" });
  if (hold && url.pathname === "/api/city") await sleep(hold);
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: request.headers().accept ?? "*/*", origin: source, referer: `${source}/` } });
    return r.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return r.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
};

async function context(size, lang, hold = 0) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.mobile ? 2 : 1,
    isMobile: Boolean(size.mobile),
    hasTouch: Boolean(size.mobile),
    locale: lang === "uk" ? "uk-UA" : "en-US",
  });
  await ctx.route("**/api/**", route(hold));
  return ctx;
}

const report = { grid: [], fit: {} };

/* 1. The Grid's band, 8 loads at 1440×900: the fields every half second for 14 s — the first band, the last, the price. */
for (let load = 1; load <= 8; load += 1) {
  const hold = load % 2 === 0 ? 4000 : 0;
  const ctx = await context({ width: 1440, height: 900 }, "en", hold);
  const page = await ctx.newPage();
  await page.goto(`${base}/bots/grid?lang=en`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const seen = [];
  for (let tick = 0; tick < 28; tick += 1) {
    await sleep(500);
    const now = await page.evaluate(() => {
      const fields = [...document.querySelectorAll("[data-bot='grid'] input[type='text']")].map((el) => el.value);
      const head = document.querySelector("[data-grid-head]")?.textContent ?? "";
      const note = document.querySelector("[data-grid-desk-form] [role='status'], [data-grid-desk-form] p")?.textContent ?? "";
      return { fields, head, note };
    });
    const band = `${now.fields[1] ?? ""}–${now.fields[2] ?? ""}`;
    if (!seen.length || seen.at(-1).band !== band) seen.push({ at: (tick + 1) * 500, band, head: now.head.trim().slice(0, 40) });
  }
  await page.screenshot({ path: path.join(out, `grid-load${load}${hold ? "-held" : ""}.jpg`), type: "jpeg", quality: 80 });
  const last = seen.at(-1);
  const price = Number((last.head.match(/\$([\d.]+)/) ?? [])[1]);
  const [low, high] = last.band.split("–").map(Number);
  const inside = Number.isFinite(price) && low < price && price < high;
  report.grid.push({ load, held: hold, bands: seen, price, low, high, inside });
  console.log(`grid load ${load}${hold ? " (market held 4 s)" : ""}: ${seen.map((one) => `${one.at}ms ${one.band}`).join(" → ")} · price ${price} · ${inside ? "inside" : "OUTSIDE"}`);
  await ctx.close();
}

/* 2. The form and its action on the first screen: the Ladder and the Grid. */
const SIZES = [
  { name: "w1440x900", width: 1440, height: 900 },
  { name: "w1366x768", width: 1366, height: 768 },
  { name: "w1920", width: 1920, height: 1080 },
  { name: "phone", width: 390, height: 844, mobile: true },
];
for (const size of SIZES) {
  for (const lang of ["en", "uk"]) {
    const ctx = await context(size, lang);
    const page = await ctx.newPage();
    for (const [bot, action] of [["ladder", "[data-bot-connect],[data-bot-place],[data-bot-view]"], ["grid", "[data-grid-connect],[data-grid-place]"]]) {
      const tag = `${bot}-${size.name}-${lang}`;
      await page.goto(`${base}/bots/${bot}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector("[data-page-head]", { state: "attached", timeout: 60_000 }).catch(() => {});
      await sleep(8000);
      await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 82 });
      const at = await page.evaluate((sel) => {
        const box = (el) => (el ? Math.round(el.getBoundingClientRect().bottom + scrollY) : null);
        return {
          action: box(document.querySelector(sel)),
          form: box(document.querySelector("[data-grid-desk-form] > *, [data-bot-desk] > :nth-child(2) > *")),
          chart: box(document.querySelector("[data-grid-desk-chart] > *, [data-bot-desk] > :nth-child(1) > *")),
          height: innerHeight,
          sideways: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      }, action);
      const fits = size.mobile ? null : at.action !== null && at.action <= at.height;
      report.fit[tag] = { ...at, fits };
      console.log(tag, JSON.stringify(at), fits === null ? "" : fits ? "action on the first screen" : "ACTION BELOW THE FOLD");
    }
    await ctx.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "fit.json"), JSON.stringify({ base, report }, null, 2));
