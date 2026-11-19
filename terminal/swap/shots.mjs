// The Swap screen and the Bridge's page for the eyes — one form each in the middle — at
// 1440×900, 1920×1080 and 390×844, in English and Ukrainian → <out>/*.jpg
//   node terminal/swap/shots.mjs [out] [baseUrl] [source]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` (`next build`, then `next start`), with the money
// and the limits open as on ryntra.io (`NEXT_PUBLIC_RYNTRA_CITY_MONEY=open`, `NEXT_PUBLIC_RYNTRA_CITY_SPOT=open`). The
// system Chrome draws the page (PRESS_CHROME may point at another).
//
// The figures are the engine's: the market read, the coins' logos, the price of a swap, the price of a bridge and the
// address that tops a wallet up from another network are asked from `source` (ryntra.io by default) — reads only. The
// wallet is a stub of the Wallet Standard: it connects and never signs (a request to sign is recorded and left
// waiting); its balances and its history are fixtures. The swap's exact order is the engine's own recorded answer
// (`app/api/solana/swap/golden`) re-priced to the live price on screen. The bridge's price is asked of the source first;
// a price the source refuses is shown as it is, and the walk to the wallet's button goes on with the money window's
// recorded price (`city/lib/money/shots.mjs`) and recorded bytes. Nothing is sent: an execute or a submit asked for
// would be counted, and is answered 503.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/swap");
const base = process.argv[3] ?? "http://localhost:3190";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
/** Where the stand's bridge sends: an address no one holds a key to. */
const THERE = "0x000000000000000000000000000000000000dEaD";
const golden = JSON.parse(readFileSync(new URL("../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const recordedOrder = () => structuredClone(golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body);
const recordedBytes = recordedOrder().order.transactionBase64;

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

/** ONLY=a,b — draw just these shots (the steps between still run). */
const ONLY_SHOTS = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "1510000000", spendableRaw: "1500000000", decimals: 9 },
  { kind: "TOKEN", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
  { kind: "TOKEN", mint: JUP, amountRaw: "135600000", spendableRaw: "135600000", decimals: 6, symbol: "JUP", catalog: { symbol: "JUP", name: "Jupiter", isVerified: true } },
];

/** The money window's recorded price for a bridge out of Solana, sized to the amount and the network asked. */
function recordedBridge(input) {
  const amount = BigInt(input.amountRaw);
  const network = input.to.network;
  return {
    data: {
      kind: "CROSS_SWAP",
      lane: "OPEN",
      buildable: true,
      quote: {
        schema: "ryntra.solana.cross-swap-quote",
        schemaVersion: "1.0.0",
        provider: "RELAY",
        route: "RELAY_DEPOSIT",
        routeLabel: "Relay",
        tupleId: `SOLANA_USDC_TO_${network.toUpperCase()}_USDC`,
        from: { network: "solana", asset: "USDC", symbol: "USDC", decimals: 6, amountRaw: input.amountRaw },
        to: { network, asset: "USDC", symbol: "USDC", decimals: 6, expectedRaw: String(amount - 320000n), minimumRaw: String(amount - 570000n) },
        slippageBps: 25,
        etaSeconds: 24,
        deadlineKind: "QUOTE_VALIDITY",
        deadlineUnix: 4_000_000_000,
        fees: { protocolBps: 0, protocolUsd: 0.02, relayerUsd: 0.07, relayerGasUsd: 0.05, sourceGasUsd: 0.0011, refundUsd: null, rentLamports: null, referrerBps: 0 },
        serviceFee: { mechanism: "RELAY_APP_FEE", state: "REQUESTED", basisPoints: 25, requestedBasisPoints: 25, asset: null, symbol: null, decimals: null, amountRaw: null, usd: 0.25, accrual: "PROVIDER" },
        approvals: 0,
        walletPrompts: 1,
        priceImpactBps: 32,
        priceStatus: "GOOD",
        quoteId: "stand-1",
        observedAt: new Date().toISOString(),
      },
    },
  };
}

/** The wallet's history, as the engine's ledger would write it: a minute, two hours, a day and three days ago. */
function history(now) {
  const at = (ms) => new Date(now - ms).toISOString();
  const row = (id, lane, startedAt, out, got, extra = {}) => ({
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: TAKER,
    actionId: `stand-${id}-0000000000`,
    lane,
    outcome: "DONE",
    out,
    in: got,
    destination: null,
    signature: null,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    providerRef: null,
    statedUsd: null,
    startedAt,
    updatedAt: startedAt,
    ...extra,
  });
  const usdc = (raw) => ({ mint: USDC, amountRaw: raw, decimals: 6, symbol: "USDC" });
  return [
    row("a", "SWAP", at(40_000), usdc("100000000"), { mint: null, amountRaw: "1383300000", decimals: 9, symbol: "SOL" }),
    row("b", "SWAP", at(2 * 3_600_000), { mint: null, amountRaw: "1000000000", decimals: 9, symbol: "SOL" }, { mint: JUP, amountRaw: "135600000", decimals: 6, symbol: "JUP" }),
    row("c", "SEND", at(26 * 3_600_000), usdc("25000000"), null),
    row("d", "CROSS_SWAP", at(3 * 86_400_000), usdc("250000000"), null, { destination: "ETHEREUM" }),
  ];
}

/** The market's dollar prices as the source reads them (`/api/city`), read once. */
let usdRead = null;
function marketUsd() {
  usdRead ??= fetch(`${source}/api/city`)
    .then((answer) => answer.json())
    .then((city) => new Map((city.towers ?? []).map((tower) => [tower.id, tower.price])))
    .catch(() => new Map());
  return usdRead;
}

/** A read asked from the source, answered as the stand would; a source that does not answer is a 503. */
async function fromSource(route) {
  const url = new URL(route.request().url());
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, {
      method: route.request().method(),
      headers: { "content-type": "application/json", accept: route.request().headers().accept ?? "*/*" },
      body: route.request().method() === "POST" ? route.request().postData() : undefined,
    });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: uk ? "uk-UA" : "en-US",
    });
    const asked = { quote: 0, order: 0, execute: 0, plan: 0, submit: 0, transfer: 0, signs: [] };
    const state = { quoteFails: false, wallet: false, history: true, bridgeLive: true };
    let lastQuote = null;
    let lastBridgeQuote = null;
    let deposit = "none";
    let bridgeRefusal = null;
    const orders = [];

    // Every read the screen makes, answered at once: from the source, from a fixture, or 503.
    await context.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    for (const pattern of ["**/api/city", "**/api/icon/**", "**/api/spot/icon?*", "**/api/solana/tokens/search?*", "**/api/spot/candles?*", "**/api/v1/money/recipient?*", "**/api/v1/research/address-evidence?*"]) await context.route(pattern, fromSource);
    // The limits engine answers only its own site: the stand prices the Limit tab's pair from the market the source
    // reads (`/api/city`) — a read; no order is asked for.
    await context.route("**/api/solana/limits/market", async (route) => {
      const { baseMint, quoteMint } = route.request().postDataJSON();
      const usd = await marketUsd();
      const baseUsd = usd.get(baseMint);
      const quoteUsd = quoteMint === USDC ? 1 : usd.get(quoteMint);
      if (!baseUsd || !quoteUsd) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      const body = { price: baseUsd / quoteUsd, baseUsd, quoteUsd, dlmm: { available: false, code: "NO_POOL" }, observedAt: new Date().toISOString() };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("**/api/solana/swap/quote", async (route) => {
      asked.quote += 1;
      if (state.quoteFails) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests." } }) });
      const url = new URL(route.request().url());
      const answer = await fetch(`${source}${url.pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() }).catch(() => null);
      if (!answer) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      const text = await answer.text();
      if (answer.ok) lastQuote = JSON.parse(text);
      return route.fulfill({ status: answer.status, contentType: "application/json", body: text });
    });
    // The exact order: the engine's recorded Review, carrying the live quote's own figures for the amount on screen.
    await context.route("**/api/solana/swap/order", async (route) => {
      asked.order += 1;
      const { input } = route.request().postDataJSON();
      const body = recordedOrder();
      const quote = lastQuote?.order;
      orders.push(`${input.amountRaw}${quote && quote.inAmountRaw === input.amountRaw ? "" : ` (no live quote: ${quote?.inAmountRaw ?? "none"})`}`);
      if (quote && quote.inAmountRaw === input.amountRaw) {
        Object.assign(body.order, {
          inputMint: input.inputMint,
          outputMint: input.outputMint,
          inAmountRaw: quote.inAmountRaw,
          outAmountRaw: quote.outAmountRaw,
          minReceivedRaw: quote.minReceivedRaw,
          priceImpactPct: quote.priceImpactPct,
          slippageBps: quote.slippageBps,
          route: quote.route,
          ryntraFee: quote.ryntraFee,
          platformFee: quote.platformFee,
          totalFeeBasisPoints: quote.totalFeeBasisPoints,
        });
        body.decimals = lastQuote.decimals;
      }
      const expires = new Date(Date.now() + 45_000).toISOString();
      body.expiresAt = expires;
      body.order.reviewExpiresAt = expires;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route("**/api/solana/swap/execute", (route) => {
      asked.execute += 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    await context.route("**/api/solana/holdings*", (route) =>
      state.wallet ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }) }) : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await context.route("**/api/solana/activity", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { actions: state.history ? history(Date.now()) : [], complete: true } }) }),
    );
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    await context.route("**/api/growth/cards?*", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "proof required", proof: false }) }));
    // Into Solana: the engine's own address for the stand's wallet, asked of the source; what came since is «nothing».
    await context.route("**/api/swap/deposit-address*", async (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { progress: "NONE", amount: null } }) });
      const answer = await fetch(`${source}/api/swap/deposit-address`, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() }).catch(() => null);
      const text = answer ? await answer.text() : "";
      deposit = answer ? `${answer.status} ${text.slice(0, 160)}` : "no answer";
      return route.fulfill({ status: answer?.status ?? 503, contentType: "application/json", body: text || "{}" });
    });
    // Out of Solana: the price is the source's; the exact transfer is built here on that price, with recorded bytes.
    await context.route("**/api/solana/cross-swap/quote", async (route) => {
      if (!state.bridgeLive) {
        lastBridgeQuote = recordedBridge(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(lastBridgeQuote) });
      }
      const answer = await fetch(`${source}/api/solana/cross-swap/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: route.request().postData() }).catch(() => null);
      const text = answer ? await answer.text() : "";
      if (answer?.ok) lastBridgeQuote = JSON.parse(text);
      else bridgeRefusal = answer ? `${answer.status} ${text.slice(0, 200)}` : "no answer";
      return route.fulfill({ status: answer?.status ?? 503, contentType: "application/json", body: text || "{}" });
    });
    await context.route("**/api/solana/cross-swap/plan", (route) => {
      asked.plan += 1;
      const quote = (lastBridgeQuote?.data ?? lastBridgeQuote)?.quote;
      if (!quote) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      const body = { data: { intentDigest: `0x${"5e".repeat(32)}`, quote, plan: { origin: "solana", unsignedWireBase64: recordedBytes }, reviewExpiresAt: new Date(Date.now() + 45_000).toISOString(), signableMs: 60_000 } };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    for (const pattern of ["**/api/solana/cross-swap/submit", "**/api/solana/transfer/**"]) {
      await context.route(pattern, (route) => {
        if (pattern.includes("submit")) asked.submit += 1;
        else asked.transfer += 1;
        return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      });
    }

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.exposeFunction("__recordSign", (wire) => asked.signs.push(wire));
    // A stub wallet in the Wallet Standard registry: it connects and never signs.
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
          "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
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

    const name = (shot) => path.join(out, `${shot}-${size.name}-${lang}.jpg`);
    const shot = async (shotName, block = null) => {
      if (ONLY_SHOTS && !ONLY_SHOTS.has(shotName)) return;
      // A phone shows one screen: the block the state is about is brought into it, as a person scrolls to it.
      if (size.mobile && block) await block.evaluate((node) => node.scrollIntoView({ block: "start" })).catch(() => {});
      if (size.mobile && block) await page.evaluate(() => window.scrollBy(0, -84));
      await page.waitForTimeout(600);
      await page.screenshot({ path: name(shotName), quality: 86, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const swapPanel = () => page.locator(`section[aria-label="${uk ? "Обмін" : "Swap"}"]`);
    // The bridge is a page of its own; a transfer stands in the Portfolio.
    const bridgePanel = () => page.locator(`section[aria-label="${uk ? "Міст" : "Bridge"}"]`);
    const openBridge = async (withWallet) => {
      state.wallet = withWallet;
      await page.goto(`${base}/bridge?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await bridgePanel().waitFor({ timeout: 120_000 });
      await settle();
      await page.waitForTimeout(1500);
    };
    const open = async (withWallet) => {
      state.wallet = withWallet;
      await page.evaluate((on) => {
        try {
          if (on) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
          else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
        } catch {}
      }, withWallet).catch(() => {});
      await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await swapPanel().waitFor({ timeout: 120_000 });
      await settle();
      await page.waitForTimeout(2500);
    };
    const priceOnce = async () => {
      // A price the source was too busy to give is asked again the way a person would: the quiet «Try again».
      const again = swapPanel().getByRole("button", { name: uk ? "Ще раз" : "Try again" });
      if (await again.isVisible().catch(() => false)) {
        await page.waitForTimeout(8000);
        await tap(again);
        await page.waitForTimeout(3000);
      }
    };

    // ── a first visit: no wallet ──
    await page.goto(`${base}/swap?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await open(false);
    await priceOnce();
    await shot("swap");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.push(`${size.name}/${lang}: sideways overflow ${overflow}px; quotes asked ${asked.quote}`);

    // ── the agent's line: a sentence fills the swap ──
    const line = page.getByRole("combobox").first();
    if (size.mobile) await tap(line);
    else await page.keyboard.press("Control+k");
    await line.fill(uk ? "обміняй 1 SOL на JUP" : "swap 1 SOL to JUP");
    await page.waitForSelector("[role='listbox']:not([hidden]) [role='option']", { timeout: 20_000 }).catch(() => {});
    await page.keyboard.press("Enter");
    await page.waitForTimeout(4000);
    await priceOnce();
    await shot("said");
    const filled = await swapPanel().locator("input[inputmode='decimal']:visible").first().inputValue().catch(() => "?");
    const coins = await swapPanel().locator("button[aria-label]").allInnerTexts().catch(() => []);
    report.push(`${size.name}/${lang}: the sentence filled «${filled}» — ${coins.map((text) => text.trim()).filter(Boolean).join(" / ")}`);

    // ── a price that does not come: one calm line, «Try again» only reads the price ──
    await open(false);
    state.quoteFails = true;
    await swapPanel().locator("input[inputmode='decimal']:visible").first().fill("12");
    await page.waitForTimeout(2500);
    await shot("swap-quote-failed", swapPanel());
    const ordersBefore = asked.order;
    const signsBefore = asked.signs.length;
    state.quoteFails = false;
    await tap(swapPanel().getByRole("button", { name: uk ? "Ще раз" : "Try again" }));
    await page.waitForTimeout(2500);
    report.push(`${size.name}/${lang}: «Try again» asked ${asked.order - ordersBefore} orders and ${asked.signs.length - signsBefore} signatures`);

    // ── a wallet: its balances, its history, the exact order built while the person reads ──
    await open(true);
    await swapPanel().locator("input[inputmode='decimal']:visible").first().fill("100");
    await page.waitForTimeout(6000);
    await priceOnce();
    await shot("swap-wallet");
    if (!size.mobile) {
      const info = swapPanel().getByRole("button", { name: uk ? "Маршрут і деталі" : "Route and details" });
      if (await info.count()) {
        await tap(info);
        await shot("swap-details");
        await tap(info);
      }
      // The coin to get: the market's coins and a search.
      await tap(swapPanel().getByRole("button", { name: new RegExp(uk ? "^Обрати, що отримаєш" : "^Pick the coin you get") }));
      await page.waitForTimeout(800);
      await shot("swap-pick");
      await swapPanel().locator("input[type='search']").fill("met");
      await page.waitForTimeout(2500);
      await shot("swap-find");
      report.push(`${size.name}/${lang}: the search «met» lists ${(await swapPanel().locator("[role='menuitemradio']").allInnerTexts()).map((t) => t.split("\n")[0]).slice(0, 6).join(", ")}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    // The one press over the exact order: the wallet is asked, and the stub keeps it waiting.
    await page.waitForTimeout(1400);
    await tap(swapPanel().getByRole("button", { name: uk ? "Обміняти" : "Swap" }));
    await page.waitForTimeout(1500);
    await shot("swap-sign", swapPanel());
    const signed = asked.signs.at(-1) ?? null;
    report.push(`${size.name}/${lang}: orders built for ${orders.join(", ") || "none"}`);
    report.push(`${size.name}/${lang}: the swap asked the wallet ${asked.signs.length} time(s); the bytes are the order's own — ${signed !== null && signed === recordedBytes}; executes ${asked.execute}`);

    // ── the bridge into Solana: the engine's address on the other network ──
    await openBridge(true);
    const signsBeforeBridge = asked.signs.length;
    const moveIn = bridgePanel().getByRole("button", { name: uk ? "Перевести на Solana" : "Move to Solana" });
    if (size.mobile) await moveIn.scrollIntoViewIfNeeded();
    await tap(moveIn);
    await page.waitForTimeout(5000);
    await shot("bridge-in", bridgePanel());
    report.push(`${size.name}/${lang}: the deposit address — ${deposit}`);

    // ── the bridge out of Solana: the price, the exact transfer, the wallet's button ──
    await tap(bridgePanel().getByRole("button", { name: uk ? "Змінити напрям" : "Change direction" }));
    await bridgePanel().locator("input[inputmode='decimal']:visible").first().fill("100");
    await bridgePanel().locator("input[placeholder='0x…']").fill(THERE);
    await page.waitForTimeout(6000);
    if (bridgeRefusal) {
      // The source refused the price: its plain words and the quiet «Try again» are what a person sees today.
      await shot("bridge-out-refused", bridgePanel());
      report.push(`${size.name}/${lang}: the source refused the bridge's price — ${bridgeRefusal}; the walk goes on with the recorded price`);
      state.bridgeLive = false;
      await tap(bridgePanel().getByRole("button", { name: uk ? "Ще раз" : "Try again" }));
      await page.waitForTimeout(2500);
    }
    await shot("bridge-out", bridgePanel());
    const moveOut = bridgePanel().getByRole("button", { name: uk ? "Перевести на Ethereum" : "Move to Ethereum" });
    if (await moveOut.isEnabled().catch(() => false)) {
      await tap(moveOut);
      await page.waitForTimeout(2500);
      await shot("bridge-out-wallet", bridgePanel());
      const confirm = bridgePanel().getByRole("button", { name: uk ? "Підтверди в Phantom" : "Confirm in Phantom" });
      if (await confirm.count()) {
        await tap(confirm);
        await page.waitForTimeout(2000);
      }
    }
    const bridgeSign = asked.signs.length > signsBeforeBridge ? asked.signs.at(-1) : null;

    // ── the bridge out with SOL, ETH arriving: the coins by their logos ──
    await openBridge(true);
    if (!(await bridgePanel().locator("input[placeholder='0x…']").count())) {
      await tap(bridgePanel().getByRole("button", { name: uk ? "Змінити напрям" : "Change direction" }));
    }
    await tap(bridgePanel().getByRole("button", { name: new RegExp(uk ? "^Обрати, що надсилаєш" : "^Pick the coin you send") }));
    await tap(bridgePanel().getByRole("menuitemradio", { name: "SOL" }));
    await tap(bridgePanel().getByRole("button", { name: new RegExp(uk ? "^Обрати, що отримаєш" : "^Pick the coin that arrives") }));
    await tap(bridgePanel().getByRole("menuitemradio", { name: "ETH" }));
    await bridgePanel().locator("input[inputmode='decimal']:visible").first().fill("0.5");
    await bridgePanel().locator("input[placeholder='0x…']").fill(THERE);
    await page.waitForTimeout(6000);
    await shot("bridge-sol", bridgePanel());
    report.push(`${size.name}/${lang}: SOL → ETH — the button says «${(await bridgePanel().getByRole("button").last().innerText().catch(() => "?")).trim()}»`);
    report.push(`${size.name}/${lang}: the bridge built ${asked.plan} transfer(s); the wallet was asked ${asked.signs.length - signsBeforeBridge} time(s), the bytes are the transfer's own — ${bridgeSign === recordedBytes}; submits ${asked.submit}`);

    // ── the old tabs' addresses: each leads on in one step ──
    for (const tab of ["limit", "bridge", "send"]) {
      await page.goto(`${base}/swap?tab=${tab}&lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForTimeout(5000);
      const at = new URL(page.url());
      const history = await page.evaluate(() => history.length);
      report.push(`${size.name}/${lang}: /swap?tab=${tab} → ${at.pathname}${at.search} (history ${history})`);
    }

    // ── the bridge with no wallet: a first visit ──
    await openBridge(false);
    await shot("bridge");
    const overflowBridge = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.push(`${size.name}/${lang}: the bridge's sideways overflow ${overflowBridge}px`);

    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
