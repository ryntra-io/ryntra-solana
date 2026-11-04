// The agent's one-sentence instructions (CITY-176) for review: phrase → card → «My instructions», on a desk (1440×900)
// and a phone (375×812), in English and Ukrainian → <out>/<lang>-<size>-<step>.jpg
//   NEXT_PUBLIC_RYNTRA_CITY_ONE_SENTENCE=open NEXT_PUBLIC_RYNTRA_CITY_SPOT=open NEXT_PUBLIC_RYNTRA_CITY_STOPS=open npm run dev
//   node city/lib/instruct/shots.mjs [out] [baseUrl]      (ONLY=desk|phone, LANGS=en,uk; PRESS_CHROME may point at a Chromium)
//
// A wallet stub that has already proven itself is connected; every engine route the card and the list ask answers with
// a fixture in the browser — the market's price, the swap quote's fee and decimals, the limit's Review, the stops and
// the rules — so no request leaves the stand, no order is placed and no real wallet or key is touched. The wallet stub
// signs nothing real: it hands back the bytes it was shown, and the stubbed relay answers «placed».
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-176");
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const ORDER = "7Yy1aPn9NUxF1o3T7oQhSeRGo3b1xRfShZy9C7ZqQe7S";
const STOP_ID = "stp_0123456789abcdef0123456789abcdef";
const RULE_ID = "rule_0123456789abcdef";
const DECIMALS = { [WSOL]: 9, [JUP]: 6, [WIF]: 6, [USDC]: 6 };
/** The fee policy's share by the coin, as the swap engine would say it. */
const FEE_BPS = { [WSOL]: 10, [JUP]: 50, [WIF]: 100 };

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const SAY = {
  en: { recurring: "buy $20 of SOL every week", stop: "sell half my WIF if it falls 10%", limit: "buy JUP if it drops to 0.25", list: "my instructions" },
  uk: { recurring: "купуй SOL на $20 щотижня", stop: "продай половину WIF, якщо впаде на 10 %", limit: "купи JUP, якщо впаде до 0,25", list: "мої доручення" },
};
const UI = {
  en: { ask: "Ask Ryntra", field: "Say what to open", sign: "Sign", list: "My instructions", usd50: "$50" },
  uk: { ask: "Спитати Ryntra", field: "Скажи, що відкрити", sign: "Підписати", list: "Мої доручення", usd50: "$50" },
};

const chrome = process.env.PRESS_CHROME || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: chrome, args: ["--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

/** The prices the city's own towers stand at on this stand: the card's figures follow what the city shows. */
const city = await fetch(`${base}/api/city`).then((r) => r.json());
const priceOf = (mint) => city.towers.find((t) => t.id === mint)?.price ?? 1;

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stand(page) {
  const made = { rules: [], stops: [], orders: [] };
  await page.route("**/api/icon/*", (route) => {
    const mint = route.request().url().split("/").pop();
    const [glyph, fill] = { [USDC]: ["$", "#2775CA"], [JUP]: ["J", "#1B9A6C"], [WSOL]: ["◎", "#9945FF"], [WIF]: ["W", "#B07A4A"] }[mint] ?? ["?", "#23222D"];
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="20" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
  });
  await page.route("**/api/solana/holdings", (route) =>
    json(route, 200, {
      data: {
        tokenRead: "COMPLETE",
        holdings: [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "3415000000", spendableRaw: "3405000000", decimals: 9, symbol: "SOL" },
          { kind: "TOKEN", mint: USDC, amountRaw: "248120000", spendableRaw: "248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
          { kind: "TOKEN", mint: WIF, amountRaw: "1840000000", spendableRaw: "1840000000", decimals: 6, symbol: "WIF", catalog: { symbol: "WIF", name: "dogwifhat", isVerified: true } },
        ],
      },
    }),
  );
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: true, walletAddress: TAKER, proof: { address: TAKER, via: "signin", expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, at: Date.now() }));
  await page.route("**/api/solana/limits/market", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    return json(route, 200, { price: priceOf(body.baseMint), baseUsd: priceOf(body.baseMint), quoteUsd: 1, observedAt: new Date().toISOString() });
  });
  await page.route("**/api/solana/swap/quote", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const coin = body.inputMint === USDC ? body.outputMint : body.inputMint;
    const usd = Number(body.amountRaw) / 1e6;
    const out = Math.floor((usd / priceOf(coin)) * 10 ** DECIMALS[coin]);
    return json(route, 200, { order: { inputMint: body.inputMint, outputMint: body.outputMint, inAmountRaw: body.amountRaw, outAmountRaw: String(out) }, decimals: DECIMALS, outputFee: { basisPoints: FEE_BPS[coin] ?? 50, feeRaw: "0", capApplied: false } });
  });
  await page.route("**/api/solana/limits/review", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    const making = String(Math.round(Number(body.amount) * 1e6));
    const taking = String(Math.floor((Number(body.amount) / Number(body.price)) * 1e6));
    return json(route, 200, {
      review: {
        venue: "trigger", side: body.side, order: ORDER, requestId: "req-1", pool: null, transactionBase64: "AQID",
        pair: { baseMint: body.baseMint, baseDecimals: 6, quoteMint: body.quoteMint, quoteDecimals: 6 },
        inputMint: body.quoteMint, outputMint: body.baseMint, makingRaw: making, takingRaw: taking, price: body.price, fillPrice: Number(body.price) * 0.995,
        fee: { ryntraBps: 50, venueBps: 0, ryntraFeeRaw: "0", venueFeeRaw: "0", reason: "RYNTRA", account: "Fee1111111111111111111111111111111111111111" },
        networkFeeLamports: 15000, depositLamports: 2039280, makerFeeShare: false, builtAt: new Date().toISOString(), signableMs: 25_000, risk: { verdict: "NO_KNOWN_BLOCKER", facts: [] },
      },
    });
  });
  await page.route("**/api/solana/limits/submit", (route) => {
    made.orders.push({ order: ORDER, state: "OPEN" });
    return json(route, 200, { state: "OPEN", signature: "5".repeat(88), settled: true });
  });
  await page.route("**/api/solana/limits/orders", (route) =>
    json(route, 200, {
      orders: made.orders.map((o) => ({ key: `${TAKER}:trigger:${ORDER}`, venue: "trigger", order: o.order, side: "buy", baseMint: JUP, quoteMint: USDC, inputMint: USDC, outputMint: JUP, makingRaw: "50000000", takingRaw: "200000000", filledInputRaw: "0", filledOutputRaw: "0", ryntraFeeRaw: "0", ryntraBps: 50, fillPrice: 0.249, state: o.state, placeSignature: null, cancelSignature: null, fills: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), throughRyntra: true, canCancel: true, canClaim: false, pool: null })),
      tokens: {},
      complete: true,
    }),
  );
  await page.route("**/api/v1/stops", (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const stop = { id: STOP_ID, side: body.side, base: body.base, quote: body.quote, amountRaw: body.amountRaw, price: body.price, thresholdRaw: "1", createdAt: Date.now(), expiresAt: null, state: "watching", reachedAt: null };
      made.stops.push(stop);
      return json(route, 201, { stop });
    }
    return json(route, 200, { stops: made.stops });
  });
  await page.route("**/api/v1/rules", (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      // The next whole hour, as the card's first purchase says (the schedule falls due there today).
      const due = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
      const rule = { id: RULE_ID, status: "active", amountUsd: body.amountUsd, asset: body.asset, schedule: body.schedule, nextDueAt: new Date(due).toISOString(), occurrences: [] };
      made.rules.push(rule);
      return json(route, 201, { rule });
    }
    return json(route, 200, { rules: made.rules, total: made.rules.length, budget: null });
  });
}

async function wallet(page) {
  await page.addInitScript(({ taker }) => {
    window.localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    window.localStorage.setItem("ryntra.city.firstHint", "1");
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
    const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    // Signs nothing: the stand's relay is a fixture, so the bytes shown come back as they were.
    const signTransaction = async (...inputs) => inputs.map((input) => ({ signedTransaction: input.transaction }));
    const stub = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction },
        "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(stub));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(stub) }));
  }, { taker: TAKER });
}

for (const lang of LANGS) {
  for (const s of SIZES.filter((size) => !process.env.ONLY || size.name === process.env.ONLY)) {
    const context = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile, locale: lang === "uk" ? "uk-UA" : "en-GB", timezoneId: "Europe/Kyiv" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await wallet(page);
    await stand(page);
    const ui = UI[lang];
    const say = SAY[lang];
    const shot = async (step) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${lang}-${s.name}-${step}.jpg`), type: "jpeg", quality: 84, timeout: 180_000 });
    };
    const tap = (locator) => (s.mobile ? locator.tap({ timeout: 90_000 }) : locator.click({ timeout: 90_000 }));
    const line = async (text) => {
      if (s.mobile) await tap(page.getByRole("button", { name: ui.ask }).first());
      else await page.keyboard.press("Control+k");
      await page.waitForTimeout(900);
      await page.getByRole("combobox", { name: ui.field }).fill(text);
      await page.waitForTimeout(900);
    };

    await page.goto(`${base}/?lang=${lang}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("[data-city-top]") && document.querySelector("canvas"), null, { timeout: 180_000 });
    await page.waitForTimeout(9000);
    for (const name of ["Later", "Got it", "Пізніше", "Зрозуміло"]) {
      const b = page.getByRole("button", { name, exact: true });
      if (await b.count()) await tap(b.first()).catch(() => {});
    }

    // 1. A regular purchase: the phrase, the agent's row first; the card; signed; «My instructions».
    await line(say.recurring);
    await shot("1-phrase");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: ui.sign, exact: true }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot("2-card-recurring");
    await tap(page.getByRole("button", { name: ui.sign, exact: true }).first());
    await page.getByRole("button", { name: ui.list, exact: true }).first().waitFor({ timeout: 30_000 });
    await shot("3-done");

    // 2. A stop: a share of what the wallet holds.
    await page.evaluate(() => window.__instruct?.getState().close());
    await line(say.stop);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: ui.sign, exact: true }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot("4-card-stop");
    await tap(page.getByRole("button", { name: ui.sign, exact: true }).first());
    await page.getByRole("button", { name: ui.list, exact: true }).first().waitFor({ timeout: 30_000 });

    // 3. A limit said without how much: one question, answered with a tap; the engine's order and its fee on the card.
    await page.evaluate(() => window.__instruct?.getState().close());
    await line(say.limit);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: ui.usd50, exact: true }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    await shot("5-card-ask");
    await tap(page.getByRole("button", { name: ui.usd50, exact: true }).first());
    await page.getByRole("button", { name: ui.sign, exact: true }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot("6-card-limit");
    await tap(page.getByRole("button", { name: ui.sign, exact: true }).first());
    await page.getByRole("button", { name: ui.list, exact: true }).first().waitFor({ timeout: 30_000 });

    // 4. «My instructions»: the three, each with its state from its engine and «Cancel».
    await tap(page.getByRole("button", { name: ui.list, exact: true }).first());
    await page.waitForTimeout(2500);
    await shot("7-list");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${lang}-${s.name}: overflow=${overflow}px errors=${errors.length}${errors.length ? ` → ${errors[0].slice(0, 300)}` : ""}`);
    await context.close();
  }
}
await browser.close();
