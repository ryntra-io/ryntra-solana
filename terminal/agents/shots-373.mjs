// For the eyes, at 1440×900 and 390×844, in English and Ukrainian → <out>/<state>-<size>-<lang>.jpg
//   node terminal/agents/shots-373.mjs [out] [baseUrl]          SIZES=desk,phone  LANGS=en,uk  ONLY=<scene,scene>
// The stand: the terminal on its stand, Earn, the pools, the agent's budget and its care open as production has them
//   NEXT_PUBLIC_RYNTRA_TERMINAL=stand NEXT_PUBLIC_RYNTRA_CITY_EARN=open NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open
//   NEXT_PUBLIC_RYNTRA_AGENT_CARE=mainnet NEXT_PUBLIC_RYNTRA_CITY_MANDATE=mainnet NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=mainnet
//   NEXT_PUBLIC_RYNTRA_CITY_MONEY=open NEXT_PUBLIC_RYNTRA_CITY_SPOT=open next dev
// Two states:
//   1. a care stopped but not withdrawn — the care's status answers it `stopped` with `left: true`: on the pool's ticket
//      (Earn) it stands as «Stopped — not withdrawn» with «Withdraw»; in the Portfolio's agents as the keeper's row; a tap of
//      «Withdraw» asks the same stop, and the stand wallet says no — the row stays, with its one line;
//   2. a new device: the wallet's agents answer 401 — «Sign once to see your agents» on «My bots» and in the Portfolio; a tap
//      asks the stand wallet for one message (it signs a stand message; no transaction), the proof is accepted, the list is
//      read again and the bot stands.
// Every answer of the engine is a fixture shaped like its routes; the market is the dev server's own read. The stand wallet
// connects silently and refuses every transaction it is asked to sign.
import { chromium } from "playwright";
import { Keypair } from "@solana/web3.js";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { SOL, SOL_USDC, USDC, lstPool } from "../../city/lib/earn/pier-fixtures.mjs";
import { portfolioPnl } from "../../lib/portfolio/pnl.ts";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-373");
const base = process.argv[3] ?? "http://localhost:3373";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.PRESS_CHROME ? { executablePath: process.env.PRESS_CHROME } : {});
const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const POOLS = [SOL_USDC, lstPool()];
const SOL_USD = SOL_USDC.x.priceUsd;
const ALL = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];
const SIZES = process.env.SIZES ? ALL.filter((size) => process.env.SIZES.split(",").includes(size.name)) : ALL;
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];

const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "4240000000", spendableRaw: "4230000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(SOL_USD) } },
  { kind: "SPL", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", usdPrice: "1" } },
];
/** The care stopped on the SOL–USDC pool whose relay of the stop failed: its policy still on chain (`left: true`). */
const LEFT = { key: "c:mainnet:stand:1", pool: SOL_USDC.address, status: "stopped", inRange: null, holdsX: "0", holdsY: "0", day: { claimedInY: 0, reinvestedInY: 0, rebalances: 0 }, stopBelow: null, fees: "reinvest", valueUsd: null, unclaimedUsd: null, left: true };
/** A care stopped long ago, all of it back: it never stands on screen. */
const BACK = { ...LEFT, key: "c:mainnet:stand:0", left: false };

const now = Date.now();
const KEY = (n) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58();
const RECORD = { owner: OWNER, settings: KEY(1), vault: KEY(2), policy: KEY(3), budget: KEY(4), perTrade: "20000000", perDay: "100000000", expiresAt: String(Math.floor(now / 1000) + 27 * 86_400 + 60) };
const AGENTS = { owner: OWNER, networks: { mainnet: { read: true, mandates: [{ record: RECORD, status: "working", budgetLamports: "60000000", live: true, active: true, trades: 3, pilot: false, frozen: false, createdAt: now - 3 * 86_400_000 }], pilot: null, cares: [] }, devnet: { read: true, mandates: [], pilot: null, cares: [] } } };
const DAY = { since: now - 86_400_000, until: now, trades: 3, spentRaw: "40000000", boughtRaw: "1200000000", worthRaw: "95000000", earnedRaw: "55000000", netRaw: "54000000", holdRaw: "21000000" };
const VIEW = { status: "working", strategy: "steady", receiveMint: SOL, symbol: "SOL", everyMs: 4 * 3_600_000, result: { trades: 3, spentRaw: "40000000", boughtRaw: "1200000000", worthRaw: "95000000", earnedRaw: "55000000", multiple: 1.2 }, last: [], mission: { state: "waiting", reason: null, nextAt: now + 3_600_000 }, books: { state: "exact", budgetRaw: "100000000", spentRaw: "40000000", leftRaw: "60000000", pendingRaw: "0", gapRaw: "0" }, updatedAt: now, day: DAY, net: { trades: 3, spentRaw: "40000000", netRaw: "54000000", holdRaw: "21000000", feesRaw: "300000" } };

/** The wallet's portfolio, as `GET /api/v1/portfolio` answers: SOL and USDC in the wallet. */
function portfolio(owner) {
  const at = new Date().toISOString();
  const refs = { program: null, pool: null, position: null, nftMint: null, market: null, account: null };
  const coin = (id, mint, symbol, decimals, units, price) => ({ id, protocol: "wallet", kind: "coin", label: symbol, platform: null, state: "read", origin: "chain", earned: null, inRange: null, refs: { ...refs, program: "11111111111111111111111111111111" }, readAt: at, value: { usd: units * price, sol: (units * price) / SOL_USD }, tokens: [{ mint, symbol, decimals, amountRaw: String(Math.round(units * 10 ** decimals)), usd: units * price, role: "held" }], exit: { oneStep: true, how: "swap", reason: null, partBps: 10_000, untilEpoch: null, untilTime: null } });
  const positions = [coin("wallet:sol", SOL, "SOL", 9, 4.24, SOL_USD), coin(`wallet:${USDC}`, USDC, "USDC", 6, 250, 1)];
  const usd = positions.reduce((sum, p) => sum + p.value.usd, 0);
  return { network: "solana:mainnet", owner, at, solUsd: SOL_USD, totals: { usd, sol: usd / SOL_USD, earnedUsd: 0, projectedUsd: 0, complete: true }, positions, sources: [{ source: "wallet", state: "read", reason: null, readAt: at, positions: 2 }] };
}

const WIRE = Buffer.from(new Uint8Array(1 + 64 + 8).fill(7)).toString("base64");
/** The wallet's result, as `GET /api/portfolio/pnl` answers a wallet with no trade read yet (`portfolioPnl` itself). */
const PNL = { ok: true, pnl: portfolioPnl({ read: { trades: [], held: new Map(), oldestAt: null, complete: true, gap: false, skipped: 0 }, solUsd: SOL_USD, market: new Map(), nowS: Math.floor(now / 1000) }) };

/** An add of SOL alone, as the engine's Review answers it for the pool asked: half swapped, both coins in, one approval. */
function zapReview(body) {
  const pool = POOLS.find((entry) => entry.address === body.request.pool) ?? POOLS[0];
  const amount = BigInt(body.request.amountIn);
  const half = amount / 2n;
  const solIsX = pool.x.mint === SOL;
  const other = solIsX ? pool.y : pool.x;
  const otherPerSol = solIsX ? pool.price : 1 / pool.price;
  const otherUnits = BigInt(Math.floor((Number(half) / 1e9) * otherPerSol * 10 ** other.decimals));
  const solSide = { asset: SOL, units: half.toString(), decimals: 9 };
  const otherSide = { asset: other.mint, units: otherUnits.toString(), decimals: other.decimals };
  const fee = (half * 10n) / 10_000n;
  return {
    preview: {
      action: "zap_in",
      venue: "meteora-dlmm",
      pool: pool.address,
      owner: body.request.owner,
      tokenX: { mint: pool.x.mint, decimals: pool.x.decimals, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      tokenY: { mint: pool.y.mint, decimals: pool.y.decimals, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      amountIn: amount.toString(),
      swap: { route: "jupiter", inMint: SOL, outMint: other.mint, inAmount: half.toString(), expectedOut: otherUnits.toString(), floor: ((otherUnits * 995n) / 1000n).toString(), fee: { bps: 10, amount: fee.toString(), mint: SOL, account: "FeeAcc1111111111111111111111111111111111111" }, labels: ["Meteora DLMM"] },
      deposit: solIsX ? { x: solSide, y: otherSide } : { x: otherSide, y: solSide },
      range: { kind: "bins", lowerBin: -16, upperBin: 16, lowerPrice: String(pool.price * 0.98), upperPrice: String(pool.price * 1.02) },
      otherBefore: "0",
      unwrapLamports: "0",
      fees: [{ who: "ryntra", applies_to: "swap", bps: 10 }],
      rent: [{ what: "position", direction: "pay", lamports: "57000000", refundable: true }],
      transactions: 2,
      notices: [],
      price: String(pool.price),
      at: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
    transactions: [
      { wireBase64: WIRE, presigned: [] },
      { wireBase64: WIRE, presigned: [] },
    ],
    position: "PoSiTion1111111111111111111111111111111111",
    ticket: "ticket-zap",
    expiresAt: Date.now() + 60_000,
    signableMs: 60_000,
    networkFeeLamports: "15000",
    depositUsd: null,
    referenceOut: otherUnits.toString(),
  };
}

async function stage(size, lang, { agents, cares }) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: size.mobile, locale: lang === "uk" ? "uk-UA" : "en-US" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(({ owner }) => {
    // The stand wallet: it connects silently, signs a stand message, and says no to every transaction.
    localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
    window.__asked = { messages: 0, transactions: 0 };
    const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" fill="#AB9FF2"/></svg>')}`;
    const account = { address: owner, publicKey: new Uint8Array(32), chains: ["solana:mainnet", "solana:devnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
    const wallet = {
      version: "1.0.0",
      name: "Phantom",
      icon,
      chains: ["solana:mainnet", "solana:devnet"],
      accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: async (...inputs) => {
            window.__asked.transactions += inputs.length;
            await new Promise((done) => setTimeout(done, 400));
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          },
        },
        "solana:signMessage": {
          version: "1.0.0",
          signMessage: async ({ message }) => {
            window.__asked.messages += 1;
            await new Promise((done) => setTimeout(done, 400));
            return [{ signedMessage: message, signature: new Uint8Array(64).fill(9) }];
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  }, { owner: OWNER });
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const state = { proven: false, asked: [] };
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const at = url.pathname;
    if (at === "/api/city" || at.startsWith("/api/icon/")) return route.fallback();
    if (at === "/api/city/earn/piers") return json(route, 200, { pools: POOLS, at: new Date().toISOString() });
    if (at === "/api/city/earn/piers/admit") return json(route, 200, { add: "on", exit: "on", ceilingUsd: 1000, stopped: false });
    if (at === "/api/solana/holdings") return json(route, 200, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } });
    if (at === "/api/liquidity/positions") return json(route, 200, { owner: OWNER, positions: [], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() });
    if (at === "/api/city/earn/piers/zap") return json(route, 200, zapReview(route.request().postDataJSON()));
    if (at === "/api/portfolio/pnl") return json(route, 200, PNL);
    if (at === "/api/v1/portfolio") return json(route, 200, portfolio(url.searchParams.get("owner") ?? OWNER));
    if (at === "/api/solana/activity") return json(route, 200, { data: { actions: [], complete: true } });
    if (at === "/api/auth/solana/session") return json(route, 200, { signedIn: state.proven, walletAddress: state.proven ? OWNER : null, proof: state.proven ? { address: OWNER, via: "signin", expiresAt: new Date(now + 86_400_000).toISOString() } : null, at: Date.now() });
    if (at === "/api/auth/solana" && method === "GET") {
      const address = url.searchParams.get("address") ?? OWNER;
      return json(route, 200, { input: { domain: url.host, address, statement: "Sign in to Ryntra.", nonce: "stand0000", issuedAt: new Date().toISOString() }, message: `${url.host} wants you to sign in with your Solana account:\n${address}\n\nSign in to Ryntra.` });
    }
    if (at === "/api/auth/solana" && method === "POST") {
      state.proven = true;
      return json(route, 200, { ok: true, expiresAt: new Date(now + 86_400_000).toISOString() });
    }
    if (at === "/api/bots/agents") {
      const answered = agents === "open" || state.proven;
      state.asked.push(answered ? "agents:200" : "agents:401");
      return answered ? json(route, 200, AGENTS) : json(route, 401, { error: { code: "UNAUTHORIZED", message: "No proven wallet: sign in with the wallet first." } });
    }
    if (at.startsWith("/api/bots/mandate/agent")) return json(route, 200, VIEW);
    if (at.startsWith("/api/bots/mandate/status")) return json(route, 200, { active: true, budgetLamports: "60000000" });
    if (at.startsWith("/api/bots/pilot")) return json(route, 404, { error: { code: "NO_PILOT" } });
    if (at === "/api/city/earn/care") {
      const body = route.request().postDataJSON();
      state.asked.push(`care:${body.action}`);
      if (body.action === "status") return json(route, 200, { ok: true, network: "mainnet", cares });
      if (body.action === "stop") return json(route, 200, { ok: true, transactions: [WIRE, WIRE] });
      return json(route, 503, { ok: false });
    }
    return json(route, 503, { error: { code: "UNAVAILABLE" } });
  });
  return { context, page, errors, state };
}

const settle = async (page) => {
  await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 120_000 });
  await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(900);
};
const tap = (size, locator) => (size.mobile ? locator.tap() : locator.click());

async function scene(name, size, lang, setup, run) {
  if (ONLY && !ONLY.has(name)) return;
  const { context, page, errors, state } = await stage(size, lang, setup);
  const shot = async (stateName, block) => {
    if (block) await block.evaluate((node) => node.scrollIntoView({ block: "center" })).catch(() => {});
    // The dev server's own badge is no part of the screen (a production build has none).
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
    await settle(page);
    await page.screenshot({ path: path.join(out, `${stateName}-${size.name}-${lang}.jpg`), quality: 86, type: "jpeg" });
  };
  try {
    await run({ page, shot, state });
    report.push(`${name} ${size.name}/${lang}: ok — asked ${state.asked.join(", ") || "nothing"}; wallet ${JSON.stringify(await page.evaluate(() => window.__asked))}`);
  } catch (error) {
    await page.screenshot({ path: path.join(out, `fail-${name}-${size.name}-${lang}.jpg`), type: "jpeg", quality: 80 }).catch(() => {});
    report.push(`${name} ${size.name}/${lang}: FAILED — ${String(error).slice(0, 300)}`);
  }
  if (errors.length) report.push(`${name} ${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 400)}`);
  await context.close();
}

/** The SOL–USDC pool's ticket: on a desk the side panel, on a phone its sheet. */
async function openPool(page, size) {
  if (size.mobile) {
    await page.waitForSelector("[data-terminal='tabs']", { timeout: 300_000 });
    const row = page.locator("main button:visible").filter({ hasText: /SOL.?USDC|SOL · USDC|·/ }).first();
    await row.waitFor({ timeout: 120_000 });
    await tap(size, row);
    await page.waitForSelector("[data-earn='sheet']", { timeout: 30_000 });
    return page.locator("[data-earn='sheet']");
  }
  await page.waitForSelector("[role='table']", { timeout: 300_000 });
  return page.locator("aside").filter({ has: page.getByRole("switch") });
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const T = lang === "uk" ? { withdraw: "Забрати", show: "Показати моїх агентів" } : { withdraw: "Withdraw", show: "Show my agents" };

    // 1a. The pool's ticket: the care stopped, its policy still on chain — «Stopped — not withdrawn», «Withdraw». A care
    //     all back stands nowhere. «Withdraw» asks the same stop; the wallet says no — the row stays with its one line.
    await scene("pool-left", size, lang, { agents: "open", cares: [LEFT, BACK] }, async ({ page, shot }) => {
      await page.goto(`${base}/earn?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      const where = await openPool(page, size);
      const row = where.locator("[data-earn-cared='left']");
      await row.waitFor({ timeout: 60_000 });
      if ((await where.locator("[data-earn-cared]").count()) !== 1) throw new Error("the care all back stands on screen");
      await shot("pool-left", row);
      await tap(size, row.getByRole("button", { name: T.withdraw }));
      await page.waitForFunction(() => window.__asked.transactions > 0, null, { timeout: 30_000 });
      await where.getByText(lang === "uk" ? "Скасовано в гаманці" : "Cancelled in your wallet").waitFor({ timeout: 30_000 });
      await shot("pool-left-cancelled", row);
    });

    // 1b. The Portfolio: the keeper's row says it, and leads to the pool's page with «Withdraw».
    await scene("portfolio-left", size, lang, { agents: "open", cares: [LEFT, BACK] }, async ({ page, shot }) => {
      await page.goto(`${base}/portfolio?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      const row = page.getByText(lang === "uk" ? "Зупинено — не забрано" : "Stopped — not withdrawn").first();
      await row.waitFor({ timeout: 120_000 });
      await shot("portfolio-left", row);
    });

    // 2a. «My bots» on a new device: the engine says 401 — «Sign once to see your agents»; a tap, one message, the bot stands.
    await scene("bots-sign", size, lang, { agents: "locked", cares: [] }, async ({ page, shot }) => {
      await page.goto(`${base}/bots/recurring?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      const card = page.locator("[data-agents-sign]:visible").first();
      await card.waitFor({ timeout: 120_000 });
      await shot("bots-sign", card);
      await tap(size, page.locator("[data-agents-sign-go]:visible").first());
      await page.waitForFunction(() => window.__asked.messages > 0, null, { timeout: 30_000 });
      await page.locator("[data-agent-stop='trader']:visible").first().waitFor({ timeout: 60_000 });
      if (await page.locator("[data-agents-sign]:visible").count()) throw new Error("the card stays after the list was read");
      await shot("bots-signed", page.locator("[data-agent-stop='trader']:visible").first());
    });

    // 2b. The Portfolio on a new device: the same, where its agents would stand.
    await scene("portfolio-sign", size, lang, { agents: "locked", cares: [] }, async ({ page, shot }) => {
      await page.goto(`${base}/portfolio?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 300_000 });
      const ask = page.getByRole("button", { name: T.show }).first();
      await ask.waitFor({ timeout: 120_000 });
      await shot("portfolio-sign", ask);
    });
  }
}
await browser.close();
console.log(report.join("\n"));
