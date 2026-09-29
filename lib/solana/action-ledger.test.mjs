import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  bridgeOutcome,
  listSolanaWalletActions,
  recordSolanaAction,
  sendOutcome,
  solanaActionInMotion,
  solanaWalletActionKey,
  solanaWalletActionPrefix,
  swapOutcome,
} from "./action-ledger.ts";

const WALLET = "ATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzv3guu";
const SIGNATURE = "3".repeat(88);
const OTHER_SIGNATURE = "4".repeat(88);
const NOW = "2026-09-03T10:00:00.000Z";
const LATER = "2026-09-03T11:00:00.000Z";

function usdc(amountRaw) {
  return { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw, decimals: 6, symbol: "USDC" };
}

test("the wallet leads the key, and a prefix scan cannot read a longer address", async () => {
  /* Base58 addresses have no fixed length. A scan on `…:<wallet>` without the
     trailing separator would return the rows of every wallet whose address
     merely *starts* with this one — a cross-wallet read dressed as a list. */
  assert.equal(
    solanaWalletActionKey({ network: "mainnet", wallet: WALLET, actionId: SIGNATURE }),
    `solana:mainnet:${WALLET}:${SIGNATURE}`,
  );
  assert.equal(solanaWalletActionPrefix({ network: "mainnet", wallet: WALLET }), `solana:mainnet:${WALLET}:`);

  const store = createMemoryGuardStore();
  const longer = `${WALLET}9`;
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: longer,
    actionId: SIGNATURE,
    lane: "SEND",
    outcome: "DONE",
    now: NOW,
  });
  const mine = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  assert.deepEqual(mine.actions, [], "A wallet whose address extends mine must not appear in my history.");
});

test("one network's history is not another's", async () => {
  const store = createMemoryGuardStore();
  await recordSolanaAction(store, {
    network: "devnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SEND",
    outcome: "DONE",
    now: NOW,
  });
  const mainnet = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  assert.deepEqual(mainnet.actions, []);
});

test("an update that omits a leg keeps the one already recorded", async () => {
  /* The settle response names what arrived. If that write erased what left,
     the row would say a swap produced tokens out of nothing. */
  const store = createMemoryGuardStore();
  const first = await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SWAP",
    outcome: "IN_FLIGHT",
    out: usdc("2622093"),
    signature: SIGNATURE,
    now: NOW,
  });
  assert.equal(first.ok, true);

  const second = await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SWAP",
    outcome: "DONE",
    in: { mint: null, amountRaw: "25621005", decimals: 9, symbol: "SOL" },
    now: LATER,
  });
  assert.equal(second.ok, true);
  assert.equal(second.action.out.amountRaw, "2622093", "The outgoing leg was erased by an update that did not mention it.");
  assert.equal(second.action.in.symbol, "SOL");
  assert.equal(second.action.outcome, "DONE");
  assert.equal(second.action.version, 2);
  assert.equal(second.action.startedAt, NOW, "startedAt must keep the moment the action began, not the last update.");
  assert.equal(second.action.updatedAt, LATER);
});

test("a Spot origin is recorded on the row, kept by later updates, and absent on every row that never had one", async () => {
  const store = createMemoryGuardStore();
  const first = await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SWAP",
    outcome: "DONE",
    out: usdc("2622093"),
    in: { mint: null, amountRaw: "25621005", decimals: 9, symbol: "SOL" },
    signature: SIGNATURE,
    origin: { surface: "SPOT", side: "BUY" },
    now: NOW,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.action.origin, { surface: "SPOT", side: "BUY" });

  const second = await recordSolanaAction(store, { network: "mainnet", wallet: WALLET, actionId: SIGNATURE, lane: "SWAP", outcome: "DONE", now: LATER });
  assert.equal(second.ok, true);
  assert.deepEqual(second.action.origin, { surface: "SPOT", side: "BUY" }, "an update that does not mention the origin keeps it");

  const swap = await recordSolanaAction(store, { network: "mainnet", wallet: WALLET, actionId: OTHER_SIGNATURE, lane: "SWAP", outcome: "DONE", out: usdc("1"), signature: OTHER_SIGNATURE, now: NOW });
  assert.equal(swap.ok, true);
  assert.equal(swap.action.origin, null, "a Swap is a row with no origin, exactly like every row written before Spot");

  const refused = await recordSolanaAction(store, { network: "mainnet", wallet: WALLET, actionId: "5".repeat(88), lane: "SWAP", outcome: "DONE", origin: { surface: "PERPS", side: "BUY" }, now: NOW });
  assert.equal(refused.ok, false, "an origin the schema does not know is refused rather than written");
});

test("history is newest-first on the last update, so a claimable bridge outranks a later transfer", async () => {
  const store = createMemoryGuardStore();
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: "0x".concat("a".repeat(64)),
    lane: "BRIDGE",
    outcome: "NEEDS_YOU",
    destination: "BASE",
    now: NOW,
  });
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: OTHER_SIGNATURE,
    lane: "SEND",
    outcome: "DONE",
    signature: OTHER_SIGNATURE,
    now: NOW,
  });
  /* The bridge moves on: Circle attests today, long after the send. */
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: "0x".concat("a".repeat(64)),
    lane: "BRIDGE",
    outcome: "NEEDS_YOU",
    now: LATER,
  });

  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  assert.equal(listed.complete, true);
  assert.deepEqual(
    listed.actions.map((entry) => entry.lane),
    ["BRIDGE", "SEND"],
  );
});

test("a row that cannot be read is dropped and the list says so", async () => {
  const store = createMemoryGuardStore();
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SEND",
    outcome: "DONE",
    now: NOW,
  });
  await store
    .collection("solanaWalletActions")
    .set(`solana:mainnet:${WALLET}:corrupted-row`, { schema: "something else" });

  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  assert.equal(listed.actions.length, 1, "A malformed row must not be guessed at.");
  assert.equal(listed.complete, false, "Partial coverage has to be reportable — canon §0.6.");
});

test("a store that refuses does not throw at a money path", async () => {
  /* Every caller is a transfer that already happened. A history that can raise
     into a settle route is worse than a history with a hole in it. */
  const store = createMemoryGuardStore();
  const broken = {
    ...store,
    collection() {
      throw new Error("store is down");
    },
  };
  const result = await recordSolanaAction(broken, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SEND",
    outcome: "DONE",
    now: NOW,
  });
  assert.equal(result.ok, false);
});

test("a malformed input is refused rather than stored", async () => {
  const store = createMemoryGuardStore();
  const result = await recordSolanaAction(store, {
    network: "mainnet",
    wallet: "not-an-address",
    actionId: SIGNATURE,
    lane: "SEND",
    outcome: "DONE",
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "SOLANA_ACTION_MALFORMED");
});

test("an unresolved submit is never rendered as success or as failure", () => {
  /* The whole point of the submit-once boundary is that an unknown is not a
     licence to send again — and it is not a licence to say "failed" either. */
  for (const state of ["SUBMITTED_UNKNOWN", "RESERVED"]) {
    assert.equal(sendOutcome(state), "IN_FLIGHT", `Send ${state} must stay unresolved.`);
  }
  for (const state of ["SUBMITTED_UNKNOWN", "SIGNED", "REVIEW_ISSUED"]) {
    assert.equal(swapOutcome(state), "IN_FLIGHT", `Swap ${state} must stay unresolved.`);
  }
  for (const state of ["BURN_SUBMITTED_UNKNOWN", "BURN_CONFIRMED", "RESERVED"]) {
    assert.equal(bridgeOutcome(state), "IN_FLIGHT", `Bridge ${state} must stay unresolved.`);
  }

  assert.equal(sendOutcome("RECEIPTED"), "DONE");
  assert.equal(swapOutcome("RECEIPTED"), "DONE");
  assert.equal(bridgeOutcome("RECEIPTED"), "DONE");
  assert.equal(sendOutcome("LANDED_FAILED"), "FAILED");
  assert.equal(bridgeOutcome("BURN_REVERTED"), "FAILED");
});

test("an attempt whose block passed while the whole ledger never saw it did not happen, on either lane", () => {
  /* `EXPIRED_AFTER_SUBMIT` is written only after the recovery proved the bytes
     can never land. It is terminal, and terminal is not *needs you*: one such
     swap sat in History as an action item for a day. */
  assert.equal(swapOutcome("EXPIRED_AFTER_SUBMIT"), "FAILED");
  assert.equal(sendOutcome("EXPIRED_AFTER_SUBMIT"), "FAILED");
});

test("money waiting on the person is not called in flight", () => {
  /* ATTESTED means Circle has signed and the money is claimable on Base by a
     signature this person has not given. Telling them to wait would be telling
     them to wait for themselves. */
  assert.equal(bridgeOutcome("ATTESTED"), "NEEDS_YOU");
  assert.equal(bridgeOutcome("MINT_OBSERVED"), "NEEDS_YOU");
  assert.equal(bridgeOutcome("RECOVERY_REQUIRED"), "NEEDS_YOU");
  assert.equal(sendOutcome("RECOVERY_REQUIRED"), "NEEDS_YOU");
});

test("funds in motion covers everything unfinished, and nothing finished", () => {
  const base = {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "SEND",
    out: null,
    in: null,
    destination: null,
    signature: null,
    receiptHash: null,
    startedAt: NOW,
    updatedAt: NOW,
  };
  assert.equal(solanaActionInMotion({ ...base, outcome: "IN_FLIGHT" }), true);
  assert.equal(solanaActionInMotion({ ...base, outcome: "NEEDS_YOU" }), true);
  assert.equal(solanaActionInMotion({ ...base, outcome: "DONE" }), false);
  assert.equal(solanaActionInMotion({ ...base, outcome: "FAILED" }), false);
});

/**
 * The write that failed in silence, and why it is worth a test of its own.
 *
 * `recordSolanaAction` promises never to throw: every caller is a money path
 * that has already done the thing being recorded, so a history that could fail
 * a transfer would be worse than a history with a hole in it. The cost of that
 * promise is that a malformed row disappears without a sound.
 *
 * One did. The Base → Solana lane wrote its in-flight row with the Base
 * transaction hash in `signature`, a field that holds a Solana signature —
 * base58, and so unable to contain a `0`. Every such write was rejected by the
 * row's own schema and swallowed, so money moving from Base was invisible in
 * History for the whole time it was in motion, and the only row either transfer
 * ever had was the terminal one. Read from production on 2026-09-04.
 *
 * The shapes are pinned here so the next lane to reach for this field learns it
 * from a test rather than from a screen with nothing on it.
 */
test("an EVM transaction hash cannot be a Solana signature, and the row says so", async () => {
  const store = createMemoryGuardStore();
  const base = {
    network: "mainnet",
    wallet: "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n",
    lane: "BRIDGE",
    outcome: "IN_FLIGHT",
    destination: "SOLANA",
    now: new Date().toISOString(),
  };

  const evm = await recordSolanaAction(store, {
    ...base,
    actionId: "0x" + "a".repeat(64),
    signature: "0x13496580031b7c7dc9a868a34189f666e0b391e3f12a43cc5c29bab226423092",
  });
  assert.equal(evm.ok, false, "a Base hash was accepted into the Solana signature field");
  assert.equal(evm.reason, "SOLANA_ACTION_MALFORMED");

  /* And the same row without it is written, which is what the lane now does:
     the Solana signature does not exist until the mint lands. */
  const withoutIt = await recordSolanaAction(store, { ...base, actionId: "0x" + "b".repeat(64) });
  assert.equal(withoutIt.ok, true, "a bridge row in flight cannot be recorded at all");
  assert.equal(withoutIt.action.destination, "SOLANA");
  assert.equal(withoutIt.action.signature, null);
});

/* ── What an operation cost, `RYN-MONEY-RECEIPT-PARITY-001` ──────────────── */

test("a row written before fees existed still reads, with nothing invented", async () => {
  /* The two real fills of 2026-09-11 are exactly these rows: written without
     `fee`, `sourceTx` or `destinationTx`, and the ones that most need them.
     A schema that refused them would have taken a wallet's whole history out
     of Activity — which is how the `RECEIVE` and `CROSS_SWAP` lanes each broke
     it once already. */
  const store = createMemoryGuardStore();
  const key = solanaWalletActionKey({ network: "mainnet", wallet: WALLET, actionId: SIGNATURE });
  await store.versioned("solanaWalletActions").compareAndSet(key, null, {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "CROSS_SWAP",
    outcome: "DONE",
    out: usdc("5020909"),
    in: null,
    destination: "SOLANA",
    signature: null,
    receiptHash: null,
    startedAt: NOW,
    updatedAt: NOW,
  });

  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  assert.equal(listed.complete, true, "an old row must not report the history as incomplete");
  assert.equal(listed.actions.length, 1);
  assert.equal(listed.actions[0].fee, null);
  assert.equal(listed.actions[0].sourceTx, null);
  assert.equal(listed.actions[0].destinationTx, null);
});

test("a later read fills in the fee and both chains' transactions without erasing the legs", async () => {
  const store = createMemoryGuardStore();
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "CROSS_SWAP",
    outcome: "DONE",
    out: usdc("5020909"),
    destination: "SOLANA",
    now: NOW,
  });
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "CROSS_SWAP",
    outcome: "DONE",
    sourceTx: `0x${"c".repeat(64)}`,
    destinationTx: OTHER_SIGNATURE,
    fee: { collected: true, basisPoints: 25, amountRaw: "12552", decimals: 6, symbol: "USDC", usd: 0.01255 },
    now: LATER,
  });

  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  const row = listed.actions[0];
  assert.deepEqual(row.out, usdc("5020909"), "an update that carried no leg erased one");
  assert.equal(row.sourceTx, `0x${"c".repeat(64)}`);
  assert.equal(row.destinationTx, OTHER_SIGNATURE);
  assert.equal(row.fee.collected, true);
  assert.equal(row.fee.amountRaw, "12552");
  assert.equal(row.fee.symbol, "USDC");
});

test("a fee that was quoted and not collected is recorded as exactly that", async () => {
  /* Relay documents an operation shape that collects nothing and reports no
     error, so `collected: false` is a real answer the row has to be able to
     hold — and every surface reads that flag before showing a number. */
  const store = createMemoryGuardStore();
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: WALLET,
    actionId: SIGNATURE,
    lane: "CROSS_SWAP",
    outcome: "DONE",
    fee: { collected: false, basisPoints: 25, amountRaw: null, decimals: 6, symbol: "USDC", usd: 0.01 },
    now: NOW,
  });
  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  assert.equal(listed.actions[0].fee.collected, false);
  assert.equal(listed.actions[0].fee.amountRaw, null);
});

test("the rows the activity route serves are the contract's shape on the wire, whatever the lane (1.11.0)", async () => {
  const { ActivityActionSchema, ActivityResponseSchema } = await import("../api/v1/contract.ts");
  const store = createMemoryGuardStore();
  await recordSolanaAction(store, { network: "mainnet", wallet: WALLET, actionId: SIGNATURE, lane: "SWAP", outcome: "DONE", out: usdc("2622093"), in: { mint: null, amountRaw: "25621005", decimals: 9, symbol: "SOL" }, signature: SIGNATURE, origin: { surface: "SPOT", side: "BUY" }, now: NOW });
  await recordSolanaAction(store, { network: "mainnet", wallet: WALLET, actionId: OTHER_SIGNATURE, lane: "SEND", outcome: "IN_FLIGHT", out: usdc("1000000"), signature: OTHER_SIGNATURE, now: LATER });
  const listed = await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET });
  const actions = listed.actions.map((row) => JSON.parse(JSON.stringify(row)));
  assert.equal(actions.length, 2);
  for (const action of actions) {
    const parsed = ActivityActionSchema.safeParse(action);
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "));
  }
  /* As the route composes it: rewards null for a request without the owner's proof. */
  assert.equal(ActivityResponseSchema.safeParse({ data: { actions, rewards: null, complete: true, coverage: "RYNTRA_ACTIONS" } }).success, true);
});
