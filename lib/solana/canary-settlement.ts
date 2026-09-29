import type { GuardStore } from "../guard/store.ts";
import {
  commitSolanaCanarySpend,
  markSolanaCanarySubmitUnknown,
  releaseSolanaCanaryReservation,
  reserveSolanaCanaryIntent,
} from "./canary-ledger.ts";
import type { SolanaCanaryPolicy } from "./canary-policy.ts";
import {
  validateSettlementCandidate,
  type SettlementResult,
  type ValidatedSettlement,
} from "./settlement.ts";

export type CanarySubmitBoundary = Readonly<{
  beforeSubmit: () => Promise<void>;
}>;

export type CanarySettlementFailure = Readonly<{
  ok: false;
  code: string;
  reason: string;
  signature?: string | null;
}>;

export type CanarySettlementResult = SettlementResult | CanarySettlementFailure;

type SettlementValidator = (
  value: unknown,
  options?: Readonly<{ trustedPublicKey?: string }>,
) => ReturnType<typeof validateSettlementCandidate>;

async function releaseReserved(args: {
  store: GuardStore;
  policy: SolanaCanaryPolicy;
  idempotencyKey: string;
  at: string;
}): Promise<CanarySettlementFailure | null> {
  const released = await releaseSolanaCanaryReservation(args);
  if (released.ok) return null;
  return {
    ok: false,
    code: "CANARY_RELEASE_FAILED",
    reason: `The unsubmitted canary reservation could not be released: ${released.reason}`,
    signature: null,
  };
}

/**
 * Claim one exact reviewed canary before the submit path can be entered.
 *
 * The caller must invoke `beforeSubmit` immediately before its one network
 * broadcast. That transition records the locally verified Solana transaction
 * id as `SUBMITTED_UNKNOWN`; after it succeeds, any exception or ambiguous RPC
 * answer stays durable exposure and is never released for an automatic retry.
 */
export async function settleCanaryTransfer(args: {
  request: unknown;
  trustedPublicKey: string;
  policy: SolanaCanaryPolicy;
  store: GuardStore;
  settle: (boundary: CanarySubmitBoundary) => Promise<SettlementResult>;
  now?: Date;
  validate?: SettlementValidator;
}): Promise<CanarySettlementResult> {
  const validate = args.validate ?? validateSettlementCandidate;
  const validated = validate(args.request, { trustedPublicKey: args.trustedPublicKey });
  if (!validated.ok) return validated;

  const exact = validated as ValidatedSettlement;
  const signature = exact.check.signature.value;
  if (!signature) {
    return {
      ok: false,
      code: "SIGNED_BYTES_REJECTED",
      reason: "The exact signed transaction has no locally verified Solana signature.",
      signature: null,
    };
  }

  const now = args.now ?? new Date();
  const reserved = await reserveSolanaCanaryIntent({
    store: args.store,
    policy: args.policy,
    intent: exact.canaryIntent,
    now,
  });
  if (!reserved.ok) {
    return {
      ok: false,
      code: reserved.code,
      reason: reserved.reason,
      signature: "record" in reserved ? reserved.record.signature : null,
    };
  }

  const idempotencyKey = reserved.record.idempotencyKey;
  if (
    reserved.verdict.policyDigest !== exact.canaryVerdict.policyDigest ||
    reserved.verdict.intentDigest !== exact.canaryVerdict.intentDigest
  ) {
    const releaseFailure = await releaseReserved({
      store: args.store,
      policy: args.policy,
      idempotencyKey,
      at: now.toISOString(),
    });
    if (releaseFailure) return releaseFailure;
    return {
      ok: false,
      code: "POLICY_CHANGED",
      reason: "The durable owner-canary policy changed after Review. Build and review a fresh transaction.",
      signature: null,
    };
  }

  let crossedSubmitBoundary = false;
  const beforeSubmit = async () => {
    if (crossedSubmitBoundary) {
      throw new Error("The canary submit boundary may be crossed only once.");
    }
    const marked = await markSolanaCanarySubmitUnknown({
      store: args.store,
      idempotencyKey,
      signature,
    });
    if (!marked.ok) {
      throw new Error(`The durable canary submit marker failed: ${marked.reason}`);
    }
    crossedSubmitBoundary = true;
  };

  let settled: SettlementResult;
  try {
    settled = await args.settle({ beforeSubmit });
  } catch (failure) {
    if (!crossedSubmitBoundary) {
      const releaseFailure = await releaseReserved({
        store: args.store,
        policy: args.policy,
        idempotencyKey,
        at: new Date().toISOString(),
      });
      if (releaseFailure) return releaseFailure;
      return {
        ok: false,
        code: "CANARY_SETTLEMENT_FAILED",
        reason: `Settlement stopped before submit: ${failure instanceof Error ? failure.message : String(failure)}`,
        signature: null,
      };
    }
    return {
      ok: false,
      code: "SUBMISSION_UNKNOWN",
      reason: "Settlement failed after the submit boundary. The local signature remains reserved for recovery and is never retried automatically.",
      signature,
    };
  }

  const landingState = "landingState" in settled ? settled.landingState : undefined;
  if (landingState) {
    if (!crossedSubmitBoundary) {
      const releaseFailure = await releaseReserved({
        store: args.store,
        policy: args.policy,
        idempotencyKey,
        at: new Date().toISOString(),
      });
      if (releaseFailure) return releaseFailure;
      return {
        ok: false,
        code: "CANARY_BOUNDARY_MISSING",
        reason: "Settlement reported a landed transaction without recording the durable submit boundary.",
        signature: null,
      };
    }
    const landedSignature = "signature" in settled ? settled.signature : null;
    if (landedSignature !== signature) {
      return {
        ok: false,
        code: "CANARY_SIGNATURE_MISMATCH",
        reason: "The landed signature does not match the locally verified signed transaction.",
        signature,
      };
    }
    const committed = await commitSolanaCanarySpend({
      store: args.store,
      policy: args.policy,
      idempotencyKey,
      signature,
    });
    if (!committed.ok) {
      return {
        ok: false,
        code: "CANARY_COMMIT_FAILED",
        reason: `The landed canary exposure could not be committed: ${committed.reason}`,
        signature,
      };
    }
    return settled;
  }

  if (!crossedSubmitBoundary) {
    const releaseFailure = await releaseReserved({
      store: args.store,
      policy: args.policy,
      idempotencyKey,
      at: new Date().toISOString(),
    });
    if (releaseFailure) return releaseFailure;
  }
  if (
    crossedSubmitBoundary &&
    !settled.ok &&
    "signature" in settled &&
    settled.signature === null
  ) {
    return { ...settled, signature };
  }
  return settled;
}
