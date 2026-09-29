/**
 * Canon §16.4 Send Receipt facts — structured, not a paragraph.
 *
 * The signed envelope remains the Outcome Receipt the existing verifier
 * already knows. These facts are one observedEffect whose description is the
 * canonical JSON of this schema (capped at 512 characters by the envelope, so
 * the compact form lives here) plus the human sentences the reconciler
 * already compares. `parseSendReceiptFacts` round-trips them back.
 */

import { z } from "zod";

import { ASSOCIATED_TOKEN_PROGRAM_ID } from "./canary-policy.ts";
import { SEND_ACTION_KINDS } from "./send-kinds.ts";
import type { SplTransferPreflight } from "./contracts.ts";
import type { TransferObservation } from "./observe.ts";
import type { TransferPlan } from "./transaction.ts";

const RAW = /^(0|[1-9]\d*)$/;
const RAW_DELTA = /^-?(0|[1-9]\d*)$/;
const HEX_HASH = /^0x[0-9a-f]{64}$/;
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

export const SEND_RECEIPT_FACTS_SOURCE = "ryntra.solana.send-receipt.facts@1";

const SendReceiptFactsBaseSchema = z
  .object({
    schema: z.literal("ryntra.solana.send-receipt"),
    actionKind: z.enum(SEND_ACTION_KINDS),
    network: z.enum(["mainnet", "devnet"]),
    mint: z.string().min(1),
    sender: z.string().min(32).max(44),
    recipient: z.string().min(32).max(44),
    expectedDebitRaw: z.string().regex(RAW_DELTA),
    expectedCreditRaw: z.string().regex(RAW),
    actualDebitRaw: z.string().regex(RAW_DELTA).nullable(),
    actualCreditRaw: z.string().regex(RAW).nullable(),
    transferFeeRaw: z.string().regex(RAW),
    baseFeeLamports: z.string().regex(RAW).nullable(),
    priorityFeeLamports: z.string().regex(RAW).nullable(),
    ataRentLamports: z.string().regex(RAW).nullable(),
    programs: z.array(z.string().min(1)).min(1).max(8),
    signature: z.string().min(64).max(88),
    slot: z.string().regex(RAW),
    finality: z.enum(["processed", "confirmed", "finalized", "unknown"]),
    reconciliation: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED"]),
  })
  .strict();

/** Historical fact shapes remain parseable; issuance always writes v1.2. */
const LegacySolanaSendReceiptFactsSchema = SendReceiptFactsBaseSchema.extend({
  schemaVersion: z.literal("1.0.0"),
}).strict();

export const SendReviewDigestSchema = z
  .string()
  .regex(HEX_HASH)
  .refine((digest) => /[1-9a-f]/.test(digest.slice(2)), "Receipt issuance requires a nonzero Review digest.");

export const SendReceiptAugmentationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("NONE"),
      summary: z.literal("The signed message matched the reviewed plan without wallet augmentation."),
    })
    .strict(),
  z
    .object({
      status: z.literal("PRESENT"),
      summary: z.string().min(1).max(512),
      /** The observed portion of the total transaction fee, never a plan copy. */
      actualPriorityFeeLamports: z.string().regex(RAW),
    })
    .strict(),
]);

export type SendReceiptAugmentation = z.output<typeof SendReceiptAugmentationSchema>;

export const NO_SEND_RECEIPT_AUGMENTATION: SendReceiptAugmentation = Object.freeze({
  status: "NONE",
  summary: "The signed message matched the reviewed plan without wallet augmentation.",
});

const V11SolanaSendReceiptFactsSchema = SendReceiptFactsBaseSchema.extend({
  schemaVersion: z.literal("1.1.0"),
  /** Digest from the exact issuer-reviewed plan + preflight + policy bundle. */
  reviewDigest: SendReviewDigestSchema,
  augmentation: SendReceiptAugmentationSchema,
  plannedAta: z
    .object({
      createsRecipientAccount: z.boolean(),
      rentLamports: z.string().regex(RAW).nullable(),
    })
    .strict(),
  observedAta: z
    .object({
      created: z.boolean(),
      rentLamports: z.string().regex(RAW).nullable(),
    })
    .strict(),
  plannedBaseFeeLamports: z.string().regex(RAW),
  actualBaseFeeLamports: z.string().regex(RAW),
  plannedPriorityFeeLamports: z.string().regex(RAW),
  actualPriorityFeeLamports: z.string().regex(RAW),
}).strict();

const ObservedAtaV12Schema = z
  .object({
    created: z.boolean(),
    rentLamports: z.string().regex(RAW).nullable(),
    owner: z.string().min(32).max(44).nullable(),
    tokenProgram: z.string().min(32).max(44).nullable(),
    rentPayer: z.string().min(32).max(44).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.created) return;
    for (const field of ["rentLamports", "owner", "tokenProgram", "rentPayer"] as const) {
      if (value[field] === null) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `A created ATA requires an independently observed ${field}.`,
        });
      }
    }
  });

const CurrentSolanaSendReceiptFactsSchema = SendReceiptFactsBaseSchema.extend({
  schemaVersion: z.literal("1.2.0"),
  reviewDigest: SendReviewDigestSchema,
  augmentation: SendReceiptAugmentationSchema,
  plannedAta: z
    .object({
      createsRecipientAccount: z.boolean(),
      rentLamports: z.string().regex(RAW).nullable(),
    })
    .strict(),
  observedAta: ObservedAtaV12Schema,
  observedPrograms: z.array(z.string().min(32).max(44)).max(16),
  plannedBaseFeeLamports: z.string().regex(RAW),
  actualBaseFeeLamports: z.string().regex(RAW),
  plannedPriorityFeeLamports: z.string().regex(RAW),
  actualPriorityFeeLamports: z.string().regex(RAW),
})
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.observedPrograms).size !== value.observedPrograms.length) {
      context.addIssue({
        code: "custom",
        path: ["observedPrograms"],
        message: "Observed programs must be unique.",
      });
    }
    if (!value.observedAta.created) return;
    if (!value.observedPrograms.includes(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      context.addIssue({
        code: "custom",
        path: ["observedPrograms"],
        message: "A created ATA requires the independently observed Associated Token Program.",
      });
    }
    if (
      value.observedAta.tokenProgram !== null &&
      !value.observedPrograms.includes(value.observedAta.tokenProgram)
    ) {
      context.addIssue({
        code: "custom",
        path: ["observedPrograms"],
        message: "A created ATA requires its independently observed token program.",
      });
    }
  });

export const SolanaSendReceiptFactsSchema = z.discriminatedUnion("schemaVersion", [
  LegacySolanaSendReceiptFactsSchema,
  V11SolanaSendReceiptFactsSchema,
  CurrentSolanaSendReceiptFactsSchema,
]);

/** Facts minted by this code path; the union above also parses pre-M0C receipts. */
export type SolanaSendReceiptFacts = z.output<typeof CurrentSolanaSendReceiptFactsSchema>;
export type ParsedSolanaSendReceiptFacts = z.output<typeof SolanaSendReceiptFactsSchema>;

type ActualFees = Readonly<{
  baseFeeLamports: string;
  priorityFeeLamports: string;
}>;

type AtaFacts = Readonly<{
  createsRecipientAccount: boolean;
  rentLamports: string | null;
}>;

type ObservedAtaFacts = Readonly<{
  created: boolean;
  rentLamports: string | null;
  owner: string | null;
  tokenProgram: string | null;
  rentPayer: string | null;
}>;

function actualFeesFrom(args: {
  observed: TransferObservation;
  augmentation: SendReceiptAugmentation;
}): ActualFees {
  const priorityFeeLamports =
    args.augmentation.status === "PRESENT" ? args.augmentation.actualPriorityFeeLamports : "0";
  const totalFee = BigInt(args.observed.observation.feeLamports);
  const priorityFee = BigInt(priorityFeeLamports);
  if (priorityFee > totalFee) {
    throw new Error("Observed priority fee exceeds the transaction fee reported by the chain.");
  }
  return {
    baseFeeLamports: (totalFee - priorityFee).toString(),
    priorityFeeLamports,
  };
}

function plannedAtaFrom(plan: TransferPlan): AtaFacts {
  return {
    createsRecipientAccount: plan.actionKind === "NATIVE_SOL" ? false : plan.createsRecipientAccount,
    rentLamports: plan.actionKind === "NATIVE_SOL" ? null : plan.ataRentLamports,
  };
}

function observedAtaFrom(args: { plan: TransferPlan; observed: TransferObservation }): ObservedAtaFacts {
  if (args.plan.actionKind === "NATIVE_SOL") {
    return {
      created: false,
      rentLamports: null,
      owner: null,
      tokenProgram: null,
      rentPayer: null,
    };
  }
  const delta = args.observed.observation.lamportBalanceDeltas.find(
    (entry) => entry.account === args.plan.recipientTokenAccount && BigInt(entry.rawDelta) > 0n,
  );
  const tokenAccount = args.observed.postTokenAccounts.find(
    (entry) =>
      entry.account === args.plan.recipientTokenAccount &&
      entry.mint === args.plan.mint,
  );
  const senderLamports = args.observed.observation.lamportBalanceDeltas.find(
    (entry) => entry.account === args.plan.sender,
  );
  const rent = delta ? BigInt(delta.rawDelta) : null;
  const senderPaid =
    rent !== null &&
    senderLamports !== undefined &&
    BigInt(senderLamports.rawDelta) < 0n &&
    -BigInt(senderLamports.rawDelta) >= rent + BigInt(args.observed.observation.feeLamports);
  const owner = tokenAccount?.owner ?? null;
  const tokenProgram = tokenAccount?.tokenProgram ?? null;
  const programs = args.observed.invokedPrograms;
  const created =
    rent !== null &&
    owner === args.plan.recipient &&
    tokenProgram === args.plan.tokenProgram &&
    programs.includes(ASSOCIATED_TOKEN_PROGRAM_ID) &&
    programs.includes(args.plan.tokenProgram) &&
    senderPaid;
  return {
    created,
    rentLamports: delta?.rawDelta ?? null,
    owner,
    tokenProgram,
    rentPayer: senderPaid ? args.plan.sender : null,
  };
}

export function sendFactsFrom(args: {
  plan: TransferPlan;
  preflight: SplTransferPreflight;
  observed: TransferObservation;
  finality: SolanaSendReceiptFacts["finality"];
  reconciliation: SolanaSendReceiptFacts["reconciliation"];
  reviewDigest: string;
  augmentation?: SendReceiptAugmentation;
}): SolanaSendReceiptFacts {
  const { plan, preflight, observed } = args;
  const augmentation = args.augmentation ?? NO_SEND_RECEIPT_AUGMENTATION;
  const actualFees = actualFeesFrom({ observed, augmentation });
  const plannedAta = plannedAtaFrom(plan);
  const observedAta = observedAtaFrom({ plan, observed });
  const tokenDebit = observed.observation.balanceDeltas.find(
    (delta) => delta.account === plan.senderTokenAccount && delta.mint === plan.mint,
  );
  const tokenCredit = observed.observation.balanceDeltas.find(
    (delta) => delta.account === plan.recipientTokenAccount && delta.mint === plan.mint,
  );
  const nativeDebit = observed.observation.lamportBalanceDeltas.find(
    (delta) => delta.account === plan.sender,
  );
  const nativeCredit = observed.observation.lamportBalanceDeltas.find(
    (delta) => delta.account === plan.recipient,
  );
  const normalizedNativeDebit = nativeDebit
    ? (BigInt(nativeDebit.rawDelta) + BigInt(observed.observation.feeLamports)).toString()
    : null;
  return CurrentSolanaSendReceiptFactsSchema.parse({
    schema: "ryntra.solana.send-receipt",
    schemaVersion: "1.2.0",
    reviewDigest: SendReviewDigestSchema.parse(args.reviewDigest),
    augmentation,
    actionKind: plan.actionKind,
    network: plan.network,
    mint: plan.mint,
    sender: plan.sender,
    recipient: plan.recipient,
    expectedDebitRaw: `-${plan.amountRaw}`,
    expectedCreditRaw: preflight.estimatedReceivedRaw,
    actualDebitRaw: plan.actionKind === "NATIVE_SOL" ? normalizedNativeDebit : tokenDebit?.rawDelta ?? null,
    actualCreditRaw: plan.actionKind === "NATIVE_SOL" ? nativeCredit?.rawDelta ?? null : tokenCredit?.rawDelta ?? null,
    transferFeeRaw: preflight.transferFee.feeRaw,
    /* Legacy mirrors remain for existing consumers; their planned/actual v1.1
       counterparts below prevent a review estimate from being read as chain truth. */
    baseFeeLamports: actualFees.baseFeeLamports,
    priorityFeeLamports: actualFees.priorityFeeLamports,
    ataRentLamports: observedAta.rentLamports,
    plannedAta,
    observedAta,
    observedPrograms: [...observed.invokedPrograms],
    plannedBaseFeeLamports: plan.baseFeeLamports,
    actualBaseFeeLamports: actualFees.baseFeeLamports,
    plannedPriorityFeeLamports: plan.priorityFeeLamports,
    actualPriorityFeeLamports: actualFees.priorityFeeLamports,
    programs: [...plan.programs],
    signature: observed.observation.signature,
    slot: observed.observation.slot,
    finality: args.finality,
    reconciliation: args.reconciliation,
  });
}

/**
 * Expected and observed non-transfer facts that must participate in the same
 * reconciliation as debit and credit. A successful token movement is not a
 * MATCHED Send when any actual fee or ATA rent differs from review.
 */
export function sendReceiptReconciliationEffects(args: {
  plan: TransferPlan;
  observed: TransferObservation;
  augmentation?: SendReceiptAugmentation;
}): Readonly<{ expected: readonly string[]; observed: readonly string[] }> {
  const augmentation = args.augmentation ?? NO_SEND_RECEIPT_AUGMENTATION;
  const actualFees = actualFeesFrom({ observed: args.observed, augmentation });
  const plannedAta = plannedAtaFrom(args.plan);
  const observedAta = observedAtaFrom({ plan: args.plan, observed: args.observed });
  const plannedAtaEvidence: ObservedAtaFacts = {
    created: plannedAta.createsRecipientAccount,
    rentLamports: plannedAta.rentLamports,
    /* The account's owner, which is the typed address only when a wallet was
       typed. Reading `recipient` here made a correct transfer into an existing
       token account reconcile as a deviation about an owner that was never
       wrong: the expectation carried the account, the chain reported the key. */
    owner: args.plan.actionKind === "NATIVE_SOL" ? null : args.plan.recipientOwner,
    tokenProgram: args.plan.actionKind === "NATIVE_SOL" ? null : args.plan.tokenProgram,
    rentPayer: plannedAta.createsRecipientAccount ? args.plan.sender : null,
  };
  const describeAta = (ata: ObservedAtaFacts) =>
    `Recipient ATA state: ${ata.created ? "created" : "not-created"}; rent: ${ata.rentLamports ?? "none"} lamports; owner: ${ata.owner ?? "unknown"}; token program: ${ata.tokenProgram ?? "unknown"}; rent payer: ${ata.rentPayer ?? "none"}.`;
  const describePrograms = (programs: readonly string[]) =>
    `Invoked programs: ${[...programs].sort().join(", ") || "none"}.`;
  const expectedPrograms = [...args.plan.programs];
  if (
    plannedAta.createsRecipientAccount &&
    args.plan.programs.includes(ASSOCIATED_TOKEN_PROGRAM_ID) &&
    !expectedPrograms.includes(SYSTEM_PROGRAM_ID)
  ) {
    expectedPrograms.push(SYSTEM_PROGRAM_ID);
  }

  return {
    expected: [
      `Base fee: ${args.plan.baseFeeLamports} lamports.`,
      `Priority fee: ${args.plan.priorityFeeLamports} lamports.`,
      describeAta(plannedAtaEvidence),
      describePrograms(expectedPrograms),
    ],
    observed: [
      `Base fee: ${actualFees.baseFeeLamports} lamports.`,
      `Priority fee: ${actualFees.priorityFeeLamports} lamports.`,
      describeAta(observedAta),
      describePrograms(args.observed.invokedPrograms),
    ],
  };
}

type ReceiptEffect = Readonly<{ description: string; sourceRef: string; observedAt: string }>;
const EFFECT_CHUNK_SIZE = 480;

/** Encode structured facts inside the signed Outcome Receipt envelope. */
export function sendReceiptFactsToEffects(args: {
  facts: SolanaSendReceiptFacts;
  sourceRef: string;
  observedAt: string;
}): readonly ReceiptEffect[] {
  const encoded = encodeSendFacts(args.facts);
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += EFFECT_CHUNK_SIZE) {
    chunks.push(encoded.slice(offset, offset + EFFECT_CHUNK_SIZE));
  }
  return chunks.map((description, index) => ({
    description,
    sourceRef: `${SEND_RECEIPT_FACTS_SOURCE}:${args.sourceRef}#${index + 1}/${chunks.length}`,
    observedAt: args.observedAt,
  }));
}

export function parseSendReceiptFactsFromEffects(
  effects: readonly ReceiptEffect[],
): ParsedSolanaSendReceiptFacts | null {
  const pattern = new RegExp(`^${SEND_RECEIPT_FACTS_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*#(\\d+)\/(\\d+)$`);
  const chunks = effects
    .map((effect) => ({ effect, match: pattern.exec(effect.sourceRef) }))
    .filter((entry): entry is { effect: ReceiptEffect; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({
      index: Number(entry.match[1]),
      total: Number(entry.match[2]),
      description: entry.effect.description,
    }));
  if (chunks.length === 0) return null;
  const total = chunks[0].total;
  if (chunks.some((chunk) => chunk.total !== total) || chunks.length !== total) return null;
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.some((chunk, index) => chunk.index !== index + 1)) return null;
  return parseSendReceiptFacts(chunks.map((chunk) => chunk.description).join(""));
}

export function encodeSendFacts(facts: SolanaSendReceiptFacts): string {
  return JSON.stringify(facts);
}

export function parseSendReceiptFacts(description: string): ParsedSolanaSendReceiptFacts | null {
  try {
    const parsed = JSON.parse(description) as unknown;
    const result = SolanaSendReceiptFactsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
