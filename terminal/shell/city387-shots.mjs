// «Планшет і одна кнопка агента»: the terminal's tables at 768, 820 and 1024 and the phone's tab bar at 390,
// without a wallet → <out>/<phase>/<page>-<width>-<lang>.jpg and <out>/<phase>/report.txt: for each table, how wide its
// box is against what its columns need, and whether every row's last cell (the action) stands whole inside the card.
//   node terminal/shell/city387-shots.mjs [out] [baseUrl] [phase]
// The coin's page (`/coin/<JUP>`) stands on recorded trades and holders as well; its chart and price read nothing.
// A stand on recorded answers only (no network): `next dev` with NEXT_PUBLIC_RYNTRA_TERMINAL=open,
// NEXT_PUBLIC_RYNTRA_CITY_EARN=open, NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open, NEXT_PUBLIC_RYNTRA_EARN_DLMM_STOCKS=open.
// The figures are the shapes of terminal/earn/shots-g6.mjs. WIDTHS=768,820 LANGS=en PAGES=earn,pro narrow a run. No
// wallet connects; nothing is built, signed or sent.
import { chromium } from "playwright";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const phase = process.argv[4] ?? "after";
const out = path.resolve(process.argv[2] ?? "docs/shots/city-387", phase);
const base = process.argv[3] ?? "http://localhost:3135";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SOL_USD = 138.4;

let n = 0;
const addr = () => `Pool${String(++n).padStart(4, "0")}${"1".repeat(35)}`.slice(0, 44);
const c = (mint, symbol) => ({ mint, symbol, verified: true });
const pool = (kind, x, y, tvlUsd, feePct, step, volume, fees) => ({ kind, address: addr(), x, y, tvlUsd, volume24hUsd: volume, fees24hUsd: fees, feeTvl24hPct: (fees / tvlUsd) * 100, baseFeePct: feePct, feePct, binStepBps: kind === "dlmm" ? step : null, createdAt: "2026-09-12T10:00:00Z", page: "https://www.meteora.ag/" });
const POOLS = {
  pools: [
    pool("dlmm", c(SOL, "SOL"), c(USDC, "USDC"), 8_400_000, 0.04, 4, 41_000_000, 16_400),
    pool("dlmm", c(SOL, "SOL"), c(USDC, "USDC"), 2_100_000, 0.2, 20, 9_800_000, 19_600),
    pool("damm-v2", c(SOL, "SOL"), c(USDC, "USDC"), 640_000, 0.25, null, 1_200_000, 3_000),
    pool("dlmm", c(ANT, "ANT"), c(USDC, "USDC"), 412_000, 0.2, 20, 380_000, 760),
    pool("dlmm", c(JITO, "JitoSOL"), c(SOL, "SOL"), 3_200_000, 0.01, 1, 6_000_000, 600),
    pool("dlmm", c(JUP, "JUP"), c(SOL, "SOL"), 780_000, 0.3, 30, 2_400_000, 7_200),
    pool("damm-v2", c(MET, "MET"), c(SOL, "SOL"), 260_000, 0.5, null, 410_000, 2_050),
    pool("dlmm", c(MET, "MET"), c(USDC, "USDC"), 1_100_000, 0.1, 10, 3_100_000, 3_100),
  ],
  lend: [
    { mint: USDC, symbol: "USDC", ratePct: 4.6, suppliedUsd: 410_000_000 },
    { mint: SOL, symbol: "SOL", ratePct: 6.1, suppliedUsd: 228_000_000 },
  ],
  at: new Date().toISOString(),
  sources: { dlmm: true, dammV2: true, lend: true },
};
const coin = (mint, symbol, name, decimals, usd) => ({ mint, symbol, name, decimals, icon: null, verified: true, usd });
const pro = (address, x, price, stepBps, feeBps, bonusBps, tvlUsd) => ({ address, kind: "static", x, y: coin(SOL, "SOL", "Wrapped SOL", 9, SOL_USD), price, tickSpacing: stepBps, stepBps, fee: { totalBps: feeBps, baseBps: feeBps, dynamicBps: 0, mode: "fixed", protocolShareBps: 2000, collectedIn: "output" }, bonusBps, reserves: { xRaw: "1000000000", yRaw: "1000000000" }, tvlUsd, rewards: 0, open: { swap: true, deposits: true } });
const PRO = [
  pro("JANXdizRntR7xoSbRDXEo2CCNDP9d5wzyCQCvv6Dxb6d", coin(MET, "MET", "Meteora", 6, 0.49), 0.0036, 128, 30, 60, 1_340_000),
  pro("ProAnt111111111111111111111111111111111111", coin(ANT, "ANT", "Anthropic - Backed", 6, 84.2), 0.608, 10, 30, 32, 6),
  pro("ProJit111111111111111111111111111111111111", coin(JITO, "JitoSOL", "Jito Staked SOL", 9, 171.2), 1.237, 1, 10, 6, 0),
];
const FEED = {
  lsts: [
    { id: "jupsol", rate: { lamports: "1130000000000", supply: "1000000000000" }, apyPct: 7.4, rewardsFeePct: 0, unstakeFeePct: 0.1, source: "chain", epoch: 880 },
    { id: "inf", rate: { lamports: "1310000000000", supply: "1000000000000" }, apyPct: 7.9, rewardsFeePct: 6, unstakeFeePct: 0, source: "sanctum", epoch: 880 },
    { id: "jitosol", rate: { lamports: "1237000000000", supply: "1000000000000" }, apyPct: 6.8, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 880 },
  ],
  epochsPerYear: 182,
  at: new Date().toISOString(),
};

/* The coin's trades and holders under its chart, in the engine's form (`/api/spot/token`), as terminal/coin/g8-shots.mjs has them. */
const now = Date.now();
const WALLETS = ["7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"];
const TRADES = Array.from({ length: 30 }, (_, i) => {
  const usd = i % 5 === 0 ? 4_420.5 - i * 31 : 184.5 - i * 3;
  const price = 0.2791 * (1 + ((i % 7) - 3) / 1000);
  return { signature: `sigJUP${i}`, at: new Date(now - i * 47_000).toISOString(), side: i % 3 === 0 ? "sell" : "buy", wallet: WALLETS[i % WALLETS.length], tokenAmount: usd / price, usd, priceUsd: price, capUsd: price * 2_700_000_000, labels: [] };
});
const HOLDERS = Array.from({ length: 20 }, (_, i) => ({ owner: WALLETS[i % WALLETS.length], amount: 9_000_000 / (i + 1), sharePct: 12 / (i + 1), labels: i === 0 ? ["pool"] : [], change: null }));

const WIDTHS = (process.env.WIDTHS ?? "768,820,1024,390").split(",").map(Number);
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ALL_PAGES = [
  ["earn", "/earn"],
  ["pro", "/pro"],
  ["staking", "/earn?tab=staking"],
  ["lending", "/earn?tab=lending"],
  ["coin", `/coin/${JUP}`],
  ["market", "/"],
  ["swap", "/swap"],
];
const PAGES = process.env.PAGES ? ALL_PAGES.filter(([name]) => process.env.PAGES.split(",").includes(name)) : ALL_PAGES;
const reportFile = path.join(out, "report.txt");
writeFileSync(reportFile, "");
const report = (line) => {
  appendFileSync(reportFile, `${line}\n`);
  console.log(line);
};
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Each table: its box, what its rows need, and every row whose last cell stands cut by the card's right edge. */
const measure = () => {
  const tables = [...document.querySelectorAll("[role='table']")].filter((t) => t.offsetParent !== null).map((t) => {
    const wrap = t.parentElement.getBoundingClientRect();
    const rows = [...t.querySelectorAll("[role='row']")];
    const cut = rows.filter((row) => {
      const last = row.lastElementChild?.getBoundingClientRect();
      return last && last.width > 0 && last.right > wrap.right + 1;
    }).length;
    const heads = [...(t.querySelector("[role='row']")?.children ?? [])].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.textContent?.trim() || "·");
    return { label: t.getAttribute("aria-label"), box: Math.round(wrap.width), need: Math.round(t.scrollWidth), rows: rows.length, cut, heads };
  });
  // The phone's agent's tab: its ground and its edge, as the eye sees them.
  const gem = document.querySelector("[data-terminal='tabs'] a:nth-child(3) > span");
  const look = gem && gem.offsetParent !== null ? (({ backgroundImage, backgroundColor, borderTopWidth, clipPath, color }) => ({ backgroundImage: backgroundImage.slice(0, 60), backgroundColor, borderTopWidth, clipPath: clipPath.slice(0, 20), color }))(getComputedStyle(gem)) : null;
  return { pageScrollX: document.documentElement.scrollWidth - window.innerWidth, tables, gem: look };
};

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
for (const width of WIDTHS) {
  const phone = width < 768;
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 1180 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: lang === "uk" ? "uk-UA" : "en-US" });
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
    await context.route("**/api/**", (route) => json(route, 503, {}));
    await context.route("**/api/auth/solana/session*", (route) => json(route, 200, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/pro/pools", (route) => json(route, 200, { network: "mainnet", at: new Date().toISOString(), pools: PRO }));
    await context.route("**/api/v1/earn/pools", (route) => json(route, 200, POOLS));
    await context.route("**/api/earn/pools/periods", (route) => json(route, 200, { pools: [], at: new Date().toISOString() }));
    await context.route("**/api/city/earn", (route) => json(route, 200, FEED));
    await context.route("**/api/spot/token?*", (route) => {
      const part = new URL(route.request().url()).searchParams.get("part");
      return part === "trades" ? json(route, 200, { trades: TRADES }) : part === "holders" ? json(route, 200, { holders: HOLDERS, programPct: null, supply: null, reach: null }) : json(route, 503, {});
    });
    const view = await context.newPage();
    for (const [name, url] of PAGES) {
      // The tab bar is the phone's; the tables are the tablet's.
      if (phone !== (name === "market" || name === "swap")) continue;
      await view.goto(`${base}${url}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await view.waitForTimeout(6_000);
      const file = `${name}-${width}-${lang}.jpg`;
      await view.screenshot({ path: path.join(out, file), type: "jpeg", quality: 80, fullPage: !phone });
      report(`${file} ${JSON.stringify(await view.evaluate(measure))}`);
    }
    await context.close();
  }
}
await browser.close();
