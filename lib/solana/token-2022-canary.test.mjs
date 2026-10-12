/**
 * The Token-2022 owner canary, before any of it is signed.
 *
 * Three defects made a Token-2022 canary impossible to authorize no matter how
 * the wallet was funded, and each is covered here by the case that would have
 * failed at the wallet rather than in a test:
 *
 *   1. the owner-canary valuation lane refused every mint that was not classic
 *      USDC, so the policy saw a null exposure and could only answer UNKNOWN;
 *   2. `classifyTokenTransfer` filed an account-creating Token-2022 transfer
 *      under M1B's classic-USDC envelope;
 *   3. `resolveSendCanaryHumanApproval` knew one tuple, M1B's, so
 *      HUMAN_APPROVAL could never pass for this family.
 *
 * Every fixture below is a real mainnet fact read on 2026-09-02 at epoch 1027 —
 * the PYUSD mint, its permanent delegate, its price, the SOL price, the exact
 * rent of a 187-byte Token-2022 account. The wallets are stand-ins. Nothing is
 * signed, funded or sent by this file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_CANARY_APPROVAL_ENV,
  SOLANA_CANARY_ENV,
  SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV,
  SOLANA_MAINNET_USDC_MINT,
  SolanaCanaryBudgetSnapshotSchema,
  evaluateSolanaCanaryIntent,
  resolveSolanaCanaryPolicy,
  resolveSolanaToken2022Approval,
  solanaToken2022SemanticDigest,
} from "./canary-policy.ts";
import {
  assessToken2022CanaryApproval,
  buildSendCanaryIntent,
  resolveSendCanaryHumanApproval,
} from "./canary-send.ts";
import {
  assessTokenCanaryValuationDrift,
  buildTokenCanaryValuation,
} from "./canary-valuation.ts";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  classifyTokenTransfer,
} from "./send-kinds.ts";
import { associatedTokenAccount } from "./token-account.ts";
import {
  COMPUTE_BUDGET_PROGRAM,
  LIGHTHOUSE_PROGRAM,
} from "./wallet-modification.ts";

/* Read from mainnet, 2026-09-02, epoch 1027, slot 443767000. */
const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const PYUSD_DELEGATE = "2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk";
const PYUSD_PRICE = "0.999928429652753";
const SOL_PRICE = "99.14503963200752";
const SENDER = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const OTHER_WALLET = "5YEAL2qTHvFCuTXzxY8wbQTBaQGRAD7pY4EymLACYvWt";
/** A 187-byte Token-2022 account with ImmutableOwner, fee and hook state. */
const PYUSD_ATA_RENT = "2192400";

const NOW = new Date("2026-09-02T18:40:00.000Z");
const OBSERVED_AT = "2026-09-02T18:39:40.000Z";
const FAMILY_CAP = "2000000";
const REVIEW_DIGEST = "0x" + "a".repeat(64);

const quote = (usdPrice, sourceRef, observedAt = OBSERVED_AT) => ({
  usdPrice,
  sourceRef,
  observedAt,
});
const tokenQuote = (overrides = {}) => ({
  ...quote(PYUSD_PRICE, "jupiter:price-v3:2b1kV6Dk"),
  ...overrides,
});
const solQuote = (overrides = {}) => ({
  ...quote(SOL_PRICE, "jupiter:price-v3:So111111"),
  ...overrides,
});

function plan(overrides = {}) {
  return {
    actionKind: "TOKEN_2022",
    network: "mainnet",
    mint: PYUSD,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    decimals: 6,
    sender: SENDER,
    recipient: RECIPIENT,
    recipientOwner: RECIPIENT,
    recipientKind: "WALLET_OWNER",
    senderTokenAccount: "EqNNpSPyGBozskXRDvmTCb3jJYD1PEpwY44QF5GdsPCU",
    recipientTokenAccount: "8SPJNEZqPa63XEtHAbgi3avSHrMLWRBchwPyNHBKMpNk",
    /* PYUSD withholds nothing today — 0 basis points — so the fee on this
       source is zero and the recipient's credit equals the debit. That is a
       fact about this mint, recorded rather than assumed. */
    sources: [{ account: "EqNNpSPyGBozskXRDvmTCb3jJYD1PEpwY44QF5GdsPCU", amountRaw: "1900000", feeRaw: "0" }],
    memo: null,
    transferHook: null,
    createsRecipientAccount: true,
    ataRentLamports: PYUSD_ATA_RENT,
    amountRaw: "1900000",
    senderBalanceRaw: "2000000",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    programs: [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID],
    blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    lastValidBlockHeight: "350000000",
    unsignedWireBase64: "A".repeat(128),
    fingerprint: { messageHash: REVIEW_DIGEST, network: "mainnet", feePayer: SENDER },
    builtAt: "2026-09-02T18:39:45.000Z",
    ...overrides,
  };
}

const value = (overrides = {}) =>
  buildTokenCanaryValuation({
    plan: plan(),
    tokenPrice: tokenQuote(),
    solPrice: solQuote(),
    maximumPrincipalUsdMicros: FAMILY_CAP,
    now: NOW,
    ...overrides,
  });

/* ----------------------------------------------------------------- *
 * 1. Valuation
 * ----------------------------------------------------------------- */

test("a Token-2022 canary prices the mint it is actually moving, and does not assume a dollar", () => {
  const result = value();
  assert.equal(result.ok, true);

  /* 1.900000 PYUSD is not 1.900000 USD. At 0.999928429652753 it is 1.899865,
     and the whole point of this lane is that the difference is read rather
     than rounded away by calling the asset a stablecoin. */
  assert.equal(result.valuation.principalUsdMicros, "1899865");
  assert.notEqual(result.valuation.principalUsdMicros, "1900000");

  /* 5000 lamports of signature fee plus 2192400 of rent for the recipient's
     account, valued at the SOL price and rounded up so the reserve never
     understates. */
  assert.equal(result.valuation.feeReserveUsdMicros, "217862");
  assert.equal(result.valuation.usdMicros, "2117727");
  assert.equal(result.valuation.valuation.method, "PROVIDER_QUOTE");
  assert.match(result.valuation.valuation.sourceRef, /jupiter:price-v3:2b1kV6Dk \+ jupiter:price-v3:So111111/);
  assert.equal(result.valuation.valuation.observedAt, "2026-09-02T18:39:40.000Z");
  assert.equal(result.valuation.valuation.validUntil, "2026-09-02T18:40:40.000Z");
});

test("a total is exactly as fresh as its stalest input", () => {
  const result = value({ solPrice: solQuote({ observedAt: "2026-09-02T18:39:20.000Z" }) });
  assert.equal(result.ok, true);
  assert.equal(result.valuation.valuation.observedAt, "2026-09-02T18:39:20.000Z");
  assert.equal(result.valuation.valuation.validUntil, "2026-09-02T18:40:20.000Z");
});

test("a stale price is refused rather than used, whichever of the two it is", () => {
  const staleToken = value({ tokenPrice: tokenQuote({ observedAt: "2026-09-02T18:38:00.000Z" }) });
  assert.equal(staleToken.ok, false);
  assert.equal(staleToken.code, "PRICE_STALE");
  assert.match(staleToken.reason, /token price was read 120 seconds ago/);

  const staleSol = value({ solPrice: solQuote({ observedAt: "2026-09-02T18:38:00.000Z" }) });
  assert.equal(staleSol.ok, false);
  assert.equal(staleSol.code, "PRICE_STALE");
});

test("an absent price produces no valuation, and an absent SOL price produces no total", () => {
  const noToken = value({ tokenPrice: null });
  assert.equal(noToken.ok, false);
  assert.equal(noToken.code, "PRICE_ABSENT");

  /* A USD figure is never invented for a network fee or for rent. With no SOL
     price the honest answer is no total at all, not a principal presented as
     though it were the whole exposure. */
  const noSol = value({ solPrice: null });
  assert.equal(noSol.ok, false);
  assert.equal(noSol.code, "PRICE_ABSENT");
  assert.match(noSol.reason, /network fee and any rent cannot be valued/);
});

test("a price from the future, a zero price and an exponent are all refused", () => {
  assert.equal(value({ tokenPrice: tokenQuote({ observedAt: "2026-09-02T18:41:00.000Z" }) }).code, "PRICE_FROM_FUTURE");
  assert.equal(value({ tokenPrice: tokenQuote({ usdPrice: "0" }) }).code, "PRICE_INVALID");
  assert.equal(value({ tokenPrice: tokenQuote({ usdPrice: "2.7e-8" }) }).code, "PRICE_INVALID");
  assert.equal(value({ tokenPrice: tokenQuote({ observedAt: "2026-09-02T18:39:40" }) }).code, "PRICE_INVALID");
  assert.equal(value({ tokenPrice: tokenQuote({ sourceRef: "  " }) }).code, "PRICE_INVALID");
});

test("two readers that disagree produce no number, and two that agree produce one", () => {
  const conflicting = value({
    corroboratingTokenPrice: quote("1.010000000000000", "second-operator:price"),
  });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, "PRICE_CONFLICTING");
  assert.match(conflicting.reason, /A disagreement is not resolved by choosing one of them/);

  /* Agreement is measured on the figure a person reads, so a second operator
     four ten-thousandths away corroborates rather than contradicts. */
  const agreeing = value({
    corroboratingTokenPrice: quote("0.999900000000000", "second-operator:price"),
  });
  assert.equal(agreeing.ok, true);
  assert.equal(agreeing.valuation.principalUsdMicros, "1899865");
});

test("the family ceiling is enforced on the exposure, at and past the boundary", () => {
  const dollar = quote("1", "fixture:one-dollar");
  const atBoundary = value({
    plan: plan({ amountRaw: "2000000", sources: [{ account: SENDER, amountRaw: "2000000", feeRaw: "0" }] }),
    tokenPrice: dollar,
  });
  assert.equal(atBoundary.ok, true);
  assert.equal(atBoundary.valuation.principalUsdMicros, FAMILY_CAP);

  const oneMicroOver = value({
    plan: plan({ amountRaw: "2000001", sources: [{ account: SENDER, amountRaw: "2000001", feeRaw: "0" }] }),
    tokenPrice: dollar,
  });
  assert.equal(oneMicroOver.ok, false);
  assert.equal(oneMicroOver.code, "PRINCIPAL_ABOVE_CAP");
  assert.match(oneMicroOver.reason, /allows at most 2000000/);
});

test("an unread rent is an unknown exposure, never a zero one", () => {
  const result = value({ plan: plan({ ataRentLamports: null }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "RENT_UNREADABLE");

  /* Not creating an account is different from failing to read the rent of one
     being created: there is simply no rent, and the valuation completes. */
  const noCreation = value({
    plan: plan({ createsRecipientAccount: false, ataRentLamports: null }),
  });
  assert.equal(noCreation.ok, true);
  assert.equal(noCreation.valuation.feeReserveUsdMicros, "496");
});

test("this lane values only Token-2022, and classic USDC keeps its own", () => {
  const classic = value({
    plan: plan({
      actionKind: "SPL_TRANSFER_CHECKED",
      mint: SOLANA_MAINNET_USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
  });
  assert.equal(classic.ok, false);
  assert.equal(classic.code, "PLAN_NOT_TOKEN_2022");
});

test("a price that moves the figure on screen spends the Review", () => {
  const reviewed = value();
  assert.equal(reviewed.ok, true);

  const unchanged = assessTokenCanaryValuationDrift({
    reviewed: reviewed.valuation,
    plan: plan(),
    tokenPrice: tokenQuote(),
    solPrice: solQuote(),
    maximumPrincipalUsdMicros: FAMILY_CAP,
    now: NOW,
  });
  assert.equal(unchanged.state, "CURRENT");

  /* 1.899865 rounds to 190 cents; 1.890365 rounds to 189. The number the
     person read changed, so their yes no longer describes this transfer. */
  const drifted = assessTokenCanaryValuationDrift({
    reviewed: reviewed.valuation,
    plan: plan(),
    tokenPrice: tokenQuote({ usdPrice: "0.994928429652753" }),
    solPrice: solQuote(),
    maximumPrincipalUsdMicros: FAMILY_CAP,
    now: NOW,
  });
  assert.equal(drifted.state, "MATERIAL_DRIFT");
  assert.match(drifted.detail, /reviewed at 190 US cents and now values at 189/);

  const expired = assessTokenCanaryValuationDrift({
    reviewed: reviewed.valuation,
    plan: plan(),
    tokenPrice: tokenQuote(),
    solPrice: solQuote(),
    maximumPrincipalUsdMicros: FAMILY_CAP,
    now: new Date("2026-09-02T18:40:41.000Z"),
  });
  assert.equal(expired.state, "EXPIRED");

  const feedDown = assessTokenCanaryValuationDrift({
    reviewed: reviewed.valuation,
    plan: plan(),
    tokenPrice: null,
    solPrice: solQuote(),
    maximumPrincipalUsdMicros: FAMILY_CAP,
    now: NOW,
  });
  assert.equal(feedDown.state, "REPRICE_UNAVAILABLE");
});

/* ----------------------------------------------------------------- *
 * 2. Classification
 * ----------------------------------------------------------------- */

test("the token program decides the family and account creation is an effect beside it", () => {
  assert.equal(
    classifyTokenTransfer({ tokenProgram: TOKEN_2022_PROGRAM_ID, createsRecipientAccount: false }),
    "TOKEN_2022",
  );
  assert.equal(
    classifyTokenTransfer({ tokenProgram: TOKEN_2022_PROGRAM_ID, createsRecipientAccount: true }),
    "TOKEN_2022",
  );
  /* The classic cases are untouched: M1B's account-creation proof keeps its
     own family and its own 0.5 USD envelope. */
  assert.equal(
    classifyTokenTransfer({ tokenProgram: TOKEN_PROGRAM_ID, createsRecipientAccount: true }),
    "TOKEN_ATA_CREATE",
  );
  assert.equal(
    classifyTokenTransfer({ tokenProgram: TOKEN_PROGRAM_ID, createsRecipientAccount: false }),
    "SPL_TRANSFER_CHECKED",
  );
});

test("an account-creating Token-2022 transfer reaches its own canary family", () => {
  const intent = buildSendCanaryIntent({
    plan: plan({ createsRecipientAccount: true }),
    humanApproval: "RECORDED",
  });
  assert.equal(intent.family, "TOKEN_2022");

  /* The effect is not lost by being demoted from a family: it still travels on
     the plan, so Review and Receipt can state the account and its rent. */
  assert.equal(plan({ createsRecipientAccount: true }).createsRecipientAccount, true);
  assert.equal(plan({ createsRecipientAccount: true }).ataRentLamports, PYUSD_ATA_RENT);
});

test("a Token-2022 valuation now reaches the intent instead of being refused", () => {
  const valued = value();
  const intent = buildSendCanaryIntent({
    plan: plan(),
    humanApproval: "RECORDED",
    valuation: valued.valuation,
  });
  assert.equal(intent.principalUsdMicros, "1899865");
  assert.equal(intent.usdMicros, "2117727");
  assert.equal(intent.valuation.method, "PROVIDER_QUOTE");

  /* A Token-2022 valuation must come from a quote. Handing this lane a
     nominal-USDC shaped valuation is refused rather than trusted. */
  assert.throws(
    () =>
      buildSendCanaryIntent({
        plan: plan(),
        humanApproval: "RECORDED",
        valuation: { ...valued.valuation, valuation: { ...valued.valuation.valuation, method: "USDC_NOMINAL" } },
      }),
    /must carry a sourced provider quote/,
  );
});

/* ----------------------------------------------------------------- *
 * 3. Human approval
 * ----------------------------------------------------------------- */

const approvalFields = (overrides = {}) => ({
  sourceWallet: SENDER,
  destinationWallet: RECIPIENT,
  mint: PYUSD,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  decimals: 6,
  amountRaw: "1900000",
  extensionCase: "PERMANENT_DELEGATE_VISIBILITY",
  permanentDelegate: PYUSD_DELEGATE,
  createsRecipientAccount: true,
  expectedDebitRaw: "1900000",
  expectedCreditRaw: "1900000",
  ...overrides,
});

function approvalEnv(overrides = {}, fieldOverrides = {}) {
  const fields = approvalFields(fieldOverrides);
  const envelope = {
    taskId: "RYN-SOL-M4",
    family: "TOKEN_2022",
    network: "mainnet",
    ...fields,
    valuationSourceRef: "jupiter:price-v3:2b1kV6Dk + jupiter:price-v3:So111111",
    valuationMaxAgeSeconds: 60,
    policyId: "owner-mainnet-canary-v1",
    semanticDigest: solanaToken2022SemanticDigest(fields),
    reviewDigest: REVIEW_DIGEST,
    approvalRef: "owner:decision:2026-09-02:RYN-SOL-M4",
    expiresAt: "2026-09-02T19:00:00.000Z",
    ...overrides,
  };
  return { [SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV]: JSON.stringify(envelope) };
}

const assess = (args = {}) =>
  assessToken2022CanaryApproval({
    plan: plan(),
    permanentDelegate: PYUSD_DELEGATE,
    env: approvalEnv(),
    now: NOW,
    ...args,
  });

test("the exact approved tuple is recorded, and an absent envelope authorizes nothing", () => {
  const accepted = assess();
  assert.equal(accepted.state, "RECORDED");
  assert.match(accepted.reason, /owner:decision:2026-09-02:RYN-SOL-M4/);

  const none = assess({ env: {} });
  assert.equal(none.state, "NOT_RECORDED");
  assert.match(none.reason, /No Token-2022 owner approval is configured/);
});

test("every field of the approved action is load-bearing", () => {
  const cases = [
    ["amount", { plan: plan({ amountRaw: "1900001", sources: [{ account: SENDER, amountRaw: "1900001", feeRaw: "0" }] }) }, /amount/],
    ["recipient", { plan: plan({ recipient: OTHER_WALLET, recipientOwner: OTHER_WALLET }) }, /recipient/],
    ["source wallet", { plan: plan({ sender: OTHER_WALLET }) }, /source wallet/],
    ["mint", { plan: plan({ mint: SOLANA_MAINNET_USDC_MINT }) }, /mint/],
    ["token program", { plan: plan({ tokenProgram: TOKEN_PROGRAM_ID }) }, /token program/],
    ["decimals", { plan: plan({ decimals: 9 }) }, /decimals/],
    ["account creation", { plan: plan({ createsRecipientAccount: false }) }, /recipient account creation/],
    ["reviewed bytes", { plan: plan({ fingerprint: { messageHash: "0x" + "b".repeat(64) } }) }, /reviewed transaction/],
    ["permanent delegate", { permanentDelegate: OTHER_WALLET }, /permanent delegate/],
  ];
  for (const [label, override, pattern] of cases) {
    const result = assess(override);
    assert.equal(result.state, "NOT_RECORDED", `${label} should not be approved`);
    assert.match(result.reason, pattern, label);
  }
});

test("a mint whose delegate changed between the read and the prompt loses the approval", () => {
  /* The delegate is the control fact this canary exists to display. If the
     issuer replaced it after the owner said yes, the sentence they approved
     against is no longer true, and the approval must not survive it. */
  const result = assess({ permanentDelegate: OTHER_WALLET });
  assert.equal(result.state, "NOT_RECORDED");
  assert.match(result.reason, /permanent delegate/);

  /* And a mint that reports no delegate at all cannot satisfy a
     permanent-delegate-visibility approval. */
  const absent = assess({ permanentDelegate: null });
  assert.equal(absent.state, "NOT_RECORDED");
});

test("an approval does not outlive the Review it was given against", () => {
  const expired = assess({ now: new Date("2026-09-02T19:00:00.000Z") });
  assert.equal(expired.state, "NOT_RECORDED");
  assert.match(expired.reason, /has expired/);
});

test("a malformed envelope fails closed and loudly, never half-parsed", () => {
  assert.throws(
    () => resolveSolanaToken2022Approval({ [SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV]: "{" }),
    /is not valid JSON/,
  );
  /* A digest that does not describe the envelope's own fields is not an
     approval of anything, and is caught before it can be reported as a plan
     problem somewhere further down. */
  assert.throws(
    () => resolveSolanaToken2022Approval(approvalEnv({ semanticDigest: "0x" + "c".repeat(64) })),
    /semantic digest that does not match its own action fields/,
  );
  assert.throws(
    () => resolveSolanaToken2022Approval(approvalEnv({ taskId: "RYN-SOL-M5" })),
    /invalid_literal|Invalid literal|invalid_value/,
  );
  /* There is no wildcard: the envelope cannot be widened into "any Token-2022".
     `ANY` is a lawful word in the owner *policy* allowlists and deliberately
     not one here, because an approval names an action rather than a shape. */
  assert.throws(() => resolveSolanaToken2022Approval(approvalEnv({ mint: "ANY" })));
});

test("an M1B approval cannot authorize an M4 action, in either direction", () => {
  /* The classic ATA tuple is configured and the Token-2022 envelope is not.
     The old resolver matched on shape alone, so this is the case that would
     have carried M1B's yes onto a different program and a different mint. */
  const m1bEnv = {
    [SOLANA_CANARY_APPROVAL_ENV.ataRecipient]: RECIPIENT,
    [SOLANA_CANARY_APPROVAL_ENV.ataAmountRaw]: "500000",
    [SOLANA_CANARY_APPROVAL_ENV.ataApprovalRef]: "owner:decision:2026-08-29:RYN-SOL-M1B",
  };
  assert.equal(assessToken2022CanaryApproval({ plan: plan(), permanentDelegate: PYUSD_DELEGATE, env: m1bEnv, now: NOW }).state, "NOT_RECORDED");

  /* And the general entry point refuses to answer for Token-2022 at all,
     because it is not given the delegate it would have to check. */
  assert.equal(resolveSendCanaryHumanApproval(plan(), m1bEnv), "NOT_RECORDED");
  assert.equal(resolveSendCanaryHumanApproval(plan(), approvalEnv()), "NOT_RECORDED");
});

/* ----------------------------------------------------------------- *
 * 4. Policy
 * ----------------------------------------------------------------- */

const policyEnv = (overrides = {}) => ({
  [SOLANA_CANARY_ENV.state]: "OPEN",
  [SOLANA_CANARY_ENV.token2022Mints]: PYUSD,
  ...approvalEnv(),
  ...overrides,
});

const budget = (overrides = {}) =>
  SolanaCanaryBudgetSnapshotSchema.parse({
    schema: "ryntra.solana.canary-budget-snapshot",
    schemaVersion: "1.0.0",
    readState: "AVAILABLE",
    storeBoundary: "DURABLE_MULTI_WRITER",
    policyId: "owner-mainnet-canary-v1",
    totalLimitUsdMicros: "20000000",
    reservedUsdMicros: "0",
    spentUsdMicros: "2719131",
    feeReservedUsdMicros: "0",
    feeSpentUsdMicros: "719131",
    families: {
      SEND: { reservedUsdMicros: "0", spentUsdMicros: "0" },
      ATA_CREATE: { reservedUsdMicros: "0", spentUsdMicros: "0" },
      SWAP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
      CCTP: { reservedUsdMicros: "0", spentUsdMicros: "2000000" },
      TOKEN_2022: { reservedUsdMicros: "0", spentUsdMicros: "0" },
    },
    observedAt: "2026-09-02T18:39:50.000Z",
    ...overrides,
  });

function verdictFor(overrides = {}) {
  const resolution = resolveSolanaCanaryPolicy(overrides.env ?? policyEnv());
  assert.equal(resolution.ok, true, resolution.ok ? "" : resolution.reason);
  return {
    policy: resolution.policy,
    verdict: evaluateSolanaCanaryIntent({
      policy: resolution.policy,
      budget: overrides.budget ?? budget(),
      intent:
        overrides.intent ??
        buildSendCanaryIntent({
          plan: plan(),
          humanApproval: "RECORDED",
          valuation: value().valuation,
        }),
      now: NOW,
    }),
  };
}

const findingOf = (verdict, rule) => verdict.findings.find((entry) => entry.rule === rule);

test("a priced, approved, allowlisted Token-2022 canary reaches a deterministic ALLOW", () => {
  const { verdict } = verdictFor();
  /* This is the assertion the three defects made unreachable. Every rule that
     used to answer UNKNOWN for want of wiring now answers from evidence. */
  assert.equal(findingOf(verdict, "VALUATION_CURRENT").outcome, "PASS");
  assert.equal(findingOf(verdict, "FAMILY_LIMIT").outcome, "PASS");
  assert.equal(findingOf(verdict, "TOTAL_LIMIT").outcome, "PASS");
  assert.equal(findingOf(verdict, "MINTS_ALLOWLISTED").outcome, "PASS");
  assert.equal(findingOf(verdict, "PROGRAMS_ALLOWLISTED").outcome, "PASS");
  assert.equal(findingOf(verdict, "DESTINATION_ALLOWLISTED").outcome, "PASS");
  assert.equal(verdict.decision, "ALLOW");
  assert.equal(verdict.newRiskAllowed, true);
  assert.equal(verdict.scope.status, "INSIDE_ENVELOPE");
});

test("an empty mint allowlist is nobody, and a different Token-2022 mint is not admitted", () => {
  /* Today's production state: no approval, no allowlist. The family is
     configured and reachable and admits nothing, which is what fail-closed
     means — not an error, a refusal. */
  const unconfigured = verdictFor({
    env: { [SOLANA_CANARY_ENV.state]: "OPEN" },
    intent: buildSendCanaryIntent({
      plan: plan(),
      humanApproval: "NOT_RECORDED",
      valuation: value().valuation,
    }),
  });
  assert.deepEqual(unconfigured.policy.families.TOKEN_2022.allowedMints, []);
  assert.equal(findingOf(unconfigured.verdict, "MINTS_ALLOWLISTED").outcome, "BLOCK");
  assert.equal(unconfigured.verdict.decision, "BLOCK");

  /* One mint is allowed, and allowing it does not allow the next one. */
  assert.deepEqual(verdictFor().policy.families.TOKEN_2022.allowedMints, [PYUSD]);
  const otherMint = verdictFor({
    intent: buildSendCanaryIntent({
      plan: plan({ mint: "7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1" }),
      humanApproval: "RECORDED",
    }),
  });
  assert.equal(findingOf(otherMint.verdict, "MINTS_ALLOWLISTED").outcome, "BLOCK");
});

test("the envelope and the allowlist are two owner statements and must agree", () => {
  /* Approving a mint the allowlist does not carry is a contradiction, and it
     is loud rather than silent. Resolving it either way would let one of the
     owner's two statements be ignored — and a policy that half applies is
     worse than one that is missing, because the missing one is visible. */
  for (const allowlist of [SOLANA_MAINNET_USDC_MINT, ""]) {
    const contradiction = resolveSolanaCanaryPolicy({
      ...policyEnv(),
      [SOLANA_CANARY_ENV.token2022Mints]: allowlist,
    });
    assert.equal(contradiction.ok, false);
    assert.match(contradiction.reason, /which RYNTRA_SOLANA_CANARY_TOKEN_2022_MINTS does not allow/);
  }
});

test("the programs this transfer actually invokes are the ones the family allows", () => {
  const allowed = verdictFor().policy.families.TOKEN_2022.allowedPrograms;
  for (const program of [TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM, LIGHTHOUSE_PROGRAM]) {
    assert.ok(allowed.includes(program), `${program} must be allowed for an account-creating, wallet-guarded transfer`);
  }
  assert.ok(!allowed.includes(TOKEN_PROGRAM_ID), "the classic token program is not a Token-2022 program");
});

test("the family ceiling and the package ceiling are separate refusals", () => {
  const overFamily = verdictFor({
    budget: budget({
      families: {
        SEND: { reservedUsdMicros: "0", spentUsdMicros: "0" },
        ATA_CREATE: { reservedUsdMicros: "0", spentUsdMicros: "0" },
        SWAP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
        CCTP: { reservedUsdMicros: "0", spentUsdMicros: "2000000" },
        TOKEN_2022: { reservedUsdMicros: "0", spentUsdMicros: "1000000" },
      },
      spentUsdMicros: "3719131",
      feeSpentUsdMicros: "719131",
    }),
  });
  assert.equal(findingOf(overFamily.verdict, "FAMILY_LIMIT").outcome, "BLOCK");
  assert.equal(overFamily.verdict.decision, "BLOCK");

  const overPackage = verdictFor({
    budget: budget({
      spentUsdMicros: "19719131",
      feeSpentUsdMicros: "719131",
      families: {
        SEND: { reservedUsdMicros: "0", spentUsdMicros: "0" },
        ATA_CREATE: { reservedUsdMicros: "0", spentUsdMicros: "0" },
        SWAP: { reservedUsdMicros: "0", spentUsdMicros: "0" },
        CCTP: { reservedUsdMicros: "0", spentUsdMicros: "19000000" },
        TOKEN_2022: { reservedUsdMicros: "0", spentUsdMicros: "0" },
      },
    }),
  });
  assert.equal(findingOf(overPackage.verdict, "FAMILY_LIMIT").outcome, "PASS");
  assert.equal(findingOf(overPackage.verdict, "TOTAL_LIMIT").outcome, "BLOCK");
});

test("an unpriced intent still blocks new risk instead of guessing at it", () => {
  const unpriced = verdictFor({
    intent: buildSendCanaryIntent({ plan: plan(), humanApproval: "RECORDED" }),
  });
  assert.equal(findingOf(unpriced.verdict, "VALUATION_CURRENT").outcome, "UNKNOWN");
  assert.equal(findingOf(unpriced.verdict, "FAMILY_LIMIT").outcome, "UNKNOWN");
  assert.equal(unpriced.verdict.decision, "UNKNOWN");
  assert.equal(unpriced.verdict.newRiskAllowed, false);
});

test("an unapproved Token-2022 action is reviewed, never allowed", () => {
  const unapproved = verdictFor({
    intent: buildSendCanaryIntent({
      plan: plan(),
      humanApproval: "NOT_RECORDED",
      valuation: value().valuation,
    }),
  });
  assert.equal(findingOf(unapproved.verdict, "HUMAN_APPROVAL").outcome, "REVIEW");
  assert.equal(unapproved.verdict.decision, "REVIEW");
  assert.equal(unapproved.verdict.newRiskAllowed, false);
});

test("the emergency stop outranks a fully approved and priced action", () => {
  const paused = verdictFor({ env: { ...policyEnv(), [SOLANA_CANARY_ENV.state]: "PAUSED" } });
  assert.equal(paused.verdict.decision, "PAUSE");
  assert.equal(paused.verdict.newRiskAllowed, false);
});

/* ----------------------------------------------------------------- *
 * 5. The recipient's token account
 * ----------------------------------------------------------------- */

test("the recipient account is derived under Token-2022, and the classic derivation is a different account", async () => {
  const underT22 = await associatedTokenAccount({
    owner: RECIPIENT,
    mint: PYUSD,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  const underClassic = await associatedTokenAccount({
    owner: RECIPIENT,
    mint: PYUSD,
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  /* Both are valid addresses and only one of them is where PYUSD can land.
     The token program is part of the seed, so getting it wrong does not fail
     loudly — it derives a different, empty, unusable account. */
  assert.notEqual(underT22, underClassic);
  assert.equal(underT22, "ENTJfsAvzJJfF6Qiw17ReyjMPxhRu2cyoPNmyYXpsr3W");

  /* The sender's account, derived the same way. For the wallet the canary
     really sent from, this derivation matched the account mainnet reported
     holding PYUSD — read on 2026-09-02, owned by the Token-2022 program,
     2192400 lamports of rent, balance zero; the fixture now carries a
     stand-in wallet, so the value below is that wallet's derivation. */
  assert.equal(
    await associatedTokenAccount({ owner: SENDER, mint: PYUSD, tokenProgram: TOKEN_2022_PROGRAM_ID }),
    "EqNNpSPyGBozskXRDvmTCb3jJYD1PEpwY44QF5GdsPCU",
  );
});

test("creating the recipient account is priced, disclosed and refundable — and none of that changes the family", () => {
  const creating = plan({ createsRecipientAccount: true, ataRentLamports: PYUSD_ATA_RENT });
  const intent = buildSendCanaryIntent({ plan: creating, humanApproval: "RECORDED", valuation: value().valuation });

  /* The rent is inside the reserved exposure rather than beside it, so the
     package ceiling sees the whole cost of the action. */
  assert.equal(intent.family, "TOKEN_2022");
  assert.equal(intent.feeReserveUsdMicros, "217862");
  assert.ok(BigInt(intent.usdMicros) > BigInt(intent.principalUsdMicros));

  /* And it is genuinely the rent that makes the difference: the same transfer
     into an existing account reserves only the signature fee. Rent is
     refundable when the account is closed and a network fee is not, which is
     why the two are computed from separate lamport sources rather than one
     lumped number. */
  const existing = value({ plan: plan({ createsRecipientAccount: false, ataRentLamports: null }) });
  assert.equal(existing.valuation.feeReserveUsdMicros, "496");
  /* 217862 − 496 = 217366, which is exactly 2192400 lamports of rent valued at
     the same SOL price. The rent is the whole of the difference, so a reader
     can see which part of the reserve comes back when the account is closed
     and which part is spent for good. */
  assert.equal(BigInt(intent.feeReserveUsdMicros) - BigInt(existing.valuation.feeReserveUsdMicros), 217366n);
});

test("an ordinary customer transfer of the same mint stays outside the owner envelope", () => {
  /* An ordinary user-signed Send is decided by the capability classifier, not
     by this ledger. It must not consume the owner's canary budget, and the
     way that is guaranteed is that its intent falls outside the envelope the
     canary reserves for. */
  const customer = verdictFor({
    intent: buildSendCanaryIntent({
      plan: plan({ recipient: OTHER_WALLET, recipientOwner: OTHER_WALLET }),
      humanApproval: "NOT_RECORDED",
      valuation: value().valuation,
    }),
  });
  assert.equal(findingOf(customer.verdict, "DESTINATION_ALLOWLISTED").outcome, "BLOCK");
  assert.equal(customer.verdict.scope.status, "OUTSIDE_ENVELOPE");
  assert.equal(customer.verdict.scope.decidedBy, "TRANSFER_CAPABILITY");
});
