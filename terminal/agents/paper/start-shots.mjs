// The start of a paper week for the eyes, now that a start is the proven wallet's: a desk at 1440×900 and a
// phone at 390×844, English and Ukrainian → <out>/*.jpg, with a report of what each screen said and what the wallet was
// asked.
//   node terminal/agents/paper/start-shots.mjs <out> [baseUrl]          SIZES=desk,phone  LANGS=en,uk  STATES=sign,…
// The stand runs as `./shots.mjs` says (the terminal's switch, the bots' switches as production has them, paper open):
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet
//   NEXT_PUBLIC_RYNTRA_AGENT_PAPER=open next dev -p 3303
// Every answer is a recorded one: the market is the bundled snapshot, the history the review's sample, the session says no
// wallet is proven yet, the sign-in text is a sample of Ryntra's own, and the paper week is the paper engine's own output
// (lib/mandate/paper/step.server.ts). A test wallet of the page's own answers the browser's wallet standard: it connects,
// refuses every transaction, and — per state — leaves the one message unanswered (the wallet's window is open), refuses
// it, or signs it. Without a wallet the card's one action is «Connect wallet» and the practice waits for a budget, as
// before — no state of the start's own.
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

const out = path.resolve(process.argv[2] ?? "docs/shots/city-296b");
const base = process.argv[3] ?? "http://localhost:3303";
mkdirSync(out, { recursive: true });

const ALL_SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const list = (name, fallback) => (process.env[name] ? process.env[name].split(",").filter(Boolean) : fallback);
const SIZES = ALL_SIZES.filter((size) => list("SIZES", ALL_SIZES.map((s) => s.name)).includes(size.name));
const LANGS = list("LANGS", ["en", "uk"]);
const STATES = list("STATES", ["sign", "sign-why", "declined", "started", "limited"]);

const coin = (symbol) => SNAPSHOT.towers.find((tower) => tower.symbol === symbol && tower.verified);
const SOLT = coin("SOL");
const JUP = coin("JUP");
const NOW = Date.now();
const HOUR = 3_600_000;
const OWNER = Keypair.generate().publicKey.toBase58();
const WALLET = "Stand Wallet";
const HOLDINGS = { data: { holdings: [{ kind: "NATIVE_SOL", mint: null, spendableRaw: "48250000000", decimals: 9 }], tokenRead: "COMPLETE" } };
const report = [];

/* ---------------------------------------------------------------- the first minutes of a paper week, by the paper engine */

const lamportsPerJup = (JUP.price / SOLT.price) * 1e9;
async function freshWeek() {
  const start = NOW - 4 * 60_000;
  const reads = {
    buy: async (lamports) => BigInt(Math.floor((Number(lamports) * 1e6 * 0.998) / lamportsPerJup)),
    worth: async (coins) => BigInt(Math.floor((Number(coins) * lamportsPerJup * 0.998) / 1e6)),
    fees: async () => ({ buyBps: 10, sellBps: 10 }),
  };
  const agent = {
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
  return viewOf((await paperStep(agent, reads, start)).agent, NOW);
}
const STARTED = await freshWeek();
report.push(`paper week just started: day ${STARTED.day} of ${STARTED.weekDays}, ${STARTED.trades} paper trade(s), status ${STARTED.status}`);

const bars = sampleBars(JUP.id, JUP.price, JUP.change24h, Math.floor(NOW / HOUR) * HOUR);
const HISTORY = { result: runPlan(STEADY, bars, { perTrade: 0.1, perDay: 0.5, days: 30 }, { barMs: HOUR }) };

/* ---------------------------------------------------------------- the page's world */

/** `sign`: what the wallet does with the one message — `hang` (its window stays open), `refuse`, or `sign`. */
function walletScript({ owner, name, sign }) {
  const asked = [];
  window.__standAsked = asked;
  try {
    localStorage.removeItem("ryntra.paper-week.key");
    if (name) localStorage.setItem("ryntra.solana.wallet-hint.v1", name);
  } catch {}
  if (!name) return;
  const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: name };
  const refuse = (what) => async () => {
    asked.push(what);
    throw new Error("User rejected the request.");
  };
  const signMessage = async ({ message }) => {
    asked.push("signMessage");
    if (sign === "hang") return new Promise(() => {});
    if (sign === "refuse") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    return [{ signedMessage: message, signature: new Uint8Array(64).fill(7) }];
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
      "solana:signMessage": { version: "1.0.0", signMessage },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (event) => register(event.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}

const json = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
const JUP_ICON = path.resolve("public/site/universe/JUP.png");
const SIGN_IN_TEXT = (address) => `ryntra.io wants you to sign in with your Solana account:\n${address}\n\nSign in to Ryntra. This request will not trigger a blockchain transaction or cost any fees.\n\nURI: https://ryntra.io\nVersion: 1\nChain ID: mainnet\nNonce: standnonce0001\nIssued At: ${new Date(NOW).toISOString()}`;

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
    /* No wallet proven in this browser yet: the start asks the one signature. */
    if (pathname === "/api/auth/solana/session" && request.method() === "GET") return json(route, { signedIn: false, walletAddress: null, proof: null, checking: false, at: NOW });
    if (pathname === "/api/auth/solana" && request.method() === "GET") {
      const address = url.searchParams.get("address") ?? OWNER;
      report.push(`  the sign-in text was asked: action ${url.searchParams.get("action")}`);
      return json(route, { input: { domain: "ryntra.io", address, statement: "Sign in to Ryntra.", uri: "https://ryntra.io", version: "1", chainId: "mainnet", nonce: "standnonce0001", issuedAt: new Date(NOW).toISOString() }, message: SIGN_IN_TEXT(address) });
    }
    if (pathname === "/api/auth/solana" && request.method() === "POST") {
      report.push("  the signed message went to the server");
      return json(route, { ok: true, expiresAt: new Date(NOW + HOUR).toISOString() });
    }
    if (pathname === "/api/bots/mandate/paper") {
      const posted = request.method() === "POST" ? request.postData() ?? "" : "";
      report.push(`  the paper route was asked: ${request.method()}${posted ? ` ${posted.replace(OWNER, "<owner>")}` : ""}`);
      return paper(route, request);
    }
    return json(route, {}, 503);
  });
}

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || "/opt/pw-browsers/chromium" });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const run = async (state, { wallet, sign, paper }, steps) => {
      if (!STATES.includes(state)) return;
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        locale: lang === "uk" ? "uk-UA" : "en-US",
        reducedMotion: "reduce",
      });
      await world(context, paper);
      await context.addInitScript(walletScript, { owner: OWNER, name: wallet ? WALLET : null, sign });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() !== "error" || message.text().startsWith("Failed to load resource")) return;
        const known = /didn't match the client properties/u.test(message.text()) && /id="_R_/u.test(message.text());
        errors.push(known ? "console: the stand's known hydration warning (useId of the frame, present on master too)" : `console: ${message.text().slice(0, 300)}`);
      });
      await page.goto(`${base}/bots/recurring?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 600_000 });
      await page.waitForSelector("[data-bot='recurring'] [data-agent-practice]", { timeout: 600_000 });
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      if (wallet) await page.waitForSelector("[data-bot='recurring'] [data-agent-give]", { timeout: 60_000 }).catch(() => {});
      /* The person's day, then «Practice first». */
      const day = page.locator("[data-bot='recurring'] input").first();
      await day.fill(lang === "uk" ? "0,5" : "0.5");
      await page.waitForSelector("[data-agent-practice]:not([disabled])", { timeout: 60_000 }).catch(() => report.push(`${size.name}/${lang} ${state}: the practice stayed disabled`));
      await page.locator("[data-agent-practice]").first().click({ timeout: 30_000 }).catch(() => report.push(`${size.name}/${lang} ${state}: the practice could not be tapped`));
      await steps(page);
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
      await page.waitForTimeout(900);
      const focus = page.locator("[data-paper-note], [data-paper-result]").first();
      if (!size.mobile && (await focus.count())) await focus.evaluate((el) => el.scrollIntoView({ block: "center" }));
      if (size.mobile && (await focus.count())) await focus.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 420));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${state}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
      const said = async (selector) => (await page.locator(selector).first().textContent().catch(() => null))?.trim() ?? "—";
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      report.push(
        `${size.name}/${lang} ${state}: note «${await said("[data-paper-note]")}» (${await page.locator("[data-paper-note]").first().getAttribute("data-paper-note").catch(() => "—")}) · «i» ${await page.locator("[data-paper-note] [data-info]").count()} · card «${await said("[data-paper-result]")}» · ambers ${await page.locator("[data-bot='recurring'] [data-paper-live]:visible, [data-bot='recurring'] [data-agent-connect]:visible, [data-bot='recurring'] [data-agent-give]:visible").count()}${wide ? " · THE PAGE SCROLLS SIDEWAYS" : ""}`,
      );
      report.push(`${size.name}/${lang} ${state}: the wallet was asked — ${JSON.stringify(await page.evaluate(() => window.__standAsked ?? []))}`);
      if (errors.length) report.push(`${size.name}/${lang} ${state}: page errors — ${errors.join(" | ").slice(0, 400)}`);
      await context.close();
    };
    const noWeek = (route, request) => (request.method() === "GET" ? json(route, { paper: null }) : json(route, { error: { code: "UNAUTHORIZED" } }, 401));
    const startsWith = (answer) => (route, request) => (request.method() === "GET" ? json(route, { paper: null }) : answer(route, request));

    // The wallet's window is open for the one message: the line says what is asked, and why stands behind the «i».
    await run("sign", { wallet: true, sign: "hang", paper: noWeek }, async (page) => {
      await page.waitForSelector("[data-paper-note='sign']", { timeout: 30_000 });
    });
    // The «i» opened: why one signature, and what it is not.
    await run("sign-why", { wallet: true, sign: "hang", paper: noWeek }, async (page) => {
      await page.waitForSelector("[data-paper-note='sign'] [data-info]", { timeout: 30_000 });
      await page.locator("[data-paper-note='sign'] [data-info]").first().click();
      await page.waitForSelector("[data-paper-note='sign'] [role=note]", { timeout: 10_000 });
    });
    // She said no in the wallet: nothing signed, nothing asked of paper.
    await run("declined", { wallet: true, sign: "refuse", paper: noWeek }, async (page) => {
      await page.waitForSelector("[data-paper-note='declined']", { timeout: 30_000 });
    });
    // Signed: the start goes, the card is the week on paper at work — and a read by the key the start answered finds it.
    let begun = false;
    const startedWeek = (route, request) => {
      if (request.method() === "GET") return json(route, { paper: begun ? STARTED : null });
      begun = true;
      return json(route, { paper: STARTED, already: false, key: "w".repeat(43) }, 201);
    };
    await run("started", { wallet: true, sign: "sign", paper: startedWeek }, async (page) => {
      await page.waitForSelector("[data-paper-result]", { timeout: 30_000 });
    });
    // This wallet started paper too often lately: said as such.
    await run("limited", { wallet: true, sign: "sign", paper: startsWith((route) => json(route, { error: { code: "PAPER_LIMITED", reason: "wallet" } }, 429)) }, async (page) => {
      await page.waitForSelector("[data-paper-note='limited']", { timeout: 30_000 });
    });
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
