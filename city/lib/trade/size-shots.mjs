// The trade card's amount (CITY-74) for review, at 390×844 and 1440×860 → <out>/size-<state>-<size>.png
//   node city/lib/trade/size-shots.mjs [out] [baseUrl]      (npm run dev running)
// Buying and selling: where the card opens, each chip, the slider in the middle, an amount of your own. No wallet and
// no keys: a stub wallet registers through the Wallet Standard events (it signs nothing, and nothing here is pressed),
// and the engine's swap routes answer with their own recorded transcripts, re-priced for the tower on screen. The
// figures are fixtures.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/size-shots");
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
const PRICE = { [SOL_MINT]: snapshot.towers.find((t) => t.id === SOL_MINT).price, [USDC_MINT]: 1, [tower.id]: tower.price };
const DECIMALS = { [SOL_MINT]: 9, [USDC_MINT]: 6, [tower.id]: 9 };

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

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/swap/quote", async (route) => {
    const { amountRaw, inputMint, outputMint } = route.request().postDataJSON();
    json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, inputMint, outputMint));
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

  await page.goto(`${base}/?coin=${SYMBOL}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  // The card through its development hook: the shots are of the card, wherever the city stands.
  await page.evaluate((coin) => window.__trade.getState().openFor(coin), { id: tower.id, symbol: tower.symbol, name: tower.name, icon: null });
  await page.waitForTimeout(1500);
  const sheet = page.getByRole("dialog");
  const card = sheet.first();
  // The card alone, so every shot reads the amount at the same size.
  const shot = (state) => card.screenshot({ path: path.join(out, `size-${state}-${size.name}.png`) });
  const settle = () => page.waitForTimeout(900);
  await shot("nowallet");

  await sheet.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(2500);

  const slider = sheet.getByRole("slider", { name: "Share of your balance" });
  const field = sheet.getByRole("textbox", { name: /^Amount in/ });
  const chips = sheet.getByRole("group", { name: "Share of your balance" });

  for (const side of ["buy", "sell"]) {
    await sheet.getByRole("tab", { name: side === "buy" ? "Buy" : "Sell" }).click();
    await settle();
    await shot(`${side}-start`);
    for (const label of ["25%", "50%", "75%", "MAX"]) {
      await chips.getByRole("button", { name: label }).click();
      await settle();
      await shot(`${side}-${label === "MAX" ? "max" : label.replace("%", "")}`);
    }
    // The slider dragged to the middle, between the chips.
    const box = await slider.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, y, { steps: 8 });
    await page.mouse.up();
    await settle();
    await shot(`${side}-slider`);
    const read = await slider.getAttribute("aria-valuetext");
    // An amount of your own: the slider stands at its share.
    await field.fill(side === "buy" ? "0.37" : "120");
    await settle();
    await shot(`${side}-own`);
    console.log(`${size.name} ${side}: slider ${read}; own → ${await slider.getAttribute("aria-valuetext")}`);
  }
  // Paying with USDC: the shares are of the USDC.
  await sheet.getByRole("tab", { name: "Buy" }).click();
  await settle();
  await sheet.getByRole("radiogroup", { name: "Pay with" }).getByRole("radio", { name: "USDC" }).click();
  await settle();
  await chips.getByRole("button", { name: "50%" }).click();
  await settle();
  await shot("buy-usdc-50");
  // The keyboard: End is MAX.
  await slider.focus();
  await page.keyboard.press("End");
  await settle();
  await shot("buy-usdc-keyboard-end");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${size.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
  await context.close();
}
await browser.close();
