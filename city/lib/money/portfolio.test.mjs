import { test } from "node:test";
import assert from "node:assert/strict";

import { assetsOf } from "./assets.ts";
import { portfolioView } from "./portfolio.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const ODD = "Odd1111111111111111111111111111111111111111";

const words = {
  inRange: "In range", outOfRange: "Out of range", locked: "Part locked", caring: "Caring", working: "Working", stopped: "Stopped",
  test: "devnet", trades: (n) => `${n} trades`, agent: "Agent", phoenix: "Left on Phoenix", phoenixLine: "Collateral", earned: "earned",
};

const assets = assetsOf([
  { kind: "NATIVE_SOL", mint: null, amountRaw: "2000000000", spendableRaw: "1990000000", decimals: 9, catalog: { usdPrice: "100", dayChangePct: 10 } },
  { kind: "TOKEN", mint: USDC, amountRaw: "50000000", spendableRaw: "50000000", decimals: 6, catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1", dayChangePct: 0 } },
  { kind: "TOKEN", mint: JITO, amountRaw: "1000000000", spendableRaw: "1000000000", decimals: 9, catalog: { symbol: "JitoSOL", isVerified: true, usdPrice: "120" } },
  { kind: "TOKEN", mint: ODD, amountRaw: "5", spendableRaw: "5", decimals: 0, catalog: null },
]);

const base = {
  assets,
  walletState: "ready",
  lend: { state: "ready", rows: [{ asset: "USDC", mint: USDC, decimals: 6, worthRaw: 100_000_000n, earnedRaw: 2_000_000n }] },
  piers: { state: "ready", rows: [{ address: "Pier1111111111111111111111111111111111111111", name: "SOL-USDC", inRange: true, lower: 90, upper: 110, valueUsd: 300, unclaimedUsd: 4.5, lockedBps: 0 }] },
  care: { state: "ready", rows: [] },
  agent: { state: "ready", row: { vaultLamports: 500_000_000n, mainnet: true, working: true, netLamports: 10_000_000n, trades: 3, symbol: "BONK" } },
  orders: { state: "ready", rows: [{ key: "k1", venue: "jupiter-trigger", order: "Ord1", title: "Buy BONK", inputMint: USDC, leftRaw: 20_000_000n, decimals: 6, canCancel: true, pool: false }] },
  phoenix: { state: "ready", usd: 7 },
  words,
};

test("every place is added once: wallet, savings (Lend + LST), pools, agent vault, orders, Phoenix", () => {
  const view = portfolioView(base);
  const usd = Object.fromEntries(view.places.map((p) => [p.kind, p.usd]));
  assert.equal(usd.wallet, 250, "SOL 200 + USDC 50; the LST is not counted in the wallet");
  assert.equal(usd.savings, 220, "Lend 100 USDC + JitoSOL 120");
  assert.equal(usd.pools, 300);
  assert.equal(usd.agents, 50, "0.5 SOL in the vault at $100");
  assert.equal(usd.orders, 20);
  assert.equal(usd.phoenix, 7);
  assert.equal(view.totalUsd, 847);
  const shares = view.bar.reduce((sum, seg) => sum + seg.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);
  assert.deepEqual(view.bar.map((seg) => seg.kind), ["wallet", "savings", "pools", "agents", "orders", "phoenix"]);
});

test("each row carries the action that takes its money out", () => {
  const view = portfolioView(base);
  const actions = Object.fromEntries(view.places.flatMap((p) => p.rows.map((r) => [r.id, r.action?.kind ?? null])));
  assert.equal(actions["lend:USDC"], "lendWithdraw");
  assert.equal(actions[`lst:${JITO}`], "trade");
  assert.equal(actions["pier:Pier1111111111111111111111111111111111111111"], "pier");
  assert.equal(actions["agent:mandate"], "agentStop");
  assert.equal(actions["order:k1"], "cancelOrder");
  assert.equal(actions.phoenix, "phoenix");
});

test("the day's move comes from the coins that carry one, never invented", () => {
  const view = portfolioView(base);
  // SOL is $200 after +10%: it started at 181.82; USDC moved 0.
  assert.ok(Math.abs(view.dayUsd - (200 - 200 / 1.1)) < 1e-9);
  assert.ok(Math.abs(view.dayPct - ((200 - 200 / 1.1) / (200 / 1.1 + 50)) * 100) < 1e-9);
  const still = portfolioView({ ...base, assets: assetsOf([{ kind: "NATIVE_SOL", mint: null, amountRaw: "1", spendableRaw: "1", decimals: 9, catalog: { usdPrice: "100" } }]) });
  assert.equal(still.dayUsd, null);
  assert.equal(still.dayPct, null);
});

test("an unpriced coin and an unread place are «—», never zero, and the total says it may be short", () => {
  const view = portfolioView({ ...base, piers: { state: "failed", rows: [] }, agent: { state: "ready", row: null } });
  const wallet = view.places.find((p) => p.kind === "wallet");
  assert.equal(wallet.unpriced, 1, "the coin without a price is listed, not added");
  assert.equal(wallet.rows.find((r) => r.mint === ODD).usd, null);
  assert.equal(view.places.find((p) => p.kind === "pools").usd, null);
  assert.deepEqual(view.unread, ["pools"]);
  assert.equal(view.totalUsd, 250 + 220 + 20 + 7);
});

test("a devnet agent vault is shown but never added to anyone's money", () => {
  const view = portfolioView({ ...base, agent: { state: "ready", row: { ...base.agent.row, mainnet: false } } });
  const agent = view.places.find((p) => p.kind === "agents");
  assert.equal(agent.rows.length, 1);
  assert.equal(agent.rows[0].usd, null);
  assert.match(agent.rows[0].line, /devnet/);
  assert.equal(view.totalUsd, 797);
});

test("pools show the fees to take; a cared pool is listed with its stop", () => {
  const view = portfolioView({ ...base, care: { state: "ready", rows: [{ key: "care1", pool: "PoolAAAA1111111111111111111111111111111BBBB", name: null, inRange: false }] } });
  const pools = view.places.find((p) => p.kind === "pools");
  assert.equal(pools.rows[0].gainUsd, 4.5);
  assert.equal(pools.rows[1].action.kind, "care");
  assert.match(pools.rows[1].line, /Caring/);
});

test("a wallet with nothing priced has no total and no bar", () => {
  const view = portfolioView({ ...base, assets: assetsOf([{ kind: "TOKEN", mint: BONK, amountRaw: "5", spendableRaw: "5", decimals: 5, catalog: null }]), lend: { state: "off", rows: [] }, piers: { state: "ready", rows: [] }, agent: { state: "ready", row: null }, orders: { state: "ready", rows: [] }, phoenix: { state: "off", usd: null } });
  assert.equal(view.totalUsd, null);
  assert.deepEqual(view.bar, []);
});

test("a place still reading is named as such, so a short total never passes for the whole", () => {
  const view = portfolioView({ ...base, piers: { state: "loading", rows: [] } });
  assert.deepEqual(view.reading, ["pools"]);
  assert.deepEqual(view.unread, []);
});
