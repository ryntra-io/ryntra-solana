import { test } from "node:test";
import assert from "node:assert/strict";

import { basisOf, formatPct, formatUsd, HISTORY_PAGE, mineOf, readAge } from "./mine.ts";
import { MAX_BASIS_COINS, setMineEnv, useMine } from "./mine-store.ts";
import { SOL, USDC } from "./tiles.ts";
import { holdingsOf } from "./wallet.ts";

// «Mine»: the wallet's towers, their value at the city's price, and a move since bought only where the engine measured
// what the whole holding cost. No network: the history route is a stub.

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const LOST = "LoSTmintLoSTmintLoSTmintLoSTmintLoSTmint1111";

const tower = (id, symbol, price, change24h = 0) => ({ id, symbol, name: symbol, icon: null, district: "core", price, mcap: 1, liquidity: 1, holders: 1, change5m: 0, change1h: 0, change24h, volume24h: 0, traders1h: 0, organic: 90, verified: true, launchedAt: null });
const TOWERS = [tower(SOL.mint, "SOL", 150), tower(USDC.mint, "USDC", 1), tower(JUP, "JUP", 0.5, -3.2), tower(BONK, "BONK", 0.00002, 12)];

const ROWS = [
  { kind: "NATIVE_SOL", mint: null, spendableRaw: "2400000000", decimals: 9 },
  { kind: "TOKEN", mint: JUP, spendableRaw: "120000000", decimals: 6 },
  { kind: "TOKEN", mint: BONK, spendableRaw: "5000000000", decimals: 5 },
  { kind: "TOKEN", mint: LOST, spendableRaw: "1", decimals: 0 },
  { kind: "TOKEN", mint: SOL.mint, spendableRaw: "1000", decimals: 9 },
];
const HOLDINGS = holdingsOf(OWNER, ROWS, true, 1_000);

const buy = (mint, costMicros, quantityRaw) => ({ kind: "BUY", mint, costMicros, quantityRaw });
const sell = (mint, costMicros, quantityRaw) => ({ kind: "SELL", mint, costMicros, quantityRaw });

test("the holdings read keeps the time it was read", () => {
  assert.equal(HOLDINGS.at, 1_000);
  assert.equal(typeof holdingsOf(OWNER, [], true).at, "number");
});

test("the wallet's towers, worth the most first; SOL is money beside them and counts in the total", () => {
  const mine = mineOf(HOLDINGS, TOWERS);
  assert.deepEqual(mine.rows.map((row) => row.tower.symbol), ["JUP", "BONK"]);
  assert.equal(mine.rows[0].valueUsd, 120 * 0.5);
  assert.equal(mine.rows[1].valueUsd, 50000 * 0.00002);
  assert.deepEqual(mine.cash.map((row) => [row.symbol, row.valueUsd]), [["SOL", 2.4 * 150]]);
  assert.equal(mine.totalUsd, 61 + 360);
  assert.equal(mine.elsewhere, 1);
  assert.equal(mine.unvalued, 0);
});

test("without what the holding cost, each coin says the market's 24-hour move, marked as such", () => {
  const mine = mineOf(HOLDINGS, TOWERS);
  assert.deepEqual(mine.rows.map((row) => row.change), [{ since: "day", pct: -3.2 }, { since: "day", pct: 12 }]);
});

test("with what the holding cost, the coin says its move since it was bought", () => {
  const bases = new Map([[JUP, { costMicros: 48_000_000n, quantityRaw: 120000000n }]]);
  const jup = mineOf(HOLDINGS, TOWERS, bases).rows.find((row) => row.tower.id === JUP);
  assert.equal(jup.change.since, "bought");
  assert.equal(Math.round(jup.change.pct * 100) / 100, 25);
});

test("no wallet, an empty wallet, and a coin with no price are each said as they are", () => {
  assert.deepEqual(mineOf(null, TOWERS), { rows: [], cash: [], totalUsd: null, unvalued: 0, elsewhere: 0 });
  assert.deepEqual(mineOf(holdingsOf(OWNER, [ROWS[0]], true), TOWERS).rows, []);
  const mine = mineOf(HOLDINGS, [tower(JUP, "JUP", 0), tower(BONK, "BONK", Number.NaN)]);
  assert.equal(mine.totalUsd, null);
  assert.equal(mine.unvalued, 2);
  assert.ok(mine.rows.every((row) => row.valueUsd === null));
});

test("the cost of a holding: buys add, sales take off what they closed", () => {
  const trades = [sell(JUP, "20000000", "40000000"), buy(JUP, "50000000", "100000000"), buy(JUP, "10000000", "60000000"), buy(BONK, "999", "1")];
  assert.deepEqual(basisOf(trades, JUP, "120000000", true), { costMicros: 40_000_000n, quantityRaw: 120000000n });
});

test("no cost unless it covers exactly what the wallet holds now", () => {
  const trades = [buy(JUP, "50000000", "100000000")];
  // Some came from elsewhere, or some left by a transfer.
  assert.equal(basisOf(trades, JUP, "120000000", true), null);
  assert.equal(basisOf(trades, JUP, "90000000", true), null);
  assert.deepEqual(basisOf(trades, JUP, "100000000", true), { costMicros: 50_000_000n, quantityRaw: 100000000n });
});

test("no cost from a history read by halves, a full page that may hide older trades, or a row it cannot read", () => {
  const trades = [buy(JUP, "50000000", "100000000")];
  assert.equal(basisOf(trades, JUP, "100000000", false), null);
  const page = Array.from({ length: HISTORY_PAGE }, () => buy(JUP, "1", "1"));
  assert.equal(basisOf(page, JUP, String(HISTORY_PAGE), true), null);
  assert.equal(basisOf([{ kind: "BUY", mint: JUP, costMicros: 5, quantityRaw: "100000000" }], JUP, "100000000", true), null);
  assert.equal(basisOf([{ kind: "SWAP", mint: JUP, costMicros: "5", quantityRaw: "100000000" }], JUP, "100000000", true), null);
  assert.equal(basisOf([], JUP, "100000000", true), null);
});

test("figures as the panel writes them", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(0), "$0");
  assert.equal(formatUsd(0.004), "<$0.01");
  assert.equal(formatUsd(12.4), "$12.40");
  assert.equal(formatUsd(1240.5), "$1,240.50");
  assert.equal(formatUsd(48_211.7), "$48,212");
  assert.equal(formatUsd(2_450_000), "$2.45M");
  assert.equal(formatPct(12.44), "+12.4%");
  assert.equal(formatPct(-3.123), "−3.12%");
  assert.equal(formatPct(0.001), "0%");
  assert.equal(formatPct(250.6), "+251%");
  assert.equal(readAge(0, 4_000), "just now");
  assert.equal(readAge(0, 40_000), "40s ago");
  assert.equal(readAge(0, 180_000), "3 min ago");
});

// The store: the history behind the wallet's proof, never a prompt by itself.

function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function history(byMint, { status = 200, complete = true } = {}) {
  const asked = [];
  return {
    asked,
    fetch: async (url) => {
      const query = new URL(url, "http://city").searchParams;
      asked.push(query.get("mint"));
      if (status !== 200) return answer(status, { error: "x" });
      return answer(200, { complete, trades: byMint[query.get("mint")] ?? [] });
    },
  };
}

const HELD = [
  { mint: JUP, balanceRaw: "120000000" },
  { mint: BONK, balanceRaw: "5000000000" },
];

test("the store reads what each held coin cost, once, and keeps it for the same balances", async () => {
  useMine.getState().reset();
  const stub = history({ [JUP]: [buy(JUP, "48000000", "120000000")], [BONK]: [buy(BONK, "1", "1")] });
  setMineEnv({ fetch: stub.fetch, now: () => 10_000 });
  await useMine.getState().readBases(OWNER, HELD);
  const state = useMine.getState();
  assert.equal(state.status, "ready");
  assert.deepEqual(state.bases.get(JUP), { costMicros: 48_000_000n, quantityRaw: 120000000n });
  assert.equal(state.bases.get(BONK), null);
  assert.equal(state.at, 10_000);
  await useMine.getState().readBases(OWNER, HELD);
  assert.deepEqual(stub.asked, [JUP, BONK]);
  // A trade changed a balance: asked again.
  await useMine.getState().readBases(OWNER, [{ mint: JUP, balanceRaw: "60000000" }, HELD[1]]);
  assert.equal(stub.asked.length, 4);
  assert.equal(useMine.getState().bases.get(JUP), null);
});

test("without the wallet's proof the store stops at the first answer and waits for a tap", async () => {
  useMine.getState().reset();
  const stub = history({}, { status: 401 });
  let proved = 0;
  setMineEnv({ fetch: stub.fetch, prove: async () => (proved += 1, { ok: false, state: "declined", message: "Nothing was signed." }) });
  await useMine.getState().readBases(OWNER, HELD);
  assert.equal(useMine.getState().status, "proof");
  assert.deepEqual(stub.asked, [JUP]);
  assert.equal(proved, 0);
  // Declined in the wallet: an answer, not an error.
  await useMine.getState().prove({ wallet: "Phantom", address: OWNER }, HELD);
  assert.equal(proved, 1);
  assert.equal(useMine.getState().status, "proof");
  assert.equal(useMine.getState().message, null);
});

test("a proof given, the store reads at once", async () => {
  useMine.getState().reset();
  let proven = false;
  const ok = history({ [JUP]: [buy(JUP, "48000000", "120000000")] });
  setMineEnv({
    fetch: (url) => (proven ? ok.fetch(url) : Promise.resolve(answer(401, {}))),
    prove: async () => ((proven = true), { ok: true }),
  });
  await useMine.getState().readBases(OWNER, HELD);
  assert.equal(useMine.getState().status, "proof");
  await useMine.getState().prove({ wallet: "Phantom", address: OWNER }, HELD);
  assert.equal(useMine.getState().status, "ready");
  assert.ok(useMine.getState().bases.get(JUP));
});

test("a history that does not answer is unavailable, never a zero cost", async () => {
  useMine.getState().reset();
  setMineEnv({ fetch: history({}, { status: 503 }).fetch });
  await useMine.getState().readBases(OWNER, HELD);
  assert.equal(useMine.getState().status, "failed");
  assert.equal(useMine.getState().bases.size, 0);
  useMine.getState().reset();
  setMineEnv({ fetch: async () => { throw new Error("offline"); } });
  await useMine.getState().readBases(OWNER, HELD);
  assert.equal(useMine.getState().status, "failed");
});

test("the engine is asked about a bounded number of coins", async () => {
  useMine.getState().reset();
  const stub = history({});
  setMineEnv({ fetch: stub.fetch });
  const many = Array.from({ length: MAX_BASIS_COINS + 5 }, (_, i) => ({ mint: `${JUP.slice(0, 40)}${String(i).padStart(4, "0")}`, balanceRaw: "1" }));
  await useMine.getState().readBases(OWNER, many);
  assert.equal(stub.asked.length, MAX_BASIS_COINS);
});

test("a dollar coin with no tower is money at a dollar, not a coin «elsewhere» (CITY-150: $0.74 beside $37.63)", () => {
  const holdings = holdingsOf(OWNER, [ROWS[0], ROWS[1], { kind: "TOKEN", mint: USDC.mint, spendableRaw: "26100000", decimals: 6 }], true);
  const mine = mineOf(holdings, TOWERS.filter((t) => t.id !== USDC.mint));
  assert.deepEqual(mine.cash.map((row) => [row.symbol, row.valueUsd]), [["SOL", 360], ["USDC", 26.1]]);
  assert.equal(mine.elsewhere, 0);
  assert.equal(mine.totalUsd, 360 + 26.1 + 60);
});
