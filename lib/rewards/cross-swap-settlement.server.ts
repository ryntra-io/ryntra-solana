import type { GuardStore } from "../guard/store.ts";
import { readCrossSwapOrder, type CrossSwapOrderRecord } from "../mayan/cross-swap-order.ts";
import { recordOperationPoints } from "../points/record.server.ts";
import { resolveRelayApiKey } from "../relay/api-key.server.ts";
import { fetchRelayIntentStatus } from "../relay/status-api.ts";
import { recordSolanaAction } from "../solana/action-ledger.ts";
import { parseHumanAmount } from "../swap/catalog.ts";
import { historyDestinationFor } from "../swap/cross-swap-service.ts";
import type { CrossSwapProviderStatus } from "../swap/cross-swap-status.ts";
import { completeBenefitJob, enqueueBenefitJob } from "./benefit-jobs.ts";
import { crossSwapServiceFee } from "./cross-swap.ts";
import { recordOperationRewards } from "./record.server.ts";

/** Missing provider fee details are retried even if Points do not apply to
 * this route. A stored receipt is returned unchanged by its caller. */
export async function recordCrossSwapBenefits(store: GuardStore, record: CrossSwapOrderRecord, lookup: CrossSwapProviderStatus | null, args: Readonly<{ now: string; settledAt?: string; env?: NodeJS.ProcessEnv }> ) {
  if (record.state !== "COMPLETED" || record.provider !== "RELAY") return true;
  const wallet = record.sourceChain === "solana" ? record.sourceWallet : record.destinationChain === "solana" ? record.destinationWallet : null;
  if (!wallet) return true;
  const settledAt = args.settledAt ?? lookup?.completedAt ?? record.trail.find(entry => entry.state === "COMPLETED")?.at ?? record.updatedAt;
  const job = { kind: "CROSS_SWAP" as const, wallet, operationId: record.intentDigest, settledAt };
  try {
    await enqueueBenefitJob(store, job, args.now);
    const received = lookup?.clientStatus === "COMPLETED" ? lookup.toAmount ?? record.receivedAmount : record.receivedAmount;
    const receivedRaw = received ? parseHumanAmount(received, record.toDecimals) : null;
    const paid = lookup?.clientStatus === "COMPLETED" ? lookup.serviceFee : null;
    const sourceHash = record.sourceTxHash ?? lookup?.sourceTxHash;
    const destinationHash = record.destinationTxHash ?? lookup?.destinationTxHash;
    const row = await recordSolanaAction(store, { network: "mainnet", wallet, actionId: record.intentDigest, lane: "CROSS_SWAP", outcome: "DONE",
      out: { mint: null, amountRaw: record.amountInRaw, decimals: record.fromDecimals, symbol: record.fromSymbol },
      ...(receivedRaw ? { in: { mint: null, amountRaw: receivedRaw, decimals: record.toDecimals, symbol: record.toSymbol } } : {}),
      destination: historyDestinationFor(record.destinationChain), ...(sourceHash ? { sourceTx: sourceHash } : {}), ...(destinationHash ? { destinationTx: destinationHash } : {}),
      ...(sourceHash && record.sourceChain === "solana" && /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(sourceHash) ? { signature: sourceHash } : {}),
      ...(record.receiptHash ? { receiptHash: record.receiptHash } : {}),
      ...(paid ? { fee: { collected: paid.collected, basisPoints: paid.basisPoints ?? null, amountRaw: paid.paidAmountRaw,
        decimals: paid.currency?.decimals ?? null, symbol: paid.currency?.symbol ?? null, usd: paid.paidUsd,
        asset: paid.currency?.address ?? null, providerRaw: paid.settlement?.providerRaw ?? null, ryntraRaw: paid.settlement?.ryntraRaw ?? null } } : {}), now: args.now });
    if (paid && lookup) await recordOperationRewards(store, { fee: crossSwapServiceFee(lookup, { symbol: record.fromSymbol, decimals: record.fromDecimals }),
      trader: wallet, settledAt, now: args.now, providerUsd: paid.paidUsd, env: args.env });
    if (row.ok) await recordOperationPoints(store, { action: row.action, settledAt, now: args.now, env: args.env });
    if (!paid || !row.ok || (paid.collected && (paid.paidAmountRaw === null || !paid.currency))) return false;
    await completeBenefitJob(store, job);
    return true;
  } catch { return false; }
}

export async function refreshCrossSwapBenefits(store: GuardStore, intentDigest: string, args: Readonly<{ now: string; settledAt?: string; env?: NodeJS.ProcessEnv }>) {
  const read = await readCrossSwapOrder({ store, intentDigest });
  if (!read.ok) return false;
  const record = read.record;
  if (record.state !== "COMPLETED" || record.provider !== "RELAY" || !record.quoteId) return true;
  const lookup = await fetchRelayIntentStatus(record.quoteId, { apiKey: resolveRelayApiKey(args.env ?? process.env) });
  return recordCrossSwapBenefits(store, record, lookup.found ? lookup : null, args);
}
