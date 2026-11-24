// Group G6 of the second pass by eye (20.11) — «Earn» and /pro on recorded answers only (no network): every tab of
// «Earn» and /pro on 1920, 1440 × 900 and 390, EN and UK, and the state where no source answers.
//   node terminal/earn/shots-g6.mjs [out] [baseUrl]
// `baseUrl` a stand (`next dev` with NEXT_PUBLIC_RYNTRA_TERMINAL=stand, NEXT_PUBLIC_RYNTRA_CITY_EARN=open,
// NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open, NEXT_PUBLIC_RYNTRA_EARN_DLMM_STOCKS=open). Every `/api/**` read is answered here
// from the figures below; the wallet is never connected; nothing is sent. SIZES=wide,desk,phone, LANGS=en,uk and
// PAGES=pools,pro,staking,lending,mine,err narrow the run. The report — <out>/report.txt: what each frame measured.
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "docs/shots/eyes-g6");
const base = process.argv[3] ?? "http://localhost:3366";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const DACITY = "DaCiTy1111111111111111111111111111111111111";
const DACITY2 = "DaCiTy2222222222222222222222222222222222222";
const LAUNCH = "LaUnCh1111111111111111111111111111111111111";
const SOL_USD = 138.4;

/* The pools' catalogue: the same pair several times over (fault 39), the stock's pools (fault 40), a staked SOL pool. */
let n = 0;
const addr = () => `Pool${String(++n).padStart(4, "0")}${"1".repeat(35)}`.slice(0, 44);
const c = (mint, symbol) => ({ mint, symbol, verified: true });
const pool = (kind, x, y, tvlUsd, feePct, step, volume, fees) => ({
  kind,
  address: addr(),
  x,
  y,
  tvlUsd,
  volume24hUsd: volume,
  fees24hUsd: fees,
  feeTvl24hPct: (fees / tvlUsd) * 100,
  baseFeePct: feePct,
  feePct,
  binStepBps: kind === "dlmm" ? step : null,
  createdAt: "2026-09-12T10:00:00Z",
  page: "https://www.meteora.ag/",
});
const CATALOG = [
  pool("dlmm", c(SOL, "SOL"), c(USDC, "USDC"), 8_400_000, 0.04, 4, 41_000_000, 16_400),
  pool("dlmm", c(SOL, "SOL"), c(USDC, "USDC"), 2_100_000, 0.2, 20, 9_800_000, 19_600),
  pool("damm-v2", c(SOL, "SOL"), c(USDC, "USDC"), 640_000, 0.25, null, 1_200_000, 3_000),
  pool("dlmm", c(ANT, "ANT"), c(USDC, "USDC"), 412_000, 0.2, 20, 380_000, 760),
  pool("dlmm", c(ANT, "ANT"), c(USDC, "USDC"), 96_000, 0.8, 80, 120_000, 960),
  pool("dlmm", c(ANT, "ANT"), c(USDC, "USDC"), 18_000, 1, 100, 30_000, 300),
  pool("dlmm", c(ANT, "ANT"), c(SOL, "SOL"), 64_000, 0.25, 25, 90_000, 225),
  pool("dlmm", c(ANT, "ANT"), c(SOL, "SOL"), 9_000, 2, 200, 4_000, 80),
  pool("dlmm", c(JITO, "JitoSOL"), c(SOL, "SOL"), 3_200_000, 0.01, 1, 6_000_000, 600),
  pool("dlmm", c(JUP, "JUP"), c(SOL, "SOL"), 780_000, 0.3, 30, 2_400_000, 7_200),
  pool("damm-v2", c(MET, "MET"), c(SOL, "SOL"), 260_000, 0.5, null, 410_000, 2_050),
  pool("dlmm", c(MET, "MET"), c(USDC, "USDC"), 1_100_000, 0.1, 10, 3_100_000, 3_100),
];
const POOLS = {
  pools: CATALOG,
  lend: [
    { mint: USDC, symbol: "USDC", ratePct: 4.6, suppliedUsd: 410_000_000 },
    { mint: SOL, symbol: "SOL", ratePct: 6.1, suppliedUsd: 228_000_000 },
  ],
  at: new Date().toISOString(),
  sources: { dlmm: true, dammV2: true, lend: true },
};
const PERIODS = { pools: [], at: new Date().toISOString() };

/* DLMM Pro: MET/SOL leads, two DacityCoin · SOL that differ only by their step (fault 118), a launch pool (fault 44). */
const coin = (mint, symbol, name, decimals, usd, verified = true) => ({ mint, symbol, name, decimals, icon: null, verified, usd });
const pro = (address, kind, x, y, price, stepBps, feeBps, bonusBps, tvlUsd) => ({
  address,
  kind,
  x,
  y,
  price,
  tickSpacing: stepBps,
  stepBps,
  fee: { totalBps: feeBps, baseBps: feeBps, dynamicBps: 0, mode: "fixed", protocolShareBps: 2000, collectedIn: "output" },
  bonusBps,
  reserves: { xRaw: "1000000000", yRaw: "1000000000" },
  tvlUsd,
  rewards: 0,
  open: { swap: true, deposits: true },
});
const PRO = [
  pro("JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d", "static", coin(MET, "MET", "Meteora", 6, 0.49), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 0.0036, 128, 30, 60, 1_340_000),
  pro("ProAnt111111111111111111111111111111111111", "static", coin(ANT, "ANT", "Anthropic - Backed", 6, 84.2), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 0.608, 10, 30, 32, 6),
  pro("ProDac111111111111111111111111111111111111", "static", coin(DACITY, "DacityCoin", "DacityCoin", 6, 0.0021), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 0.0000152, 25, 80, 40, 1_840),
  pro("ProDac222222222222222222222222222222222222", "static", coin(DACITY2, "DacityCoin", "DacityCoin", 6, 0.0019), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 0.0000137, 100, 80, 40, 220),
  pro("ProLau111111111111111111111111111111111111", "launch", coin(LAUNCH, "KITE", "Kite", 6, 0.00031), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 0.0000022, 100, 146, 70, 2_400),
  pro("ProJit111111111111111111111111111111111111", "static", coin(JITO, "JitoSOL", "Jito Staked SOL", 9, 171.2), coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), 1.237, 1, 10, 6, 0),
];

/* Staking: the three staked SOL coins; one rate a year each. */
const FEED = {
  lsts: [
    { id: "jupsol", rate: { lamports: "1130000000000", supply: "1000000000000" }, apyPct: 7.4, rewardsFeePct: 0, unstakeFeePct: 0.1, source: "chain", epoch: 880 },
    { id: "inf", rate: { lamports: "1310000000000", supply: "1000000000000" }, apyPct: 7.9, rewardsFeePct: 6, unstakeFeePct: 0, source: "sanctum", epoch: 880 },
    { id: "jitosol", rate: { lamports: "1237000000000", supply: "1000000000000" }, apyPct: 6.8, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 880 },
  ],
  epochsPerYear: 182,
  at: new Date().toISOString(),
};

const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const PAGES = (process.env.PAGES ?? "pools,pro,staking,lending,mine,err").split(",");
const reportFile = path.join(out, "report.txt");
if (process.env.REPORT_APPEND !== "1") writeFileSync(reportFile, "");
const report = (line) => {
  appendFileSync(reportFile, `${line}\n`);
  console.log(line);
};

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stub(context, failing) {
  await context.route("**/api/**", (route) => json(route, 503, {}));
  await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
  if (failing) return;
  await context.route("**/api/pro/pools", (route) => json(route, 200, { network: "mainnet", at: new Date().toISOString(), pools: PRO }));
  await context.route("**/api/v1/earn/pools", (route) => json(route, 200, POOLS));
  await context.route("**/api/earn/pools/periods", (route) => json(route, 200, PERIODS));
  await context.route("**/api/city/earn", (route) => json(route, 200, FEED));
}

/** What a frame measured: the page's width against the window, and every text cut by its own box. */
async function measure(view) {
  return view.evaluate(() => {
    const cut = [];
    for (const el of document.querySelectorAll("main *")) {
      if (!(el instanceof HTMLElement) || el.children.length || !el.textContent?.trim() || el.offsetParent === null) continue;
      const style = getComputedStyle(el);
      if (style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) cut.push(el.textContent.trim().slice(0, 40));
    }
    const head = [...document.querySelectorAll('[role="columnheader"], [role="row"] > [class*="head"]')].filter((el) => el.getBoundingClientRect().height > 30).map((el) => el.textContent?.trim());
    // A phone's list: each column's width against what its words need (name, line, sum), and the head over it.
    const textWidth = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return Math.ceil(range.getBoundingClientRect().width);
    };
    const grid = document.querySelector('[class*="pRowGrid"]');
    const phone = grid
      ? {
          cols: getComputedStyle(grid).gridTemplateColumns,
          need: [...document.querySelectorAll('[class*="pRowGrid"] button[data-earn-pick], [class*="pRowGrid"] [class*="cap"], [class*="pRowGrid"] [class*="pMid"], [class*="pRowGrid"] [class*="pSide"] > *')].slice(0, 14).map((el) => `${el.textContent?.trim()}:${textWidth(el)}/${el.clientWidth}`),
          head: [...(document.querySelector('[class*="pHeadGrid"]')?.children ?? [])].map((el) => `${el.textContent?.trim()}:${textWidth(el)}/${el.clientWidth}`),
        }
      : null;
    // The pools' bar: on how many rows its chips stand, and how much room the last row leaves.
    const wrap = document.querySelector('[class*="filtersWrap"]');
    const chips = wrap ? [...wrap.querySelectorAll("button")].filter((el) => el.offsetParent !== null) : [];
    const barRows = new Set(chips.map((el) => Math.round(el.getBoundingClientRect().top))).size || null;
    // What the bar's one row would need: every chip's width and the gaps between them, against the bar's own width.
    const barNeed = wrap ? Math.round(chips.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0) + (chips.length - 1) * Number.parseFloat(getComputedStyle(wrap).columnGap || "0")) : null;
    const barRoom = wrap ? Math.round(wrap.getBoundingClientRect().width) : null;
    return { pageScrollX: document.documentElement.scrollWidth - window.innerWidth, cut: [...new Set(cut)].slice(0, 12), tallHeads: head.slice(0, 8), barRows, barNeed, barRoom, fonts: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))], phone: grid && grid.offsetParent !== null ? phone : null };
  });
}

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const failing of [false, true]) {
      if (failing && !PAGES.includes("err")) continue;
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
      await stub(context, failing);
      const view = await context.newPage();
      const shoot = async (name, url, after) => {
        await view.goto(`${base}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
        await view.waitForTimeout(5_000);
        if (after) {
          await after();
          await view.waitForTimeout(800);
        }
        const file = `${name}-${size.name}-${lang}.jpg`;
        await view.screenshot({ path: path.join(out, file), type: "jpeg", quality: 78, fullPage: size.mobile });
        report(`${file} ${JSON.stringify(await measure(view))}`);
      };
      if (failing) {
        await shoot("err-earn", "/earn");
        await shoot("err-pro", "/pro");
      } else {
        if (PAGES.includes("pools")) await shoot("earn", "/earn");
        // A stock's pool (fault 40): its row says «Add» and its ticket leads to the pool page's Position tab.
        if (PAGES.includes("pools") && !size.mobile) {
          await shoot("earn-stock", "/earn", async () => {
            await view.locator('button[data-earn-pick][aria-label*="ANT · USDC"]').first().click();
          });
        }
        if (PAGES.includes("pro")) await shoot("pro", "/pro");
        if (PAGES.includes("staking")) await shoot("staking", "/earn?tab=staking");
        if (PAGES.includes("lending")) await shoot("lending", "/earn?tab=lending");
        if (PAGES.includes("mine")) await shoot("mine", "/earn?tab=mine");
      }
      await context.close();
    }
  }
}
await browser.close();
