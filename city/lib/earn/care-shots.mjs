// «Your agent looks after it» (CITY-203), at 1440×900 and 390×844 → <out>/care-<state>-<size>-<lang>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open NEXT_PUBLIC_RYNTRA_AGENT_CARE=devnet npm run dev, then:
//   LANG_EARN=uk node city/lib/earn/care-shots.mjs [out] [baseUrl]      (LANG_EARN=en for English)
// The same stub wallet and fixtures as the Zap's screens (CITY-198); the care's own door answers from a fixture too.
// No wallet and no keys: a stub wallet registers through the Wallet Standard events and never signs. The routes answer
// from fixtures — the engine's recorded SOL–USDC pools (16.10), a JitoSOL–SOL pool written by hand, and the Zap's Review
// shaped like the engine's (`pier-fixtures.mjs` `zapReview`). The figures on these screens are fixtures.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG } from "../districts/harbor/test-fixtures.mjs";
import { JITOSOL, SOL, SOL_USDC, USDC, lstPool, zapReview } from "./pier-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-203");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_EARN ?? "uk";
mkdirSync(out, { recursive: true });

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const solUsd = SOL_USDC.x.priceUsd;
const WORTH = 1.2603;
const POOLS = [lstPool(), ...harborPools(CATALOG)];

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

/** The wallet holds SOL only: the Zap needs nothing else. */
const HOLDINGS = [{ kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solUsd) } }];

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: LANG === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `care-${state}-${size.name}-${LANG}.png`), timeout: 180_000 });

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
    /* The dev server's overlay is not the product: hidden on these screens. */
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.append(style);
    });
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
  await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
  await page.route("**/api/city/earn/piers/zap", async (route) => {
    const body = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    const lamports = body.action === "zap_in" ? BigInt(body.request.amountIn) : 0n;
    const swapIn = lamports / 2n;
    const jito = BigInt(Math.floor((Number(swapIn) * 0.999) / WORTH));
    const review = zapReview({ expiresAt: Date.now() + 60_000, signableMs: 60_000 }, { rest: body.action === "zap_rest" });
    if (body.action === "zap_in") {
      review.preview = {
        ...review.preview,
        amountIn: lamports.toString(),
        swap: { ...review.preview.swap, inAmount: swapIn.toString(), expectedOut: jito.toString(), floor: ((jito * 9950n) / 10_000n).toString(), fee: { ...review.preview.swap.fee, amount: ((swapIn * 10n) / 10_000n).toString() } },
        deposit: { x: { asset: JITOSOL, units: jito.toString(), decimals: 9 }, y: { asset: SOL, units: (lamports - swapIn).toString(), decimals: 9 } },
      };
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
  await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/city/harbor", (route) => json(route, 200, { pools: POOLS, at: null }));
  await page.route("**/api/city/earn/care", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "status") return json(route, 200, { ok: true, network: "devnet", cares: [{ key: "c:devnet:x:1", pool: POOLS[1]?.address ?? "pool", status: "working", inRange: true, holdsX: "0", holdsY: "0", day: { claimedInY: 0.0042, reinvestedInY: 0.0019, rebalances: 1, exits: 0, refusals: 0, inRange: true, valueNowInY: null, valueDayAgoInY: null }, stopBelow: null, fees: "reinvest" }] });
    return json(route, 200, { ok: true, key: "c:devnet:x:1", transactions: [], goesIn: "0", vault: "v" });
  });
  await page.route("**/api/liquidity/actions?*", (route) => json(route, 200, { add: { status: "later" }, remove: { status: "later" }, claim: { status: "later" }, maxDepositUsd: null }));

  /* A cold dev server can time out a chunk of the 3D city on the first load: the city's error screen — load again. */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 600_000 });
    await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 600_000 });
    await page.waitForTimeout(6000);
    const broken = await page.evaluate(() => /зламалося|went wrong|broke/i.test(document.title));
    if (!broken) break;
  }

  /* The window asked to open while the city still loads can be missed: asked again until its tabs are there. */
  const open = async (tab) => {
    for (let attempt = 0; ; attempt += 1) {
      await page.evaluate((t) => window.__openEarn(t), tab);
      const there = await page.getByRole("tab").first().waitFor({ timeout: 60_000 }).then(() => true, () => false);
      if (there) break;
      if (attempt >= 4) throw new Error("the Earn window did not open");
    }
    await page.waitForTimeout(1500);
  };

  await open("mine");
  await page.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  await open("piers");
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => typeof window.__care === "function" || typeof window.__care === "object", null, { timeout: 240_000 });

  // The pier card with the agent on: one switch, the stop as three chips, one line of safety, one amber action.
  await page.evaluate(() => window.__pier.getState().openPier(window.__earnData.getState().piers.value.pools[1] ?? window.__earnData.getState().piers.value.pools[0]));
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__care.setState({ on: true, stop: 25, phase: "idle", notice: null }));
  await page.waitForTimeout(800);
  /* On a phone the sheet is half the screen: the care's block scrolled up above the card's one action. */
  if (size.mobile) await page.evaluate(() => document.querySelector('[role="switch"]')?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await shot("card");

  // «Details» opened: how it holds, three short lines.
  await page.locator("details summary").last().click();
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector("details[open]")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await shot("details");
  await page.locator("details summary").last().click();

  // One approval in the wallet.
  await page.evaluate(() => window.__care.setState({ phase: "wallet" }));
  await page.waitForTimeout(500);
  if (size.mobile) await page.evaluate(() => document.querySelector('[role="switch"]')?.scrollIntoView({ block: "center" }));
  await shot("approve");

  // The agent is on it.
  await page.evaluate(() => window.__care.setState({ phase: "done" }));
  await page.waitForTimeout(600);
  await shot("done");

  // «Mine»: the pier the agent looks after, today in SOL, and the person's own stop.
  await page.evaluate(() => { window.__care.setState({ phase: "idle" }); window.__pier.getState().back(); });
  await open("mine");
  await page.waitForTimeout(2500);
  await shot("mine");

  // The switch off: the card is the Zap's again.
  await open("piers");
  await page.evaluate(() => window.__pier.getState().openPier(window.__earnData.getState().piers.value.pools[1] ?? window.__earnData.getState().piers.value.pools[0]));
  await page.evaluate(() => window.__care.setState({ on: false }));
  await page.waitForTimeout(1500);
  await shot("off");

  if (errors.length) console.log(size.name, "errors:", errors.slice(0, 6));
  await context.close();
}

await browser.close();
console.log("shots in", out);
