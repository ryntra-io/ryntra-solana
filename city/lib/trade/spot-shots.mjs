// CITY-62's screens for review — any coin for any coin, a limit order, a stop and «My orders» — at 390×844 and
// 1440×900 → <out>/<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_SPOT=open npm run dev     then     node city/lib/trade/spot-shots.mjs [out] [baseUrl]
// No wallet and no keys: a stub wallet registers through the Wallet Standard events (it signs nothing real), the swap
// routes answer with their own recorded transcripts re-priced for the coins on screen, and the limits routes answer
// with Reviews and orders shaped as the engine shapes them. The figures here are fixtures; the live pass with a real
// wallet — and the operator's canary of a small limit order — is done on production.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/spot-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name, at = -1) => structuredClone(golden[name].steps.at(at).body);

const SYMBOL = process.env.COIN ?? "POPCAT";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
const towerPrice = (mint) => snapshot.towers.find((t) => t.id === mint)?.price;
const PRICE = { [SOL_MINT]: towerPrice(SOL_MINT), [USDC_MINT]: 1, [JUP]: towerPrice(JUP) ?? 0.28, [BONK]: 0.0000181, [tower.id]: tower.price };
const DECIMALS = { [SOL_MINT]: 9, [USDC_MINT]: 6, [JUP]: 6, [BONK]: 5, [tower.id]: 9 };

/** The recorded answer, re-priced: `amountRaw` of one coin into the other at the snapshot's prices, the meme rate of 1%. */
function priced(body, amountRaw, { taker, inputMint, outputMint }) {
  const o = body.order;
  const value = ((Number(amountRaw) / 10 ** DECIMALS[inputMint]) * PRICE[inputMint]) / PRICE[outputMint];
  const outRaw = BigInt(Math.floor(value * 0.99 * 10 ** DECIMALS[outputMint]));
  Object.assign(o, {
    inputMint,
    outputMint,
    inAmountRaw: amountRaw,
    outAmountRaw: outRaw.toString(),
    minReceivedRaw: ((outRaw * 995n) / 1000n).toString(),
    priceImpactPct: "0.11",
    route: [{ ...o.route[0], label: "Meteora DLMM", inputMint, outputMint, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString() }, { ...o.route[0], label: "Raydium CLMM" }],
    ryntraFee: { ...o.ryntraFee, basisPoints: 100, requestedBasisPoints: 100, asset: inputMint },
    platformFee: { ...o.platformFee, basisPoints: 100 },
    totalFeeBasisPoints: 100,
    ...(taker ? { rentFeeLamports: "2039280" } : {}),
  });
  body.decimals = DECIMALS;
  const expires = new Date(Date.now() + 45_000).toISOString();
  body.expiresAt = expires;
  o.reviewExpiresAt = expires;
  return body;
}

/** Six significant digits, the limits engine's way of writing a price. */
const typed = (value) => {
  const digits = Math.min(Math.max(0, 6 - Math.floor(Math.log10(value)) - 1), 18);
  return value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
};

/** A Review as `/api/solana/limits/review` answers: Jupiter Trigger, Ryntra's fee on top of what is delivered. */
function limitReview({ side, baseMint, quoteMint, amount, price }) {
  const bd = DECIMALS[baseMint];
  const qd = DECIMALS[quoteMint];
  const p = Number(price);
  const making = BigInt(Math.round(Number(amount) * 10 ** (side === "buy" ? qd : bd)));
  const taking = side === "buy" ? BigInt(Math.ceil((Number(amount) / p) * 10 ** bd)) : BigInt(Math.ceil(Number(amount) * p * 10 ** qd));
  return {
    venue: "trigger",
    side,
    order: "7Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S",
    requestId: "req-1",
    pool: null,
    transactionBase64: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    pair: { baseMint, baseDecimals: bd, quoteMint, quoteDecimals: qd },
    inputMint: side === "buy" ? quoteMint : baseMint,
    outputMint: side === "buy" ? baseMint : quoteMint,
    makingRaw: making.toString(),
    takingRaw: taking.toString(),
    price,
    fillPrice: side === "buy" ? p / 1.01 : p * 1.01,
    fee: { ryntraBps: 100, venueBps: 0, ryntraFeeRaw: (taking / 100n).toString(), venueFeeRaw: "0", reason: "RYNTRA", account: "8ZhHtYcJmGLLwG6JcNH3RnNcBwmN4W6Q4PZ3Twr3Fzi3" },
    networkFeeLamports: 15000,
    depositLamports: 2_282_880,
    makerFeeShare: false,
    builtAt: new Date().toISOString(),
    signableMs: 25_000,
    risk: { verdict: "NO_KNOWN_BLOCKER", facts: [] },
  };
}

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1440, height: 900, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = async (state) => {
    await page.screenshot({ path: path.join(out, `${state}-${size.name}.jpg`), type: "jpeg", quality: 82 });
    console.log(`  ${state}-${size.name}`);
  };

  // A stub wallet in the Wallet Standard registry; signing waits until the script lets it go.
  await page.addInitScript(({ taker }) => {
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
  }, { taker: TAKER });

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/swap/quote", async (route) => {
    const { amountRaw, inputMint, outputMint } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 400));
    json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, { taker: null, inputMint, outputMint }));
  });
  await page.route("**/api/solana/swap/order", async (route) => {
    const { input } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 600));
    json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, { taker: input.taker, inputMint: input.inputMint, outputMint: input.outputMint }));
  });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, {
      data: {
        tokenRead: "COMPLETE",
        holdings: [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9, symbol: "SOL" },
          { kind: "TOKEN", mint: USDC_MINT, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6, catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
          { kind: "TOKEN", mint: JUP, amountRaw: "1200000000", spendableRaw: "1200000000", decimals: 6, catalog: { symbol: "JUP", name: "Jupiter", isVerified: true } },
          { kind: "TOKEN", mint: tower.id, amountRaw: "2400000000000", spendableRaw: "2400000000000", decimals: 9, catalog: { symbol: SYMBOL, name: tower.name, isVerified: true } },
        ],
      },
    }),
  );
  await page.route("**/api/solana/tokens/search", (route) =>
    json(route, 200, { tokens: [{ mint: BONK, symbol: "Bonk", name: "Bonk", icon: null, isVerified: true, isSuspicious: false }] }),
  );
  await page.route("**/api/search", (route) => json(route, 200, { coins: [{ mint: BONK, symbol: "BONK", name: "Bonk", icon: null }], memes: [], dollars: [] }));
  await page.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

  // The limits lane.
  let placed = null;
  await page.route("**/api/solana/limits/market", (route) => {
    const { baseMint, quoteMint } = route.request().postDataJSON();
    json(route, 200, { price: PRICE[baseMint] / PRICE[quoteMint], baseUsd: PRICE[baseMint], quoteUsd: PRICE[quoteMint], dlmm: { available: false, code: "NO_POOL" }, observedAt: new Date().toISOString() });
  });
  await page.route("**/api/solana/limits/review", async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    json(route, 200, { review: limitReview(route.request().postDataJSON()) });
  });
  await page.route("**/api/solana/limits/submit", async (route) => {
    const body = route.request().postDataJSON();
    if (body.kind === "place") placed = body.terms;
    json(route, 200, { state: body.kind === "place" ? "OPEN" : "CANCELLED", signature: "5vZ8cJ2u2zT6mXqWQh8m3y1Hc7m9u5QnYbN2y6RkS4wV7fWJdC1bXgF3zH8aK9pLm2nQ4rS6tU8vW1xY3zA5bC7d", settled: true });
  });
  await page.route("**/api/solana/limits/orders", (route) => {
    const at = new Date(Date.now() - 3 * 3600_000).toISOString();
    const orders = [];
    if (placed) {
      orders.push({ key: `${TAKER}:trigger:new`, venue: "trigger", order: "7Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S", side: placed.side, baseMint: placed.baseMint, quoteMint: placed.quoteMint, inputMint: placed.inputMint, outputMint: placed.outputMint, makingRaw: placed.makingRaw, takingRaw: placed.takingRaw, filledInputRaw: "0", filledOutputRaw: "0", ryntraFeeRaw: "0", ryntraBps: 100, fillPrice: placed.fillPrice, state: "OPEN", placeSignature: "s", cancelSignature: null, fills: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), throughRyntra: true, canCancel: true, canClaim: false, pool: null });
    }
    orders.push(
      { key: `${TAKER}:trigger:jup`, venue: "trigger", order: "9Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S", side: "sell", baseMint: JUP, quoteMint: USDC_MINT, inputMint: JUP, outputMint: USDC_MINT, makingRaw: "400000000", takingRaw: "140000000", filledInputRaw: "160000000", filledOutputRaw: "56000000", ryntraFeeRaw: "560000", ryntraBps: 100, fillPrice: 0.3535, state: "PARTIAL", placeSignature: "s", cancelSignature: null, fills: [], createdAt: at, updatedAt: at, throughRyntra: true, canCancel: true, canClaim: false, pool: null },
      { key: `${TAKER}:trigger:old`, venue: "trigger", order: "6Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S", side: "buy", baseMint: tower.id, quoteMint: SOL_MINT, inputMint: SOL_MINT, outputMint: tower.id, makingRaw: "500000000", takingRaw: "1300000000000", filledInputRaw: "500000000", filledOutputRaw: "1300000000000", ryntraFeeRaw: "0", ryntraBps: 100, fillPrice: 0.000388, state: "FILLED", placeSignature: "s", cancelSignature: null, fills: [], createdAt: at, updatedAt: at, throughRyntra: true, canCancel: false, canClaim: false, pool: null },
    );
    json(route, 200, { orders, tokens: { [tower.id]: { symbol: SYMBOL, decimals: 9 }, [JUP]: { symbol: "JUP", decimals: 6 } }, complete: true });
  });

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // The first visit's hint and the arrivals card step aside, as a returning person has them.
  for (const name of ["Got it", "Later"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count()) await button.first().click().catch(() => {});
  }
  await page.waitForTimeout(500);

  // The coin by the city's search: its tower is flown to and its card opens.
  await page.getByRole("button", { name: "Search coins" }).click();
  await page.getByRole("combobox", { name: "Ticker, name or mint address" }).fill(SYMBOL);
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: `Buy $${SYMBOL}` }).click();
  await page.waitForTimeout(1500);
  const sheet = page.getByRole("dialog", { name: `Trade $${SYMBOL}` });
  await sheet.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(3500);

  // Any coin of the wallet pays: the picker lists them with what can be spent.
  await sheet.getByRole("button", { name: "Pay with another coin" }).click();
  await page.waitForTimeout(800);
  await shot("swap-pay-picker");
  await sheet.getByRole("button", { name: /^\$JUP/ }).click();
  await page.waitForTimeout(3500);
  await shot("swap-pay-jup");

  // Selling into any coin the search finds.
  await sheet.getByRole("tab", { name: "Sell" }).click();
  await page.waitForTimeout(1500);
  await sheet.getByRole("button", { name: "Get another coin" }).click();
  await page.waitForTimeout(500);
  await sheet.getByRole("searchbox", { name: "Search any coin" }).fill("bonk");
  await page.waitForTimeout(1500);
  await shot("swap-get-search");
  await sheet.getByRole("button", { name: /^\$BONK/ }).first().click();
  await page.waitForTimeout(3500);
  await shot("swap-sell-bonk");

  // A limit order: the price starts at the market's; the Review shows every fee before the wallet.
  await sheet.getByRole("tab", { name: "Buy" }).click();
  await page.waitForTimeout(500);
  await sheet.getByRole("radiogroup", { name: "Pay with" }).getByRole("radio", { name: "USDC" }).click();
  await page.waitForTimeout(800);
  await sheet.getByRole("tab", { name: "Limit" }).click();
  await page.waitForTimeout(2000);
  const price = sheet.getByRole("textbox", { name: /^Buy at/ });
  await price.fill(typed((PRICE[tower.id] / PRICE[USDC_MINT]) * 0.9));
  await page.waitForTimeout(600);
  await shot("limit");
  await sheet.getByRole("button", { name: "Review order" }).click();
  await page.waitForTimeout(1800);
  await sheet.getByRole("button", { name: "Order details" }).click();
  await page.waitForTimeout(400);
  await shot("limit-review");
  await sheet.getByRole("button", { name: "Order details" }).click();
  await sheet.getByRole("button", { name: /^Place buy order/ }).click();
  await page.waitForTimeout(800);
  await shot("limit-wallet");
  await page.evaluate(() => window.__releaseSignature());
  await page.waitForTimeout(2000);
  await shot("limit-placed");

  // A stop: watched on this device; the card says so before it is set.
  await sheet.getByRole("button", { name: "New order" }).click();
  await page.waitForTimeout(400);
  await sheet.getByRole("tab", { name: "Sell" }).click();
  await page.waitForTimeout(600);
  await sheet.getByRole("tab", { name: "Stop" }).click();
  await page.waitForTimeout(2500);
  await sheet.getByRole("textbox", { name: /^Sell if price falls to/ }).fill(typed((PRICE[tower.id] / PRICE[USDC_MINT]) * 0.8));
  await page.waitForTimeout(800);
  await shot("stop");
  await sheet.getByRole("button", { name: /^Set stop/ }).click();
  await page.waitForTimeout(800);
  await shot("stop-set");

  // «My orders»: the open limit, the part-filled one, the stop, and what closed.
  await sheet.getByRole("button", { name: "My orders" }).click();
  await page.waitForTimeout(2500);
  await shot("orders");

  console.log(`${size.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
  await context.close();
}
await browser.close();
