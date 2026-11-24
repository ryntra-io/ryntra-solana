// MET/SOL on DLMM Pro — the Limit form whole on 1440 × 900 (fault 23), the pool's book with no row cut in half
// (fault 24) — and «Earn» with its window, its stars and its one measure, on 1920, 1440 × 900 and 390, EN and UK.
//   node terminal/pool/shots-358e.mjs [out] [baseUrl]
// `baseUrl` a stand (`next dev` with NEXT_PUBLIC_RYNTRA_TERMINAL=stand, NEXT_PUBLIC_RYNTRA_CITY_EARN=open,
// NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open, NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS=mainnet). Every `/api/**` read is answered
// here from the repository's own fixtures; the wallet is never connected; nothing is sent. SIZES=wide,desk,phone,
// LANGS=en,uk and PAGES=pool,earn,pro narrow the run. The report — <out>/report.txt: what each frame measured.
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { mapCatalogPage } from "../../lib/liquidity/catalog/model.ts";
import { earnPeriods, earnPools } from "../../lib/earn-pools/model.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-358e");
const base = process.argv[3] ?? "http://localhost:3358";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const POOL = "JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d";
const AGENT = "AgentCo11ector1111111111111111111111111111111";
const PRICE = 0.0036; // SOL per MET
const SOL_USD = 72.9;

const coin = (mint, symbol, name, decimals, usd) => ({ mint, symbol, name, decimals, icon: null, verified: true, usd });
const ROW = {
  address: POOL,
  kind: "static",
  x: coin(MET, "MET", "Meteora", 6, PRICE * SOL_USD),
  y: coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD),
  price: PRICE,
  tickSpacing: 128,
  stepBps: 128,
  fee: { totalBps: 30, baseBps: 30, dynamicBps: 0, mode: "fixed", protocolShareBps: 2000, collectedIn: "output" },
  bonusBps: 60,
  reserves: { xRaw: "2400000000000", yRaw: "9800000000000" },
  tvlUsd: 1_340_000,
  rewards: 0,
  open: { swap: true, deposits: true },
};
const BINS = {
  venue: "pro",
  pool: POOL,
  x: { mint: MET, decimals: 6 },
  y: { mint: SOL, decimals: 9 },
  stepBps: 128,
  activeId: 0,
  price: PRICE,
  bins: Array.from({ length: 81 }, (_, i) => {
    const offset = i - 40;
    const shape = Math.round(1e9 * Math.exp(-Math.abs(offset) / 9));
    return { offset, id: offset * 128, price: PRICE * Math.pow(1.0128, offset), x: offset >= 0 ? String(shape * 300) : "0", y: offset <= 0 ? String(shape) : "0" };
  }),
  market: { price: PRICE, gapPct: 0 },
  rent: null,
  at: new Date().toISOString(),
};
const MARKET = {
  network: "mainnet",
  pool: POOL,
  coin: { mint: MET, decimals: 6 },
  quote: { mint: SOL, symbol: "SOL", decimals: 9 },
  price: PRICE,
  bonus: { feeBps: 30, ownerBps: 60, referralBps: 6 },
  reach: { buyBps: 9_900, sellBps: 990_000 },
  placing: true,
  collector: AGENT,
  cap: { maxRaw: "100000000000", minRungRaw: "1000000" },
};
function quoteOf({ action, farBps, rungs, amountRaw }) {
  const count = Math.max(1, Math.min(rungs ?? 25, 25, Math.floor(farBps / 128)));
  const total = BigInt(amountRaw ?? "1000000000");
  const each = total / BigInt(count);
  const list = Array.from({ length: count }, (_, at) => {
    const awayBps = count === 1 ? farBps : Math.round(128 + (at * (farBps - 128)) / (count - 1));
    const price = PRICE * (action === "buy" ? 1 - awayBps / 10_000 : 1 + awayBps / 10_000);
    const pays = action === "buy" ? (Number(each) / 1e9 / price) * 1e6 : (Number(each) / 1e6) * price * 1e9;
    return { awayBps, price, amountRaw: each.toString(), paysRaw: BigInt(Math.floor(pays)).toString() };
  });
  const pays = list.reduce((sum, rung) => sum + BigInt(rung.paysRaw), 0n);
  const rests = each * BigInt(count);
  return { market: MARKET, action, restsIn: action === "buy" ? SOL : MET, paysIn: action === "buy" ? MET : SOL, rungs: list, amountRaw: rests.toString(), paysRaw: pays.toString(), averagePrice: list.reduce((s, r) => s + r.price, 0) / list.length, nearBps: list[0].awayBps, farBps: list.at(-1).awayBps, corridorBps: 100, bonus: { feeBps: 30, ownerBps: 60, referralBps: 6, referral: AGENT, feeIn: SOL } };
}

const page = (name) => JSON.parse(readFileSync(new URL(`../../lib/liquidity/catalog/fixtures/${name}`, import.meta.url), "utf8"));
const catalog = [...mapCatalogPage(page("dlmm-catalog-2026-10-16.json"), "dlmm").pools, ...mapCatalogPage(page("damm-v2-catalog-2026-10-16.json"), "damm-v2").pools];
// The recorded pages hold four pools each and a floor of $50K volume would hide most: the shots open the filters wide.
const POOLS = { pools: earnPools(catalog), lend: [{ mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", ratePct: 4.6, suppliedUsd: 410_000_000 }], at: new Date().toISOString(), sources: { dlmm: true, dammV2: true, lend: true } };
const PERIODS = { pools: earnPeriods(catalog), at: new Date().toISOString() };

const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const PAGES = (process.env.PAGES ?? "pool,earn,pro").split(",");
const reportFile = path.join(out, "report.txt");
// REPORT_APPEND=1 adds to the report of an earlier run (a second run for the pages the first did not take).
if (process.env.REPORT_APPEND !== "1") writeFileSync(reportFile, "");
const report = (line) => {
  appendFileSync(reportFile, `${line}\n`);
  console.log(line);
};

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stub(context) {
  await context.route("**/api/**", (route) => json(route, 503, {}));
  await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  await context.route("**/api/pro/pools", (route) => json(route, 200, { network: "mainnet", at: new Date().toISOString(), pools: [ROW] }));
  await context.route(`**/api/pro/pools/${POOL}`, (route) => json(route, 200, { network: "mainnet", at: new Date().toISOString(), pool: ROW }));
  await context.route("**/api/v1/earn/pro/bins?*", (route) => json(route, 200, BINS));
  await context.route("**/api/v1/ladders/market?*", (route) => json(route, 200, { market: new URL(route.request().url()).searchParams.get("mint") === MET ? MARKET : null }));
  await context.route("**/api/v1/ladders/quote", async (route) => json(route, 200, quoteOf(JSON.parse(route.request().postData() ?? "{}"))));
  await context.route("**/api/v1/earn/pools", (route) => json(route, 200, POOLS));
  await context.route("**/api/earn/pools/periods", (route) => json(route, 200, PERIODS));
}

/** What a frame measured: the Limit form's action against the window's foot, and the book's rows against its box. */
async function measure(view) {
  return view.evaluate(() => {
    const vh = window.innerHeight;
    const side = document.querySelector('[data-pool] aside');
    const act = side ? [...side.querySelectorAll("button")].filter((b) => b.offsetParent !== null).at(-1) : null;
    const box = act?.getBoundingClientRect();
    const ticket = side?.getBoundingClientRect();
    // The book's own scroller inside the pool's column: the box that scrolls, else the column's book box itself.
    const wrap = document.querySelector('[data-pool] [class*="bookBox"]');
    const book = wrap ? ([...wrap.querySelectorAll("*")].find((el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible") ?? wrap) : null;
    let cut = null;
    if (book) {
      const frame = book.getBoundingClientRect();
      cut = [...book.querySelectorAll("li")].filter((li) => {
        const r = li.getBoundingClientRect();
        return r.top < frame.bottom - 1 && r.bottom > frame.bottom + 1;
      }).length;
    }
    return {
      scrollH: document.documentElement.scrollHeight,
      vh,
      ticket: ticket ? { top: Math.round(ticket.top), bottom: Math.round(ticket.bottom), scroll: side.scrollHeight - side.clientHeight } : null,
      action: box ? { text: act.textContent?.trim().slice(0, 40), bottom: Math.round(box.bottom), visible: box.bottom <= Math.min(vh, ticket?.bottom ?? vh) } : null,
      bookRowsCut: cut,
    };
  });
}

// A stand's own Chromium where the machine has one (PRESS_CHROME), else Playwright's.
const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((value) => {
      try {
        window.localStorage.setItem("ryntra.city.lang", value);
        window.localStorage.setItem("ryntra.terminal.saved-pools.v1", JSON.stringify(["5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"]));
      } catch {}
      document.cookie = `ryntra_lang=${value}; path=/`;
      // A dev stand's own badge is not the page: hidden from the frame.
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; }";
        document.head.append(style);
      });
    }, lang);
    await stub(context);
    const view = await context.newPage();
    const shoot = async (name, url, after) => {
      await view.goto(`${base}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await view.waitForTimeout(6_000);
      if (after) await after();
      await view.waitForTimeout(800);
      const file = `${name}-${size.name}-${lang}.jpg`;
      await view.screenshot({ path: path.join(out, file), type: "jpeg", quality: 80 });
      report(`${file} ${JSON.stringify(await measure(view))}`);
    };
    if (PAGES.includes("pool")) {
      await shoot("pool-limit", `/pool/${POOL}?tab=limit`);
    }
    if (PAGES.includes("earn")) {
      const wide = async () => {
        // The recorded catalogue is small: no floor, so every recorded pool stands.
        const chip = view.locator('[data-earn="more-filters"]');
        void chip;
      };
      await shoot("earn", "/earn", wide);
      await shoot("earn-1h", "/earn", async () => {
        await view.locator('button[data-short][aria-expanded]').first().click();
        await view.getByRole("menuitemradio", { name: lang === "uk" ? "1 год" : "1h", exact: true }).click();
      });
    }
    if (PAGES.includes("pro")) await shoot("pro", "/pro");
    await context.close();
  }
}
await browser.close();
