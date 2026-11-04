// CITY-189's screens for review: the tower's window on a phone, as it opens — is what you get in sight beside the one
// action? Buy, sell and a limit, in English and Ukrainian, at 390×844, 360×740 and on a desk at 1440×860
//   → <out>/<state>-<lang>-<size>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_SPOT=open npm run dev     then     node city/lib/trade/dock-shots.mjs [out] [baseUrl]
// No wallet and no keys: a stub wallet registers through the Wallet Standard events (it signs nothing), and the swap
// and limits routes answer with the swap routes' recorded transcripts re-priced for the tower on screen. The figures
// are fixtures. `LANGS=en` or `SIZES=phone390` narrow the pass.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/dock-shots");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const step = (name, at = -1) => structuredClone(golden[name].steps.at(at).body);

const SYMBOL = process.env.COIN ?? "POPCAT";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const tower = snapshot.towers.find((t) => t.symbol === SYMBOL);
const PRICE = { [SOL_MINT]: snapshot.towers.find((t) => t.id === SOL_MINT).price, [USDC_MINT]: 1, [tower.id]: tower.price };
const DECIMALS = { [SOL_MINT]: 9, [USDC_MINT]: 6, [tower.id]: 9 };

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
    priceImpactPct: "0.08",
    route: [{ ...o.route[0], label: "Meteora DLMM", inputMint, outputMint, inAmountRaw: amountRaw, outAmountRaw: outRaw.toString() }],
    ryntraFee: { ...o.ryntraFee, basisPoints: 100, requestedBasisPoints: 100, asset: inputMint === tower.id ? outputMint : inputMint },
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

/** The names the script presses, in either language. */
const N = {
  gotIt: /^(Got it|Зрозуміло)$/,
  later: /^(Later|Пізніше)$/,
  search: /^(Search coins|Пошук монет)$/,
  field: /^(Ticker, name or mint address|Тікер, назва чи адреса мінту)$/,
  buy: new RegExp(`^(Buy|Купити) \\$${SYMBOL}$`),
  connect: /^(Connect wallet|Підключити гаманець)$/,
  sellTab: /^(Sell|Продати)$/,
  buyTab: /^(Buy|Купити)$/,
  limitTab: /^(Limit|Ліміт)$/,
  marketTab: /^(Market|Ринковий)$/,
};

const ALL = [
  { name: "phone390", width: 390, height: 844, mobile: true },
  { name: "phone360", width: 360, height: 740, mobile: true },
  { name: "laptop", width: 1440, height: 860, mobile: false },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const lang of LANGS)
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|WebGL|GPU/.test(m.text()) && errors.push(m.text()));
    // Each screen, and whether the dock carries what you get (it should on a phone scrolled to the ticket, never on a desk).
    const lines = [];
    const shot = async (state) => {
      await page.screenshot({ path: path.join(out, `${state}-${lang}-${size.name}.jpg`), type: "jpeg", quality: 82 });
      lines.push(`${state}=${await page.evaluate(() => (document.querySelector('[class*="dockGetOn"]') ? "line" : "-"))}`);
    };

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
      await new Promise((r) => setTimeout(r, 300));
      json(route, 200, priced(step("quote: SOL to USDT with the referral fee"), amountRaw, { taker: null, inputMint, outputMint }));
    });
    await page.route("**/api/solana/swap/order", async (route) => {
      const { input } = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, 400));
      json(route, 200, priced(step("order: SOL to USDT with the verified referral fee is a signable Review"), input.amountRaw, { taker: input.taker, inputMint: input.inputMint, outputMint: input.outputMint }));
    });
    await page.route("**/api/solana/holdings", (route) =>
      json(route, 200, {
        data: {
          tokenRead: "COMPLETE",
          holdings: [
            { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9, symbol: "SOL" },
            { kind: "TOKEN", mint: USDC_MINT, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6, catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
            { kind: "TOKEN", mint: tower.id, amountRaw: "2400000000000", spendableRaw: "2400000000000", decimals: 9, catalog: { symbol: SYMBOL, name: tower.name, isVerified: true } },
          ],
        },
      }),
    );
    await page.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
    await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await page.route("**/api/solana/limits/market", (route) => {
      const { baseMint, quoteMint } = route.request().postDataJSON();
      json(route, 200, { price: PRICE[baseMint] / PRICE[quoteMint], baseUsd: PRICE[baseMint], quoteUsd: PRICE[quoteMint], dlmm: { available: false, code: "NO_POOL" }, observedAt: new Date().toISOString() });
    });
    await page.route("**/api/solana/limits/orders", (route) => json(route, 200, { orders: [], tokens: {}, complete: true }));

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(12000);
    for (const name of [N.gotIt, N.later]) {
      const button = page.getByRole("button", { name });
      if (await button.count()) await button.first().click().catch(() => {});
    }
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: N.search }).click();
    await page.getByRole("combobox", { name: N.field }).fill(SYMBOL);
    await page.waitForTimeout(600);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);
    // The search opens the coin's card itself; a tower's own card has a Buy first.
    const buy = page.getByRole("button", { name: N.buy });
    if (await buy.count()) await buy.first().click();
    await page.waitForTimeout(1500);
    const sheet = page.getByRole("dialog").last();
    await sheet.getByRole("button", { name: N.connect }).click();
    await page.waitForTimeout(3500);

    // As a person sees the ticket on a phone: the card scrolled until the ticket's first line meets its top (under the
    // chart of a tower's window); a card that fits does not move.
    const top = () =>
      page.evaluate(() => {
        const card = document.querySelector('[class*="trade_sheet"]');
        const ticket = card?.querySelector('[class*="spotTicket"]');
        if (!card) return;
        card.scrollTop = 0;
        if (ticket) card.scrollTop = ticket.getBoundingClientRect().top - card.getBoundingClientRect().top - 12;
      });
    await top();
    await page.waitForTimeout(400);
    await shot("buy");
    // Scrolled until the ticket's own figure is in view above the dock: the dock's line folds away.
    await page.evaluate(() => {
      const card = document.querySelector('[class*="trade_sheet"]');
      const figure = card?.querySelector('[class*="trade_get__"]');
      if (figure) card.scrollTop += figure.getBoundingClientRect().top - card.getBoundingClientRect().top - 12;
    });
    await page.waitForTimeout(600);
    await shot("buy-seen");

    await sheet.getByRole("tab", { name: N.sellTab }).click();
    await page.waitForTimeout(2500);
    await top();
    await page.waitForTimeout(400);
    await shot("sell");

    await sheet.getByRole("tab", { name: N.buyTab }).click();
    await page.waitForTimeout(500);
    const limit = sheet.getByRole("tab", { name: N.limitTab });
    if (await limit.count()) {
      await limit.click();
      await page.waitForTimeout(3000);
      await sheet.locator('[class*="priceField"] input').fill(typed((PRICE[tower.id] / PRICE[SOL_MINT]) * 0.9));
      await page.waitForTimeout(800);
      await top();
      await page.waitForTimeout(400);
      await shot("limit");
      await sheet.getByRole("tab", { name: N.marketTab }).click();
    }

    console.log(`${lang} ${size.name}: ${lines.join(" ")} errors=${errors.length}${errors.length ? " → " + errors.slice(0, 3).join(" | ").slice(0, 400) : ""}`);
    await context.close();
  }
await browser.close();
