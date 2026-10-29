/**
 * A stored receipt's execution truth (SOL-X1): the swap's or the launch trade's signed facts, put back together from
 * the receipt's own observed effects and read by `lib/core/execution-truth.ts`, with the scale of every mint it names.
 *
 * The scale comes from where the product already knows it: the launch facts state both sides; a swap's fee states its
 * own; SOL and the dollars are constants; any other mint takes the scale its history row was enriched with. A mint
 * whose scale is not known is shown without a number — never with a guessed one.
 *
 * Pure and client-safe.
 */

import { z } from "zod";

import { launchExecutionTruth, swapExecutionTruth, type ExecutionTruth, type SwapTruthFacts } from "../core/execution-truth.ts";
import { parseLaunchTradeFactsFromEffects } from "../core/venues/meteora-dbc/trade-receipt.ts";
import { USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT } from "../core/fee-policy.ts";
import { ServiceFeeSchema } from "../swap/service-fee.ts";

/** The swap facts' source tag (`SWAP_RECEIPT_FACTS_SOURCE`, lib/solana/swap-receipt.ts — that module is the server's; the test holds the two equal). */
export const SWAP_FACTS_SOURCE = "ryntra.solana.swap-receipt.facts@1";

const Raw = z.string().regex(/^[0-9]+$/);
const Fee = z.object({ basisPoints: z.number().int().min(0).max(10_000), mint: z.string().nullable(), amountRaw: Raw.nullable() });

/** The fields the truth reads, checked; the rest of the signed facts passes through untouched (the verifier owns them). */
const SwapTruthFactsSchema = z.object({
  schema: z.literal("ryntra.solana.swap-receipt-facts"),
  quote: z.object({ inputMint: z.string().min(32).max(44), outputMint: z.string().min(32).max(44), inputRaw: Raw, outputRaw: Raw, minimumOutputRaw: Raw }),
  fees: z.object({ platform: Fee, referral: Fee, serviceFee: ServiceFeeSchema.optional() }),
  provider: z.unknown(),
  independentObservation: z.object({ signature: z.string().min(64).max(96), actualInputRaw: Raw, actualOutputRaw: Raw, baseFeeLamports: Raw, priorityFeeLamports: Raw }),
  reconciliation: z.object({ minimumMet: z.boolean(), deviations: z.array(z.string()) }),
});

/** A swap's facts from its receipt's numbered chunks, or null when a chunk is missing, out of order or not these facts. */
export function swapTruthFactsOf(effects: readonly Readonly<{ description: string; sourceRef: string }>[]): SwapTruthFacts | null {
  const escaped = SWAP_FACTS_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*#(\\d+)/(\\d+)$`);
  const chunks = effects
    .map((effect) => ({ effect, match: pattern.exec(effect.sourceRef) }))
    .filter((entry): entry is { effect: Readonly<{ description: string; sourceRef: string }>; match: RegExpExecArray } => entry.match !== null)
    .map((entry) => ({ index: Number(entry.match[1]), total: Number(entry.match[2]), description: entry.effect.description }));
  if (chunks.length === 0) return null;
  const total = chunks[0]!.total;
  if (chunks.length !== total || chunks.some((chunk) => chunk.total !== total)) return null;
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.some((chunk, index) => chunk.index !== index + 1)) return null;
  try {
    const parsed = SwapTruthFactsSchema.safeParse(JSON.parse(chunks.map((chunk) => chunk.description).join("")));
    return parsed.success ? (parsed.data as SwapTruthFacts) : null;
  } catch {
    return null;
  }
}

export type TruthAsset = Readonly<{ symbol: string | null; decimals: number | null }>;
export type TruthAssets = Readonly<Record<string, TruthAsset>>;

export type ReceiptTruth = Readonly<{ truth: ExecutionTruth; assets: TruthAssets }>;

const KNOWN: TruthAssets = {
  [WRAPPED_SOL_MINT]: { symbol: "SOL", decimals: 9 },
  [USDC_MINT]: { symbol: "USDC", decimals: 6 },
  [USDT_MINT]: { symbol: "USDT", decimals: 6 },
};

type Effect = Readonly<{ description: string; sourceRef: string; observedAt: string }>;

function effectsOf(receipt: unknown): readonly Effect[] {
  const outcome = typeof receipt === "object" && receipt !== null ? (receipt as { outcome?: unknown }).outcome : null;
  const effects = typeof outcome === "object" && outcome !== null ? (outcome as { observedEffects?: unknown }).observedEffects : null;
  if (!Array.isArray(effects)) return [];
  return effects.filter(
    (effect): effect is Effect =>
      typeof effect === "object" && effect !== null && typeof effect.description === "string" && typeof effect.sourceRef === "string" && typeof effect.observedAt === "string",
  );
}

/** The scale of a history row's two sides, keyed by mint (a null mint is SOL's). */
export function assetsOfMovements(movements: readonly (Readonly<{ mint: string | null; decimals?: number | null; symbol?: string | null }> | null | undefined)[]): TruthAssets {
  const assets: Record<string, TruthAsset> = {};
  for (const movement of movements) {
    if (!movement) continue;
    const mint = movement.mint ?? WRAPPED_SOL_MINT;
    if (typeof movement.decimals === "number") assets[mint] = { symbol: movement.symbol ?? null, decimals: movement.decimals };
  }
  return assets;
}

/**
 * The receipt's truth, or null when it is not a swap or a launch trade, or its facts are not whole — the caller then
 * shows the receipt as it did before.
 */
export function receiptTruth(receipt: unknown, known: TruthAssets = {}): ReceiptTruth | null {
  const effects = effectsOf(receipt);
  if (effects.length === 0) return null;
  const launch = parseLaunchTradeFactsFromEffects(effects);
  if (launch) {
    return {
      truth: launchExecutionTruth(launch),
      assets: { ...KNOWN, ...known, [launch.token.mint]: { symbol: launch.token.symbol, decimals: launch.token.decimals }, [launch.pair.mint]: { symbol: launch.pair.symbol, decimals: launch.pair.decimals } },
    };
  }
  const swap = swapTruthFactsOf(effects);
  if (!swap) return null;
  const fee = swap.fees.serviceFee;
  const feeAsset: TruthAssets = fee?.asset && typeof fee.decimals === "number" ? { [fee.asset]: { symbol: fee.symbol, decimals: fee.decimals } } : {};
  return { truth: swapExecutionTruth(swap), assets: { ...feeAsset, ...KNOWN, ...known } };
}
