// Choosing a pool on Earn, for the eyes: 1440×900, 1920×1080 and 390×844, English and Ukrainian, the plain
// look and «Pro» → <out>/<state>-<size>-<lang>.jpg
//   node terminal/earn/shots-279.mjs [out] [baseUrl] [live]
// The chooser's own read (`/api/v1/earn/pools`) answers from the stand itself — Meteora and Jupiter Lend, live.
// A stand built with the terminal's switch on its stand and Earn's own switches open (the pools, the add, lending, the
// Pro pools), then `next start`. The system Chrome draws the page (PRESS_CHROME may point at another).
//
// The figures: the reads every visitor gets — the pools, the staking rates, the lending rates — come from the live
// engine (`live`, ryntra.io by default), so the table is today's. What only a wallet has — its positions, its coins, the
// exact figures of an action — answers from fixtures shaped like the engine's routes, for a stand wallet that connects
// silently and never signs: the shots stop at the wallet's own prompt, and the script reports what it was asked to sign.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-279");
const base = process.argv[3] ?? "http://localhost:3179";
const live = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPSOL = "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";
const POSITION = "8xPos1tionAddr3ssxxxxxxxxxxxxxxxxxxxxxxxxx1";
const PRO_POOL = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const NFT = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
const WIRE = Buffer.from(new Uint8Array(1 + 64 + 8).fill(7)).toString("base64");

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];

/** The live pools, read once: the fixtures of an action stand on the very pool the screen shows. */
let livePools = [];
let solUsd = 0;

/** The wallet's own things, as fixtures. */
function position(price) {
  return {
    kind: "dlmm",
    address: POSITION,
    pool: livePools.find((pool) => pool.pair === "SOL-USDC")?.address ?? "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
    name: "SOL-USDC",
    x: { mint: SOL, symbol: "SOL", amount: 3.55, unclaimed: 0.052, priceUsd: price },
    y: { mint: USDC, symbol: "USDC", amount: 253, unclaimed: 2.5, priceUsd: 1 },
    rangeState: "in_range",
    lower: price * 0.94,
    upper: price * 1.06,
    price,
    valueUsd: 3.55 * price + 253,
    unclaimedUsd: 0.052 * price + 2.5,
    lockedBps: 0,
    feesElsewhere: false,
    hasRewards: false,
    slot: 1,
    at: Date.now(),
    pricesAt: null,
  };
}
const HOLDINGS = (empty) => [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solUsd) } },
  { kind: "SPL", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", usdPrice: "1" } },
  ...(empty ? [] : [{ kind: "SPL", mint: JUPSOL, amountRaw: "500000000", spendableRaw: "500000000", decimals: 9, symbol: "JupSOL", catalog: { symbol: "JupSOL" } }]),
];
const PRO_PIER = (price) => ({ address: PRO_POOL, x: { mint: SOL, symbol: "SOL", decimals: 9 }, y: { mint: USDC, symbol: "USDC", decimals: 6 }, solIsX: true, price, feeBps: 25, tickSpacing: 10, tickId: -26_000, depthLamports: "8694000000000", rewards: [], takesDeposits: true });
const PRO_BOAT = (price) => ({ nftMint: NFT, pool: PRO_POOL, inRange: true, ranges: 7, lowerPrice: price * 0.98, upperPrice: price * 1.02, worth: { xRaw: "794444550", yRaw: String(Math.round(0.79 * price * 1e6)), lamports: "1560713428" }, fees: { xRaw: "1210000", yRaw: "184000", lamports: "3800000" }, rewards: [], empty: false, cared: false, care: null });

/** An add of SOL alone, as the engine's Review answers it for the pool asked: half swapped, both coins in, one approval. */
function zapReview(body) {
  const pool = livePools.find((entry) => entry.address === body.request.pool) ?? livePools[0];
  const amount = BigInt(body.request.amountIn);
  const half = amount / 2n;
  const solIsX = pool.x.mint === SOL;
  const other = solIsX ? pool.y : pool.x;
  const otherPerSol = solIsX ? pool.price : 1 / pool.price;
  const otherUnits = BigInt(Math.floor((Number(half) / 1e9) * otherPerSol * 10 ** other.decimals));
  const solSide = { asset: SOL, units: half.toString(), decimals: 9 };
  const otherSide = { asset: other.mint, units: otherUnits.toString(), decimals: other.decimals };
  const fee = (half * 10n) / 10_000n;
  return {
    preview: {
      action: "zap_in",
      venue: "meteora-dlmm",
      pool: pool.address,
      owner: body.request.owner,
      tokenX: { mint: pool.x.mint, decimals: pool.x.decimals, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      tokenY: { mint: pool.y.mint, decimals: pool.y.decimals, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      amountIn: amount.toString(),
      swap: { route: "jupiter", inMint: SOL, outMint: other.mint, inAmount: half.toString(), expectedOut: otherUnits.toString(), floor: ((otherUnits * 995n) / 1000n).toString(), fee: { bps: 10, amount: fee.toString(), mint: SOL, account: "FeeAcc1111111111111111111111111111111111111" }, labels: ["Meteora DLMM"] },
      deposit: solIsX ? { x: solSide, y: otherSide } : { x: otherSide, y: solSide },
      range: { kind: "bins", lowerBin: -16, upperBin: 16, lowerPrice: String(pool.price * 0.98), upperPrice: String(pool.price * 1.02) },
      otherBefore: "0",
      unwrapLamports: "0",
      fees: [{ who: "ryntra", applies_to: "swap", bps: 10 }],
      rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }],
      transactions: 2,
      notices: [],
      price: String(pool.price),
      at: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    transactions: [
      { wireBase64: WIRE, presigned: [] },
      { wireBase64: WIRE, presigned: [] },
    ],
    position: "PoSiTion1111111111111111111111111111111111",
    ticket: "ticket-zap",
    expiresAt: Date.now() + 60_000,
    signableMs: 60_000,
    networkFeeLamports: "15000",
    depositUsd: null,
    referenceOut: otherUnits.toString(),
  };
}

/** Taking a position's fees, or leaving it, as the engine's Review answers it. */
function poolReview(body) {
  const claim = body.action === "claim";
  const base = { venue: "meteora-dlmm", fees: [], transactions: 1, notices: [], price: String(solUsd), at: Date.now(), expiresAt: Date.now() + 60_000, request: {} };
  const preview = claim
    ? { ...base, action: "claim", position: POSITION, claimed: { x: { asset: SOL, units: "52000000", decimals: 9 }, y: { asset: USDC, units: "2500000", decimals: 6 } }, rent: [] }
    : {
        ...base,
        action: "remove",
        position: POSITION,
        closesPosition: true,
        expected: { x: { asset: SOL, units: "3550000000", decimals: 9 }, y: { asset: USDC, units: "253000000", decimals: 6 } },
        minimum: { x: { asset: SOL, units: "3514500000", decimals: 9 }, y: { asset: USDC, units: "250470000", decimals: 6 } },
        feesClaimed: { x: { asset: SOL, units: "52000000", decimals: 9 }, y: { asset: USDC, units: "2500000", decimals: 6 } },
        rent: [{ what: "position", direction: "return", lamports: "57000000", refundable: true }],
      };
  return { preview, transactions: [{ wireBase64: WIRE, presigned: [] }], position: POSITION, ticket: `ticket-${body.action}`, expiresAt: Date.now() + 60_000, signableMs: 60_000, networkFeeLamports: "10000", depositUsd: null };
}

/** A Pro Review: an opening, or one of a position's actions. */
function proReview(body) {
  const price = solUsd || 71;
  const summary =
    body.action === "open"
      ? { action: "open", goesIn: { xRaw: String(BigInt(body.lamports) / 2n), yRaw: String(Math.round((Number(body.lamports) / 2e9) * price * 1e6)), lamports: String((BigInt(body.lamports) * 985n) / 1000n) }, staysLamports: "4000000", bandBps: 20, lowerPrice: price * 0.98, upperPrice: price * 1.02, ranges: 1, swap: { lamports: String(BigInt(body.lamports) / 2n), feeBps: 25, referral: true }, networkLamports: 15_000, depositLamports: 24_200_000, position: PRO_POOL, nftMint: NFT }
      : body.action === "collect"
        ? { action: "collect", fees: { xRaw: "1210000", yRaw: "184000", lamports: "3800000" }, rewards: [], depositLamports: 0, networkLamports: 5_000 }
        : body.action === "compound"
          ? { action: "compound", collected: { xRaw: "1210000", yRaw: "184000", lamports: "3800000" }, bandBps: 20, networkLamports: 5_000 }
          : { action: "leave", expected: { xRaw: "794444550", yRaw: "56000000", lamports: "1560713428" }, minimum: { xRaw: "786500000", yRaw: "55400000", lamports: "1545000000" }, bandBps: 100, fees: { xRaw: "1210000", yRaw: "184000", lamports: "3800000" }, rewards: [], networkLamports: 15_000 };
  return { network: "mainnet", action: body.action, ticket: "t".repeat(64), transactions: [WIRE, WIRE].slice(0, body.action === "open" ? 2 : 1), expiresAt: new Date(Date.now() + 60_000).toISOString(), summary };
}

async function stage(size, lang, { wallet = false, empty = false, pro = false, look = "plain" } = {}) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.mobile ? 2 : 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    locale: lang === "uk" ? "uk-UA" : "en-US",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript((on) => localStorage.setItem("ryntra.terminal.pro.v1", on ? "1" : "0"), look === "pro");
  if (wallet) {
    await page.addInitScript(({ owner, empty, jupsol, position }) => {
      // The stand wallet: it connects silently (as a wallet this site was already granted) and never signs.
      localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
      if (!empty) {
        localStorage.setItem(`ryntra.pools.entries.v1:${owner}`, JSON.stringify({ [position]: { x: 3.5, y: 250, usd: 500, claimedUsd: 0, at: Date.now() - 86_400_000, source: "ryntra" } }));
        localStorage.setItem(`ryntra.city.earn.saver.v1:${owner}`, JSON.stringify([{ mint: jupsol, lstRaw: "500000000", lamports: "600000000", at: Date.now() - 30 * 86_400_000, signature: "stand" }]));
      }
      window.__asked = [];
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
      const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction"], label: "Phantom" };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet", "solana:devnet"],
        accounts: [account],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: (...inputs) => {
              window.__asked.push({ transactions: inputs.length, bytes: inputs.map((input) => input.transaction.length) });
              return new Promise(() => {});
            },
          },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { owner: OWNER, empty, jupsol: JUPSOL, position: POSITION });
  }

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const passLive = async (route, edit) => {
    const url = new URL(route.request().url());
    try {
      const request = route.request();
      const headers = { accept: "application/json", ...(request.method() === "POST" ? { "content-type": "application/json" } : {}) };
      const answer = await route.fetch({ url: `${live}${url.pathname}${url.search}`, headers });
      const text = await answer.text();
      if (!edit || !answer.ok()) return route.fulfill({ status: answer.status(), contentType: "application/json", body: text });
      return json(route, 200, edit(JSON.parse(text)));
    } catch {
      return json(route, 503, { error: { code: "UNAVAILABLE" } });
    }
  };
  // Every route not named below answers at once: a slow read never holds the browser's connections. Registered first,
  // so every route below wins over it.
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/city" || pathname.startsWith("/api/icon/") || pathname === "/api/v1/earn/pools") return route.fallback();
    return json(route, 503, { error: { code: "UNAVAILABLE" } });
  });
  // The coins' logos and the reads every visitor gets: the live engine's.
  await page.route("**/api/icon/*", async (route) => {
    const url = new URL(route.request().url());
    try {
      const answer = await route.fetch({ url: `${live}${url.pathname}` });
      return route.fulfill({ response: answer });
    } catch {
      return route.fallback();
    }
  });
  await page.route("**/api/city/earn", (route) => passLive(route));
  await page.route("**/api/city/earn/piers", (route) =>
    passLive(route, (body) => {
      livePools = body.pools ?? [];
      solUsd = livePools.find((pool) => pool.x.mint === SOL)?.x.priceUsd ?? solUsd;
      return body;
    }),
  );
  await page.route("**/api/solana/earn**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/solana/earn") return route.fallback();
    return passLive(route, (body) =>
      wallet && !empty && url.searchParams.get("owner")
        ? { ...body, positions: [{ provider: "jupiter", asset: { mint: USDC, symbol: "USDC", decimals: 6 }, sharesRaw: "99400000", underlyingRaw: "101100000", earnedRaw: "1100000", availableRaw: "101100000" }] }
        : body,
    );
  });
  await page.route("**/api/solana/swap/quote**", (route) => passLive(route));
  if (pro) {
    await page.route("**/api/v1/earn/pro/piers", (route) => json(route, 200, { network: "mainnet", piers: [PRO_PIER(solUsd || 71)], at: new Date().toISOString(), care: false }));
    await page.route("**/api/v1/earn/pro/positions?*", (route) => json(route, 200, { network: "mainnet", owner: OWNER, positions: wallet ? [PRO_BOAT(solUsd || 71)] : [], care: false }));
    await page.route("**/api/v1/earn/pro/review", (route) => json(route, 200, proReview(route.request().postDataJSON())));
  } else {
    // The Pro pools are closed on the live engine: the screen must show none of them.
    await page.route("**/api/v1/earn/pro/piers", (route) => passLive(route));
  }
  // What only a wallet has.
  if (wallet) {
    await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS(empty) } }));
    await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: empty ? [] : [position(solUsd || 71)], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
    await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
    await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await page.route("**/api/city/earn/piers/zap", (route) => json(route, 200, zapReview(route.request().postDataJSON())));
    await page.route("**/api/city/earn/piers/review", (route) => json(route, 200, poolReview(route.request().postDataJSON())));
  }
  await page.goto(`${base}/earn?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
  return { context, page, errors };
}

const settle = async (page) => {
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(900);
};
const shotOf = (page, size, lang) => async (state) => {
  await settle(page);
  await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
};
const tap = (size, locator) => (size.mobile ? locator.tap() : locator.click());
const ticket = (page) => page.locator("aside section").first();
const asked = (page) => page.evaluate(() => window.__asked);
/**
 * Presses the screen's one action and waits for the wallet's own prompt. Figures that aged while the shots were taken
 * are built afresh by the screen first (it says so); then the same press opens the wallet. On a miss: a shot of what
 * stood there and its words, then the miss itself.
 */
async function toWallet(page, where, button, text, name) {
  for (let tries = 0; tries < 3; tries += 1) {
    await button.click();
    const there = await where.getByText(text).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    if (there) return;
  }
  await page.screenshot({ path: path.join(out, `fail-${name}.jpg`), type: "jpeg", quality: 80 }).catch(() => {});
  console.log(`fail ${name}: ${(await where.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600)} · asked ${JSON.stringify(await asked(page))}`);
  throw new Error(`${name}: the wallet was not reached`);
}

const rowsIn = (page) => page.locator("main [role='table']:visible").first().locator("[role='row']");

for (const size of SIZES) {
  for (const lang of LANGS) {
    const T = lang === "uk"
      ? { add: "Додати", view: "Огляд", addToPool: "Додати в пул", wallet: "Підпиши в гаманці", staking: "Стейкінг", lending: "Позика", mine: size.mobile ? "Позиції" : "Мої позиції", type: "Тип", high: "Високий дохід" }
      : { add: "Add", view: "View", addToPool: "Add to pool", wallet: "Confirm in wallet", staking: "Staking", lending: "Lending", mine: size.mobile ? "Positions" : "My positions", type: "Type", high: "High income" };
    const tabNamed = (page, name) => page.locator("[role='tab']:visible").filter({ hasText: new RegExp(`^${name}(\\s|\\d|$)`) }).first();

    for (const look of size.mobile ? ["plain"] : ["plain", "pro"]) {
      // 1. A guest: the pools to choose from, the strategies (plain) or the rates (Pro), the ticket on the first offer.
      const { context, page, errors } = await stage(size, lang, { look });
      const shot = shotOf(page, size, lang);
      if (size.mobile) {
        await page.locator("main button:visible").filter({ hasText: / · / }).first().waitFor({ timeout: 120_000 });
        await shot(`pools-${look}`);
        // A pool shown to compare opens its own card as a sheet.
        await tap(size, page.locator("main button:visible").filter({ hasText: / · / }).nth(3));
        await page.waitForSelector("[data-earn='sheet']", { timeout: 20_000 });
        await shot(`sheet-${look}`);
        await page.keyboard.press("Escape");
        await tap(size, tabNamed(page, T.staking));
        await page.waitForTimeout(700);
        await shot(`staking-${look}`);
        await tap(size, tabNamed(page, T.lending));
        await page.waitForTimeout(700);
        await shot(`lending-${look}`);
      } else {
        await page.waitForSelector("main [role='table']", { timeout: 120_000 });
        await rowsIn(page).nth(2).waitFor({ timeout: 60_000 });
        await shot(`pools-${look}`);
        const rows = await rowsIn(page).count();
        const text = await page.locator("main [role='table']:visible").first().innerText();
        report.push(`${size.name}/${lang}/${look}: rows ${rows - 1}, DLMM ${/DLMM(?! Pro)/.test(text)}, DAMM v2 ${/DAMM v2/.test(text)}, «${T.view}» ${(text.match(new RegExp(T.view, "g")) ?? []).length}`);
        if (size.name === "desk") {
          // A row to compare: its own card in the ticket.
          const view = page.locator("main [role='table']:visible").first().getByRole("button", { name: T.view, exact: true }).first();
          if (await view.count()) {
            await view.click();
            await page.waitForTimeout(500);
            await shot(`view-${look}`);
          }
          // A filter opened: the type's choices under its chip.
          await page.locator("button[aria-expanded]:visible").filter({ hasText: new RegExp(`^${T.type}`) }).first().click();
          await page.waitForTimeout(300);
          await shot(`filter-${look}`);
          await page.keyboard.press("Escape");
          if (look === "plain") {
            await page.locator("button[aria-pressed]:visible").filter({ hasText: T.high }).first().click();
            await page.waitForTimeout(600);
            await shot("strategy-high");
          }
          await tabNamed(page, T.staking).click();
          await page.waitForTimeout(600);
          await shot(`staking-${look}`);
          await tabNamed(page, T.lending).click();
          await page.waitForTimeout(600);
          await shot(`lending-${look}`);
        }
      }
      if (errors.length) report.push(`${size.name}/${lang}/${look} guest: page errors — ${errors.join(" | ").slice(0, 500)}`);
      await context.close();
    }

    // 2. A wallet: «Add to pool» on the city's SOL · USDC pool reaches the wallet's own prompt, with the Review's bytes.
    if (size.name !== "wide") {
      const { context, page, errors } = await stage(size, lang, { wallet: true });
      const shot = shotOf(page, size, lang);
      if (size.mobile) {
        await page.locator("main button:visible").filter({ hasText: /^SOL · USDC$/ }).first().waitFor({ timeout: 120_000 });
        await tap(size, page.locator("main button:visible").filter({ hasText: /^SOL · USDC$/ }).first());
        await page.waitForSelector("[data-earn='sheet']", { timeout: 20_000 });
      } else {
        await page.waitForSelector("main [role='table']", { timeout: 120_000 });
        const row = rowsIn(page).filter({ hasText: "SOL · USDC" }).filter({ has: page.getByRole("button", { name: T.add, exact: true }) }).first();
        await row.getByRole("button", { name: T.add, exact: true }).click();
      }
      const where = size.mobile ? page.locator("[data-earn='sheet']") : ticket(page);
      await where.getByRole("button", { name: T.addToPool }).waitFor({ timeout: 60_000 });
      await shot("add");
      await toWallet(page, where, where.getByRole("button", { name: T.addToPool }), T.wallet, `add-${size.name}-${lang}`);
      await shot("add-wallet");
      const wire = Buffer.from(WIRE, "base64").length;
      const got = await asked(page);
      report.push(`${size.name}/${lang}: «Add to pool» reached the wallet — asked ${JSON.stringify(got)}; the Review's bytes ${wire} each — ${got.length && got.every((entry) => entry.bytes.every((n) => n === wire)) ? "same" : "DIFFERENT"}`);
      if (!size.mobile) {
        await tabNamed(page, T.mine).click();
        await page.waitForTimeout(800);
        await shot("mine");
      }
      if (errors.length) report.push(`${size.name}/${lang} wallet: page errors — ${errors.join(" | ").slice(0, 500)}`);
      await context.close();
    }
  }
}

await browser.close();
console.log(report.join("\n"));
