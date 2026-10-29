import { test } from "node:test";
import assert from "node:assert/strict";

import { feeWords, keepAddress, KEPT_KEY, keptAddress, readDepositAddress, readDepositProgress } from "./deposit.ts";
import { EVM, FRIEND, memoryStorage, no, ok, OWNER, scriptedFetch } from "./test-fixtures.mjs";

const ROUTE = "/api/swap/deposit-address";
const address = (over = {}) => ({ network: "base", address: EVM, recipient: OWNER, feeUsd: 0.03, seconds: 20, ...over });

test("the engine's deposit address is shown only when it pays this wallet on the network asked", async () => {
  const good = scriptedFetch({ [ROUTE]: [ok({ data: address() })] });
  assert.deepEqual(await readDepositAddress(good.fetch, "base", OWNER), address());
  assert.deepEqual(good.asked(ROUTE)[0].body, { network: "base", recipient: OWNER });
  for (const wrong of [address({ recipient: FRIEND }), address({ network: "ethereum" }), address({ address: "not-an-address" })]) {
    assert.equal(await readDepositAddress(scriptedFetch({ [ROUTE]: [ok({ data: wrong })] }).fetch, "base", OWNER), null);
  }
  assert.equal(await readDepositAddress(scriptedFetch({ [ROUTE]: [no(502, "RELAY_REFUSED")] }).fetch, "base", OWNER), null);
});

test("an address is kept a month for this wallet and network, in the place the web keeps it", () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-10-28T12:00:00Z");
  keepAddress(storage, address(), now);
  assert.ok(storage.values.has(KEPT_KEY));
  assert.deepEqual(keptAddress(storage, OWNER, "base", now + 1000)?.address, EVM);
  assert.equal(keptAddress(storage, FRIEND, "base", now), null);
  assert.equal(keptAddress(storage, OWNER, "polygon", now), null);
  assert.equal(keptAddress(storage, OWNER, "base", now + 31 * 24 * 60 * 60 * 1000), null);
  assert.equal(keptAddress(null, OWNER, "base", now), null);
});

test("what happened to a deposit is Relay's word through the engine; unknown is never arrived", async () => {
  const engine = scriptedFetch({ [ROUTE]: [ok({ data: { progress: "ARRIVED", amount: "9.97", at: null } }), ok({ data: {} }), no(500, "X")] });
  assert.deepEqual(await readDepositProgress(engine.fetch, EVM, 100), { progress: "ARRIVED", amount: "9.97" });
  assert.equal(engine.calls[0].url, `${ROUTE}?address=${EVM}&since=100`);
  assert.equal(engine.calls[0].method, "GET");
  assert.deepEqual(await readDepositProgress(engine.fetch, EVM, 100), { progress: "UNKNOWN", amount: null });
  assert.deepEqual(await readDepositProgress(engine.fetch, EVM, 100), { progress: "UNKNOWN", amount: null });
  assert.equal(feeWords(0.03, 10), "About $0.03 on $10, taken from the deposit.");
  assert.equal(feeWords(null, 10), "The fee is set when the deposit is filled.");
});
