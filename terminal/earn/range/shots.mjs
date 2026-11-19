// The range on the Earn ticket, for the eyes: 1440×900, 1920×1080 and 390×844, English and Ukrainian
//   → <out>/<state>-<size>-<lang>.jpg
//   node terminal/earn/range/shots.mjs [out] [baseUrl] [live]
// A stand built with the terminal's switch on its stand and Earn's own switches open, then `next start`. The system
// Chrome draws the page (PRESS_CHROME may point at another).
//
// The figures: the pools and the pool's bins are today's — the pools from the live engine (`live`, ryntra.io by
// default), the bins from the stand's own read of the chain (`/api/v1/earn/pools/bins`). What only a wallet has — its
// coins, the exact figures of an add — answers from fixtures shaped like the engine's routes, for a stand wallet that
// connects silently and never signs: the shots stop at the wallet's own prompt, and the script reports what the engine
// was asked to build (the width in bins) and what the wallet was asked to sign.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-263");
const base = process.argv[3] ?? "http://localhost:3163";
const live = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PRO_POOL = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const WIRE = Buffer.from(new Uint8Array(1 + 64 + 8).fill(7)).toString("base64");

const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
  // The widest desk the operator looks on: only when named.
  { name: "xl", width: 2560, height: 1440, mobile: false, named: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL.filter((size) => !size.named);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
/** Which stages run: guest, wallet, gap, pro; all when not named. */
const STAGES = process.env.STAGES ? new Set(process.env.STAGES.split(",")) : null;
const want = (name) => !STAGES || STAGES.has(name);
const report = [];

let livePools = [];
let solUsd = 0;
/** Every add the engine was asked to build, as the screen sent it. */
const zapsAsked = [];

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "12400000000", spendableRaw: "12390000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solUsd) } },
  { kind: "SPL", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", usdPrice: "1" } },
];

/** An add of SOL alone, as the engine's Review answers it for the pool and the width asked: half swapped, both coins in, one approval. */
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
  const step = 1 + pool.binStepBps / 10_000;
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
      range: { kind: "bins", lowerBin: -body.request.half, upperBin: body.request.half, lowerPrice: String(pool.price * step ** -body.request.half), upperPrice: String(pool.price * step ** body.request.half) },
      otherBefore: "0",
      unwrapLamports: "0",
      fees: [{ who: "ryntra", applies_to: "swap", bps: 10 }],
      // The live pool's ledgers of bins are all open (read on the stand): only the position's own account, which comes back.
      rent: [{ what: "position", direction: "pay", lamports: "41899840", refundable: true }],
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

const PRO_PIER = (price) => ({ address: PRO_POOL, x: { mint: SOL, symbol: "SOL", decimals: 9 }, y: { mint: USDC, symbol: "USDC", decimals: 6 }, solIsX: true, price, feeBps: 25, tickSpacing: 10, tickId: -26_000, depthLamports: "8694000000000", rewards: [], takesDeposits: true });

/** A DLMM Pro pool's steps around the price, shaped like the engine's read: a hill of liquidity, Y under the price, X over it. */
function proBins(price) {
  const ratio = 1.0001 ** 10;
  const bins = [];
  for (let offset = -40; offset <= 40; offset += 1) {
    const hill = Math.round(4_000 * Math.exp(-(offset * offset) / 400)) + 300;
    bins.push({ offset, id: -26_000 + offset * 10, price: price * ratio ** offset, x: offset >= 0 ? String(BigInt(hill) * 10_000_000n) : "0", y: offset <= 0 ? String(BigInt(Math.round(hill * price)) * 10_000n) : "0" });
  }
  return { venue: "pro", pool: PRO_POOL, x: { mint: SOL, decimals: 9 }, y: { mint: USDC, decimals: 6 }, stepBps: (ratio - 1) * 10_000, activeId: -26_000, price, bins, market: { price, gapPct: 0 }, rent: null, at: new Date().toISOString() };
}

function proReview(body) {
  const price = solUsd || 150;
  const ratio = 1.0001 ** 10;
  const steps = { calm: 34, balanced: 16, dense: 5 }[body.style] ?? 16;
  const summary = { action: "open", goesIn: { xRaw: String(BigInt(body.lamports) / 2n), yRaw: String(Math.round((Number(body.lamports) / 2e9) * price * 1e6)), lamports: String((BigInt(body.lamports) * 985n) / 1000n) }, staysLamports: "4000000", bandBps: 20, lowerPrice: price * ratio ** -steps, upperPrice: price * ratio ** (steps + 1), ranges: body.goal === "even" ? 1 : 7, swap: { lamports: String(BigInt(body.lamports) / 2n), feeBps: 25, referral: true }, networkLamports: 15_000, depositLamports: 9_500_000, position: "PoSiTion1111111111111111111111111111111111", nftMint: "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss" };
  return { network: "mainnet", action: "open", ticket: "t".repeat(64), transactions: [WIRE, WIRE], expiresAt: new Date(Date.now() + 60_000).toISOString(), summary };
}

async function stage(size, lang, { wallet = false, pro = false, gap = null } = {}) {
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
  if (wallet) {
    await page.addInitScript(({ owner }) => {
      // The stand wallet: it connects silently (as a wallet this site was already granted) and never signs.
      localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
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
    }, { owner: OWNER });
  }

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const passLive = async (route, edit) => {
    const url = new URL(route.request().url());
    try {
      const answer = await route.fetch({ url: `${live}${url.pathname}${url.search}`, headers: { accept: "application/json" } });
      const text = await answer.text();
      if (!edit || !answer.ok()) return route.fulfill({ status: answer.status(), contentType: "application/json", body: text });
      return json(route, 200, edit(JSON.parse(text)));
    } catch {
      return json(route, 503, { error: { code: "UNAVAILABLE" } });
    }
  };
  // Every route not named below answers at once; the stand's own reads of the pools and of a pool's bins go through.
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/city" || pathname.startsWith("/api/icon/") || pathname === "/api/v1/earn/pools" || pathname === "/api/v1/earn/pools/bins") return route.fallback();
    return json(route, 503, { error: { code: "UNAVAILABLE" } });
  });
  await page.route("**/api/icon/*", async (route) => {
    const url = new URL(route.request().url());
    try {
      return route.fulfill({ response: await route.fetch({ url: `${live}${url.pathname}` }) });
    } catch {
      return route.fallback();
    }
  });
  if (gap !== null) {
    // The same bins, the market moved away: the line before the signature is drawn on today's pool.
    await page.route("**/api/v1/earn/pools/bins?*", async (route) => {
      const answer = await route.fetch();
      if (!answer.ok()) return route.fulfill({ response: answer });
      const body = await answer.json();
      return json(route, 200, { ...body, market: { price: body.price / (1 + gap / 100), gapPct: gap } });
    });
  }
  await page.route("**/api/city/earn", (route) => passLive(route));
  await page.route("**/api/city/earn/piers", (route) =>
    passLive(route, (body) => {
      livePools = body.pools ?? [];
      solUsd = livePools.find((pool) => pool.x.mint === SOL)?.x.priceUsd ?? solUsd;
      return body;
    }),
  );
  await page.route("**/api/solana/earn**", (route) => (new URL(route.request().url()).pathname === "/api/solana/earn" ? passLive(route) : route.fallback()));
  // The pair's candles, for how far the price walked in the day gone (the ticket's figure for a day).
  await page.route("**/api/spot/candles**", (route) => passLive(route));
  if (pro) {
    await page.route("**/api/v1/earn/pro/piers", (route) => json(route, 200, { network: "mainnet", piers: [PRO_PIER(solUsd || 150)], at: new Date().toISOString(), care: false }));
    await page.route("**/api/v1/earn/pro/positions?*", (route) => json(route, 200, { network: "mainnet", owner: OWNER, positions: [], care: false }));
    await page.route("**/api/v1/earn/pro/review", (route) => json(route, 200, proReview(route.request().postDataJSON())));
    await page.route("**/api/v1/earn/pro/bins?*", (route) => json(route, 200, proBins(solUsd || 150)));
  } else {
    await page.route("**/api/v1/earn/pro/piers", (route) => passLive(route));
  }
  if (wallet) {
    await page.route("**/api/solana/holdings", (route) => json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
    await page.route("**/api/liquidity/positions?*", (route) => json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() }));
    await page.route("**/api/city/earn/piers/admit?*", (route) => json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false }));
    await page.route("**/api/auth/solana/session", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await page.route("**/api/city/earn/piers/zap", (route) => {
      const body = route.request().postDataJSON();
      zapsAsked.push(body);
      return json(route, 200, zapReview(body));
    });
  }
  await page.goto(`${base}/earn?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
  return { context, page, errors };
}

const settle = async (page) => {
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(900);
};
const tap = (size, locator) => (size.mobile ? locator.tap() : locator.click());
const asked = (page) => page.evaluate(() => window.__asked);
const rowsIn = (page) => page.locator("main [role='table']:visible").first().locator("[role='row']");

/** Opens the add ticket of the first pool named so that takes a deposit; the ticket, or its sheet on a phone. */
async function openAdd(page, size, name, add) {
  if (size.mobile) {
    const row = page.locator("main button:visible").filter({ hasText: new RegExp(`^${name}$`) }).first();
    await row.waitFor({ timeout: 120_000 });
    await tap(size, row);
    await page.waitForSelector("[data-earn='sheet']", { timeout: 20_000 });
    return page.locator("[data-earn='sheet']");
  }
  await page.waitForSelector("main [role='table']", { timeout: 120_000 });
  const row = rowsIn(page).filter({ hasText: name }).filter({ has: page.getByRole("button", { name: add, exact: true }) }).first();
  await row.getByRole("button", { name: add, exact: true }).click();
  return page.locator("aside section").first();
}

/** The type filter set to DLMM Pro: the Pro pools stand alone in the list, never past «N more». */
async function onlyPro(page, size, type) {
  const chip = page.locator("button[aria-expanded]:visible").filter({ hasText: new RegExp(`^${type}`) }).first();
  await tap(size, chip);
  const option = page.locator("[role='option']:visible, [role='menuitemradio']:visible, button:visible").filter({ hasText: /^DLMM Pro$/ }).first();
  await option.waitFor({ timeout: 10_000 });
  await tap(size, option);
  await page.waitForTimeout(600);
}

/** The corners the range's own parts draw with: only straight, the kit's own, or a circle may stand. */
async function corners(page) {
  return page.evaluate(() => {
    const seen = new Set();
    for (const node of document.querySelectorAll("[data-earn-range='editor'], [data-earn-range='editor'] *")) {
      for (const pseudo of [null, "::after"]) {
        const radius = getComputedStyle(node, pseudo).borderTopLeftRadius;
        if (radius && radius !== "0px") seen.add(radius);
      }
    }
    return [...seen];
  });
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const T = lang === "uk" ? { add: "Додати", addToPool: "Додати в пул", wallet: "Підпиши в гаманці", tune: "Налаштувати", type: "Тип" } : { add: "Add", addToPool: "Add to pool", wallet: "Confirm in wallet", tune: "Tune", type: "Type" };
    const shot = (page) => async (state) => {
      await settle(page);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 88, type: "jpeg" });
      // The whole ticket as well, its action included: with «Tune» open it is taller than a desk's screen.
      const card = size.mobile ? page.locator("[data-earn='sheet']") : page.locator("aside section").first();
      if (await card.count()) await card.screenshot({ path: path.join(out, `${state}-ticket-${size.name}-${lang}.jpg`), quality: 88, type: "jpeg" }).catch(() => {});
    };

    // 1. A guest: the ticket as it stands, then its range opened — the pool's bins, the two prices, the facts.
    if (want("guest")) {
      const { context, page, errors } = await stage(size, lang);
      const where = await openAdd(page, size, "SOL · USDC", T.add);
      await where.locator("[data-earn-range='line']").waitFor({ timeout: 60_000 });
      await shot(page)("guest");
      await tap(size, where.locator("[data-earn-range='tune']"));
      await where.locator("[data-earn-range='chart'] rect").first().waitFor({ timeout: 60_000 });
      await shot(page)("guest-tune");
      const line = await where.locator("[data-earn-range='line']").innerText();
      const facts = (await where.locator("[data-earn-range='facts']").innerText()).replace(/\s+/g, " ");
      report.push(`${size.name}/${lang} guest: «${line}» · ${facts.slice(0, 400)} · corners ${JSON.stringify(await corners(page))}`);
      if (errors.length) report.push(`${size.name}/${lang} guest: page errors — ${errors.join(" | ").slice(0, 500)}`);
      await context.close();
    }

    // 2. A wallet: a width by hand — an edge dragged, a quick per cent — and the add reaches the wallet's own prompt
    //    with the Review's bytes; the engine was asked for exactly the width on screen.
    if (want("wallet")) {
      zapsAsked.length = 0;
      const { context, page, errors } = await stage(size, lang, { wallet: true });
      const where = await openAdd(page, size, "SOL · USDC", T.add);
      await where.locator("[data-earn-range='line']").waitFor({ timeout: 60_000 }).catch(async (error) => {
        await page.screenshot({ path: path.join(out, `fail-wallet-${size.name}-${lang}.jpg`), type: "jpeg", quality: 80 }).catch(() => {});
        console.log(`fail wallet ${size.name}/${lang}: ${(await where.innerText().catch(() => "—")).replace(/\s+/g, " ").slice(0, 500)}`);
        throw error;
      });
      if ((await where.locator("[data-earn-range='editor']").count()) === 0) await tap(size, where.locator("[data-earn-range='tune']"));
      await where.locator("[data-earn-range='chart'] rect").first().waitFor({ timeout: 60_000 });
      await where.getByRole("button", { name: T.addToPool }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      await shot(page)("wallet-style");
      const styleAsked = zapsAsked.at(-1)?.request.half ?? null;

      // The upper edge, by the keyboard: three bins narrower.
      const high = where.locator("[data-earn-range='high']");
      await high.focus();
      for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(1_500);
      await shot(page)("wallet-hand");
      const handLine = await where.locator("[data-earn-range='line']").innerText();
      const handAsked = zapsAsked.at(-1)?.request.half ?? null;

      // The first quick width the pool's step reaches.
      const quick = where.locator("[data-earn-range='editor'] button[aria-pressed]:not([disabled])").first();
      await tap(size, quick);
      await page.waitForTimeout(1_500);
      await shot(page)("wallet-quick");
      const quickAsked = zapsAsked.at(-1)?.request.half ?? null;
      const quickLine = await where.locator("[data-earn-range='line']").innerText();

      const button = where.getByRole("button", { name: T.addToPool });
      let reached = false;
      for (let tries = 0; tries < 3 && !reached; tries += 1) {
        await button.click();
        reached = await where.getByText(T.wallet).waitFor({ timeout: 10_000 }).then(() => true, () => false);
      }
      await shot(page)("wallet-prompt");
      const wire = Buffer.from(WIRE, "base64").length;
      const got = await asked(page);
      const body = zapsAsked.at(-1);
      report.push(
        `${size.name}/${lang} wallet: the style asked ${styleAsked} bins a side; by hand ${handAsked} («${handLine}»); quick ${quickAsked} («${quickLine}»); ` +
          `the last request ${JSON.stringify(body?.request ? { ...body.request, owner: "…" } : null)}; reached the wallet ${reached} — asked ${JSON.stringify(got)}, the Review's bytes ${wire} each — ` +
          `${got.length && got.every((entry) => entry.bytes.every((n) => n === wire)) ? "same" : "DIFFERENT"}`,
      );
      if (errors.length) report.push(`${size.name}/${lang} wallet: page errors — ${errors.join(" | ").slice(0, 500)}`);
      await context.close();
    }

    // 3. The market moved away from the pool: one line before the action.
    if (size.name !== "wide" && want("gap")) {
      const { context, page } = await stage(size, lang, { gap: 1.84 });
      const where = await openAdd(page, size, "SOL · USDC", T.add);
      await where.locator("[data-earn-range='line']").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2_500);
      await shot(page)("gap");
      await context.close();
    }

    // 4. A DLMM Pro pool: the same range on the form's three widths, shown and not set by hand.
    if (size.name !== "wide" && want("pro")) {
      const { context, page, errors } = await stage(size, lang, { wallet: true, pro: true });
      let ticket = null;
      if (size.mobile) {
        // The Pro pool's own line in the phone's list: the innermost line that names DLMM Pro and holds the pair's button.
        await page.locator("main button:visible").filter({ hasText: /^SOL · USDC$/ }).first().waitFor({ timeout: 120_000 });
        await onlyPro(page, size, T.type);
        const line = page.locator("main div").filter({ hasText: /DLMM Pro/ }).filter({ has: page.locator("button", { hasText: /^SOL · USDC$/ }) }).last();
        await line.waitFor({ timeout: 120_000 });
        await tap(size, line.locator("button", { hasText: /^SOL · USDC$/ }).first());
        await page.waitForSelector("[data-earn='sheet']", { timeout: 20_000 });
        ticket = page.locator("[data-earn='sheet']");
      } else {
        await page.waitForSelector("main [role='table']", { timeout: 120_000 });
        await onlyPro(page, size, T.type);
        const proRow = rowsIn(page).filter({ hasText: "DLMM Pro" }).filter({ has: page.getByRole("button", { name: T.add, exact: true }) }).first();
        await proRow.waitFor({ timeout: 60_000 });
        await proRow.getByRole("button", { name: T.add, exact: true }).click();
        ticket = page.locator("aside section").first();
      }
      await ticket.locator("[data-earn-range='line']").waitFor({ timeout: 60_000 });
      if ((await ticket.locator("[data-earn-range='editor']").count()) === 0) await tap(size, ticket.locator("[data-earn-range='tune']"));
      await ticket.locator("[data-earn-range='chart'] rect").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      await shot(page)("pro");
      report.push(`${size.name}/${lang} pro: «${await ticket.locator("[data-earn-range='line']").innerText()}» · edges by hand ${await ticket.locator("[data-earn-range='low']").count()} · ${(await ticket.locator("[data-earn-range='facts']").innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
      if (errors.length) report.push(`${size.name}/${lang} pro: page errors — ${errors.join(" | ").slice(0, 500)}`);
      await context.close();
    }
  }
}

await browser.close();
console.log(report.join("\n"));
