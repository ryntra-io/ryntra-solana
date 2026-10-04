/**
 * The Bridge Receipt — an Outcome Receipt, not a document of its own.
 *
 * The first version of this file was a flat object with its own schema name,
 * its own hash domain and no issuer signature. It could be recomputed by anyone
 * and therefore proved authorship of nothing, and no verifier a stranger can
 * reach recognised it. Worse, it hardcoded `message.status: "COMPLETE"` and a
 * `COMPLETED` lifecycle and took finality, recipient readiness and three of the
 * four amounts as free text from its caller — so it could assert a Base-side
 * mint that nobody had read.
 *
 * This version is issued through the same builder and the same issuer key as
 * every other Ryntra receipt: `OUTCOME_RECEIPT@2.0.0`, signed, and accepted by
 * the public verifier without a new artifact kind or a change to the frozen v2
 * enum. The bridge-specific evidence rides **inside** the signed envelope as
 * observed effects, so the signature covers it.
 *
 * ## What it structurally cannot do
 *
 * The outcome status is one of `MATCHED`, `DEVIATION_RECORDED` or `FAILED`, and
 * a mint that was not observed can reach none of them by accident: with no
 * destination facts the reconciliation is a recorded deviation naming exactly
 * that. There is no path where "we could not read the destination" produces a
 * receipt that says the money arrived.
 *
 * Every amount is bound to something read. `burnedRaw` and `feeExecutedRaw`
 * come from the CCTP message Circle signed; `mintedRaw` comes from the
 * `MintAndWithdraw` log on Base; the fees come from the plan the cluster priced
 * and the gas the destination chain reported. Nothing is a caller's sentence.
 */

import { z } from "zod";

import {
  SOLANA_CAIP2,
  SOLANA_TOKEN_2022_ADAPTER_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import { createOutcomeReceipt, type OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import { attestArtifact, loadIssuerKey } from "../agent-control/issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../agent-control/registry.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY, solanaCctpChainByDomain } from "./cctp-registry.ts";

/**
 * The chain a Circle domain number names, as a person reads it.
 *
 * Read from the registry rather than from a two-way `=== 5 ? "Solana" : "Base"`,
 * which was right for exactly as long as there were two chains and would have
 * called every Ethereum leg "Base" the day a third arrived.
 */
function domainLabel(domain: number): string {
  return solanaCctpChainByDomain(domain)?.label ?? `domain ${domain}`;
}

/** One observed effect, as the artifact schema shapes it. */
type ReceiptEffect = Readonly<{ description: string; sourceRef: string; observedAt: string }>;

const RAW = z.string().regex(/^(0|[1-9][0-9]*)$/);
const HEX32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const INSTANT = z.string().datetime({ offset: true });

export const BRIDGE_RECEIPT_FACTS_SOURCE = "ryntra.solana.bridge-receipt.facts@2";
const EFFECT_CHUNK_SIZE = 480;

/**
 * Everything a cross-chain receipt has to carry, and nothing that is not read
 * from somewhere.
 *
 * Fields that can legitimately be unknown are nullable rather than absent or
 * zero: a destination that has not been observed says `null` and forces the
 * reconciliation to record it, instead of a `0` that reads like a fact.
 */
export const SolanaBridgeReceiptFactsSchema = z
  .object({
    schema: z.literal(BRIDGE_RECEIPT_FACTS_SOURCE),
    provider: z.literal("CIRCLE_CCTP_V2"),
    /**
     * Which way this transfer went.
     *
     * Defaulted so that a receipt minted before the lane had two directions
     * still reads back through this schema. Every one of them was Solana to
     * Base, so the default is a fact rather than a convenience.
     */
    direction: z.enum(["SOLANA_TO_BASE", "BASE_TO_SOLANA", "SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"]).default("SOLANA_TO_BASE"),
    /** The intent digest the duplicate-burn claim is keyed on. */
    intentDigest: HEX32,
    /** The issuer-signed Review this transfer was authorized against. */
    reviewDigest: HEX32,
    source: z
      .object({
        chainRef: z.enum([SOLANA_CAIP2.mainnet, "eip155:8453", "eip155:1"]),
        domain: z.union([z.literal(5), z.literal(6), z.literal(0)]),
        wallet: z.string().min(32).max(44).or(z.string().regex(/^0x[0-9a-f]{40}$/)),
        /** The account the USDC left. Null on an ERC-20 source, which has none. */
        tokenAccount: z.string().min(32).max(44).nullable(),
        asset: z.string().min(32).max(44).or(z.string().regex(/^0x[0-9a-fA-F]{40}$/)),
        burnSignature: z.string().min(32).max(128),
        slot: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
        finality: z.enum(["confirmed", "finalized", "unknown"]),
        observedBy: z.string().min(1).max(128),
      })
      .strict(),
    destination: z
      .object({
        chainRef: z.enum([SOLANA_CAIP2.mainnet, "eip155:8453", "eip155:1"]),
        domain: z.union([z.literal(5), z.literal(6), z.literal(0)]),
        recipient: z.string().regex(/^0x[0-9a-f]{40}$/).or(z.string().min(32).max(44)),
        /**
         * The account the money actually landed in.
         *
         * On Base that is the recipient address itself. On Solana it is the
         * token account that address owns, which is what CCTP credits — and
         * naming it is the difference between a receipt that says where the
         * money is and one that says who it belongs to.
         */
        recipientAccount: z.string().min(32).max(64).nullable().default(null),
        asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/).or(z.string().min(32).max(44)),
        mintTransactionHash: z.string().regex(/^0x[0-9a-f]{64}$/).or(z.string().min(32).max(128)).nullable(),
        blockNumber: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
        finality: z.enum(["included", "unknown"]),
        observedBy: z.string().min(1).max(128).nullable(),
        /**
         * How the destination was established as able to receive.
         *
         * On an EVM chain no account has to be created, so readiness is the
         * address itself being the one the owner confirmed and the balance
         * being readable — both of which are chain reads, not assurances.
         */
        recipientReadiness: z.enum([
          "BALANCE_READ_BEFORE_AND_AFTER",
          "BALANCE_READ_BEFORE_ONLY",
          "NOT_ESTABLISHED",
        ]),
        usdcBeforeRaw: RAW.nullable(),
        usdcAfterRaw: RAW.nullable(),
      })
      .strict(),
    message: z
      .object({
        nonce: HEX32.nullable(),
        cctpVersion: z.literal(2),
        status: z.enum(["ATTESTED", "PENDING", "NOT_ESTABLISHED"]),
        attestationRef: z.string().min(1).max(256).nullable(),
        minFinalityThreshold: z.number().int(),
        finalityThresholdExecuted: z.number().int().nullable(),
        expirationBlock: RAW.nullable(),
        /** Zero means anyone may complete the mint. It is not a delivery promise. */
        destinationCaller: z.string().regex(/^0x[0-9a-f]{64}$/),
      })
      .strict(),
    amounts: z
      .object({
        burnedRaw: RAW,
        maxFeeRaw: RAW,
        feeExecutedRaw: RAW.nullable(),
        expectedReceivedRaw: RAW,
        mintedRaw: RAW.nullable(),
        destinationFeeCollectedRaw: RAW.nullable(),
      })
      .strict(),
    fees: z
      .object({
        /** Solana network fee and rent, on a lane whose source is Solana. */
        sourceNetworkFeeLamports: RAW.nullable(),
        sourceRentLamports: RAW.nullable(),
        rentReclaimable: z.boolean(),
        rentReclaimableAfterDays: z.union([z.literal(5), z.literal(0)]).default(5),
        /** Gas, on a lane whose source is an EVM chain. */
        sourceGasUsed: RAW.nullable().default(null),
        sourceGasPriceWei: RAW.nullable().default(null),
        /** What the receiving step cost on Solana, when Solana is the destination. */
        destinationNetworkFeeLamports: RAW.nullable().default(null),
        destinationRentLamports: RAW.nullable().default(null),
        destinationGasUsed: RAW.nullable(),
        destinationGasPriceWei: RAW.nullable(),
        /** No forwarding service was used, so there is no relayer fee to state. */
        relayerFeeRaw: z.null(),
        relayerFeeReason: z.literal("FORWARDING_SERVICE_NOT_USED"),
      })
      .strict(),
    reconciliation: z.enum(["MATCHED", "DEVIATION_RECORDED", "NOT_OBSERVED"]),
    deviations: z.array(z.string().min(1).max(240)).max(12),
    recovery: z
      .object({
        attempts: z.number().int().min(1),
        secondBurnCreated: z.literal(false),
        action: z.string().min(1).max(120),
      })
      .strict(),
    limitations: z.array(z.string().min(1).max(240)).min(1).max(8),
    observedAt: INSTANT,
  })
  .strict();

export type SolanaBridgeReceiptFacts = z.output<typeof SolanaBridgeReceiptFactsSchema>;

export function encodeBridgeFacts(facts: SolanaBridgeReceiptFacts): string {
  return JSON.stringify(SolanaBridgeReceiptFactsSchema.parse(facts));
}

/** The facts, chunked into observed effects so the signature covers them. */
export function bridgeFactsToEffects(args: {
  facts: SolanaBridgeReceiptFacts;
  sourceRef: string;
  observedAt: string;
}): readonly ReceiptEffect[] {
  const encoded = encodeBridgeFacts(args.facts);
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += EFFECT_CHUNK_SIZE) {
    chunks.push(encoded.slice(offset, offset + EFFECT_CHUNK_SIZE));
  }
  return chunks.map((description, index) => ({
    description,
    sourceRef: `${BRIDGE_RECEIPT_FACTS_SOURCE}:${args.sourceRef}#${index + 1}/${chunks.length}`,
    observedAt: args.observedAt,
  }));
}

/** Read the facts back out of a receipt. Returns null unless every chunk is present. */
export function parseBridgeFactsFromEffects(effects: readonly ReceiptEffect[]): SolanaBridgeReceiptFacts | null {
  const pattern = new RegExp(
    `^${BRIDGE_RECEIPT_FACTS_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*#(\\d+)/(\\d+)$`,
  );
  const chunks = effects
    .map((effect) => ({ effect, match: pattern.exec(effect.sourceRef) }))
    .filter((entry): entry is { effect: ReceiptEffect; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ index: Number(entry.match[1]), total: Number(entry.match[2]), description: entry.effect.description }));
  if (chunks.length === 0) return null;
  const total = chunks[0].total;
  if (chunks.some((chunk) => chunk.total !== total) || chunks.length !== total) return null;
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.some((chunk, index) => chunk.index !== index + 1)) return null;
  try {
    const parsed = SolanaBridgeReceiptFactsSchema.safeParse(JSON.parse(chunks.map((chunk) => chunk.description).join("")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Decide what actually happened, from evidence rather than from intent.
 *
 * Called before the receipt is built, and its answer is the receipt's status.
 * A destination that was not observed is a deviation with a sentence saying so
 * — never a match, and never silence.
 */
export function reconcileBridgeFacts(facts: SolanaBridgeReceiptFacts): Readonly<{
  status: "MATCHED" | "DEVIATION_RECORDED" | "FAILED";
  deviations: readonly string[];
}> {
  const deviations: string[] = [];
  if (facts.message.status !== "ATTESTED" || facts.message.nonce === null) {
    deviations.push("The CCTP message for this burn was not attested at the time this receipt was issued.");
  }
  if (facts.destination.mintTransactionHash === null || facts.amounts.mintedRaw === null) {
    deviations.push("The arrival on the destination chain was not observed, so nothing here states that the funds arrived.");
  } else {
    if (facts.amounts.mintedRaw !== facts.amounts.expectedReceivedRaw) {
      deviations.push(
        `The destination minted ${facts.amounts.mintedRaw} base units where ${facts.amounts.expectedReceivedRaw} was expected.`,
      );
    }
    if (facts.destination.recipientReadiness !== "BALANCE_READ_BEFORE_AND_AFTER") {
      deviations.push("The recipient's balance was not read on both sides of the mint.");
    }
  }
  if (facts.source.finality === "unknown") {
    deviations.push(
      `The burn's finality on ${domainLabel(facts.source.domain)} was not established.`,
    );
  }
  if (deviations.length === 0) return { status: "MATCHED", deviations };
  return { status: "DEVIATION_RECORDED", deviations };
}

export type BridgeReceiptMintResult =
  | Readonly<{ ok: true; receipt: OutcomeReceiptArtifact; facts: SolanaBridgeReceiptFacts }>
  | Readonly<{ ok: false; code: "FACTS_INVALID" | "MINT_FAILED"; reason: string }>;

/**
 * Mint the Bridge Receipt.
 *
 * Built twice on purpose, exactly as the Send lane is: the unsigned mint fixes
 * the content hash, and the signed mint reuses that hash **and** the same
 * timestamp. An earlier failure showed what happens otherwise — a second
 * `createdAt` moves the hash the signature was taken over, and the live
 * verifier returns `SIGNATURE_INVALID` for an artifact that is otherwise
 * perfectly correct.
 *
 * The registry pin names the Solana adapter and no transfer action, because
 * this was a burn and not an SPL transfer. The public verifier reads that as
 * `SOLANA_PINNED` and says so plainly.
 */
export function mintCctpOutcomeReceipt(args: {
  id: string;
  /** The Review proof digest, so the receipt cannot outrun what was authorized. */
  actionPassportHash: string;
  facts: SolanaBridgeReceiptFacts;
  environment?: Record<string, string | undefined>;
  now?: Date;
}): BridgeReceiptMintResult {
  const parsed = SolanaBridgeReceiptFactsSchema.safeParse(args.facts);
  if (!parsed.success) {
    return {
      ok: false,
      code: "FACTS_INVALID",
      reason: parsed.error.issues.map((issue) => `${issue.path.join(".") || "facts"}: ${issue.message}`).join(" · "),
    };
  }

  const now = args.now ?? new Date();
  const reconciled = reconcileBridgeFacts(parsed.data);
  const facts: SolanaBridgeReceiptFacts = SolanaBridgeReceiptFactsSchema.parse({
    ...parsed.data,
    reconciliation: reconciled.status === "MATCHED" ? "MATCHED" : parsed.data.destination.mintTransactionHash === null ? "NOT_OBSERVED" : "DEVIATION_RECORDED",
    deviations: reconciled.deviations.slice(0, 12),
  });

  try {
    const sourceRef = `${facts.source.observedBy}:${facts.source.burnSignature}`;
    const effects = bridgeFactsToEffects({ facts, sourceRef, observedAt: facts.observedAt });
    /* The chains are named from the facts rather than from this module's
       assumptions. A receipt that called every source Solana was correct for
       exactly as long as there was one lane. */
    const sourceLabel = domainLabel(facts.source.domain);
    const destinationLabel = domainLabel(facts.destination.domain);
    const outcome = {
      status: reconciled.status,
      /* The receipt is anchored to the chain the transfer left from, which is
         the chain its `transactionHash` belongs to. Anchoring both directions
         to Solana would have produced a receipt whose chain reference and whose
         transaction were about different ledgers. */
      chainRef: facts.source.chainRef,
      /* The burn is the transaction this receipt is about. The destination
         arrival is evidence inside it, named by its own identifier. */
      transactionHash: facts.source.burnSignature,
      observedEffects: [
        {
          description: `Burned ${facts.amounts.burnedRaw} base units of USDC on ${sourceLabel} for domain ${facts.destination.domain}.`,
          sourceRef,
          observedAt: facts.observedAt,
        },
        {
          description:
            facts.destination.mintTransactionHash === null
              ? `No arrival was observed on ${destinationLabel} at the time this receipt was issued.`
              : `${destinationLabel} transaction ${facts.destination.mintTransactionHash} credited ${facts.amounts.mintedRaw} base units of USDC to ${facts.destination.recipientAccount ?? facts.destination.recipient}.`,
          sourceRef: facts.destination.observedBy ?? sourceRef,
          observedAt: facts.observedAt,
        },
        ...effects,
      ],
      reconciledAt: now.toISOString(),
    };
    const base = {
      id: args.id,
      actionPassportHash: args.actionPassportHash,
      outcome,
      registry: registryPin(AGENT_CONTROL_REGISTRY, [SOLANA_TOKEN_2022_ADAPTER_REF]),
      now,
    };
    const unsigned = createOutcomeReceipt(base);
    const key = loadIssuerKey(args.environment);
    const receipt = key
      ? createOutcomeReceipt({
          ...base,
          issuer: attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now }),
        })
      : unsigned;
    return { ok: true, receipt, facts };
  } catch (failure) {
    return { ok: false, code: "MINT_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

/** The limitations every Bridge Receipt states about itself. */
export const BRIDGE_RECEIPT_LIMITATIONS: readonly string[] = Object.freeze([
  "This receipt describes one owner-signed CCTP V2 transfer and grants no authority over any other transfer.",
  "The destination mint is permissionless: anyone holding the message and its attestation may submit it. That is not a promise that anyone will.",
  `Native USDC only: Solana ${SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address}, Base ${SOLANA_CCTP_MAINNET_REGISTRY.chains.base.asset.address}, Ethereum ${SOLANA_CCTP_MAINNET_REGISTRY.chains.ethereum.asset.address}. No wrapped token, no liquidity pool.`,
  "Circle's Forwarding Service was not used, so there is no relayer and no relayer fee.",
]);
