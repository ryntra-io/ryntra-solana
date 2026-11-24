// «Your agent looks after it» on a pool's ticket, for the eyes, at 1440×900 and 390×844, in English and Ukrainian →
// <out>/<state>-<size>-<lang>.jpg
//   node terminal/earn/care-shots.mjs [out] [baseUrl]
// A stand with the terminal's switch on its stand, Earn and the pools open and the agent's care open
// (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open
// NEXT_PUBLIC_RYNTRA_AGENT_CARE=mainnet`). Every read answers from fixtures shaped like the engine's routes — the
// recorded SOL–USDC pool and a staked-SOL pool — for a stand wallet that connects silently and never signs: the shots
// stop at the wallet's own prompt, and the script reports what it was asked to sign.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SOL, SOL_USDC, USDC, lstPool } from "../../city/lib/earn/pier-fixtures.mjs";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-294");
const base = process.argv[3] ?? "http://localhost:3294";
mkdirSync(out, { recursive: true });

/* PRESS_CHROME — a browser of its own when the project's Playwright has none installed (`/opt/pw-browsers/chromium`). */
const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const POOLS = [SOL_USDC, lstPool()];
const SOL_USD = SOL_USDC.x.priceUsd;
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const report = [];

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "42400000000", spendableRaw: "42390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(SOL_USD) } },
  { kind: "SPL", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", usdPrice: "1" } },
];
/** A care at work on the SOL–USDC pool, as the engine's status answers it. */
const CARE = { key: "c:mainnet:stand:1", pool: SOL_USDC.address, status: "working", inRange: true, day: { claimedInY: 0.0042, reinvestedInY: 0.0011, rebalances: 1 }, valueUsd: 1890, unclaimedUsd: 0.4 };

const WIRE = Buffer.from(new Uint8Array(1 + 64 + 8).fill(7)).toString("base64");

/** An add of SOL alone, as the engine's Review answers it for the pool asked: half swapped, both coins in, one approval. */
function zapReview(body) {
  const pool = POOLS.find((entry) => entry.address === body.request.pool) ?? POOLS[0];
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

async function stage(size, lang, { cared = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(({ owner }) => {
    // The stand wallet: it connects silently (as a wallet this site was already granted) and never signs.
    localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    window.__asked = [];
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
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
            window.__asked.push({ transactions: inputs.length });
            return new Promise(() => {});
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { owner: OWNER });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const asked = [];
  // Every route not named below answers at once: a slow read never holds the browser's connections.
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/city" || pathname.startsWith("/api/icon/")) return route.fallback();
    return json(route, 503, { error: { code: "UNAVAILABLE" } });
  });
  await page.route("**/api/city/earn/piers", (route) => json(route, 200, { pools: POOLS, at: new Date().toISOString() }));
  await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
  await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
  await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
  await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await page.route("**/api/city/earn/piers/zap", (route) => json(route, 200, zapReview(route.request().postDataJSON())));
  await page.route("**/api/city/earn/care", (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (body.action === "status") return json(route, 200, { ok: true, cares: cared ? [CARE] : [] });
    if (body.action === "review") return json(route, 200, { ok: true, key: "c:mainnet:stand:2", transactions: ["AQ=="], goesIn: body.lamports, vault: "Vau1t11111111111111111111111111111111111111" });
    return json(route, 503, { ok: false });
  });
  await page.goto(`${base}/earn?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 120_000 });
  return { context, page, errors, asked };
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

/** The SOL–USDC pool's ticket: on a desk the side panel, on a phone its sheet. */
async function openPool(page, size) {
  if (size.mobile) {
    await page.waitForSelector("[data-terminal='tabs']", { timeout: 300_000 });
    const row = page.locator("main button:visible").filter({ hasText: /SOL.?USDC|SOL · USDC|·/ }).first();
    await row.waitFor({ timeout: 120_000 });
    await tap(size, row);
    await page.waitForSelector("[data-earn='sheet']", { timeout: 30_000 });
    return page.locator("[data-earn='sheet']");
  }
  // On a desk the ticket stands open on the first pool (the SOL–USDC one, the deepest fees): no tap, which would open
  // the pool's own page.
  await page.waitForSelector("[role='table']", { timeout: 300_000 });
  return page.locator("aside").filter({ has: page.getByRole("switch") });
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const T = lang === "uk" ? { care: "Твій агент доглядає", how: "Як агент доглядає", give: "Віддати агентові" } : { care: "Your agent looks after it", how: "How your agent looks after it", give: "Give to my agent" };
    // 1. The ticket as a person finds it: the switch off, the plain add — then on, the stop, the one line and its «i».
    {
      const { context, page, errors, asked } = await stage(size, lang);
      const shot = shotOf(page, size, lang);
      try {
        const where = await openPool(page, size);
        const sw = where.getByRole("switch", { name: T.care });
        await sw.waitFor({ timeout: 60_000 });
        await sw.scrollIntoViewIfNeeded();
        await shot("care-off");
        await tap(size, sw);
        await where.getByRole("button", { name: T.give }).waitFor({ timeout: 20_000 });
        await shot("care-on");
        await tap(size, where.getByRole("button", { name: T.how }));
        await shot("care-info");
        await tap(size, where.getByRole("button", { name: T.how }));
        await where.getByRole("button", { name: T.give }).click();
        await page.waitForFunction(() => window.__asked.length > 0, null, { timeout: 20_000 }).catch(() => {});
        await shot("care-wallet");
        const review = asked.find((body) => body.action === "review");
        report.push(`${size.name}/${lang}: review asked — ${review ? `pool ${review.pool === SOL_USDC.address ? "SOL-USDC" : review.pool}, ${Number(review.lamports) / 1e9} SOL, width ${review.width}, shape ${review.shape}, stop ${review.stopPct}` : "none"}; wallet asked ${JSON.stringify(await page.evaluate(() => window.__asked))}`);
      } catch (error) {
        await page.screenshot({ path: path.join(out, `fail-care-${size.name}-${lang}.jpg`), type: "jpeg", quality: 80 }).catch(() => {});
        report.push(`${size.name}/${lang}: FAILED — ${String(error).slice(0, 300)}`);
      }
      if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    }
    // 2. A care already at work on this pool: it stands on top with its own «Stop and take it back».
    {
      const { context, page, errors } = await stage(size, lang, { cared: true });
      const shot = shotOf(page, size, lang);
      try {
        const where = await openPool(page, size);
        await where.locator("[data-earn-cared]").first().waitFor({ timeout: 60_000 });
        await shot("care-working");
      } catch (error) {
        report.push(`${size.name}/${lang} working: FAILED — ${String(error).slice(0, 300)}`);
      }
      if (errors.length) report.push(`${size.name}/${lang} working: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    }
  }
}
await browser.close();
console.log(report.join("\n"));
