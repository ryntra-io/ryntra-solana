import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { recordSolanaAction } from "../solana/action-ledger.ts";
import { addInternalWallet, isInternalWalletAddress } from "./internal-wallets.ts";
import { projectSeenWallets } from "./seen-wallets.ts";
import { readSeenWallets } from "./seen-wallets.server.ts";
import { recordWalletSeen } from "./wallet-presence.ts";

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const EVM = "0x152D117c0CFdD2E807A4e7Cc4D839DA9586EC401";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const NOW = "2026-09-11T12:00:00.000Z";

const action = (wallet, actionId, lane, outcome, at) => ({
  schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet, actionId, lane, outcome,
  out: null, in: null, destination: null, signature: null, receiptHash: null, sourceTx: null, destinationTx: null, fee: null, origin: null,
  startedAt: at, updatedAt: at,
});

test("every wallet the product saw is one row, with what it did, marked or not", () => {
  const model = projectSeenWallets({
    now: NOW,
    presence: [{ wallet: A, firstSeenAt: "2026-09-03T00:00:00.000Z", lastSeenAt: "2026-09-11T10:00:00.000Z", sessions: 9, firstVerifiedAt: null, lastVerifiedAt: null, verifications: 0 }],
    actions: [
      action(A, SIG, "SWAP", "DONE", "2026-09-10T00:00:00.000Z"),
      action(A, SIG, "SWAP", "DONE", "2026-09-10T00:00:00.000Z"),
      action(A, "0xabc123", "CROSS_SWAP", "IN_FLIGHT", "2026-09-11T11:00:00.000Z"),
      action(B, "0xdef456", "SEND", "DONE", "2026-09-05T00:00:00.000Z"),
    ],
    accounts: [{ wallet: B, referrer: A, createdAt: "2026-09-04T00:00:00.000Z" }],
    internal: [{ wallet: A, label: "Phantom", addedAt: NOW }, { wallet: EVM, label: "EVM-міст", addedAt: NOW }],
    fromEnv: [],
  });
  assert.equal(model.internalCount, 2);
  assert.deepEqual(model.rows.map((row) => [row.masked, row.kind, row.internal]), [
    ["6dNV…XbLp", "solana", true],
    ["3Ejk…XZQL", "solana", false],
    ["0x15…C401", "evm", true],
  ]);
  const a = model.rows[0];
  assert.equal(a.operations, 1, "the same action id twice is one operation");
  assert.equal(a.open, 1);
  assert.deepEqual(a.lanes, { SWAP: 1 });
  assert.equal(a.sessions, 9);
  assert.equal(a.firstSeenAt, "2026-09-03T00:00:00.000Z");
  assert.equal(a.lastActiveAt, "2026-09-11T11:00:00.000Z");
  assert.equal(a.label, "Phantom");
  const b = model.rows[1];
  assert.equal(b.invitedBy, "6dNV…XbLp");
  assert.equal(b.firstSeenAt, "2026-09-04T00:00:00.000Z", "the reward account is the earliest sighting");
  assert.equal(model.rows[2].lastActiveAt, null, "an EVM note has no activity of its own");
});

test("a configured address is listed as internal and cannot be unmarked on the page", () => {
  const model = projectSeenWallets({ now: NOW, presence: [], actions: [], accounts: [], internal: [], fromEnv: [B] });
  assert.deepEqual(model.rows.map((row) => [row.wallet, row.internal, row.fromEnv]), [[B, true, true]]);
});

test("the list accepts a Solana or an EVM address and refuses anything else", () => {
  assert.equal(isInternalWalletAddress(A), true);
  assert.equal(isInternalWalletAddress(EVM), true);
  assert.equal(isInternalWalletAddress("0x1234"), false);
  assert.equal(isInternalWalletAddress("not-a-wallet"), false);
  assert.equal(isInternalWalletAddress(null), false);
});

test("the server read joins presence, the ledger and the list", async () => {
  const store = createMemoryGuardStore();
  await recordWalletSeen(store, { wallet: A, now: NOW });
  await recordSolanaAction(store, { network: "mainnet", wallet: A, actionId: SIG, lane: "SWAP", outcome: "DONE", now: NOW });
  assert.equal((await addInternalWallet(store, { wallet: EVM, label: "EVM", now: NOW })).ok, true);
  const read = await readSeenWallets(store, { now: NOW, env: {} });
  assert.deepEqual(read.unavailable, []);
  assert.deepEqual(read.model.rows.map((row) => [row.masked, row.internal, row.operations]), [
    ["6dNV…XbLp", false, 1],
    ["0x15…C401", true, 0],
  ]);
});
