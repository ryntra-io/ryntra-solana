// CITY-233 · the ladder before mainnet opens, at 1440×900 and 390×844 → <out>/<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open NEXT_PUBLIC_RYNTRA_CITY_LADDER=mainnet npm run dev -- -p 3137
//   node city/lib/bots/ladder-open-shots.mjs [out] [baseUrl]          LANGS=uk,en  SIZES=1440,390  STATES=sheet,view,my-bots
// States:
//   `sheet`   — a buy ladder's sheet before the signature on mainnet: the «Real SOL» chip and the network first in the
//               one line above «Place ladder» (on the phone also `sheet-start`, scrolled to the line and the action);
//   `view`    — «Place» tapped while this wallet's ladder from another device stands in the pool: one action, «View»;
//   `my-bots` — «My bots»: this browser's ladders (the «Finish» line starts with the network too), and a DLMM ladder read
//               from the chain whose first eight orders were taken back — «Part taken back — cancel the rest» under it,
//               its action «Cancel the rest» (`my-bots-rest`, scrolled to it).
// Every figure is a fixture (the review stand, `ladder-demo.ts`); the wallet is a public address seated in the store —
// no wallet, no key, nothing signs.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { botsDemo, chainDemo, sampleBars } from "./demo.ts";
import { laddersDemo, REVIEW_POOL, REVIEW_WALLET, statusAt } from "./ladder-demo.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-233");
const base = process.argv[3] ?? "http://localhost:3137";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const NET = "mainnet";
const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const STATES = process.env.STATES ? new Set(process.env.STATES.split(",")) : null;
const want = (state) => !STATES || STATES.has(state);
const H = 3_600_000;

const coin = (symbol) => {
  const t = SNAPSHOT.towers.find((x) => x.symbol === symbol && x.verified);
  return { mint: t.id, symbol: t.symbol, price: t.price };
};
const COINS = { sol: coin("SOL"), jup: coin("JUP"), bonk: coin("KMNO") };
const SOL_PRICE = COINS.sol.price;

/** Eleven order accounts of one DLMM ladder placed from the phone: more than one prompt takes back. */
const chainOrders = Array.from({ length: 11 }, (_, i) => `Chain${String(i).padStart(2, "0")}Order1Rev1ew111111111111111111111111`.slice(0, 44));

/** The Hangar's answer: the phone's ladder, three of its orders left after the first «Cancel». */
function chainAnswer(now) {
  const demo = chainDemo(COINS, now);
  const iso = (ms) => new Date(ms).toISOString();
  const ladder = {
    id: "ladder:dlmm:review-phone-ladder",
    kind: "ladder",
    venue: "meteora_dlmm",
    name: `${COINS.sol.symbol}/USDC`,
    status: "waiting",
    detail: null,
    vsHold: { usd: -0.18, pct: -0.4, from: iso(now - 5 * H), to: iso(now) },
    feesUsd: null,
    lastFill: null,
    filler: "pool_swaps",
    noRyntraSignature: true,
    legs: { total: 11, filled: 0, pending: 3, closed: 8 },
    refs: { orders: chainOrders, pool: REVIEW_POOL },
  };
  return { ...demo, wallet: REVIEW_WALLET, bots: [ladder, demo.bots[0]], issues: [] };
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const demo = laddersDemo(SOL_PRICE, Date.now(), NET);
    const answer = chainAnswer(Date.now());
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route("**/api/spot/candles?*", (route) => {
      const url = new URL(route.request().url());
      const t = SNAPSHOT.towers.find((x) => x.id === url.searchParams.get("mint"));
      if (!t) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      const bars = sampleBars(t.id, t.price, t.change24h, Math.floor(Date.now() / H) * H);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date().toISOString(), source: { label: "GeckoTerminal" } });
    });
    await context.route(/\/api\/bots\/ladder\?mint=/, (route) => {
      const mint = new URL(route.request().url()).searchParams.get("mint");
      return mint === COINS.sol.mint ? json(route, statusAt(SOL_PRICE, Date.now(), NET)) : json(route, { open: true, network: NET, venue: { venue: null, available: false, reason: "NO_POOL" }, pool: null, at: Date.now() });
    });
    await context.route("**/api/bots/ladder/orders", (route) => json(route, { network: NET, orders: demo.reads, prices: { [REVIEW_POOL]: demo.poolPrice }, at: Date.now() }));
    await context.route(/\/api\/bots\/hangar/, (route) => json(route, answer));
    await context.route("**/api/v1/assistant/bots", (route) => json(route, { error: { code: "UNAVAILABLE" } }, 503));

    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openBots === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 300_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    const win = page.locator("[data-window='bots']");
    await page.evaluate(() => window.__openBots("launch"));
    await win.first().waitFor({ timeout: 120_000 });
    await page.locator("[data-window='bots'] [data-tab]").first().waitFor({ timeout: 240_000 }).catch(async (error) => {
      if (process.env.DEBUG_SHOT) await page.screenshot({ path: process.env.DEBUG_SHOT, type: "jpeg", quality: 60 });
      throw error;
    });
    await page.waitForFunction(() => typeof window.__bots?.setState === "function" && typeof window.__ladder?.setState === "function" && typeof window.__botsWallet?.setState === "function", null, { timeout: 240_000 });
    const seed = botsDemo(COINS, Date.now());
    await page.evaluate(
      ({ seed, answer, ladders, wallet }) => {
        window.__bots.setState({ ...seed, bots: [], hydrated: true, page: { kind: "home" }, focus: null, notice: null, mint: null, chain: { status: "ready", wallet, answer: { ...answer, at: Date.now() } } });
        window.__ladder.setState({ ladders, hydrated: true, note: null, busy: null, shownCosts: null, elsewhere: null, rest: {}, cancelSent: {} });
        // A public address seated as the connected wallet: the window reads it, nothing can sign with it.
        window.__botsWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:mainnet"] }, holdings: null, holdingsRead: "none" });
      },
      { seed, answer, ladders: demo.ladders, wallet: REVIEW_WALLET },
    );
    /* Full screen, as the reviews of CITY-219 and CITY-231: a DOM click — the frame need not hold still for it. */
    await page.evaluate(() => document.querySelector("[data-window='bots'] button[aria-label='Full screen'], [data-window='bots'] button[aria-label='На весь екран']")?.click());
    await page.waitForTimeout(800);
    const shot = async (state) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      const file = `${state}-${lang}-${size.name}.jpg`;
      for (let tries = 1; ; tries += 1) {
        try {
          await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 300_000 });
          break;
        } catch (error) {
          if (tries >= 3) throw error;
          await page.waitForTimeout(5_000);
        }
      }
      report.push({ size: size.name, lang, state, file });
    };
    const scrollBody = (y) => page.locator("[data-window='bots'] [data-tab]").first().evaluate((el, y) => el.scrollTo(0, y), y);
    /* The line above the one action, brought into view on the phone. */
    const toStart = () => page.locator("[data-window='bots'] [data-live]").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    const openSheet = async () => {
      await page.evaluate(() => window.__openBots("launch"));
      await page.waitForFunction(() => Object.values(window.__bots.getState().paths).some((p) => p.status === "ready"), null, { timeout: 240_000 });
      await page.evaluate(() => {
        const t = window.__city.getState().snapshot.towers.find((x) => x.symbol === "SOL" && x.verified);
        window.__bots.getState().openKind("buyLadder", { mint: t.id, symbol: t.symbol, price: t.price });
        window.__bots.getState().setDraft({ ...window.__bots.getState().draft, amountUsd: 50 });
      });
      await page.locator("[data-ladder-place]").waitFor({ timeout: 60_000 });
    };

    if (want("sheet")) {
      await openSheet();
      await scrollBody(0);
      await shot("sheet");
      if (size.mobile) {
        await toStart();
        await shot("sheet-start");
        await scrollBody(0);
      }
    }
    if (want("view")) {
      await openSheet();
      /* What «Place» leaves when «My bots» holds this wallet's ladder from the phone in the pool. */
      await page.evaluate(({ pool, orders }) => window.__ladder.setState({ elsewhere: { pool, orders }, note: { kind: "elsewhere", at: Date.now() } }), { pool: REVIEW_POOL, orders: chainOrders.slice(8) });
      await page.locator("[data-ladder-view]").waitFor({ timeout: 60_000 });
      await toStart();
      await shot("view");
      await page.evaluate(() => window.__ladder.setState({ elsewhere: null, note: null }));
      await scrollBody(0);
    }
    if (want("my-bots")) {
      await page.evaluate(() => window.__bots.getState().go({ kind: "home" }));
      await page.evaluate(() => window.__openBots("hangar"));
      await page.locator("[data-chain-cancel]").first().waitFor({ timeout: 60_000 });
      /* The first «Cancel» took back eight of eleven: the bot says so, and its action is «Cancel the rest». The window lets
         a line go after 8 s, and a frame under software GL takes longer than that: the review holds the line in place. */
      await page.evaluate((id) => {
        const say = () => window.__ladder.setState({ note: { kind: "rest", at: Date.now(), bot: id } });
        window.__ladder.setState({ rest: { [id]: true } });
        say();
        window.__holdNote = setInterval(() => {
          if (window.__ladder.getState().note?.kind !== "rest") say();
        }, 250);
      }, answer.bots[0].id);
      await page.locator("[data-window='bots'] [data-chain] [data-kind='rest']").first().waitFor({ timeout: 60_000 });
      await scrollBody(0);
      await shot("my-bots");
      await page.locator(`[data-chain-cancel='${answer.bots[0].id}']`).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.locator("[data-window='bots'] [data-chain] [data-kind='rest']").first().waitFor({ timeout: 60_000 });
      await shot("my-bots-rest");
      await page.evaluate(() => clearInterval(window.__holdNote));
    }
    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
