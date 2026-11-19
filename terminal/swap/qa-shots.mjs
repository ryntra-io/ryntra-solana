// The Swap and the Bridge after the quality pass of 19.11 at night, for the eyes: before (ryntra.io) and
// after (the stand), at 1920 and 390, in Ukrainian and English.
//
//   node terminal/swap/qa-shots.mjs <outDir> [base] [source]
//     base   — the site drawn (http://localhost:3140, or https://ryntra.io for «before»)
//     source — where every `/api/**` read is asked (https://ryntra.io)
//
// Reading only. A stub wallet in the Wallet Standard registry connects with a tap and never signs; its balances are the
// run's own (`/api/solana/holdings` answered here); the order route is answered here with the refusal under test —
// nothing reaches a venue, nothing is signed.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-322b");
const base = process.argv[3] ?? "http://localhost:3140";
const source = process.argv[4] ?? "https://ryntra.io";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const PREFIX = process.env.PREFIX ?? "";
mkdirSync(out, { recursive: true });

const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const row = (mint, raw, decimals, symbol, name) => ({ kind: "TOKEN", mint, amountRaw: raw, spendableRaw: raw, decimals, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", symbol, name, catalog: { symbol, name, isVerified: true, isSuspicious: false, icon: null } });
const native = (raw) => ({ kind: "NATIVE_SOL", mint: null, amountRaw: raw, spendableRaw: raw, decimals: 9, symbol: "SOL", name: "Solana" });
/** A wallet with no SOL at all and a little USDC — the quality pass's «wrong transaction» wallet. */
const NO_SOL = [native("0"), row(USDC, "236900", 6, "USDC", "USD Coin")];
/** A wallet with SOL, USDC, JUP and BONK — enough for any swap on screen. */
const RICH = [native("65858523956"), row(USDC, "248120000", 6, "USDC", "USD Coin"), row(JUP, "41250000", 6, "JUP", "Jupiter"), row(BONK, "1250000000", 5, "Bonk", "Bonk")];

const SIZES = [
  { name: "w1920", width: 1920, height: 1080, mobile: false },
  { name: "p390", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = ["uk", "en"].filter((lang) => !process.env.LANGS || process.env.LANGS.split(",").includes(lang));

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

/** Every `/api/**` read asked from the source, with the source's own origin (ryntra.io answers nothing else). */
async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: { "content-type": request.headers()["content-type"] ?? "application/json", accept: "application/json", origin: source, referer: `${source}/swap` },
      body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postData() ?? undefined,
    });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

const report = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    let holdings = null;
    let refusal = null;
    await context.route("**/api/**", fromSource);
    await context.route("**/api/solana/swap/order", (route) => route.fulfill({ status: refusal ? 409 : 503, contentType: "application/json", body: JSON.stringify({ error: { code: refusal ?? "ORDER_UNREACHABLE", message: "stubbed" } }) }));
    await context.route("**/api/solana/swap/execute", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await context.route("**/api/solana/holdings*", (route) =>
      holdings ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { tokenRead: "COMPLETE", holdings } }) }) : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => message.type() === "error" && !/Failed to load resource/.test(message.text()) && errors.push(message.text().slice(0, 300)));
    await page.addInitScript(({ taker }) => {
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
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
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: () => new Promise(() => {}) },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { taker: TAKER });

    const shot = async (state) => {
      await page.waitForTimeout(900);
      const file = `${PREFIX}${state}-${size.name}-${lang}.jpg`;
      await page.screenshot({ path: path.join(out, file), quality: 84, type: "jpeg" });
      const text = await page.evaluate(() => (document.querySelector("[data-page-main]") ?? document.body).innerText.replace(/\s+/g, " ").slice(0, 600));
      report.push(`${file}: ${text}`);
    };
    const go = async (url) => {
      await page.goto(`${base}${url}${url.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForSelector("input[inputmode='decimal']", { timeout: 120_000 }).catch(() => {});
      // The stand compiles on the first visit: the form is read only once its price has come.
      await page.waitForTimeout(5000);
    };
    const amount = async (text) => {
      const field = page.locator("input[inputmode='decimal']").first();
      await field.fill("");
      await field.type(text, { delay: 40 });
      await page.waitForTimeout(3500);
    };
    const flip = async () => {
      await page.getByRole("button", { name: lang === "uk" ? "Поміняти місцями" : "Switch the two coins" }).first().click();
      await page.waitForTimeout(3000);
    };
    const connect = async () => {
      const button = page.getByRole("button", { name: lang === "uk" ? /Підключити гаманець/ : /Connect wallet/ }).last();
      await button.click();
      await page.waitForTimeout(800);
      const phantom = page.getByRole("button", { name: /Phantom/ }).first();
      if (await phantom.isVisible().catch(() => false)) await phantom.click();
      await page.waitForTimeout(3500);
    };
    const want = (name) => !ONLY || ONLY.has(name);

    try {
      // B1: a sale with no wallet — the price for any pair.
      if (want("b1")) {
        holdings = null;
        await go("/swap");
        await flip();
        await amount("2");
        await shot("b1-sell-sol-no-wallet");
      }
      // m2: the pair a link names.
      if (want("m2")) {
        await go(`/swap?from=USDC&to=${JUP}`);
        await page.waitForTimeout(3000);
        await amount("25");
        await shot("m2-link-usdc-jup");
      }
      // M15: the picker, then a search.
      if (want("m15")) {
        holdings = RICH;
        await go("/swap");
        await connect();
        await page.getByRole("button", { name: lang === "uk" ? /Обрати, що отримаєш/ : /Pick the coin you get/ }).first().click();
        await page.waitForTimeout(3500);
        await shot("m15-picker-get");
        await page.locator("[role='dialog'] input[type='search']").fill("jup");
        await page.waitForTimeout(3500);
        await shot("m15-picker-search-jup");
        await page.keyboard.press("Escape");
      }
      // m1: the flip keeps the amount; B1: a sale above the balance shows its price and its own line.
      if (want("m1")) {
        holdings = RICH;
        refusal = "ORDER_BUILD_FAILED";
        await go("/swap");
        await connect();
        await amount("50");
        await shot("m1-before-flip");
        await flip();
        await shot("m1-after-flip");
        await amount("100");
        await shot("b1-sell-above-balance");
      }
      // M14: a refused build says nothing red before the press, and the truth after it.
      if (want("m14")) {
        holdings = RICH;
        refusal = "ORDER_BUILD_FAILED";
        await go("/swap");
        await connect();
        await amount("10");
        await page.waitForTimeout(3000);
        await shot("m14-before-press");
        await page.getByRole("button", { name: lang === "uk" ? "Маршрут і деталі" : "Route and details" }).first().click().catch(() => {});
        await shot("m14-details-open");
        const press = page.getByRole("button", { name: lang === "uk" ? "Обміняти" : "Swap", exact: true }).last();
        await press.click();
        await page.waitForTimeout(3500);
        await shot("m14-after-press");
        holdings = NO_SOL;
        refusal = "TRANSACTION_FEE_PAYER_MISMATCH";
        await go("/swap");
        await connect();
        await amount("0.2");
        await shot("m14-no-sol");
      }
      // M13: the bridge, another address.
      if (want("m13")) {
        holdings = null;
        await go("/bridge");
        await page.waitForTimeout(4000);
        await amount("0.01");
        await page.locator("[data-bridge-another]").first().click().catch(() => {});
        await page.waitForTimeout(12_000);
        await shot("m13-bridge-other-address");
      }
    } catch (error) {
      report.push(`${size.name}-${lang}: ${String(error).slice(0, 300)}`);
    }
    if (errors.length) report.push(`${size.name}-${lang} page errors: ${errors.slice(0, 5).join(" | ")}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, `${PREFIX}report.txt`), report.join("\n"));
console.log(report.join("\n"));
