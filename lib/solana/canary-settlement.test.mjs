import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  readSolanaCanaryBudget,
  readSolanaCanaryIntent,
  solanaCanaryIdempotencyKey,
} from "./canary-ledger.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_CANARY_APPROVAL_ENV,
  SOLANA_MAINNET_USDC_MINT,
  SolanaCanaryIntentSchema,
  evaluateSolanaCanaryIntent,
  resolveSolanaCanaryPolicy,
} from "./canary-policy.ts";
import { settleCanaryTransfer } from "./canary-settlement.ts";
import { TOKEN_PROGRAM_ID } from "./send-kinds.ts";
import { canSubmitSendAction } from "./send-safety.ts";

const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const NOW = new Date("2026-08-28T00:00:30.000Z");
const SIGNATURE = "3".repeat(88);

function policy() {
  const resolved = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_STATE: "OPEN",
    [SOLANA_CANARY_APPROVAL_ENV.ataRecipient]: RECIPIENT,
    [SOLANA_CANARY_APPROVAL_ENV.ataAmountRaw]: "500000",
    [SOLANA_CANARY_APPROVAL_ENV.ataApprovalRef]: "owner:decision:2026-08-28:RYN-SOL-M1B",
  });
  assert.equal(resolved.ok, true);
  return resolved.policy;
}

function intent() {
  return SolanaCanaryIntentSchema.parse({
    schema: "ryntra.solana.canary-intent",
    schemaVersion: "1.0.0",
    intentId: "send:0x" + "4".repeat(64),
    revision: 1,
    family: "ATA_CREATE",
    network: "mainnet",
    destination: RECIPIENT,
    mints: [SOLANA_MAINNET_USDC_MINT],
    programs: [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID].sort(),
    principalUsdMicros: "500000",
    feeReserveUsdMicros: "204428",
    usdMicros: "704428",
    valuation: {
      method: "PROVIDER_QUOTE",
      sourceRef: "jupiter:mainnet:price:SOL",
      observedAt: "2026-08-28T00:00:00.000Z",
      validUntil: "2026-08-28T00:01:00.000Z",
    },
    humanApproval: "RECORDED",
  });
}

async function fixture() {
  const store = createMemoryGuardStore();
  const currentPolicy = policy();
  const currentIntent = intent();
  const budget = await readSolanaCanaryBudget({ store, policy: currentPolicy, now: NOW });
  const canaryVerdict = evaluateSolanaCanaryIntent({
    policy: currentPolicy,
    budget,
    intent: currentIntent,
    now: NOW,
  });
  assert.equal(canaryVerdict.decision, "ALLOW");
  const validated = {
    ok: true,
    canaryIntent: currentIntent,
    canaryVerdict,
    check: { signature: { value: SIGNATURE } },
  };
  const idempotencyKey = solanaCanaryIdempotencyKey({
    policyId: currentPolicy.policyId,
    intentId: currentIntent.intentId,
    revision: currentIntent.revision,
  });
  return { store, currentPolicy, validated, idempotencyKey };
}

test("mainnet submission follows the safety verdict, not the shape of the action", () => {
  /* This used to admit exactly `TOKEN_ATA_CREATE` and refuse the other three,
     because that was the one canary M1B had run. An allowlist of shapes says
     "this looks like the transfer we once did", never "this transfer was
     proven safe" — and it refused every ordinary send. */
  for (const decision of ["ALLOW", "REVIEW"]) {
    assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision } }), true);
  }
  for (const decision of ["BLOCK", "UNKNOWN", "PAUSE"]) {
    assert.equal(canSubmitSendAction({ network: "mainnet", safety: { decision } }), false);
  }
});

test("the durable state crosses RESERVED to SUBMITTED_UNKNOWN before submit and COMMITTED after landing", async () => {
  const { store, currentPolicy, validated, idempotencyKey } = await fixture();
  const events = [];
  let settleCalls = 0;
  const first = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: currentPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async ({ beforeSubmit }) => {
      settleCalls += 1;
      events.push((await readSolanaCanaryIntent({ store, idempotencyKey })).state);
      await beforeSubmit();
      events.push((await readSolanaCanaryIntent({ store, idempotencyKey })).state);
      return {
        ok: true,
        state: "RECEIPTED",
        landingState: "CONFIRMED",
        signature: SIGNATURE,
        receipt: { id: "receipt" },
      };
    },
  });
  assert.equal(first.ok, true);
  events.push((await readSolanaCanaryIntent({ store, idempotencyKey })).state);
  assert.deepEqual(events, ["RESERVED", "SUBMITTED_UNKNOWN", "COMMITTED"]);

  const duplicate = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: currentPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async () => {
      settleCalls += 1;
      throw new Error("a duplicate must never reach settlement");
    },
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "DUPLICATE_INTENT");
  assert.equal(settleCalls, 1);
});

test("an unknown submit remains durable exposure and is never released for retry", async () => {
  const { store, currentPolicy, validated, idempotencyKey } = await fixture();
  const result = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: currentPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async ({ beforeSubmit }) => {
      await beforeSubmit();
      return { ok: true, state: "UNKNOWN", signature: SIGNATURE, receipt: null };
    },
  });
  assert.equal(result.ok, true);
  assert.equal((await readSolanaCanaryIntent({ store, idempotencyKey })).state, "SUBMITTED_UNKNOWN");
  const budget = await readSolanaCanaryBudget({ store, policy: currentPolicy, now: NOW });
  assert.equal(budget.reservedUsdMicros, "704428");
  assert.equal(budget.spentUsdMicros, "0");
});

test("a landed transaction commits exposure even when receipt minting later fails", async () => {
  const { store, currentPolicy, validated, idempotencyKey } = await fixture();
  const result = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: currentPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async ({ beforeSubmit }) => {
      await beforeSubmit();
      return {
        ok: false,
        code: "RECEIPT_MINT_FAILED",
        reason: "The chain landed but the receipt did not mint.",
        signature: SIGNATURE,
        landingState: "CONFIRMED",
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal((await readSolanaCanaryIntent({ store, idempotencyKey })).state, "COMMITTED");
  const budget = await readSolanaCanaryBudget({ store, policy: currentPolicy, now: NOW });
  assert.equal(budget.reservedUsdMicros, "0");
  assert.equal(budget.spentUsdMicros, "704428");
});

test("a post-boundary failure returns the locally verified signature for recovery", async () => {
  const { store, currentPolicy, validated, idempotencyKey } = await fixture();
  const result = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: currentPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async ({ beforeSubmit }) => {
      await beforeSubmit();
      return {
        ok: false,
        code: "RPC_REFUSED",
        reason: "The RPC did not return a transaction signature.",
        signature: null,
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.signature, SIGNATURE);
  assert.equal((await readSolanaCanaryIntent({ store, idempotencyKey })).state, "SUBMITTED_UNKNOWN");
});

test("a refusal before the submit boundary releases budget but keeps the intent claimed", async () => {
  const { store, currentPolicy, validated, idempotencyKey } = await fixture();
  const result = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: currentPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async () => ({
      ok: false,
      code: "PLAN_EXPIRED",
      reason: "Build a fresh plan.",
      signature: null,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PLAN_EXPIRED");
  assert.equal((await readSolanaCanaryIntent({ store, idempotencyKey })).state, "RELEASED");
  const budget = await readSolanaCanaryBudget({ store, policy: currentPolicy, now: NOW });
  assert.equal(budget.reservedUsdMicros, "0");
});

test("a changed current policy releases the reservation before any submit callback", async () => {
  const { store, currentPolicy, validated, idempotencyKey } = await fixture();
  const changedPolicy = {
    ...currentPolicy,
    source: { ...currentPolicy.source, label: "A materially changed policy" },
  };
  let settled = false;
  const result = await settleCanaryTransfer({
    request: {},
    trustedPublicKey: "test-key",
    policy: changedPolicy,
    store,
    now: NOW,
    validate: () => validated,
    settle: async () => {
      settled = true;
      throw new Error("a changed policy must not settle");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "POLICY_CHANGED");
  assert.equal(settled, false);
  assert.equal((await readSolanaCanaryIntent({ store, idempotencyKey })).state, "RELEASED");
});
