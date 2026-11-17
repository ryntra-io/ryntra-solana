// The Market and a coin's screen for the eyes, at 1440×900 and 390×844, in English and Ukrainian → <out>/*.jpg
//   node terminal/coin/shots.mjs [out] [baseUrl] [source]
// A stand runs with the switch on: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` (`next build`, then `next start`). The system
// Chrome draws the page (PRESS_CHROME may point at another).
//
// The figures are the engine's: the market read, the candles, the coins' logos and the price of a swap are asked from
// `source` (ryntra.io by default) — reads only, no wallet. The wallet is a stub of the Wallet Standard: it connects and
// never signs (a request to sign is recorded and left waiting), and its balances are a fixture. The exact order is the
// engine's own recorded answer (`app/api/solana/swap/golden`), re-priced to the live price on screen. Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/coin");
const base = process.argv[3] ?? "http://localhost:3252";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const golden = JSON.parse(readFileSync(new URL("../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
const recordedOrder = () => structuredClone(golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body);

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];

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
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    const asked = { quote: 0, order: 0, execute: 0, signs: [] };
    let quoteFails = false;
    let lastQuote = null;
    const orders = [];
    let holdings = null;

    // Every read the screens make, answered at once: from the source, from a fixture, or 503.
    await context.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    for (const pattern of ["**/api/city", "**/api/spot/candles?*", "**/api/icon/**"]) await context.route(pattern, fromSource);
    await context.route("**/api/solana/swap/quote", async (route) => {
      asked.quote += 1;
      if (quoteFails) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests." } }) });
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
      holdings ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { tokenRead: "COMPLETE", holdings } }) }) : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    await context.route("**/api/growth/cards?*", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "proof required", proof: false }) }));

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.exposeFunction("__recordSign", (wire) => asked.signs.push(wire));
    // A stub wallet in the Wallet Standard registry: it connects with a tap and never signs.
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

    const name = (state) => path.join(out, `${state}-${size.name}-${lang}.jpg`);
    const shot = async (state) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: name(state), quality: 86, type: "jpeg" });
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const ticket = () => page.locator(`section[aria-label="${lang === "uk" ? "Купівля та продаж" : "Buy and sell"}"]`);

    // ── the Market ──
    await page.goto(`${base}/market?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("[role='table'] [role='row'] a[href^='/coin/']", { state: "attached", timeout: 180_000 });
    await page.waitForResponse((res) => res.url().includes("/api/city"), { timeout: 20_000 }).catch(() => {});
    await settle();
    await shot("market");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    report.push(`${size.name}/${lang}: market rows ${await page.locator("a[href^='/coin/']").count()}, sideways overflow ${overflow}px`);

    if (!size.mobile) {
      // A sort by the day's move, then the memes, then a search with no answer.
      await page.locator("[role='columnheader'] button").nth(4).click();
      await shot("market-sorted");
      await page.getByRole("tab").nth(2).click();
      await shot("market-memes");
      await page.getByRole("tab").nth(5).click();
      await shot("market-saved-empty");
      await page.getByRole("tab").first().click();
      await page.getByRole("searchbox").fill("zzzz");
      await shot("market-no-match");
      await page.getByRole("searchbox").fill("");
    } else {
      await tap(page.getByRole("button", { name: lang === "uk" ? "Пошук монети" : "Search a coin" }).first());
      await page.getByRole("searchbox").fill("jup");
      await shot("market-search");
      await page.getByRole("searchbox").fill("");
    }

    // The agent's line: a sentence goes to the coin's screen with its ticket filled.
    const line = page.getByRole("combobox").first();
    if (size.mobile) await tap(line);
    else await page.keyboard.press("Control+k");
    await line.fill(lang === "uk" ? "купи JUP на 10 USDC" : "buy JUP for 10 USDC");
    await page.waitForSelector("[role='listbox']:not([hidden]) [role='option']", { timeout: 20_000 });
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/coin/${JUP}`), { timeout: 30_000 });
    await settle();
    await page.waitForTimeout(2500);
    await shot("coin-said");
    const filled = await page.locator("input[inputmode='decimal']").first().inputValue();
    report.push(`${size.name}/${lang}: the sentence filled the ticket with «${filled}»`);

    // ── a coin's screen, as a person opens it ──
    await page.goto(`${base}/coin/${SOL}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForSelector("canvas, [role='status']", { timeout: 60_000 }).catch(() => {});
    await settle();
    await page.waitForTimeout(3000);
    // A price the source was too busy to give is asked again the way a person would: the quiet «Try again».
    const busy = page.getByRole("button", { name: lang === "uk" ? "Ще раз" : "Try again" }).first();
    if (await busy.isVisible().catch(() => false)) {
      await page.waitForTimeout(8000);
      await tap(busy);
      await page.waitForTimeout(3000);
    }
    await shot("coin");

    // A price that does not come: one calm line, a quiet «Try again» that only reads the price.
    quoteFails = true;
    const amount = page.locator("input[inputmode='decimal']").first();
    await amount.fill("12");
    await page.waitForTimeout(2500);
    await shot("coin-quote-failed");
    const ordersBefore = asked.order;
    quoteFails = false;
    await tap(page.getByRole("button", { name: lang === "uk" ? "Ще раз" : "Try again" }).first());
    await page.waitForTimeout(2500);
    report.push(`${size.name}/${lang}: «Try again» asked ${asked.order - ordersBefore} orders and ${asked.signs.length} signatures`);

    // The wallet: connected from the ticket, its balances read; the exact order follows the price.
    holdings = [
      { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
      { kind: "TOKEN", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
    ];
    await amount.fill("100");
    await page.waitForTimeout(1500);
    await tap(ticket().getByRole("button", { name: lang === "uk" ? "Підключити гаманець" : "Connect wallet" }));
    await page.waitForTimeout(800);
    const pick = ticket().getByRole("button", { name: "Phantom" });
    if (await pick.count()) await tap(pick);
    await page.waitForTimeout(5000);
    await shot("coin-order");
    const info = ticket().getByRole("button", { name: lang === "uk" ? "Деталі угоди" : "Trade details" });
    if (await info.count()) {
      await tap(info);
      await shot("coin-details");
      await page.keyboard.press("Escape");
    }
    // The one press over the exact order: the wallet is asked, and the stub keeps it waiting.
    await page.waitForTimeout(1400);
    await tap(ticket().getByRole("button", { name: lang === "uk" ? "Купити SOL" : "Buy SOL" }));
    await page.waitForTimeout(1500);
    await shot("coin-wallet");
    const signed = asked.signs.at(-1) ?? null;
    report.push(`${size.name}/${lang}: orders built for ${orders.join(", ")}`);
    report.push(`${size.name}/${lang}: the wallet was asked ${asked.signs.length} time(s); the bytes are the order's own — ${signed !== null && signed === recordedOrder().order.transactionBase64}; executes ${asked.execute}`);

    // A coin the engine cannot name.
    await page.goto(`${base}/coin/1111111111111111111111111111111111111111111?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle();
    await page.waitForTimeout(1500);
    await shot("coin-unknown");

    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
