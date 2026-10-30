import { test } from "node:test";
import assert from "node:assert/strict";

import { ACCOUNT_STALE_MS, ACCOUNT_WORDS, accountKind, cancelAllMarkets, collateralOf, healthOf, opensFrom, orderRows, phoenixHolds, positionRows, reducesFrom } from "./account.ts";
import { account, MARKETS, margin, NO_ACCOUNT, SOL } from "./test-fixtures.mjs";

const ready = (value, at = 1_000) => ({ status: "ready", value, at });

test("the account panel's word: the wallet first, then Phoenix's own state of the account", () => {
  assert.equal(accountKind(false, ready(account())), "connect");
  assert.equal(accountKind(true, { status: "loading", value: null, at: null }), "loading");
  assert.equal(accountKind(true, { status: "idle", value: null, at: null }), "loading");
  assert.equal(accountKind(true, { status: "failed", value: null, at: null }), "unavailable");
  assert.equal(accountKind(true, ready(NO_ACCOUNT)), "invite");
  for (const [state, kind] of [["uninitialized", "invite"], ["frozen", "frozen"], ["reduceOnly", "reduceOnly"], ["cold", "inactive"], ["active", "active"], ["unknown", "unknown"]]) {
    assert.equal(accountKind(true, ready(account({ state }))), kind, state);
  }
  // A failed read with an earlier account keeps that account's word: the health says the figures are old.
  assert.equal(accountKind(true, { status: "failed", value: account(), at: 1 }), "active");
});

test("closing out (decision 86): an account that could open is closing only; one that could not keeps Phoenix's word", () => {
  for (const state of ["active", "cold", "unknown"]) assert.equal(accountKind(true, ready(account({ state })), true), "reduceOnly", state);
  assert.equal(accountKind(true, ready(account({ state: "frozen" })), true), "frozen");
  assert.equal(accountKind(true, ready(NO_ACCOUNT), true), "invite");
  assert.equal(accountKind(false, ready(account()), true), "connect");
  assert.equal(accountKind(true, ready(account()), false), "active");
  // Closing only still cuts, closes, cancels: and opens nothing.
  assert.equal(reducesFrom(accountKind(true, ready(account()), true)), true);
  assert.equal(opensFrom(accountKind(true, ready(account()), true)), false);
});

test("the wallet holds something on Phoenix while it has a position, an order or collateral of either kind", () => {
  assert.equal(phoenixHolds(null), false);
  assert.equal(phoenixHolds(NO_ACCOUNT), false);
  assert.equal(phoenixHolds(account()), true);
  const empty = { positions: [], orders: [], collateralUsd: 0, collateralSol: null };
  assert.equal(phoenixHolds(account(empty)), false);
  assert.equal(phoenixHolds(account({ ...empty, collateralUsd: 0.5 })), true);
  assert.equal(phoenixHolds(account({ ...empty, collateralSol: 0.01 })), true);
  assert.equal(phoenixHolds(account({ ...empty, orders: account().orders.length ? account().orders : [{}] })), true);
  assert.equal(phoenixHolds(account({ ...empty, positions: account().positions })), true);
});

test("an account by invite says so honestly, and only an account Phoenix lets trade opens from here", () => {
  assert.match(ACCOUNT_WORDS.invite.title, /No Phoenix account/);
  assert.match(ACCOUNT_WORDS.invite.line, /invite/);
  assert.match(ACCOUNT_WORDS.frozen.title, /access/);
  // One title and at most one short line: no paragraph on screen.
  for (const [kind, words] of Object.entries(ACCOUNT_WORDS)) assert.ok(words.line.length <= 40 && !words.line.includes(". "), kind);
  assert.equal(opensFrom("active"), true);
  assert.equal(opensFrom("unknown"), true);
  for (const kind of ["connect", "loading", "unavailable", "invite", "frozen", "reduceOnly"]) assert.equal(opensFrom(kind), false, kind);
  // Reduce only still takes risk away: close, TP/SL, cancel.
  assert.equal(reducesFrom("reduceOnly"), true);
  assert.equal(reducesFrom("frozen"), false);
  assert.equal(reducesFrom("invite"), false);
});

test("health is Phoenix's risk tier on the engine's scale, with the room to the limit", () => {
  const healthy = healthOf(ready(account()), 1_000);
  assert.equal(healthy.state, "healthy");
  assert.equal(healthy.tier, "safe");
  // (131.2 − 15) / 131.2 of the account's value may still be lost before the maintenance margin.
  assert.ok(Math.abs(healthy.room - 88.567) < 0.01);
  assert.deepEqual(healthy.actions, []);
  assert.equal(healthOf(ready(account({ margin: margin({ riskTier: "atRisk" }) })), 1_000).state, "raised");
  const critical = healthOf(ready(account({ margin: margin({ riskTier: "cancellable" }) })), 1_000);
  assert.equal(critical.state, "critical");
  assert.deepEqual(critical.actions, ["reduce", "close", "deposit", "cancelAll"]);
  assert.equal(healthOf(ready(account({ margin: margin({ riskTier: "liquidatable" }) })), 1_000).state, "liquidation");
  // The highest tier of any subaccount stands: an isolated one at risk raises the whole account.
  const isolated = account({ subaccountMargins: [margin({ riskTier: "atRisk", positions: [{ symbol: "BTC", subaccount: 2, liquidationPriceUsd: 60_000, leverage: 8 }] })] });
  assert.equal(healthOf(ready(isolated), 1_000).state, "raised");
});

test("old or failed reads are said as such, but never soften a worse word", () => {
  assert.equal(healthOf({ status: "failed", value: account(), at: 1_000 }, 1_000).state, "stale");
  assert.equal(healthOf(ready(account(), 1_000), 1_000 + ACCOUNT_STALE_MS + 1).state, "stale");
  assert.equal(healthOf(ready(account(), 1_000), 1_000 + ACCOUNT_STALE_MS - 1).state, "healthy");
  const critical = healthOf({ status: "failed", value: account({ margin: margin({ riskTier: "cancellable" }) }), at: 1_000 }, 1_000);
  assert.equal(critical.state, "critical");
  assert.equal(critical.stale, true);
  // No account, no health.
  assert.equal(healthOf(ready(NO_ACCOUNT), 1_000), null);
  assert.equal(healthOf({ status: "loading", value: null, at: null }, 1_000), null);
});

test("a position row carries Phoenix's figures: the liquidation price and leverage from its margin view, the result at the mark", () => {
  const [row] = positionRows(account(), MARKETS.markets);
  assert.equal(row.symbol, "SOL");
  assert.equal(row.side, "long");
  assert.equal(row.size, 4);
  assert.equal(row.mark, 150);
  // The engine's own `unrealisedPnl`: (150 − 147.2) × 4.
  assert.ok(Math.abs(row.pnlUsd - 11.2) < 1e-9);
  assert.equal(row.liquidationUsd, 118.4);
  assert.equal(row.liquidation, "read");
  // The engine's distance: (150 − 118.4) / 150.
  assert.ok(Math.abs(row.liquidationAwayPercent - 21.0667) < 0.001);
  assert.equal(row.leverage, 4.6);
  assert.equal(row.tp, 165);
  assert.equal(row.sl, 140);
  assert.equal(row.manageable, true);
});

test("a short loses as the mark rises; a figure Phoenix did not send stays unknown, never zero", () => {
  const short = account({ positions: [{ symbol: "SOL", subaccount: 0, side: "short", size: 2, entryPrice: 140 }], margin: margin({ positions: [{ symbol: "SOL", subaccount: 0, liquidationPriceUsd: null, leverage: null }] }) });
  const [row] = positionRows(short, MARKETS.markets);
  assert.equal(row.pnlUsd, -20);
  assert.equal(row.liquidationUsd, null);
  assert.equal(row.liquidation, "read");
  assert.equal(row.liquidationAwayPercent, null);
  assert.equal(row.tp, null);
  // A market Phoenix's list does not carry: no mark, no result.
  const [unknown] = positionRows(account({ positions: [{ symbol: "XYZ", subaccount: 0, side: "long", size: 1, entryPrice: 2 }] }), MARKETS.markets);
  assert.equal(unknown.mark, null);
  assert.equal(unknown.pnlUsd, null);
  // Lots Phoenix sent without units: the position is shown with no size and no result.
  const [sizeless] = positionRows(account({ positions: [{ symbol: "SOL", subaccount: 0, side: "long", size: null, entryPrice: 140 }] }), MARKETS.markets);
  assert.equal(sizeless.size, null);
  assert.equal(sizeless.pnlUsd, null);
});

test("an isolated position is read, never acted on from here; its liquidation unread when its view was not read", () => {
  const rows = positionRows(account({ positions: [...account().positions, { symbol: "BTC", subaccount: 3, side: "long", size: 0.01, entryPrice: 66_000 }] }), MARKETS.markets);
  assert.deepEqual(rows.map((row) => [row.symbol, row.subaccount, row.manageable]), [["SOL", 0, true], ["BTC", 3, false]]);
  assert.equal(rows[1].liquidation, "unread");
  assert.equal(rows[1].liquidationUsd, null);
  assert.equal(healthOf(ready(account({ positions: rows.map((row) => ({ symbol: row.symbol, subaccount: row.subaccount, side: row.side, size: row.size, entryPrice: row.entry })) })), 1_000).partial, true);
});

test("orders: a plain one cancels by its number, a TP/SL leg by its position's index, the rest only with «Cancel all»", () => {
  const rows = orderRows(account({ orders: [...account().orders, { id: "0:SOL:303", symbol: "SOL", subaccount: 0, side: "sell", type: "stop", price: 140, size: 4, reduceOnly: true, stop: true, status: "open", sequence: "303" }, { id: "2:BTC:9", symbol: "BTC", subaccount: 2, side: "buy", type: "limit", price: 60_000, size: 0.01, reduceOnly: false, stop: false, status: "open", sequence: "9" }] }));
  assert.deepEqual(
    rows.map((row) => [row.key, row.cancel, row.leg]),
    [
      ["0:SOL:101", { kind: "order", sequence: "101" }, null],
      ["0:SOL:202", { kind: "conditional", index: 3 }, "tp"],
      ["0:SOL:303", null, null],
      ["2:BTC:9", null, null],
    ],
  );
  assert.deepEqual(cancelAllMarkets(account()), ["SOL"]);
  assert.deepEqual(orderRows(null), []);
});

test("the collateral is Phoenix's margin view: free to withdraw in micro-dollars, the moves Phoenix allows", () => {
  const collateral = collateralOf(account());
  assert.equal(collateral.collateralUsd, 120);
  assert.equal(collateral.portfolioUsd, 131.2);
  assert.equal(collateral.heldUsd, 30);
  assert.equal(collateral.withdrawableMicro, 90_000_000n);
  assert.equal(collateral.canDeposit, true);
  // Without a margin read, the trader state's collateral stands and no move is offered on a guess.
  const bare = collateralOf(account({ margin: null }));
  assert.equal(bare.collateralUsd, 120);
  assert.equal(bare.portfolioUsd, null);
  assert.equal(bare.withdrawableMicro, null);
  assert.equal(bare.canDeposit, false);
  assert.equal(collateralOf(NO_ACCOUNT), null);
  assert.equal(SOL.symbol, "SOL");
});
