/**
 * Deterministic evaluation of an owner's policy over an exact preview.
 *
 * Thirteen rules, each producing one finding; the verdict is an aggregation
 * with a written precedence, not a judgement call:
 *
 *   BLOCKED  >  INCOMPLETE  >  REVIEW_REQUIRED  >  NO_KNOWN_BLOCKER
 *
 * A forbidding rule outranks missing evidence — a transfer that is refused
 * is refused regardless of what else is unknown — and missing evidence
 * outranks a review flag, because "a person should look" presumes there is
 * a complete picture to look at. The bottom of the ladder is deliberately
 * `NO_KNOWN_BLOCKER`, never "safe": this function reports the absence of
 * known blockers, and absence of knowledge is a different thing it reports
 * as INCOMPLETE.
 */

import type { NativeSolTransferInput, SplTransferInput } from "../agent-control/adapters/solana-token-2022.ts";
import {
  type SolanaOwnerPolicy,
  type SolanaPolicyVerdict,
  SolanaOwnerPolicySchema,
  SolanaPolicyVerdictSchema,
  type SplTransferPreflight,
} from "./contracts.ts";
import type { SolanaAssetPassport } from "./types.ts";

type Finding = SolanaPolicyVerdict["findings"][number];

const STRUCTURAL_DETAIL: Record<SplTransferPreflight["structuralBlockers"][number], string> = {
  NON_TRANSFERABLE: "The mint is non-transferable: this transfer cannot exist, whatever the policy says.",
  PAUSED: "The issuer has paused the token: transfers are stopped for every holder right now.",
  DEFAULT_ACCOUNT_STATE_FROZEN:
    "New token accounts start frozen on this mint; the recipient may receive tokens they cannot move.",
};

export function evaluateOwnerPolicy(args: {
  policy: SolanaOwnerPolicy;
  input: SplTransferInput;
  passport: SolanaAssetPassport;
  preflight: SplTransferPreflight;
  now?: Date;
}): SolanaPolicyVerdict {
  const policy = SolanaOwnerPolicySchema.parse(args.policy);
  const { input, passport, preflight } = args;
  const now = args.now ?? new Date();
  const findings: Finding[] = [];

  findings.push(
    policy.allowedNetworks.includes(input.network)
      ? { rule: "NETWORK_ALLOWED", outcome: "ALLOWED", detail: `Network ${input.network} is allowed by the policy.` }
      : {
          rule: "NETWORK_ALLOWED",
          outcome: "BLOCKED",
          detail: `Network ${input.network} is not among the policy's allowed networks (${policy.allowedNetworks.join(", ")}).`,
        },
  );

  findings.push(
    policy.allowedMints === "ANY" || policy.allowedMints.includes(input.mint)
      ? { rule: "MINT_ALLOWED", outcome: "ALLOWED", detail: "The mint is allowed by the policy." }
      : {
          rule: "MINT_ALLOWED",
          outcome: "BLOCKED",
          detail: `Mint ${input.mint} is not on the policy's mint allowlist.`,
        },
  );

  const programKind = passport.identity.programKind;
  findings.push(
    programKind !== "NOT_A_MINT" && policy.allowedTokenPrograms.includes(programKind)
      ? {
          rule: "TOKEN_PROGRAM_ALLOWED",
          outcome: "ALLOWED",
          detail: `Token program ${programKind} is allowed by the policy.`,
        }
      : {
          rule: "TOKEN_PROGRAM_ALLOWED",
          outcome: "BLOCKED",
          detail: `Token program ${programKind} is not among the policy's allowed programs (${policy.allowedTokenPrograms.join(", ")}).`,
        },
  );

  const structural = preflight.structuralBlockers.filter((blocker) => blocker !== "DEFAULT_ACCOUNT_STATE_FROZEN");
  findings.push(
    structural.length === 0
      ? {
          rule: "NOT_STRUCTURALLY_DOOMED",
          outcome: "ALLOWED",
          detail: "The mint's own configuration does not make this transfer impossible.",
        }
      : {
          rule: "NOT_STRUCTURALLY_DOOMED",
          outcome: "BLOCKED",
          detail: structural.map((blocker) => STRUCTURAL_DETAIL[blocker]).join(" "),
        },
  );

  const hasPermanentDelegate = passport.extensions.some((extension) => extension.kind === "PermanentDelegate");
  findings.push(
    !hasPermanentDelegate
      ? {
          rule: "PERMANENT_DELEGATE_ACCEPTED",
          outcome: "ALLOWED",
          detail: "The mint carries no permanent delegate.",
        }
      : policy.acceptPermanentDelegate
        ? {
            rule: "PERMANENT_DELEGATE_ACCEPTED",
            outcome: "ALLOWED",
            detail:
              "The mint's issuer can move or burn holder balances (permanent delegate); the policy explicitly accepts this power.",
          }
        : {
            rule: "PERMANENT_DELEGATE_ACCEPTED",
            outcome: "BLOCKED",
            detail:
              "The mint carries a permanent delegate — the issuer can move or burn holder balances — and the policy does not accept that power.",
          },
  );

  findings.push(
    preflight.hookProgramId === null
      ? {
          rule: "TRANSFER_HOOK_ALLOWLISTED",
          outcome: "ALLOWED",
          detail: "No transfer-hook program runs on this transfer.",
        }
      : policy.transferHookAllowlist !== "NONE_ALLOWED" &&
          policy.transferHookAllowlist.includes(preflight.hookProgramId)
        ? {
            rule: "TRANSFER_HOOK_ALLOWLISTED",
            outcome: "ALLOWED",
            detail: `Transfer-hook program ${preflight.hookProgramId} is on the policy's allowlist.`,
          }
        : {
            rule: "TRANSFER_HOOK_ALLOWLISTED",
            outcome: "BLOCKED",
            detail: `A transfer-hook program (${preflight.hookProgramId}) runs on every transfer of this mint and is not allowlisted by the policy.`,
          },
  );

  const feeBps = preflight.transferFee.basisPoints;
  const feeRaw = BigInt(preflight.transferFee.feeRaw);
  const bpsExceeded = policy.maxFeeBasisPoints !== null && feeBps > policy.maxFeeBasisPoints;
  const rawExceeded = policy.maxFeeRaw !== null && feeRaw > BigInt(policy.maxFeeRaw);
  findings.push(
    !bpsExceeded && !rawExceeded
      ? {
          rule: "FEE_WITHIN_CAP",
          outcome: "ALLOWED",
          detail:
            policy.maxFeeBasisPoints === null && policy.maxFeeRaw === null
              ? `The policy sets no fee ceiling; the mint charges ${feeBps} bps (${preflight.transferFee.feeRaw} raw) on this transfer.`
              : `The transfer fee (${feeBps} bps, ${preflight.transferFee.feeRaw} raw) is within the policy's ceiling.`,
        }
      : {
          rule: "FEE_WITHIN_CAP",
          outcome: "BLOCKED",
          detail: bpsExceeded
            ? `The mint charges ${feeBps} bps per transfer; the policy caps fees at ${policy.maxFeeBasisPoints} bps.`
            : `This transfer's fee (${preflight.transferFee.feeRaw} raw) exceeds the policy's cap of ${policy.maxFeeRaw} raw.`,
        },
  );

  findings.push(
    policy.recipientAllowlist === "ANY" || policy.recipientAllowlist.includes(input.recipient)
      ? { rule: "RECIPIENT_ALLOWED", outcome: "ALLOWED", detail: "The recipient is allowed by the policy." }
      : {
          rule: "RECIPIENT_ALLOWED",
          outcome: "BLOCKED",
          detail: `Recipient ${input.recipient} is not on the policy's allowlist.`,
        },
  );

  findings.push(
    policy.maxAmountRaw === null || BigInt(input.amountRaw) <= BigInt(policy.maxAmountRaw)
      ? { rule: "AMOUNT_WITHIN_LIMIT", outcome: "ALLOWED", detail: "The amount is within the policy's limit." }
      : {
          rule: "AMOUNT_WITHIN_LIMIT",
          outcome: "BLOCKED",
          detail: `Amount ${input.amountRaw} raw exceeds the policy's limit of ${policy.maxAmountRaw} raw.`,
        },
  );

  const defaultFrozen = preflight.structuralBlockers.includes("DEFAULT_ACCOUNT_STATE_FROZEN");
  findings.push(
    !defaultFrozen
      ? {
          rule: "DEFAULT_FROZEN_ACCEPTED",
          outcome: "ALLOWED",
          detail: "New token accounts on this mint do not start frozen.",
        }
      : policy.acceptDefaultFrozenAccounts
        ? {
            rule: "DEFAULT_FROZEN_ACCEPTED",
            outcome: "REVIEW_REQUIRED",
            detail:
              "New token accounts start frozen on this mint; the policy accepts this, but a person should confirm the recipient's account is thawed before sending.",
          }
        : {
            rule: "DEFAULT_FROZEN_ACCEPTED",
            outcome: "BLOCKED",
            detail: STRUCTURAL_DETAIL.DEFAULT_ACCOUNT_STATE_FROZEN + " The policy does not accept this.",
          },
  );

  const observed = Date.parse(passport.observedAt);
  const ageSeconds = Number.isFinite(observed) ? Math.max(0, Math.round((now.getTime() - observed) / 1000)) : null;
  findings.push(
    ageSeconds !== null && ageSeconds <= policy.maxEvidenceAgeSeconds
      ? {
          rule: "EVIDENCE_FRESH",
          outcome: "ALLOWED",
          detail: `The evidence is ${ageSeconds}s old, within the policy's ${policy.maxEvidenceAgeSeconds}s budget.`,
        }
      : {
          rule: "EVIDENCE_FRESH",
          outcome: "INCOMPLETE",
          detail:
            ageSeconds === null
              ? "The evidence carries no readable observation time; its freshness cannot be established."
              : `The evidence is ${ageSeconds}s old, beyond the policy's ${policy.maxEvidenceAgeSeconds}s budget; re-read the mint before deciding.`,
        },
  );

  findings.push(
    preflight.unsupportedKinds.length === 0
      ? {
          rule: "EXTENSIONS_UNDERSTOOD",
          outcome: "ALLOWED",
          detail: "Every extension on the mint decodes with written semantics.",
        }
      : {
          rule: "EXTENSIONS_UNDERSTOOD",
          outcome: "INCOMPLETE",
          detail: `The mint carries extensions this version has no semantics for (${preflight.unsupportedKinds.join(", ")}); their powers are unknown, not absent.`,
        },
  );

  findings.push(
    policy.requireHumanApproval
      ? {
          rule: "HUMAN_APPROVAL",
          outcome: "REVIEW_REQUIRED",
          detail: "The policy requires a human to authorize this transfer before any signature.",
        }
      : {
          rule: "HUMAN_APPROVAL",
          outcome: "ALLOWED",
          detail: "The policy does not require a separate human approval for this transfer.",
        },
  );

  const outcomes = new Set(findings.map((finding) => finding.outcome));
  const verdict = outcomes.has("BLOCKED")
    ? "BLOCKED"
    : outcomes.has("INCOMPLETE")
      ? "INCOMPLETE"
      : outcomes.has("REVIEW_REQUIRED")
        ? "REVIEW_REQUIRED"
        : "NO_KNOWN_BLOCKER";

  return SolanaPolicyVerdictSchema.parse({
    schema: "ryntra.solana.policy-verdict",
    schemaVersion: "0.1.0",
    verdict,
    findings,
    evaluatedAt: now.toISOString(),
  });
}

/**
 * Native SOL has no mint powers. The token rules are not run and not
 * reported as ALLOWED — that would be a USDC verdict wearing a SOL coat.
 */
export function evaluateNativeSolPolicy(args: {
  policy: SolanaOwnerPolicy;
  input: NativeSolTransferInput;
  preflight: SplTransferPreflight;
  now?: Date;
}): SolanaPolicyVerdict {
  const policy = SolanaOwnerPolicySchema.parse(args.policy);
  const { input, preflight } = args;
  const now = args.now ?? new Date();
  const findings: Finding[] = [];

  findings.push(
    policy.allowedNetworks.includes(input.network)
      ? { rule: "NETWORK_ALLOWED", outcome: "ALLOWED", detail: `Network ${input.network} is allowed by the policy.` }
      : {
          rule: "NETWORK_ALLOWED",
          outcome: "BLOCKED",
          detail: `Network ${input.network} is not among the policy's allowed networks (${policy.allowedNetworks.join(", ")}).`,
        },
  );

  findings.push({
    rule: "MINT_ALLOWED",
    outcome: "ALLOWED",
    detail: "Native SOL is not a mint; the mint allowlist does not apply.",
  });

  findings.push({
    rule: "TOKEN_PROGRAM_ALLOWED",
    outcome: "ALLOWED",
    detail: "Native SOL moves through the System Program, not a token program.",
  });

  findings.push({
    rule: "NOT_STRUCTURALLY_DOOMED",
    outcome: "ALLOWED",
    detail: "Native SOL has no mint configuration that can freeze, pause or forbid a transfer.",
  });

  findings.push({
    rule: "PERMANENT_DELEGATE_ACCEPTED",
    outcome: "ALLOWED",
    detail: "Native SOL carries no permanent delegate.",
  });

  findings.push({
    rule: "TRANSFER_HOOK_ALLOWLISTED",
    outcome: "ALLOWED",
    detail: "Native SOL runs no transfer hook.",
  });

  findings.push({
    rule: "FEE_WITHIN_CAP",
    outcome: "ALLOWED",
    detail: "Native SOL has no mint fee.",
  });

  findings.push(
    policy.recipientAllowlist === "ANY" || policy.recipientAllowlist.includes(input.recipient)
      ? { rule: "RECIPIENT_ALLOWED", outcome: "ALLOWED", detail: "The recipient is allowed by the policy." }
      : {
          rule: "RECIPIENT_ALLOWED",
          outcome: "BLOCKED",
          detail: `Recipient ${input.recipient} is not on the policy's allowlist.`,
        },
  );

  findings.push(
    policy.maxAmountRaw === null || BigInt(input.amountRaw) <= BigInt(policy.maxAmountRaw)
      ? { rule: "AMOUNT_WITHIN_LIMIT", outcome: "ALLOWED", detail: "The amount is within the policy's limit." }
      : {
          rule: "AMOUNT_WITHIN_LIMIT",
          outcome: "BLOCKED",
          detail: `Amount ${input.amountRaw} lamports exceeds the policy's limit of ${policy.maxAmountRaw}.`,
        },
  );

  findings.push({
    rule: "DEFAULT_FROZEN_ACCEPTED",
    outcome: "ALLOWED",
    detail: "Native SOL accounts do not start frozen.",
  });

  const observed = Date.parse(preflight.observedAt);
  const ageSeconds = Number.isFinite(observed) ? Math.max(0, Math.round((now.getTime() - observed) / 1000)) : null;
  findings.push(
    ageSeconds !== null && ageSeconds <= policy.maxEvidenceAgeSeconds
      ? {
          rule: "EVIDENCE_FRESH",
          outcome: "ALLOWED",
          detail: `The evidence is ${ageSeconds}s old, within the policy's ${policy.maxEvidenceAgeSeconds}s budget.`,
        }
      : {
          rule: "EVIDENCE_FRESH",
          outcome: "INCOMPLETE",
          detail:
            ageSeconds === null
              ? "The evidence carries no readable observation time; its freshness cannot be established."
              : `The evidence is ${ageSeconds}s old, beyond the policy's ${policy.maxEvidenceAgeSeconds}s budget.`,
        },
  );

  findings.push({
    rule: "EXTENSIONS_UNDERSTOOD",
    outcome: "ALLOWED",
    detail: "Native SOL has no token extensions.",
  });

  findings.push(
    policy.requireHumanApproval
      ? {
          rule: "HUMAN_APPROVAL",
          outcome: "REVIEW_REQUIRED",
          detail: "The policy requires a human to authorize this transfer before any signature.",
        }
      : {
          rule: "HUMAN_APPROVAL",
          outcome: "ALLOWED",
          detail: "The policy does not require a separate human approval for this transfer.",
        },
  );

  const outcomes = new Set(findings.map((finding) => finding.outcome));
  const verdict = outcomes.has("BLOCKED")
    ? "BLOCKED"
    : outcomes.has("INCOMPLETE")
      ? "INCOMPLETE"
      : outcomes.has("REVIEW_REQUIRED")
        ? "REVIEW_REQUIRED"
        : "NO_KNOWN_BLOCKER";

  return SolanaPolicyVerdictSchema.parse({
    schema: "ryntra.solana.policy-verdict",
    schemaVersion: "0.1.0",
    verdict,
    findings,
    evaluatedAt: now.toISOString(),
  });
}
