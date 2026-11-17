// The screens for review — «Buy cheaper · Sell higher» in the coin's window — at 390×844 and 1440×900
// → <out>/<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS=mainnet npm run dev     then     node city/lib/trade/ladder-shots.mjs [out] [baseUrl]
// No wallet and no keys: a stub wallet registers through the Wallet Standard events (it signs nothing real) and the
// ladder's routes answer with a market, quotes, Reviews and orders shaped as the engine shapes them
// (`lib/pro-limits/service.ts`). The figures here are fixtures: the path itself — the program's own bytes, every atom
// held to what was told — is the rehearsal's (`scripts/launch-qa/`), not this script's.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/ladder-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const SYMBOL = process.env.COIN ?? "POPCAT";
const LANG = process.env.LANG_CITY ?? "en";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const AGENT = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const REFERRAL = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const POOL = "FhUzUF3h14y39nD2vdVkyREijM4kWj5nemFU3njwb8cQ";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
const solUsd = snapshot.towers.find((t) => t.id === SOL_MINT)?.price ?? 160;
const COIN_DECIMALS = 9;
const PRICE = tower.price / solUsd;

const MARKET = {
  network: "mainnet",
  pool: POOL,
  coin: { mint: tower.id, decimals: COIN_DECIMALS },
  quote: { mint: SOL_MINT, symbol: "SOL", decimals: 9 },
  price: PRICE,
  bonus: { feeBps: 100, ownerBps: 40, referralBps: 10 },
  reach: { buyBps: 9_900, sellBps: 990_000 },
  placing: true,
  collector: AGENT,
  cap: { maxRaw: "1000000000", minRungRaw: "2000000" },
};

/** A ladder as `/api/v1/ladders/quote` answers it: prices a per cent apart at the nearest, evenly to the farthest. */
function quoteOf({ action, farBps, rungs, amountRaw }) {
  const count = rungs ?? Math.min(25, Math.max(1, Math.floor(farBps / 100)));
  const total = BigInt(amountRaw);
  const each = total / BigInt(count);
  const list = Array.from({ length: count }, (_, at) => {
    const awayBps = count === 1 ? farBps : Math.round(100 + (at * (farBps - 100)) / (count - 1));
    const price = PRICE * (action === "buy" ? 1 - awayBps / 10_000 : 1 + awayBps / 10_000);
    const pays = action === "buy" ? (Number(each) / 1e9 / price) * 10 ** COIN_DECIMALS : (Number(each) / 10 ** COIN_DECIMALS) * price * 1e9;
    return { awayBps, price, amountRaw: each.toString(), paysRaw: BigInt(Math.floor(pays)).toString() };
  });
  const pays = list.reduce((sum, rung) => sum + BigInt(rung.paysRaw), 0n);
  const rests = each * BigInt(count);
  const average = action === "buy" ? Number(rests) / 1e9 / (Number(pays) / 10 ** COIN_DECIMALS) : Number(pays) / 1e9 / (Number(rests) / 10 ** COIN_DECIMALS);
  return {
    market: MARKET,
    action,
    restsIn: action === "buy" ? SOL_MINT : tower.id,
    paysIn: action === "buy" ? tower.id : SOL_MINT,
    rungs: list,
    amountRaw: rests.toString(),
    paysRaw: pays.toString(),
    averagePrice: average,
    nearBps: list[0].awayBps,
    farBps: list.at(-1).awayBps,
    corridorBps: 100,
    bonus: { feeBps: 100, ownerBps: 40, referralBps: 10, referral: REFERRAL, feeIn: SOL_MINT },
  };
}

const WIRE = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SIGNATURE = "5vZ8cJ2u2zT6mXqWQh8m3y1Hc7m9u5QnYbN2y6RkS4wV7fWJdC1bXgF3zH8aK9pLm2nQ4rS6tU8vW1xY3zA5bC7d";
const NEW_ORDER = "7Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S";

const order = (nftMint, fields) => ({
  nftMint,
  pool: POOL,
  coin: MARKET.coin,
  quote: { mint: SOL_MINT, decimals: 9 },
  restsIn: fields.action === "sell" ? tower.id : SOL_MINT,
  paysIn: fields.action === "sell" ? SOL_MINT : tower.id,
  lowPrice: null,
  highPrice: null,
  filledPrice: null,
  bonus: { mint: SOL_MINT, ownerRaw: "0", referralRaw: "0" },
  agent: false,
  agentReady: false,
  agentOffered: true,
  partialPrices: 0,
  ...fields,
});

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1440, height: 900, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: LANG === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = async (state) => {
    await page.screenshot({ path: path.join(out, `${state}-${LANG}-${size.name}.jpg`), type: "jpeg", quality: 84 });
    console.log(`  ${state}-${LANG}-${size.name}`);
  };

  await page.addInitScript(({ taker, lang }) => {
    try {
      localStorage.setItem("ryntra.city.lang", lang);
    } catch {}
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    let release = null;
    window.__releaseSignature = () => release?.();
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs) => {
            await new Promise((resolve) => (release = resolve));
            return inputs.map(({ transaction }) => {
              const signed = new Uint8Array(transaction);
              signed.fill(7, 1, 65);
              return { signedTransaction: signed };
            });
          },
        },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: TAKER, lang: LANG });

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, {
      data: {
        tokenRead: "COMPLETE",
        holdings: [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9, symbol: "SOL" },
          { kind: "TOKEN", mint: USDC_MINT, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6, catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
          { kind: "TOKEN", mint: tower.id, amountRaw: "2400000000000", spendableRaw: "2400000000000", decimals: COIN_DECIMALS, catalog: { symbol: SYMBOL, name: tower.name, isVerified: true } },
        ],
      },
    }),
  );
  await page.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/solana/swap/quote", (route) => json(route, 503, { error: { code: "UNAVAILABLE", message: "A stand without the swap engine." } }));

  // The ladders' lane.
  let placed = null;
  await page.route("**/api/v1/ladders/market?*", (route) => json(route, 200, { market: MARKET }));
  await page.route("**/api/v1/ladders/quote", async (route) => {
    const { intent } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 250));
    json(route, 200, quoteOf(intent));
  });
  await page.route("**/api/v1/ladders/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 600));
    const quote = body.action === "place" ? quoteOf(body.intent) : null;
    json(route, 200, {
      action: body.action,
      network: "mainnet",
      transactions: [WIRE],
      ticket: "t".repeat(48),
      expiresAt: Date.now() + 25_000,
      nftMint: body.nftMint ?? NEW_ORDER,
      networkFeeLamports: "15000",
      rentLamports: quote ? String(6_157_000 + 935_000 * quote.rungs.length) : "0",
      accountsLamports: "0",
      quote,
      agent: body.agent === true,
      receives: quote ? null : { xRaw: "418000000000", yRaw: "0", x: tower.id, y: SOL_MINT },
      referral: null,
    });
    if (body.action === "place") placed = { quote, agent: body.agent === true };
  });
  await page.route("**/api/v1/ladders/submit", (route) => json(route, 200, { action: "place", nftMint: NEW_ORDER, results: [{ signature: SIGNATURE, state: "LANDED" }], settled: true }));
  await page.route("**/api/v1/ladders/orders?*", (route) => {
    const orders = [];
    if (placed) orders.push(order(NEW_ORDER, { action: placed.quote.action, state: "resting", prices: placed.quote.rungs.length, filledPrices: 0, restsRaw: placed.quote.amountRaw, filledRaw: "0", proceedsRaw: "0", lowPrice: Math.min(...placed.quote.rungs.map((r) => r.price)), highPrice: Math.max(...placed.quote.rungs.map((r) => r.price)), agent: placed.agent, agentReady: placed.agent }));
    orders.push(
      order("9Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S", { action: "buy", state: "filling", prices: 25, filledPrices: 6, restsRaw: "500000000", filledRaw: "120000000", proceedsRaw: BigInt(Math.floor((0.12 / (PRICE * 0.93)) * 10 ** COIN_DECIMALS)).toString(), lowPrice: PRICE * 0.7, highPrice: PRICE * 0.99, filledPrice: PRICE * 0.93, bonus: { mint: SOL_MINT, ownerRaw: "480000", referralRaw: "120000" }, agent: true, agentReady: true, partialPrices: 1 }),
      order("6Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S", { action: null, state: "taken", prices: 0, filledPrices: 0, restsRaw: "0", filledRaw: "0", proceedsRaw: "0", restsIn: null, paysIn: null, bonus: { mint: null, ownerRaw: "0", referralRaw: "0" } }),
    );
    json(route, 200, { owner: TAKER, orders });
  });

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 240_000 });
  await page.waitForFunction(() => Boolean(window.__trade), null, { timeout: 240_000 });
  await page.waitForTimeout(8000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const name of ["Got it", "Later", "Зрозуміло", "Пізніше"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count()) await button.first().click().catch(() => {});
  }
  await page.waitForTimeout(500);

  // The coin's window, as a person opens it; then the wallet.
  await page.evaluate(({ id, symbol, name }) => window.__trade.getState().openFor({ id, symbol, name, icon: null }, "buy", { view: "spot" }), { id: tower.id, symbol: SYMBOL, name: tower.name });
  await page.waitForTimeout(2500);
  /* The window is found by what is in it, not by its place among the page's dialogs. */
  const sheet = page;
  const connect = sheet.getByRole("button", { name: /Connect wallet|Підключити гаманець/ });
  if (await connect.count()) await connect.first().click();
  await page.waitForTimeout(3500);
  const panelLine = sheet.getByRole("button", { name: /Buy cheaper · Sell higher|Купити дешевше · Продати дорожче/ });
  /* A dev server compiles each route on its first call: the line is waited for, not assumed. */
  await panelLine.waitFor({ timeout: 240_000 }).catch(async (error) => {
    await shot("failed");
    console.log(JSON.stringify(await page.evaluate(() => ({ ladder: window.__ladder?.getState().market, trade: { open: window.__trade.getState().open, view: window.__trade.getState().view } }))));
    throw error;
  });
  await panelLine.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("line");

  // Unfolded: one slider, one amount, one button.
  await panelLine.click();
  await page.waitForTimeout(600);
  const panel = sheet.getByRole("region", { name: /Buy cheaper · Sell higher|Купити дешевше · Продати дорожче/ });
  await panel.getByRole("textbox").fill("0.5");
  await page.waitForTimeout(1200);
  await panel.scrollIntoViewIfNeeded();
  await shot("buy");
  // The slider moved by the keyboard: ten steps farther.
  const slider = panel.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("PageUp");
  await page.waitForTimeout(1200);
  await shot("buy-farther");
  await panel.getByRole("button", { name: /How the ladder works|Як працює драбина/ }).click();
  await page.waitForTimeout(400);
  await panel.getByRole("button", { name: /Place ladder|Поставити драбину/ }).scrollIntoViewIfNeeded();
  await shot("buy-details");
  await panel.getByRole("button", { name: /How the ladder works|Як працює драбина/ }).click();

  // The one approval, then the ladder among the wallet's ladders.
  await panel.getByRole("button", { name: /Place ladder|Поставити драбину/ }).click();
  await page.waitForTimeout(1500);
  await shot("wallet");
  await page.evaluate(() => window.__releaseSignature());
  await page.waitForTimeout(2500);
  await panel.scrollIntoViewIfNeeded();
  await shot("placed");
  await panel.getByText(/Order filled|Ордер виконано/).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("orders");

  // Selling higher: the same panel, by multiples.
  await panel.getByRole("button", { name: /Place another|Поставити ще/ }).click();
  await page.waitForTimeout(300);
  await panel.getByRole("tab", { name: /Sell higher|Продати дорожче/ }).click();
  await page.waitForTimeout(500);
  await panel.getByRole("button", { name: "50%" }).click();
  await page.waitForTimeout(1200);
  await panel.scrollIntoViewIfNeeded();
  await shot("sell");

  // A sentence, from the command line: the same panel filled in.
  await page.evaluate(() => window.__trade.getState().close?.());
  await page.keyboard.press("Control+K");
  await page.waitForTimeout(800);
  // A phone's keyboard waits for a tap on the field.
  await page.getByRole("combobox").last().click();
  await page.keyboard.type(LANG === "uk" ? `продай половину ${SYMBOL} на 2x` : `sell half ${SYMBOL} at 2x`);
  await page.waitForTimeout(900);
  await shot("sentence");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);
  await shot("sentence-filled");

  console.log(`${size.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 600) : ""}`);
  await context.close();
}
await browser.close();
