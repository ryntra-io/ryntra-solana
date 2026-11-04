// «Like the Captain»'s screens for review (CITY-99), at 1440×900 and 375×812 → <out>/captain-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open npm run dev, then:
//   node city/lib/earn/captain-shots.mjs [out] [baseUrl]
// LANG_EARN=en for the English words (Ukrainian by default). No wallet and no keys: a stub wallet registers through the
// Wallet Standard events and never signs. The routes answer from fixtures — the engine's recorded SOL–USDC pools (16.10),
// a JitoSOL–SOL pool written by hand, three strategies' records written by hand in the ledger's own shape, a Review
// shaped like the engine's and the swap engine's recorded order. The figures on these screens are fixtures; the live
// record comes from the ledger once its migration is applied and people copy.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG, addReview } from "../districts/harbor/test-fixtures.mjs";
import { ORDER } from "../trade/test-fixtures.mjs";
import { JITOSOL, SOL, SOL_USDC, USDC, lstPool } from "./pier-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/captain-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_EARN ?? "uk";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const solUsd = SOL_USDC.x.priceUsd;
const WORTH = 1.2603;
const POOLS = [lstPool(), ...harborPools(CATALOG)];
const DAY = 86_400_000;

/** A record's daily line: a seeded walk that ends where it is told, starting level with holding. */
function line(seed, days, end, vol) {
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  const raw = [0];
  for (let i = 1; i <= days; i++) raw.push(raw[i - 1] + rand() * vol);
  return raw.map((r, i) => Number((r - raw[days] * (i / days) + end * (i / days)).toFixed(4)));
}
function drawdown(series) {
  let peak = 0;
  let deepest = 0;
  for (const v of series) {
    peak = Math.max(peak, v);
    deepest = Math.max(deepest, peak - v);
  }
  return deepest;
}
function strategy(pool, style, days, copies, live, end, fees, seed, vol) {
  const series = line(seed, days, end, vol);
  const now = Date.now();
  return { id: `${pool}:${style}`, pool, style, days, copies, live, resultPct: end, feesPct: fees, pricePct: end - fees, drawdownPct: drawdown(series), series: series.slice(-90), since: now - days * DAY, at: now - 3 * 3_600_000 };
}
const STRATEGIES = [
  strategy(lstPool().address, "calm", 47, 23, 19, 0.62, 0.71, 11, 0.05),
  strategy(SOL_USDC.address, "balanced", 38, 11, 9, 2.84, 4.12, 5, 0.9),
  strategy(lstPool().address, "dense", 31, 6, 5, -0.41, 0.36, 3, 0.18),
];

const FEED = {
  at: new Date().toISOString(),
  epochsPerYear: 182.4,
  lsts: [
    { id: "jupsol", rate: { lamports: "1104300000", supply: "1000000000" }, apyPct: 7.18, rewardsFeePct: 0, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
    { id: "inf", rate: { lamports: "1312200000", supply: "1000000000" }, apyPct: 7.42, rewardsFeePct: null, unstakeFeePct: null, source: "sanctum", epoch: null },
    { id: "jitosol", rate: { lamports: "1260300000", supply: "1000000000" }, apyPct: 6.31, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
  ],
};

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solUsd) } },
  { kind: "TOKEN", mint: USDC, amountRaw: "248120000", spendableRaw: "248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
  { kind: "TOKEN", mint: JITOSOL, amountRaw: "3793000000", spendableRaw: "3793000000", decimals: 9, catalog: { symbol: "JitoSOL", name: "Jito Staked SOL", isVerified: true, usdPrice: String(solUsd * WORTH) } },
];

/** The swap engine's recorded order, turned into SOL → the coin asked for, alive for the next minute. */
function orderFor(input) {
  const order = structuredClone(ORDER);
  const lamports = Number(input.amountRaw);
  const usdc = input.outputMint === USDC;
  const out = usdc ? Math.floor((lamports / 1e9) * solUsd * 1e6 * 0.999) : Math.floor((lamports / WORTH) * 0.999);
  Object.assign(order.order, {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inAmountRaw: input.amountRaw,
    outAmountRaw: String(out),
    minReceivedRaw: String(Math.floor(out * 0.995)),
    ryntraFee: order.order.ryntraFee ? { ...order.order.ryntraFee, basisPoints: 10 } : order.order.ryntraFee,
  });
  order.decimals = { ...order.decimals, [input.outputMint]: usdc ? 6 : 9, [SOL]: 9 };
  order.expiresAt = new Date(Date.now() + 60_000).toISOString();
  order.signableMs = 45_000;
  return order;
}

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
  const shot = (state) => page.screenshot({ path: path.join(out, `captain-${state}-${size.name}.png`) });

  await page.addInitScript(({ owner, lang }) => {
    Object.defineProperty(navigator, "languages", { get: () => (lang === "uk" ? ["uk-UA", "uk", "en"] : ["en-US", "en"]) });
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
  }, { owner: OWNER, lang: LANG });

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"], [JITOSOL]: ["J", "#2F9E6B"] };
  await page.route("**/api/icon/*", (route) => {
    const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/city/earn", (route) => json(route, 200, FEED));
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: POOLS, at: "2026-10-16T09:12:00.000Z" }));
  await page.route("**/api/city/earn/captain", (route) => json(route, 200, { strategies: STRATEGIES, counting: true, at: Date.now() }));
  await page.route("**/api/city/earn/captain/copies", (route) => json(route, 200, { state: "counted" }));
  await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
  await page.route("**/api/city/earn/piers/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    const pool = POOLS.find((p) => p.address === body.request?.pool) ?? POOLS[0];
    const review = addReview({ expiresAt: Date.now() + 60_000, signableMs: 60_000, networkFeeLamports: "15000" });
    review.preview = { ...review.preview, pool: pool.address, rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }], notices: [], deposit: { x: { asset: pool.x.mint, units: body.request.amountX, decimals: pool.x.decimals }, y: { asset: pool.y.mint, units: body.request.amountY, decimals: pool.y.decimals } } };
    json(route, 200, review);
  });
  await page.route("**/api/solana/swap/order", async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    json(route, 200, orderFor(route.request().postDataJSON().input));
  });
  await page.route("**/api/solana/swap/quote", (route) => json(route, 503, { error: { code: "UNAVAILABLE", message: "fixture" } }));
  await page.route("**/api/spot/candles?*", (route) => json(route, 404, { error: { code: "CANDLES_NO_POOL" } }));
  await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: [], at: new Date().toISOString() }));
  await page.route("**/api/solana/earn", (route) => json(route, 200, { providers: [], positions: [], actions: { open: false, mode: "CLOSED", maxUsd: null }, feeBps: 0, readAt: new Date().toISOString() }));
  await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: POOLS, at: null }));
  await page.route("**/api/liquidity/actions?*", (route) => json(route, 200, { add: { status: "later" }, remove: { status: "later" }, claim: { status: "later" }, maxDepositUsd: null }));

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 240_000 });
  await page.waitForTimeout(5000);

  const open = async (tab, product) => {
    await page.evaluate(([t, p]) => window.__openEarn(t, p), [tab, product]);
    await page.getByRole("tab").first().waitFor({ timeout: 240_000 });
    await page.waitForTimeout(1500);
  };
  const details = LANG === "uk" ? "Деталі" : "Details";
  /** The window's body scrolls under its one action: to the top, or down to what is asked. */
  const scroll = (where) =>
    page.evaluate((to) => {
      const section = document.querySelector('[aria-label="Як у капітана"], [aria-label="Like the Captain"], section[aria-label*="-"]');
      let el = section?.parentElement;
      while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
      if (el) el.scrollTop = to === "end" ? el.scrollHeight : 0;
    }, where);

  // Connect from «Mine», then the Shelf with the Captain's best record on its card.
  await open("mine");
  await page.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  await open("shelf");
  await page.evaluate(() => document.querySelector('[data-earn-product="captain"]')?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  await shot("shelf");

  // The strategies with a proven record.
  await open("shelf", "captain");
  await page.waitForTimeout(1500);
  await shot("list");
  await page.locator(`[aria-label="${details}"][aria-expanded="false"]`).last().click();
  await page.waitForTimeout(800);
  await shot("list-details");
  await page.locator(`[aria-label="${details}"][aria-expanded="true"]`).last().click();

  // A copy: JitoSOL–SOL, Calm — the wallet holds both coins, the Review is built while the card is read.
  await page.locator(`[data-earn-strategy="${STRATEGIES[0].id}"] button`).last().click();
  await page.waitForTimeout(3500);
  await shot("copy");
  await page.locator(`[aria-label="${details}"][aria-expanded="false"]`).last().click();
  await page.waitForTimeout(800);
  await shot("copy-details");
  await page.locator(`[aria-label="${details}"][aria-expanded="true"]`).last().click();
  await page.evaluate(() => window.__pier.getState().back());
  await page.waitForTimeout(800);

  // A copy of SOL–USDC with more than the wallet's USDC: the Zap — the missing USDC first, then the copy.
  await page.locator(`[data-earn-strategy="${STRATEGIES[1].id}"] button`).last().click();
  // The amount is typed once the card's first Review is in: while one is built the card takes no typing.
  await page.waitForFunction(() => window.__pier.getState().phase === "idle" && window.__pier.getState().reviewed, null, { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => window.__pier.getState().setTyped("6"));
  await page.waitForTimeout(3500);
  await scroll("end");
  await page.waitForTimeout(400);
  await shot("copy-zap");

  // Copied.
  await page.evaluate(() => window.__pier.setState({ phase: "done", outcome: { kind: "done", signatures: ["5Ld9mYd1fYpZ9JwT1hT8wFqAXo4oXbF3nE7Yq4ZrkC1VbkGx3PZ5rtv1QpH6AqgM8nTJxv8xjzQcZb6yH3U4wFq"] } }));
  await page.waitForTimeout(800);
  await shot("copied");
  await page.evaluate(() => window.__pier.getState().again());
  await page.waitForTimeout(600);

  // Before any strategy has thirty days and five copies: a calm window, nothing drawn that is not measured.
  await page.evaluate(() => window.__earnData.setState({ captain: { status: "ready", value: { strategies: [], counting: true, at: Date.now() }, at: Date.now() } }));
  await page.waitForTimeout(800);
  await scroll("top");
  await shot("none");

  if (errors.length) console.log(size.name, "errors:", errors.slice(0, 6));
  await context.close();
}

await browser.close();
console.log("shots in", out);
