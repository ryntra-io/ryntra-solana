// «Watch» and a wallet's own page for the eyes, at 1920×1080, 1440×900 and 390×844, in English and Ukrainian →
// <out>/<state>-<size>-<lang>.jpg, and <out>/report.txt.
//   node terminal/watch/shots.mjs [out] [baseUrl]
// A stand with the terminal on (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). Chromium draws the page (PRESS_CHROME may point at
// another). SIZES=wide,desk,phone, LANGS=en,uk and ONLY=<shot,shot> narrow a run.
//
// Every read answers from recorded responses in the engine's own shapes: a wallet's read (`/api/wallet-watch/wallet`,
// built by the engine's own `walletView` from a fake chain), its holdings (`/api/v1/portfolio`), the list kept with a
// wallet (`/api/wallet-watch`), the alerts (`/api/v1/assistant/watches`), a coin's market (`/api/spot/market`). Any
// other call answers 503. The stand wallet connects and refuses every signature. Nothing is sent.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createMemoryGuardStore } from "../../lib/guard/store.ts";
import { walletView } from "../../lib/wallet-watch/read.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/watch");
const base = process.argv[3] ?? "http://localhost:3349";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const WHALE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FUND = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EARLY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const KITE = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// A coin no market prices, and two wallets more: one whose trades are not all priced (defect 91 of the eyes' pass 20.11), one
// whose read falls (defect 95).
const NOPE = "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN";
const DEGEN = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK";
const UNREAD = "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH";
const LAMPORTS = 1_000_000_000;

const FACTS = new Map([
  [JUP, { symbol: "JUP", name: "Jupiter", icon: null, priceUsd: 0.52, creator: null, createdAt: null, liquidityUsd: 40_000_000 }],
  [MET, { symbol: "MET", name: "Meteora", icon: null, priceUsd: 0.61, creator: null, createdAt: null, liquidityUsd: 9_000_000 }],
  [KITE, { symbol: "KITE", name: "Kite", icon: null, priceUsd: 0.00042, creator: FUND, createdAt: Date.now() / 1000 - 3 * 86_400, liquidityUsd: 260_000 }],
  [SOL, { symbol: "SOL", name: "Solana", icon: null, priceUsd: 142, creator: null, createdAt: null, liquidityUsd: null }],
]);
const facts = async (mints) => new Map(mints.filter((mint) => FACTS.has(mint)).map((mint) => [mint, FACTS.get(mint)]));

function tx(wallet, { sig, slot, at, sol = 0, tokens = [], fee = 5_000 }) {
  const pre = [10 * LAMPORTS];
  const post = [10 * LAMPORTS + Math.round(sol * LAMPORTS) - fee];
  const preTok = [];
  const postTok = [];
  tokens.forEach(([mint, before, after, decimals = 6], index) => {
    preTok.push({ accountIndex: 10 + index, mint, owner: wallet, uiTokenAmount: { amount: String(before), decimals } });
    postTok.push({ accountIndex: 10 + index, mint, owner: wallet, uiTokenAmount: { amount: String(after), decimals } });
  });
  return { slot, blockTime: at, meta: { err: null, fee, preBalances: pre, postBalances: post, preTokenBalances: preTok, postTokenBalances: postTok }, transaction: { signatures: [sig], message: { accountKeys: [{ pubkey: wallet, signer: true }] } } };
}

/** A wallet's history as the chain would give it: buys and sales of real coins at their prices, minutes to hours apart. */
function history(wallet, seed) {
  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  const coins = [JUP, MET, KITE];
  const held = { [JUP]: 0, [MET]: 0, [KITE]: 0 };
  for (let i = 0; i < 9; i += 1) {
    const mint = coins[(i + seed) % 3];
    const price = FACTS.get(mint).priceUsd;
    const buy = i % 3 !== 2 || held[mint] === 0;
    const before = held[mint];
    let sol;
    let after;
    if (buy) {
      sol = -(0.4 + ((i * 7 + seed * 3) % 10) / 4);
      after = before + Math.round(((-sol * 142) / (price * (0.85 + ((i + seed) % 4) * 0.08))) * 1e6);
    } else {
      after = Math.floor(before / 2);
      sol = (((before - after) / 1e6) * price * (0.9 + ((i + seed) % 5) * 0.1)) / 142;
    }
    held[mint] = after;
    rows.push({ sig: `${wallet.slice(0, 6)}${seed}${i}x`, slot: 1_000 + i, at: now - (9 - i) * (seed + 1) * 2_400 - seed * 90, sol, tokens: [[mint, before, after]] });
  }
  return rows;
}

function chainOf(wallet, rows) {
  return {
    async signatures(_address, options) {
      return { rows: rows.slice().sort((a, b) => b.slot - a.slot).slice(0, options.limit).map((row) => ({ signature: row.sig, slot: row.slot, blockTime: row.at, failed: false })), whole: true };
    },
    async transaction(signature) {
      const row = rows.find((one) => one.sig === signature);
      return row ? tx(wallet, row) : null;
    },
    async holdings() {
      return null;
    },
  };
}

/**
 * A wallet whose result is not all priced: JUP and MET at a loss, KITE sold that was bought before the read, a coin no
 * market prices, and two trades paid in USDC — the engine calls no result, the page shows what is known and the share.
 */
function partial() {
  const now = Math.floor(Date.now() / 1000);
  return [
    { sig: "dg1x", slot: 1, at: now - 9 * 3_600, sol: -6, tokens: [[JUP, 0, 1_200_000_000]] },
    { sig: "dg2x", slot: 2, at: now - 8 * 3_600, sol: -4, tokens: [[MET, 0, 700_000_000]] },
    { sig: "dg3x", slot: 3, at: now - 7 * 3_600, sol: 1.1, tokens: [[MET, 700_000_000, 350_000_000]] },
    { sig: "dg4x", slot: 4, at: now - 6 * 3_600, sol: 1.9, tokens: [[KITE, 900_000_000_000, 0]] },
    { sig: "dg5x", slot: 5, at: now - 5 * 3_600, sol: -3.5, tokens: [[NOPE, 0, 5_000_000_000]] },
    { sig: "dg6x", slot: 6, at: now - 2 * 3_600, sol: 0, tokens: [[USDC, 165_000_000, 0], [JUP, 1_200_000_000, 1_500_000_000]] },
    { sig: "dg7x", slot: 7, at: now - 1_800, sol: 0, tokens: [[USDC, 0, 48_500_000], [MET, 350_000_000, 270_000_000]] },
  ];
}

const VIEWS = new Map();
for (const [wallet, rows] of [[WHALE, history(WHALE, 0)], [FUND, history(FUND, 1)], [EARLY, history(EARLY, 2)], [DEGEN, partial()]]) {
  VIEWS.set(wallet, await walletView(createMemoryGuardStore(), chainOf(wallet, rows), facts, wallet, { nowMs: Date.now(), freshMs: 0, maxNew: 40 }));
}

const PORTFOLIO = (owner) => ({
  network: "mainnet",
  owner,
  at: new Date().toISOString(),
  solUsd: 142,
  totals: { usd: 18_420, sol: 129.7, earnedUsd: 0, projectedUsd: 0, complete: true },
  positions: [
    { id: "coin:sol", protocol: "wallet", platform: null, kind: "coin", state: "read", origin: "chain", label: null, value: { usd: 9_940, sol: 70 }, earned: null, tokens: [{ mint: SOL, symbol: "SOL", decimals: 9, amountRaw: "70000000000", usd: 9_940, role: "held" }] },
    { id: "pool:jup", protocol: "meteora-dlmm", platform: "Meteora", kind: "pool", state: "read", origin: "chain", label: "JUP–SOL", value: { usd: 4_100, sol: 28.9 }, earned: null, tokens: [] },
    { id: "coin:jup", protocol: "wallet", platform: null, kind: "coin", state: "read", origin: "chain", label: null, value: { usd: 6_240, sol: 44 }, earned: null, tokens: [{ mint: JUP, symbol: "JUP", decimals: 6, amountRaw: "12000000000", usd: 6_240, role: "held" }] },
    { id: "coin:kite", protocol: "wallet", platform: null, kind: "coin", state: "read", origin: "chain", label: null, value: { usd: 1_008, sol: 7.1 }, earned: null, tokens: [{ mint: KITE, symbol: "KITE", decimals: 6, amountRaw: "2400000000000", usd: 1_008, role: "held" }] },
  ],
  sources: [],
});

const MARKET = (mint) => {
  const fact = FACTS.get(mint);
  return fact ? { market: { mint, symbol: fact.symbol, name: fact.name, icon: null, price: fact.priceUsd, marketCapUsd: mint === KITE ? 420_000 : mint === JUP ? 1_560_000_000 : 300_000_000 } } : { market: null };
};

const ALERTS = {
  watches: [
    { id: "wch_aaaaaaaaaaaaaaaaaaaaaaaa", version: 1, mint: KITE, symbol: "KITE", rule: { kind: "price", direction: "above", level: 0.0006 }, ruleText: "Price above $0.0006", status: "active", cooldownMinutes: 60, channels: { telegram: true, push: true }, now: { state: "armed", text: "$0.00042", source: "Jupiter", observedAt: new Date().toISOString() }, last: null, explain: null, createdAt: new Date(Date.now() - 3_600_000).toISOString(), updatedAt: new Date().toISOString() },
    { id: "wch_bbbbbbbbbbbbbbbbbbbbbbbb", version: 1, mint: JUP, symbol: "JUP", rule: { kind: "price", direction: "below", level: 0.45 }, ruleText: "Price below $0.45", status: "active", cooldownMinutes: 60, channels: { telegram: true, push: true }, now: { state: "rang", text: "$0.52", source: "Jupiter", observedAt: new Date().toISOString() }, last: null, explain: null, createdAt: new Date(Date.now() - 7_200_000).toISOString(), updatedAt: new Date().toISOString() },
  ],
  limit: { free: 3, used: 2, left: 1 },
  presets: [],
  explainPriceCredits: 0,
  channels: { inbox: true, telegram: true, push: false },
  deliveriesPerHour: 20,
};

const LOCAL = [
  { address: WHALE, name: "Whale", since: new Date().toISOString() },
  { address: FUND, name: null, since: new Date().toISOString() },
  { address: EARLY, name: "Early bird", since: new Date().toISOString() },
];

const chrome = process.env.PRESS_CHROME;
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const SIZES = [
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US", timezoneId: "Europe/Kyiv" });
    let proven = false;
    await context.route("**/api/**", (route) => json(route, {}, 503));
    await context.route("**/api/icon/**", (route) => {
      const mint = new URL(route.request().url()).pathname.split("/").pop();
      if (mint === SOL) return route.fulfill({ path: "public/site/universe/SOL.png", contentType: "image/png" });
      return route.fulfill({ status: 204, body: "" });
    });
    await context.route("**/api/spot/icon*", (route) => route.fulfill({ status: 204, body: "" }));
    await context.route("**/api/wallet-watch/wallet?*", (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      if (q === KITE) return json(route, { ok: true, token: { mint: KITE, symbol: "KITE", creator: FUND }, view: VIEWS.get(FUND) });
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q ?? "")) return json(route, { error: "bad request", code: "NOT_AN_ADDRESS" }, 400);
      const view = VIEWS.get(q);
      return view ? json(route, { ok: true, token: null, view }) : json(route, { error: "unavailable", code: "CHAIN_UNREAD" }, 503);
    });
    await context.route("**/api/wallet-watch?*", (route) => (proven ? json(route, { ok: true, address: OWNER, wallets: LOCAL.map((row) => ({ ...row, alerts: "all", via: null, lastTrade: null, trades24h: 3, readAt: null })) }) : json(route, { error: "proof required", proof: false }, 401)));
    await context.route("**/api/v1/portfolio?*", (route) => {
      const owner = new URL(route.request().url()).searchParams.get("owner");
      return owner === UNREAD ? json(route, { error: "unavailable" }, 503) : json(route, PORTFOLIO(owner));
    });
    await context.route("**/api/spot/market?*", (route) => json(route, MARKET(new URL(route.request().url()).searchParams.get("mint"))));
    await context.route("**/api/v1/assistant/watches*", (route) => (proven ? json(route, ALERTS) : json(route, { error: { code: "UNAUTHORIZED", message: "No proven wallet." } }, 401)));
    await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: proven ? { address: OWNER, via: "proof", expiresAt: new Date(Date.now() + 86_400_000).toISOString() } : null, at: Date.now() }));

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|503|401|404/.test(message.text())) errors.push(message.text().slice(0, 160));
    });
    // A stub wallet in the Wallet Standard registry: it connects, and refuses every signature.
    await page.addInitScript(({ address }) => {
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
      const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const refuse = () => Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 }));
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: refuse },
          "solana:signMessage": { version: "1.0.0", signMessage: refuse },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { address: OWNER });

    const file = (name) => path.join(out, `${name}-${size.name}-${lang}.jpg`);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const ambers = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("main button, main a")]
          .filter((el) => el.offsetParent !== null && getComputedStyle(el).clipPath !== "none" && getComputedStyle(el).clipPath !== "")
          .map((el) => el.textContent.trim()),
      );
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    const shot = async (name, { full = false } = {}) => {
      if (ONLY && !ONLY.has(name)) return;
      await page.waitForTimeout(500);
      await page.screenshot({ path: file(name), quality: 84, type: "jpeg", fullPage: full });
      report.push(`${size.name}/${lang} ${name}: amber ${JSON.stringify(await ambers())}; overflow ${await overflow()}px${errors.length ? `; errors ${JSON.stringify(errors)}` : ""}`);
      errors.length = 0;
    };
    const open = async (address, { list = null, wallet = false } = {}) => {
      await page.goto(`${base}/watch?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 }).catch(() => {});
      await page.evaluate(({ list, wallet }) => {
        try {
          if (list) localStorage.setItem("ryntra.watch.wallets.v1", JSON.stringify(list));
          else localStorage.removeItem("ryntra.watch.wallets.v1");
          if (wallet) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
          else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
        } catch {}
      }, { list, wallet });
      await page.goto(`${base}${address}${address.includes("?") ? "&" : "?"}lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 240_000 });
      await page.waitForSelector("main h1", { timeout: 240_000 });
      await settle();
      await page.waitForTimeout(wallet ? 3500 : 2500);
    };

    // ── «Watch» with nothing watched: one field, one press ──
    proven = false;
    await open("/watch");
    await shot("watch-empty");
    // ── a text that is no address ──
    await page.locator("main input[type='search']").first().fill("not a wallet");
    await page.locator("main form button[type='submit']").first().click();
    await page.waitForTimeout(400);
    await shot("watch-bad");
    // ── three wallets in the browser: their trades, the list beside ──
    await open("/watch", { list: LOCAL });
    await page.waitForTimeout(4000);
    await shot("watch-feed");
    if (!size.mobile) await shot("watch-feed-full", { full: true });
    else await shot("watch-feed-full", { full: true });
    // ── the alerts without a wallet ──
    await open("/watch?tab=alerts");
    await shot("alerts-connect");
    // ── the alerts with a wallet whose proof is here ──
    proven = true;
    await open("/watch?tab=alerts", { wallet: true });
    await shot("alerts");
    await page.locator("main input[type='search']").first().fill("jup");
    await page.waitForTimeout(400);
    await shot("alerts-pick");
    await page.getByRole("button", { name: /JUP/ }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByRole("radio", { name: uk ? "Капіталізація" : "Market cap" }).click().catch(() => {});
    await page.locator("main input[inputmode='decimal']").first().fill("2000000000");
    await page.waitForTimeout(400);
    await shot("alerts-filled");
    // ── a wallet's own page ──
    proven = false;
    await open(`/wallet/${WHALE}`, { list: LOCAL });
    await page.waitForTimeout(3000);
    await shot("wallet");
    await shot("wallet-full", { full: true });
    // ── scrolled down its trades: on a desk what it holds stays beside them; on a phone it stood before them ──
    await page.evaluate(() => window.scrollTo(0, 720));
    await page.waitForTimeout(400);
    await shot("wallet-scrolled");
    await page.evaluate(() => window.scrollTo(0, 0));
    await open(`/wallet/${FUND}`, { list: LOCAL });
    await page.waitForTimeout(3000);
    await shot("wallet-unnamed");
    // ── not all of its trades priced: what is known, and the share priced beside it ──
    await open(`/wallet/${DEGEN}`);
    await page.waitForTimeout(3000);
    await shot("wallet-partial");
    await page.getByRole("button", { name: uk ? "Як рахуємо результат" : "How the result is counted" }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await shot("wallet-partial-info");
    await shot("wallet-partial-full", { full: true });
    // ── the wallet's read falls, and what it holds too: one line, one «Try again» ──
    await open(`/wallet/${UNREAD}`);
    await page.waitForTimeout(3000);
    await shot("wallet-unread");
    // ── a wallet nobody here watches yet: «Watch» is the page's one action ──
    await open(`/wallet/${EARLY}`);
    await page.waitForTimeout(3000);
    await shot("wallet-new");
    await open(`/wallet/${KITE}`);
    await shot("wallet-coin");
    await open("/wallet/not-a-wallet");
    await shot("wallet-bad");
    if (errors.length) report.push(`${size.name}/${lang}: page errors ${JSON.stringify(errors.slice(0, 3))}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
