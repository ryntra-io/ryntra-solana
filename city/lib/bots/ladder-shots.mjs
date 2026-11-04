// The ladder on devnet in the bots window (CITY-135), at 1440×900 and 375×812 → <out>/ladder-<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open NEXT_PUBLIC_RYNTRA_CITY_LADDER=devnet npm run dev -- -p 3137
//   node city/lib/bots/ladder-shots.mjs [out] [baseUrl]          LANGS=uk,en  SIZES=1440,375  STATES=buy,smart,hangar
// The window is opened as a person opens it: the Deck's «Agents», then «Bots». Every figure is a fixture: the city's
// read is the bundled snapshot, the candles the review's sample week (demo.ts), the engine's ladder answers the review
// stand (ladder-demo.ts) — a devnet SOL/USDC pool at the city's SOL price and three placed ladders. The wallet is a
// public address seated in the store: no wallet, no key, nothing signs.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { botsDemo, chainDemo, sampleBars } from "./demo.ts";
import { laddersDemo, REVIEW_WALLET, statusAt } from "./ladder-demo.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-135");
const base = process.argv[3] ?? "http://localhost:3137";
mkdirSync(out, { recursive: true });

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const ALL = [
  { name: "1440", width: 1440, height: 900, mobile: false },
  { name: "375", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const STATES = process.env.STATES ? new Set(process.env.STATES.split(",")) : null;
const want = (state) => !STATES || STATES.has(state);

const byId = new Map(SNAPSHOT.towers.map((t) => [t.id, t]));
const coin = (symbol) => {
  const t = SNAPSHOT.towers.find((x) => x.symbol === symbol && x.verified);
  return { mint: t.id, symbol: t.symbol, price: t.price };
};
const COINS = { sol: coin("SOL"), jup: coin("JUP"), bonk: coin("KMNO") };
const SOL_PRICE = COINS.sol.price;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const demo = laddersDemo(SOL_PRICE, Date.now());
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route("**/api/spot/candles?*", (route) => {
      const url = new URL(route.request().url());
      const t = byId.get(url.searchParams.get("mint"));
      if (!t) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      const bars = sampleBars(t.id, t.price, t.change24h, Math.floor(Date.now() / 3_600_000) * 3_600_000);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date().toISOString(), source: { label: "GeckoTerminal" } });
    });
    // The engine's ladder routes, as the review stand answers them: SOL has a devnet pool, other coins none.
    await context.route(/\/api\/bots\/ladder\?mint=/, (route) => {
      const mint = new URL(route.request().url()).searchParams.get("mint");
      return mint === COINS.sol.mint ? json(route, statusAt(SOL_PRICE, Date.now())) : json(route, { open: true, network: "devnet", venue: { venue: "trigger", available: false, reason: "MAINNET_ONLY" }, pool: null, at: Date.now() });
    });
    await context.route("**/api/bots/ladder/orders", (route) => json(route, { network: "devnet", orders: demo.reads, prices: { [demo.ladders[0].pool]: demo.poolPrice }, at: Date.now() }));
    // The review wallet runs nothing on mainnet: the engine's Hangar answers it empty.
    await context.route(/\/api\/bots\/hangar/, (route) => json(route, { ...chainDemo(COINS, Date.now()), wallet: REVIEW_WALLET, bots: [], issues: [] }));

    await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => typeof window.__openBots === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 300_000 });
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.__quarter?.setState({ later: true }));
    const win = page.locator("[data-window='bots']");
    await page.locator("[data-deck-place='agents']").click();
    await page.locator("[data-deck-tray='agents']").waitFor({ timeout: 30_000 });
    await page.locator("[data-deck-door='bots']").click();
    await win.first().waitFor({ timeout: 120_000 });
    await page.locator("[data-window='bots'] [data-tab]").first().waitFor({ timeout: 240_000 });
    await page.waitForFunction(() => typeof window.__bots?.setState === "function" && typeof window.__ladder?.setState === "function" && typeof window.__botsWallet?.setState === "function", null, { timeout: 240_000 });
    const seed = botsDemo(COINS, Date.now());
    const chain = chainDemo(COINS, Date.now());
    await page.evaluate(
      ({ seed, chain, ladders, wallet }) => {
        window.__bots.setState({ ...seed, hydrated: true, page: { kind: "home" }, focus: null, notice: null, mint: null, chain: { status: "ready", wallet: chain.wallet, answer: { ...chain, bots: [], issues: [] } } });
        window.__ladder.setState({ ladders, hydrated: true, note: null, busy: null, shownCosts: null });
        // A public address seated as the connected wallet: the window reads it, nothing can sign with it.
        window.__botsWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:devnet"] }, holdings: null, holdingsRead: "none" });
      },
      { seed, chain, ladders: demo.ladders, wallet: REVIEW_WALLET },
    );
    // The connected wallet would normally refresh its own balances: the review has none to read.
    const shot = async (state) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      const file = `ladder-${state}-${lang}-${size.name}.jpg`;
      for (let tries = 1; ; tries += 1) {
        try {
          await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 80, timeout: 180_000 });
          break;
        } catch (error) {
          if (tries >= 3) throw error;
          await page.waitForTimeout(5_000);
        }
      }
      report.push({ size: size.name, lang, state, file });
    };
    const act = (fn, arg) => page.evaluate(fn, arg);
    let fullDone = false;
    const full = async () => {
      if (fullDone) return;
      fullDone = true;
      await page.getByRole("button", { name: /^(Full screen|На весь екран)$/ }).first().click();
      await page.waitForTimeout(600);
    };
    const scrollBody = (y) => page.locator("[data-window='bots'] [data-tab]").first().evaluate((el, y) => el.scrollTo(0, y), y);
    const openKind = async (kind) => {
      await act(() => window.__openBots("launch"));
      await page.waitForFunction(() => Object.values(window.__bots.getState().paths).some((p) => p.status === "ready"), null, { timeout: 240_000 });
      await act((kind) => {
        const t = window.__city.getState().snapshot.towers.find((x) => x.symbol === "SOL" && x.verified);
        window.__bots.getState().openKind(kind, { mint: t.id, symbol: t.symbol, price: t.price });
      }, kind);
      await page.locator("[data-ladder-place]").waitFor({ timeout: 60_000 });
      await full();
    };

    if (want("buy")) {
      await openKind("buyLadder");
      await shot("buy");
      if (size.mobile) {
        await scrollBody(4_000);
        await shot("buy-start");
        await scrollBody(0);
      }
    }
    if (want("smart")) {
      await openKind("smartDca");
      if (size.mobile) await scrollBody(560);
      await shot("smart");
      if (size.mobile) {
        await scrollBody(4_000);
        await shot("smart-start");
        await scrollBody(0);
      }
    }
    if (want("exit")) {
      await openKind("exitLadder");
      await shot("exit");
    }
    if (want("hangar")) {
      await act(() => window.__bots.getState().go({ kind: "home" }));
      await act(() => window.__openBots("hangar"));
      await full();
      await page.locator("[data-ladders] [data-ladder]").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      await shot("hangar");
      if (size.mobile) {
        await scrollBody(520);
        await shot("hangar-more");
        await scrollBody(0);
      }
    }
    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
