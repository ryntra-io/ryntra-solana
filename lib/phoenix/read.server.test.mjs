// Run from repo root: node --test lib/phoenix/read.server.test.mjs
//
// SOL-C7 — an account read carries each subaccount's margin view: the cross-margin one and every isolated one that
// holds a position, so each position shows where Phoenix liquidates it. Phoenix is answered here; nothing leaves.
import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import { accountRisk, readSubaccounts, traderAccountOf, traderSubaccountOf } from "./collateral.ts";
import { readFuturesAccount } from "./read.server.ts";

const usd = (value) => ({ value: Math.round(value * 1e6), decimals: 6, ui: String(value) });

test("an isolated subaccount's position gets its own view: liquidation price, leverage and risk", async (t) => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const cross = traderAccountOf(wallet);
  const isolated = traderSubaccountOf(wallet, 2);
  assert.notEqual(cross, isolated);
  assert.equal(traderSubaccountOf(wallet, 0), cross, "subaccount 0 is the cross-margin account");
  const asked = [];
  const answers = {
    [`/v1/trader/state/${wallet}?traderPdaIndex=0`]: {
      snapshot: {
        capabilities: { state: "active" },
        subaccounts: [
          { subaccountIndex: 0, collateral: 1_000_000_000, positions: [{ symbol: "SOL", basePositionUnits: "10", entryPriceUsd: "180" }], orders: [] },
          { subaccountIndex: 2, collateral: 50_000_000, positions: [{ symbol: "GOLD", basePositionUnits: "-1", entryPriceUsd: "2600" }], orders: [] },
        ],
      },
    },
    "/v1/view/exchange/markets": [],
    "/v1/markets/stats/latest": { markets: [] },
    [`/v1/view/trader/${cross}`]: {
      traderSubaccountIndex: 0,
      riskTier: "safe",
      portfolioValue: usd(1_000),
      maintenanceMargin: usd(90),
      positions: [{ symbol: "SOL", positionValue: usd(1_800), positionInitialMargin: usd(180), liquidationPrice: usd(95) }],
    },
    [`/v1/view/trader/${isolated}`]: {
      traderSubaccountIndex: 0,
      riskTier: "atRisk",
      portfolioValue: usd(50),
      maintenanceMargin: usd(40),
      positions: [{ symbol: "GOLD", positionValue: usd(-2_600), positionInitialMargin: usd(130), liquidationPrice: usd(2_650) }],
    },
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = String(url).replace("https://perp-api.phoenix.trade", "");
    asked.push(path);
    const body = answers[path];
    return body === undefined ? new Response("{}", { status: 404 }) : Response.json(body);
  });
  const read = await readFuturesAccount(wallet, () => 1);
  assert.equal(read.ok, true);
  const account = read.value;
  assert.deepEqual(account.margin.positions, [{ symbol: "SOL", subaccount: 0, liquidationPriceUsd: 95, leverage: 10 }]);
  assert.equal(account.subaccountMargins.length, 1);
  /* The subaccount is the address read, not what the view says of itself. */
  assert.deepEqual(account.subaccountMargins[0].positions, [{ symbol: "GOLD", subaccount: 2, liquidationPriceUsd: 2_650, leverage: 20 }]);
  assert.ok(asked.every((path) => path.startsWith("/v1/")), "only Phoenix's public reads");
  /* The account's risk is its worst subaccount's: the isolated one at risk with 20 % room, not the cross one's «low». */
  const risk = accountRisk([account.margin, ...account.subaccountMargins]);
  assert.equal(risk.tier, "atRisk");
  assert.equal(Math.round(risk.room), 20);
  assert.deepEqual([...readSubaccounts(account)].sort(), [0, 2]);
  /* A subaccount whose view did not come is not read — never «Phoenix doesn't say». */
  assert.deepEqual([...readSubaccounts({ margin: account.margin })], [0]);
  assert.deepEqual([...readSubaccounts({ margin: null })], []);
});

test("no other subaccount, no extra read and no subaccount margins", async (t) => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = String(url).replace("https://perp-api.phoenix.trade", "");
    asked.push(path);
    if (path.startsWith("/v1/trader/state/")) return Response.json({ snapshot: { capabilities: { state: "active" }, subaccounts: [{ subaccountIndex: 0, collateral: 0, positions: [], orders: [] }] } });
    return Response.json(path.startsWith("/v1/view/trader/") ? { riskTier: "safe" } : []);
  });
  const read = await readFuturesAccount(wallet, () => 1);
  assert.equal(read.ok, true);
  assert.equal(read.value.subaccountMargins, undefined);
  assert.equal(asked.filter((path) => path.startsWith("/v1/view/trader/")).length, 1);
  assert.deepEqual(accountRisk([read.value.margin]), { tier: "safe", room: null });
});
