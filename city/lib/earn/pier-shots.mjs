// The Piers' screens for review (CITY-93), at 1440×900 and 375×812 → <out>/piers-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open npm run dev, then:
//   node city/lib/earn/pier-shots.mjs [out] [baseUrl]
// LANG_EARN=en for the English words (Ukrainian by default). No wallet and no keys: a stub wallet registers through the
// Wallet Standard events and never signs. The routes answer from fixtures — the engine's recorded SOL–USDC pools (16.10),
// a JitoSOL–SOL pool written by hand, a Review shaped like the engine's and thirty days of candles drawn from a seeded
// walk. The figures on these screens are fixtures; the live pass with a real wallet is the owner's canary.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG, addReview, positionView } from "../districts/harbor/test-fixtures.mjs";
import { JITOSOL, SOL, SOL_USDC, USDC, lstPool } from "./pier-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/pier-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_EARN ?? "uk";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const solUsd = SOL_USDC.x.priceUsd;
const WORTH = 1.2603;
const POOLS = [lstPool(), ...harborPools(CATALOG)];

/** A seeded walk over 180 four-hour bars that ends where it is told. */
function walk(seed, start, end, vol) {
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  const raw = [0];
  for (let i = 1; i < 180; i++) raw.push(raw[i - 1] + rand() * vol);
  const t0 = Math.floor(Date.now() / 1000 / 14_400) * 14_400 - 179 * 14_400;
  return raw.map((r, i) => {
    const k = i / 179;
    const p = start * Math.exp(r - raw[179] * k) * (end / start) ** k;
    return { time: t0 + i * 14_400, open: p, high: p * 1.003, low: p * 0.997, close: p, volume: 1000 };
  });
}
const SOL_CANDLES = walk(7, solUsd * 0.93, solUsd, 0.022);
// JitoSOL's worth in SOL grows with staking: 1.2547 → 1.2603 over the month, a few hundredths of a per cent of noise.
const JITO_CANDLES = SOL_CANDLES.map((c, i) => {
  const ratio = (1.2547 + (WORTH - 1.2547) * (i / 179)) * (1 + Math.sin(i * 1.7) * 0.00012);
  return { ...c, open: c.close * ratio, high: c.close * ratio * 1.001, low: c.close * ratio * 0.999, close: c.close * ratio };
});

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
  const shot = (state) => page.screenshot({ path: path.join(out, `piers-${state}-${size.name}.png`) });

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

  let admitted = true;
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"], [JITOSOL]: ["J", "#2F9E6B"] };
  await page.route("**/api/icon/*", (route) => {
    const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/city/earn", (route) => json(route, 200, FEED));
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: POOLS, at: "2026-10-16T09:12:00.000Z" }));
  await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, admitted ? { add: "on", exit: "on", ceilingUsd: 1000, stopped: false } : { add: "off", exit: "off", ceilingUsd: null, stopped: false }));
  await page.route("**/api/city/earn/piers/review", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    const pool = POOLS.find((p) => p.address === body.request?.pool) ?? POOLS[0];
    const review = addReview({ expiresAt: Date.now() + 60_000, signableMs: 60_000, networkFeeLamports: "15000" });
    if (body.action === "add") {
      review.preview = { ...review.preview, pool: pool.address, rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }], notices: [], deposit: { x: { asset: pool.x.mint, units: body.request.amountX, decimals: pool.x.decimals }, y: { asset: pool.y.mint, units: body.request.amountY, decimals: pool.y.decimals } } };
    } else {
      review.preview = { ...review.preview, action: body.action, rent: [{ what: "position", direction: "return", lamports: "57000000", refundable: true }], notices: [], expected: { x: { units: "410000000", decimals: 9 }, y: { units: "520000000", decimals: 9 } }, claimed: { x: { units: "900000", decimals: 9 }, y: { units: "1100000", decimals: 9 } }, minimum: null, feesClaimed: { x: { units: "900000", decimals: 9 }, y: { units: "1100000", decimals: 9 } }, rewardsClaimed: [], closesPosition: body.action === "remove" };
    }
    json(route, 200, review);
  });
  await page.route("**/api/spot/candles?*", (route) => {
    const mint = new URL(route.request().url()).searchParams.get("mint");
    const candles = mint === SOL ? SOL_CANDLES : mint === JITOSOL ? JITO_CANDLES : null;
    if (!candles) return json(route, 404, { error: { code: "CANDLES_NO_POOL" } });
    return json(route, 200, { timeframe: "4h", candles, pool: { name: "fixture" }, observedAt: new Date().toISOString(), stale: false, source: { label: "fixture" } });
  });
  await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: [], at: new Date().toISOString() }));
  await page.route("**/api/solana/earn", (route) => json(route, 200, { providers: [], positions: [], actions: { open: false, mode: "CLOSED", maxUsd: null }, feeBps: 0, readAt: new Date().toISOString() }));
  await page.route("**/api/liquidity/positions?*", (route) =>
    json(route, 200, {
      owner: OWNER,
      positions: [
        positionView({ address: "7xJitoPier1111111111111111111111111111111111", pool: lstPool().address, name: "JitoSOL-SOL", x: { mint: JITOSOL, symbol: "JitoSOL", amount: 0.41, unclaimed: 0.0009, priceUsd: solUsd * WORTH }, y: { mint: SOL, symbol: "SOL", amount: 0.52, unclaimed: 0.0011, priceUsd: solUsd }, valueUsd: 0.41 * solUsd * WORTH + 0.52 * solUsd, unclaimedUsd: 0.0009 * solUsd * WORTH + 0.0011 * solUsd }),
        positionView({ address: "9xSolUsdcPier111111111111111111111111111111", rangeState: "above", name: "SOL-USDC", x: { mint: SOL, symbol: "SOL", amount: 0.3, unclaimed: 0, priceUsd: solUsd }, y: { mint: USDC, symbol: "USDC", amount: 0, unclaimed: 0, priceUsd: 1 }, valueUsd: 0.3 * solUsd, unclaimedUsd: 0 }),
      ],
      venues: { dlmm: { ok: true }, "damm-v2": { ok: true } },
      at: Date.now(),
    }),
  );
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  // The Harbor's own district reads, which this stand does not show.
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: POOLS, at: null }));
  await page.route("**/api/liquidity/actions?*", (route) => json(route, 200, { add: { status: "later" }, remove: { status: "later" }, claim: { status: "later" }, maxDepositUsd: null }));

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 240_000 });
  await page.waitForTimeout(5000);

  const open = async (tab) => {
    await page.evaluate((t) => window.__openEarn(t), tab);
    await page.getByRole("tab").first().waitFor({ timeout: 240_000 });
    await page.waitForTimeout(1500);
  };
  const details = LANG === "uk" ? "Деталі" : "Details";

  // Connect from «Mine», then the Piers.
  await open("mine");
  await page.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  await open("piers");
  await page.waitForTimeout(2000);
  await shot("list");

  // One pier: JitoSOL–SOL, the Review built while the card is read.
  await page.evaluate(() => window.__pier.getState().openPier(window.__earnData.getState().piers.value.pools[0]));
  await page.waitForTimeout(3500);
  await shot("card");
  await page.locator(`[aria-label="${details}"][aria-expanded="false"]`).last().click();
  await page.waitForTimeout(800);
  await shot("card-details");
  await page.locator(`[aria-label="${details}"][aria-expanded="true"]`).last().click();
  await page.evaluate(() => window.__pier.getState().setStyle("dense"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector('[role="tabpanel"], [aria-label]')?.scrollIntoView?.());
  await shot("card-dense");
  await page.evaluate(() => window.__pier.getState().setStyle("calm"));
  await page.waitForTimeout(2500);
  await shot("card-calm");

  // SOL–USDC with more than the wallet's USDC: the way to get the other half.
  await page.evaluate(() => {
    const pools = window.__earnData.getState().piers.value.pools;
    window.__pier.getState().openPier(pools.find((p) => p.pair === "SOL-USDC"));
    window.__pier.getState().setTyped("6");
  });
  await page.waitForTimeout(3000);
  await shot("card-usdc-short");

  // Moored.
  await page.evaluate(() => window.__pier.setState({ phase: "done", outcome: { kind: "done", signatures: ["5Ld9mYd1fYpZ9JwT1hT8wFqAXo4oXbF3nE7Yq4ZrkC1VbkGx3PZ5rtv1QpH6AqgM8nTJxv8xjzQcZb6yH3U4wFq"] } }));
  await page.waitForTimeout(800);
  await shot("done");
  await page.evaluate(() => window.__pier.getState().again());
  await page.waitForTimeout(600);

  // A boat earning at the pier, and leaving it.
  await page.evaluate(() => window.__pier.getState().openBoat(window.__earnData.getState().positions.value.value[0]));
  await page.waitForTimeout(1200);
  await shot("boat");
  await page.getByRole("radio", { name: LANG === "uk" ? "Вийти" : "Leave" }).click();
  await page.waitForTimeout(2500);
  // The window's body scrolls under its one action: down to what comes back.
  await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="JitoSOL-SOL"]');
    let el = section?.parentElement;
    while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(400);
  await shot("boat-leave");
  await page.evaluate(() => window.__pier.getState().back());

  // Closed to this wallet: the same pier, read-only, with «tell me when it opens».
  admitted = false;
  await page.evaluate((owner) => window.__pier.getState().loadStates(owner), OWNER);
  await page.evaluate(() => {
    window.__pier.getState().openPier(window.__earnData.getState().piers.value.pools[0]);
    window.__pier.getState().setTyped("1");
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelectorAll('[role="switch"]').forEach((el) => el.scrollIntoView({ block: "end" })));
  await page.waitForTimeout(500);
  await shot("card-closed");

  if (errors.length) console.log(size.name, "errors:", errors.slice(0, 6));
  await context.close();
}

await browser.close();
console.log("shots in", out);
