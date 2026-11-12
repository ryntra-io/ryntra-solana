// CITY-231 · «My bots» with «Cancel» on the DLMM bots read from the chain, at 1440×900 and 390×844 → <out>/<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open NEXT_PUBLIC_RYNTRA_CITY_LADDER=mainnet npm run dev -- -p 3137
//   node city/lib/bots/take-back-shots.mjs [out] [baseUrl]          LANGS=uk,en  SIZES=1440,390
// The window is opened as a person opens it: the Deck's «Agents», then «Bots», then «My bots». This browser keeps no
// ladder at all (another device, the app, a cleared browser): what the window shows is the engine's Hangar read of the
// wallet on chain — a DLMM ladder part filled and a DLMM limit filled, each with «Cancel», beside bots that have no
// cancel here (a grid position, a Jupiter ladder). Every figure is a fixture; the wallet is a public address seated in
// the store — no wallet, no key, nothing signs. States: `chain` (the buttons), `chain-done` (the answer under a bot).
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { botsDemo, chainDemo, sampleBars } from "./demo.ts";
import { REVIEW_WALLET } from "./ladder-demo.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-231");
const base = process.argv[3] ?? "http://localhost:3137";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "uk,en").split(",");

const coin = (symbol) => {
  const t = SNAPSHOT.towers.find((x) => x.symbol === symbol && x.verified);
  return { mint: t.id, symbol: t.symbol, price: t.price };
};
const COINS = { sol: coin("SOL"), jup: coin("JUP"), bonk: coin("KMNO") };
const H = 3_600_000;

/** The Hangar's answer for the review wallet: two DLMM bots that take «Cancel», and two that do not. */
function chainAnswer(now) {
  const demo = chainDemo(COINS, now);
  const iso = (ms) => new Date(ms).toISOString();
  const receipt = (signature) => `https://solscan.io/tx/${signature}`;
  const ladder = {
    id: "ladder:dlmm:review-dlmm-ladder",
    kind: "ladder",
    venue: "meteora_dlmm",
    name: `${COINS.sol.symbol}/USDC`,
    status: "partial",
    detail: null,
    vsHold: { usd: 0.42, pct: 1.1, from: iso(now - 30 * H), to: iso(now) },
    feesUsd: null,
    lastFill: { at: iso(now - 3 * H), signature: "review-sig-dlmm-1", receipt: receipt("review-sig-dlmm-1") },
    filler: "pool_swaps",
    noRyntraSignature: true,
    legs: { total: 4, filled: 2, pending: 2, closed: 0 },
    refs: { orders: ["7rJQ8wM1nV7mL3dZ5pY2kF4hT9sX6cB8aE1uG3qW5zRk", "9hKd2Lp4Qm7Xs1Vb6Nc3Rf8Tg5Wy2Za4Je7Ui9Oa1Pb3"], pool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6" },
  };
  const limit = {
    id: "limit:dlmm:review-dlmm-limit",
    kind: "limit",
    venue: "meteora_dlmm",
    name: `${COINS.jup.symbol}/USDC`,
    status: "needs_you",
    detail: "claim_waiting",
    vsHold: null,
    feesUsd: null,
    lastFill: { at: iso(now - 9 * H), signature: "review-sig-dlmm-2", receipt: receipt("review-sig-dlmm-2") },
    filler: "pool_swaps",
    noRyntraSignature: true,
    legs: null,
    refs: { orders: ["3fWq9Zt5Kc2Lm8Np4Rx7Vb1Hy6Jd3Gs5Ae9Uk2Oi7Tq4"] },
  };
  return { ...demo, bots: [ladder, limit, demo.bots[0], demo.bots[1]], issues: [] };
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const answer = chainAnswer(Date.now());
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route("**/api/spot/candles?*", (route) => {
      const url = new URL(route.request().url());
      const t = SNAPSHOT.towers.find((x) => x.id === url.searchParams.get("mint"));
      if (!t) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      const bars = sampleBars(t.id, t.price, t.change24h, Math.floor(Date.now() / H) * H);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date().toISOString(), source: { label: "GeckoTerminal" } });
    });
    await context.route(/\/api\/bots\/ladder\?mint=/, (route) => json(route, { open: true, network: "mainnet", venue: { venue: null, available: false, reason: "NO_POOL" }, pool: null, at: Date.now() }));
    await context.route(/\/api\/bots\/hangar/, (route) => json(route, answer));
    /* The assistant reads the review wallet's real (empty) chain: in the review its line stays out, not a wrong one. */
    await context.route("**/api/v1/assistant/bots", (route) => json(route, { error: { code: "UNAVAILABLE" } }, 503));

    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openBots === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 300_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    const win = page.locator("[data-window='bots']");
    /* The window's own door (the Deck's «Agents» → «Bots» opens it the same way): under software GL the Deck's clicks
       wait long for a still frame, so the review opens it directly. */
    await page.evaluate(() => window.__openBots("hangar"));
    await win.first().waitFor({ timeout: 120_000 });
    await page.locator("[data-window='bots'] [data-tab]").first().waitFor({ timeout: 240_000 }).catch(async (error) => {
      if (process.env.DEBUG_SHOT) await page.screenshot({ path: process.env.DEBUG_SHOT, type: "jpeg", quality: 60 });
      throw error;
    });
    await page.waitForFunction(() => typeof window.__bots?.setState === "function" && typeof window.__ladder?.setState === "function" && typeof window.__botsWallet?.setState === "function", null, { timeout: 240_000 });
    const seed = botsDemo(COINS, Date.now());
    await page.evaluate(
      ({ seed, answer, wallet }) => {
        /* No practice bots and no ladder kept in this browser: «My bots» is the chain's read alone. */
        window.__bots.setState({ ...seed, bots: [], hydrated: true, page: { kind: "home" }, focus: null, notice: null, mint: null, chain: { status: "ready", wallet, answer } });
        window.__ladder.setState({ ladders: [], hydrated: true, note: null, busy: null, shownCosts: null });
        window.__botsWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
      },
      { seed, answer, wallet: REVIEW_WALLET },
    );
    await page.evaluate(() => window.__openBots("hangar"));
    await page.locator("[data-chain-cancel]").first().waitFor({ timeout: 60_000 });
    /* Full screen, as the review of CITY-219: a DOM click — the frame need not hold still for it. */
    await page.evaluate(() => document.querySelector("[data-window='bots'] button[aria-label='Full screen'], [data-window='bots'] button[aria-label='На весь екран']")?.click());
    await page.waitForTimeout(1_500);
    const shot = async (state) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      const file = `${state}-${lang}-${size.name}.jpg`;
      await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 300_000 });
      const buttons = await page.locator("[data-chain-cancel]").count();
      report.push({ size: size.name, lang, state, file, buttons });
    };
    await shot("my-bots-chain");
    /* The answer of a «Cancel» that went through, said under that bot. */
    await page.evaluate((id) => window.__ladder.setState({ note: { kind: "cancelled", at: Date.now(), bot: id } }), answer.bots[0].id);
    await page.locator("[data-window='bots'] [data-chain] [data-kind='cancelled']").first().waitFor({ timeout: 60_000 });
    await shot("my-bots-chain-done");
    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
