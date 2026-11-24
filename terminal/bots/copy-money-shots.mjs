// «Copy a wallet» with money for the eyes: a desk at 1440×900 and a phone at 390×844, English and Ukrainian,
// with the screen's switch closed and open → <out>/<money>-*.jpg, with a report of what each state said. Her
// copies with money and their «Stop» whatever the switch; a stop that leaves a coin — «Take the rest» in its note and, after
// a reload, on her row; a start that landed in part — listed as unfinished, «Finish» or «Take back».
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand [NEXT_PUBLIC_RYNTRA_AGENT_COPY=on] next dev -p 3377
//   MONEY=closed|open node terminal/bots/copy-money-shots.mjs <out> [baseUrl]      SIZES=desk,phone  LANGS=en,uk
// The switch is the dev server's own (`NEXT_PUBLIC_RYNTRA_AGENT_COPY`): MONEY only names the shots. Every answer of the
// engine is a recorded one — the cloud holds no key: the market is the bundled snapshot, the copied wallet's read the
// engine's wallet view, her copies the engine's answer of `/api/wallet-watch/copy` with her copies with money, and the money
// routes' answers the door's own shapes. The test wallet of the page's own «signs» by filling the signature's bytes: no key
// exists, nothing is sent anywhere — the relay is recorded too.
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sampleBars } from "../../city/lib/bots/demo.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = path.resolve(process.argv[2] ?? "docs/shots/city-377");
const base = process.argv[3] ?? "http://localhost:3377";
const MONEY = process.env.MONEY === "open" ? "open" : "closed";
mkdirSync(out, { recursive: true });

const ALL_SIZES = [
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
const THIRD = fresh();
const STUCK = fresh();
const POLICY = fresh();
const FROZEN_POLICY = fresh();
const PENDING_POLICY = fresh();
const WALLET = "Stand Wallet";
const report = [];

/* ---------------------------------------------------------------- the copied wallet's read */

const solPer = (tower) => tower.price / SOL.price;
const leg = (n, side, tower, sol, agoS) => {
  const tokens = sol / solPer(tower);
  return { signature: `${n}`.padEnd(88, "k"), slot: 383_000_000 - agoS, at: S - agoS, side, mint: tower.id, symbol: tower.symbol, icon: tower.icon ?? null, tokensRaw: String(Math.round(tokens * 1e6)), decimals: 6, quote: "SOL", quoteAmount: sol, paidBy: null };
};
const TRADES = [leg(1, "buy", JUP, 2.4, 40 * 60), leg(2, "sell", MET, 3.1, 3 * 3_600), leg(3, "buy", MET, 1.2, 9 * 3_600), leg(4, "buy", JUP, 0.8, 20 * 3_600), leg(5, "sell", JUP, 1.9, 30 * 3_600), leg(6, "buy", MET, 2.0, 41 * 3_600)];
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

/* ---------------------------------------------------------------- her copies: on paper, and with money */

const PAPER = [
  {
    leader: OTHER,
    name: null,
    since: new Date(NOW - 2 * 86_400_000).toISOString(),
    sizeSol: 0.25,
    slippagePct: 5,
    agent: { perDaySol: 1, perTradeSol: 0.25, days: 7, sharePct: 25, endsAt: new Date(NOW + 5 * 86_400_000).toISOString(), todaySol: 0.5, ended: false },
    summary: { spentSol: 1.26, receivedSol: 0.31, heldSol: 0.97, unpriced: 0, resultSol: 0.021, pct: 1.7, feesSol: 0.014, filled: 6, missed: 2 },
    positions: [],
    fills: [],
  },
];
const moneyRow = (over) => ({ policy: POLICY, leader: THIRD, status: "working", frozen: false, since: new Date(NOW - 3 * 86_400_000).toISOString(), endsAt: new Date(NOW + 27 * 86_400_000).toISOString(), ended: false, perDaySol: 2, perTradeSol: 0.5, todaySol: 1, sharePct: 25, boundPct: 5, coins: 4, bought: 7, sold: 3, missed: 2, ...over });

/** An unsigned transaction of hers alone that calls her smart account — the shape the door's review answers with. */
const SSA = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const wireOf = () =>
  Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(OWNER), recentBlockhash: "11111111111111111111111111111111", instructions: [new TransactionInstruction({ programId: SSA, keys: [], data: Buffer.from([1]) })] }).compileToV0Message()).serialize()).toString("base64");

/* ---------------------------------------------------------------- the test wallet */

function walletScript({ owner, name }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    if (name) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
  } catch {}
  if (!name) return;
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
  /* «Signs» by filling the signature's bytes: no key exists; the relay that would send them is recorded. */
  const fill = async (...inputs) => {
    asked.push(`signTransaction×${inputs.length}`);
    return inputs.map(({ transaction }) => {
      const signed = new Uint8Array(transaction);
      signed.fill(7, 1, 65);
      return { signedTransaction: signed };
    });
  };
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
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: fill },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: refuse("signAndSendTransaction") },
      "solana:signMessage": { version: "1.0.0", signMessage: refuse("signMessage") },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });

async function engine(context, state) {
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
    /* Her copies with money read whatever the switch. */
    if (pathname === "/api/wallet-watch/copy") return json(route, { ok: true, address: OWNER, money: MONEY === "open", copies: PAPER, moneyCopies: state.money });
    /* The money door: closed answers MONEY_CLOSED to a start, as the server does without the switch — never to her way out. */
    if (pathname.startsWith("/api/wallet-watch/copy/money/")) {
      const verb = pathname.replace("/api/wallet-watch/copy/money/", "");
      if (MONEY !== "open" && !["stop", "stop/send", "freeze"].includes(verb)) return json(route, { error: { code: "MONEY_CLOSED", message: "Copying with money is closed." } }, 403);
      const body = JSON.parse(request.postData() ?? "{}");
      state.calls.push(verb);
      if (verb === "review") return json(route, { network: "mainnet", review: "a".repeat(32), policy: POLICY, transactions: [wireOf(), wireOf(), wireOf()], perDay: String(Math.round(body.perDaySol * 1e9)), perTrade: String((BigInt(Math.round(body.perDaySol * 1e9)) * BigInt(body.sharePct)) / 100n), fundLamports: String(BigInt(Math.round(body.perDaySol * 1e9)) * BigInt(body.days)), worstLamports: String(BigInt(Math.round(body.perDaySol * 1e9)) * 3n), coins: [JUP.id, MET.id], skipped: [] });
      if (verb === "start") {
        state.money = [moneyRow({ policy: fresh(), leader: LEADER, since: new Date(NOW).toISOString(), perDaySol: 1, perTradeSol: 0.25, todaySol: 0, coins: 2, bought: 0, sold: 0, missed: 0 }), ...state.money];
        return json(route, { network: "mainnet", copy: state.money[0] });
      }
      if (verb === "stop") return json(route, { network: "mainnet", transactions: [wireOf(), wireOf(), wireOf()], skipped: [{ mint: STUCK, reason: "its issuer froze it in your vault" }], left: 0, unclosed: 0 });
      if (verb === "stop/send") {
        /* The coin her issuer froze stays in her vault: «the rest» kept on her row. */
        state.money = state.money.map((row) => (row.policy === body.policy ? { ...row, status: row.status === "pending" ? "pending" : "stopped", frozen: true, rest: true } : row));
        return json(route, { network: "mainnet", signatures: ["s1", "s2", "s3"], failed: 0, stopped: true, rest: true });
      }
      if (verb === "freeze") {
        state.money = state.money.map((row) => (row.policy === body.policy ? { ...row, frozen: body.frozen } : row));
        return json(route, { network: "mainnet", frozen: body.frozen });
      }
    }
    if (pathname === "/api/solana/holdings") return json(route, { owner: OWNER, sol: 3.2, tokens: [] });
    return json(route, {}, 503);
  });
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const state = {
      calls: [],
      money: [
        /* A start that landed in part — listed as unfinished. */
        moneyRow({ policy: PENDING_POLICY, leader: fresh(), status: "pending", review: "b".repeat(32), since: new Date(NOW - 20 * 60_000).toISOString(), todaySol: 0, bought: 0, sold: 0, missed: 0, coins: 2, perDaySol: 1, perTradeSol: 0.25 }),
        moneyRow({}),
        moneyRow({ policy: FROZEN_POLICY, leader: fresh(), frozen: true, todaySol: 0, bought: 2, sold: 2, missed: 0, coins: 2, perDaySol: 0.5, perTradeSol: 0.125 }),
      ],
    };
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US", reducedMotion: "reduce" });
    await engine(context, state);
    await context.addInitScript(walletScript, { owner: OWNER, name: WALLET });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
    const shot = async (name, mark, gap = 96) => {
      await page.waitForTimeout(500);
      const file = path.join(out, `${MONEY}-${name}-${size.name}-${lang}.jpg`);
      if (size.mobile && mark) {
        const box = page.locator(mark).first();
        await box.evaluate((el, above) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - above), gap);
        await page.waitForTimeout(400);
        await page.screenshot({ path: file, quality: 84, type: "jpeg" });
      } else {
        /* A desk's whole page from its top: the rail and the header stand where a person sees them. */
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await page.screenshot({ path: file, quality: 84, type: "jpeg", fullPage: !size.mobile });
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) report.push(`${MONEY} ${size.name}/${lang} ${name}: the page scrolls sideways`);
    };
    await page.goto(`${base}/bots/copy?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page.waitForSelector("[data-bot='copy'] [data-copy-start]", { timeout: 300_000 });
    await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
    await page.waitForTimeout(1400);
    /* A field filled before the page woke up is wiped by it: filled again until the wallet reads. */
    for (let tries = 0; tries < 3; tries += 1) {
      await page.locator("[data-copy-address] input").first().fill(LEADER);
      if (await page.waitForSelector("[data-copy-leader]", { timeout: 20_000 }).then(() => true, () => false)) break;
    }
    await page.waitForTimeout(1200);
    report.push(`${MONEY} ${size.name}/${lang}: money «${await said("[data-copy-money]")}» (${await page.locator("[data-copy-money]").first().getAttribute("data-copy-money")}), worst «${await said("[data-copy-worst]")}»`);
    await shot("form", "[data-copy-money]", 420);
    /* Her copies with money whatever the switch — «Stop» always, «Freeze» and «Finish» only while open. */
    await shot("mine", "[data-bot-mine]");
    report.push(`${MONEY} ${size.name}/${lang} mine: ${JSON.stringify(await page.locator("[data-copy-money-act]").evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => `${el.getAttribute("data-copy-money-act")}:${el.textContent.trim()}`)))}`);
    if (MONEY === "open") {
      /* «Start with money»: the review, one signature, the copy — one line says so. */
      await page.locator("[data-copy-start-money]").first().click();
      await page.waitForTimeout(1500);
      report.push(`${MONEY} ${size.name}/${lang} started: «${await said("[data-bot-form] [role='status']:not(:empty)")}»`);
      await shot("started", "[data-copy-money]", 420);
      /* «Stop» on the frozen copy: one signature; the coin that stays in her vault named with its reason. */
    }
    /* «Stop» on the frozen copy — whatever the switch: one signature; the coin that stays in her vault named with its reason. */
    const frozenCopy = size.mobile ? page.locator(`[data-bot-mine] article`).filter({ hasText: /Frozen|Заморожено/ }) : page.locator(`[data-bot-mine] [role='row']`).filter({ hasText: /Frozen|Заморожено/ });
    await frozenCopy.locator("[data-copy-money-act='stop']").first().click();
    await page.waitForTimeout(1500);
    report.push(`${MONEY} ${size.name}/${lang} stopped: «${await said("[data-copy-stop-note]")}»`);
    await shot("stopped", "[data-copy-stop-note]:visible");
    report.push(`${MONEY} ${size.name}/${lang}: the routes asked — ${JSON.stringify(state.calls)}; the wallet — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
    /* A reload: the note is gone — her row still offers «Take the rest». */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-copy-money-act='rest']:visible", { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    report.push(`${MONEY} ${size.name}/${lang} after a reload: ${JSON.stringify(await page.locator("[data-copy-money-act='rest']").evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => el.textContent.trim())))}`);
    await shot("rest", "[data-copy-money-act='rest']:visible", 360);
    if (errors.length) report.push(`${MONEY} ${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, `report-${MONEY}.txt`), `${report.join("\n")}\n`);
console.log(report.join("\n"));
