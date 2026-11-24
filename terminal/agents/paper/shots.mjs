// The agent's week on paper for the eyes: a desk at 1920×1080, a phone at 390×844, English and Ukrainian →
// <out>/*.jpg, with a report of what each screen said and what the wallet was asked.
//   node terminal/agents/paper/shots.mjs <out> [baseUrl]          SIZES=wide,phone  LANGS=en,uk
// The stand runs with the terminal's switch, the bots' switches as production has them, and the paper week open:
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet
//   NEXT_PUBLIC_RYNTRA_AGENT_PAPER=open next dev -p 3303
// Every answer is a recorded one — the cloud reaches neither Jupiter nor a store: the market is the bundled snapshot
// (city/lib/market/snapshot.json), a coin's hours the review's sample (city/lib/bots/demo.ts), and the paper week is the
// paper engine's own output (lib/mandate/paper/step.server.ts) over a scripted price path at the snapshot's JUP price.
// A test wallet of the page's own answers the browser's wallet standard: it connects and refuses every signature.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Keypair } from "@solana/web3.js";

import { sampleBars } from "../../../city/lib/bots/demo.ts";
import { runPlan } from "../../../lib/mandate/backtest.ts";
import { viewOf, weekEnd } from "../../../lib/mandate/paper/model.ts";
import { paperStep } from "../../../lib/mandate/paper/step.server.ts";
import { STEADY } from "../../../lib/mandate/plans.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const SNAPSHOT = require("../../../city/lib/market/snapshot.json");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-296");
const base = process.argv[3] ?? "http://localhost:3303";
mkdirSync(out, { recursive: true });

const ALL_SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name, fallback) => (process.env[name] ? process.env[name].split(",").filter(Boolean) : fallback);
const SIZES = ALL_SIZES.filter((size) => list("SIZES", ALL_SIZES.map((s) => s.name)).includes(size.name));
const LANGS = list("LANGS", ["en", "uk"]);

const coin = (symbol) => SNAPSHOT.towers.find((tower) => tower.symbol === symbol && tower.verified);
const SOLT = coin("SOL");
const JUP = coin("JUP");
const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OWNER = Keypair.generate().publicKey.toBase58();
const WALLET = "Stand Wallet";
const PAPER_KEY = "s".repeat(43);
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "48250000000", decimals: 9 }], tokenRead: "COMPLETE" } };
const report = [];

/* ---------------------------------------------------------------- the paper week, run by the paper engine */

/** JUP in lamports a whole coin, at the snapshot's prices, on a gentle scripted path. */
const lamportsPerJup = (JUP.price / SOLT.price) * 1e9;
const pathAt = (start) => (at) => lamportsPerJup * (1 + 0.035 * Math.sin((at - start) / (19 * HOUR)) - 0.01 * ((at - start) / DAY));

async function weekOf(days, { status } = {}) {
  const start = NOW - days * DAY;
  const price = pathAt(start);
  const reads = {
    buy: async (lamports) => BigInt(Math.floor((Number(lamports) * 1e6 * 0.998) / price(reads.at))),
    worth: async (coins) => BigInt(Math.floor((Number(coins) * price(reads.at) * 0.998) / 1e6)),
    fees: async () => ({ buyBps: 10, sellBps: 10 }),
    at: start,
  };
  let agent = {
    id: "0".repeat(64),
    kind: "paper",
    network: "mainnet",
    plan: "steady",
    coin: JUP.id,
    symbol: JUP.symbol,
    perDayRaw: "500000000",
    perTradeRaw: "100000000",
    days: 30,
    startedAt: start,
    endsAt: weekEnd(start, 30),
    bornAt: null,
    unitRaw: "1000000",
    status: "working",
    trades: [],
    worthRaw: null,
    worthAt: null,
    exitBps: 10,
    updatedAt: start,
  };
  for (let at = start; at <= Math.min(NOW, agent.endsAt + 5 * 60_000); at += 5 * 60_000) {
    reads.at = at;
    agent = (await paperStep(agent, reads, at)).agent;
  }
  return viewOf(status ? { ...agent, status } : agent, NOW);
}

const WORKING = await weekOf(2.4);
const DONE = await weekOf(7.2);
report.push(`paper week at work: day ${WORKING.day} of ${WORKING.weekDays}, ${WORKING.trades} paper trades, net ${WORKING.net.netRaw}, holding ${WORKING.net.holdRaw}`);
report.push(`paper week done: ${DONE.status}/${DONE.doneBy}, ${DONE.trades} paper trades, net ${DONE.net.netRaw}, holding ${DONE.net.holdRaw}`);

/** The run on history the card's «i» reads, the engine's own over the sample hours. */
const bars = sampleBars(JUP.id, JUP.price, JUP.change24h, Math.floor(NOW / HOUR) * HOUR);
const HISTORY = { result: runPlan(STEADY, bars, { perTrade: 0.1, perDay: 0.5, days: 30 }, { barMs: HOUR }) };

/* ---------------------------------------------------------------- the page's world */

function walletScript({ owner, name, key }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    if (name) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
    if (key) localStorage.setItem("ryntra.paper-week.key", key);
  } catch {}
  if (!name) return;
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
  const refuse = (what) => async () => {
    asked.push(what);
    throw new Error("User rejected the request.");
  };
  const wallet = {
    version: "1.0.0",
    name,
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
const JUP_ICON = path.resolve("public/site/universe/JUP.png");

async function world(context, paper) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+\/.*\.(png|svg|jpe?g|webp|gif)(\?.*)?$/i, (route) => route.abort());
  await context.route("**/api/**", (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/city") return json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date(NOW).toISOString(), source: "live" });
    if (pathname === `/api/icon/${JUP.id}` && existsSync(JUP_ICON)) return route.fulfill({ status: 200, contentType: "image/png", path: JUP_ICON });
    if (pathname.startsWith("/api/icon/")) return route.fulfill({ status: 204, body: "" });
    if (pathname === "/api/solana/holdings") return json(route, HOLDINGS);
    if (pathname === "/api/bots/mandate/test") return json(route, HISTORY);
    if (pathname === "/api/bots/mandate/paper") {
      report.push(`  the paper route was asked: ${request.method()}${request.method() === "POST" ? ` ${request.postData()?.replace(/"key":"[^"]+"/u, '"key":"…"')}` : ""}`);
      return paper(route, request);
    }
    return json(route, {}, 503);
  });
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const run = async (state, { wallet, key, paper }, steps) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
        reducedMotion: "reduce",
      });
      await world(context, paper);
      await context.addInitScript(walletScript, { owner: OWNER, name: wallet ? WALLET : null, key: key ? PAPER_KEY : null });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      // What the page itself complained of — a resource the recorded world refuses (503) is the world's, not the page's.
      page.on("console", (message) => {
        if (message.type() !== "error" || message.text().startsWith("Failed to load resource")) return;
        // The stand's known development warning: the frame's ids (`useId`) differ at hydration now and then, above this
        // card and with master's own NewAgent.tsx too — written down as such, never hidden.
        const known = /didn't match the client properties/u.test(message.text()) && /id="_R_/u.test(message.text());
        errors.push(known ? "console: the stand's known hydration warning (useId of the frame and the budget's fields, present on master too)" : `console: ${message.text().slice(0, 300)}`);
      });
      await page.goto(`${base}/bots/recurring?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
      await page.waitForSelector("[data-bot='recurring'] [data-agent-terms], [data-bot='recurring'] [data-agent-give], [data-paper-result]", { timeout: 600_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await steps(page);
      // The development overlay is the stand's, not the screen's (as terminal/shell/wallets-shots.mjs hides it).
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
      await page.waitForTimeout(1600);
      const card = page.locator("[data-paper-result]").first();
      if (size.mobile && (await card.count())) await card.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 260));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      report.push(
        `${size.name}/${lang} ${state}: mark «${await said("[data-paper-mark]")}» · result «${await said("[data-paper-result]")}» · action «${await said("[data-paper-live], [data-agent-connect], [data-agent-give]")}» · note «${await said("[role=status]")}» · ambers ${await page.locator("[data-bot='recurring'] [data-paper-live]:visible, [data-bot='recurring'] [data-agent-connect]:visible, [data-bot='recurring'] [data-agent-give]:visible").count()}${wide ? " · THE PAGE SCROLLS SIDEWAYS" : ""}`,
      );
      report.push(`${size.name}/${lang} ${state}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${size.name}/${lang} ${state}: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    };
    const answer = (view) => (route) => json(route, { paper: view });

    // At work on paper, a wallet connected: «Start with money» is the one action.
    await run("week", { wallet: true, key: true, paper: answer(WORKING) }, async (page) => {
      await page.waitForSelector("[data-paper-live]", { timeout: 60_000 });
    });
    // No wallet: the wallet's door in the action's place.
    await run("week-connect", { wallet: false, key: true, paper: answer(WORKING) }, async (page) => {
      await page.waitForSelector("[data-paper-result]", { timeout: 60_000 });
    });
    // The week over: the result stays, and so does «Start with money».
    await run("week-done", { wallet: true, key: true, paper: answer(DONE) }, async (page) => {
      await page.waitForSelector("[data-paper-live]", { timeout: 60_000 });
    });
    // Before the store is there: the practice's tap says, in one line, that paper is not open yet.
    await run("before-store", { wallet: true, key: false, paper: (route) => json(route, { error: { code: "PAPER_NO_STORE" } }, 503) }, async (page) => {
      const day = page.locator("[data-bot='recurring'] input").first();
      await day.fill(lang === "uk" ? "0,5" : "0.5");
      await page.waitForSelector("[data-agent-practice]:not([disabled])", { timeout: 60_000 }).catch(() => {});
      await page.locator("[data-agent-practice]").first().click({ timeout: 30_000 }).catch(() => report.push(`${size.name}/${lang} before-store: the practice could not be tapped`));
      await page.waitForTimeout(800);
    });
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
