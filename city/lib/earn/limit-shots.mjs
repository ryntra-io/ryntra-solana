// Sell Higher · Buy Lower · the Wheel — screens for review (CITY-97), at 1440×900 and 375×812 → <out>/<state>-<size>-<lang>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS=open npm run dev, then:
//   LANG_EARN=en node city/lib/earn/limit-shots.mjs [out] [baseUrl]      (and LANG_EARN=uk)
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and never signs. The routes answer
// from fixtures — four markets with their pools' steps and prices, a Review shaped like the engine's, a wallet's orders
// (waiting, part filled, filled, and one set before a multiplier moved). The figures on these screens are fixtures; the
// live pass is the devnet script (`scripts/city/earn-limits-devnet.mjs`) and then the owner's own try.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";

import { binForTarget, binsFor, poolSide } from "./limit.ts";

/** A real-looking address from a word: fixtures only, nobody holds these keys. */
const addressOf = (word) => Keypair.fromSeed(createHash("sha256").update(`city-97:${word}`).digest()).publicKey.toBase58();

const out = path.resolve(process.argv[2] ?? "out/limit-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_EARN ?? "uk";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const POOLS = { sol: addressOf("pool-sol"), nvda: addressOf("pool-nvda"), tsla: addressOf("pool-tsla"), spy: addressOf("pool-spy") };

/** A market whose active bin stands at `perUnit` (in the quote) per unit the wallet shows. */
function market({ pool, asset, quote, step, perUnit, multiplier = 1, priceUsd, quoteUsd }) {
  const base = perUnit * multiplier;
  const raw = base * 10 ** (quote.decimals - asset.decimals);
  return {
    pool,
    asset,
    quote,
    assetIsX: true,
    binStepBps: step,
    activeBin: Math.round(Math.log(raw) / Math.log(1 + step / 10_000)),
    feeBps: step === 10 ? 4 : 30,
    multiplier: { current: multiplier, pending: null, effectiveAt: null },
    priceUsd,
    quoteUsd,
    at: new Date().toISOString(),
  };
}
const USDC_Q = { mint: USDC, symbol: "USDC", decimals: 6 };
const SOL_Q = { mint: SOL, symbol: "SOL", decimals: 9 };
const MARKETS = [
  market({ pool: POOLS.nvda, asset: { mint: NVDAX, symbol: "NVDAx", decimals: 8, kind: "stock", name: "NVIDIA" }, quote: USDC_Q, step: 20, perUnit: 187.42, multiplier: 1.0073, priceUsd: 187.42, quoteUsd: 1 }),
  market({ pool: POOLS.sol, asset: { mint: SOL, symbol: "SOL", decimals: 9, kind: "sol", name: null }, quote: USDC_Q, step: 10, perUnit: 186.4, priceUsd: 186.4, quoteUsd: 1 }),
  market({ pool: POOLS.tsla, asset: { mint: TSLAX, symbol: "TSLAx", decimals: 8, kind: "stock", name: "Tesla" }, quote: SOL_Q, step: 20, perUnit: 2.31, priceUsd: 430.6, quoteUsd: 186.4 }),
  market({ pool: POOLS.spy, asset: { mint: SPYX, symbol: "SPYx", decimals: 8, kind: "stock", name: "SPDR S&P 500" }, quote: USDC_Q, step: 20, perUnit: 671.3, multiplier: 1.0057, priceUsd: 671.3, quoteUsd: 1 }),
];
const [NVDA_M, SOL_M, TSLA_M] = MARKETS;

const amount = (units, decimals, asset) => ({ units: String(units), decimals, asset });
function order({ address, market: m, intent, target, depositUnits, filledBps, proceedsUnits }) {
  const side = poolSide(intent, m.assetIsX);
  const bin = binForTarget(m, intent, target);
  const bins = binsFor(side, bin, "one");
  const given = intent === "sell" ? m.asset : m.quote;
  const got = intent === "sell" ? m.quote : m.asset;
  const unfilled = (BigInt(depositUnits) * BigInt(10_000 - filledBps)) / 10_000n;
  const status = filledBps >= 10_000 ? "filled" : filledBps > 0 ? "partial" : "open";
  const x = m.assetIsX ? m.asset : m.quote;
  const withdrawX = intent === "sell" ? unfilled : BigInt(proceedsUnits);
  const withdrawY = intent === "sell" ? BigInt(proceedsUnits) : unfilled;
  return {
    venue: "meteora-dlmm",
    network: "solana",
    address,
    pool: m.pool,
    owner: OWNER,
    side,
    tokenX: { mint: x.mint, decimals: x.decimals, program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
    tokenY: { mint: (m.assetIsX ? m.quote : m.asset).mint, decimals: (m.assetIsX ? m.quote : m.asset).decimals, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    bins: [{ bin: bins.lower, price: "0", deposit: amount(depositUnits, given.decimals, given.mint), unfilled: amount(unfilled, given.decimals, given.mint), proceeds: amount(proceedsUnits, got.decimals, got.mint), status }],
    lowerPrice: "0",
    upperPrice: "0",
    deposit: amount(depositUnits, given.decimals, given.mint),
    unfilled: amount(unfilled, given.decimals, given.mint),
    proceeds: amount(proceedsUnits, got.decimals, got.mint),
    makerFees: { x: amount(0, x.decimals, x.mint), y: amount(0, 6, USDC) },
    withdrawable: { x: amount(withdrawX, x.decimals, x.mint), y: amount(withdrawY, m.quote.decimals, m.quote.mint) },
    filledBps,
    status,
    price: "0",
    activeBin: m.activeBin,
    source: { kind: "chain", program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", slot: 1, at: Date.now() },
  };
}
const ORDERS = [
  order({ address: addressOf("order-sol"), market: SOL_M, intent: "sell", target: 182.1, depositUnits: 1_500_000_000, filledBps: 10_000, proceedsUnits: 273_150_000 }),
  order({ address: addressOf("order-nvda"), market: NVDA_M, intent: "sell", target: 196.8, depositUnits: 248_190_000, filledBps: 3_800, proceedsUnits: 183_500_000 }),
  order({ address: addressOf("order-tsla"), market: TSLA_M, intent: "buy", target: 2.19, depositUnits: 900_000_000, filledBps: 0, proceedsUnits: 0 }),
];
// One order set before NVDAx's multiplier moved from ×1.0049 to ×1.0073: offered again.
const RECORDS = [{ order: ORDERS[1].address, pool: NVDA_M.pool, mint: NVDAX, intent: "sell", target: 196.8, multiplier: 1.0049, at: Date.now() - 86_400_000 }];

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "186.4" } },
  { kind: "TOKEN", mint: USDC, amountRaw: "1248120000", spendableRaw: "1248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
  { kind: "TOKEN", mint: NVDAX, amountRaw: "496380000", spendableRaw: "496380000", decimals: 8, catalog: { symbol: "NVDAx", name: "NVIDIA xStock", isVerified: true, usdPrice: "187.42" } },
  { kind: "TOKEN", mint: TSLAX, amountRaw: "120000000", spendableRaw: "120000000", decimals: 8, catalog: { symbol: "TSLAx", name: "Tesla xStock", isVerified: true, usdPrice: "430.6" } },
];

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: LANG === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `${state}-${size.name}-${LANG === "uk" ? "ua" : "en"}.png`) });

  await page.addInitScript(({ owner, lang, records }) => {
    Object.defineProperty(navigator, "languages", { get: () => (lang === "uk" ? ["uk-UA", "uk", "en"] : ["en-US", "en"]) });
    try {
      window.localStorage.setItem(`ryntra.city.earn.limits.v1:${owner}`, JSON.stringify(records));
      // The city's first-visit hint is the city's own: seen, so the screens show the window alone.
      window.localStorage.setItem("ryntra.city.firstHint", "1");
    } catch {}
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async (input) => (input?.silent ? { accounts: [] } : ((wallet.accounts = [account]), { accounts: [account] })) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { owner: OWNER, lang: LANG, records: RECORDS });

  let admitted = true;
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"], [NVDAX]: ["N", "#76B900"], [TSLAX]: ["T", "#E31937"], [SPYX]: ["S", "#2B4A8C"] };
  await page.route("**/api/icon/*", (route) => {
    const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/city/earn/limits", (route) => json(route, 200, { markets: MARKETS, at: new Date().toISOString() }));
  await page.route("**/api/city/earn/limits/admit?*", (route) => json(route, 200, admitted ? { place: "on", exit: "on", ceilingUsd: 1000, stopped: false } : { place: "off", exit: "off", ceilingUsd: null, stopped: false }));
  await page.route("**/api/city/earn/limits/orders?*", (route) => json(route, 200, { owner: OWNER, orders: ORDERS, at: new Date().toISOString() }));
  await page.route("**/api/city/earn/limits/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    const m = MARKETS.find((x) => x.pool === body.request?.pool) ?? MARKETS[0];
    const place = body.action === "limit_place" ? { side: body.request.side, bins: body.request.bins, lowerPrice: "1", upperPrice: "1", spread: [], deposit: amount(body.request.amount, body.request.side === "ask" ? m.asset.decimals : m.quote.decimals, body.request.side === "ask" ? m.asset.mint : m.quote.mint), fullFill: amount(1, 6, USDC) } : undefined;
    json(route, 200, {
      preview: { action: body.action, venue: "meteora-dlmm", pool: m.pool, request: body.request, fees: [], rent: [{ what: "limit_order", direction: body.action === "limit_cancel" ? "return" : "pay", lamports: "1948800", refundable: true }], transactions: body.action === "limit_roll" ? 2 : 1, notices: [], price: "1", activeBin: m.activeBin, makerShareBps: 5000, feeBps: m.feeBps, at: Date.now(), expiresAt: Date.now() + 30_000, ...(place ? { place } : {}) },
      transactions: [{ wireBase64: "AQ==", presigned: [] }],
      position: addressOf("order-new"),
      ticket: "ticket",
      expiresAt: Date.now() + 25_000,
      signableMs: 25_000,
      networkFeeLamports: "10000",
      depositUsd: 100,
    });
  });
  await page.route("**/api/city/earn", (route) => json(route, 200, { at: new Date().toISOString(), epochsPerYear: 182.4, lsts: [] }));
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: [], at: null }));
  await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: [], at: new Date().toISOString() }));
  await page.route("**/api/solana/earn", (route) => json(route, 200, { providers: [], positions: [], actions: { open: false, mode: "CLOSED", maxUsd: null }, feeBps: 0, readAt: new Date().toISOString() }));
  await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: [], at: null }));
  await page.route("**/api/liquidity/actions?*", (route) => json(route, 200, { add: { status: "later" }, remove: { status: "later" }, claim: { status: "later" }, maxDepositUsd: null }));

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 240_000 });
  await page.waitForTimeout(5000);

  const details = LANG === "uk" ? "Деталі" : "Details";
  const scrollTo = async (selector, block = "start") => {
    await page.evaluate(({ selector, block }) => document.querySelector(selector)?.scrollIntoView({ block }), { selector, block });
    await page.waitForTimeout(500);
  };

  // Connect from «Mine», then Sell Higher on the Shelf.
  await page.evaluate(() => window.__openEarn("mine"));
  await page.getByRole("tab").first().waitFor({ timeout: 240_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__openEarn("shelf"));
  await page.waitForTimeout(1200);
  await shot("shelf");
  await page.evaluate(() => window.__openEarn("shelf", "sell"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__limit.getState().setAmount("1.25"));
  await page.waitForTimeout(3000);
  await shot("sell");

  await page.locator(`[aria-label="${details}"][aria-expanded="false"]`).last().click();
  await page.waitForTimeout(800);
  await shot("sell-details");
  await page.locator(`[aria-label="${details}"][aria-expanded="true"]`).last().click();
  await page.waitForTimeout(400);

  // Buy lower on SOL.
  await page.evaluate((pool) => {
    window.__limit.getState().setIntent("buy");
    window.__limit.getState().selectMarket(pool);
    window.__limit.getState().setAmount("250");
  }, SOL_M.pool);
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('[role="radiogroup"]')?.scrollIntoView({ block: "start" }));
  await shot("buy");

  // The eve of a dividend on NVDAx: a sale near the price waits.
  await page.evaluate((pool) => {
    const st = window.__limit.getState();
    const markets = st.markets.value.map((m) => (m.pool === pool ? { ...m, multiplier: { current: m.multiplier.current, pending: m.multiplier.current * 1.0061, effectiveAt: new Date(Date.now() + 9 * 3_600_000).toISOString() } } : m));
    window.__limit.setState({ markets: { status: "ready", value: markets, at: Date.now() } });
    window.__limit.getState().setIntent("sell");
    window.__limit.getState().selectMarket(pool);
    window.__limit.getState().setPrice("189");
    window.__limit.getState().setAmount("1");
  }, NVDA_M.pool);
  await page.waitForTimeout(1500);
  await scrollTo('[role="alert"], p[class*="noteWarn"]', "center");
  await shot("eve");

  // Your orders: filled (the Wheel's one tap), part filled and offered again after the multiplier moved, waiting.
  await page.evaluate(() => window.__limit.getState().setPrice("196"));
  await page.waitForTimeout(800);
  await scrollTo('[data-order-status]', "start");
  await shot("orders");

  // Order set.
  await page.evaluate(() => window.__limit.setState({ phase: "done", done: "place", outcome: { kind: "done", signatures: ["5Ld9mYd1fYpZ9JwT1hT8wFqAXo4oXbF3nE7Yq4ZrkC1VbkGx3PZ5rtv1QpH6AqgM8nTJxv8xjzQcZb6yH3U4wFq"] } }));
  await page.waitForTimeout(800);
  await shot("done");
  await page.evaluate(() => window.__limit.getState().again());
  await page.waitForTimeout(600);

  // Closed to this wallet: the calm window with «tell me when it opens».
  admitted = false;
  await page.evaluate((owner) => window.__limit.getState().loadStates(owner), OWNER);
  await page.waitForTimeout(1500);
  await scrollTo('[role="switch"]', "end");
  await shot("closed");

  if (errors.length) console.log(size.name, "errors:", errors.slice(0, 6));
  await context.close();
}

await browser.close();
console.log("shots in", out);
