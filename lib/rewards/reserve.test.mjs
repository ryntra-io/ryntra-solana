import assert from "node:assert/strict";
import test from "node:test";

import { rewardBalance } from "./balance.ts";
import {
  consumeReserve,
  freeReserveUsdMicros,
  heldUsdMicros,
  holdReserve,
  MAX_OPEN_HOLDS,
  readReserveLedger,
  releaseReserve,
  SETTLE_WINDOW_MS,
} from "./reserve.ts";
import { formatUsdMicros } from "./model.ts";
import { createMemoryGuardStore } from "../guard/store.ts";

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const NOW = "2026-09-11T12:00:00.000Z";
const LATER = (ms) => new Date(Date.parse(NOW) + ms).toISOString();

/** $50 in the treasury, the founder's stated first reserve. */
const TREASURY = 50_000_000n;

/** An entitlement of `usd` dollars for one wallet, as ledger rows read. */
function owed(recipient, usdMicros) {
  return [
    {
      type: "CASHBACK",
      recipient,
      rateBps: 5000,
      shareRaw: "1",
      usdMicros: usdMicros.toString(),
      valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: "USDC", observedAt: NOW },
      source: {
        mechanism: "JUPITER_REFERRAL",
        operationRef: `op:${recipient}`,
        trader: recipient,
        grossRaw: "1",
        asset: null,
        symbol: "USDC",
        decimals: 6,
        settledAt: NOW,
      },
      createdAt: NOW,
      claimId: null,
      signature: null,
    },
  ];
}

test("the defect: two wallets were each promised the whole treasury", async () => {
  const store = createMemoryGuardStore();
  const reserve = { state: "FUNDED", usdMicros: TREASURY, treasury: A, observedAt: NOW };

  /* Two people, $40 each, $50 in the pot. Before any claim, both are shown $40
     — which is correct on its own and is the reading the hold has to settle. */
  const first = rewardBalance({ entries: owed(A, 40_000_000n), reserve, heldUsdMicros: 0n });
  const second = rewardBalance({ entries: owed(B, 40_000_000n), reserve, heldUsdMicros: 0n });
  assert.equal(formatUsdMicros(first.availableUsdMicros), "40.00");
  assert.equal(formatUsdMicros(second.availableUsdMicros), "40.00");

  /* The first one claims and the pot is committed. */
  const held = await holdReserve(store, {
    claimId: "claim-a", wallet: A, usdMicros: 40_000_000n, treasuryUsdMicros: TREASURY, now: NOW,
  });
  assert.equal(held.ok, true);
  assert.equal(formatUsdMicros(held.freeAfterUsdMicros), "10.00");

  /* Now the second one's page tells the truth rather than the old $40. */
  const ledger = await readReserveLedger(store);
  const secondAfter = rewardBalance({
    entries: owed(B, 40_000_000n), reserve, heldUsdMicros: heldUsdMicros(ledger, NOW),
  });
  assert.equal(formatUsdMicros(secondAfter.availableUsdMicros), "10.00");
  assert.equal(formatUsdMicros(secondAfter.pendingUsdMicros), "30.00");
  assert.deepEqual(secondAfter.pendingReasons, ["AWAITING_RESERVE"]);

  /* And the pot refuses to be committed twice, whatever the page said. */
  const clash = await holdReserve(store, {
    claimId: "claim-b", wallet: B, usdMicros: 40_000_000n, treasuryUsdMicros: TREASURY, now: NOW,
  });
  assert.equal(clash.ok, false);
  assert.equal(clash.code, "INSUFFICIENT_RESERVE");
  assert.equal(formatUsdMicros(clash.freeUsdMicros), "10.00");
});

test("the sum of every hold never exceeds the treasury", async () => {
  const store = createMemoryGuardStore();
  const wallets = [A, B, "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "7YHhAcAAqQqU8qgxCsQqmDPqfbFwGyv5CGKPGZTfMfhX"];
  let granted = 0n;
  for (const [index, wallet] of wallets.entries()) {
    const result = await holdReserve(store, {
      claimId: `claim-${index}`, wallet, usdMicros: 20_000_000n, treasuryUsdMicros: TREASURY, now: NOW,
    });
    if (result.ok) granted += 20_000_000n;
  }
  /* $50 admits two holds of $20 and refuses the rest. */
  assert.equal(formatUsdMicros(granted), "40.00");
  assert.equal(heldUsdMicros(await readReserveLedger(store), NOW), granted);
  assert.ok(heldUsdMicros(await readReserveLedger(store), NOW) <= TREASURY);
});

test("concurrent holds are serialized, not both granted", async () => {
  const store = createMemoryGuardStore();
  /* Two claims for $30 against a $50 pot, launched together. Exactly one may
     win: the second sees the first's hold through compare-and-set. */
  const [one, two] = await Promise.all([
    holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 30_000_000n, treasuryUsdMicros: TREASURY, now: NOW }),
    holdReserve(store, { claimId: "c2", wallet: B, usdMicros: 30_000_000n, treasuryUsdMicros: TREASURY, now: NOW }),
  ]);
  assert.equal([one.ok, two.ok].filter(Boolean).length, 1);
  assert.equal(formatUsdMicros(heldUsdMicros(await readReserveLedger(store), NOW)), "30.00");
});

test("holding the same claim twice reserves once", async () => {
  const store = createMemoryGuardStore();
  const first = await holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 30_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  const again = await holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 30_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(again.ok, true);
  assert.equal(formatUsdMicros(heldUsdMicros(await readReserveLedger(store), NOW)), "30.00");
});

test("a payout that definitely did not happen gives the money back", async () => {
  const store = createMemoryGuardStore();
  await holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 30_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  await releaseReserve(store, "c1", NOW);
  assert.equal(heldUsdMicros(await readReserveLedger(store), NOW), 0n);
  /* Releasing again is a no-op rather than a correction. */
  await releaseReserve(store, "c1", NOW);
  assert.equal(heldUsdMicros(await readReserveLedger(store), NOW), 0n);
  /* And the freed money is offered to somebody else. */
  const next = await holdReserve(store, { claimId: "c2", wallet: B, usdMicros: 30_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  assert.equal(next.ok, true);
});

test("an unknown outcome keeps the money held", async () => {
  const store = createMemoryGuardStore();
  await holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 40_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  /* Nothing is released: the claim route calls neither release nor consume on
     SUBMITTED_UNKNOWN, and this is what that means for the pot. */
  assert.equal(formatUsdMicros(heldUsdMicros(await readReserveLedger(store), NOW)), "40.00");
  const other = await holdReserve(store, { claimId: "c2", wallet: B, usdMicros: 40_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  assert.equal(other.ok, false);
  /* Money that may already be gone is never offered to the next person. */
  assert.equal(formatUsdMicros(other.freeUsdMicros), "10.00");
});

test("a paid hold keeps counting until the chain can have caught up", async () => {
  const store = createMemoryGuardStore();
  await holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 40_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  await consumeReserve(store, "c1", NOW);
  const ledger = await readReserveLedger(store);

  /* Immediately after the payout the balance read still shows the old figure,
     so the hold must still count or the pot briefly appears to hold money that
     has already left. */
  assert.equal(formatUsdMicros(heldUsdMicros(ledger, NOW)), "40.00");
  assert.equal(formatUsdMicros(heldUsdMicros(ledger, LATER(SETTLE_WINDOW_MS - 1_000))), "40.00");

  /* Past the window the treasury read is authoritative again. */
  assert.equal(heldUsdMicros(ledger, LATER(SETTLE_WINDOW_MS + 1_000)), 0n);
});

test("a treasury drained below its holds offers nobody anything", async () => {
  const store = createMemoryGuardStore();
  await holdReserve(store, { claimId: "c1", wallet: A, usdMicros: 40_000_000n, treasuryUsdMicros: TREASURY, now: NOW });
  const ledger = await readReserveLedger(store);
  /* Somebody withdrew from the treasury by hand. */
  assert.equal(freeReserveUsdMicros({ treasuryUsdMicros: 1_000_000n, ledger, now: NOW }), 0n);
  const balance = rewardBalance({
    entries: owed(B, 40_000_000n),
    reserve: { state: "FUNDED", usdMicros: 1_000_000n, treasury: A, observedAt: NOW },
    heldUsdMicros: heldUsdMicros(ledger, NOW),
  });
  assert.equal(balance.availableUsdMicros, 0n);
  assert.equal(balance.claimable, false);
});

test("no treasury holds nothing and offers nothing, exactly as before", () => {
  const balance = rewardBalance({
    entries: owed(A, 40_000_000n),
    reserve: { state: "UNCONFIGURED", usdMicros: 0n, treasury: null, reason: "unset" },
    heldUsdMicros: 0n,
  });
  assert.equal(balance.availableUsdMicros, 0n);
  assert.equal(balance.claimable, false);
});

test("the open-hold count is capped rather than unbounded", () => {
  assert.equal(MAX_OPEN_HOLDS, 200);
  assert.ok(SETTLE_WINDOW_MS >= 60_000, "the settling window must outlast Solana confirmation by a margin");
});
