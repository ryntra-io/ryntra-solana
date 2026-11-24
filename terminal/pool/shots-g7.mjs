// Every `/api/**` read is answered here; the wallet is never connected; nothing is sent. SIZES=wide,desk,phone,
// LANGS=en,uk and SHOTS=<name>,… narrow the run. The report — <out>/report.txt: what each frame measured.
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { mapCatalogPage } from "../../lib/liquidity/catalog/model.ts";
import { earnPools } from "../../lib/earn-pools/model.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-359-g7");
const base = process.argv[3] ?? "http://localhost:3358";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const MET_SOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const ANT_SOL = "8s6yXkGzG3fKiK4GJzWmJGCqk7rjZZcPq6DYRyZ8ae1Z";
const ANT_SOL_LADDER = "9vNv8hQ2H4ApYw5j2nTnUq2mgsBuWzR1Mj3cFzXy7Tq4";
const ANT_USDC = "2rETc69Asd1V1Ea8xopte18cKukaWmrvmNrj7FzYpxQL";
const DAMM = "NNxcrTuq8eWfY1bLZcd6rKCkMxB5woKWh3Ft1scc7Bh";
const MISSING = "7ZbUfQbLzMbd3xLXp2YJfXbW1oQx8nH4kH7ZkJYQ9bQ3";
const AGENT = "AgentCo11ector1111111111111111111111111111111";
const SOL_USD = 72.9;
const ANT_USD = 83.4;

const coin = (mint, symbol, name, decimals, usd) => ({ mint, symbol, name, decimals, icon: null, verified: true, usd });
const proRow = (address, x, y, price, o) => ({
  address,
  kind: "static",
  x,
  y,
  price,
  tickSpacing: o.step,
  stepBps: o.step,
  fee: { totalBps: o.fee, baseBps: o.fee, dynamicBps: 0, mode: "fixed", protocolShareBps: 2000, collectedIn: "output" },
  bonusBps: o.bonus,
  reserves: { xRaw: "2400000000000", yRaw: "9800000000000" },
  tvlUsd: o.tvl,
  rewards: 0,
  open: { swap: true, deposits: true },
});
const metSol = proRow(MET_SOL, coin(MET, "MET", "Meteora", 6, 0.0036 * SOL_USD), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 0.0036, { step: 128, fee: 30, bonus: 60, tvl: 1_340_000 });
const antCoin = coin(ANT, "ANT", "Anthropic", 6, ANT_USD);
const antSol = proRow(ANT_SOL, antCoin, coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), ANT_USD / SOL_USD, { step: 100, fee: 80, bonus: 32, tvl: 6 });
const antSolLadder = proRow(ANT_SOL_LADDER, antCoin, coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), ANT_USD / SOL_USD, { step: 10, fee: 10, bonus: 4, tvl: 1_240 });
const ROWS = [metSol, antSolLadder, antSol];

function binsOf(venue, pool, x, y, step, price, held) {
  return {
    venue,
    pool,
    x,
    y,
    stepBps: step,
    activeId: 0,
    price,
    bins: Array.from({ length: 81 }, (_, i) => {
      const offset = i - 40;
      const shape = held ? Math.round(1e9 * Math.exp(-Math.abs(offset) / 9)) : 0;
      return { offset, id: offset * step, price: price * Math.pow(1 + step / 10_000, offset), x: offset >= 0 ? String(shape * 300) : "0", y: offset <= 0 ? String(shape) : "0" };
    }),
    market: { price, gapPct: 0 },
    rent: null,
    at: new Date().toISOString(),
  };
}
const BINS = {
  [MET_SOL]: binsOf("pro", MET_SOL, { mint: MET, decimals: 6 }, { mint: SOL, decimals: 9 }, 128, 0.0036, true),
  // Its six dollars lie far from the price: the steps around it hold nothing.
  [ANT_SOL]: binsOf("pro", ANT_SOL, { mint: ANT, decimals: 6 }, { mint: SOL, decimals: 9 }, 100, ANT_USD / SOL_USD, false),
  [ANT_USDC]: binsOf("dlmm", ANT_USDC, { mint: ANT, decimals: 6 }, { mint: USDC, decimals: 6 }, 20, ANT_USD, true),
};

const marketOf = (pool, mint, quote, price, bonus) => ({
  network: "mainnet",
  pool,
  coin: { mint, decimals: 6 },
  quote: { mint: SOL, symbol: "SOL", decimals: 9 },
  price,
  bonus,
  reach: { buyBps: 9_900, sellBps: 990_000 },
  placing: true,
  collector: AGENT,
  cap: { maxRaw: "100000000000", minRungRaw: "1000000" },
});
const MARKETS = {
  [MET]: marketOf(MET_SOL, MET, SOL, 0.0036, { feeBps: 30, ownerBps: 60, referralBps: 6 }),
  // ANT's ladders rest in its 0.1 % pool, with a smaller bonus than the 0.8 % pool's page.
  [ANT]: marketOf(ANT_SOL_LADDER, ANT, SOL, ANT_USD / SOL_USD, { feeBps: 10, ownerBps: 4, referralBps: 1 }),
};
function quoteOf({ mint, action, farBps, rungs, amountRaw }) {
  const market = MARKETS[mint] ?? MARKETS[MET];
  const price = market.price;
  const count = Math.max(1, Math.min(rungs ?? 25, 25, Math.floor(farBps / 128)));
  const total = BigInt(amountRaw ?? "1000000000");
  const each = total / BigInt(count);
  const list = Array.from({ length: count }, (_, at) => {
    const awayBps = count === 1 ? farBps : Math.round(128 + (at * (farBps - 128)) / (count - 1));
    const at_ = price * (action === "buy" ? 1 - awayBps / 10_000 : 1 + awayBps / 10_000);
    const pays = action === "buy" ? (Number(each) / 1e9 / at_) * 1e6 : (Number(each) / 1e6) * at_ * 1e9;
    return { awayBps, price: at_, amountRaw: each.toString(), paysRaw: BigInt(Math.floor(pays)).toString() };
  });
  const pays = list.reduce((sum, rung) => sum + BigInt(rung.paysRaw), 0n);
  return { market, action, restsIn: action === "buy" ? SOL : market.coin.mint, paysIn: action === "buy" ? market.coin.mint : SOL, rungs: list, amountRaw: (each * BigInt(count)).toString(), paysRaw: pays.toString(), averagePrice: list.reduce((s, r) => s + r.price, 0) / list.length, nearBps: list[0].awayBps, farBps: list.at(-1).awayBps, corridorBps: 100, bonus: { ...market.bonus, referral: AGENT, feeIn: SOL } };
}

const page = (name) => JSON.parse(readFileSync(new URL(`../../lib/liquidity/catalog/fixtures/${name}`, import.meta.url), "utf8"));
const catalog = [...mapCatalogPage(page("dlmm-catalog-2026-10-16.json"), "dlmm").pools, ...mapCatalogPage(page("damm-v2-catalog-2026-10-16.json"), "damm-v2").pools];
const ANT_USDC_POOL = {
  kind: "dlmm",
  address: ANT_USDC,
  x: { mint: ANT, symbol: "ANT", verified: true },
  y: { mint: USDC, symbol: "USDC", verified: true },
  tvlUsd: 152_400,
  volume24hUsd: 61_200,
  fees24hUsd: 122,
  feeTvl24hPct: 0.08,
  baseFeePct: 0.2,
  feePct: 0.2,
  binStepBps: 20,
  createdAt: "2026-11-18T10:00:00.000Z",
  page: `https://app.meteora.ag/dlmm/${ANT_USDC}`,
};
const POOLS = { pools: [...earnPools(catalog), ANT_USDC_POOL], lend: [], at: new Date().toISOString(), sources: { dlmm: true, dammV2: true, lend: true } };

const ANT_READ = {
  pool: ANT_USDC,
  stock: { mint: ANT, symbol: "ANT", issuer: "Backpack Securities", side: "x", decimals: 6 },
  quote: { kind: "usdc", mint: USDC, decimals: 6 },
  price: ANT_USD,
  binStepBps: 20,
  activeBin: 2216,
  paused: false,
  add: "on",
  stopped: false,
};
const ANT_FACTS = { mint: ANT, isStock: true, issuer: { id: "backpack", label: "Backpack Securities" }, session: "open", nextChangeAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), dividendGuard: null, termsUrl: "https://learn.backpack.exchange/articles/what-is-backpack-securities", kind: "pre-ipo", powers: null };

const two = (usd) => ({ xRaw: "0", yRaw: "0", usd });
const statsOf = (pool, volume, fees) => ({
  network: "mainnet",
  at: new Date().toISOString(),
  pool,
  pair: { coin: ANT, quote: SOL },
  depth: { from: null, checked: null, transactions: 40, whole: true, stop: "window" },
  stats: {
    hours: 24,
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date().toISOString(),
    whole: true,
    trades: { count: 42, buys: 20, sells: 22, wallets: 17 },
    volume: { coinRaw: "0", quoteRaw: "0", usd: volume },
    fees: { total: two(fees), lp: two(fees / 2), orders: two(fees / 4), protocol: two(fees / 8), referral: two(0), partner: two(0) },
    orders: { placed: 3, fillingTrades: 2, filled: 1, partial: 1, unfilled: 0, unknown: 0, bonusEarned: two(1), bonusPaid: two(1), referralPaid: two(0) },
    prices: null,
  },
});

// The market's trades of a coin under its chart: forty, a few seconds apart.
const tradesOf = (usd) => ({
  trades: Array.from({ length: 40 }, (_, at) => ({
    signature: `${"5".repeat(60)}${String(at).padStart(4, "0")}`.slice(0, 88),
    at: new Date(Date.now() - at * 9_000).toISOString(),
    side: at % 3 === 0 ? "sell" : "buy",
    wallet: `Wa11et${String(at).padStart(3, "0")}${"1".repeat(35)}`,
    tokenAmount: 120 + at * 7,
    usd: (120 + at * 7) * usd,
    priceUsd: usd,
    capUsd: null,
  })),
});

const ICON = readFileSync(new URL("../../public/site/universe/JUP.png", import.meta.url));

const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.SHOTS ? process.env.SHOTS.split(",") : null;
const reportFile = path.join(out, "report.txt");
if (process.env.REPORT_APPEND !== "1") writeFileSync(reportFile, "");
const report = (line) => {
  appendFileSync(reportFile, `${line}\n`);
  console.log(line);
};

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stub(context) {
  await context.route("**/api/**", (route) => json(route, 503, {}));
  await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  // ANT's own logo comes from the catalogue's route only, as on the live site (the market's route has none).
  await context.route(`**/api/spot/icon?mint=${ANT}*`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: ICON }));
  await context.route("**/api/pro/pools", (route) => json(route, 200, { network: "mainnet", at: new Date().toISOString(), pools: ROWS }));
  await context.route("**/api/pro/pools/**", (route) => {
    const url = new URL(route.request().url());
    const [, , , address, part] = url.pathname.split("/").slice(1);
    const row = ROWS.find((entry) => entry.address === address);
    if (part === "stats" && row === antSol) return json(route, 200, statsOf(ANT_SOL, 1_240, 9.6));
    if (part) return json(route, 503, {});
    return row ? json(route, 200, { network: "mainnet", at: new Date().toISOString(), pool: row }) : json(route, 404, {});
  });
  await context.route("**/api/v1/earn/pro/bins?*", (route) => {
    const pool = new URL(route.request().url()).searchParams.get("pool");
    return BINS[pool] ? json(route, 200, BINS[pool]) : json(route, 503, {});
  });
  await context.route("**/api/v1/earn/pools/bins?*", (route) => {
    const pool = new URL(route.request().url()).searchParams.get("pool");
    return BINS[pool] ? json(route, 200, BINS[pool]) : json(route, 503, {});
  });
  await context.route("**/api/v1/ladders/market?*", (route) => json(route, 200, { market: MARKETS[new URL(route.request().url()).searchParams.get("mint")] ?? null }));
  await context.route("**/api/v1/ladders/quote", async (route) => json(route, 200, quoteOf(JSON.parse(route.request().postData() ?? "{}"))));
  await context.route("**/api/spot/token?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("part") !== "trades") return json(route, 503, {});
    return json(route, 200, tradesOf(url.searchParams.get("mint") === ANT ? ANT_USD : 0.0036 * SOL_USD));
  });
  await context.route("**/api/v1/earn/pools", (route) => json(route, 200, POOLS));
  await context.route("**/api/city/earn/dlmm-stocks?*", (route) => json(route, 200, ANT_READ));
  await context.route("**/api/v1/stocks/pool-facts?*", (route) => json(route, 200, { facts: new URL(route.request().url()).searchParams.get("mint") === ANT ? ANT_FACTS : { mint: "", isStock: false, issuer: null, session: "none", nextChangeAt: null, dividendGuard: null, termsUrl: null } }));
}

/** What a frame measured: the ticket's last action against the window and the desk, the head's row, the page's foot. */
async function measure(view) {
  return view.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const side = document.querySelector("[data-pool] aside");
    const act = side ? [...side.querySelectorAll("button")].filter((b) => b.offsetParent !== null).at(-1) : null;
    const box = act?.getBoundingClientRect();
    const ticket = side?.getBoundingClientRect();
    const desk = document.querySelector("[data-pool-desk]")?.getBoundingClientRect();
    const head = document.querySelector("[data-pool-head]");
    const figures = head ? [...head.querySelectorAll("dl > div")].map((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), r: Math.round(r.right), y: Math.round(r.top), seen: r.right <= vw + 0.5 && r.width > 0 && getComputedStyle(el).display !== "none" }; }) : [];
    const tools = head?.querySelector("[class*='headTools']")?.getBoundingClientRect();
    const bonus = document.querySelector("[data-pool-bonus]")?.getBoundingClientRect();
    return {
      vh,
      scrollY: Math.round(window.scrollY),
      scrollH: document.documentElement.scrollHeight,
      desk: desk ? { top: Math.round(desk.top), bottom: Math.round(desk.bottom) } : null,
      ticket: ticket ? { top: Math.round(ticket.top), bottom: Math.round(ticket.bottom), scroll: side.scrollHeight - side.clientHeight } : null,
      action: box ? { text: act.textContent?.trim().slice(0, 40), bottom: Math.round(box.bottom), visible: box.bottom <= Math.min(vh, ticket?.bottom ?? vh) } : null,
      bonusH: bonus ? Math.round(bonus.height) : null,
      figures: { shown: figures.filter((f) => f.seen).length, of: figures.length, lastRight: figures.length ? Math.max(...figures.filter((f) => f.seen).map((f) => f.r)) : null, rows: [...new Set(figures.map((f) => f.y))].length },
      tools: tools ? { left: Math.round(tools.left), right: Math.round(tools.right) } : null,
    };
  });
}

const SHOTS = [
  { name: "antsol-limit", url: `/pool/${ANT_SOL}?tab=limit` },
  { name: "antsol-pool", url: `/pool/${ANT_SOL}?tab=limit`, phoneOnly: true, scroll: "[data-pool] [class*='phoneBlock']" },
  { name: "antsol-ticket", url: `/pool/${ANT_SOL}?tab=limit`, phoneOnly: true, scroll: "[data-pool-bonus]" },
  { name: "metsol-limit", url: `/pool/${MET_SOL}?tab=limit` },
  { name: "antusdc-position", url: `/pool/${ANT_USDC}?tab=position` },
  { name: "antusdc-form", url: `/pool/${ANT_USDC}?tab=position`, phoneOnly: true, scroll: "[data-pool] [class*='phoneTicket']" },
  { name: "damm-swap", url: `/pool/${DAMM}` },
  { name: "failed", url: `/pool/${MISSING}`, failed: true },
].filter((shot) => !ONLY || ONLY.includes(shot.name));

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((value) => {
      try {
        window.localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; }";
        document.head.append(style);
      });
    }, lang);
    await stub(context);
    // The page whose pool did not read: every read of the pool fails, as when the source does not answer.
    const failing = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await failing.addInitScript((value) => {
      try {
        window.localStorage.setItem("ryntra.city.lang", value);
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
    }, lang);
    await failing.route("**/api/**", (route) => route.abort());
    for (const shot of SHOTS) {
      if (shot.phoneOnly && !size.mobile) continue;
      const view = await (shot.failed ? failing : context).newPage();
      await view.goto(`${base}${shot.url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await view.waitForTimeout(7_000);
      if (shot.scroll) {
        // Clear of the site's own head, which stays over the page on a phone.
        const at = await view.locator(shot.scroll).first().evaluate((el) => {
          window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96);
          return { tag: el.className.toString().slice(0, 60), y: Math.round(window.scrollY) };
        });
        console.log(shot.name, JSON.stringify(at));
        await view.waitForTimeout(600);
      }
      const file = `${shot.name}-${size.name}-${lang}.jpg`;
      await view.screenshot({ path: path.join(out, file), type: "jpeg", quality: 80 });
      report(`${file} ${JSON.stringify(await measure(view))}`);
      await view.close();
    }
    await context.close();
    await failing.close();
  }
}
await browser.close();
