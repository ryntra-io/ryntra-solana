// Every answer of
// the engine is a recorded one: the market is the bundled snapshot, the shelf of stocks the fixture below, the budget's
// review the engine's real answer for a Backpack stock (no fee rate in Ryntra's table — `lib/mandate/service.server.ts`
// `coinForBudget`). A test wallet of the page's own connects and refuses every signature — nothing is signed.
import { Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sampleBars } from "../../city/lib/bots/demo.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-358-d");
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

const STOCKS = [
  ["Tesla", "TSLAx", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "xstocks", 90],
  ["Anthropic", "ANT", "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe", "backpack", 80],
  ["NVIDIA", "NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "xstocks", 60],
  ["Apple", "AAPLx", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "xstocks", 40],
];
const SHELF = { data: { companies: STOCKS.map(([name, ticker, mint, issuer, volume]) => ({ name, ticker, mint, icon: null, price: 100, change24h: 0.8, volume24h: volume * 1000, issuer })), order: "volume-24h", fetchedAt: new Date(NOW).toISOString() } };
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "48250000000", decimals: 9 }], tokenRead: "COMPLETE" } };
const AGENTS = { owner: OWNER, networks: { mainnet: { read: true, mandates: [], pilot: null, cares: [] }, devnet: { read: true, mandates: [], pilot: null, cares: [] } } };
/** The engine's own answer to a budget for a Backpack stock, today: no router fee for the pair, so no signature. */
const NO_PAIR = { error: { code: "REFUSED", message: "The agent does not trade this pair: Ryntra's table names no router fee for it." } };

function walletScript({ owner, connect }) {
  const asked = [];
  window.__standAsked = asked;
  if (!connect) return;
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

async function engine(context) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+\/.*$/i, (route) => route.abort());
  await context.route("**/api/**", (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/city") return json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date(NOW).toISOString(), source: "live" });
    if (pathname.startsWith("/api/icon/")) return route.fulfill({ status: 204, body: "" });
    if (pathname === "/api/v1/stocks/popular") return json(route, SHELF);
    if (pathname === "/api/v1/stocks/pool-facts") {
      const mint = url.searchParams.get("mint");
      const stock = STOCKS.find((one) => one[2] === mint);
      return json(route, { facts: { mint, isStock: Boolean(stock), issuer: stock ? { id: stock[3], label: stock[3] === "backpack" ? "Backpack Securities" : "xStocks" } : null, session: "open", nextChangeAt: new Date(NOW + 3 * HOUR).toISOString(), dividendGuard: null, termsUrl: null, kind: stock ? "listed-equity" : null, powers: null, listed: null } });
    }
    if (pathname === "/api/spot/candles") {
      const mint = url.searchParams.get("mint");
      const tower = byId.get(mint);
      const bars = tower ? sampleBars(tower.id, tower.price, tower.change24h, END) : STOCKS.some((one) => one[2] === mint) ? sampleBars(mint, 100, 0.8, END) : null;
      if (!bars) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date(NOW).toISOString(), source: { label: "GeckoTerminal" } });
    }
    if (pathname === "/api/bots/agents") return json(route, AGENTS);
    if (pathname === "/api/solana/holdings") return json(route, HOLDINGS);
    if (pathname === "/api/bots/mandate/review") return json(route, NO_PAIR, 422);
    if (pathname === "/api/v1/assistant/guest") return json(route, {}, 503);
    return json(route, {}, 503);
  });
}

const SAY = { en: "buy TSLAx every week for $50", uk: "купуй TSLAx щотижня на $50" };
const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const run = async (connect, steps) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
        reducedMotion: "reduce",
      });
      await engine(context);
      await context.addInitScript(walletScript, { owner: OWNER, connect });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const tag = `${size.name}/${lang}`;
      const settle = async () => {
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
        await page.waitForTimeout(1200);
      };
      const open = async (address, mark) => {
        await page.goto(`${base}${address}${address.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
        await page.waitForSelector(mark, { timeout: 300_000 });
        await settle();
      };
      const shot = async (state, full = !size.mobile) => {
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 80, type: "jpeg", fullPage: full });
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) report.push(`${tag} ${state}: the page scrolls sideways`);
      };
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      await steps({ page, open, shot, said, tag });
      report.push(`${tag}${connect ? " +wallet" : ""}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${tag}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    };

    // Without a wallet: Agents and the catalogue, then the sentence said — on a desk in the header's line, on a phone in
    // the Agents screen's own field (the phone's «Agent» tab).
    await run(false, async ({ page, open, shot, said, tag }) => {
      await open("/agent", "[data-agents] [data-agent-ask-field]");
      report.push(`${tag} agents: ready lines — ${(await page.locator("[data-agent-questions] button").allTextContents()).join(" | ")} · «${await said("[data-agent-ask]")}» disabled ${await page.locator("[data-agent-ask]").isDisabled()} · focus ${await page.locator("[data-agent-focus]").getAttribute("data-agent-focus")}`);
      await shot("agents");

      await open("/bots", "[data-bots-catalog]");
      const cards = await page.locator("[data-bot-card]").evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().right)));
      const head = await page.locator("[data-page-head]").first().evaluate((el) => Math.round(el.getBoundingClientRect().right));
      report.push(`${tag} catalogue: ${cards.length} cards, right edges ${JSON.stringify(cards)}, the head's ${head}`);
      await shot("catalog");

      if (size.mobile) {
        await open("/agent", "[data-agents] [data-agent-ask-field]");
        await page.locator("[data-agent-ask-field]").fill(SAY[lang]);
        await page.locator("[data-agent-ask]").click();
      } else {
        await page.locator("[data-city-command] input").fill(SAY[lang]);
        await page.waitForTimeout(400);
        report.push(`${tag} line: first row «${await said("[data-city-command] [role='option']")}»`);
        await shot("line-rows", false);
        await page.locator("[data-city-command] input").press("Enter");
      }
      await page.waitForURL(/\/bots\/recurring/, { timeout: 300_000 });
      await page.waitForSelector("[data-bot-budget-unit='week']", { timeout: 60_000 });
      await page.waitForTimeout(1500);
      const week = await page.locator("[data-bot-budget-unit='week'] input").first().inputValue().catch(() => "—");
      report.push(`${tag} sentence → ${new URL(page.url()).pathname}: unit ${await page.locator("[data-bot-budget-unit]").getAttribute("data-bot-budget-unit")} · coin ${await page.locator("[role='radio'][aria-checked='true'][data-bot-stock], [role='radio'][aria-checked='true'][data-agent-coin]").first().textContent().catch(() => "—")} · a week ${week} SOL · «${await said("[data-bot-budget-unit='week'] label ~ span, [data-bot-budget-unit='week'] span")}»`);
      if (size.mobile) await page.locator("[data-bot-budget-unit]").scrollIntoViewIfNeeded();
      await shot("sentence-week", false);

      // Back to a coin: «A week» gives way to the coin's own «A day».
      await page.locator("[data-agent-coin='JUP']").first().click();
      await page.waitForTimeout(900);
      report.push(`${tag} TSLAx → JUP: unit ${await page.locator("[data-bot-budget-unit]").getAttribute("data-bot-budget-unit")}`);
      if (size.mobile) await page.locator("[data-bot-budget-unit]").scrollIntoViewIfNeeded();
      await shot("back-to-coin", false);
    });

    // With the test wallet: a budget for a Backpack stock, stopped by the engine before the wallet — said in her language.
    await run(true, async ({ page, open, shot, said, tag }) => {
      await open("/bots/recurring", "[data-bot='recurring'] [data-bot-stocks]");
      await page.locator("[data-bot-stock='ANT']").click();
      await page.waitForTimeout(800);
      await page.locator("[data-bot-budget-unit='day'] input").first().fill("0.1");
      await page.waitForTimeout(1200);
      const give = page.locator("[data-agent-give]");
      if (await give.isDisabled().catch(() => true)) {
        report.push(`${tag} refusal: the action is off — «${await said("[data-agent-give]")}»`);
        return;
      }
      await give.click();
      await page.waitForSelector("[data-bot-refusal]", { timeout: 30_000 }).catch(() => {});
      report.push(`${tag} refusal: «${await said("[data-bot-refusal]")}»`);
      await page.locator("[data-agent-give]").scrollIntoViewIfNeeded();
      await shot("refusal", false);
    });
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
