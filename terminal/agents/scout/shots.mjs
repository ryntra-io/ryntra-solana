// The Scout for the eyes, at 1920×1080, 1440×900 and 390×844, in English and Ukrainian → <out>/<state>-<size>-<lang>.jpg and
// <out>/report.txt.
//   node terminal/agents/scout/shots.mjs [out] [baseUrl]
// A stand with the terminal on (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). SIZES=desk,phone and LANGS=en,uk narrow a run.
//
// Every read answers from recorded shapes: the Scout's view (`/api/v1/scout`) is the engine's own desk — positions
// opened and marked by `lib/scout/paper.ts`, decisions as the journal writes them — and its checks of the market's «New»
// column are the coins of the recorded Pulse (`terminal/market/fixtures/pulse-2026-11-17.json`). Any other call answers
// 503. Nothing is signed or sent.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { markPosition, openPosition } from "../../../lib/scout/paper.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/scout");
const base = process.argv[3] ?? "http://localhost:3392";
mkdirSync(out, { recursive: true });

const SOL = 1_000_000_000n;
const NOW = Date.now();
const MIN = 60_000;
const SIZES = [
  { name: "desk", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

/** Made-up coins with made-up addresses: the Scout's paper desk, as the engine marks it. */
const coin = (symbol, seed) => ({ symbol, mint: `${seed}${"1".repeat(44 - seed.length)}`.slice(0, 44) });
const A = coin("LANTERN", "Lant3rn");
const B = coin("QUILL", "Qui11x");
const C = coin("MOSSY", "Mossyz");
const D = coin("RIVET", "Rivetz");

function position(c, openedMinAgo, why, marks) {
  let p = openPosition({ mint: c.mint, symbol: c.symbol, icon: null, at: NOW - openedMinAgo * MIN, price: 0.0003, solUsd: 142, lamports: SOL / 10n, liquidityUsd: 60_000, feeBps: 100, why, shape: "crowd", invalidation: "volume_fades" });
  for (const [minAgo, ratio, fade] of marks) p = markPosition(p, { at: NOW - minAgo * MIN, price: 0.0003 * ratio, volumeH1Usd: fade ? 500 : 60_000, volumeH6Usd: 200_000, solUsd: 142 });
  return p;
}

const open = [position(A, 40, ["many_traders", "organic_buyers", "holders_spread"], [[20, 1.12], [2, 1.21]]), position(B, 300, ["volume_rising", "buyers_outnumber_sellers"], [[240, 2.1], [3, 1.62]])];
const closed = [position(D, 900, ["liquidity_deep", "many_traders"], [[860, 1.15], [800, 1.18, true]]), position(C, 1500, ["volume_rising"], [[1480, 0.92], [1460, 0.6]])];

const decision = (c, minAgo, stage, outcome, codes, extra = {}) => ({ at: NOW - minAgo * MIN, mint: c.mint, symbol: c.symbol, stage, outcome, codes, ...extra });
const VIEW = {
  on: true,
  observedAt: new Date(NOW).toISOString(),
  pass: { at: NOW - 2 * MIN, seen: 128, screened: 6, took: 0 },
  open,
  closed,
  decisions: [
    decision(coin("HARBOR", "Harb0r"), 2, "chain", "refused", ["top1", "top10"]),
    decision(coin("PEBBLE", "Pebb1e"), 7, "thesis", "watch", ["volume_rising", "too_young"]),
    decision(coin("HANDS", "Hands"), 12, "chain", "refused", ["launch_buyers", "bundles"]),
    decision(coin("KELP", "Ke1p"), 14, "chain", "refused", ["creator_share", "holders_unread"]),
    decision(coin("DRIFT", "Drift"), 16, "chain", "refused", ["holders_unread"]),
    decision(coin("TALLOW", "Ta11ow"), 18, "chain", "refused", ["holders_unread"]),
    decision(A, 40, "paper", "took", ["many_traders", "organic_buyers"]),
    decision(coin("GREYFOX", "Grey"), 55, "thesis", "skip", ["bot_trading", "few_traders"]),
    decision(B, 240, "paper", "half", ["half"]),
    decision(D, 800, "paper", "closed", ["fade"], { resultPct: 12.4 }),
    decision(C, 1460, "paper", "closed", ["stop"], { resultPct: -41.2 }),
  ],
  refusals: [["volume", 61], ["liquidity", 44], ["age_young", 30], ["trades", 22]],
};

/** The recorded Pulse, and a check of each of its new coins the way the Scout's journal leaves them. */
const PULSE = JSON.parse(readFileSync(new URL("../../market/fixtures/pulse-2026-11-17.json", import.meta.url), "utf8"));
const CYCLE = [
  { stage: "screen", outcome: "refused", codes: ["liquidity"] },
  { stage: "screen", outcome: "refused", codes: ["age_young", "volume"] },
  { stage: "chain", outcome: "refused", codes: ["top1"] },
  { stage: "thesis", outcome: "watch", codes: ["volume_rising"] },
  { stage: "screen", outcome: "refused", codes: ["mint_on"] },
  { stage: "paper", outcome: "took", codes: ["many_traders"] },
];
const CHECKS = Object.fromEntries(PULSE.new.map((row, index) => [row.mint, { at: NOW - index * MIN, ...CYCLE[index % CYCLE.length] }]));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const report = [];
const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv" });
    await context.route("**/api/**", (route) => json(route, {}, 503));
    await context.route("**/api/icon/**", (route) => route.fulfill({ status: 204, body: "" }));
    await context.route("**/api/spot/icon*", (route) => route.fulfill({ status: 204, body: "" }));
    await context.route("**/api/v1/scout*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("part") === "checks") return json(route, { on: true, checks: CHECKS });
      return json(route, VIEW);
    });
    await context.route("**/api/spot/pulse*", (route) => {
      const feed = new URL(route.request().url()).searchParams.get("feed") ?? "new";
      return json(route, { ok: true, feed, rows: PULSE[feed] ?? [] });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|503|404/.test(message.text())) errors.push(message.text().slice(0, 160));
    });
    const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);
    const overflow = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    const ambers = () => page.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => getComputedStyle(b).backgroundImage.includes("gradient") && b.offsetParent).length);
    const shot = async (name, { full = false } = {}) => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.screenshot({ path: file(name), type: "jpeg", quality: 82, fullPage: full });
      report.push(`${size.name}/${lang} ${name}: amber ${await ambers()}; overflow ${await overflow()}px${errors.length ? `; errors ${JSON.stringify(errors)}` : ""}`);
    };
    const go = async (address, budget = null) => {
      await page.goto(`${base}/agent?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 }).catch(() => {});
      await page.evaluate((kept) => {
        try {
          if (kept) localStorage.setItem("ryntra.scout.paper.v1", JSON.stringify(kept));
          else localStorage.removeItem("ryntra.scout.paper.v1");
        } catch {
          /* storage blocked */
        }
      }, budget);
      await page.goto(`${base}${address}${address.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForTimeout(3000);
    };

    await go("/agent?ai=scout");
    await shot("scout");
    await shot("scout-full", { full: true });
    await go("/agent?ai=scout", { perDay: String(5n * SOL), perTrade: String(SOL / 2n), started: true });
    await shot("scout-started");
    if (!size.mobile) {
      const info = page.locator("[data-scout-row], [role='row']").nth(1).locator("button[aria-expanded]").first();
      await info.click().catch(() => {});
      await shot("scout-details");
    }
    await go("/agent");
    await shot("analyst-tabs");
    await go("/");
    await page.locator("[data-terminal='pulse']").scrollIntoViewIfNeeded().catch(() => {});
    if (size.mobile) await page.getByRole("tab", { name: uk ? "Нові" : "New" }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot("market-new");
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
