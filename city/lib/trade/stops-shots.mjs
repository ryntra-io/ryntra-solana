// CITY-149's screens for review — a stop the engine keeps: the ticket's line, its «i», «Stop set», and the tap on the
// reached stop's note landing on its sale — at 390×844 and 1440×900 → <out>/<state>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_SPOT=open NEXT_PUBLIC_RYNTRA_CITY_STOPS=open npm run dev
//   node city/lib/trade/stops-shots.mjs [out] [baseUrl]     (SIZES=phone,laptop · PARTS=ticket,tap · LANG_CITY=en|uk)
// No wallet and no keys: a stub wallet registers through the Wallet Standard events (it signs nothing real), the
// session says the wallet already proved itself, the swap quote answers with its recorded transcript re-priced for the
// coin on screen, and `/api/v1/stops` answers as the engine does. LANG_CITY=uk takes the Ukrainian screens.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/stops-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const LANG = process.env.LANG_CITY ?? "en";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name, at = -1) => structuredClone(golden[name].steps.at(at).body);

const SYMBOL = process.env.COIN ?? "SOL";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL) ?? snapshot.towers.find((t) => t.id === SOL_MINT);
const PRICE = { [SOL_MINT]: snapshot.towers.find((t) => t.id === SOL_MINT)?.price ?? 180, [USDC_MINT]: 1, [tower.id]: tower.price };
const DECIMALS = { [SOL_MINT]: 9, [USDC_MINT]: 6, [tower.id]: tower.id === SOL_MINT ? 9 : 6 };
const STOP_PRICE = (PRICE[tower.id] * 0.92).toFixed(2);
const STOP_ID = "stp_7f3a9c0e5b1d2a4c6e8f";

function priced(body, amountRaw, { inputMint, outputMint }) {
  const o = body.order;
  const value = ((Number(amountRaw) / 10 ** DECIMALS[inputMint]) * PRICE[inputMint]) / PRICE[outputMint];
  const outRaw = BigInt(Math.floor(value * 0.99 * 10 ** DECIMALS[outputMint]));
  Object.assign(o, { inputMint, outputMint, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString(), minReceivedRaw: ((outRaw * 995n) / 1000n).toString(), priceImpactPct: "0.04" });
  body.decimals = DECIMALS;
  const expires = new Date(Date.now() + 45_000).toISOString();
  body.expiresAt = expires;
  o.reviewExpiresAt = expires;
  return body;
}

const engineStop = (state) => ({
  id: STOP_ID,
  side: "sell",
  base: { mint: tower.id, symbol: tower.symbol.replace(/^\$/, ""), name: tower.name, decimals: DECIMALS[tower.id] },
  quote: { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
  amountRaw: String(10 ** DECIMALS[tower.id]),
  price: STOP_PRICE,
  thresholdRaw: String(Math.floor(Number(STOP_PRICE) * 1e6)),
  createdAt: Date.now() - 3 * 3600_000,
  expiresAt: Date.now() + 7 * 86_400_000,
  state,
  reachedAt: state === "reached" ? Date.now() - 40_000 : null,
});

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1440, height: 900, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
/** `PARTS=ticket,tap` — which screens to take; both by default. */
const PARTS = (process.env.PARTS ?? "ticket,tap").split(",");
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

async function prepare(context, { reached }) {
  const page = await context.newPage();
  // A software-rendered city on a large desk draws slowly: actions and shots wait for its frames.
  page.setDefaultTimeout(240_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(({ taker, lang }) => {
    try {
      localStorage.setItem("ryntra.city.lang", lang);
    } catch {}
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { taker: TAKER, lang: LANG });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/swap/quote", async (route) => {
    const { amountRaw, inputMint, outputMint } = route.request().postDataJSON();
    json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, { inputMint, outputMint }));
  });
  await page.route("**/api/solana/swap/order", async (route) => {
    const { input } = route.request().postDataJSON();
    json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, { inputMint: input.inputMint, outputMint: input.outputMint }));
  });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9, symbol: "SOL" }, { kind: "TOKEN", mint: USDC_MINT, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6, catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } }] } }),
  );
  await page.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: true, walletAddress: TAKER, proof: { address: TAKER, via: "signin", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, at: Date.now() }));
  await page.route("**/api/solana/limits/market", (route) => {
    const { baseMint, quoteMint } = route.request().postDataJSON();
    json(route, 200, { price: PRICE[baseMint] / PRICE[quoteMint], baseUsd: PRICE[baseMint], quoteUsd: PRICE[quoteMint], dlmm: { available: false, code: "NO_POOL" }, observedAt: new Date().toISOString() });
  });
  await page.route("**/api/solana/limits/orders", (route) => json(route, 200, { orders: [], tokens: {}, complete: true }));
  await page.route("**/api/v1/stops", (route) => {
    if (route.request().method() === "POST") return json(route, 201, { stop: { ...engineStop("watching"), ...route.request().postDataJSON(), thresholdRaw: engineStop("watching").thresholdRaw, createdAt: Date.now(), state: "watching", reachedAt: null, expiresAt: Date.now() + 7 * 86_400_000 } });
    return json(route, 200, { stops: reached ? [engineStop("reached")] : [], max: 20 });
  });
  return { page, errors };
}

const words = LANG === "uk"
  ? { search: "Шукати монети", combo: "Тікер, назва чи адреса мінта", trade: (s) => `Торгувати $${s}`, connect: "Підключити гаманець", sell: "Продати", stop: "Стоп", priceBox: /^Продати, якщо впаде до/, how: "Як працює стоп", setStop: /^Поставити стоп/ }
  : { search: "Search coins", combo: "Ticker, name or mint address", trade: (s) => `Trade $${s}`, connect: "Connect wallet", sell: "Sell", stop: "Stop", priceBox: /^Sell if it falls to/, how: "How a stop works", setStop: /^Set stop/ };

for (const size of SIZES) {
  const shotOf = (page) => async (state) => {
    await page.screenshot({ path: path.join(out, `${state}-${size.name}-${LANG}.jpg`), type: "jpeg", quality: 82, timeout: 240_000 });
    console.log(`  ${state}-${size.name}-${LANG}`);
  };
  const contextOf = () => browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });

  // The ticket: a stop set to be watched by the engine.
  if (PARTS.includes("ticket")) {
    const context = await contextOf();
    const { page, errors } = await prepare(context, { reached: false });
    const shot = shotOf(page);
    await page.goto(`${base}/c/${tower.id}${size.mobile ? "" : "?quality=low"}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(12000);
    for (const name of ["Got it", "Later", "Зрозуміло", "Пізніше"]) {
      const button = page.getByRole("button", { name, exact: true });
      if (await button.count()) await button.first().click().catch(() => {});
    }
    await page.waitForTimeout(800);
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("tab", { name: words.stop }) }).first();
    const connect = sheet.getByRole("button", { name: words.connect });
    if (await connect.count()) {
      await connect.first().click({ force: true });
      await page.waitForTimeout(3500);
    }
    await sheet.getByRole("tab", { name: words.sell }).click({ force: true });
    await page.waitForTimeout(600);
    await sheet.getByRole("tab", { name: words.stop }).click({ force: true });
    await page.waitForTimeout(2500);
    const box = sheet.getByRole("textbox", { name: words.priceBox });
    await box.fill(STOP_PRICE);
    await box.blur();
    // The card's own scroll to its end: the price field above the line and the button, as a person scrolls to it.
    const toEnd = () =>
      box.evaluate((el) => {
        for (let node = el.parentElement; node; node = node.parentElement) if (node.scrollHeight > node.clientHeight + 4 && getComputedStyle(node).overflowY !== "visible") node.scrollTop = node.scrollHeight;
      });
    await toEnd();
    await page.waitForTimeout(900);
    await shot("stop-ticket");
    await sheet.getByRole("button", { name: words.how }).click();
    await page.waitForTimeout(500);
    await toEnd();
    await page.waitForTimeout(400);
    await shot("stop-details");
    await sheet.getByRole("button", { name: words.how }).click();
    await sheet.getByRole("button", { name: words.setStop }).click();
    await page.waitForTimeout(2000);
    await shot("stop-set");
    console.log(`${size.name}: errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
    await context.close();
  }

  // The tap on the note: the city opens on the coin with the stop named, its sale on the card for the wallet to sign.
  if (PARTS.includes("tap")) {
    const context = await contextOf();
    const { page, errors } = await prepare(context, { reached: true });
    const shot = shotOf(page);
    await page.goto(`${base}/c/${tower.id}?stop=${STOP_ID}${size.mobile ? "" : "&quality=low"}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(12000);
    for (const name of ["Got it", "Later", "Зрозуміло", "Пізніше"]) {
      const button = page.getByRole("button", { name, exact: true });
      if (await button.count()) await button.first().click().catch(() => {});
    }
    const connect = page.getByRole("button", { name: words.connect });
    if (await connect.count()) {
      await connect.first().click({ force: true });
      await page.waitForTimeout(25000);
    }
    await shot("note-tap-sale");
    console.log(`${size.name} tap: url=${new URL(page.url()).search || "(clean)"} errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
    await context.close();
  }
}
await browser.close();
