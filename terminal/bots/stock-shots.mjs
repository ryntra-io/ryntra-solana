// «Recurring buys» of a stock for the eyes: 1920×1080, 1440×900 and a phone at 390×844, English and Ukrainian
// → <out>/*.jpg, with a report of what each screen said.
//   node terminal/bots/stock-shots.mjs <out> [baseUrl]          SIZES=wide,desk,phone  LANGS=en,uk
// The stand runs as `shots.mjs` says (the terminal's switch and the bots' switches as production has them). Every answer of
// the engine is a recorded one: the market is the bundled snapshot, the shelf of stocks and a stock's facts the fixtures
// below (the exchange closed, then open), a stock's week the review's sample hours. A test wallet of the page's own
// connects and refuses every signature it is asked for — nothing is signed.
import { Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sampleBars } from "../../city/lib/bots/demo.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-368");
const base = process.argv[3] ?? "http://localhost:3303";
mkdirSync(out, { recursive: true });

const ALL_SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name, fallback) => (process.env[name] ? process.env[name].split(",").filter(Boolean) : fallback);
const SIZES = ALL_SIZES.filter((size) => list("SIZES", ALL_SIZES.map((s) => s.name)).includes(size.name));
const LANGS = list("LANGS", ["en", "uk"]);

const SNAPSHOT = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const byId = new Map(SNAPSHOT.towers.map((tower) => [tower.id, tower]));
const NOW = Date.now();
const HOUR = 3_600_000;
const END = Math.floor(NOW / HOUR) * HOUR;
const OWNER = Keypair.generate().publicKey.toBase58();
const report = [];

/* The shelf as the stocks engine lists it — its verified companies, the issuer's own tokens (the static book's mints). */
const STOCKS = [
  ["Anthropic", "ANT", "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe", "backpack", 100],
  ["SpaceX", "SPCX", "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", "backpack", 80],
  ["NVIDIA", "NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "xstocks", 60],
  ["Tesla", "TSLA", "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S", "backpack", 50],
  ["Apple", "AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "xstocks", 40],
  ["Alphabet", "GOOGLx", "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", "xstocks", 30],
];
const SHELF = { data: { companies: STOCKS.map(([name, ticker, mint, issuer, volume]) => ({ name, ticker, mint, icon: null, price: 100, change24h: 0.8, volume24h: volume * 1000, issuer })), order: "volume-24h", fetchedAt: new Date(NOW).toISOString() } };
const ANT = STOCKS[0][2];
const facts = (session) => ({
  facts: {
    mint: ANT,
    isStock: true,
    issuer: { id: "backpack", label: "Backpack Securities" },
    session,
    nextChangeAt: new Date(NOW + (session === "open" ? 3 : 15) * HOUR).toISOString(),
    dividendGuard: null,
    termsUrl: "https://learn.backpack.exchange/articles/what-is-backpack-securities",
    kind: "listed-equity",
    powers: { take: true, pause: true, paused: false },
    listed: null,
  },
});
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "48250000000", decimals: 9 }], tokenRead: "COMPLETE" } };
const AGENTS = { owner: OWNER, networks: { mainnet: { read: true, mandates: [], pilot: null, cares: [] }, devnet: { read: true, mandates: [], pilot: null, cares: [] } } };

function walletScript({ owner }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    localStorage.setItem("ryntra.solana.wallet-hint.v1", "Stand Wallet");
  } catch {}
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Stand Wallet" };
  const refuse = (what) => async () => {
    asked.push(what);
    throw new Error("User rejected the request.");
  };
  const wallet = {
    version: "1.0.0",
    name: "Stand Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=",
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse("signTransaction") },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: refuse("signAndSendTransaction") },
      "solana:signMessage": { version: "1.0.0", signMessage: refuse("signMessage") },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function engine(context, session) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+\/.*\.(png|svg|jpe?g|webp|gif)(\?.*)?$/i, (route) => route.abort());
  await context.route("**/api/**", (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/city") return json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date(NOW).toISOString(), source: "live" });
    if (pathname.startsWith("/api/icon/")) return route.fulfill({ status: 204, body: "" });
    if (pathname === "/api/v1/stocks/popular") return json(route, SHELF);
    if (pathname === "/api/v1/stocks/pool-facts") {
      const mint = url.searchParams.get("mint");
      return mint === ANT ? json(route, facts(session)) : json(route, { facts: { mint, isStock: false, issuer: null, session: "unknown", nextChangeAt: null, dividendGuard: null, termsUrl: null, kind: null, powers: null, listed: null } });
    }
    if (pathname === "/api/spot/candles") {
      const mint = url.searchParams.get("mint");
      const tower = byId.get(mint);
      const bars = tower ? sampleBars(tower.id, tower.price, tower.change24h, END) : mint === ANT ? sampleBars(ANT, 100, 0.8, END) : null;
      if (!bars) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date(NOW).toISOString(), source: { label: "GeckoTerminal" } });
    }
    if (pathname === "/api/bots/agents") return json(route, AGENTS);
    if (pathname === "/api/solana/holdings") return json(route, HOLDINGS);
    return json(route, {}, 503);
  });
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    for (const session of ["closed", "open"]) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.mobile ? 2 : 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
        reducedMotion: "reduce",
      });
      await engine(context, session);
      await context.addInitScript(walletScript, { owner: OWNER });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const tag = `${size.name}/${lang} ${session}`;
      const shot = async (state, full = !size.mobile) => {
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: full });
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) report.push(`${tag} ${state}: the page scrolls sideways`);
      };
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      await page.goto(`${base}/bots/recurring?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      await page.waitForSelector("[data-bot='recurring'] [data-bot-stocks]", { timeout: 300_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.locator("[data-bot-stock='ANT']").click();
      await page.waitForSelector("[data-bot-stock-terms]", { timeout: 30_000 });
      await page.waitForSelector("[data-bot-exchange]", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      report.push(`${tag}: head «${await said("[data-bot-chart-head]")}» · hours on ${(await page.locator("[data-bot-stock-terms][data-hours]").count()) > 0} · closed line ${(await page.locator("[data-bot-stock-closed]").count()) > 0} · action «${await said("[data-agent-give]")}» disabled ${await page.locator("[data-agent-give]").isDisabled().catch(() => null)}`);
      if (size.mobile) {
        await shot(`stock-${session}-top`);
        await page.locator("[data-bot-stock-terms]").scrollIntoViewIfNeeded();
        await shot(`stock-${session}`);
      } else await shot(`stock-${session}`);
      if (session === "closed") {
        // A week: the person writes her sum a week; the engine's budget follows.
        await page.getByRole("radio", { name: lang === "uk" ? "На тиждень" : "A week" }).click();
        await page.locator("[data-bot-budget-unit='week'] input").first().fill(lang === "uk" ? "1" : "1");
        await page.waitForTimeout(900);
        report.push(`${tag} week: «${await said("[data-bot-budget-unit='week'] span")}» · terms «${await said("[data-agent-terms]")}» · action «${await said("[data-agent-give]")}»`);
        await page.locator("[data-bot-budget-unit]").scrollIntoViewIfNeeded();
        await shot("stock-week");
        if (!size.mobile) {
          await page.locator("[data-bot-stock-terms] button[aria-expanded]").last().click();
          await page.waitForTimeout(500);
          await page.locator("[data-bot-stock-terms]").scrollIntoViewIfNeeded();
          await shot("stock-issuer", false);
        }
      }
      report.push(`${tag}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${tag}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    }
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
