import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_CANARY_APPROVAL_ENV,
  SOLANA_MAINNET_USDC_MINT,
  SolanaCanaryBudgetSnapshotSchema,
  evaluateSolanaCanaryIntent,
  resolveSolanaCanaryPolicy,
} from "./canary-policy.ts";
import {
  buildSendCanaryIntent,
  resolveSendCanaryHumanApproval,
} from "./canary-send.ts";
import { buildSendCanaryValuation } from "./canary-valuation.ts";
import { TOKEN_PROGRAM_ID } from "./send-kinds.ts";
import {
  COMPUTE_BUDGET_PROGRAM,
  LIGHTHOUSE_PROGRAM,
} from "./wallet-modification.ts";

const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const OTHER_RECIPIENT = "8ZMFdT8Wk3g6VcdbTY8XJMtfvLK5gbPQaxvM2Y8tqnR5";
const SENDER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const OBSERVED_AT = "2026-08-28T00:00:00.000Z";
const APPROVAL_REF = "owner:decision:2026-08-28:RYN-SOL-M1B";

function ataPlan(overrides = {}) {
  return {
    actionKind: "TOKEN_ATA_CREATE",
    network: "mainnet",
    mint: SOLANA_MAINNET_USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    decimals: 6,
    sender: SENDER,
    recipient: RECIPIENT,
    senderTokenAccount: "A1zy4x9gLVAvDB62AZnYy9XJYKsMLu8Z4JZ47DgMHkiP",
    recipientTokenAccount: "2tmJTzMgC7rV9Ndy7zhcsrxLCmoWVGA8D8zoBzmZfVxG",
    createsRecipientAccount: true,
    ataRentLamports: "2039280",
    amountRaw: "500000",
    senderBalanceRaw: "1574590",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    programs: [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID],
    blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    lastValidBlockHeight: "350000000",
    unsignedWireBase64: "A".repeat(128),
    fingerprint: {
      messageHash: "0x" + "4".repeat(64),
      network: "mainnet",
      feePayer: SENDER,
      blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
      instructionCount: 2,
      transfer: {
        programAddress: TOKEN_PROGRAM_ID,
        source: "A1zy4x9gLVAvDB62AZnYy9XJYKsMLu8Z4JZ47DgMHkiP",
        mint: SOLANA_MAINNET_USDC_MINT,
        destination: "2tmJTzMgC7rV9Ndy7zhcsrxLCmoWVGA8D8zoBzmZfVxG",
        authority: SENDER,
        amountRaw: "500000",
        decimals: 6,
      },
    },
    builtAt: OBSERVED_AT,
    ...overrides,
  };
}

function exactEnv(overrides = {}) {
  return {
    RYNTRA_SOLANA_CANARY_STATE: "OPEN",
    [SOLANA_CANARY_APPROVAL_ENV.ataRecipient]: RECIPIENT,
    [SOLANA_CANARY_APPROVAL_ENV.ataAmountRaw]: "500000",
    [SOLANA_CANARY_APPROVAL_ENV.ataApprovalRef]: APPROVAL_REF,
    ...overrides,
  };
}

test("the exact 0.5 USDC ATA action values principal plus SOL fee and rent with integer arithmetic", () => {
  assert.deepEqual(
    buildSendCanaryValuation({
      plan: ataPlan(),
      solUsdPrice: "100",
      sourceRef: "jupiter:mainnet:price:SOL",
      observedAt: OBSERVED_AT,
    }),
    {
      principalUsdMicros: "500000",
      feeReserveUsdMicros: "204428",
      usdMicros: "704428",
      valuation: {
        method: "PROVIDER_QUOTE",
        sourceRef: "jupiter:mainnet:price:SOL",
        observedAt: OBSERVED_AT,
        validUntil: "2026-08-28T00:01:00.000Z",
      },
    },
  );
});

test("a fractional micro-dollar fee is rounded upward and priority lamports are included", () => {
  const valued = buildSendCanaryValuation({
    plan: ataPlan({
      actionKind: "SPL_TRANSFER_CHECKED",
      createsRecipientAccount: false,
      ataRentLamports: null,
      baseFeeLamports: "1",
      priorityFeeLamports: "1",
      programs: [TOKEN_PROGRAM_ID],
    }),
    solUsdPrice: "0.1",
    sourceRef: "jupiter:mainnet:price:SOL",
    observedAt: OBSERVED_AT,
  });
  assert.equal(valued.feeReserveUsdMicros, "1");
  assert.equal(valued.usdMicros, "500001");
});

test("valuation rejects invented or ambiguous provider facts", () => {
  for (const solUsdPrice of ["0", "-1", "1e2", "01", "1.1234567890123456789", "NaN"]) {
    assert.throws(
      () =>
        buildSendCanaryValuation({
          plan: ataPlan(),
          solUsdPrice,
          sourceRef: "jupiter:mainnet:price:SOL",
          observedAt: OBSERVED_AT,
        }),
      /price/i,
    );
  }
  assert.throws(
    () =>
      buildSendCanaryValuation({
        plan: ataPlan({ mint: OTHER_RECIPIENT }),
        solUsdPrice: "100",
        sourceRef: "jupiter:mainnet:price:SOL",
        observedAt: OBSERVED_AT,
      }),
    /USDC/i,
  );
  assert.throws(
    () =>
      buildSendCanaryValuation({
        plan: ataPlan(),
        solUsdPrice: "100",
        sourceRef: "jupiter:mainnet:price:SOL",
        observedAt: "2026-08-28",
      }),
    /time/i,
  );
});

test("human approval is derived only from the complete exact M1B tuple", () => {
  assert.equal(resolveSendCanaryHumanApproval(ataPlan(), exactEnv()), "RECORDED");
  for (const nearMiss of [
    ataPlan({ amountRaw: "500001" }),
    ataPlan({ recipient: OTHER_RECIPIENT }),
    ataPlan({ actionKind: "SPL_TRANSFER_CHECKED", createsRecipientAccount: false, ataRentLamports: null }),
    ataPlan({ tokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID }),
    ataPlan({ programs: [TOKEN_PROGRAM_ID] }),
  ]) {
    assert.equal(resolveSendCanaryHumanApproval(nearMiss, exactEnv()), "NOT_RECORDED");
  }
  assert.equal(resolveSendCanaryHumanApproval(ataPlan(), {}), "NOT_RECORDED");
});

test("the exact Phantom guard pair keeps M1B approval and reserves its repriced fee", () => {
  const guarded = ataPlan({
    priorityFeeLamports: "75000",
    programs: [
      COMPUTE_BUDGET_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      LIGHTHOUSE_PROGRAM,
    ],
  });
  assert.equal(resolveSendCanaryHumanApproval(guarded, exactEnv()), "RECORDED");
  assert.deepEqual(
    buildSendCanaryValuation({
      plan: guarded,
      solUsdPrice: "100",
      sourceRef: "jupiter:mainnet:price:SOL",
      observedAt: OBSERVED_AT,
    }),
    {
      principalUsdMicros: "500000",
      feeReserveUsdMicros: "211928",
      usdMicros: "711928",
      valuation: {
        method: "PROVIDER_QUOTE",
        sourceRef: "jupiter:mainnet:price:SOL",
        observedAt: OBSERVED_AT,
        validUntil: "2026-08-28T00:01:00.000Z",
      },
    },
  );
});

test("partial or malformed server approval configuration fails closed", () => {
  assert.throws(
    () =>
      resolveSendCanaryHumanApproval(ataPlan(), {
        [SOLANA_CANARY_APPROVAL_ENV.ataRecipient]: RECIPIENT,
      }),
    /complete/i,
  );
  assert.throws(
    () =>
      resolveSendCanaryHumanApproval(
        ataPlan(),
        exactEnv({ [SOLANA_CANARY_APPROVAL_ENV.ataAmountRaw]: "0500000" }),
      ),
    /amount/i,
  );
  assert.throws(
    () =>
      resolveSendCanaryHumanApproval(
        ataPlan(),
        exactEnv({ [SOLANA_CANARY_APPROVAL_ENV.ataApprovalRef]: "" }),
      ),
    /complete/i,
  );
});

test("the intent and policy bind the exact approval without opening another canary family", () => {
  const plan = ataPlan();
  const valuation = buildSendCanaryValuation({
    plan,
    solUsdPrice: "100",
    sourceRef: "jupiter:mainnet:price:SOL",
    observedAt: OBSERVED_AT,
  });
  const intent = buildSendCanaryIntent({
    plan,
    valuation,
    humanApproval: resolveSendCanaryHumanApproval(plan, exactEnv()),
  });
  assert.equal(intent.family, "ATA_CREATE");
  assert.equal(intent.humanApproval, "RECORDED");
  assert.equal(intent.usdMicros, "704428");

  const resolved = resolveSolanaCanaryPolicy(exactEnv());
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.policy.families.ATA_CREATE.allowedDestinations, [RECIPIENT]);
  for (const family of ["SEND", "SWAP", "CCTP", "TOKEN_2022"]) {
    assert.deepEqual(resolved.policy.families[family].allowedDestinations, []);
  }
  assert.equal(resolved.policy.source.ref, APPROVAL_REF);

  const budget = SolanaCanaryBudgetSnapshotSchema.parse({
    schema: "ryntra.solana.canary-budget-snapshot",
    schemaVersion: "1.0.0",
    policyId: resolved.policy.policyId,
    readState: "AVAILABLE",
    storeBoundary: "DURABLE_MULTI_WRITER",
    totalLimitUsdMicros: resolved.policy.totalLimitUsdMicros,
    reservedUsdMicros: "0",
    spentUsdMicros: "0",
    feeReservedUsdMicros: "0",
    feeSpentUsdMicros: "0",
    families: Object.fromEntries(
      ["SEND", "ATA_CREATE", "SWAP", "CCTP", "TOKEN_2022"].map((family) => [
        family,
        { reservedUsdMicros: "0", spentUsdMicros: "0" },
      ]),
    ),
    observedAt: OBSERVED_AT,
  });
  const verdict = evaluateSolanaCanaryIntent({
    policy: resolved.policy,
    budget,
    intent,
    now: new Date("2026-08-28T00:00:30.000Z"),
  });
  assert.equal(verdict.decision, "ALLOW");
  assert.equal(verdict.newRiskAllowed, true);
  for (const rule of [
    "DESTINATION_ALLOWLISTED",
    "MINTS_ALLOWLISTED",
    "PROGRAMS_ALLOWLISTED",
    "VALUATION_CURRENT",
    "FAMILY_LIMIT",
    "TOTAL_LIMIT",
    "HUMAN_APPROVAL",
  ]) {
    assert.equal(verdict.findings.find((finding) => finding.rule === rule)?.outcome, "PASS");
  }
});

test("a partial approval also invalidates the owner policy resolution", () => {
  const resolved = resolveSolanaCanaryPolicy({
    RYNTRA_SOLANA_CANARY_STATE: "OPEN",
    [SOLANA_CANARY_APPROVAL_ENV.ataRecipient]: RECIPIENT,
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /complete/i);
});

test("the plan route obtains a provider SOL quote and derives approval server-side", () => {
  const route = readFileSync(
    new URL("../../app/api/solana/transfer/plan/route.ts", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.match(route, /fetchTokenCatalog\(\[priceMint\], 2_500\)/);
  assert.match(route, /buildSendCanaryValuation\(\{/);
  assert.match(route, /resolveSendCanaryHumanApproval\(plan\)/);
  assert.doesNotMatch(route, /buildSendCanaryIntent\(\{\s*plan,\s*humanApproval: "NOT_RECORDED"/);
});
