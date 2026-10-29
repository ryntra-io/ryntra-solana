import { test } from "node:test";
import assert from "node:assert/strict";

import { entryLayer, entryMove, entryPrice, knownBasis, readEntryBasis } from "./entry.ts";

// «Your entry» on the chart: the average cost of the coins the wallet holds, from «Mine»'s measure (CITY-7) of the
// engine's record of the wallet's own trades. Only when it covers the whole balance; reading only. No network.

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

test("the entry is what the coins held cost, over how many there are", () => {
  // $60 for 120 JUP (6 decimals): $0.50 a coin.
  assert.equal(entryPrice({ costMicros: 60_000_000n, quantityRaw: 120_000_000n }, 6), 0.5);
  // $25 for 1,250,000 BONK (5 decimals): $0.00002.
  assert.ok(Math.abs(entryPrice({ costMicros: 25_000_000n, quantityRaw: 125_000_000_000n }, 5) - 0.00002) < 1e-12);
  // No basis — a coin that came from elsewhere, or one «Mine» could not cost whole — is no entry, never a guess.
  assert.equal(entryPrice(null, 6), null);
  assert.equal(entryPrice(undefined, 6), null);
  assert.equal(entryPrice({ costMicros: 0n, quantityRaw: 10n }, 6), null);
  assert.equal(entryPrice({ costMicros: 10n, quantityRaw: 10n }, -1), null);
  assert.equal(entryPrice({ costMicros: 10n, quantityRaw: 10n }, 1.5), null);
});

test("the move from the entry, and the entry as a level on the chart", () => {
  assert.equal(entryMove(0.5, 0.55).toFixed(6), "10.000000");
  assert.equal(entryMove(0.5, 0.4).toFixed(6), "-20.000000");
  assert.equal(entryMove(null, 0.4), null);
  assert.equal(entryMove(0.5, null), null);
  assert.equal(entryMove(0.5, 0), null);
  assert.deepEqual(entryLayer(JUP, 0.5), { id: "entry", label: "Entry", mint: JUP, levels: [{ id: "average", price: 0.5, label: "Your entry" }] });
  assert.equal(entryLayer(JUP, null), null);
});

test("«Mine»'s read is used only for this wallet and this very balance", () => {
  const basis = { costMicros: 60_000_000n, quantityRaw: 120_000_000n };
  const mine = { owner: OWNER, status: "ready", against: `${JUP}:120000000,${BONK}:5`, bases: new Map([[JUP, basis], [BONK, null]]) };
  assert.equal(knownBasis(mine, OWNER, JUP, "120000000"), basis);
  assert.equal(knownBasis(mine, OWNER, BONK, "5"), null, "«Mine» read it, and the engine cannot cost it whole");
  // A trade since (another balance), another wallet, a read under way, a coin «Mine» did not ask about: read it here.
  assert.equal(knownBasis(mine, OWNER, JUP, "99"), undefined);
  assert.equal(knownBasis(mine, "someone else", JUP, "120000000"), undefined);
  assert.equal(knownBasis({ ...mine, status: "reading" }, OWNER, JUP, "120000000"), undefined);
  assert.equal(knownBasis({ ...mine, against: `${JUP}:120000000` , bases: new Map() }, OWNER, JUP, "120000000"), undefined);
});

test("the chart's own read of the record: a basis, no proof, or a failure — never a wallet prompt", async () => {
  const asked = [];
  const answer = (status, body) => async (url) => (asked.push(url), { ok: status >= 200 && status < 300, status, json: async () => body });
  const trades = [
    { kind: "BUY", mint: JUP, costMicros: "80000000", quantityRaw: "150000000" },
    { kind: "SELL", mint: JUP, costMicros: "20000000", quantityRaw: "30000000" },
    { kind: "BUY", mint: BONK, costMicros: "1", quantityRaw: "1" },
  ];
  const read = await readEntryBasis(OWNER, JUP, "120000000", answer(200, { trades, complete: true }));
  assert.deepEqual(read, { kind: "basis", basis: { costMicros: 60_000_000n, quantityRaw: 120_000_000n } });
  assert.deepEqual(asked, [`/api/growth/cards?address=${OWNER}&mint=${JUP}`]);
  // The record does not cover the balance (a transfer in), or was not read whole: no entry.
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "200000000", answer(200, { trades, complete: true })), { kind: "basis", basis: null });
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "120000000", answer(200, { trades, complete: false })), { kind: "basis", basis: null });
  // The wallet has not proved itself in this browser: said, not asked for.
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "120000000", answer(401, { error: "proof required" })), { kind: "proof" });
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "120000000", answer(503, null)), { kind: "failed" });
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "120000000", answer(200, { trades: "none" })), { kind: "failed" });
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "120000000", async () => Promise.reject(new TypeError("offline"))), { kind: "failed" });
  assert.deepEqual(await readEntryBasis(OWNER, JUP, "120000000", async () => ({ ok: true, status: 200, json: async () => JSON.parse("<") })), { kind: "failed" });
});
