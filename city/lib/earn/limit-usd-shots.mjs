// The amount in dollars and the price to the cent in Sell Higher (CITY-190) — screens for review, driven by taps alone
// (no dev hooks), so the same pass reads the live site («before») and a production build of the branch («after»):
//   node city/lib/earn/limit-usd-shots.mjs <out> [baseUrl]      (PRESS_CHROME may point at a Chrome; SIZES, LOCALES)
// → <out>/<nn>-<state>-<size>-<locale>.jpg. No wallet and no keys: a stub wallet registers through the Wallet Standard
// events and never signs; the routes answer from fixtures (SOL/USDC and TSLAx/SOL), so the figures are fixtures.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/limit-usd-shots");
const base = process.argv[3] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((s) => process.env.SIZES.split(",").includes(s.name)) : ALL;
const LOCALES = (process.env.LOCALES ?? "en,uk").split(",");

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const POOL_SOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const POOL_TSLA = "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y";

/** A market whose active bin stands at `perUnit` (in the quote) per unit the wallet shows. */
function market({ pool, asset, quote, step, perUnit, priceUsd, quoteUsd }) {
  const raw = perUnit * 10 ** (quote.decimals - asset.decimals);
  return {
    pool,
    asset,
    quote,
    assetIsX: true,
    binStepBps: step,
    activeBin: Math.round(Math.log(raw) / Math.log(1 + step / 10_000)),
    feeBps: step === 10 ? 4 : 30,
    multiplier: { current: 1, pending: null, effectiveAt: null },
    priceUsd,
    quoteUsd,
    at: new Date().toISOString(),
  };
}
// SOL near the owner's first live order (3.11): $96.
const SOL_M = market({ pool: POOL_SOL, asset: { mint: SOL, symbol: "SOL", decimals: 9, kind: "sol", name: null }, quote: { mint: USDC, symbol: "USDC", decimals: 6 }, step: 10, perUnit: 96.006, priceUsd: 96.006, quoteUsd: 1 });
const TSLA_M = market({ pool: POOL_TSLA, asset: { mint: TSLAX, symbol: "TSLAx", decimals: 8, kind: "stock", name: "Tesla" }, quote: { mint: SOL, symbol: "SOL", decimals: 9 }, step: 20, perUnit: 4.485, priceUsd: 430.6, quoteUsd: 96.006 });
const MARKETS = [SOL_M, TSLA_M];
const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "1240000000", spendableRaw: "1239000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: "96.006" } },
  { kind: "TOKEN", mint: USDC, amountRaw: "48120000", spendableRaw: "48120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
];

const chrome = process.env.PRESS_CHROME || undefined;
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });

for (const locale of LOCALES) {
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: locale === "uk" ? "uk-UA" : "en-US" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    const t = (en, uk) => (locale === "uk" ? uk : en);
    let n = 0;
    const shot = async (state) => {
      n += 1;
      const file = `${String(n).padStart(2, "0")}-${state}-${size.name}-${locale}.jpg`;
      await page.screenshot({ path: path.join(out, file), quality: 84, timeout: 120_000 });
      const field = await page.evaluate(() => {
        const box = document.querySelector("#earn-limit-amount")?.closest("div")?.parentElement;
        return box ? box.innerText.replace(/\s+/g, " ").slice(0, 400) : null;
      });
      console.log(file, "|", field);
    };

    await page.addInitScript(({ owner }) => {
      try {
        window.localStorage.setItem("ryntra.city.firstHint", "1");
      } catch {}
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
    }, { owner: OWNER });

    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"], [TSLAX]: ["T", "#E31937"] };
    await page.route("**/api/icon/*", (route) => {
      const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
    });
    await page.route("**/api/city/earn/limits", (route) => json(route, 200, { markets: MARKETS, at: new Date().toISOString() }));
    await page.route("**/api/city/earn/limits/admit?*", (route) => json(route, 200, { place: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
    await page.route("**/api/city/earn/limits/orders?*", (route) => json(route, 200, { owner: OWNER, orders: [], at: new Date().toISOString() }));
    // A Review shaped like the engine's; the stub wallet never signs it.
    const amountOf = (units, decimals, asset) => ({ units: String(units), decimals, asset });
    await page.route("**/api/city/earn/limits/review", (route) => {
      const body = route.request().postDataJSON();
      const m = MARKETS.find((x) => x.pool === body.request?.pool) ?? SOL_M;
      const ask = body.request?.side === "ask";
      const place = { side: body.request.side, bins: body.request.bins, lowerPrice: "1", upperPrice: "1", spread: [], deposit: amountOf(body.request.amount, ask ? m.asset.decimals : m.quote.decimals, ask ? m.asset.mint : m.quote.mint), fullFill: amountOf(1, 6, USDC) };
      return json(route, 200, {
        preview: { action: body.action, venue: "meteora-dlmm", pool: m.pool, request: body.request, fees: [], rent: [{ what: "limit_order", direction: "pay", lamports: "1948800", refundable: true }], transactions: 1, notices: [], price: "1", activeBin: m.activeBin, makerShareBps: 5000, feeBps: m.feeBps, at: Date.now(), expiresAt: Date.now() + 30_000, place },
        transactions: [{ wireBase64: "AQ==", presigned: [] }],
        position: OWNER,
        ticket: "ticket",
        expiresAt: Date.now() + 25_000,
        signableMs: 25_000,
        networkFeeLamports: "10000",
        depositUsd: 10,
      });
    });
    await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
    await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

    await page.goto(`${base}/?lang=${locale}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(16_000);
    const got = page.getByRole("button", { name: t("Got it", "Зрозуміло") });
    if (await got.count()) await got.first().click().catch(() => {});

    await page.getByRole("button", { name: new RegExp(`^${t("Earn", "Заробіток")}`, "i") }).last().click({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const tab = page.getByRole("tab", { name: t("Shelf", "Полиця") });
    if (await tab.count()) await tab.first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: t("Sell Higher", "Продам дорожче") }).first().click({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Phantom" }).first().click({ timeout: 20_000 });
    await page.waitForTimeout(3000);

    const amount = page.locator("#earn-limit-amount");
    const toggle = page.getByRole("radiogroup", { name: t("Amount in", "Сума в") });
    const hasToggle = (await toggle.count()) > 0;
    const center = async () => {
      await amount.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(500);
    };

    // Sell SOL: +2 % on the price, then the amount — in dollars where the card offers them, else in the coin.
    await page.getByRole("button", { name: "+2%" }).first().click();
    await page.waitForTimeout(400);
    await amount.fill(hasToggle ? "10" : "0.05");
    await page.waitForTimeout(1200);
    await center();
    await shot(hasToggle ? "sell-usd" : "sell-coin");

    if (hasToggle) {
      // The coin back: what the dollars came to, and the dollars under it.
      await toggle.getByRole("radio", { name: "SOL" }).click();
      await page.waitForTimeout(800);
      await shot("sell-coin");
      await toggle.getByRole("radio", { name: "$" }).click();
      await page.waitForTimeout(400);
    }
    // Max in the unit on screen.
    await page.getByRole("button", { name: t("Max", "Усе") }).first().click();
    await page.waitForTimeout(800);
    await center();
    await shot("max");

    // Buy lower on TSLAx, paid in SOL: dollars here too.
    await page.getByRole("radio", { name: t("Buy lower", "Куплю дешевше") }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole("radio", { name: "TSLAx" }).first().click();
    await page.waitForTimeout(600);
    await amount.fill(hasToggle ? "25" : "0.25");
    await page.waitForTimeout(1200);
    await center();
    await shot("buy-sol-quote");

    if (errors.length) console.log(size.name, locale, "errors:", errors.slice(0, 4));
    await context.close();
  }
}

await browser.close();
console.log("shots in", out);
