// The trade card with the friend's discount and without it (CITY-182), at 390×844 and 1440×860
//   → <out>/trade-<plain|friend>-<order|details>-<size>.png (the PR keeps them as .jpg)
//   NEXT_PUBLIC_RYNTRA_REFEREE_DISCOUNT=on in the dev server's environment; node city/lib/trade/discount-shots.mjs [out] [baseUrl]
// The same purchase twice: the card's quote at the meme rate of 1 %, then the order the wallet would sign at 1 % for a
// wallet nobody brought, and at 0.9 % for a partner's friend — the rate the engine builds for them. The engine's routes
// answer with the swap routes' own recorded transcripts, re-priced, as `shots.mjs` does; a stub wallet signs nothing.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/discount-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name) => structuredClone(golden[name].steps.at(-1).body);

const SYMBOL = process.env.COIN ?? "POPCAT";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
const solPrice = snapshot.towers.find((t) => t.id === SOL_MINT).price;
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";

/** The recorded answer for `amountRaw` of SOL into the tower, at the snapshot's prices, with Ryntra's fee at `bps`. */
function priced(body, amountRaw, bps, taker) {
  const o = body.order;
  const fee = (BigInt(amountRaw) * BigInt(bps)) / 10_000n;
  const value = ((Number(BigInt(amountRaw) - fee) / 1e9) * solPrice) / tower.price;
  const outRaw = BigInt(Math.floor(value * 1e9));
  Object.assign(o, {
    inputMint: SOL_MINT,
    outputMint: tower.id,
    inAmountRaw: amountRaw,
    outAmountRaw: outRaw.toString(),
    minReceivedRaw: ((outRaw * 995n) / 1000n).toString(),
    priceImpactPct: "0.08",
    route: [{ ...o.route[0], label: "Meteora DLMM", inputMint: SOL_MINT, outputMint: tower.id, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString() }],
    ryntraFee: { ...o.ryntraFee, basisPoints: bps, requestedBasisPoints: bps, asset: SOL_MINT, amountRaw: fee.toString() },
    platformFee: { ...o.platformFee, basisPoints: bps },
    totalFeeBasisPoints: bps,
    ...(taker ? { rentFeeLamports: "2039280" } : {}),
  });
  body.decimals = { [SOL_MINT]: 9, [tower.id]: 9 };
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
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const who of [
  { name: "plain", orderBps: 100 },
  { name: "friend", orderBps: 90 },
]) {
  for (const size of SIZES) {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const shot = (state) => page.screenshot({ path: path.join(out, `trade-${who.name}-${state}-${size.name}.png`) });

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
      const { amountRaw } = route.request().postDataJSON();
      json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, 100, null));
    });
    await page.route("**/api/solana/swap/order", async (route) => {
      const { input } = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, 500));
      json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, who.orderBps, input.taker));
    });
    await page.route("**/api/solana/holdings", (route) =>
      json(route, 200, { data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 }] } }),
    );
    await page.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
    await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

    await page.goto(`${base}/?coin=${SYMBOL}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__trade), null, { timeout: 120_000 });
    await page.waitForTimeout(4000);
    // The card through its development hook, as `size-shots.mjs` opens it: the shots are of the card.
    await page.evaluate((coin) => window.__trade.getState().openFor(coin), { id: tower.id, symbol: tower.symbol, name: tower.name, icon: null });
    await page.waitForTimeout(2500);
    const sheet = page.getByRole("dialog");
    // One wallet in the browser: the card asks it straight away, and the order is built for it.
    await sheet.getByRole("button", { name: "Connect wallet" }).click();
    await page.waitForTimeout(4500);
    // The terms line in view, wherever the chart pushed it.
    const info = sheet.getByRole("button", { name: "Trade details" });
    await info.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot("order");
    await info.click();
    await page.waitForTimeout(600);
    await sheet.getByText("Ryntra fee", { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot("details");
    console.log(`${who.name} ${size.name}: ${errors.length ? errors.join(" | ") : "no page errors"}`);
    await context.close();
  }
}
await browser.close();
