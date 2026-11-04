// The agent with a budget in the bots window (CITY-174), at 1440×900 and 375×812 → <out>/mandate-<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet npm run dev -- -p 3137
//   node city/lib/bots/mandate-shots.mjs [out] [baseUrl]          LANGS=uk,en  SIZES=1440,375  STATES=start,details,working
// The window is opened as a person opens it: the Deck's «Agents», then «Bots». Every figure is a fixture: the city's
// read is the bundled snapshot, the engine's mandate status answers a working agent with 0,18 SOL left. The wallet is a
// public address seated in the store: no wallet, no key, nothing signs.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { botsDemo, chainDemo, sampleBars } from "./demo.ts";
import { REVIEW_WALLET } from "./ladder-demo.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-174");
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

/* A mandate as the window keeps it: public addresses from the devnet pass, the medium preset's numbers. */
const RECORD = {
  owner: REVIEW_WALLET,
  settings: "4GYqmkrEEs1x2SXaFMAh299dskoD5VWLDe4dVVbusQj2",
  vault: "XJsZYQmFpRi7ApQ942wQiJm5nGX3eef15n3385bKcP6",
  policy: "9XXWyBo6o6iEqY4R1uaf2MMKovJVCGBAXNxyTtTqv8V3",
  budget: "6KYi9ZNLkcyQR9Cf5UimuagUJcxMRPRqBdCoWfawSZNF",
  perTrade: "50000000",
  perDay: "250000000",
  expiresAt: String(Math.floor(Date.now() / 1000) + 29 * 86_400 + 3_600),
};

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const report = [];

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    const step = (what) => console.log(`${new Date().toISOString().slice(11, 19)} ${size.name} ${lang} ${what}`);
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") step(`console: ${m.text().slice(0, 200)}`);
    });
    page.on("requestfailed", (r) => step(`request failed: ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ""}`));
    page.on("pageerror", (e) => {
      errors.push(String(e));
      step(`page error: ${String(e).slice(0, 160)}`);
    });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    /* Every other engine read answers empty here: the dev server then compiles the page and the window, not dozens of
       routes the window does not need (in Playwright the route registered last wins). */
    await context.route("**/api/**", (route) => json(route, { error: { code: "STAND" } }, 404));
    await context.route(/\/api\/city(\?.*)?$/, (route) => json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date().toISOString(), source: "live" }));
    await context.route("**/api/spot/candles?*", (route) => {
      const url = new URL(route.request().url());
      const t = byId.get(url.searchParams.get("mint"));
      if (!t) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      const bars = sampleBars(t.id, t.price, t.change24h, Math.floor(Date.now() / 3_600_000) * 3_600_000);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date().toISOString(), source: { label: "GeckoTerminal" } });
    });
    await context.route(/\/api\/bots\/mandate\/status/, (route) => json(route, { network: "devnet", active: true, budgetLamports: "180000000" }));
    await context.route(/\/api\/bots\/hangar/, (route) => json(route, { ...chainDemo(COINS, Date.now()), wallet: REVIEW_WALLET, bots: [], issues: [] }));
    await context.route(/\/api\/bots\/ladder/, (route) => json(route, { error: { code: "LADDER_CLOSED" } }, 404));

    /* A dev server under load may give up on the window's chunk (ChunkLoadError after two minutes): the page is opened
       again, and by then the chunk is compiled. */
    for (let attempt = 1; ; attempt += 1) {
      step(`open the city (${attempt})`);
      await page.goto(`${base}/?quality=low&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForFunction(() => typeof window.__openBots === "function" && window.__city?.getState().snapshot.towers.length > 0, null, { timeout: 300_000 });
      await page.waitForTimeout(4_000);
      await page.evaluate(() => window.__quarter?.setState({ later: true }));
      step("the Deck's Agents, then Bots");
      await page.locator("[data-deck-place='agents']").click();
      await page.locator("[data-deck-tray='agents']").waitFor({ timeout: 30_000 });
      await page.locator("[data-deck-door='bots']").click();
      await page.locator("[data-window='bots']").first().waitFor({ timeout: 120_000 });
      step("the window's contents");
      try {
        await page.locator("[data-window='bots'] [data-tab]").first().waitFor({ timeout: 150_000 });
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
      }
    }
    await page.waitForFunction(() => typeof window.__bots?.setState === "function" && typeof window.__mandate?.setState === "function" && typeof window.__botsWallet?.setState === "function", null, { timeout: 900_000 });
    const seed = botsDemo(COINS, Date.now());
    const chain = chainDemo(COINS, Date.now());
    await page.evaluate(
      ({ seed, chain, wallet }) => {
        window.__bots.setState({ ...seed, hydrated: true, page: { kind: "home" }, focus: null, notice: null, mint: null, chain: { status: "ready", wallet: chain.wallet, answer: { ...chain, bots: [], issues: [] } } });
        window.__mandate.setState({ hydrated: true, records: {}, status: {}, busy: null, note: null, preset: "medium" });
        // A public address seated as the connected wallet: the window reads it, nothing can sign with it.
        window.__botsWallet.setState({ connection: { wallet: "Phantom", address: wallet, chains: ["solana:devnet"] }, holdings: null, holdingsRead: "none" });
      },
      { seed, chain, wallet: REVIEW_WALLET },
    );
    const shot = async (state) => {
      await page.waitForTimeout(1_200);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.waitForTimeout(400);
      const file = `mandate-${state}-${lang}-${size.name}.jpg`;
      for (let tries = 1; ; tries += 1) {
        try {
          await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 82, timeout: 180_000 });
          break;
        } catch (error) {
          if (tries >= 3) throw error;
          await page.waitForTimeout(5_000);
        }
      }
      report.push({ size: size.name, lang, state, file });
      step(`shot ${state}`);
    };
    await page.evaluate(() => window.__openBots("launch"));
    await page.locator("[data-mandate='start']").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: /^(Full screen|На весь екран)$/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(600);
    if (want("start")) await shot("start");
    if (want("details")) {
      await page.locator("[data-mandate] button[aria-expanded]").first().click();
      await shot("details");
      await page.locator("[data-mandate] button[aria-expanded]").first().click();
    }
    if (want("working")) {
      await page.evaluate((record) => window.__mandate.getState().keep(record), RECORD);
      await page.locator("[data-mandate='working']").waitFor({ timeout: 600_000 });
      await shot("working");
    }
    report.push({ size: size.name, lang, errors });
    await context.close();
  }
}

writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report.filter((r) => r.errors?.length), null, 2));
