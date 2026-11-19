// The Spot desk paying with any coin, for the eyes → <out>/*.jpg, and whether every logo in a list came.
//   node terminal/coin/pay-shots.mjs [out] [baseUrl] [source]
// A stand: `next build`, then `next start` with the production flags. The system Chrome draws the page (PRESS_CHROME
// may point at another). SIZES=desk2560,desk1920,phone and LANGS=en,uk narrow the run; BEFORE=1 shoots the page as it
// stands at `base` (ryntra.io before the change) under the names `before-*`.
//
// Every read is the engine's, asked from `source` (ryntra.io by default) with its own origin: the market, the candles,
// the trades, the logos, a swap's price, a limit's market — reads only. The wallet is a stub of the Wallet Standard: it
// connects and never signs; its balances are a fixture. Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-326");
const base = process.argv[3] ?? "http://localhost:3133";
const source = process.argv[4] ?? "https://ryntra.io";
const BEFORE = process.env.BEFORE === "1";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
/** A coin the market read does not hold (a pump.fun coin the catalogue knows): opened by its address. */
const OUTSIDE = process.env.OUTSIDE || "3WgDGTpLvrPu6ePiP34K1Ua4kemD749TY4Ky1eztpump";
const ORIGIN = { origin: "https://ryntra.io", referer: "https://ryntra.io/" };

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk2560", width: 2560, height: 1440, mobile: false },
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const report = [];

/** The Market's own logos of the wallet's fixture coins, read from the source: the wallet names its coins as the engine does. */
async function catalogIcons() {
  try {
    const body = await (await fetch(`${source}/api/v1/market/depth?list=saved&mints=${[USDC, USDT, BONK, WIF, MET].join(",")}`, { headers: ORIGIN })).json();
    return new Map(body.coins.map((coin) => [coin.id, coin.icon]));
  } catch {
    return new Map();
  }
}
const ICONS = await catalogIcons();
const row = (mint, symbol, name, raw, decimals) => ({ kind: "TOKEN", mint, amountRaw: raw, spendableRaw: raw, decimals, symbol, catalog: { symbol, name, isVerified: true, icon: ICONS.get(mint) ?? null } });
/** A wallet with SOL, both dollars and three coins of its own. */
const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
  row(USDC, "USDC", "USD Coin", "250000000", 6),
  row(USDT, "USDT", "USDT", "120500000", 6),
  row(BONK, "Bonk", "Bonk", "1250000000000", 5),
  row(WIF, "$WIF", "dogwifhat", "84000000", 6),
  row(MET, "MET", "Meteora", "312000000", 6),
];

/** A read asked from the source with its origin, answered as the stand would; a source that does not answer is a 503. */
async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  const readPost = request.method() === "POST" && (url.pathname === "/api/solana/swap/quote" || url.pathname === "/api/solana/limits/market");
  if (request.method() !== "GET" && !readPost) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: { ...ORIGIN, "content-type": "application/json", accept: request.headers().accept ?? "*/*" },
      body: readPost ? request.postData() : undefined,
    });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

/** The pictures of an open list: how many came, and which did not after their wait. */
const LOGOS = (selector) => {
  const imgs = [...document.querySelectorAll(`${selector} img`)];
  const letters = document.querySelectorAll(`${selector} span[aria-hidden="true"]`).length;
  const missing = imgs.filter((img) => !(img.complete && img.naturalWidth > 0)).map((img) => img.getAttribute("src")?.slice(0, 60));
  return { imgs: imgs.length, loaded: imgs.length - missing.length, missing, letters };
};

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.mobile ? 2 : 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    let holdings = null;
    if (!BEFORE) {
      await context.route("**/api/**", fromSource);
      await context.route("**/api/solana/swap/order", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
      await context.route("**/api/solana/swap/execute", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
      await context.route("**/api/solana/holdings*", (route) =>
        holdings ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { tokenRead: "COMPLETE", holdings } }) }) : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
      );
      await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
      await context.route("**/api/growth/cards?*", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "proof required", proof: false }) }));
    }

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // A stub wallet in the Wallet Standard registry: it connects with a tap and never signs.
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

    const words =
      lang === "uk"
        ? { pick: "Обрати монету", payAnother: "Платити іншою монетою", sell: "Продати", buy: "Купити", limit: "Ліміт", stop: "Стоп", connect: "Підключити гаманець", ticket: "Купівля та продаж", find: "Монета, тікер чи адреса", paidIn: "Отримаєш у", holders: "Власники", traders: "Трейдери", liquidity: "Ліквідність" }
        : { pick: "Pick a coin", payAnother: "Pay with another coin", sell: "Sell", buy: "Buy", limit: "Limit", stop: "Stop", connect: "Connect wallet", ticket: "Buy and sell", find: "Coin, ticker or address", paidIn: "Paid in", holders: "Holders", traders: "Traders", liquidity: "Liquidity" };
    const prefix = BEFORE ? "before-" : "";
    const shot = async (state, list = null) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${prefix}${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
      const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
      const logos = list ? await page.evaluate(LOGOS, list) : null;
      report.push(`${prefix}${state}-${size.name}-${lang}: overflow ${overflow.join("×")} px${logos ? `; logos ${logos.loaded}/${logos.imgs} came, letters ${logos.letters}${logos.missing.length ? `, missing ${logos.missing.join(" ")}` : ""}` : ""}`);
    };
    const open = async (mint) => {
      await page.goto(`${base}/coin/${mint}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForSelector(".ryntra-chart canvas", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(6_000);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const ticket = () => (size.mobile ? page.locator('[role="dialog"][aria-modal="true"]') : page.locator(`[aria-label="${words.ticket}"]`).first());
    const payMenu = async () => {
      await tap(ticket().locator(`button[aria-label="${words.payAnother}"]`).first());
      await page.waitForTimeout(2_500);
    };
    const pickInMenu = async (symbol) => {
      await tap(page.locator('[role="menu"] [role="menuitemradio"]', { hasText: new RegExp(`^${symbol}`) }).first());
      await page.waitForTimeout(4_500);
    };
    const sheet = async (side) => {
      if (!size.mobile) return;
      await tap(page.locator(`button[data-side="${side}"]`));
      await page.waitForTimeout(1_500);
    };
    const picker = async () => {
      await tap(page.locator(`button[aria-label$="${words.pick}"]`));
      await page.waitForTimeout(3_500);
    };

    try {
      // SOL: paid for in dollars — USDC and USDT.
      await open(SOL);
      if (!size.mobile) await shot("sol");
      await sheet("buy");
      await payMenu();
      await shot("sol-pay", '[role="menu"]');
      await page.keyboard.press("Escape");

      // JUP: SOL, USDC and USDT; Tether picked, its price and the quick sums in dollars.
      await open(JUP);
      await sheet("buy");
      await payMenu();
      await shot("jup-pay", '[role="menu"]');
      if (!BEFORE) {
        await pickInMenu("USDT");
        await shot("jup-usdt");
        // The sale: paid in SOL, USDC or USDT on choice.
        await tap(ticket().getByRole("radio", { name: words.sell, exact: true }));
        await page.waitForTimeout(800);
        // Without a wallet the sale asks for one first: the fixture's wallet holds JUP for it.
      }
      // The list, then the phone's sheet: each closes on its own Escape.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      if (size.mobile) await page.keyboard.press("Escape");
      await page.waitForTimeout(600);

      // The coin picker: «Main» first.
      await picker();
      await shot("picker", '[role="dialog"]');
      if (!BEFORE && size.name !== "desk2560") {
        await page.locator(`input[placeholder="${words.find}"]`).fill("usdt");
        await page.waitForTimeout(2_500);
        await shot("picker-find", '[role="dialog"]');
        // A coin outside the market, by its address: the row opens it, its logo and its ticket with it.
        await page.locator(`input[placeholder="${words.find}"]`).fill(OUTSIDE);
        await page.waitForTimeout(3_000);
        await shot("picker-address", '[role="dialog"]');
        await page.keyboard.press("Enter");
        await page.waitForURL(`**/coin/${OUTSIDE}**`, { timeout: 60_000 });
        await page.waitForTimeout(9_000);
        await shot("outside");
      } else await page.keyboard.press("Escape");

      if (!BEFORE && size.name === "desk1920") {
        // Under the chart and beside it: the market's tables and the pool's liquidity.
        await open(JUP);
        await tap(page.getByRole("tab", { name: words.holders, exact: true }).first());
        // The holders are a slow read of the chain (about eight seconds when not cached).
        await page.waitForTimeout(11_000);
        await shot("under-holders");
        await tap(page.getByRole("tab", { name: words.traders, exact: true }).first());
        await page.waitForTimeout(2_500);
        await tap(page.getByRole("tab", { name: words.liquidity, exact: true }).first());
        await page.waitForTimeout(4_000);
        await shot("under-traders-liquidity");
      }

      if (!BEFORE && !size.mobile) {
        // Limit with Tether: its price field wears Tether's logo.
        await open(JUP);
        await payMenu();
        await pickInMenu("USDT");
        await tap(ticket().getByRole("tab", { name: words.limit, exact: true }));
        await page.waitForTimeout(3_500);
        await shot("jup-limit-usdt");
        await tap(ticket().getByRole("tab", { name: words.stop, exact: true }));
        await page.waitForTimeout(2_500);
        await shot("jup-stop-usdt");
      }

      if (!BEFORE && size.name !== "desk2560") {
        // A wallet: connected from the ticket, its coins with their balances beside the money.
        holdings = [...HOLDINGS, row(JUP, "JUP", "Jupiter", "52000000", 6)];
        await open(JUP);
        await sheet("buy");
        await tap(ticket().getByRole("button", { name: words.connect }).last());
        await page.waitForTimeout(800);
        const phantom = page.getByRole("button", { name: "Phantom" });
        if (await phantom.count()) await tap(phantom.first());
        await page.waitForTimeout(5_000);
        await payMenu();
        await shot("wallet-pay", '[role="menu"]');
        await pickInMenu("Bonk");
        await shot("wallet-bonk");
        await tap(ticket().getByRole("radio", { name: words.sell, exact: true }));
        await page.waitForTimeout(4_500);
        await tap(ticket().locator(`button[aria-label^="${words.paidIn}"]`).first());
        await page.waitForTimeout(2_500);
        await shot("wallet-sell-paid", '[role="menu"]');
        await pickInMenu("USDT");
        await shot("wallet-sell-usdt");
        holdings = null;
      }
    } catch (error) {
      report.push(`${size.name}/${lang}: stopped — ${String(error).split("\n")[0]}`);
      await page.screenshot({ path: path.join(out, `${prefix}stopped-${size.name}-${lang}.jpg`), quality: 70, type: "jpeg" }).catch(() => {});
    }
    report.push(`${size.name}/${lang}: page errors ${errors.length}${errors.length ? ` — ${errors.slice(0, 3).join(" | ")}` : ""}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, BEFORE ? "before-report.txt" : "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
