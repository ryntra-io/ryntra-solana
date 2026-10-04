import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_MAINNET_USDC_MINT,
  SolanaCanaryIntentSchema,
  resolveSolanaAtaApprovalConfiguration,
  resolveSolanaToken2022Approval,
  solanaToken2022SemanticDigest,
  type SolanaCanaryIntent,
} from "./canary-policy.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, type SendActionKind } from "./send-kinds.ts";
import type { SendCanaryValuation } from "./canary-valuation.ts";
import type { TransferPlan } from "./transaction.ts";
import {
  COMPUTE_BUDGET_PROGRAM,
  LIGHTHOUSE_PROGRAM,
} from "./wallet-modification.ts";

function canaryFamily(kind: SendActionKind): SolanaCanaryIntent["family"] {
  if (kind === "TOKEN_ATA_CREATE") return "ATA_CREATE";
  if (kind === "TOKEN_2022") return "TOKEN_2022";
  return "SEND";
}

export function buildSendCanaryIntent(args: {
  plan: TransferPlan;
  humanApproval: SolanaCanaryIntent["humanApproval"];
  valuation?: SendCanaryValuation | null;
}): SolanaCanaryIntent {
  const observedAtMs = Date.parse(args.plan.builtAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new Error("A Send canary intent requires the plan's timezone-qualified build time.");
  }
  const nominalUsdc =
    args.plan.mint === SOLANA_MAINNET_USDC_MINT &&
    args.plan.decimals === 6 &&
    args.plan.actionKind !== "NATIVE_SOL";
  /**
   * Two lawful valuation shapes, each checked on its own terms.
   *
   * Classic mainnet USDC is *nominal*: six decimals of a dollar-denominated
   * mint means the base-unit amount already is the USD-micro amount, so the
   * principal must equal `amountRaw` exactly and anything else is a bug.
   *
   * A Token-2022 mint has no such identity. Its principal comes from a priced
   * quote, so it cannot equal `amountRaw` and must not be required to — that
   * requirement is what made every Token-2022 canary unpriceable, which then
   * left the policy with a null exposure and no verdict but `UNKNOWN`. What is
   * required instead is that the value came from a quote rather than from
   * nowhere.
   */
  if (args.valuation) {
    const method = args.valuation.valuation?.method ?? null;
    if (args.plan.actionKind === "TOKEN_2022") {
      if (method !== "PROVIDER_QUOTE" || args.valuation.principalUsdMicros === null) {
        throw new Error(
          "A Token-2022 canary valuation must carry a sourced provider quote and an exact principal.",
        );
      }
    } else if (!nominalUsdc || args.valuation.principalUsdMicros !== args.plan.amountRaw) {
      throw new Error("A Send canary valuation must bind this exact classic-USDC plan amount.");
    }
  }
  const valuation = args.valuation ?? null;
  return SolanaCanaryIntentSchema.parse({
    schema: "ryntra.solana.canary-intent",
    schemaVersion: "1.0.0",
    intentId: `send:${args.plan.fingerprint.messageHash}`,
    revision: 1,
    family: canaryFamily(args.plan.actionKind),
    network: "mainnet",
    destination: args.plan.recipient,
    mints: [args.plan.mint],
    programs: [...new Set(args.plan.programs)].sort(),
    principalUsdMicros: valuation?.principalUsdMicros ?? (nominalUsdc ? args.plan.amountRaw : null),
    feeReserveUsdMicros: valuation?.feeReserveUsdMicros ?? null,
    usdMicros: valuation?.usdMicros ?? null,
    valuation: valuation?.valuation ?? null,
    humanApproval: args.humanApproval,
  });
}

/**
 * Why an approval did or did not attach, in a sentence.
 *
 * `resolveSendCanaryHumanApproval` answers with the two words the intent schema
 * holds, which is the right shape for the policy and the wrong shape for a
 * person staring at a `REVIEW` verdict wondering which of nineteen fields moved.
 * The detailed answer is computed once, here, and both callers read it.
 */
export type SendCanaryApprovalAssessment = Readonly<{
  state: SolanaCanaryIntent["humanApproval"];
  reason: string;
}>;

/**
 * Does an owner approval cover this exact Token-2022 plan?
 *
 * Every comparison below is an equality against something the owner wrote down
 * before the wallet opened. There is no tolerance anywhere and no field that
 * may differ: an approval authorizes one transfer, and a transfer that differs
 * in any of these is a different transfer that needs its own Review and its own
 * yes.
 *
 * The delegate is passed in rather than read from the plan on purpose. It is a
 * fact about the mint at build time, the plan carries the classifier verdict
 * rather than the authority itself, and an approval that could not check it
 * would be an approval that survives the issuer changing the very control the
 * canary exists to display.
 */
export function assessToken2022CanaryApproval(args: {
  plan: TransferPlan;
  /** The permanent delegate this build read from the mint, or null if none. */
  permanentDelegate: string | null;
  env?: Record<string, string | undefined>;
  now?: Date;
}): SendCanaryApprovalAssessment {
  const { plan } = args;
  const approval = resolveSolanaToken2022Approval(args.env ?? process.env);
  if (!approval) {
    return {
      state: "NOT_RECORDED",
      reason: "No Token-2022 owner approval is configured, so no Token-2022 action is authorized.",
    };
  }

  const now = args.now ?? new Date();
  const expiresAt = Date.parse(approval.expiresAt);
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) {
    return {
      state: "NOT_RECORDED",
      reason: "The Token-2022 owner approval has expired; an approval does not outlive the Review it was given against.",
    };
  }

  /* The debit is what leaves the sender; the credit is what survives the mint's
     own fee on the way in. Computed from the plan rather than restated, so a
     fee that changed between builds cannot pass as the reviewed one. */
  const feeRaw = plan.sources.reduce((total, source) => total + BigInt(source.feeRaw), 0n);
  const expectedDebitRaw = plan.amountRaw;
  const expectedCreditRaw = (BigInt(plan.amountRaw) - feeRaw).toString();

  const mismatches: string[] = [];
  const require = (ok: boolean, field: string) => {
    if (!ok) mismatches.push(field);
  };

  require(plan.network === "mainnet", "network");
  require(plan.actionKind === "TOKEN_2022", "action family");
  require(plan.tokenProgram === TOKEN_2022_PROGRAM_ID, "token program");
  require(plan.sender === approval.sourceWallet, "source wallet");
  /* Both, because they are the same address only when the destination entered
     was a wallet. An existing token account whose owner is somebody else would
     satisfy one and not the other, and the approval names a wallet. */
  require(plan.recipient === approval.destinationWallet, "recipient");
  require(plan.recipientOwner === approval.destinationWallet, "recipient account owner");
  require(plan.mint === approval.mint, "mint");
  require(plan.decimals === approval.decimals, "decimals");
  require(plan.amountRaw === approval.amountRaw, "amount");
  require(plan.createsRecipientAccount === approval.createsRecipientAccount, "recipient account creation");
  require(args.permanentDelegate === approval.permanentDelegate, "permanent delegate");
  require(expectedDebitRaw === approval.expectedDebitRaw, "expected debit");
  require(expectedCreditRaw === approval.expectedCreditRaw, "expected credit");
  require(plan.fingerprint.messageHash === approval.reviewDigest, "reviewed transaction");

  if (args.permanentDelegate !== null) {
    const semantic = solanaToken2022SemanticDigest({
      sourceWallet: plan.sender,
      destinationWallet: plan.recipientOwner,
      mint: plan.mint,
      tokenProgram: plan.tokenProgram,
      decimals: plan.decimals,
      amountRaw: plan.amountRaw,
      extensionCase: approval.extensionCase,
      permanentDelegate: args.permanentDelegate,
      createsRecipientAccount: plan.createsRecipientAccount,
      expectedDebitRaw,
      expectedCreditRaw,
    });
    require(semantic === approval.semanticDigest, "semantic action digest");
  }

  if (mismatches.length > 0) {
    return {
      state: "NOT_RECORDED",
      reason: `The Token-2022 owner approval describes a different action. It does not match on: ${mismatches.join(", ")}.`,
    };
  }
  return {
    state: "RECORDED",
    reason: `Owner approval ${approval.approvalRef} covers this exact transfer and expires at ${approval.expiresAt}.`,
  };
}

export function resolveSendCanaryHumanApproval(
  plan: TransferPlan,
  env: Record<string, string | undefined> = process.env,
): SolanaCanaryIntent["humanApproval"] {
  /* Token-2022 has its own envelope and never borrows M1B's. The ATA tuple
     below describes a classic-USDC transfer on the classic token program, and
     letting it answer for a Token-2022 action would be exactly the carried-over
     approval this family must not have.

     The delegate is not available on this signature, so this entry point can
     only ever answer NOT_RECORDED for Token-2022. That is the safe direction:
     a caller that wants a Token-2022 approval calls the assessment above and
     passes the fact it read. */
  if (plan.actionKind === "TOKEN_2022") return "NOT_RECORDED";

  const approval = resolveSolanaAtaApprovalConfiguration(env);
  if (!approval) return "NOT_RECORDED";

  const basePrograms = [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID].sort();
  const computePrograms = [...basePrograms, COMPUTE_BUDGET_PROGRAM].sort();
  const guardedPrograms = [...computePrograms, LIGHTHOUSE_PROGRAM].sort();
  const actualPrograms = [...new Set(plan.programs)].sort();
  const exactPrograms = [basePrograms, computePrograms, guardedPrograms].some(
    (candidate) =>
      candidate.length === actualPrograms.length &&
      candidate.every((program, index) => program === actualPrograms[index]),
  );
  const matches =
    plan.network === "mainnet" &&
    plan.actionKind === "TOKEN_ATA_CREATE" &&
    plan.createsRecipientAccount === true &&
    plan.ataRentLamports !== null &&
    plan.mint === SOLANA_MAINNET_USDC_MINT &&
    plan.tokenProgram === TOKEN_PROGRAM_ID &&
    plan.decimals === 6 &&
    plan.recipient === approval.recipient &&
    plan.amountRaw === approval.amountRaw &&
    exactPrograms;
  return matches ? "RECORDED" : "NOT_RECORDED";
}
