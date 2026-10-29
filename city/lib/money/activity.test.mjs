import { test } from "node:test";
import assert from "node:assert/strict";

import { explorerTxUrl } from "../../../lib/solana/explorer.ts";
import { activityLines, readActivity, whenWords } from "./activity.ts";
import { clock, DIGEST, FRIEND, no, ok, OWNER, scriptedFetch, SIGNATURE, USDC } from "./test-fixtures.mjs";

const ROUTE = "/api/solana/activity";

const action = (over = {}) => ({
  schema: "ryntra.solana.wallet-action",
  schemaVersion: "1.0.0",
  version: 1,
  network: "mainnet",
  wallet: OWNER,
  actionId: SIGNATURE,
  lane: "SEND",
  outcome: "DONE",
  out: { mint: USDC, amountRaw: "2500000", decimals: 6, symbol: "USDC" },
  in: null,
  destination: null,
  signature: SIGNATURE,
  receiptHash: null,
  sourceTx: null,
  destinationTx: null,
  fee: null,
  origin: null,
  providerRef: null,
  statedUsd: null,
  startedAt: "2026-10-28T10:05:00Z",
  updatedAt: "2026-10-28T10:05:30Z",
  ...over,
});

test("the engine's ledger for this wallet, read whole or said to be partial", async () => {
  const time = clock();
  const engine = scriptedFetch({ [ROUTE]: [ok({ data: { actions: [action(), { broken: true }], complete: true } }), no(429, "RATE_LIMITED")] });
  const read = await readActivity(engine.fetch, OWNER, time.now);
  assert.equal(read.actions.length, 1);
  // A row the city could not read makes the list partial, never silently shorter.
  assert.equal(read.complete, false);
  assert.deepEqual(engine.asked(ROUTE)[0].body, { owner: OWNER, network: "mainnet" });
  assert.equal(await readActivity(engine.fetch, OWNER, time.now), null);
});

test("rows read the way Ryntra's History reads them, newest first, with their chain and receipt", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const bridge = action({ actionId: DIGEST, lane: "CROSS_SWAP", outcome: "IN_FLIGHT", signature: null, sourceTx: SIGNATURE, destination: "BASE", in: { mint: null, amountRaw: "2490000", decimals: 6, symbol: "USDC" }, startedAt: "2026-10-28T11:00:00Z" });
  const lines = activityLines([action(), bridge], [], now);
  assert.deepEqual(lines.map((l) => l.id), [DIGEST, SIGNATURE]);
  assert.deepEqual([lines[0].state, lines[0].tone, lines[0].receipt], ["On its way", "moving", null]);
  assert.match(lines[0].sub, /Between networks · to Base/);
  assert.equal(lines[0].link.href, explorerTxUrl("mainnet", SIGNATURE));
  assert.deepEqual([lines[1].title, lines[1].state, lines[1].tone], ["Sent 2.5 USDC", "Arrived", "done"]);
  // A Send's receipt is the copy this browser kept; the engine cannot issue it again.
  assert.equal(lines[1].receipt, null);
  const kept = [{ wallet: OWNER, storedAt: "", receipt: { outcome: {} } }];
  assert.equal(activityLines([action()], kept, now)[0].receipt, null);
  // A swap's receipt the engine issues again.
  assert.equal(activityLines([action({ lane: "SWAP", in: { mint: FRIEND, amountRaw: "1", decimals: 0, symbol: "X" } })], [], now)[0].receipt, "fetchable");
});

test("when, as a row says it", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assert.match(whenWords("2026-10-28T10:05:00Z", now), /^\d\d:\d\d$/);
  assert.equal(whenWords("2026-10-12T10:05:00Z", now), "12 Oct");
  assert.equal(whenWords("nonsense", now), "");
});
