import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CHAIN_CHECK_LIMIT, chainTradeSignatures } from "./report-chain.server.ts";
import { checkedDay, dayOf, unbookedTrades } from "./report.ts";

/* CITY-245: the agent's daily report checks its book against the chain's trades — signatures only, figures the book's. */

const trade = (signature, at = 1_000, status = "ok") => ({ at, status, signature, spentRaw: "20000000", receivedRaw: "5000", reason: null });
const BUDGET = "Budget1111111111111111111111111111111111111";
const COIN = "Coin111111111111111111111111111111111111111";

test("the chain's trades the book does not hold are counted; none read is null, never zero", () => {
  const book = [trade("a"), trade("b", 2_000, "failed"), { ...trade(null), status: "refused" }];
  assert.equal(unbookedTrades(null, book), null);
  assert.equal(unbookedTrades([], book), 0);
  assert.equal(unbookedTrades(["a", "b"], book), 0, "a trade the book keeps under any status is booked");
  assert.equal(unbookedTrades(["a", "c", "d"], book), 2);
});

test("a day with unbooked trades says no result; its count and spend stay the book's", () => {
  const day = { ...dayOf([trade("a", 1_000)], { since: 0, until: 5_000 }, { heldRaw: "5000", worthRaw: "30000000" }), netRaw: "1", holdRaw: "2" };
  assert.equal(day.worthRaw, "30000000");
  assert.equal(checkedDay(day, null), day, "unchecked: as the book says");
  assert.equal(checkedDay(day, 0), day, "confirmed: as the book says");
  const held = checkedDay(day, 1);
  assert.deepEqual(
    { trades: held.trades, spentRaw: held.spentRaw, boughtRaw: held.boughtRaw, worthRaw: held.worthRaw, earnedRaw: held.earnedRaw, netRaw: held.netRaw, holdRaw: held.holdRaw },
    { trades: 1, spentRaw: "20000000", boughtRaw: "5000", worthRaw: null, earnedRaw: null, netRaw: null, holdRaw: null },
  );
  const plain = checkedDay(dayOf([trade("a", 1_000)], { since: 0, until: 5_000 }, null), 2);
  assert.equal("netRaw" in plain, false, "a figure never counted is not made «unread»");
});

test("the check asks the scan once: the Smart Account acting on the budget's account, the coin moved, the span in seconds", async () => {
  const asked = [];
  const history = { host: "mainnet.helius-rpc.com", signatures: async (query) => (asked.push(query), { entries: [{ signature: "x" }, { signature: "y" }], whole: true }) };
  const found = await chainTradeSignatures({ budget: BUDGET, coin: COIN, since: 1_790_000_000_500, until: 1_790_086_400_100 }, { history, now: () => 0 });
  assert.deepEqual(found, ["x", "y"]);
  assert.deepEqual({ ...asked[0], until: undefined }, {
    address: BUDGET,
    match: { programs: [{ programId: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG", scope: "address" }], mints: [{ mint: COIN, scope: "transaction" }] },
    limit: CHAIN_CHECK_LIMIT,
    time: { gte: 1_790_000_000, lte: 1_790_086_401 + 60 },
    until: undefined,
  });
  assert.equal(asked[0].until, 6_000);
});

test("no scan, a failed scan or a span busier than one listing: unchecked", async () => {
  const span = { budget: BUDGET, coin: COIN, since: 1_000, until: 2_000 };
  assert.equal(await chainTradeSignatures(span, { history: null }), null);
  assert.equal(await chainTradeSignatures(span, { history: { host: "h", signatures: async () => Promise.reject(new Error("503")) } }), null);
  assert.equal(await chainTradeSignatures(span, { history: { host: "h", signatures: async () => ({ entries: [], whole: false }) } }), null);
  assert.equal(await chainTradeSignatures({ ...span, until: 1_000 }, { history: { host: "h", signatures: async () => assert.fail("not asked") } }), null);
});

test("the daily report checks its day against the chain on mainnet only, and says no result over a part of the trades", () => {
  const source = readFileSync(new URL("../../city/lib/autopilot/report-watch.server.ts", import.meta.url), "utf8");
  assert.match(source, /gate\.network === 'mainnet' \? await chainTradeSignatures\(\{ budget: entry\.record\.budget, coin: entry\.receiveMint, since, until \}\) : null/u);
  assert.match(source, /unbookedTrades\(chain, await hers\(entry\.record\.owner\)/u, "booked under any of her mandates");
  assert.match(source, /const day = checkedDay\(view\.away, unbooked\)/u);
  assert.match(source, /netRaw: unbooked \? null : view\.net\.netRaw/u);
});
