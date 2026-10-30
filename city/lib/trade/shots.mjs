// The trade card's screens for review, at 390×844 and 1440×860 → <out>/trade-<state>-<size>.png
//   node city/lib/trade/shots.mjs [out] [baseUrl]      (npm run dev running)
// No wallet and no keys are needed: a stub wallet registers through the Wallet Standard events (it signs nothing real),
// and the engine's swap routes answer with the swap routes' own recorded transcripts, re-priced for the tower on
// screen. The figures on these screens are fixtures; the live pass with a real wallet is done on production.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/trade-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name, at = -1) => structuredClone(golden[name].steps.at(at).body);

const SYMBOL = process.env.COIN ?? "POPCAT";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
const solPrice = snapshot.towers.find((t) => t.id === SOL_MINT).price;
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PRICE = { [SOL_MINT]: solPrice, [USDC_MINT]: 1, [tower.id]: tower.price };
const DECIMALS = { [SOL_MINT]: 9, [USDC_MINT]: 6, [tower.id]: 9 };

/** The recorded answer, re-priced: `amountRaw` of one side into the other at the snapshot's prices, the meme rate of 1%. */
function priced(body, amountRaw, { taker, inputMint = SOL_MINT, outputMint = inputMint === tower.id ? SOL_MINT : tower.id }) {
  const o = body.order;
  const selling = inputMint === tower.id;
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
    ryntraFee: { ...o.ryntraFee, basisPoints: 100, requestedBasisPoints: 100, asset: selling ? outputMint : inputMint },
    platformFee: { ...o.platformFee, basisPoints: 100 },
    totalFeeBasisPoints: 100,
    ...(taker && !selling ? { rentFeeLamports: "2039280" } : {}),
  });
  body.decimals = DECIMALS;
  const expires = new Date(Date.now() + 45_000).toISOString();
  body.expiresAt = expires;
  o.reviewExpiresAt = expires;
  return body;
}

const ALL = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1440, height: 860, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;

// PRESS_CHROME may point at a Chromium, as for the city's own screens.
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
  const shot = (state) => page.screenshot({ path: path.join(out, `trade-${state}-${size.name}.png`) });

  // Two stub wallets in the Wallet Standard registry; signing waits until the script lets it go.
  await page.addInitScript(({ taker }) => {
    const icon = (fill) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="${fill}"/></svg>`)}`;
    let release = null;
    window.__releaseSignature = () => release?.();
    const make = (name, fill) => {
      const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
      const wallet = {
        version: "1.0.0",
        name,
        icon: icon(fill),
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
              // A stand-in signature: the stub signs nothing; the mocked engine accepts it.
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
      return wallet;
    };
    const wallets = [make("Phantom", "#AB9FF2"), make("Solflare", "#FFEF46")];
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(...wallets));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(...wallets) }));
  }, { taker: TAKER });

  // The engine's routes, answered from the recorded transcripts.
  let bought = false;
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/solana/swap/quote", async (route) => {
    const { amountRaw, inputMint, outputMint } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 500));
    json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, { taker: null, inputMint, outputMint }));
  });
  await page.route("**/api/solana/swap/order", async (route) => {
    const { input } = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 700));
    json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, { taker: input.taker, inputMint: input.inputMint, outputMint: input.outputMint }));
  });
  await page.route("**/api/solana/swap/execute", (route) => {
    const body = step("execute: exact bytes through Jupiter settle MATCHED with a Receipt");
    const sent = priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), "100000000", { taker: TAKER });
    body.observation.actualInputRaw = sent.order.inAmountRaw;
    body.observation.actualOutputRaw = sent.order.outAmountRaw;
    bought = true;
    json(route, 200, body);
  });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, {
      data: {
        tokenRead: "COMPLETE",
        holdings: [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
          { kind: "TOKEN", mint: JUP, amountRaw: "120000000", spendableRaw: "120000000", decimals: 6 },
          { kind: "TOKEN", mint: USDC_MINT, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6 },
          ...(bought ? [{ kind: "TOKEN", mint: tower.id, amountRaw: "240000000000", spendableRaw: "240000000000", decimals: 9 }] : []),
        ],
      },
    }),
  );
  await page.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/auth/solana?*", (route) => json(route, 200, { input: { domain: "localhost", address: TAKER, statement: "Sign in to Ryntra", uri: base, version: "1", chainId: "mainnet", nonce: "abc123", issuedAt: new Date().toISOString(), expirationTime: new Date(Date.now() + 600_000).toISOString() }, message: "localhost wants you to sign in with your Solana account" }));

  await page.goto(`${base}/?coin=${SYMBOL}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.getByRole("button", { name: `Fly to $${SYMBOL}` }).click();
  await page.waitForTimeout(3500);
  await shot("tower");

  await page.getByRole("button", { name: `Buy $${SYMBOL}` }).click();
  await page.waitForTimeout(2500);
  await shot("price");
  const sheet = page.getByRole("dialog");

  await sheet.getByRole("button", { name: "Connect wallet" }).click();
  await page.waitForTimeout(800);
  await shot("wallets");
  await sheet.getByRole("button", { name: "Phantom" }).click();
  await page.waitForTimeout(3000);
  await shot("order");

  await sheet.getByRole("button", { name: "Trade details" }).click();
  await page.waitForTimeout(500);
  await shot("details");
  await sheet.getByRole("button", { name: "Trade details" }).click();

  await sheet.getByRole("button", { name: `Buy $${SYMBOL}` }).click();
  await page.waitForTimeout(900);
  await shot("confirm");
  await page.evaluate(() => window.__releaseSignature());
  await page.waitForTimeout(3500);
  await shot("done");

  // The wallet now holds the coin: the card offers selling it, and the tower glows in the wallet's colour.
  await sheet.getByRole("button", { name: "Close" }).last().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: `Trade $${SYMBOL}` }).click();
  await page.waitForTimeout(1200);
  await sheet.getByRole("tab", { name: "Sell" }).click();
  await page.waitForTimeout(2500);
  await shot("sell");

  // Sold for USDC instead of SOL.
  await sheet.getByRole("radiogroup", { name: "Sell for" }).getByRole("radio", { name: "USDC" }).click();
  await page.waitForTimeout(3000);
  await shot("sell-usdc");

  // Paying with USDC: its tiles, its balance, the same engine routes.
  await sheet.getByRole("tab", { name: "Buy" }).click();
  await page.waitForTimeout(400);
  await sheet.getByRole("radiogroup", { name: "Pay with" }).getByRole("radio", { name: "USDC" }).click();
  await page.waitForTimeout(3000);
  await shot("usdc");

  // An amount of your own, priced once the typing pauses.
  const field = sheet.getByRole("textbox", { name: /Your own amount/ });
  await field.pressSequentially("37.5", { delay: 60 });
  await page.waitForTimeout(3500);
  await shot("typed");

  // More than the wallet holds: a plain sentence, nothing priced.
  await field.fill("120");
  await page.waitForTimeout(1200);
  await shot("toomuch");
  await field.fill("");
  await page.waitForTimeout(1500);

  if (!size.mobile) {
    // The window, dragged by its head to the left and stretched by its bottom-left corner.
    const card = await sheet.boundingBox();
    await page.mouse.move(card.x + 220, card.y + 34);
    await page.mouse.down();
    await page.mouse.move(card.x - 420, card.y - 60, { steps: 12 });
    await page.mouse.up();
    const box = await page.locator('[class*="cornerSw"]').boundingBox();
    await page.mouse.move(box.x + 6, box.y + 18);
    await page.mouse.down();
    await page.mouse.move(box.x - 140, box.y + 120, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await shot("moved");
    const saved = await page.evaluate(() => window.localStorage.getItem("ryntra.city.trade-window.v2"));
    // Remembered after a reload, and still whole on a smaller screen.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: `Fly to $${SYMBOL}` }).click();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: `Trade $${SYMBOL}` }).or(page.getByRole("button", { name: `Buy $${SYMBOL}` })).first().click();
    await page.waitForTimeout(1500);
    // The window's own place, without the slide it opens with.
    const after = await page.getByRole("dialog").evaluate((el) => {
      const st = el.parentElement.style;
      return { x: parseFloat(st.left), y: parseFloat(st.top), width: parseFloat(st.width), height: parseFloat(st.height) };
    });
    await page.setViewportSize({ width: 1000, height: 640 });
    await page.waitForTimeout(800);
    const small = await page.getByRole("dialog").evaluate((el) => {
      const r = el.parentElement.getBoundingClientRect();
      return { right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), top: Math.round(r.top) };
    });
    console.log(`window saved=${saved} after reload=${JSON.stringify(after)} on 1000×640=${JSON.stringify(small)}`);
    await page.setViewportSize({ width: size.width, height: size.height });
  }

  console.log(`${size.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
  await context.close();
}
await browser.close();
