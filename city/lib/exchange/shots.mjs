// The Exchange's screens for review, at 1440×860 and 390×844 → <out>/exchange-<state>-<size>.png
//   NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE=open npm run dev, then: node city/lib/exchange/shots.mjs [out] [baseUrl]
// No wallet and no keys are needed: a stub wallet registers through the Wallet Standard events (it signs nothing real).
// Phoenix's routes answer with the engine's shapes from `test-fixtures.mjs`; the figures on these screens are fixtures.
// The live pass — Phoenix's real markets, an account, the operator's canary — is the supervisor's and the operator's.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { account, BTC, collateralReview, figures, FILL, GOLD, market, margin, orderReview, OWNER, PUMP, SIG, SOL } from "./test-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "out/exchange-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "laptop", width: 1440, height: 860, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const SOL_MINT = "So11111111111111111111111111111111111111112";

const MARKETS = {
  markets: [
    SOL,
    BTC,
    market({ symbol: "ETH", name: "Ethereum", aliases: [], tickSize: 100, baseLotsDecimals: 4, markPrice: 3412.5, oraclePrice: 3411.9, prevDayMarkPrice: 3380, maxLeverage: 20, dayVolumeUsd: 40_500_000 }),
    market({ symbol: "FARTCOIN", name: "Fartcoin", aliases: [], tickSize: 1, baseLotsDecimals: 1, markPrice: 0.912, oraclePrice: 0.911, prevDayMarkPrice: 0.97, maxLeverage: 10, dayVolumeUsd: 6_400_000 }),
    market({ symbol: "JUP", name: "Jupiter", aliases: [], tickSize: 1, baseLotsDecimals: 1, markPrice: 0.884, oraclePrice: 0.884, prevDayMarkPrice: 0.86, maxLeverage: 10, dayVolumeUsd: 3_100_000 }),
    PUMP,
    GOLD,
  ],
  observedAt: Date.now(),
};

const POSITIONS = {
  ...account(),
  positions: [{ symbol: "SOL", subaccount: 0, side: "long", size: 4, entryPrice: 147.2, tpPrice: 165, slPrice: 140 }],
  margin: margin(),
};

const TRADES = {
  wallet: OWNER,
  symbol: null,
  trades: [
    { id: "t1", at: Date.now() - 3_600_000, symbol: "SOL", side: "buy", sizeUnits: 4, priceUsd: 147.2, feeUsd: 0.206, realizedPnlUsd: 0, liquidity: "taker", kind: "market", signature: SIG },
    { id: "t2", at: Date.now() - 86_400_000, symbol: "BTC", side: "sell", sizeUnits: 0.01, priceUsd: 68_120, feeUsd: 0.238, realizedPnlUsd: 8.4, liquidity: "taker", kind: "market", signature: SIG },
  ],
  realizedPnlUsd: 8.4,
  feesUsd: 0.444,
  observedAt: Date.now(),
};

/** SOL's book around $150: ten levels each side, deeper away from the price. */
const BOOK = {
  symbol: "SOL",
  slot: 1,
  asks: Array.from({ length: 12 }, (_, index) => ({ price: Number((150.02 + index * 0.03).toFixed(2)), size: Number((1.4 + index * 1.7 + (index % 3) * 2.1).toFixed(2)) })),
  bids: Array.from({ length: 12 }, (_, index) => ({ price: Number((149.98 - index * 0.03).toFixed(2)), size: Number((2.2 + index * 1.5 + (index % 4) * 1.3).toFixed(2)) })),
};

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  // A software GPU draws the city slowly: the first paint of a page may take a while on the phone's double density.
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU|404|503/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `exchange-${state}-${size.name}.png`) });

  // One stub wallet; signing waits until the script lets it go.
  await page.addInitScript(({ owner }) => {
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    let release = null;
    window.__releaseSignature = () => release?.();
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
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { owner: OWNER });

  // What the account route answers: an account with a long, or none (Phoenix's accounts are by invite).
  let state = { account: POSITIONS, orders: { open: true, maxNotionalUsd: 20, builder: false, builderBps: null } };
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/futures/markets", (route) => json(route, 200, MARKETS));
  await page.route("**/api/solana/futures/funding?*", (route) => json(route, 200, { symbol: "SOL", ratePercent: 0.0012, at: Date.now() - 600_000, periodSeconds: 3600, observedAt: Date.now() }));
  await page.route("**/api/solana/futures/account?*", (route) => json(route, 200, { ...state.account, observedAt: Date.now() }));
  await page.route("**/api/solana/futures/orders?*", (route) => json(route, 200, state.orders));
  await page.route("**/api/solana/futures/collateral?*", (route) => json(route, 200, { deposit: true, withdraw: true, maxMicro: "5000000", maxDeposit: "5000000", walletUsdc: "184000000" }));
  await page.route("**/api/solana/futures/ticket?*", (route) => {
    const sizeLots = new URL(route.request().url()).searchParams.get("size");
    // A wallet without a Phoenix account has nothing for the calculator to count.
    if (state.account.state === "none") return json(route, 200, figures({ account: null, maxLots: null, order: null }));
    json(route, 200, figures(sizeLots ? {} : { order: null }));
  });
  await page.route("**/api/solana/futures/history?*", (route) => json(route, 200, TRADES));
  await page.route("**/api/solana/futures/book?*", (route) => json(route, 200, { ...BOOK, observedAt: Date.now() }));
  await page.route("**/api/solana/futures/orders/review", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    const body = route.request().postDataJSON();
    json(route, 200, orderReview({ sizeLots: body.size, sizeUnits: String(Number(body.size) / 1000), notionalUsd: (Number(body.size) / 1000) * 150.75, tpUsd: body.tp ? Number(body.tp) / 100 : null, slUsd: body.sl ? Number(body.sl) / 100 : null }));
  });
  await page.route("**/api/solana/futures/orders/submit", (route) => json(route, 200, { results: [{ signature: SIG, state: "LANDED", reason: null, fills: [{ ...FILL, sizeUnits: 0.1 }] }], settled: true }));
  await page.route("**/api/solana/futures/collateral/review", (route) => json(route, 200, collateralReview()));
  await page.route("**/api/solana/holdings*", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 }] } }));

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  const overflow = [];
  const measure = async (label) => overflow.push([label, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)]);

  // 1. The dock with the Exchange.
  await shot("dock");

  // 2. A tower card with «Trade futures».
  await page.goto(`${base}/c/${SOL_MINT}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Trade futures/ }).waitFor();
  await page.waitForTimeout(5000);
  await shot("tower");
  await page.getByRole("button", { name: /Trade futures/ }).click();
  await page.waitForTimeout(1500);
  const dialog = page.getByRole("dialog", { name: "Exchange" });

  // 3. The window without a wallet.
  await shot("connect");
  await measure("connect");

  // 4. The wallet connected: the account, its health and the position; the ticket filled in.
  await dialog.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(2500);
  if (size.mobile) {
    await dialog.getByRole("tab", { name: /Positions/ }).click();
    await page.waitForTimeout(600);
    await shot("positions");
    await dialog.getByRole("tab", { name: "Trade" }).click();
  }
  await dialog.getByRole("radio", { name: /Long/ }).click();
  await dialog.getByRole("button", { name: "5×" }).click();
  // A share of the free collateral: the chip, the slider and the dollars in the field move together.
  await dialog.getByRole("button", { name: "50%" }).click();
  await page.waitForTimeout(1500);
  await shot("share");
  await dialog.getByLabel("Position size, USD").fill("15");
  await dialog.getByRole("button", { name: "TP / SL" }).click();
  await dialog.getByLabel("Take profit price, USD").fill("165");
  await dialog.getByLabel("Stop loss price, USD").fill("140");
  await page.waitForTimeout(1500);
  await shot("ticket");
  await measure("ticket");

  // 5. The Review.
  await dialog.getByRole("button", { name: "Review long" }).click();
  await page.waitForTimeout(1500);
  await shot("review");

  // 6. Signed and filled.
  await dialog.getByRole("button", { name: "Sign in wallet" }).click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__releaseSignature());
  await page.waitForTimeout(2000);
  await shot("filled");
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(500);

  // 7. The market's order book, a tab of its own.
  await dialog.getByRole("tab", { name: "Book" }).click();
  await page.waitForTimeout(1500);
  await shot("book");
  await measure("book");

  // 7b. The orders, each with its cancel.
  await dialog.getByRole("tab", { name: /Orders/ }).click();
  await page.waitForTimeout(600);
  await shot("orders");

  // 7c. A position's TP/SL.
  await dialog.getByRole("tab", { name: /Positions/ }).click();
  await page.waitForTimeout(600);
  await dialog.getByRole("button", { name: "TP/SL" }).first().click();
  await page.waitForTimeout(400);
  await shot("tpsl");
  await dialog.getByRole("button", { name: "TP/SL" }).first().click();

  // 7d. History.
  await dialog.getByRole("tab", { name: "History" }).click();
  await page.waitForTimeout(1200);
  await shot("history");

  // 8. The market picker.
  await dialog.getByRole("button", { name: "Choose a market" }).click();
  await page.waitForTimeout(600);
  await shot("markets");
  await dialog.getByRole("button", { name: "Choose a market" }).click();

  // 9. A wallet Phoenix has no account for, and orders closed for it: said as the engine answers.
  state = { account: { wallet: OWNER, state: "none", collateralUsd: null, collateralSol: null, positions: [], orders: [] }, orders: { open: false, maxNotionalUsd: null, builder: false } };
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForTimeout(400);
  // Without a wallet the phone shows the trade view alone, with no tabs to pick from.
  if (size.mobile && (await dialog.getByRole("tab", { name: "Trade" }).count())) await dialog.getByRole("tab", { name: "Trade" }).click();
  await dialog.getByRole("button", { name: "Phantom" }).first().click();
  await page.waitForTimeout(3000);
  await dialog.getByText("Open a Phoenix account").first().waitFor();
  await shot("invite");
  await measure("invite");

  console.log(`${size.name}: horizontal overflow ${JSON.stringify(overflow)}; errors ${errors.length ? errors.join(" | ") : "none"}`);
  await context.close();
}
await browser.close();
