// Every read is answered
// from a fixture shaped as the engine answers (no network); no wallet, nothing signed or sent. PRESS_CHROME names the
// browser where the project's Playwright differs (/opt/pw-browsers/chromium).
//
// Measured: on a phone scrolled, whether anything of the page stands over the site's header (the header's own buttons
// are the topmost thing at their centre); the page never scrolls sideways; in each state, its words and its buttons.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-359-g8");
const base = process.argv[3] ?? "http://localhost:3184";
mkdirSync(out, { recursive: true });

const now = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;

/* The mints are the stand's own (base58, no real coin's) — the stock's is TSLAx's, as the stocks' stand uses it. */
const COINS = {
  pool: { mint: "CatmAr1o7k2YbKcQ4p1sVvGWa9xQeWvG816bUx9EPjp", symbol: "CATMARIO", name: "Cat Mario", price: 0.000614, supply: 998_000_000, category: "meme", verified: true, curve: null, dev: null, age: 41 * DAY, stock: false },
  curve: { mint: "KiteCurve7k2YbKcQ4p1sVvGWa9xQeWvG816bUx9EPjq", symbol: "KITE", name: "Kite Flyer", price: 0.0000412, supply: 1_000_000_000, category: "meme", verified: false, curve: { progressPct: 63.2, complete: false }, dev: "Crea7orStand1111111111111111111111111111111", age: 40 * MIN, stock: false },
  stock: { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", symbol: "TSLAx", name: "Tesla xStock", price: 398.2, supply: 1_200_000, category: "stock", verified: true, curve: null, dev: null, age: 200 * DAY, stock: true },
};

const stats = (pct, traders) => ({ priceChangePct: pct, volumeUsd: 12_500_000, buys: 9000, sells: 8000, traders });
const win = (pct) => ({ priceChangePct: pct, volumeUsd: 100_000, buyVolumeUsd: 60_000, sellVolumeUsd: 40_000, buys: 900, sells: 700, traders: 800, holderChangePct: 0.2, liquidityChangePct: -1.5 });
const marketOf = (coin) => ({
  mint: coin.mint, symbol: coin.symbol, name: coin.name, icon: null, decimals: 6, tokenProgram: null, verified: coin.verified, tags: [], category: coin.category, issuer: null,
  price: coin.price, change1hPct: 0.6, change24hPct: -7.44, volume24hUsd: 48_200_000, liquidityUsd: coin.curve ? 38_600 : 12_400_000,
  marketCapUsd: coin.price * coin.supply, fdvUsd: coin.price * coin.supply * 1.05, holders: coin.curve ? 214 : 15_500, organicScore: 80, organicScoreLabel: "high", firstPoolAt: new Date(now - coin.age).toISOString(),
  audit: { devBalancePct: coin.dev ? 4.1 : null, topHoldersPct: 26, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, suspicious: false },
  links: { website: null, twitter: null, telegram: null },
  stats: { h1: stats(0.6, 900), h24: stats(-7.44, 18_420) },
  updatedAt: new Date().toISOString(),
});
const factsOf = (coin) => ({ mint: coin.mint, circulatingSupply: coin.supply, totalSupply: coin.supply, dev: coin.dev, devMints: coin.dev ? 3 : null, devMigrations: coin.dev ? 1 : null, launchpad: coin.curve ? "pump.fun" : null, graduatedAt: null, createdAt: new Date(now - coin.age).toISOString(), socials: [], windows: { m5: win(0.1), h1: win(0.6), h6: win(-1.1), h24: win(-7.44) } });
const risk = [
  { code: "MINT_AUTHORITY", tone: "plain", state: "revoked", value: null, source: "jupiter" },
  { code: "TOP10", tone: "plain", state: null, value: 26, source: "jupiter" },
];
const WALLETS = ["WMmWq46Es1jh92dQQisAq662SmxELLLsHHe4YWWM", "MfDuWBqLq46Es1jh92dQQisAq662SmxELLLsHHGVWa", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"];
const LABELS = [["creator"], ["top-holder", "big"], ["fresh"], [], []];
const tradesOf = (coin) =>
  Array.from({ length: 30 }, (_, i) => {
    const usd = i % 5 === 0 ? 4_420.5 - i * 31 : 184.5 - i * 3;
    return { signature: `sig${coin.symbol}${i}`, at: new Date(now - i * 47_000).toISOString(), side: i % 3 === 0 ? "sell" : "buy", wallet: WALLETS[i % WALLETS.length], tokenAmount: usd / coin.price, usd, priceUsd: coin.price * (1 + ((i % 7) - 3) / 1000), capUsd: coin.stock ? null : coin.price * coin.supply, labels: LABELS[i % LABELS.length] };
  });
const holdersOf = () => Array.from({ length: 20 }, (_, i) => ({ owner: WALLETS[i % WALLETS.length], amount: 9_000_000 / (i + 1), sharePct: 12 / (i + 1), labels: i === 0 ? ["pool"] : [], change: null }));
const STEP = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 };
/* Bars back to the coin's first minute only: a coin forty minutes old has one bar of an hour. */
function candlesOf(coin, tf) {
  const step = STEP[tf] ?? 900;
  const last = Math.floor(now / 1000 / step) * step;
  const born = Math.floor((now - coin.age) / 1000);
  const bars = [];
  let close = coin.price;
  for (let i = 0; i < 160; i++) {
    const time = last - i * step;
    if (time + step < born) break;
    const open = close * (1 + Math.sin(i / 6) * 0.004 + ((i % 5) - 2) * 0.0008);
    bars.push({ time, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1000 + (i % 9) * 340 });
    close = open;
  }
  return { timeframe: tf, candles: bars.reverse(), observedAt: new Date().toISOString(), stale: false, pool: { name: `${coin.symbol} / SOL` }, source: { label: "GeckoTerminal" } };
}
const stockFacts = (coin) => ({ facts: { mint: coin.mint, isStock: true, kind: "share", issuer: { id: "xstocks", label: "xStocks · Backed Finance" }, session: "open", nextChangeAt: new Date(now + 4 * 3_600_000).toISOString(), dividendGuard: null, termsUrl: "https://assets.backed.fi/legal-documentation", powers: null, listed: null } });
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><circle cx="14" cy="14" r="14" fill="#5B5BD6"/></svg>';

const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => (process.env.SIZES ? process.env.SIZES.split(",").includes(size.name) : true));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const KEYS = (process.env.COINS ?? "pool,curve,stock").split(",").filter(Boolean);
const STATES = (process.env.STATES ?? "err,none,nopool,busy").split(",").filter(Boolean);
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};

/** The engine's answers for one coin; `state` bends some of them. */
async function answer(context, coin, state) {
  await context.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({ status: 503, body: "" }));
  await context.route("**/api/**", (route) => json(route, 503, {}));
  if (state === "err") return;
  await context.route("**/api/spot/icon?*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: ICON }));
  await context.route("**/api/icon/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: ICON }));
  await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  if (state === "none") {
    await context.route("**/api/v1/launch/**", (route) => json(route, 404, { error: { code: "NOT_FOUND" } }));
    await context.route("**/api/spot/market?*", (route) => json(route, 200, { market: null, observedAt: new Date().toISOString(), stale: false }));
    await context.route("**/api/solana/tokens/search?*", (route) => json(route, 200, { tokens: [] }));
    await context.route("**/api/city*", (route) => json(route, 200, { towers: [] }));
    return;
  }
  await context.route("**/api/spot/market?*", (route) => json(route, 200, { market: marketOf(coin) }));
  await context.route("**/api/v1/stocks/pool-facts?*", (route) => (coin.stock ? json(route, 200, stockFacts(coin)) : json(route, 200, { facts: { mint: coin.mint, isStock: false, issuer: null, session: "unknown", nextChangeAt: null, dividendGuard: null, termsUrl: null } })));
  await context.route("**/api/spot/candles?*", (route) => {
    if (state === "nopool") return json(route, 404, { error: { code: "CANDLES_NO_POOL", message: "No pool prices this asset on the chart source." } });
    if (state === "busy") return route.fulfill({ status: 429, contentType: "application/json", headers: { "retry-after": "3" }, body: JSON.stringify({ error: { code: "CANDLES_RATE_LIMITED" } }) });
    return json(route, 200, candlesOf(coin, new URL(route.request().url()).searchParams.get("tf")));
  });
  await context.route("**/api/spot/token?*", (route) => {
    const part = new URL(route.request().url()).searchParams.get("part");
    if (part === "overview") return json(route, 200, { facts: factsOf(coin) });
    if (part === "risk") return json(route, 200, { facts: risk });
    if (part === "trades") return state === "nopool" || state === "busy" ? json(route, 200, { trades: [] }) : json(route, 200, { trades: tradesOf(coin), marks: { creator: Boolean(coin.dev), topHolders: 10, bigTradeUsd: 1_000 } });
    if (part === "holders") return json(route, 200, { holders: holdersOf(), programPct: 12, supply: coin.supply });
    return json(route, 503, {});
  });
}

async function open(browser, size, lang, coin, state) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
  await context.addInitScript((lang) => {
    try {
      localStorage.setItem("ryntra.lang", lang);
      localStorage.setItem("city.lang", lang);
    } catch {}
  }, lang);
  await answer(context, coin, state);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
  await page.goto(`${base}/coin/${coin.mint}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 120_000 }).catch(() => {});
  return { context, page, errors };
}

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** On a phone scrolled: what stands topmost at the centre of each of the header's buttons — the header itself, or the page. */
const overHeader = (page) =>
  page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return "no header";
    const over = [];
    for (const el of header.querySelectorAll("button, a")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom <= 0) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && !header.contains(top)) over.push((top.textContent ?? "").trim().slice(0, 16) || top.tagName);
    }
    return over.length ? `page over the header: ${over.join(", ")}` : "header on top";
  });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME, args: ["--no-sandbox"] } : {});
for (const key of KEYS) {
  const coin = COINS[key];
  for (const size of SIZES) {
    for (const lang of LANGS) {
      const tag = `${key}-${size.name}-${lang}`;
      const { context, page, errors } = await open(browser, size, lang, coin, "live");
      await page.waitForTimeout(size.mobile ? 6000 : 7000);
      await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 80 });
      const frames = await page.evaluate(() => [...document.querySelectorAll('[role="radiogroup"] [role="radio"][aria-checked="true"]')].map((el) => el.textContent.trim()).join(" · "));
      say(`${tag}: sideways ${await sideways(page)}px; chosen ${frames || "—"}`);
      if (size.name === "desk") {
        // The trades' «i»: what the signs by the wallets mean (flaw 123).
        const why = page.getByRole("button", { name: lang === "uk" ? "Що означають значки" : "What the signs mean" }).first();
        if (await why.count()) {
          await why.click();
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(out, `${tag}-marks.jpg`), type: "jpeg", quality: 80 });
          say(`${tag} marks: ${(await page.locator('[class*="why"] li').allTextContents()).join(" · ") || "—"}`);
          await page.keyboard.press("Escape");
        } else say(`${tag} marks: no «i»`);
      }
      if (size.mobile) {
        for (const [i, y] of [[1, 260], [2, 620]]) {
          await page.evaluate((y) => window.scrollTo(0, y), y);
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(out, `${tag}-s${i}.jpg`), type: "jpeg", quality: 80 });
          say(`${tag}-s${i}: ${await overHeader(page)}`);
        }
      }
      say(`${tag} errors: ${errors.join(" | ") || "none"}`);
      await context.close();
    }
  }
}

const STATE_COIN = { err: COINS.pool, none: COINS.pool, nopool: COINS.curve, busy: COINS.curve };
const STATE_WAIT = { err: 9000, none: 7000, nopool: 9000, busy: 32_000 };
for (const state of STATES) {
  for (const size of SIZES.filter((s) => s.name !== "wide")) {
    for (const lang of LANGS) {
      const tag = `state-${state}-${size.name}-${lang}`;
      const { context, page, errors } = await open(browser, size, lang, STATE_COIN[state], state);
      await page.waitForTimeout(STATE_WAIT[state]);
      await page.screenshot({ path: path.join(out, `${tag}.jpg`), type: "jpeg", quality: 80 });
      const said = await page.evaluate(() => {
        const head = document.querySelector("[data-page-head] h1, [data-page-head]")?.textContent?.trim() ?? "";
        const chart = document.querySelector("[data-coin-chart-state]")?.textContent?.trim() ?? document.querySelector("[data-coin-chart-wait]")?.textContent?.trim() ?? "";
        const retry = [...document.querySelectorAll("[data-coin='retry-coin'], [data-coin='chart-retry']")].length;
        return { head: head.slice(0, 60), chart: chart.slice(0, 80), retry };
      });
      say(`${tag}: ${JSON.stringify(said)}; sideways ${await sideways(page)}px; errors: ${errors.join(" | ") || "none"}`);
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
