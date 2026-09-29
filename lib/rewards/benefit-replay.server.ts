import type { GuardStore } from "../guard/store.ts";
import { recordOperationPoints } from "../points/record.server.ts";
import { drainBenefitJobs } from "./benefit-jobs.ts";
import { recordOperationRewards } from "./record.server.ts";
import { solanaWalletActionKey, SolanaWalletActionSchema } from "../solana/action-ledger.ts";
import { refreshCrossSwapBenefits } from "./cross-swap-settlement.server.ts";

export function replayBenefitJobs(store: GuardStore, args: Readonly<{ wallet?: string; limit?: number; budgetMs?: number; now?: string; env?: NodeJS.ProcessEnv }> = {}) {
  const now = args.now ?? new Date().toISOString();
  return drainBenefitJobs(store, { ...args, now, process: async job => {
    if (job.kind === "CROSS_SWAP") return refreshCrossSwapBenefits(store, job.operationId, { now, settledAt: job.settledAt, env: args.env });
    if (job.kind === "REWARDS") {
      const result = await recordOperationRewards(store, { fee: job.fee, trader: job.wallet, settledAt: job.settledAt,
        providerUsd: job.providerUsd, price: job.price, now, env: args.env, jobReplay: true });
      return result.state === "RECORDED" ? result.pending !== true : result.retryable === false;
    }
    const latest = SolanaWalletActionSchema.safeParse(await store.collection("solanaWalletActions").get(solanaWalletActionKey({ network: job.action.network, wallet: job.wallet, actionId: job.action.actionId })));
    const action = latest.success && latest.data.wallet === job.wallet && latest.data.actionId === job.action.actionId ? latest.data : job.action;
    const result = await recordOperationPoints(store, { action, settledAt: job.settledAt, statedUsd: job.statedUsd, now, env: args.env, jobReplay: true });
    return result.state === "RECORDED" ? result.pending !== true : result.retryable === false;
  } });
}
