import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createFileGuardStore, createMemoryGuardStore } from "../guard/store.ts";
import {
  commitSolanaCanarySpend,
  expireSolanaCanaryBeforeSubmit,
  markSolanaCanarySubmitUnknown,
  readSolanaCanaryBudget,
  readSolanaCanaryIntent,
  releaseSolanaCanaryReservation,
  reserveSolanaCanaryIntent,
} from "./canary-ledger.ts";
import {
  resolveSolanaCanaryPolicy,
  SOLANA_MAINNET_USDC_MINT,
  SolanaCanaryIntentSchema,
} from "./canary-policy.ts";
import { TOKEN_PROGRAM_ID } from "./send-kinds.ts";

const DESTINATION = "ATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzv3guu";
const NOW = "2026-08-27T15:00:00.000Z";
const SIGNATURE = "3".repeat(88);

function policy(state = "OPEN") {
  const resolved = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_STATE: state,
    RYNTRA_SOLANA_CANARY_DESTINATIONS: DESTINATION,
  });
  assert.equal(resolved.ok, true);
  return resolved.policy;
}

function intent(id, usdMicros = "1000000") {
  return SolanaCanaryIntentSchema.parse({
    schema: "ryntra.solana.canary-intent",
    schemaVersion: "1.0.0",
    intentId: id,
    revision: 1,
    family: "SEND",
    network: "mainnet",
    destination: DESTINATION,
    mints: [SOLANA_MAINNET_USDC_MINT],
    programs: [TOKEN_PROGRAM_ID],
    principalUsdMicros: usdMicros,
    feeReserveUsdMicros: "0",
    usdMicros,
    valuation: {
      method: "USDC_NOMINAL",
      sourceRef: "solana:mainnet:mint:usdc",
      observedAt: NOW,
      validUntil: "2026-08-27T15:01:00.000Z",
    },
    humanApproval: "RECORDED",
  });
}

test("a reserved and committed intent survives a durable store reload", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "ryntra-solana-canary-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const firstStore = createFileGuardStore({ directory });
  const reserved = await reserveSolanaCanaryIntent({
    store: firstStore,
    policy: policy(),
    intent: intent("int_reload_1"),
    now: new Date(NOW),
  });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.record.state, "RESERVED");

  const committed = await commitSolanaCanarySpend({
    store: firstStore,
    policy: policy(),
    idempotencyKey: reserved.record.idempotencyKey,
    signature: SIGNATURE,
    at: "2026-08-27T15:00:20.000Z",
  });
  assert.equal(committed.ok, true);
  await firstStore.close?.();

  const reloadedStore = createFileGuardStore({ directory });
  const snapshot = await readSolanaCanaryBudget({ store: reloadedStore, policy: policy(), now: new Date(NOW) });
  assert.equal(snapshot.readState, "AVAILABLE");
  assert.equal(snapshot.storeBoundary, "DURABLE_SINGLE_WRITER");
  assert.equal(snapshot.reservedUsdMicros, "0");
  assert.equal(snapshot.spentUsdMicros, "1000000");

  const record = await readSolanaCanaryIntent({ store: reloadedStore, idempotencyKey: reserved.record.idempotencyKey });
  assert.equal(record?.state, "COMMITTED");
  assert.equal(record?.signature, SIGNATURE);
  await reloadedStore.close?.();
});

test("the same intent revision is claimed once and never re-reserved", async () => {
  const store = createMemoryGuardStore();
  const first = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_once_1"), now: new Date(NOW) });
  assert.equal(first.ok, true);

  const duplicate = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_once_1"), now: new Date(NOW) });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "DUPLICATE_INTENT");
  assert.equal(duplicate.record.state, "RESERVED");
});

test("concurrent reservations cannot overrun the family ceiling", async () => {
  const store = createMemoryGuardStore();
  const [left, right] = await Promise.all([
    reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_race_left", "600000"), now: new Date(NOW) }),
    reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_race_right", "600000"), now: new Date(NOW) }),
  ]);
  assert.equal([left, right].filter((result) => result.ok).length, 1);
  const refused = [left, right].find((result) => !result.ok);
  assert.equal(refused?.code, "POLICY_REFUSED");
  assert.equal(refused?.verdict.decision, "BLOCK");

  const snapshot = await readSolanaCanaryBudget({ store, policy: policy(), now: new Date(NOW) });
  assert.equal(snapshot.reservedUsdMicros, "600000");
  assert.equal(snapshot.families.SEND.reservedUsdMicros, "600000");
});

test("the package ledger includes fee reserve while family exposure counts principal", async () => {
  const store = createMemoryGuardStore();
  const feeAware = SolanaCanaryIntentSchema.parse({
    ...intent("int_fee_aware", "625000"),
    principalUsdMicros: "600000",
    feeReserveUsdMicros: "25000",
    usdMicros: "625000",
  });
  const reserved = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: feeAware, now: new Date(NOW) });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.snapshot.reservedUsdMicros, "625000");
  assert.equal(reserved.snapshot.families.SEND.reservedUsdMicros, "600000");

  const committed = await commitSolanaCanarySpend({
    store,
    policy: policy(),
    idempotencyKey: reserved.record.idempotencyKey,
    signature: SIGNATURE,
    at: "2026-08-27T15:00:20.000Z",
  });
  assert.equal(committed.ok, true);
  const snapshot = await readSolanaCanaryBudget({ store, policy: policy(), now: new Date(NOW) });
  assert.equal(snapshot.spentUsdMicros, "625000");
  assert.equal(snapshot.families.SEND.spentUsdMicros, "600000");
});

test("an undetermined submit remains exposure and cannot be released or retried", async () => {
  const store = createMemoryGuardStore();
  const reserved = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_unknown_1"), now: new Date(NOW) });
  assert.equal(reserved.ok, true);

  const unknown = await markSolanaCanarySubmitUnknown({
    store,
    idempotencyKey: reserved.record.idempotencyKey,
    signature: SIGNATURE,
    at: "2026-08-27T15:00:10.000Z",
  });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.record.state, "SUBMITTED_UNKNOWN");

  const release = await releaseSolanaCanaryReservation({
    store,
    policy: policy(),
    idempotencyKey: reserved.record.idempotencyKey,
    at: "2026-08-27T15:00:20.000Z",
  });
  assert.equal(release.ok, false);
  assert.equal(release.code, "STATE_REFUSED");

  const duplicate = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_unknown_1"), now: new Date(NOW) });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "DUPLICATE_INTENT");

  const snapshot = await readSolanaCanaryBudget({ store, policy: policy(), now: new Date(NOW) });
  assert.equal(snapshot.reservedUsdMicros, "1000000");
  assert.equal(snapshot.spentUsdMicros, "0");
});

test("only an external exact-blockhash expiry proof can release submitted-unknown exposure before broadcast", async () => {
  const store = createMemoryGuardStore();
  const reserved = await reserveSolanaCanaryIntent({
    store,
    policy: policy(),
    intent: intent("int_expired_before_submit"),
    now: new Date(NOW),
  });
  assert.equal(reserved.ok, true);
  assert.equal((await markSolanaCanarySubmitUnknown({
    store,
    idempotencyKey: reserved.record.idempotencyKey,
    signature: SIGNATURE,
    at: "2026-08-27T15:00:10.000Z",
  })).ok, true);
  const expired = await expireSolanaCanaryBeforeSubmit({
    store,
    policy: policy(),
    idempotencyKey: reserved.record.idempotencyKey,
    signature: SIGNATURE,
    at: "2026-08-27T15:02:00.000Z",
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.record.state, "RELEASED");
  const snapshot = await readSolanaCanaryBudget({ store, policy: policy(), now: new Date(NOW) });
  assert.equal(snapshot.reservedUsdMicros, "0");
  assert.equal(snapshot.spentUsdMicros, "0");
});

test("the kill switch blocks new reservations but leaves prior records readable", async () => {
  const store = createMemoryGuardStore();
  const existing = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_readable_1"), now: new Date(NOW) });
  assert.equal(existing.ok, true);

  const paused = await reserveSolanaCanaryIntent({
    store,
    policy: policy("PAUSED"),
    intent: intent("int_paused_2"),
    now: new Date(NOW),
  });
  assert.equal(paused.ok, false);
  assert.equal(paused.code, "POLICY_REFUSED");
  assert.equal(paused.verdict.decision, "PAUSE");

  const stillReadable = await readSolanaCanaryIntent({ store, idempotencyKey: existing.record.idempotencyKey });
  assert.equal(stillReadable?.state, "RESERVED");
  const snapshot = await readSolanaCanaryBudget({ store, policy: policy("PAUSED"), now: new Date(NOW) });
  assert.equal(snapshot.reservedUsdMicros, "1000000");
});

test("malformed durable state is unavailable, never interpreted as an empty ledger", async () => {
  const store = createMemoryGuardStore();
  await store.collection("solanaCanaryLedger").set("owner-mainnet-canary-v1", { broken: true });

  const snapshot = await readSolanaCanaryBudget({ store, policy: policy(), now: new Date(NOW) });
  assert.equal(snapshot.readState, "UNAVAILABLE");
  assert.equal(snapshot.storeBoundary, "UNAVAILABLE");

  const refused = await reserveSolanaCanaryIntent({ store, policy: policy(), intent: intent("int_bad_store"), now: new Date(NOW) });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "POLICY_REFUSED");
  assert.equal(refused.verdict.decision, "UNKNOWN");
});
