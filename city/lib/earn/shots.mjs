// Earn's screens for review (CITY-92), at 1440×860 and 390×844 → <out>/earn-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open npm run dev, then: node city/lib/earn/shots.mjs [out] [baseUrl]
// LANG=en for the English words (Ukrainian by default). No wallet and no keys are needed: a stub wallet registers
// through the Wallet Standard events and signs nothing real. The engine's routes answer from recorded transcripts and
// fixtures — the swap from the golden swap transcripts re-priced into an LST, the pools from the engine's recorded
// Meteora catalogue (16.10). The figures on these screens are fixtures; the live pass with a real wallet is the owner's.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { harborPools } from "../districts/harbor/pools.ts";
import { CATALOG, positionView } from "../districts/harbor/test-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/earn-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_UI ?? process.env.LANG_EARN ?? (process.env.LANG === "en" ? "en" : "uk");
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name, at = -1) => structuredClone(golden[name].steps.at(at).body);

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPSOL = "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";
const INF = "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const solPrice = snapshot.towers.find((t) => t.id === SOL)?.price ?? 180;
/** SOL for one whole LST, as its pool states it (fixtures). */
const WORTH = { [JUPSOL]: 1.1043, [INF]: 1.3122, [JITOSOL]: 1.2603 };

const FEED = {
  at: new Date().toISOString(),
  epochsPerYear: 182.4,
  lsts: [
    { id: "jupsol", rate: { lamports: "1104300000", supply: "1000000000" }, apyPct: 7.18, rewardsFeePct: 0, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
    { id: "inf", rate: { lamports: "1312200000", supply: "1000000000" }, apyPct: 7.42, rewardsFeePct: null, unstakeFeePct: null, source: "sanctum", epoch: null },
    { id: "jitosol", rate: { lamports: "1260300000", supply: "1000000000" }, apyPct: 6.31, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
  ],
};

const HOLDINGS = (withEarn) => [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solPrice) } },
  { kind: "TOKEN", mint: USDC, amountRaw: "248120000", spendableRaw: "248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
  ...(withEarn
    ? [
        { kind: "TOKEN", mint: JUPSOL, amountRaw: "2716000000", spendableRaw: "2716000000", decimals: 9, catalog: { symbol: "JupSOL", name: "Jupiter Staked SOL", isVerified: true, usdPrice: String(solPrice * WORTH[JUPSOL]) } },
        { kind: "TOKEN", mint: JITOSOL, amountRaw: "793000000", spendableRaw: "793000000", decimals: 9, catalog: { symbol: "JitoSOL", name: "Jito Staked SOL", isVerified: true, usdPrice: String(solPrice * WORTH[JITOSOL]) } },
        { kind: "TOKEN", mint: NVDAX, amountRaw: "84000000", spendableRaw: "84000000", decimals: 8, catalog: { symbol: "NVDAx", name: "NVIDIA xStock", isVerified: true, usdPrice: "196.4" } },
      ]
    : []),
];

/** The recorded swap answer, re-priced: SOL into an LST at its worth, Ryntra's 0.10 % on a major. */
function priced(body, amountRaw, { taker, inputMint = SOL, outputMint = JUPSOL }) {
  const o = body.order;
  const buying = inputMint === SOL;
  const lst = buying ? outputMint : inputMint;
  const worth = WORTH[lst] ?? 1.1;
  const value = buying ? Number(amountRaw) / worth : Number(amountRaw) * worth;
  const outRaw = BigInt(Math.floor(value * (buying ? 0.9984 : 0.9962)));
  Object.assign(o, {
    inputMint,
    outputMint,
    inAmountRaw: amountRaw,
    outAmountRaw: outRaw.toString(),
    minReceivedRaw: ((outRaw * 995n) / 1000n).toString(),
    priceImpactPct: "0.01",
    route: [{ ...o.route[0], label: lst === INF ? "Sanctum Infinity" : "Sanctum", inputMint, outputMint, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString() }],
    ryntraFee: { ...o.ryntraFee, basisPoints: 10, requestedBasisPoints: 10, asset: inputMint },
    platformFee: { ...o.platformFee, basisPoints: 10 },
    totalFeeBasisPoints: 10,
    ...(taker && buying ? { rentFeeLamports: "2039280" } : {}),
  });
  body.decimals = { [SOL]: 9, [JUPSOL]: 9, [INF]: 9, [JITOSOL]: 9 };
  const expires = new Date(Date.now() + 45_000).toISOString();
  body.expiresAt = expires;
  o.reviewExpiresAt = expires;
  return body;
}

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.mobile ? 2 : 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    locale: LANG === "uk" ? "uk-UA" : "en-US",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `earn-${state}-${size.name}.png`) });

  // One stub wallet; signing waits for ever (the screens stop at the review line).
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

  let withEarn = true;
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // Coin logos come from Ryntra's icon route, which needs the network: on the stand, a lettered disc stands in.
  const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"], [JUPSOL]: ["J", "#1BB28C"], [INF]: ["∞", "#3B3B8F"], [JITOSOL]: ["J", "#2F9E6B"], [NVDAX]: ["N", "#76B900"] };
  await page.route("**/api/icon/*", (route) => {
    const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/city/earn", (route) => json(route, 200, FEED));
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: harborPools(CATALOG), at: "2026-10-16T09:12:00.000Z" }));
  await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: withEarn ? [{ mint: NVDAX, multiplier: 1.0071, newMultiplier: 1.0094, newMultiplierEffectiveAt: "2026-09-11T00:00:00.000Z" }] : [], at: new Date().toISOString() }));
  await page.route("**/api/solana/earn", (route) =>
    json(route, 200, {
      providers: [{ provider: "jupiter", ok: true, markets: [{ provider: "jupiter", id: "usdc", asset: { mint: USDC, symbol: "USDC", decimals: 6 }, share: { mint: USDC, symbol: "jlUSDC", decimals: 6 }, rateAnnualPercent: 4.83, suppliedRaw: null, liquidRaw: null, minimumRaw: null, priceUsd: 1, readAt: new Date().toISOString() }] }],
      positions: [],
      actions: { open: false, mode: "CLOSED", maxUsd: null },
      feeBps: 0,
      readAt: new Date().toISOString(),
    }),
  );
  await page.route("**/api/liquidity/positions?*", (route) =>
    json(route, 200, {
      owner: OWNER,
      positions: withEarn
        ? [
            positionView({ address: "7xJitoPier1111111111111111111111111111111111", name: "JitoSOL-SOL", x: { mint: JITOSOL, symbol: "JitoSOL", amount: 0.41, unclaimed: 0.0009, priceUsd: solPrice * WORTH[JITOSOL] }, y: { mint: SOL, symbol: "SOL", amount: 0.52, unclaimed: 0.0011, priceUsd: solPrice }, valueUsd: 0.41 * solPrice * WORTH[JITOSOL] + 0.52 * solPrice, unclaimedUsd: 0.002 * solPrice }),
            positionView({ address: "9xSolUsdcPier111111111111111111111111111111", rangeState: "above", name: "SOL-USDC", x: { mint: SOL, symbol: "SOL", amount: 0.3, unclaimed: 0, priceUsd: solPrice }, y: { mint: USDC, symbol: "USDC", amount: 0, unclaimed: 0, priceUsd: 1 }, valueUsd: 0.3 * solPrice, unclaimedUsd: 0 }),
          ]
        : [],
      venues: { dlmm: { ok: true }, "damm-v2": { ok: true } },
      at: Date.now(),
    }),
  );
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS(withEarn) } }));
  await page.route("**/api/solana/swap/quote", async (route) => {
    const { amountRaw, inputMint, outputMint } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300));
    json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, { taker: null, inputMint, outputMint }));
  });
  await page.route("**/api/solana/swap/order", async (route) => {
    const { input } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 400));
    json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, { taker: input.taker, inputMint: input.inputMint, outputMint: input.outputMint }));
  });
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

  // What the device keeps: one SOL Saver lot (2.5 SOL for 2.3141 JupSOL 120 days ago), last year's dividend step seen,
  // and SOL-2b's entry for the JitoSOL pier.
  await page.addInitScript(({ owner, jupsol, nvdax }) => {
    try {
      if (window.localStorage.getItem("ryntra.city.earn.seeded")) return;
      window.localStorage.setItem("ryntra.city.earn.seeded", "1");
      window.localStorage.setItem(`ryntra.city.earn.saver.v1:${owner}`, JSON.stringify([{ mint: jupsol, lstRaw: "2314100000", lamports: "2500000000", at: Date.now() - 86400000 * 120, signature: "5Lot" }]));
      window.localStorage.setItem("ryntra.city.earn.multipliers.v1", JSON.stringify([{ mint: nvdax, at: "2026-06-12T00:00:00.000Z", from: 1.0048, to: 1.0071 }, { mint: nvdax, at: "2026-03-14T00:00:00.000Z", from: 0.5024, to: 1.0048 }]));
      window.localStorage.setItem(`ryntra.pools.entries.v1:${owner}`, JSON.stringify({ "7xJitoPier1111111111111111111111111111111111": { x: 0.4, y: 0.54, usd: null, claimedUsd: 0.6, at: Date.now() - 86400000 * 20, source: "typed" } }));
    } catch {}
  }, { owner: OWNER, jupsol: JUPSOL, nvdax: NVDAX });

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => typeof window.__openEarn === "function", null, { timeout: 180_000 });
  await page.waitForTimeout(6000);

  const open = async (tab, product) => {
    await page.evaluate(([t, p]) => window.__openEarn(t, p ?? undefined), [tab, product]);
    // The window's code compiles on its first open in a development build.
    await page.getByRole("tab").first().waitFor({ timeout: 180_000 });
    await page.waitForTimeout(1800);
  };

  // No wallet: the Shelf and «Mine» asking to connect.
  await open("shelf");
  await shot("shelf");
  await open("mine");
  await shot("mine-connect");
  await open("shelf", "dollar");
  await page.waitForTimeout(1500);
  await shot("product-dollar");

  // Connect.
  await open("mine");
  await page.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);

  await open("mine");
  await page.waitForTimeout(1500);
  await shot("mine");
  await page.getByRole("button", { name: LANG === "uk" ? "Деталі" : "Details" }).first().click();
  await page.waitForTimeout(400);
  await shot("mine-headline-details");
  await page.getByRole("button", { name: LANG === "uk" ? "Деталі" : "Details" }).first().click();

  await open("piers");
  await shot("piers");

  await open("shelf", "saver");
  await page.waitForTimeout(2500);
  await shot("saver");
  await page.locator('[aria-label="' + (LANG === "uk" ? "Деталі" : "Details") + '"][aria-expanded="false"]').last().click();
  await page.waitForTimeout(900);
  await shot("saver-review-line");

  await open("shelf");
  await shot("shelf-connected");

  // A wallet with nothing in Earn yet: the same wallet read again with no LST, no pier and no stock.
  withEarn = false;
  await page.evaluate((owner) => {
    window.localStorage.removeItem(`ryntra.city.earn.saver.v1:${owner}`);
    window.__moneyStore.getState().readWallet();
    window.__earnData.getState().follow(owner);
  }, OWNER);
  await open("mine");
  await page.waitForTimeout(2500);
  await shot("mine-empty");

  if (errors.length) console.log(size.name, "errors:", errors.slice(0, 5));
  await context.close();
}

await browser.close();
console.log("shots in", out);
