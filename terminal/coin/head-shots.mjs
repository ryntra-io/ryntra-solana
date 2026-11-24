// The coin's head of two rows and the phone's one screen, for the eyes → <out>/*.jpg, and the measures a PR states.
//   node terminal/coin/head-shots.mjs [out] [baseUrl]
// A stand: `NEXT_PUBLIC_RYNTRA_TERMINAL=stand next dev -p 3184`. Every read of the engine is answered by the passport
// stand's own coins (`passport/stand-coins.ts`, shaped exactly as the engine answers) and a fixed tape — no network, no
// wallet, nothing sent. SIZES=desk1440,desk1366,phone and LANGS=uk,en narrow the run.
//
// Measured on each frame: the page does not scroll sideways; no figure of the head is cut (its text wider than its box);
// on the phone, the trades table's last column ends inside the screen.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { standCoins } from "./passport/stand-coins.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-354");
const base = process.argv[3] ?? "http://localhost:3184";
mkdirSync(out, { recursive: true });

const coins = standCoins(Date.now());
// The stand's coin, under a mint the page takes (the stand's own names are not base58): its market and facts say it.
const MINT = process.env.MINT ?? "LUMAqMfDu7k2YbKcQ4p1sVvGWa9xQeWvG816bUx9EPj";
const pick = coins[process.env.COIN ?? "old"];
// STOCK=1: the same coin as a company's token — its market says «stock», its facts name the issuer and the exchange.
const STOCK = process.env.STOCK === "1";
const COIN = { ...pick, mint: MINT, market: { ...pick.market, mint: MINT, name: process.env.NAME ?? pick.market.name, ...(STOCK ? { category: "stock", symbol: "ANT", name: "Anthropic" } : {}) }, facts: pick.facts ? { ...pick.facts, mint: MINT } : null };
const poolFacts = { mint: MINT, isStock: true, issuer: { id: "backpack", label: "Backpack Securities" }, session: "closed", nextChangeAt: new Date(Date.now() + 5 * 3_600_000).toISOString(), dividendGuard: null, termsUrl: null, kind: "listed-equity", powers: { take: true, pause: true, paused: false }, listed: null };
const SIZES = [
  { name: "desk1920", width: 1920, height: 1080, mobile: false },
  { name: "desk1440", width: 1440, height: 900, mobile: false },
  { name: "desk1366", width: 1366, height: 768, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "uk,en").split(",");
const VIEWS = (process.env.VIEWS ?? "chart,trades,holders,about").split(",");

const now = Date.now();
const wallets = ["MfDu7k2YbKcQ4p1sVvGWa", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH"];
const trades = Array.from({ length: 30 }, (_, i) => ({
  signature: `sig${i}`,
  at: new Date(now - i * 47_000).toISOString(),
  side: i % 3 === 0 ? "sell" : "buy",
  wallet: wallets[i % wallets.length],
  tokenAmount: 1234.56 + i * 97,
  usd: 18_420.5 - i * 311,
  priceUsd: COIN.market.price,
  capUsd: COIN.market.marketCapUsd,
}));
const holders = Array.from({ length: 20 }, (_, i) => ({ owner: wallets[i % 3] + i, amount: 9_000_000 / (i + 1), sharePct: 12 / (i + 1), labels: i === 0 ? ["pool"] : i === 3 ? ["creator"] : [], change: i % 2 ? 1200 : null }));

const answers = (url) => {
  const u = new URL(url);
  const p = u.pathname;
  const part = u.searchParams.get("part");
  if (p === "/api/spot/market") return { market: COIN.market };
  if (p === "/api/v1/stocks/pool-facts" && STOCK) return { facts: poolFacts };
  if (p === "/api/spot/token" && part === "overview") return { facts: COIN.facts };
  if (p === "/api/spot/token" && part === "risk") return { facts: COIN.risk };
  if (p === "/api/spot/token" && part === "trades") return { trades };
  if (p === "/api/spot/token" && part === "holders") return { holders, programPct: 12, supply: 1e9 };
  return null;
};

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const report = [];
for (const size of SIZES) {
  for (const lang of LANGS) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
    await context.addInitScript((lang) => {
      try {
        localStorage.setItem("ryntra.lang", lang);
        localStorage.setItem("city.lang", lang);
      } catch {}
    }, lang);
    await context.route("**/api/**", (route) => {
      const body = answers(route.request().url());
      return body ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }) : route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    const page = await context.newPage();
    await page.goto(`${base}/coin/${COIN.mint}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForTimeout(6000);
    const views = size.mobile ? VIEWS : ["desk"];
    for (const view of views) {
      if (size.mobile) {
        const tabs = page.locator('[role="tablist"]').filter({ has: page.locator('[role="tab"]') });
        const index = ["chart", "trades", "holders", "about"].indexOf(view);
        const tab = page.locator(`[data-view]`).first();
        await tab.waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
        const bar = page.locator('div[role="tablist"]').filter({ hasText: lang === "uk" ? "Графік" : "Chart" }).first();
        await bar.locator('[role="tab"]').nth(index).click().catch(() => undefined);
        void tabs;
        await page.waitForTimeout(800);
      }
      const measure = await page.evaluate(() => {
        const sideways = document.documentElement.scrollWidth - window.innerWidth;
        const cut = [];
        for (const el of document.querySelectorAll("dl dt, dl dd, [role='tab']")) {
          if (el.offsetParent === null) continue;
          if (el.scrollWidth > el.clientWidth + 1) cut.push(el.textContent.trim().slice(0, 30));
        }
        let lastCell = null;
        const row = document.querySelector("[data-view='trades'] [role='row']:not(:first-child)");
        if (row) {
          const cell = row.lastElementChild;
          const box = cell.getBoundingClientRect();
          const text = cell.firstElementChild?.getBoundingClientRect() ?? box;
          lastCell = { right: Math.round(text.right), cellRight: Math.round(box.right), screen: window.innerWidth, inside: text.right <= window.innerWidth - 4 };
        }
        return { sideways, cut, lastCell };
      });
      const name = `${STOCK ? "stock-" : ""}${size.name}-${lang}${size.mobile ? `-${view}` : ""}`;
      await page.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 82, fullPage: false });
      report.push({ name, ...measure });
      console.log(name, JSON.stringify(measure));
    }
    await context.close();
  }
}
writeFileSync(path.join(out, STOCK ? "report-stock.json" : "report.json"), JSON.stringify(report, null, 2));
await browser.close();
