// «Copy a wallet» for the eyes: a desk at 1440×900 and 1920×1080, a phone at 390×844, English and Ukrainian →
// <out>/*.jpg, with a report of what each state said.
//   node terminal/bots/copy-shots.mjs <out> [baseUrl]          SIZES=wide,desk,phone  LANGS=en,uk
// The stand: NEXT_PUBLIC_RYNTRA_TERMINAL=stand next dev. Every answer of the engine is a recorded one — the cloud holds no
// key: the market is the bundled snapshot (city/lib/market/snapshot.json), a coin's hours the review's sample
// (city/lib/bots/demo.ts), the copied wallet's read the engine's wallet view of a leader trading JUP and MET against SOL,
// her copies the engine's answer of `/api/wallet-watch/copy` after the cron's passes. A test wallet of the page's own answers
// the browser's wallet standard: it connects and refuses every signature it is asked for — nothing is signed.
import { Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sampleBars } from "../../city/lib/bots/demo.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-298");
const base = process.argv[3] ?? "http://localhost:3298";
mkdirSync(out, { recursive: true });

const ALL_SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name, fallback) => (process.env[name] ? process.env[name].split(",").filter(Boolean) : fallback);
const SIZES = ALL_SIZES.filter((size) => list("SIZES", ["desk", "phone"]).includes(size.name));
const LANGS = list("LANGS", ["en", "uk"]);

const SNAPSHOT = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const byId = new Map(SNAPSHOT.towers.map((tower) => [tower.id, tower]));
const coin = (symbol) => SNAPSHOT.towers.find((tower) => tower.symbol === symbol && tower.verified);
const SOL = coin("SOL");
const JUP = coin("JUP");
const MET = coin("MET");

const NOW = Date.now();
const S = Math.floor(NOW / 1000);
const HOUR = 3_600_000;
const END = Math.floor(NOW / HOUR) * HOUR;
/** Public addresses of fresh keys thrown away at once: no wallet holds them; nothing signs with them. */
const fresh = () => Keypair.generate().publicKey.toBase58();
const OWNER = fresh();
const LEADER = fresh();
const OTHER = fresh();
const WALLET = "Stand Wallet";
const report = [];

/* ---------------------------------------------------------------- the copied wallet's read */

const solPer = (tower) => tower.price / SOL.price;
const leg = (n, side, tower, sol, agoS) => {
  const tokens = sol / solPer(tower);
  return { signature: `${n}`.padEnd(88, "k"), slot: 383_000_000 - agoS, at: S - agoS, side, mint: tower.id, symbol: tower.symbol, icon: tower.icon ?? null, tokensRaw: String(Math.round(tokens * 1e6)), decimals: 6, quote: "SOL", quoteAmount: sol, paidBy: null };
};
const TRADES = [
  leg(1, "buy", JUP, 2.4, 40 * 60),
  leg(2, "sell", MET, 3.1, 3 * 3_600),
  leg(3, "buy", MET, 1.2, 9 * 3_600),
  leg(4, "buy", JUP, 0.8, 20 * 3_600),
  leg(5, "sell", JUP, 1.9, 30 * 3_600),
  leg(6, "buy", MET, 2.0, 41 * 3_600),
  leg(7, "buy", JUP, 1.5, 55 * 3_600),
  leg(8, "buy", MET, 0.6, 70 * 3_600),
];
const VIEW = {
  wallet: LEADER,
  readAt: new Date(NOW).toISOString(),
  oldestAt: S - 4 * 86_400,
  complete: false,
  trades: TRADES,
  honest: { approx: false, pnl: { whole: { result: null, known: 1.84, realized: 1.2, unrealized: 0.64, completenessPct: 82, verdict: "UNKNOWN", trades: TRADES.length } } },
  pnl: { wins: 3, losses: 1, approx: false },
  badges: { creator: 0, sniper: 0, bundle: 0 },
  solUsd: SOL.price,
};

/* ---------------------------------------------------------------- her copies, after the cron's passes */

const COPIES = [
  {
    leader: LEADER,
    name: null,
    since: new Date(NOW - 2 * 86_400_000).toISOString(),
    sizeSol: 0.25,
    slippagePct: 5,
    agent: { perDaySol: 1, perTradeSol: 0.25, days: 7, sharePct: 25, endsAt: new Date(NOW + 5 * 86_400_000).toISOString(), todaySol: 0.5, ended: false },
    summary: { spentSol: 1.26, receivedSol: 0.31, heldSol: 0.97, unpriced: 0, resultSol: 0.021, pct: 1.7, feesSol: 0.014, filled: 6, missed: 2 },
    positions: [],
    fills: [],
  },
  {
    leader: OTHER,
    name: null,
    since: new Date(NOW - 12 * 86_400_000).toISOString(),
    sizeSol: 0.1,
    slippagePct: 15,
    agent: { perDaySol: 0.5, perTradeSol: 0.1, days: 7, sharePct: 25, endsAt: new Date(NOW - 5 * 86_400_000).toISOString(), todaySol: 0, ended: true },
    summary: { spentSol: 1.1, receivedSol: 0.94, heldSol: 0.05, unpriced: 1, resultSol: -0.11, pct: -10, feesSol: 0.03, filled: 11, missed: 5 },
    positions: [],
    fills: [],
  },
];

/* ---------------------------------------------------------------- the test wallet */

function walletScript({ owner, name }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    if (name) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
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

async function engine(context, { proven, copies }) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)[^/]+\/.*\.(png|svg|jpe?g|webp|gif)(\?.*)?$/i, (route) => route.abort());
  await context.route("**/api/**", (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/city") return json(route, { towers: SNAPSHOT.towers, fetchedAt: new Date(NOW).toISOString(), source: "live" });
    if (pathname.startsWith("/api/icon/")) return route.fulfill({ status: 204, body: "" });
    if (pathname === "/api/spot/candles") {
      const tower = byId.get(url.searchParams.get("mint"));
      if (!tower) return json(route, { error: { code: "CANDLES_NO_POOL" } }, 404);
      const bars = sampleBars(tower.id, tower.price, tower.change24h, END);
      return json(route, { timeframe: url.searchParams.get("tf"), candles: bars.map((b) => ({ time: Math.round(b.t / 1000), open: b.o, high: b.h, low: b.l, close: b.c })), observedAt: new Date(NOW).toISOString(), source: { label: "GeckoTerminal" } });
    }
    if (pathname === "/api/wallet-watch/wallet") return json(route, url.searchParams.get("q") === LEADER ? { ok: true, view: VIEW } : { error: "unavailable" }, url.searchParams.get("q") === LEADER ? 200 : 503);
    if (pathname === "/api/wallet-watch/copy") return proven ? json(route, { ok: true, address: OWNER, money: false, copies }) : json(route, { error: "proof required", proof: false }, 401);
    if (pathname === "/api/solana/holdings") return json(route, { owner: OWNER, sol: 3.2, tokens: [] });
    return json(route, {}, 503);
  });
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const run = async ({ wallet, proven = true, copies = COPIES }, steps) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
        reducedMotion: "reduce",
      });
      await engine(context, { proven, copies });
      await context.addInitScript(walletScript, { owner: OWNER, name: wallet ? WALLET : null });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      const settle = async () => {
        await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
        await page.waitForTimeout(1400);
      };
      const open = async () => {
        await page.goto(`${base}/bots/copy?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
        await page.waitForSelector("[data-bot='copy'] [data-copy-start]", { timeout: 300_000 });
        await settle();
      };
      const shot = async (state) => {
        await page.waitForTimeout(500);
        if (size.mobile) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
          /* «money» — the form's end on a phone: «Start with money» and the worst day's line under it. */
          for (const [part, mark, above] of [
            ["form", "[data-bot-form]", 120],
            ["money", "[data-copy-money]", 520],
            ["mine", "[data-bot-mine]", 120],
          ]) {
            const box = page.locator(mark).first();
            if (!(await box.count())) continue;
            await box.evaluate((el, gap) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - gap), above);
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(out, `${state}-${part}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg" });
          }
        } else await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 84, type: "jpeg", fullPage: true });
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (wide) report.push(`${size.name}/${lang} ${state}: the page scrolls sideways`);
      };
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      await steps({ page, open, shot, said });
      report.push(`${size.name}/${lang}${wallet ? " +wallet" : ""}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
    };

    // Without a wallet: the empty form and its one action, «Connect wallet».
    await run({ wallet: false }, async ({ open, shot, said }) => {
      await open();
      report.push(`${size.name}/${lang} no wallet: the action «${await said("[data-copy-start]")}», money «${await said("[data-copy-money]")}», worst «${await said("[data-copy-worst]")}»`);
      await shot("nowallet");
    });

    // With the test wallet and two copies kept: a wallet pasted — what it does, her numbers, the month's fees.
    await run({ wallet: true }, async ({ page, open, shot, said }) => {
      await open();
      await page.waitForSelector("[data-copy-stop], [data-bot-mine] article", { timeout: 30_000 }).catch(() => {});
      const field = page.locator("[data-copy-address] input").first();
      await field.fill(LEADER);
      await page.waitForSelector("[data-copy-leader]", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(900);
      report.push(`${size.name}/${lang} pasted: «${await said("[data-copy-leader]")}» · «${await said("[data-copy-fees]")}» · the action «${await said("[data-copy-start]")}»`);
      await shot("filled");
      // «Start on paper»: the engine keeps the copy; one line says so, nothing is signed.
      await page.locator("[data-copy-start]").first().click();
      await page.waitForTimeout(900);
      report.push(`${size.name}/${lang} started: «${await said("[data-bot-form] [role='status']:not(:empty)")}»`);
      if (!size.mobile) await shot("started");
      // A wallet the engine could not read: one line where its figures stand, and a quiet «Try again».
      await page.locator("[data-copy-address] input").first().fill(OTHER);
      await page.waitForTimeout(2500);
      report.push(`${size.name}/${lang} unread: «${await said("[data-copy-address] [role='status']")}»`);
      await shot("unread");
    });

    // With the wallet not yet proven: the list asks for one message — no copies drawn, nothing empty.
    await run({ wallet: true, proven: false }, async ({ open, shot, said }) => {
      await open();
      report.push(`${size.name}/${lang} not proven: «${await said("[data-copy-prove]")}»`);
      await shot("proof");
    });
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
