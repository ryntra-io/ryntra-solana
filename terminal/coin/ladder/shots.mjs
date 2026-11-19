// The ticket's Limit tab — buy cheaper, sell higher, at one price or on a ladder — for the eyes, at 1440×900 and
// 390×844, in English and Ukrainian → <out>/*.jpg and <out>/report.txt
//   node terminal/coin/ladder/shots.mjs [out] [baseUrl] [source]
// The stand: `next build` and `next start` with NEXT_PUBLIC_RYNTRA_TERMINAL=stand and
// NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS=mainnet (the window's switch only: the stand's server keeps the ladders shut, and
// every ladder request is answered here). The system Chrome draws the page (PRESS_CHROME may point at another).
//
// The market read, the candles and the logos are the engine's, asked from `source` (ryntra.io) — reads only. The
// ladder's market, quotes, Review and orders are fixtures shaped as the engine shapes them (`lib/pro-limits/service.ts`).
// The wallet is a stub of the Wallet Standard: it connects and never signs — a request to sign is recorded with its
// bytes and left waiting. Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-260");
const base = process.argv[3] ?? "http://localhost:3160";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const AGENT = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const REFERRAL = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const POOL = "FhUzUF3h14y39nD2vdVkyREijM4kWj5nemFU3njwb8cQ";
const RESTING = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
/** A Review's transaction as the engine's relay would take it back: the bytes the wallet must be asked to sign, unchanged. */
const WIRE = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const city = await fetch(`${source}/api/city`).then((r) => r.json());
const jupPrice = city.towers?.find((t) => t.id === JUP)?.price ?? 0.5;

const MARKET = {
  network: "mainnet",
  pool: POOL,
  coin: { mint: JUP, decimals: 6 },
  quote: { mint: USDC, symbol: "USDC", decimals: 6 },
  price: jupPrice,
  bonus: { feeBps: 20, ownerBps: 8, referralBps: 2 },
  reach: { buyBps: 9_900, sellBps: 990_000 },
  placing: true,
  collector: AGENT,
  cap: { maxRaw: "200000000", minRungRaw: "500000" },
};

/** A ladder as `/api/v1/ladders/quote` answers it: the nearest price a step from the market, evenly to the farthest. */
function quoteOf({ action, farBps, rungs, amountRaw }) {
  const count = Math.max(1, Math.min(rungs ?? 25, 25, Math.floor(farBps / 50)));
  const total = BigInt(amountRaw);
  const each = total / BigInt(count);
  const list = Array.from({ length: count }, (_, at) => {
    const awayBps = count === 1 ? farBps : Math.round(50 + (at * (farBps - 50)) / (count - 1));
    const price = jupPrice * (action === "buy" ? 1 - awayBps / 10_000 : 1 + awayBps / 10_000);
    const pays = action === "buy" ? Number(each) / price : Number(each) * price;
    return { awayBps, price, amountRaw: each.toString(), paysRaw: BigInt(Math.floor(pays)).toString() };
  });
  const pays = list.reduce((sum, rung) => sum + BigInt(rung.paysRaw), 0n);
  const rests = each * BigInt(count);
  return {
    market: MARKET,
    action,
    restsIn: action === "buy" ? USDC : JUP,
    paysIn: action === "buy" ? JUP : USDC,
    rungs: list,
    amountRaw: rests.toString(),
    paysRaw: pays.toString(),
    averagePrice: action === "buy" ? Number(rests) / Number(pays) : Number(pays) / Number(rests),
    nearBps: list[0].awayBps,
    farBps: list.at(-1).awayBps,
    corridorBps: 100,
    bonus: { feeBps: 20, ownerBps: 8, referralBps: 2, referral: REFERRAL, feeIn: USDC },
  };
}

const ORDER = {
  nftMint: RESTING,
  pool: POOL,
  coin: { mint: JUP, decimals: 6 },
  quote: { mint: USDC, decimals: 6 },
  action: "buy",
  state: "resting",
  prices: 8,
  filledPrices: 0,
  restsIn: USDC,
  paysIn: JUP,
  restsRaw: "100000000",
  filledRaw: "0",
  proceedsRaw: "0",
  lowPrice: jupPrice * 0.96,
  highPrice: jupPrice * 0.995,
  filledPrice: null,
  bonus: { mint: USDC, ownerRaw: "0", referralRaw: "0" },
  agent: true,
  agentReady: true,
  agentOffered: true,
  partialPrices: 0,
};

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  // The wide desks the operator looks on: only when named.
  { name: "wide", width: 1920, height: 1080, mobile: false, named: true },
  { name: "xl", width: 2560, height: 1440, mobile: false, named: true },
].filter((size) => (process.env.SIZES ? process.env.SIZES.split(",").includes(size.name) : !size.named));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [`JUP at $${jupPrice} (${source})`];

async function fromSource(route) {
  const url = new URL(route.request().url());
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: route.request().headers().accept ?? "*/*" } });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US" });
    const asked = { quotes: 0, reviews: [], submits: 0, signs: [] };
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await context.route("**/api/**", (route) => json(route, 503, {}));
    for (const pattern of ["**/api/city", "**/api/spot/candles?*", "**/api/icon/**"]) await context.route(pattern, fromSource);
    await context.route("**/api/solana/swap/quote", (route) => json(route, 503, { error: { code: "UNAVAILABLE", message: "" } }));
    await context.route("**/api/solana/holdings*", (route) =>
      json(route, 200, {
        data: {
          tokenRead: "COMPLETE",
          holdings: [
            { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
            { kind: "TOKEN", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
            { kind: "TOKEN", mint: JUP, amountRaw: "420000000", spendableRaw: "420000000", decimals: 6, symbol: "JUP", catalog: { symbol: "JUP", name: "Jupiter", isVerified: true } },
          ],
        },
      }),
    );
    await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/growth/cards?*", (route) => json(route, 401, { error: "proof required", proof: false }));
    // The ladders' lane: the engine's shapes, answered here.
    await context.route("**/api/v1/ladders/market?*", (route) => json(route, 200, { market: new URL(route.request().url()).searchParams.get("mint") === JUP ? MARKET : null }));
    await context.route("**/api/v1/ladders/quote", async (route) => {
      asked.quotes += 1;
      await new Promise((r) => setTimeout(r, 200));
      return json(route, 200, quoteOf(route.request().postDataJSON().intent));
    });
    await context.route("**/api/v1/ladders/review", async (route) => {
      const body = route.request().postDataJSON();
      asked.reviews.push(body);
      const quote = body.action === "place" ? quoteOf(body.intent) : null;
      return json(route, 200, { action: body.action, network: "mainnet", transactions: [WIRE], ticket: "t".repeat(48), expiresAt: Date.now() + 25_000, nftMint: body.nftMint ?? "new", networkFeeLamports: "15000", rentLamports: quote ? String(6_157_000 + 935_000 * quote.rungs.length) : "0", accountsLamports: "0", quote, agent: body.agent === true, receives: null, referral: null });
    });
    await context.route("**/api/v1/ladders/submit", (route) => {
      asked.submits += 1;
      return json(route, 503, {});
    });
    // The wallet holds no order of Jupiter's here: its read answers empty, so the tab shows the ladder alone.
    await context.route("**/api/solana/limits/orders", (route) => json(route, 200, { orders: [], tokens: {}, complete: true }));
    await context.route("**/api/v1/ladders/orders?*", (route) => json(route, 200, { orders: [ORDER] }));

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.exposeFunction("__recordSign", (wire) => asked.signs.push(wire));
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
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            // Never signs: the bytes it was asked to sign are recorded, and the wallet keeps waiting.
            signTransaction: (...inputs) => {
              for (const { transaction } of inputs) window.__recordSign(btoa(String.fromCharCode(...transaction)));
              return new Promise(() => {});
            },
          },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { taker: TAKER });

    const shot = async (state) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForTimeout(1500);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const ticket = () => page.locator(`section[aria-label="${uk ? "Купівля та продаж" : "Buy and sell"}"]`);
    const limitTab = () => ticket().getByRole("tab", { name: uk ? "Ліміт" : "Limit" });

    await page.goto(`${base}/coin/${JUP}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("canvas", { timeout: 60_000 }).catch(() => {});
    await settle();
    await page.waitForTimeout(2500);
    // A phone's ticket is a sheet under «Buy JUP»: opened first, the Limit tab is in it.
    if (size.mobile) {
      const buy = page.locator("button[data-side='buy']").first();
      if (await buy.count()) await tap(buy);
      await page.waitForTimeout(800);
    }
    await tap(limitTab());
    await page.waitForTimeout(800);
    await shot("limit-connect");

    // The wallet connects from the tab's own button; then an amount asks the engine for the ladder.
    await tap(ticket().getByRole("button", { name: uk ? "Підключити гаманець" : "Connect wallet" }));
    await page.waitForTimeout(800);
    const pick = ticket().getByRole("button", { name: "Phantom" });
    if (await pick.count()) await tap(pick);
    await page.waitForTimeout(2500);
    await ticket().locator("input[inputmode='decimal']").first().fill("100");
    await page.waitForTimeout(2000);
    // Under the chart, the orders the wallet has of this coin.
    const ordersTab = page.getByRole("tab", { name: new RegExp(`^${uk ? "Ордери" : "Orders"}`) });
    // On a phone the ticket's sheet stands over the tabs under the chart: they are read once it closes.
    if (!size.mobile && (await ordersTab.count())) await tap(ordersTab.first());
    await page.waitForTimeout(1200);
    await shot("limit-ladder");
    if (size.mobile) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await shot("limit-ladder-below");
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // Behind «i»: how it works, the corridor, the most one order holds.
    await tap(ticket().getByRole("button", { name: uk ? "Як це працює" : "How it works" }));
    await page.waitForTimeout(500);
    await ticket().getByRole("button", { name: uk ? "Як це працює" : "How it works" }).scrollIntoViewIfNeeded();
    await shot("limit-details");
    await tap(ticket().getByRole("button", { name: uk ? "Як це працює" : "How it works" }));

    // One price, typed as a per cent.
    await tap(ticket().getByRole("tab", { name: uk ? "Одна ціна" : "One price" }));
    const percent = ticket().getByRole("textbox", { name: uk ? "Відстань від ціни, відсотки" : "Distance from the price, per cent" });
    await percent.fill("7");
    await percent.press("Enter");
    await page.waitForTimeout(1500);
    await ticket().scrollIntoViewIfNeeded();
    await shot("limit-one");

    // Sell higher on a ladder.
    await tap(ticket().getByRole("tab", { name: uk ? "Драбина" : "Ladder" }));
    await tap(ticket().getByRole("radio", { name: uk ? "Продати дорожче" : "Sell higher" }));
    await ticket().locator("input[inputmode='decimal']").first().fill("300");
    await page.waitForTimeout(2000);
    await shot("limit-sell");

    // Back to the buy: the one amber press is the engine's Review, then the wallet — which never signs.
    await tap(ticket().getByRole("radio", { name: uk ? "Купити дешевше" : "Buy cheaper" }));
    await ticket().locator("input[inputmode='decimal']").first().fill("100");
    await page.waitForTimeout(2000);
    await tap(ticket().getByRole("button", { name: uk ? "Поставити драбину" : "Place ladder" }));
    await page.waitForTimeout(2500);
    await shot("limit-wallet");
    const review = asked.reviews.at(-1);
    report.push(
      `${size.name}/${lang}: quotes ${asked.quotes}; Review ${JSON.stringify(review ?? null)}; the wallet was asked ${asked.signs.length} time(s), bytes are the Review's own — ${asked.signs.length > 0 && asked.signs.every((wire) => Buffer.from(wire, "base64").equals(Buffer.from(WIRE, "base64")))} (${asked.signs.map((wire) => Buffer.from(wire, "base64").length).join(", ")} bytes); relays ${asked.submits}`,
    );

    // A sentence to the agent's line: the Limit tab comes forward, filled.
    await page.goto(`${base}/coin/${JUP}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await settle();
    const line = page.getByRole("combobox").first();
    if (size.mobile) await tap(line);
    else await page.keyboard.press("Control+k");
    await line.fill(uk ? "купи JUP дешевше на 50 USDC" : "buy JUP cheaper for 50 USDC");
    const option = await page.waitForSelector("[role='listbox']:not([hidden]) [role='option']", { timeout: 20_000 }).catch(() => null);
    if (option) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3500);
      await shot("limit-said");
      report.push(`${size.name}/${lang}: the sentence filled «${await ticket().locator("input[inputmode='decimal']").first().inputValue().catch(() => "—")}» on the ${(await limitTab().getAttribute("aria-selected").catch(() => null)) === "true" ? "Limit" : "other"} tab`);
    } else report.push(`${size.name}/${lang}: the agent's line offered nothing for the ladder sentence`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.push(`${size.name}/${lang}: sideways overflow ${overflow}px`);
    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
