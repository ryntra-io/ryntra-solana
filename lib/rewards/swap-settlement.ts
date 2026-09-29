import type { OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import type { GuardStore } from "../guard/store.ts";
import { recordOperationPoints } from "../points/record.server.ts";
import { actionFeeFromServiceFee, recordSolanaAction } from "../solana/action-ledger.ts";
import { statedUsdOf } from "../solana/action-value.ts";
import type { SwapExecutionBundle } from "../solana/swap-execution-review.ts";
import { parseSwapReceiptFactsFromEffects } from "../solana/swap-receipt.ts";
import type { RyntraServiceFee } from "../swap/service-fee.ts";
import { REWARD_PAR_MINTS, priceRatio } from "./model.ts";
import { recordOperationRewards } from "./record.server.ts";

/** A timely quoted market price can value confirmed fee units. It is never
 * passed as a collected fee or used without independent collection evidence. */
export function swapFeePrice(quote: SwapExecutionBundle["review"]["quote"], fee: RyntraServiceFee | null | undefined) {
  if (!fee) return null;
  const mint = fee.settlement?.asset ?? fee.asset;
  const decimals = fee.settlement?.decimals ?? fee.decimals ?? (mint ? REWARD_PAR_MINTS[mint] : null)
    ?? (mint === "So11111111111111111111111111111111111111112" ? 9 : null);
  if (!mint || decimals === null) return null;
  const input = mint === quote.inputMint;
  if (!input && mint !== quote.outputMint) return null;
  const usd = input ? quote.inUsdValue : quote.outUsdValue;
  const amount = BigInt(input ? quote.inputRaw : quote.quotedOutputRaw);
  if (!usd || amount <= 0n) return null;
  try {
    const ratio = priceRatio(usd);
    const scaled = ratio.numerator * 10n ** BigInt(decimals) * 10n ** 18n / (ratio.denominator * amount);
    if (scaled <= 0n) return null;
    const digits = scaled.toString().padStart(19, "0");
    const price = `${digits.slice(0, -18)}.${digits.slice(-18)}`.replace(/0+$/, "").replace(/\.$/, "");
    return { price, observedAt: quote.observedAt, sourceRef: `jupiter:order:${quote.requestId}:${input ? "input" : "output"}-price` };
  } catch { return null; }
}

/** Called only after the existing issuer/bundle and receipt checks. Cached
 * receipts take this path too, so an interrupted bookkeeping tail can recover. */
export async function recordSwapSettlementBenefits(store: GuardStore, args: Readonly<{
  bundle: SwapExecutionBundle; receipt: OutcomeReceiptArtifact; signature: string; now: string; env?: NodeJS.ProcessEnv;
}>) {
  try {
    const facts = parseSwapReceiptFactsFromEffects(args.receipt.outcome.observedEffects);
    if (!facts || facts.independentObservation.signature !== args.signature
      || facts.quoteDigest !== args.bundle.review.quoteDigest || facts.reviewDigest !== args.bundle.review.reviewDigest) return;
    const quote = args.bundle.review.quote;
    const observation = facts.independentObservation;
    const fee = actionFeeFromServiceFee(facts.fees.serviceFee);
    const row = await recordSolanaAction(store, { network: "mainnet", wallet: args.bundle.taker, actionId: args.signature,
      lane: "SWAP", outcome: "DONE", out: { mint: quote.inputMint, amountRaw: observation.actualInputRaw, decimals: null, symbol: null },
      in: { mint: quote.outputMint, amountRaw: observation.actualOutputRaw, decimals: null, symbol: null }, signature: args.signature,
      receiptHash: args.receipt.contentHash, ...(fee ? { fee } : {}), origin: args.bundle.origin ?? null,
      providerRef: quote.requestId, statedUsd: statedUsdOf(quote.inUsdValue, quote.inputRaw, observation.actualInputRaw), now: args.now });
    await recordOperationRewards(store, { fee: facts.fees.serviceFee, trader: args.bundle.taker, settledAt: observation.observedAt,
      now: args.now, env: args.env, price: swapFeePrice(quote, facts.fees.serviceFee) });
    if (row.ok) await recordOperationPoints(store, { action: row.action, settledAt: observation.observedAt, now: args.now, env: args.env,
      statedUsd: quote.inUsdValue && quote.inputRaw === observation.actualInputRaw ? { value: quote.inUsdValue, sourceRef: "jupiter:order:inUsdValue" } : null });
  } catch { /* The receipt remains the financial outcome; queued work can retry. */ }
}
