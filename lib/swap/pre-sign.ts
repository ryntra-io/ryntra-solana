/**
 * The facts a person checks immediately before signing, taken from the build
 * that produced the bytes they are about to sign.
 *
 * `RYN-SOL-MONEY-FLOWS-001H`, owner instruction 2026-09-09: the snapshot a
 * person is shown and the transaction they sign **must come from one quote**.
 * Showing figures from one quote and building from another is the defect this
 * exists to make impossible — not unlikely, impossible — because the two are
 * now the same object. The plan route re-quotes once, builds from that quote,
 * and this function reads the snapshot off the same `quote`, the same
 * `destination`, the same built transaction. There is no second read.
 *
 * ## Why every field is spelled out in full
 *
 * Four of these decide where money goes, and an abbreviation hides exactly the
 * part that would differ if something were wrong: the destination address, the
 * token contract, the chain id and the minimum received. They are carried
 * unabbreviated so a person can compare them character for character against
 * what they expect, and so the surface has no excuse to truncate them.
 *
 * ## What this is not
 *
 * It is not an approval and not a guarantee. It is a statement of what was
 * built, at a moment, with the boundary past which it stops being true stated
 * beside it. It authorizes nothing.
 */

import type { SwapNetwork } from "./catalog.ts";
import type { CrossSwapQuote } from "./cross-swap-quote.ts";
import { crossSwapImpactBand, type CrossSwapImpactBand } from "./cross-swap-service.ts";
import type { RyntraServiceFee } from "./service-fee.ts";

export type CrossSwapPreSign = Readonly<{
  schema: "ryntra.solana.cross-swap-pre-sign";
  schemaVersion: "1.0.0";

  from: Readonly<{
    network: SwapNetwork;
    /** Mint on Solana, contract on an EVM chain, null for the chain's own coin. */
    contract: string | null;
    symbol: string;
    decimals: number;
    amountRaw: string;
    amountFormatted: string;
  }>;
  to: Readonly<{
    network: SwapNetwork;
    /** EIP-155 chain id for an EVM destination; null on Solana. */
    chainId: number | null;
    /** Full, never abbreviated. Null for a native coin. */
    contract: string | null;
    symbol: string;
    decimals: number;
    expectedRaw: string;
    expectedFormatted: string;
    /** What the order signs; the provider cannot fill below it. */
    minimumRaw: string;
    minimumFormatted: string;
  }>;

  /** Full, never abbreviated — where the destination asset actually arrives. */
  destinationAddress: string;
  /** Full — the wallet that will be asked for the signature. */
  sourceWallet: string;

  provider: CrossSwapQuote["provider"];
  route: CrossSwapQuote["route"];
  routeLabel: string;

  priceImpactBps: number | null;
  impactBand: CrossSwapImpactBand;
  /** True when this quote may not be built without an explicit acknowledgement. */
  requiresImpactAcknowledgement: boolean;

  fees: Readonly<{
    /** Paid by the signing wallet, on top of the amount. Null when the provider does not state it. */
    sourceGasUsd: number | null;
    /** Inside the price impact. */
    relayerGasUsd: number | null;
    /** Inside the price impact. */
    serviceUsd: number | null;
    /** Inside the price impact, and the parent of the two above. */
    relayerTotalUsd: number | null;
    /**
     * Ryntra's own fee, in USD when the provider states one.
     *
     * This was the literal `0` for as long as there was no mechanism to take one.
     * It is now whatever the provider actually quoted, and `serviceFee` beside it
     * carries the rate, the mechanism and the collection state, because a dollar
     * figure alone cannot say *whether* the money will arrive.
     */
    appUsd: number | null;
    /** `impact + sourceGas`, never the sum of every row: see `CrossSwapQuote.fees`. */
    maxKnownCostNote: string;
  }>;

  /**
   * The Ryntra service fee this exact quote carries, whole.
   *
   * Beside `fees` rather than inside it so a surface cannot render it as one more
   * cost of the rail. It is the one row named after the company charging it, and
   * on a route with no mechanism for it — the direct Circle CCTP lane — it is a
   * zero with a reason rather than an omission.
   */
  serviceFee: RyntraServiceFee;

  slippageBps: number;

  walletPrompts: number;

  validity: Readonly<{
    builtAt: string;
    /** After this the Review is stale and the plan must be built again. */
    reviewExpiresAt: string;
    /** `PROTOCOL` is a refund guarantee; `QUOTE_VALIDITY` is only freshness. */
    deadlineKind: CrossSwapQuote["deadlineKind"];
    deadlineUnix: number;
    /** The chain's own boundary on a Solana origin: past it the blockhash is dead. */
    lastValidBlockHeight: number | null;
  }>;

  gate: Readonly<{
    variable: string;
    /** Necessarily `OPEN` — the plan cannot be built otherwise. */
    resolvedAtPlanTime: "OPEN";
  }>;

  payload: Readonly<{
    kind: "SOLANA_TRANSACTION" | "EVM_CALLS";
    /** Solana: the fee payer and only signer. */
    feePayer: string | null;
    requiredSignatures: number | null;
    instructionCount: number | null;
    /** Every program the message invokes. */
    programIds: readonly string[];
    /** sha256 of the exact bytes; the submit refuses anything else. */
    wireSha256: string | null;
    /** EVM: the contracts each call targets, in order. */
    calls: readonly Readonly<{ purpose: string; to: string; valueHex: string }>[];
  }>;
}>;

function formatted(raw: string, decimals: number): string {
  const value = BigInt(raw);
  if (decimals === 0) return value.toString();
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

const EVM_CHAIN_IDS: Partial<Record<SwapNetwork, number>> = { base: 8453, ethereum: 1, robinhood: 4663 };

export function buildCrossSwapPreSign(args: {
  quote: CrossSwapQuote;
  destinationAddress: string;
  sourceWallet: string;
  fromContract: string | null;
  toContract: string | null;
  gateVariable: string;
  builtAt: string;
  reviewExpiresAt: string;
  requiresImpactAcknowledgement: boolean;
  solana?: Readonly<{ feePayer: string; requiredSignatures: number; instructionCount: number; programIds: readonly string[]; wireSha256: string; lastValidBlockHeight: number }>;
  evm?: Readonly<{ calls: readonly Readonly<{ purpose: string; to: string; value: string }>[] }>;
}): CrossSwapPreSign {
  const { quote } = args;
  return {
    schema: "ryntra.solana.cross-swap-pre-sign",
    schemaVersion: "1.0.0",
    from: {
      network: quote.from.network,
      contract: args.fromContract,
      symbol: quote.from.symbol,
      decimals: quote.from.decimals,
      amountRaw: quote.from.amountRaw,
      amountFormatted: formatted(quote.from.amountRaw, quote.from.decimals),
    },
    to: {
      network: quote.to.network,
      chainId: EVM_CHAIN_IDS[quote.to.network] ?? null,
      contract: args.toContract,
      symbol: quote.to.symbol,
      decimals: quote.to.decimals,
      expectedRaw: quote.to.expectedRaw,
      expectedFormatted: formatted(quote.to.expectedRaw, quote.to.decimals),
      minimumRaw: quote.to.minimumRaw,
      minimumFormatted: formatted(quote.to.minimumRaw, quote.to.decimals),
    },
    destinationAddress: args.destinationAddress,
    sourceWallet: args.sourceWallet,
    provider: quote.provider,
    route: quote.route,
    routeLabel: quote.routeLabel,
    priceImpactBps: quote.priceImpactBps,
    impactBand: crossSwapImpactBand(quote.priceImpactBps),
    requiresImpactAcknowledgement: args.requiresImpactAcknowledgement,
    fees: {
      sourceGasUsd: quote.fees.sourceGasUsd,
      relayerGasUsd: quote.fees.relayerGasUsd,
      serviceUsd: quote.fees.protocolUsd,
      relayerTotalUsd: quote.fees.relayerUsd,
      appUsd: quote.serviceFee.usd,
      maxKnownCostNote:
        "Maximum known cost is the price impact plus source gas. The relayer figure is already inside the impact, and is itself the parent of relayer gas and the service fee; summing them all double-counts.",
    },
    serviceFee: quote.serviceFee,
    slippageBps: quote.slippageBps,
    walletPrompts: quote.walletPrompts,
    validity: {
      builtAt: args.builtAt,
      reviewExpiresAt: args.reviewExpiresAt,
      deadlineKind: quote.deadlineKind,
      deadlineUnix: quote.deadlineUnix,
      lastValidBlockHeight: args.solana?.lastValidBlockHeight ?? null,
    },
    gate: { variable: args.gateVariable, resolvedAtPlanTime: "OPEN" },
    payload: args.solana
      ? {
          kind: "SOLANA_TRANSACTION",
          feePayer: args.solana.feePayer,
          requiredSignatures: args.solana.requiredSignatures,
          instructionCount: args.solana.instructionCount,
          programIds: args.solana.programIds,
          wireSha256: args.solana.wireSha256,
          calls: [],
        }
      : {
          kind: "EVM_CALLS",
          feePayer: null,
          requiredSignatures: null,
          instructionCount: null,
          programIds: [],
          wireSha256: null,
          calls: (args.evm?.calls ?? []).map((call) => ({ purpose: call.purpose, to: call.to, valueHex: call.value })),
        },
  };
}
