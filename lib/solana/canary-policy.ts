import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../guard/canonical-json.ts";
import {
  SOLANA_MAINNET_USDC_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "./send-kinds.ts";
import {
  COMPUTE_BUDGET_PROGRAM,
  LIGHTHOUSE_PROGRAM,
} from "./wallet-modification.ts";

export { SOLANA_MAINNET_USDC_MINT } from "./send-kinds.ts";

const RAW_USD_MICROS = /^(0|[1-9][0-9]*)$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_TARGET = /^eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}$/;
const TARGET = z.string().min(1).max(128).refine(
  (value) => BASE58_ADDRESS.test(value) || EVM_TARGET.test(value),
  "Target must be a Solana address or chain-qualified EVM address.",
);
const RawUsdMicros = z.string().regex(RAW_USD_MICROS);

export const SOLANA_CANARY_FAMILIES = [
  "SEND",
  "ATA_CREATE",
  "SWAP",
  "CCTP",
  "TOKEN_2022",
] as const;
export type SolanaCanaryFamily = (typeof SOLANA_CANARY_FAMILIES)[number];

export const SOLANA_CANARY_DECISIONS = [
  "ALLOW",
  "REVIEW",
  "BLOCK",
  "PAUSE",
  "UNKNOWN",
] as const;
export type SolanaCanaryDecision = (typeof SOLANA_CANARY_DECISIONS)[number];

export const BASE_MAINNET_USDC_ASSET_REF = "eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SOLANA_CANARY_TOTAL_LIMIT_USD_MICROS = "20000000";

export const SOLANA_CANARY_ENV = {
  state: "RYNTRA_SOLANA_CANARY_STATE",
  destinations: "RYNTRA_SOLANA_CANARY_DESTINATIONS",
  bridgeDestinations: "RYNTRA_SOLANA_CANARY_BRIDGE_DESTINATIONS",
  swapPrograms: "RYNTRA_SOLANA_CANARY_SWAP_PROGRAMS",
  cctpPrograms: "RYNTRA_SOLANA_CANARY_CCTP_PROGRAMS",
  token2022Mints: "RYNTRA_SOLANA_CANARY_TOKEN_2022_MINTS",
} as const;

export const SOLANA_CANARY_APPROVAL_ENV = {
  ataRecipient: "RYNTRA_SOLANA_CANARY_ATA_APPROVED_RECIPIENT",
  ataAmountRaw: "RYNTRA_SOLANA_CANARY_ATA_APPROVED_AMOUNT_RAW",
  ataApprovalRef: "RYNTRA_SOLANA_CANARY_ATA_APPROVAL_REF",
} as const;

const FamilyPolicySchema = z
  .object({
    minimumUsdMicros: RawUsdMicros,
    maximumUsdMicros: RawUsdMicros,
    allowedDestinations: z.array(TARGET).max(32),
    /* CCTP crosses one Solana program namespace and one EVM contract
       namespace. Chain-qualified EVM references prevent an address on Base
       from being confused with the same bytes on another EVM domain. Other
       families still receive only their fixed base58 allowlists below. */
    allowedMints: z.array(TARGET).max(32),
    allowedPrograms: z.array(TARGET).max(64),
    requireHumanApproval: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (BigInt(value.minimumUsdMicros) > BigInt(value.maximumUsdMicros)) {
      context.addIssue({
        code: "custom",
        path: ["minimumUsdMicros"],
        message: "Minimum canary value cannot exceed the maximum.",
      });
    }
  });

export const SolanaCanaryPolicySchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-policy"),
    schemaVersion: z.literal("1.0.0"),
    policyId: z.string().min(1).max(96),
    state: z.enum(["OPEN", "PAUSED"]),
    totalLimitUsdMicros: RawUsdMicros,
    valuationMaxAgeSeconds: z.number().int().min(1).max(3_600),
    families: z
      .object({
        SEND: FamilyPolicySchema,
        ATA_CREATE: FamilyPolicySchema,
        SWAP: FamilyPolicySchema,
        CCTP: FamilyPolicySchema,
        TOKEN_2022: FamilyPolicySchema,
      })
      .strict(),
    source: z
      .object({
        ref: z.string().min(1).max(256),
        label: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();

export type SolanaCanaryPolicy = z.output<typeof SolanaCanaryPolicySchema>;

const FamilyBudgetSchema = z
  .object({
    reservedUsdMicros: RawUsdMicros,
    spentUsdMicros: RawUsdMicros,
  })
  .strict();

export const SolanaCanaryBudgetSnapshotSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-budget-snapshot"),
    schemaVersion: z.literal("1.0.0"),
    policyId: z.string().min(1).max(96),
    readState: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    storeBoundary: z.enum([
      "EPHEMERAL_SINGLE_INSTANCE",
      "DURABLE_SINGLE_WRITER",
      "DURABLE_MULTI_WRITER",
      "UNAVAILABLE",
    ]),
    totalLimitUsdMicros: RawUsdMicros,
    reservedUsdMicros: RawUsdMicros,
    spentUsdMicros: RawUsdMicros,
    feeReservedUsdMicros: RawUsdMicros,
    feeSpentUsdMicros: RawUsdMicros,
    families: z
      .object({
        SEND: FamilyBudgetSchema,
        ATA_CREATE: FamilyBudgetSchema,
        SWAP: FamilyBudgetSchema,
        CCTP: FamilyBudgetSchema,
        TOKEN_2022: FamilyBudgetSchema,
      })
      .strict(),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const familyReserved = SOLANA_CANARY_FAMILIES.reduce(
      (sum, family) => sum + BigInt(value.families[family].reservedUsdMicros),
      0n,
    );
    const familySpent = SOLANA_CANARY_FAMILIES.reduce(
      (sum, family) => sum + BigInt(value.families[family].spentUsdMicros),
      0n,
    );
    if (familyReserved + BigInt(value.feeReservedUsdMicros) !== BigInt(value.reservedUsdMicros)) {
      context.addIssue({ code: "custom", path: ["reservedUsdMicros"], message: "Principal plus fee reservations do not match the package reservation." });
    }
    if (familySpent + BigInt(value.feeSpentUsdMicros) !== BigInt(value.spentUsdMicros)) {
      context.addIssue({ code: "custom", path: ["spentUsdMicros"], message: "Principal plus fee spends do not match the package spend." });
    }
  });

export type SolanaCanaryBudgetSnapshot = z.output<typeof SolanaCanaryBudgetSnapshotSchema>;

export const SolanaCanaryIntentSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-intent"),
    schemaVersion: z.literal("1.0.0"),
    intentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    family: z.enum(SOLANA_CANARY_FAMILIES),
    network: z.literal("mainnet"),
    destination: TARGET,
    mints: z.array(TARGET).min(1).max(8),
    programs: z.array(TARGET).min(1).max(64),
    principalUsdMicros: RawUsdMicros.nullable(),
    feeReserveUsdMicros: RawUsdMicros.nullable(),
    usdMicros: RawUsdMicros.nullable(),
    valuation: z
      .object({
        method: z.enum(["USDC_NOMINAL", "PROVIDER_QUOTE", "CHAIN_READ"]),
        sourceRef: z.string().min(1).max(256),
        observedAt: z.string().datetime({ offset: true }),
        validUntil: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
    humanApproval: z.enum(["NOT_RECORDED", "RECORDED"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.usdMicros === null) return;
    if (value.principalUsdMicros === null || value.feeReserveUsdMicros === null) {
      context.addIssue({
        code: "custom",
        path: ["usdMicros"],
        message: "Total USD-micro exposure requires principal and fee-reserve components.",
      });
      return;
    }
    if (BigInt(value.principalUsdMicros) + BigInt(value.feeReserveUsdMicros) !== BigInt(value.usdMicros)) {
      context.addIssue({
        code: "custom",
        path: ["usdMicros"],
        message: "Total USD-micro exposure must equal principal plus fee reserve.",
      });
    }
  });

export type SolanaCanaryIntent = z.output<typeof SolanaCanaryIntentSchema>;

/**
 * The identity of the deterministic closed fallback, declared here because the
 * evaluator has to recognise it and the evaluator may not import the runtime.
 *
 * A policy this product could not read is never a configured one, however
 * self-consistent it looks. The budget snapshot is derived *from* the policy it
 * is read with, so a fallback and its own snapshot agree on both the id and the
 * ceiling — and `CONFIG_VALID` came out `PASS` on a live degraded preview, in a
 * signed bundle, about a configuration nobody could read. Recognising the
 * identity is what stops that.
 */
export const SOLANA_CANARY_FALLBACK_POLICY_ID = "ryntra.solana.canary-policy.fallback-closed.v1";

export const SOLANA_CANARY_RULES = [
  "CONFIG_VALID",
  "EMERGENCY_STOP",
  "MAINNET_ONLY",
  "DESTINATION_ALLOWLISTED",
  "MINTS_ALLOWLISTED",
  "PROGRAMS_ALLOWLISTED",
  "VALUATION_CURRENT",
  "FAMILY_LIMIT",
  "TOTAL_LIMIT",
  "HUMAN_APPROVAL",
] as const;

const FindingSchema = z
  .object({
    rule: z.enum(SOLANA_CANARY_RULES),
    outcome: z.enum(["PASS", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"]),
    detail: z.string().min(1).max(512),
  })
  .strict();

/**
 * Whether this action was ever inside the envelope this policy governs.
 *
 * The four rules below are membership, not judgement: they ask whether the
 * owner recorded *this* destination, *this* mint, *these* programs and *this*
 * approval as a canary action. An action that fails them was never inside the
 * envelope — the policy is not refusing it, it has nothing to say about it.
 *
 * The distinction has to travel with the verdict because the verdict is signed
 * into evidence. Since 2026-08-29 an ordinary user-signed Send is decided by
 * the transfer-capability classifier over fresh chain facts, not by this
 * engine, so a `BLOCK` carried into a receipt with no scope beside it reads as
 * a refusal somebody overrode. It was not one, and the record should not need
 * a footnote to say so.
 */
export const SOLANA_CANARY_MEMBERSHIP_RULES = [
  "DESTINATION_ALLOWLISTED",
  "MINTS_ALLOWLISTED",
  "PROGRAMS_ALLOWLISTED",
  "HUMAN_APPROVAL",
] as const;

export const SOLANA_CANARY_SCOPES = ["INSIDE_ENVELOPE", "OUTSIDE_ENVELOPE"] as const;

const ScopeSchema = z
  .object({
    status: z.enum(SOLANA_CANARY_SCOPES),
    decidedBy: z.enum(["OWNER_CANARY", "TRANSFER_CAPABILITY"]),
    detail: z.string().min(1).max(512),
  })
  .strict();

export const SolanaCanaryVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-verdict"),
    schemaVersion: z.literal("1.0.0"),
    decision: z.enum(SOLANA_CANARY_DECISIONS),
    newRiskAllowed: z.boolean(),
    scope: ScopeSchema,
    policyId: z.string().min(1).max(96),
    policyDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    budgetObservedAt: z.string().datetime({ offset: true }),
    findings: z.array(FindingSchema).length(SOLANA_CANARY_RULES.length),
    evaluatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SolanaCanaryVerdict = z.output<typeof SolanaCanaryVerdictSchema>;

export type SolanaCanaryPolicyResolution =
  | Readonly<{ ok: true; policy: SolanaCanaryPolicy }>
  | Readonly<{ ok: false; reason: string }>;

type CanaryEnv = Record<string, string | undefined>;

export type SolanaAtaApprovalConfiguration = Readonly<{
  recipient: string;
  amountRaw: string;
  approvalRef: string;
}>;

export function resolveSolanaAtaApprovalConfiguration(
  env: CanaryEnv = process.env,
): SolanaAtaApprovalConfiguration | null {
  const rawRecipient = env[SOLANA_CANARY_APPROVAL_ENV.ataRecipient];
  const rawAmount = env[SOLANA_CANARY_APPROVAL_ENV.ataAmountRaw];
  const rawApprovalRef = env[SOLANA_CANARY_APPROVAL_ENV.ataApprovalRef];
  const supplied = [rawRecipient, rawAmount, rawApprovalRef].filter((value) => value !== undefined).length;
  if (supplied === 0) return null;

  const recipient = rawRecipient?.trim() ?? "";
  const amountRaw = rawAmount?.trim() ?? "";
  const approvalRef = rawApprovalRef?.trim() ?? "";
  if (supplied !== 3 || !recipient || !amountRaw || !approvalRef) {
    throw new Error("The exact ATA approval configuration must be complete.");
  }
  z.string().regex(BASE58_ADDRESS).parse(recipient);
  if (!RAW_USD_MICROS.test(amountRaw) || BigInt(amountRaw) === 0n || BigInt(amountRaw) > 500_000n) {
    throw new Error("The exact ATA approval amount must be a canonical value from 1 through 500000 raw USDC units.");
  }
  if (approvalRef.length > 256) throw new Error("The exact ATA approval reference is too long.");
  return { recipient, amountRaw, approvalRef };
}

/* ------------------------------------------------------------------------- *
 * The Token-2022 owner approval envelope — RYN-SOL-M4
 * ------------------------------------------------------------------------- */

const HEX_DIGEST = /^0x[0-9a-f]{64}$/;
const RAW_TOKEN_AMOUNT = /^(0|[1-9][0-9]*)$/;

/**
 * The exact Token-2022 action one owner approval authorizes, and nothing else.
 *
 * `RYN-SOL-M1B` proved the shape of this idea with three environment variables
 * — recipient, amount, reference — because the action it fenced had three
 * degrees of freedom. A Token-2022 transfer has far more, and each is a way for
 * the signed action to differ from the reviewed one: a different mint, a token
 * program that is not Token-2022, an amount, a delegate that changed between
 * the read and the prompt, an account creation that appeared or vanished, a
 * price the exposure was computed from, a policy version, a blockhash. Naming
 * them one variable at a time would be nineteen variables and no way to check
 * that they describe a single coherent action, so the envelope is one strict
 * JSON document instead, parsed and bound as a unit.
 *
 * **This is deliberately not an "approve Token-2022" switch.** There is no
 * wildcard in this schema, `mint` is one address, `amountRaw` is one integer,
 * and `expiresAt` makes the whole thing perishable. An approval for the exact
 * transfer below cannot authorize the next one.
 *
 * Two digests, because they fail differently. `semanticDigest` covers the
 * economic action — who sends what, to whom, on which mint, under which
 * extension case — and survives a blockhash refresh, so a Review that expires
 * and is rebuilt unchanged can be recognised as the same intent. `reviewDigest`
 * is the exact reviewed message hash, so anything that changes the bytes a
 * wallet would sign, blockhash included, invalidates the approval outright.
 */
export const SolanaToken2022ApprovalSchema = z
  .object({
    taskId: z.literal("RYN-SOL-M4"),
    family: z.literal("TOKEN_2022"),
    network: z.literal("mainnet"),
    sourceWallet: z.string().regex(BASE58_ADDRESS),
    destinationWallet: z.string().regex(BASE58_ADDRESS),
    mint: z.string().regex(BASE58_ADDRESS),
    tokenProgram: z.literal(TOKEN_2022_PROGRAM_ID),
    decimals: z.number().int().min(0).max(255),
    amountRaw: z.string().regex(RAW_TOKEN_AMOUNT),
    /* One case per approval. The canary proves the case it names and the
       registry may promote no more than that. */
    extensionCase: z.literal("PERMANENT_DELEGATE_VISIBILITY"),
    /* The exact authority the Review states. If the mint's delegate changes
       between the read and the prompt, the control fact the person authorized
       against is no longer true and the approval must not survive it. */
    permanentDelegate: z.string().regex(BASE58_ADDRESS),
    createsRecipientAccount: z.boolean(),
    expectedDebitRaw: z.string().regex(RAW_TOKEN_AMOUNT),
    expectedCreditRaw: z.string().regex(RAW_TOKEN_AMOUNT),
    valuationSourceRef: z.string().min(1).max(256),
    valuationMaxAgeSeconds: z.number().int().min(1).max(3_600),
    policyId: z.string().min(1).max(96),
    semanticDigest: z.string().regex(HEX_DIGEST),
    reviewDigest: z.string().regex(HEX_DIGEST),
    approvalRef: z.string().min(1).max(256),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SolanaToken2022Approval = z.output<typeof SolanaToken2022ApprovalSchema>;

export const SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV = "RYNTRA_SOLANA_CANARY_TOKEN_2022_APPROVAL";

/**
 * The digest of the economic action, independent of the bytes that carry it.
 *
 * Every field here is something a person weighed before saying yes. The
 * blockhash is not one of them, which is the whole point of computing this
 * separately from the message hash.
 */
export function solanaToken2022SemanticDigest(action: {
  sourceWallet: string;
  destinationWallet: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  amountRaw: string;
  extensionCase: string;
  permanentDelegate: string;
  createsRecipientAccount: boolean;
  expectedDebitRaw: string;
  expectedCreditRaw: string;
}): string {
  return digest("ryntra.solana.token-2022-canary-action.v1", {
    sourceWallet: action.sourceWallet,
    destinationWallet: action.destinationWallet,
    mint: action.mint,
    tokenProgram: action.tokenProgram,
    decimals: action.decimals,
    amountRaw: action.amountRaw,
    extensionCase: action.extensionCase,
    permanentDelegate: action.permanentDelegate,
    createsRecipientAccount: action.createsRecipientAccount,
    expectedDebitRaw: action.expectedDebitRaw,
    expectedCreditRaw: action.expectedCreditRaw,
  });
}

/**
 * Read the Token-2022 approval envelope, or `null` when none is configured.
 *
 * Absent is a lawful state and means exactly one thing: no Token-2022 action is
 * owner-approved, so `HUMAN_APPROVAL` cannot pass and no wallet opens. Present
 * but malformed is not a lawful state and throws, because a policy that half
 * parses is worse than a policy that is missing — the missing one fails closed
 * and is visible, the half-parsed one fails somewhere later and is not.
 */
export function resolveSolanaToken2022Approval(
  env: CanaryEnv = process.env,
): SolanaToken2022Approval | null {
  const raw = env[SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV]?.trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV} is not valid JSON.`);
  }
  const approval = SolanaToken2022ApprovalSchema.parse(parsed);

  /* An envelope whose own digest does not describe its own fields is not an
     approval of anything. Checking it here means a typo in one address cannot
     travel as far as the plan comparison and be reported as a plan problem. */
  const expected = solanaToken2022SemanticDigest(approval);
  if (expected !== approval.semanticDigest) {
    throw new Error(
      `${SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV} carries a semantic digest that does not match its own action fields.`,
    );
  }
  if (BigInt(approval.expectedDebitRaw) < BigInt(approval.amountRaw)) {
    throw new Error(
      `${SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV} expects a debit smaller than the amount it authorizes.`,
    );
  }
  if (BigInt(approval.expectedCreditRaw) > BigInt(approval.amountRaw)) {
    throw new Error(
      `${SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV} expects the recipient to receive more than the amount it authorizes.`,
    );
  }
  return approval;
}

function parseCsv(
  env: CanaryEnv,
  key: string,
  schema: z.ZodType<string>,
): readonly string[] {
  const value = env[key]?.trim();
  if (!value) return [];
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length > 64 || entries.some((entry) => entry.length === 0)) {
    throw new Error(`${key} is not a bounded comma-separated allowlist.`);
  }
  const unique = new Set(entries);
  if (unique.size !== entries.length) throw new Error(`${key} contains a duplicate allowlist entry.`);
  for (const entry of entries) schema.parse(entry);
  return [...entries].sort();
}

export function resolveSolanaCanaryPolicy(env: CanaryEnv = process.env): SolanaCanaryPolicyResolution {
  try {
    const rawState = env[SOLANA_CANARY_ENV.state]?.trim().toUpperCase();
    if (rawState && rawState !== "OPEN" && rawState !== "PAUSED") {
      throw new Error(`${SOLANA_CANARY_ENV.state} must be OPEN or PAUSED.`);
    }
    const state = rawState === "OPEN" ? "OPEN" : "PAUSED";
    /* Legacy family fixtures retain their explicit configuration when M1B is
       absent. The moment the exact M1B tuple is present, it becomes an
       exclusive policy envelope: no other family inherits a shared
       destination allowlist. */
    const destinations = parseCsv(env, SOLANA_CANARY_ENV.destinations, TARGET);
    const ataApproval = resolveSolanaAtaApprovalConfiguration(env);
    const bridgeDestinations = parseCsv(env, SOLANA_CANARY_ENV.bridgeDestinations, TARGET);
    const swapPrograms = parseCsv(
      env,
      SOLANA_CANARY_ENV.swapPrograms,
      z.string().regex(BASE58_ADDRESS),
    );
    const cctpPrograms = parseCsv(
      env,
      SOLANA_CANARY_ENV.cctpPrograms,
      TARGET,
    );
    const token2022Mints = parseCsv(
      env,
      SOLANA_CANARY_ENV.token2022Mints,
      z.string().regex(BASE58_ADDRESS),
    );
    const token2022Approval = resolveSolanaToken2022Approval(env);
    /* The envelope and the allowlist are two owner statements about the same
       action, and they have to agree. A configured approval for a mint the
       allowlist does not carry is a contradiction, and resolving it silently in
       either direction would let one of the two statements be ignored. */
    if (token2022Approval && !token2022Mints.includes(token2022Approval.mint)) {
      throw new Error(
        `${SOLANA_CANARY_TOKEN_2022_APPROVAL_ENV} approves ${token2022Approval.mint}, which ${SOLANA_CANARY_ENV.token2022Mints} does not allow.`,
      );
    }

    return {
      ok: true,
      policy: SolanaCanaryPolicySchema.parse({
        schema: "ryntra.solana.canary-policy",
        schemaVersion: "1.0.0",
        policyId: "owner-mainnet-canary-v1",
        state,
        totalLimitUsdMicros: SOLANA_CANARY_TOTAL_LIMIT_USD_MICROS,
        valuationMaxAgeSeconds: 60,
        families: {
          SEND: {
            minimumUsdMicros: "0",
            maximumUsdMicros: "1000000",
            allowedDestinations: ataApproval ? [] : destinations,
            allowedMints: [SOLANA_MAINNET_USDC_MINT],
            allowedPrograms: [TOKEN_PROGRAM_ID],
            requireHumanApproval: true,
          },
          ATA_CREATE: {
            minimumUsdMicros: "0",
            maximumUsdMicros: "500000",
            allowedDestinations: ataApproval ? [ataApproval.recipient] : [],
            allowedMints: [SOLANA_MAINNET_USDC_MINT],
            allowedPrograms: [
              ASSOCIATED_TOKEN_PROGRAM_ID,
              TOKEN_PROGRAM_ID,
              COMPUTE_BUDGET_PROGRAM,
              LIGHTHOUSE_PROGRAM,
            ].sort(),
            requireHumanApproval: true,
          },
          SWAP: {
            minimumUsdMicros: "2000000",
            maximumUsdMicros: "5000000",
            allowedDestinations: ataApproval ? [] : destinations,
            allowedMints: [SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT].sort(),
            allowedPrograms: swapPrograms,
            requireHumanApproval: true,
          },
          CCTP: {
            minimumUsdMicros: "2000000",
            maximumUsdMicros: "5000000",
            allowedDestinations: ataApproval ? [] : bridgeDestinations,
            allowedMints: [SOLANA_MAINNET_USDC_MINT, BASE_MAINNET_USDC_ASSET_REF].sort(),
            allowedPrograms: cctpPrograms,
            requireHumanApproval: true,
          },
          TOKEN_2022: {
            minimumUsdMicros: "0",
            maximumUsdMicros: "2000000",
            /* An approved M4 envelope names its one destination and nothing
               else reaches it — the same exclusivity M1B established, for the
               same reason: a shared allowlist means an approval for one action
               quietly widens another. Without an envelope this falls back to
               the general canary destinations, and with neither it is empty,
               which blocks. */
            allowedDestinations: token2022Approval
              ? [token2022Approval.destinationWallet]
              : ataApproval
                ? []
                : destinations,
            /* Owner-set, and empty until the owner sets it. An empty allowlist
               is nobody, so this family fails closed by default. */
            allowedMints: token2022Mints,
            /* A Token-2022 transfer invokes its own program, the Associated
               Token Program when it has to create the recipient account, and
               the two guard programs a wallet may add. Listing only the token
               program blocked the account-creating case at
               `PROGRAMS_ALLOWLISTED` — a refusal about a program the product
               itself emits. */
            allowedPrograms: [
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
              COMPUTE_BUDGET_PROGRAM,
              LIGHTHOUSE_PROGRAM,
            ].sort(),
            requireHumanApproval: true,
          },
        },
        source: {
          ref: ataApproval?.approvalRef ?? "owner:decision:2026-08-27:solana-canary",
          label: ataApproval
            ? "Founder-approved exact Solana M1B ATA canary policy"
            : "Founder-approved Solana owner-canary policy",
        },
      }),
    };
  } catch (failure) {
    return {
      ok: false,
      reason: failure instanceof Error ? failure.message : "Solana canary policy configuration is invalid.",
    };
  }
}

function digest(domain: string, value: unknown): string {
  return `0x${createHash("sha256").update(`${domain}\n${canonicalJson(value)}`, "utf8").digest("hex")}`;
}

export function solanaCanaryIntentDigest(value: SolanaCanaryIntent): string {
  return digest("ryntra.solana.canary-intent.v1", SolanaCanaryIntentSchema.parse(value));
}

/**
 * The digest a verdict carries for the policy it was decided under.
 *
 * Exported so that anything writing a durable record naming a policy computes
 * it the one way, rather than a second implementation that agrees until the
 * policy shape changes.
 */
export function solanaCanaryPolicyDigest(value: SolanaCanaryPolicy): string {
  return digest("ryntra.solana.canary-policy.v1", SolanaCanaryPolicySchema.parse(value));
}

export function verifySolanaCanaryVerdictBinding(args: {
  intent: SolanaCanaryIntent;
  verdict: SolanaCanaryVerdict;
}): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  const intent = SolanaCanaryIntentSchema.parse(args.intent);
  const verdict = SolanaCanaryVerdictSchema.parse(args.verdict);
  if (verdict.intentDigest !== solanaCanaryIntentDigest(intent)) {
    return { ok: false, reason: "The canary verdict intent digest does not match the reviewed intent." };
  }
  return { ok: true };
}

type Finding = z.output<typeof FindingSchema>;

function finding(rule: Finding["rule"], outcome: Finding["outcome"], detail: string): Finding {
  return { rule, outcome, detail };
}

function includesEvery(allowlist: readonly string[], values: readonly string[]): boolean {
  const allowed = new Set(allowlist);
  return values.every((value) => allowed.has(value));
}

/**
 * One address, two spellings, and only one chain where that is true.
 *
 * An EVM address is a hex string whose letter case carries an EIP-55 checksum,
 * so `0xAbC…` and `0xabc…` are the same account; every block explorer shows the
 * checksummed form, which is what a person copies. The bridge plan route builds
 * the intent's destination as `eip155:8453:${lowercased}`
 * (`app/api/solana/bridge/plan/route.ts:129` over `cctp-plan.ts:402`), while this comparison was
 * exact — so an allowlist entry pasted in checksummed form would never match
 * the intent built from it, and the bridge would return a permanent `BLOCK`
 * that reads as a policy refusal rather than as a spelling.
 *
 * Latent rather than active: production holds the entry in lowercase today. It
 * is closed here because the next person to set it will copy from an explorer.
 *
 * Base58 is deliberately excluded. Solana addresses are case-sensitive — `A`
 * and `a` are different bytes — so folding them would widen an allowlist, which
 * is the opposite of what this function is for.
 */
const EVM_TARGET_FOLDABLE = /^eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}$/;
const foldEvm = (value: string) => (EVM_TARGET_FOLDABLE.test(value) ? value.toLowerCase() : value);

function highestDecision(findings: readonly Finding[]): SolanaCanaryDecision {
  if (findings.some((entry) => entry.outcome === "PAUSE")) return "PAUSE";
  if (findings.some((entry) => entry.outcome === "BLOCK")) return "BLOCK";
  if (findings.some((entry) => entry.outcome === "UNKNOWN")) return "UNKNOWN";
  if (findings.some((entry) => entry.outcome === "REVIEW")) return "REVIEW";
  return "ALLOW";
}

/**
 * What a person is told when this policy decides against them.
 *
 * The policy's name and its five verdicts are internal vocabulary, and canon
 * `§0.5` keeps internal vocabulary off customer surfaces. `The owner-canary
 * policy returned BLOCK.` shipped to production and was read there on
 * 2026-09-04: it names a mechanism the reader does not have, gives no remedy,
 * and invites them to go looking for a control that is not theirs. The verdict
 * word alone tells them none of the three things they actually need — that
 * their money is untouched, that the limit is Ryntra's own rather than
 * something they did, and whether waiting will help.
 *
 * The decision is unchanged. Only the sentence is.
 */
export function solanaCanaryRefusalSentence(decision: SolanaCanaryDecision): string {
  if (decision === "BLOCK")
    return "This route has reached a limit Ryntra keeps on its own transfers. Nothing has been sent and your funds are untouched.";
  if (decision === "PAUSE")
    return "Transfers on this route are paused right now. Nothing has been sent and your funds are untouched.";
  if (decision === "UNKNOWN")
    return "This transfer could not be checked against Ryntra's own limits just now, so it was not offered to your wallet.";
  if (decision === "REVIEW") return "This transfer needs one more check before it can be offered to your wallet.";
  return "This transfer is within Ryntra's own limits.";
}

export function evaluateSolanaCanaryIntent(args: {
  policy: SolanaCanaryPolicy;
  budget: SolanaCanaryBudgetSnapshot;
  intent: SolanaCanaryIntent;
  now?: Date;
}): SolanaCanaryVerdict {
  const policy = SolanaCanaryPolicySchema.parse(args.policy);
  const budget = SolanaCanaryBudgetSnapshotSchema.parse(args.budget);
  const intent = SolanaCanaryIntentSchema.parse(args.intent);
  const now = args.now ?? new Date();
  const family = policy.families[intent.family];

  /* A fallback is never configured, whatever its own snapshot agrees with. */
  const usingFallback = policy.policyId === SOLANA_CANARY_FALLBACK_POLICY_ID;
  const configured =
    !usingFallback &&
    budget.policyId === policy.policyId &&
    budget.totalLimitUsdMicros === policy.totalLimitUsdMicros;
  const stateOpen = policy.state === "OPEN";
  const destinationAllowed = family.allowedDestinations.map(foldEvm).includes(foldEvm(intent.destination));
  const mintsAllowed = includesEvery(family.allowedMints, intent.mints);
  const programsAllowed = includesEvery(family.allowedPrograms, intent.programs);

  const observedAt = intent.valuation ? Date.parse(intent.valuation.observedAt) : Number.NaN;
  const validUntil = intent.valuation ? Date.parse(intent.valuation.validUntil) : Number.NaN;
  const nowMs = now.getTime();
  const valuationCurrent =
    intent.usdMicros !== null &&
    intent.valuation !== null &&
    Number.isFinite(nowMs) &&
    Number.isFinite(observedAt) &&
    Number.isFinite(validUntil) &&
    nowMs >= observedAt &&
    nowMs < validUntil &&
    nowMs - observedAt <= policy.valuationMaxAgeSeconds * 1_000;

  const budgetAvailable =
    budget.readState === "AVAILABLE" &&
    budget.storeBoundary !== "UNAVAILABLE" &&
    configured;
  const principal = intent.principalUsdMicros === null ? null : BigInt(intent.principalUsdMicros);
  const value = intent.usdMicros === null ? null : BigInt(intent.usdMicros);
  const currentFamily = budget.families[intent.family];
  const familyExposure = BigInt(currentFamily.reservedUsdMicros) + BigInt(currentFamily.spentUsdMicros);
  const totalExposure = BigInt(budget.reservedUsdMicros) + BigInt(budget.spentUsdMicros);
  const familyMaximum = BigInt(family.maximumUsdMicros);
  const familyMinimum = BigInt(family.minimumUsdMicros);
  const totalMaximum = BigInt(policy.totalLimitUsdMicros);

  let familyOutcome: Finding["outcome"] = "UNKNOWN";
  let familyDetail = "The action value is not available for the family limit check.";
  if (principal !== null && budgetAvailable) {
    if (familyExposure + principal > familyMaximum) {
      familyOutcome = "BLOCK";
      familyDetail = "The action would exceed this canary family's configured maximum.";
    } else if (principal < familyMinimum) {
      familyOutcome = "REVIEW";
      familyDetail = "The action is below the evidence-producing floor for this canary family.";
    } else {
      familyOutcome = "PASS";
      familyDetail = "The action remains within this canary family's configured range.";
    }
  }

  let totalOutcome: Finding["outcome"] = "UNKNOWN";
  let totalDetail = "The durable package exposure is unavailable.";
  if (value !== null && budgetAvailable) {
    if (totalExposure + value > totalMaximum) {
      totalOutcome = "BLOCK";
      totalDetail = "The action would exceed the owner-canary package ceiling.";
    } else {
      totalOutcome = "PASS";
      totalDetail = "The action remains inside the owner-canary package ceiling.";
    }
  }

  const findings: Finding[] = [
    finding(
      "CONFIG_VALID",
      configured ? "PASS" : "UNKNOWN",
      configured
        ? "Policy and budget snapshot identify the same immutable package ceiling."
        : usingFallback
          ? "Runtime owner-canary policy could not be read. A deterministic closed fallback was used. Customer execution is unaffected; owner canaries are disabled."
          : "Policy and durable budget state do not identify the same package.",
    ),
    finding(
      "EMERGENCY_STOP",
      stateOpen ? "PASS" : "PAUSE",
      stateOpen
        ? "The operator emergency stop permits evaluation of new risk."
        : "The operator emergency stop pauses every new value-moving Solana action.",
    ),
    finding("MAINNET_ONLY", "PASS", "The canary intent is pinned to Solana mainnet."),
    finding(
      "DESTINATION_ALLOWLISTED",
      destinationAllowed ? "PASS" : "BLOCK",
      destinationAllowed
        ? "The exact destination is on this action family's owner allowlist."
        : "The exact destination is not on this action family's owner allowlist.",
    ),
    finding(
      "MINTS_ALLOWLISTED",
      mintsAllowed ? "PASS" : "BLOCK",
      mintsAllowed
        ? "Every mint is on this action family's owner allowlist."
        : "At least one mint is not on this action family's owner allowlist.",
    ),
    finding(
      "PROGRAMS_ALLOWLISTED",
      programsAllowed ? "PASS" : "BLOCK",
      programsAllowed
        ? "Every invoked program is on this action family's owner allowlist."
        : "At least one invoked program is not on this action family's owner allowlist.",
    ),
    finding(
      "VALUATION_CURRENT",
      valuationCurrent ? "PASS" : "UNKNOWN",
      valuationCurrent
        ? "The exact USD-micro exposure has current source and expiry evidence."
        : "The exact USD-micro exposure is missing, stale, expired or from the future.",
    ),
    finding("FAMILY_LIMIT", familyOutcome, familyDetail),
    finding("TOTAL_LIMIT", totalOutcome, totalDetail),
    finding(
      "HUMAN_APPROVAL",
      !family.requireHumanApproval || intent.humanApproval === "RECORDED" ? "PASS" : "REVIEW",
      !family.requireHumanApproval || intent.humanApproval === "RECORDED"
        ? "The required human approval state is recorded for this review."
        : "This canary family requires an explicit human approval record before reservation.",
    ),
  ];
  const decision = highestDecision(findings);
  const outside = findings.some(
    (entry) =>
      (SOLANA_CANARY_MEMBERSHIP_RULES as readonly string[]).includes(entry.rule) &&
      entry.outcome !== "PASS",
  );
  const scope = outside
    ? {
        status: "OUTSIDE_ENVELOPE" as const,
        decidedBy: "TRANSFER_CAPABILITY" as const,
        detail:
          "This action is outside the envelope the owner canary reserves for: its destination, mint, programs or recorded approval are not the ones this policy was configured with. The verdict is carried as evidence and is not the gate. An ordinary user-signed transfer is decided by the transfer-capability classifier over fresh chain facts, the deployment stop, simulation of the exact bytes and the owner's own wallet confirmation.",
      }
    : {
        status: "INSIDE_ENVELOPE" as const,
        decidedBy: "OWNER_CANARY" as const,
        detail: "This action is inside the envelope the owner canary reserves for, and this verdict decides it.",
      };

  return SolanaCanaryVerdictSchema.parse({
    schema: "ryntra.solana.canary-verdict",
    schemaVersion: "1.0.0",
    decision,
    newRiskAllowed: decision === "ALLOW",
    scope,
    policyId: policy.policyId,
    policyDigest: solanaCanaryPolicyDigest(policy),
    intentDigest: solanaCanaryIntentDigest(intent),
    budgetObservedAt: budget.observedAt,
    findings,
    evaluatedAt: now.toISOString(),
  });
}
