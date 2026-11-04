// The Dollar Saver's screens for review (CITY-192), desk 1440×900 and phone 390×844, English and Ukrainian:
//   NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_EARN_DOLLAR=open npm run build && npm start, then
//   node city/lib/earn/dollar-shots.mjs <out> [baseUrl] [before|after]
// «before» stops at the screens a build without the Saver's switch has (the Shelf and the calm card). No wallet and no
// keys are needed: a stub wallet registers through the Wallet Standard events and hands back the bytes it is given;
// the engine's routes answer from fixtures shaped like `/api/solana/earn` (rates as Jupiter Lend stated them 3.11:
// USDC 5.30 %, SOL 3.75 %). The figures on these screens are fixtures; the live pass with a real wallet is the owner's.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "out/dollar-shots");
const base = process.argv[3] ?? "http://localhost:3000";
const phase = process.argv[4] ?? "after";
mkdirSync(out, { recursive: true });

const snapshot = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const solPrice = snapshot.towers.find((t) => t.id === SOL)?.price ?? 180;

const market = (mint, symbol, decimals, rate, price, minimumRaw) => ({
  provider: "jupiter",
  id: mint,
  asset: { mint, symbol, decimals },
  share: { mint: mint === USDC ? "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D" : "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", symbol: `jl${symbol}`, decimals },
  // «before»: what ryntra.io serves today — Jupiter's bps read as per cent, past the ceiling, so no rate (#1483).
  rateAnnualPercent: phase === "before" ? null : rate,
  suppliedRaw: "512000000000000",
  liquidRaw: "40000000000000",
  minimumRaw,
  priceUsd: price,
  readAt: new Date().toISOString(),
});

const surface = (held) => ({
  providers: [
    { provider: "jupiter", ok: true, markets: [market(USDC, "USDC", 6, 5.3, 1, "1000000"), market(SOL, "WSOL", 9, 3.75, solPrice, String(Math.ceil(1e9 / solPrice)))] },
    { provider: "kamino", ok: false, code: "DISABLED", reason: "off" },
  ],
  positions: held
    ? [{ provider: "jupiter", marketId: USDC, asset: { mint: USDC, symbol: "USDC", decimals: 6 }, sharesRaw: "245000000", underlyingRaw: "252480000", depositedRaw: "250000000", earnedRaw: "2480000", availableRaw: "252480000", readAt: new Date().toISOString(), readFrom: "rpc" }]
    : [],
  actions: { open: true, mode: "OPEN", maxUsd: null },
  feeBps: 0,
  readAt: new Date().toISOString(),
});

const FEED = {
  at: new Date().toISOString(),
  epochsPerYear: 182.4,
  lsts: [
    { id: "jupsol", rate: { lamports: "1104300000", supply: "1000000000" }, apyPct: 7.18, rewardsFeePct: 0, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
    { id: "inf", rate: { lamports: "1312200000", supply: "1000000000" }, apyPct: 7.42, rewardsFeePct: null, unstakeFeePct: null, source: "sanctum", epoch: null },
    { id: "jitosol", rate: { lamports: "1260300000", supply: "1000000000" }, apyPct: 6.31, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 871 },
  ],
};

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solPrice) } },
  { kind: "TOKEN", mint: USDC, amountRaw: "248120000", spendableRaw: "248120000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1" } },
];

const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const LANGS = (process.env.LANGS ?? "en,uk").split(",");

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });

for (const lang of LANGS) {
  for (const size of SIZES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: lang === "uk" ? "uk-UA" : "en-US",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    let n = 0;
    const shot = async (state) => {
      n += 1;
      await page.screenshot({ path: path.join(out, `${String(n).padStart(2, "0")}-${state}-${size.name}-${lang}.jpg`), type: "jpeg", quality: 82 });
    };

    await page.addInitScript(({ owner, lang }) => {
      Object.defineProperty(navigator, "languages", { get: () => (lang === "uk" ? ["uk-UA", "uk", "en"] : ["en-US", "en"]) });
      try {
        window.localStorage.setItem("ryntra.city.intro.v1", "seen");
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
          // The stand's wallet hands back the bytes it was given, after a beat; the relay is a fixture too.
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (input) => (await new Promise((r) => setTimeout(r, window.__holdSign ? 1e9 : 300)), [{ signedTransaction: input.transaction }]) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { owner: OWNER, lang });

    let held = false;
    const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const LETTERS = { [SOL]: ["S", "#9945FF"], [USDC]: ["$", "#2775CA"] };
    await page.route("**/api/icon/*", (route) => {
      const [glyph, fill] = LETTERS[route.request().url().split("/").pop()] ?? ["·", "#23222D"];
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${fill}"/><text x="20" y="27" font-size="19" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${glyph}</text></svg>` });
    });
    await page.route("**/api/city/earn", (route) => json(route, 200, FEED));
    await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: [], at: new Date().toISOString() }));
    await page.route("**/api/city/earn/captain", (route) => json(route, 200, { strategies: [], at: new Date().toISOString() }));
    await page.route("**/api/city/earn/stocks?*", (route) => json(route, 200, { stocks: [], at: new Date().toISOString() }));
    await page.route(/\/api\/solana\/earn(\?.*)?$/, (route) => json(route, 200, surface(held)));
    await page.route("**/api/solana/earn/review", async (route) => {
      const body = route.request().postDataJSON();
      await new Promise((r) => setTimeout(r, 500));
      json(route, 200, { provider: "jupiter", action: body.action, marketId: body.market, amountRaw: body.amount, askedRaw: body.amount, partial: false, ticket: "stand.ticket", transaction: { wireBase64: Buffer.from(new Uint8Array(160)).toString("base64"), messageSha256: "0".repeat(64) }, signableMs: 40_000 });
    });
    await page.route("**/api/solana/earn/submit", async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      held = true;
      json(route, 200, { provider: "jupiter", action: "deposit", signature: "5DoLLaRSaverStandSignature1111111111111111111111111111111111111111111111111111111", state: "LANDED", reason: null, amountRaw: "50000000", asset: { mint: USDC, symbol: "USDC", decimals: 6 }, rateAnnualPercent: 5.3, rateDriftBps: 0, feeBps: 0, sentAt: new Date().toISOString() });
    });
    await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: {}, at: Date.now() }));
    await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
    await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));

    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.locator('[data-deck-place="earn"]').first().waitFor({ timeout: 180_000 });
    await page.waitForTimeout(7000);

    const openEarn = async () => {
      await page.locator('[data-deck-place="earn"]').first().click();
      await page.getByRole("tab").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
    };
    const card = async () => {
      await page.locator('[data-earn-product="dollar"] button').last().click();
      await page.waitForTimeout(1800);
    };
    const closeAll = async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    };

    // A guest: the Shelf with the Saver's live rate, and its card.
    await openEarn();
    await page.locator('[data-earn-product="dollar"]').scrollIntoViewIfNeeded();
    await shot("shelf");
    await card();
    await shot("card-guest");

    if (phase === "after") {
      // Connect, as anyone would.
      await page.getByRole("button", { name: "Phantom" }).first().click();
      await page.waitForTimeout(3000);
      await shot("card-deposit");
      await page.locator('[aria-expanded="false"][aria-label]').filter({ hasText: "i" }).last().click();
      await page.waitForTimeout(700);
      await shot("card-details");
      await page.locator('[aria-expanded="true"][aria-label]').filter({ hasText: "i" }).last().click();
      await page.locator("#earn-dollar-amount").fill("50");
      await page.waitForTimeout(400);
      await page.locator("section button").filter({ hasText: lang === "uk" ? "Покласти" : "Put in" }).last().click();
      await page.waitForTimeout(400);
      await shot("card-signing");
      await page.waitForTimeout(3500);
      await shot("card-done");

      // The position: the card with «In the Saver» and «Take back», and «Mine».
      await page.locator("section button").filter({ hasText: lang === "uk" ? "Ще раз" : "Again" }).last().click();
      await page.waitForTimeout(2500);
      await page.locator('[role="radio"]').filter({ hasText: lang === "uk" ? "Забрати" : "Take back" }).click();
      await page.waitForTimeout(800);
      await shot("card-withdraw");
      await page.getByRole("tab").last().click();
      await page.waitForTimeout(1800);
      await shot("mine");
      await closeAll();
      await closeAll();

      // One sentence in ⌘K opens the card with the amount.
      // Ctrl K opens the line; on a phone its field waits for a tap.
      await page.keyboard.press("Control+K");
      await page.waitForTimeout(1200);
      if (size.mobile) await page.locator("input:visible").last().tap();
      await page.keyboard.type(lang === "uk" ? "поклади 50 USDC під відсоток" : "put 50 USDC to work", { delay: 20 });
      await page.waitForTimeout(1200);
      await shot("command");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
      await shot("command-opened");
    }

    if (errors.length) console.log(lang, size.name, "errors:", errors.slice(0, 5));
    await context.close();
  }
}

await browser.close();
console.log("shots in", out);
