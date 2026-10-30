// The tower's one window (CITY-78) for review, at 390×844 and 1440×860 → <out>/window-<state>-<size>.jpg
//   node city/lib/trade/tower-window-shots.mjs [out] [baseUrl]      (npm run dev running)
// A tower picked the way a tap picks it (the city's development hook), then: the one window, its Details, Buy, Sell
// with the coin in the wallet, Sell without it, and Sell before a wallet. No keys: a stub wallet registers through the
// Wallet Standard events (it signs nothing, and nothing here is pressed), and the engine's swap routes answer with
// their own recorded transcripts, re-priced for the tower on screen. The figures are fixtures.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/tower-window-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name) => structuredClone(golden[name].steps.at(-1).body);

const SYMBOL = process.env.COIN ?? "POPCAT";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
/** A second coin, one the stub wallet does not hold. */
const other = snapshot.towers.find((t) => t.verified && t.symbol === (process.env.OTHER ?? "PENGU"));
const PRICE = { [SOL_MINT]: snapshot.towers.find((t) => t.id === SOL_MINT).price, [USDC_MINT]: 1, [tower.id]: tower.price, [other.id]: other.price };
const DECIMALS = { [SOL_MINT]: 9, [USDC_MINT]: 6, [tower.id]: 9, [other.id]: 6 };

/** The recorded answer, re-priced: `amountRaw` of one side into the other at the snapshot's prices, less 1%. */
function priced(body, amountRaw, inputMint, outputMint) {
  const o = body.order;
  const value = ((Number(amountRaw) / 10 ** DECIMALS[inputMint]) * PRICE[inputMint]) / PRICE[outputMint];
  const outRaw = BigInt(Math.floor(value * 0.99 * 10 ** DECIMALS[outputMint]));
  Object.assign(o, {
    inputMint,
    outputMint,
    inAmountRaw: amountRaw,
    outAmountRaw: outRaw.toString(),
    minReceivedRaw: ((outRaw * 995n) / 1000n).toString(),
    priceImpactPct: "0.08",
    route: [{ ...o.route[0], label: "Meteora DLMM", inputMint, outputMint, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString() }],
    ryntraFee: { ...o.ryntraFee, basisPoints: 100, requestedBasisPoints: 100, asset: inputMint === tower.id ? outputMint : inputMint },
    platformFee: { ...o.platformFee, basisPoints: 100 },
    totalFeeBasisPoints: 100,
  });
  body.decimals = DECIMALS;
  const expires = new Date(Date.now() + 45_000).toISOString();
  body.expiresAt = expires;
  o.reviewExpiresAt = expires;
  return body;
}

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "desk", width: 1440, height: 860, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));

  await page.addInitScript(({ taker }) => {
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
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
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: TAKER });

  // The coin's passport on the price: a fixed supply and no freeze, as the chain says it of most memecoins.
  const withPassport = (body) => {
    const sol = body.passports[SOL_MINT];
    for (const coin of [tower, other]) body.passports[coin.id] = { ...sol, identity: { ...sol.identity, mint: coin.id } };
    return body;
  };
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/swap/quote", async (route) => {
    const { amountRaw, inputMint, outputMint } = route.request().postDataJSON();
    json(route, 200, withPassport(priced(step("quote: SOL to USDT with the referral fee"), amountRaw, inputMint, outputMint)));
  });
  await page.route("**/api/solana/swap/order", (route) => {
    const { input } = route.request().postDataJSON();
    json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, input.inputMint, input.outputMint));
  });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, {
      data: {
        tokenRead: "COMPLETE",
        holdings: [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
          { kind: "TOKEN", mint: USDC_MINT, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6 },
          { kind: "TOKEN", mint: tower.id, amountRaw: "240000000000", spendableRaw: "240000000000", decimals: 9 },
        ],
      },
    }),
  );
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(Number(process.env.WAIT ?? 9000));
  // The first-visit hint and anything else of the home out of the frame's way.
  await page.evaluate(() => localStorage.setItem("ryntra.city.firstHint", "1"));
  // A tap on the tower, as the canvas makes it: the city's selection.
  const picked = await page.evaluate((id) => {
    const city = window.__city.getState();
    if (!city.layout.towers.some((t) => t.tower.id === id)) return false;
    city.select(id);
    return true;
  }, tower.id);
  if (!picked) throw new Error(`${SYMBOL} does not stand in the city`);
  await page.waitForTimeout(4500);
  const dialogs = page.getByRole("dialog");
  const sheet = dialogs.first();
  const settle = () => page.waitForTimeout(1000);
  const frame = (state) => page.screenshot({ path: path.join(out, `window-${state}-${size.name}.jpg`), type: "jpeg", quality: 82 });
  const card = (state) => sheet.screenshot({ path: path.join(out, `window-${state}-${size.name}-card.jpg`), type: "jpeg", quality: 85 });
  const count = await dialogs.count();
  console.log(`${size.name}: windows after the tap = ${count}`);
  await frame("tap");
  await card("tap");

  await sheet.getByRole("button", { name: "Details", exact: true }).click();
  await settle();
  await card("details");
  await sheet.getByRole("button", { name: "Details", exact: true }).click();

  await sheet.getByRole("tab", { name: "Sell" }).click();
  await settle();
  await card("sell-nowallet");

  await sheet.getByRole("tab", { name: "Buy" }).click();
  await settle();
  await sheet.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(3000);
  await frame("buy");
  await card("buy");

  await sheet.getByRole("tab", { name: "Sell" }).click();
  await page.waitForTimeout(2500);
  await frame("sell");
  await card("sell");
  await sheet.getByRole("group", { name: "Share of your balance" }).getByRole("button", { name: "50%" }).click();
  await settle();
  await card("sell-50");

  // Another tower, one the wallet does not hold: Sell says so in one line.
  await page.evaluate((id) => window.__city.getState().select(id), other.id);
  await page.waitForTimeout(2200);
  await sheet.getByRole("tab", { name: "Sell" }).click();
  await settle();
  await card("sell-none");

  // Closed: the tower goes too, nothing of it is left on screen.
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({ selected: window.__city.getState().selectedId, open: window.__trade.getState().open }));
  console.log(`${size.name}: after Close → selected=${after.selected} open=${after.open} windows=${await dialogs.count()}`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${size.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
  await context.close();
}
await browser.close();
