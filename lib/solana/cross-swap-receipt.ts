/**
 * The Cross-chain Receipt — the document the Bridge page did not have.
 *
 * `SEND`, `SWAP` and the CCTP `BRIDGE` lane each end in a signed
 * `OUTCOME_RECEIPT@2.0.0`. The cross-chain lane — the one the Bridge page
 * actually uses since `RYN-SWAP-BRIDGE-SPLIT-001` — ended in nothing. Two real
 * fills on 2026-09-11 made that concrete: both settled, both had their fee
 * collected, and both rows in Activity carried `receiptHash: null` beside a
 * same-chain swap from the same evening that carried one.
 *
 * ## Minted once, then kept
 *
 * A receipt is minted from durable state and **stored on the order**, and every
 * later read returns the stored document rather than building a new one. That
 * is not caching. `createdAt` and the issuer signature move with the clock, so a
 * second mint of identical facts is a different content hash — and the hash is
 * what the Activity row was written with. Re-minting would quietly break the
 * link between the row and the document it names.
 *
 * The consequence is the property the Owner asked for: a bridge made on a
 * laptop opens on a phone, because the document is on the order and not in a
 * browser.
 *
 * ## What it structurally cannot say
 *
 * The status is one of `MATCHED`, `DEVIATION_RECORDED` or `FAILED`, and an
 * operation nobody has read the end of can reach none of them: the route
 * refuses to mint anything that is still in motion. A completed order whose
 * destination transaction was never observed, or whose fill came in under the
 * minimum the person reviewed, is a recorded deviation naming exactly that —
 * never a match.
 *
 * Every amount is read: what was sent comes from the order the person signed,
 * what arrived and what the fee actually cost come from the provider's own
 * report of this fill. Nothing here is a caller's sentence.
 */

import { z } from "zod";

import { SOLANA_CAIP2, SOLANA_TOKEN_2022_ADAPTER_REF } from "../agent-control/adapters/solana-token-2022.ts";
import { BASE_EVM_ADAPTER_REF } from "../agent-control/adapters/base-evm.ts";
import { createOutcomeReceipt, type OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import { attestArtifact, loadIssuerKey } from "../agent-control/issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../agent-control/registry.ts";
import { SWAP_NETWORKS, SWAP_NETWORK_META, type SwapNetwork } from "../swap/catalog.ts";

/** One observed effect, as the artifact schema shapes it. */
type ReceiptEffect = Readonly<{ description: string; sourceRef: string; observedAt: string }>;

const RAW = z.string().regex(/^(0|[1-9][0-9]*)$/);
const HEX32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const INSTANT = z.string().datetime({ offset: true });
/** A source or destination transaction: an EVM hash or a Solana signature. */
const CHAIN_TX = z.union([z.string().regex(/^0x[0-9a-fA-F]{64}$/), z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/)]);

export const CROSS_SWAP_RECEIPT_FACTS_SOURCE = "ryntra.solana.cross-swap-receipt.facts@1";
const EFFECT_CHUNK_SIZE = 480;

/**
 * The canonical chain reference for a network this lane can carry.
 *
 * Solana's own is the genesis-hash CAIP-2 every other Ryntra receipt uses, not
 * the `solana:mainnet` shorthand the swap catalogue carries for its own
 * purposes. They are different strings, and a receipt written with the
 * shorthand would fail to resolve against the explorer map every other receipt
 * in this product resolves against.
 */
export function crossSwapChainRef(network: SwapNetwork): string {
  return network === "solana" ? SOLANA_CAIP2.mainnet : SWAP_NETWORK_META[network].chainRef;
}

const SideSchema = z
  .object({
    network: z.enum(SWAP_NETWORKS),
    chainRef: z.string().min(3).max(128),
    wallet: z.string().min(3).max(64),
    symbol: z.string().min(1).max(24),
    decimals: z.number().int().min(0).max(18),
    /** The transaction on this chain, when one is known. Null is never a zero. */
    txHash: CHAIN_TX.nullable(),
  })
  .strict();

/**
 * What Ryntra charged, and how much of that anybody actually read.
 *
 * Three states, not two, and the third one is why this shape changed. `reported`
 * says whether the provider was heard from at all; `collected` says what it
 * answered. Relay documents a silent case — an app fee quoted on an operation
 * whose shape cannot collect it — so "quoted" and "taken" are already two
 * different facts. A provider that could not be reached is a third, and the
 * first version of this schema collapsed it into "no fee was charged":
 * `mechanism: "NONE"` on an unreachable read, on a Relay order carrying 25 bps.
 * Caught by walking the route rather than by reading it.
 *
 * `mechanism` is therefore the order's own provider, always, because that is a
 * fact about the order and not about whether a later read succeeded.
 *
 * `basisPoints` is **measured, never assumed**: the rate is computed from what
 * was actually paid against what was actually sent, and is null when nothing
 * was read. The constant would have been wrong on any order quoted before the
 * rate changed, and a receipt is a document about one operation rather than
 * about the current price list.
 */
const FeeSchema = z
  .object({
    mechanism: z.enum(["RELAY_APP_FEE", "MAYAN_REFERRER"]),
    reported: z.boolean(),
    basisPoints: z.number().int().min(0).max(10_000).nullable(),
    collected: z.boolean(),
    quotedUsd: z.number().nullable(),
    paidUsd: z.number().nullable(),
    paidAmountRaw: RAW.nullable(),
    symbol: z.string().min(1).max(24).nullable(),
    decimals: z.number().int().min(0).max(18).nullable(),
  })
  .strict();

/**
 * The rate this operation actually paid, in basis points, or null.
 *
 * Rounded to the nearest whole basis point, which both real fills of
 * 2026-09-11 land on exactly — `12552 / 5020909` and `6344 / 2537760` are both
 * 25 bps. The exact raw amounts are in the receipt beside this, so the rounding
 * costs nothing that cannot be recomputed.
 */
export function measuredFeeBps(paidRaw: string | null, sentRaw: string): number | null {
  if (paidRaw === null) return null;
  const sent = BigInt(sentRaw);
  if (sent === 0n) return null;
  const paid = BigInt(paidRaw);
  const scaled = (paid * 100_000n) / sent;
  const bps = Number((scaled + 5n) / 10n);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

export const CrossSwapReceiptFactsSchema = z
  .object({
    schema: z.literal(CROSS_SWAP_RECEIPT_FACTS_SOURCE),
    provider: z.enum(["RELAY", "MAYAN"]),
    intentDigest: HEX32,
    reviewDigest: HEX32,
    tupleId: z.string().min(3).max(160),
    route: z.enum(["SWIFT", "FAST_MCTP", "RELAY_DEPOSIT"]),
    source: SideSchema,
    destination: SideSchema,
    amounts: z
      .object({
        sentRaw: RAW,
        expectedOutRaw: RAW,
        /** The floor the person reviewed. A fill under it is a deviation, always. */
        minimumOutRaw: RAW,
        receivedRaw: RAW.nullable(),
      })
      .strict(),
    fee: FeeSchema,
    refund: z
      .object({ txHash: CHAIN_TX.nullable(), amount: z.string().max(64).nullable(), symbol: z.string().max(24).nullable() })
      .strict()
      .nullable(),
    settlement: z
      .object({
        orderState: z.string().min(1).max(48),
        providerStatus: z.string().max(160).nullable(),
        clientStatus: z.enum(["INPROGRESS", "COMPLETED", "REFUNDED"]).nullable(),
        completedAt: z.string().max(64).nullable(),
        observedBy: z.string().min(1).max(160),
      })
      .strict(),
    reconciliation: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED", "NOT_OBSERVED"]),
    deviations: z.array(z.string().min(1).max(400)).max(12),
    limitations: z.array(z.string().min(1).max(400)).min(1).max(12),
    observedAt: INSTANT,
  })
  .strict();

export type CrossSwapReceiptFacts = z.output<typeof CrossSwapReceiptFactsSchema>;

export function encodeCrossSwapFacts(facts: CrossSwapReceiptFacts): string {
  return JSON.stringify(CrossSwapReceiptFactsSchema.parse(facts));
}

/** The facts, chunked into observed effects so the issuer signature covers them. */
export function crossSwapFactsToEffects(args: {
  facts: CrossSwapReceiptFacts;
  sourceRef: string;
  observedAt: string;
}): readonly ReceiptEffect[] {
  const encoded = encodeCrossSwapFacts(args.facts);
  const chunks: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += EFFECT_CHUNK_SIZE) {
    chunks.push(encoded.slice(offset, offset + EFFECT_CHUNK_SIZE));
  }
  return chunks.map((description, index) => ({
    description,
    sourceRef: `${CROSS_SWAP_RECEIPT_FACTS_SOURCE}:${args.sourceRef}#${index + 1}/${chunks.length}`,
    observedAt: args.observedAt,
  }));
}

/** Read the facts back out of a receipt. Null unless every chunk is present. */
export function parseCrossSwapFactsFromEffects(effects: readonly ReceiptEffect[]): CrossSwapReceiptFacts | null {
  const pattern = new RegExp(
    `^${CROSS_SWAP_RECEIPT_FACTS_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*#(\\d+)/(\\d+)$`,
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
    const parsed = CrossSwapReceiptFactsSchema.safeParse(JSON.parse(chunks.map((chunk) => chunk.description).join("")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * What happened, decided from evidence rather than from the order's intent.
 *
 * `NOT_OBSERVED` never reaches a receipt: the route refuses to mint one for an
 * operation still in motion, and this returns it only so an unfinished record
 * handed here by mistake cannot be described as either success or failure.
 */
export function reconcileCrossSwapFacts(facts: CrossSwapReceiptFacts): Readonly<{
  status: "MATCHED" | "DEVIATION_RECORDED" | "FAILED";
  deviations: readonly string[];
}> {
  const deviations: string[] = [];
  const state = facts.settlement.orderState;

  if (state === "SOURCE_FAILED" || state === "EXPIRED_BEFORE_SUBMIT") {
    return {
      status: "FAILED",
      deviations: [
        state === "SOURCE_FAILED"
          ? "The source transaction landed and failed, so nothing left the wallet."
          : "The reviewed order expired before it was sent, so nothing left the wallet.",
      ],
    };
  }

  if (state === "REFUNDED") {
    return {
      status: "DEVIATION_RECORDED",
      deviations: [
        facts.refund?.txHash
          ? `The operation was refunded on ${SWAP_NETWORK_META[facts.source.network].label} by transaction ${facts.refund.txHash}; the refund may be a different asset from the one that was sent.`
          : "The operation was refunded and the refunding transaction was not reported.",
      ],
    };
  }

  if (facts.destination.txHash === null) {
    deviations.push(
      `No transaction was observed on ${SWAP_NETWORK_META[facts.destination.network].label}, so nothing here states that the funds arrived.`,
    );
  }
  if (facts.amounts.receivedRaw === null) {
    deviations.push("The provider did not report what arrived, so the received amount is unknown.");
  } else if (BigInt(facts.amounts.receivedRaw) < BigInt(facts.amounts.minimumOutRaw)) {
    deviations.push(
      `The fill delivered ${facts.amounts.receivedRaw} base units against a reviewed minimum of ${facts.amounts.minimumOutRaw}.`,
    );
  }
  if (!facts.fee.reported) {
    /* The one an earlier version of this file got wrong by omission: an
       unreachable provider produced a receipt that read as though nothing had
       been charged. Not knowing is a deviation, and it says so. */
    deviations.push("Ryntra's service fee could not be read back from the provider, so this receipt does not state what it cost.");
  } else if (!facts.fee.collected) {
    deviations.push("Ryntra's service fee was quoted on this operation and the provider did not confirm collecting it.");
  }
  if (facts.source.txHash === null) {
    deviations.push("The source transaction was not recorded, so this receipt is anchored to the intent alone.");
  }

  return deviations.length === 0 ? { status: "MATCHED", deviations } : { status: "DEVIATION_RECORDED", deviations };
}

export type CrossSwapReceiptMintResult =
  | Readonly<{ ok: true; receipt: OutcomeReceiptArtifact; facts: CrossSwapReceiptFacts }>
  | Readonly<{ ok: false; code: "FACTS_INVALID" | "MINT_FAILED"; reason: string }>;

/**
 * Mint the Cross-chain Receipt.
 *
 * Built twice, exactly as the Send and Bridge lanes are: the unsigned mint
 * fixes the content hash and the signed mint reuses that hash **and** the same
 * timestamp. `RYN-AGENT-CONTROL-007` recorded what happens otherwise — a second
 * `createdAt` moves the hash the signature was taken over, and the public
 * verifier answers `SIGNATURE_INVALID` for a receipt that is otherwise correct.
 *
 * The receipt is anchored to the chain the money **left**, because that is the
 * chain its `transactionHash` belongs to. Anchoring it to Solana in both
 * directions would produce a document whose chain reference and whose
 * transaction were about different ledgers.
 */
export function mintCrossSwapOutcomeReceipt(args: {
  id: string;
  /** The order's own Review digest — the receipt cannot outrun what was authorized. */
  actionPassportHash: string;
  facts: CrossSwapReceiptFacts;
  environment?: Record<string, string | undefined>;
  now?: Date;
}): CrossSwapReceiptMintResult {
  const parsed = CrossSwapReceiptFactsSchema.safeParse(args.facts);
  if (!parsed.success) {
    return {
      ok: false,
      code: "FACTS_INVALID",
      reason: parsed.error.issues.map((issue) => `${issue.path.join(".") || "facts"}: ${issue.message}`).join(" · "),
    };
  }

  const now = args.now ?? new Date();
  const reconciled = reconcileCrossSwapFacts(parsed.data);
  const facts = CrossSwapReceiptFactsSchema.parse({
    ...parsed.data,
    reconciliation: reconciled.status,
    deviations: reconciled.deviations.slice(0, 12),
  });

  try {
    const sourceRef = `${facts.settlement.observedBy}:${facts.intentDigest}`;
    const sourceLabel = SWAP_NETWORK_META[facts.source.network].label;
    const destinationLabel = SWAP_NETWORK_META[facts.destination.network].label;
    const headline: ReceiptEffect[] = [
      {
        description: `Sent ${facts.amounts.sentRaw} base units of ${facts.source.symbol} on ${sourceLabel} towards ${facts.destination.symbol} on ${destinationLabel}, minimum ${facts.amounts.minimumOutRaw}.`,
        sourceRef,
        observedAt: facts.observedAt,
      },
      {
        description:
          facts.amounts.receivedRaw === null
            ? `No arrival was reported on ${destinationLabel} at the time this receipt was issued.`
            : `${destinationLabel} credited ${facts.amounts.receivedRaw} base units of ${facts.destination.symbol} to ${facts.destination.wallet}.`,
        sourceRef,
        observedAt: facts.observedAt,
      },
      {
        description: !facts.fee.reported
          ? `Ryntra's service fee on this operation was not read back from ${facts.settlement.observedBy}, so nothing here states what it cost.`
          : facts.fee.collected
            ? `Ryntra service fee collected: ${facts.fee.paidAmountRaw ?? "an unstated amount"} base units of ${facts.fee.symbol ?? facts.source.symbol}${facts.fee.basisPoints === null ? "" : `, ${facts.fee.basisPoints} bps of what was sent`}.`
            : "Ryntra's service fee was quoted on this operation and the provider did not confirm collecting it.",
        sourceRef,
        observedAt: facts.observedAt,
      },
    ];
    const outcome = {
      status: reconciled.status,
      chainRef: facts.source.chainRef,
      /* The source transaction is what this receipt is about. Where there is
         none — an order the provider filled from an intent this server never
         saw land — the intent digest stands in, and the reconciliation says so
         rather than the field pretending to be a transaction. */
      transactionHash: facts.source.txHash ?? facts.intentDigest,
      observedEffects: [...headline, ...crossSwapFactsToEffects({ facts, sourceRef, observedAt: facts.observedAt })],
      reconciledAt: now.toISOString(),
    };
    /* Both ends named. A cross-chain operation touches two adapters and pinning
       only one would describe half of it. */
    const refs = [facts.source.network, facts.destination.network].map((network) =>
      network === "solana" ? SOLANA_TOKEN_2022_ADAPTER_REF : BASE_EVM_ADAPTER_REF,
    );
    const base = {
      id: args.id,
      actionPassportHash: args.actionPassportHash,
      outcome,
      registry: registryPin(AGENT_CONTROL_REGISTRY, refs),
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

/**
 * The order and the provider's report of its fill, as one set of facts.
 *
 * Typed structurally rather than against the stored record, so this module
 * never imports the order store — and so the mapping can be checked against
 * real Relay numbers without a network, a store or a route. It is the half of
 * the receipt most worth testing: every amount, and above all the difference
 * between a fee that was quoted and one that was taken, is decided here.
 */
export type CrossSwapReceiptOrder = Readonly<{
  provider: "RELAY" | "MAYAN";
  intentDigest: string;
  reviewDigest: string;
  tupleId: string;
  route: "SWIFT" | "FAST_MCTP" | "RELAY_DEPOSIT";
  state: string;
  sourceChain: SwapNetwork;
  destinationChain: SwapNetwork;
  sourceWallet: string;
  destinationWallet: string;
  fromSymbol: string;
  toSymbol: string;
  fromDecimals: number;
  toDecimals: number;
  amountInRaw: string;
  expectedOutRaw: string;
  minimumOutRaw: string;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  refundTxHash: string | null;
  receivedAmount: string | null;
  refund: Readonly<{ amount: string | null; tokenSymbol: string | null }> | null;
  providerStatus: string | null;
}>;

/** Exactly what a provider report contributes, and nothing more. */
export type CrossSwapReceiptFill = Readonly<{
  clientStatus: "INPROGRESS" | "COMPLETED" | "REFUNDED" | null;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  refundTxHash: string | null;
  toAmount: string | null;
  completedAt: string | null;
  serviceFee: Readonly<{
    collected: boolean;
    quotedUsd: number | null;
    paidUsd: number | null;
    paidAmountRaw: string | null;
    currency?: Readonly<{ address: string | null; symbol: string; decimals: number }> | null;
    basisPoints?: number | null;
    settlement?: Readonly<{ userPaidRaw: string | null }>;
  }> | null;
}>;

/**
 * The fee, said only as far as it is known.
 *
 * The mechanism comes from the order — a fact about how it was carried, true
 * whether or not anybody later got an answer out of the provider. Everything
 * else comes from the provider's report, and its absence is recorded as
 * absence.
 */
function feeFacts(order: CrossSwapReceiptOrder, fee: CrossSwapReceiptFill["serviceFee"]): z.output<typeof FeeSchema> {
  const mechanism = order.provider === "RELAY" ? ("RELAY_APP_FEE" as const) : ("MAYAN_REFERRER" as const);
  if (!fee) {
    return { mechanism, reported: false, basisPoints: null, collected: false, quotedUsd: null, paidUsd: null, paidAmountRaw: null, symbol: null, decimals: null };
  }
  /* The settlement figure first: it is what the person actually paid, and
     `paidAmountRaw` is the gross the provider states beside it. */
  const paidAmountRaw = fee.settlement?.userPaidRaw ?? fee.paidAmountRaw ?? null;
  return {
    mechanism,
    reported: true,
    basisPoints: fee.basisPoints !== undefined ? fee.basisPoints : measuredFeeBps(paidAmountRaw, order.amountInRaw),
    collected: fee.collected,
    quotedUsd: fee.quotedUsd ?? null,
    paidUsd: fee.paidUsd ?? null,
    paidAmountRaw,
    symbol: fee.currency !== undefined ? fee.currency?.symbol ?? null : order.fromSymbol,
    decimals: fee.currency !== undefined ? fee.currency?.decimals ?? null : order.fromDecimals,
  };
}

export function crossSwapReceiptFacts(
  order: CrossSwapReceiptOrder,
  fill: CrossSwapReceiptFill | null,
  observedAt: string,
  parseAmount: (human: string, decimals: number) => string | null,
): CrossSwapReceiptFacts {
  const fee = fill?.serviceFee ?? null;
  /* The provider's report of the fill first, the record second. The record is
     written by a poll that may have run before the fill was indexed. */
  const receivedHuman = fill?.toAmount ?? order.receivedAmount;
  const receivedRaw = order.state === "COMPLETED" && receivedHuman ? parseAmount(receivedHuman, order.toDecimals) : null;
  return CrossSwapReceiptFactsSchema.parse({
    schema: CROSS_SWAP_RECEIPT_FACTS_SOURCE,
    provider: order.provider,
    intentDigest: order.intentDigest,
    reviewDigest: order.reviewDigest,
    tupleId: order.tupleId,
    route: order.route,
    source: {
      network: order.sourceChain,
      chainRef: crossSwapChainRef(order.sourceChain),
      wallet: order.sourceWallet,
      symbol: order.fromSymbol,
      decimals: order.fromDecimals,
      txHash: order.sourceTxHash ?? fill?.sourceTxHash ?? null,
    },
    destination: {
      network: order.destinationChain,
      chainRef: crossSwapChainRef(order.destinationChain),
      wallet: order.destinationWallet,
      symbol: order.toSymbol,
      decimals: order.toDecimals,
      txHash: order.destinationTxHash ?? fill?.destinationTxHash ?? null,
    },
    amounts: {
      sentRaw: order.amountInRaw,
      expectedOutRaw: order.expectedOutRaw,
      minimumOutRaw: order.minimumOutRaw,
      receivedRaw,
    },
    fee: feeFacts(order, fee),
    refund:
      order.state === "REFUNDED"
        ? {
            txHash: order.refundTxHash ?? fill?.refundTxHash ?? null,
            amount: order.refund?.amount ?? null,
            symbol: order.refund?.tokenSymbol ?? null,
          }
        : null,
    settlement: {
      orderState: order.state,
      providerStatus: order.providerStatus,
      clientStatus: fill?.clientStatus ?? null,
      completedAt: fill?.completedAt ?? null,
      observedBy: order.provider === "RELAY" ? "api.relay.link" : "explorer.mayan.finance",
    },
    /* Overwritten by the minter from the evidence above. Supplied because the
       schema requires a value, and a caller's guess must never be the one kept. */
    reconciliation: "NOT_OBSERVED",
    deviations: [],
    limitations: [...CROSS_SWAP_RECEIPT_LIMITATIONS],
    observedAt,
  });
}

/** What every Cross-chain Receipt states about itself. */
export const CROSS_SWAP_RECEIPT_LIMITATIONS: readonly string[] = Object.freeze([
  "This receipt describes one owner-signed cross-chain operation and grants no authority over any other.",
  "The fill and the fee are the provider's own report of this operation, read back after settlement; they are not this server's measurement of the destination chain.",
  "A cross-chain route may deliver a different amount from the quote. Only the reviewed minimum was ever promised, and it is stated here beside what arrived.",
]);
