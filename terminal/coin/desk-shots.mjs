// The coin's trading desk for the eyes → <out>/*.jpg, and the corners of what stands on it.
//   node terminal/coin/desk-shots.mjs [out] [baseUrl] [source]
// A stand: `next build`, then `next start` with the production flags (`NEXT_PUBLIC_RYNTRA_TERMINAL=open` and the city's
// flags). The system Chrome draws the page (PRESS_CHROME may point at another). SIZES=desk1920,desk1440,phone and
// LANGS=en,uk narrow the run; BEFORE=1 shoots the page as it stands at `base` under the names `before-*`.
//
// Every read is the engine's, asked from `source` (ryntra.io by default): the market, the candles, the trades, the
// holders, the pools, the logos, a swap's price — reads only. The wallet is a stub of the Wallet Standard: it connects
// and never signs; its balances are a fixture. Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-284");
const base = process.argv[3] ?? "http://localhost:3184";
const source = process.argv[4] ?? "https://ryntra.io";
const BEFORE = process.env.BEFORE === "1";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const SIZES = [
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const report = [];

/** The Market's most traded meme of the day, read from the source: the desk's meme. */
async function memeMint() {
  try {
    const body = await (await fetch(`${source}/api/v1/market/depth?list=trending&kind=meme&window=24h`)).json();
    return body.coins.find((coin) => coin.venue === "pump")?.id ?? body.coins[0]?.id ?? null;
  } catch {
    return null;
  }
}
const MEME = await memeMint();

/** A read asked from the source, answered as the stand would; a source that does not answer is a 503. */
async function fromSource(route) {
  const request = route.request();
  const url = new URL(request.url());
  const readPost = request.method() === "POST" && url.pathname === "/api/solana/swap/quote";
  if (request.method() !== "GET" && !readPost) return route.fulfill({ status: 204, body: "" });
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: { "content-type": "application/json", accept: request.headers().accept ?? "*/*" },
      body: readPost ? request.postData() : undefined,
    });
    const body = Buffer.from(await answer.arrayBuffer());
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

/** Every box on screen whose corner is not 0, 4 px or a circle, with what it is: the form allows nothing else. */
const CORNERS = () => {
  const odd = new Map();
  for (const el of document.querySelectorAll("main *")) {
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > innerHeight) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const r = parseFloat(style.borderTopLeftRadius) || 0;
    const circle = r >= Math.min(box.width, box.height) / 2 - 0.5;
    if (r === 0 || r === 4 || circle) continue;
    const key = `${r}px ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]?.slice(0, 40)}`;
    odd.set(key, (odd.get(key) ?? 0) + 1);
  }
  return [...odd.entries()].map(([key, n]) => `${key} ×${n}`);
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
    await context.route("**/api/**", fromSource);
    await context.route("**/api/solana/swap/order", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await context.route("**/api/solana/swap/execute", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await context.route("**/api/solana/holdings*", (route) =>
      holdings ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { tokenRead: "COMPLETE", holdings } }) }) : route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await context.route("**/api/auth/solana/session*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signedIn: false, walletAddress: null, proof: null, at: Date.now() }) }));
    await context.route("**/api/growth/cards?*", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "proof required", proof: false }) }));

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

    const prefix = BEFORE ? "before-" : "";
    const name = (state) => path.join(out, `${prefix}${state}-${size.name}-${lang}.jpg`);
    const shot = async (state, corners = !BEFORE) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: name(state), quality: 86, type: "jpeg" });
      const overflow = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
      const odd = corners ? await page.evaluate(CORNERS) : [];
      report.push(`${prefix}${state}-${size.name}-${lang}: overflow ${overflow.join("×")} px${odd.length ? `; corners off the form: ${odd.join(", ")}` : ""}`);
    };
    const open = async (mint) => {
      await page.goto(`${base}/coin/${mint}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForSelector(".ryntra-chart canvas", { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(6_000);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const words = lang === "uk" ? { pick: "Обрати монету", tick: "Тік", connect: "Підключити гаманець", buy: "Купити" } : { pick: "Pick a coin", tick: "Tick", connect: "Connect wallet", buy: "Buy" };

    if (BEFORE) {
      await open(CBBTC);
      await shot("cbbtc");
      await context.close();
      continue;
    }

    if (!size.mobile) {
      await open(SOL);
      await shot("sol");
      await open(CBBTC);
      await shot("cbbtc");
      if (MEME) {
        await open(MEME);
        await shot("meme");
      }
      if (size.name === "desk1920") {
        await open(NVDAX);
        await shot("stock");
        // The picker: the search and the kinds, open over the desk.
        await open(CBBTC);
        await tap(page.locator(`button[aria-label$="${words.pick}"]`));
        await page.waitForTimeout(2_500);
        await shot("picker");
        await page.getByRole("tab", { name: lang === "uk" ? "Меми" : "Memes" }).click();
        await page.waitForTimeout(2_500);
        await shot("picker-memes");
        await page.keyboard.press("Escape");
        // «Tick»: a bar a trade.
        await page.getByRole("radio", { name: words.tick, exact: true }).click();
        await page.waitForTimeout(4_000);
        await shot("tick");
        await page.getByRole("radio", { name: lang === "uk" ? "15 хв" : "15m", exact: true }).click();
        // A wallet: connected from the ticket, its balances read; the bottom panel turns to the person's own.
        holdings = [
          { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
          { kind: "TOKEN", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } },
        ];
        await open(SOL);
        await tap(page.getByRole("button", { name: words.connect }).last());
        await page.waitForTimeout(800);
        const pick = page.getByRole("button", { name: "Phantom" });
        if (await pick.count()) await tap(pick.first());
        await page.waitForTimeout(5_000);
        await shot("wallet");
      }
    } else {
      if (MEME) {
        await open(MEME);
        await shot("phone");
        await page.evaluate(() => window.scrollTo(0, 560));
        await shot("phone-under");
        await page.evaluate(() => window.scrollTo(0, 0));
        await tap(page.locator(`button[data-side="buy"]`));
        await page.waitForTimeout(2_500);
        await shot("phone-ticket");
        await page.keyboard.press("Escape");
      }
      await open(SOL);
      await shot("phone-sol");
    }
    report.push(`${size.name}/${lang}: page errors ${errors.length}${errors.length ? ` — ${errors.slice(0, 3).join(" | ")}` : ""}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, BEFORE ? "before-report.txt" : "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
