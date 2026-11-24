// The coin's buy ticket for the eyes — 1440×900, 1366×768 and 390×844, English and Ukrainian → <out>/*.jpg, with where
// its one button stands and any two of its lines that overlap (report.txt).
//   node terminal/coin/buy-shots.mjs [out] [baseUrl]        SIZES=d1440,d1366,phone  LANGS=en,uk
// A stand with limits and stops open: NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_SPOT=open
// NEXT_PUBLIC_RYNTRA_CITY_STOPS=open. Every read is answered from a fixture shaped as the engine answers (no network):
// the coin's market and passport, a price made from the swap engine's recorded order, the wallet's balances and its
// record in the coin. The wallet is a stub of the Wallet Standard that connects and never signs. Nothing is sent.
// The risk line and the market-cap switch stand once the coin's screen hands the ticket `risk` and `supply`.
// In a container whose Playwright differs from the project's, PRESS_CHROME names the browser (/opt/pw-browsers/chromium).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/* The browser the container already carries: required, so it resolves from anywhere. */
const { chromium } = createRequire(import.meta.url)("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-352");
const base = process.argv[3] ?? "http://localhost:3252";
mkdirSync(out, { recursive: true });

const REPO = new URL("../..", import.meta.url).pathname;
const SOL = "So11111111111111111111111111111111111111112";
const MEME = process.env.MINT ?? "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK, 5 decimals
const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const golden = JSON.parse(readFileSync(`${REPO}app/api/solana/swap/golden/transcripts.json`, "utf8"));
const recorded = () => structuredClone(golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body);

const SOL_USD = 140;
const COIN_USD = 0.0000231;
const DEC = 5;
const SUPPLY = 88_000_000_000_000;

function quoteFor(input) {
  const body = recorded();
  const inRaw = BigInt(input.amountRaw);
  const buying = input.inputMint === SOL;
  const inUnits = Number(inRaw) / 10 ** (buying ? 9 : DEC);
  const outUnits = buying ? (inUnits * SOL_USD) / COIN_USD : (inUnits * COIN_USD) / SOL_USD;
  const outRaw = BigInt(Math.floor(outUnits * 10 ** (buying ? DEC : 9)));
  Object.assign(body.order, {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inAmountRaw: String(inRaw),
    outAmountRaw: String(outRaw),
    minReceivedRaw: String((outRaw * 995n) / 1000n),
    slippageBps: 50,
    priceImpactPct: "0.0012",
  });
  return {
    order: body.order,
    review: body.review,
    verdict: body.assetReview ?? body.verdict,
    decimals: { [SOL]: 9, [MEME]: DEC },
    outputFee: { basisPoints: 0, feeRaw: "0", capApplied: false },
    passports: {},
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    check: null,
    risk: body.risk,
  };
}

const stats = (pct) => ({ priceChangePct: pct, volumeUsd: 12_500_000, buys: 9000, sells: 8000, traders: 11_000 });
const market = {
  mint: MEME, symbol: "BONK", name: "Bonk", icon: null, decimals: DEC, tokenProgram: null, verified: true, tags: [], category: "meme", issuer: null,
  price: COIN_USD, change1hPct: 1.2, change24hPct: -3.4, volume24hUsd: 12_500_000, liquidityUsd: 4_200_000,
  marketCapUsd: COIN_USD * SUPPLY, fdvUsd: COIN_USD * SUPPLY * 1.1, holders: 912_000, organicScore: 90, organicScoreLabel: "high", firstPoolAt: "2023-01-01T00:00:00Z",
  audit: { devBalancePct: 0, topHoldersPct: 31.2, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, suspicious: false },
  links: { website: null, twitter: null, telegram: null },
  stats: { h1: stats(1.2), h24: stats(-3.4) },
  updatedAt: new Date().toISOString(),
};

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const SIZES = [
  { name: "d1440", width: 1440, height: 900, mobile: false },
  { name: "d1366", width: 1366, height: 768, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    let holdings = null;
    await context.route("**/api/**", (route) => json(route, 503, {}));
    await context.route("**/api/spot/market?*", (route) => json(route, 200, { market }));
    const win = { priceChangePct: 1.1, volumeUsd: 100000, buyVolumeUsd: 60000, sellVolumeUsd: 40000, buys: 900, sells: 700, traders: 800, holderChangePct: 0.2, liquidityChangePct: -1.5 };
    await context.route("**/api/spot/token?*", (route) => {
      const part = new URL(route.request().url()).searchParams.get("part");
      if (part === "overview")
        return json(route, 200, { facts: { mint: MEME, circulatingSupply: SUPPLY, totalSupply: SUPPLY, dev: "Crea7orStand1111111111111111111111111111111", devMints: 14, devMigrations: 1, launchpad: null, graduatedAt: null, createdAt: "2023-01-01T00:00:00Z", socials: [], windows: { m5: win, h1: win, h6: win, h24: win } } });
      if (part === "risk")
        return json(route, 200, { facts: [ { code: "TOP10", tone: "warn", state: null, value: 61.2, source: "jupiter" }, { code: "CREATOR_HOLDS", tone: "plain", state: null, value: 2.1, source: "jupiter" }, { code: "MINT_AUTHORITY", tone: "plain", state: "revoked", value: null, source: "jupiter" }, { code: "FREEZE_AUTHORITY", tone: "plain", state: "revoked", value: null, source: "jupiter" } ] });
      return json(route, 503, {});
    });
    await context.route("**/api/solana/swap/quote", (route) => json(route, 200, quoteFor(route.request().postDataJSON())));
    await context.route("**/api/solana/limits/market", (route) => json(route, 200, { price: (COIN_USD / SOL_USD), quoteUsd: SOL_USD }));
    await context.route("**/api/solana/swap/order", (route) => {
      const { input } = route.request().postDataJSON();
      const q = quoteFor(input);
      const body = recorded();
      Object.assign(body.order, q.order);
      body.decimals = q.decimals;
      const expires = new Date(Date.now() + 45_000).toISOString();
      body.expiresAt = expires;
      body.order.reviewExpiresAt = expires;
      return json(route, 200, body);
    });
    await context.route("**/api/solana/holdings*", (route) => (holdings ? json(route, 200, { data: { tokenRead: "COMPLETE", holdings } }) : json(route, 503, {})));
    await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/wallet-watch/wallet?*", (route) =>
      json(route, 200, {
        ok: true,
        token: null,
        view: {
          gap: false, skipped: 0, solUsd: SOL_USD,
          tokens: [{ mint: MEME, buys: 3, sells: 1, bought: 9_000_000, sold: 3_000_000, spentSol: 1.42, receivedSol: 0.61, partial: false, priceUsd: COIN_USD }],
          trades: [{ mint: MEME, quote: "SOL", paidBy: null }],
        },
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + (/hydrated/.test(m.text()) ? m.text().slice(-1800) : m.text().slice(0, 400))); });
    await page.addInitScript(({ taker }) => {
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
      const account = { address: taker, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0", name: "Phantom", icon, chains: ["solana:mainnet"], accounts: [],
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

    const tag = `${size.name}-${lang}`;
    const shot = async (name) => {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, `${name}-${tag}.jpg`), type: "jpeg", quality: 84 });
    };
    const ticket = () => page.locator(`section[aria-label="${lang === "uk" ? "Купівля та продаж" : "Buy and sell"}"]`).first();
    const measure = async (name) => {
      const m = await page.evaluate((label) => {
        const t = document.querySelector(`section[aria-label="${label}"]`);
        if (!t) return null;
        const go = [...t.querySelectorAll("button")].filter((b) => b.className.includes("go") || /Buy|Купити|Connect|Підключити/.test(b.textContent ?? "")).at(-1);
        const r = go?.getBoundingClientRect();
        // Any two of the ticket's text lines that overlap.
        const lines = [...t.querySelectorAll("p, span, b, dd, dt, label")].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() && el.getClientRects().length);
        const boxes = lines.map((el) => ({ text: el.textContent.trim().slice(0, 24), r: el.getBoundingClientRect() }));
        const hits = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r, b = boxes[j].r;
          if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(`${boxes[i].text} × ${boxes[j].text}`);
        }
        return { button: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), text: go.textContent } : null, innerHeight, overlaps: hits.slice(0, 6), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      }, lang === "uk" ? "Купівля та продаж" : "Buy and sell");
      report.push(`${name}-${tag}: ${JSON.stringify(m)}`);
    };

    await page.goto(`${base}/coin/${MEME}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: 120_000 }).catch(() => {});
    await page.waitForTimeout(6000);
    if (size.mobile) {
      const buy = page.getByRole("button", { name: lang === "uk" ? /Купити/ : /Buy/ }).first();
      await buy.tap().catch(() => {});
      await page.waitForTimeout(1500);
    }
    await shot("coin");
    await measure("coin");

    // A wallet: connected from the ticket, balances read; the strip and the exact order follow.
    holdings = [
      { kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 },
      { kind: "TOKEN", mint: MEME, amountRaw: "600000000000", spendableRaw: "600000000000", decimals: DEC, symbol: "BONK" },
    ];
    const connect = ticket().getByRole("button", { name: lang === "uk" ? "Підключити гаманець" : "Connect wallet" });
    if (await connect.count()) {
      await connect.click();
      await page.waitForTimeout(800);
      const pick = ticket().getByRole("button", { name: "Phantom" });
      if (await pick.count()) await pick.click();
    }
    await page.waitForTimeout(5000);
    // Take-profit and stop on.
    const sw = ticket().getByRole("switch").first();
    if (await sw.count()) await sw.click();
    await shot("coin-wallet");
    await measure("coin-wallet");
    const info = ticket().getByRole("button", { name: lang === "uk" ? "Деталі угоди" : "Trade details" });
    if (await info.count()) {
      await info.click();
      await shot("coin-details");
      await info.click();
    }
    const how = ticket().getByRole("button", { name: lang === "uk" ? "Як працюють тейк-профіт і стоп" : "How take-profit and stop work" });
    if (await how.count()) {
      await how.click();
      await shot("coin-protect-how");
      await how.click();
    }
    const edit = ticket().getByRole("button", { name: lang === "uk" ? "Змінити швидкі суми" : "Change quick sums" }).first();
    if (await edit.count()) {
      await edit.click();
      await shot("coin-edit");
      await edit.click().catch(() => {});
      await ticket().getByRole("button", { name: lang === "uk" ? "Скасувати" : "Cancel" }).click().catch(() => {});
    }
    // The limit, by market cap.
    const limit = ticket().getByRole("tab", { name: lang === "uk" ? "Ліміт" : "Limit" });
    if (await limit.count()) {
      await limit.click();
      await page.waitForTimeout(2000);
      const cap = ticket().getByRole("button", { name: lang === "uk" ? "Ліміт за капіталізацією" : "Set the limit by market cap" });
      if (await cap.count()) {
        await cap.click();
        await page.waitForTimeout(500);
        await ticket().locator("input").nth(1).fill("1500000000");
      }
      await shot("coin-limit-cap");
      await measure("coin-limit-cap");
    }
    report.push(`errors-${tag}: ${errors.join(" | ") || "none"}`);
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
