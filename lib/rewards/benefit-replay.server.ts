import type { GuardStore } from "../guard/store.ts";
import { recordOperationPoints } from "../points/record.server.ts";
import { drainBenefitJobs } from "./benefit-jobs.ts";
import { recordOperationRewards } from "./record.server.ts";
import { solanaWalletActionKey, SolanaWalletActionSchema } from "../solana/action-ledger.ts";
import { refreshCrossSwapBenefits } from "./cross-swap-settlement.server.ts";
import { checkFirstTen, type FirstTenCheckDeps } from "./first-ten.ts";
import { firstTenCheckDeps } from "./first-ten-deps.server.ts";
import { checkReferralPair, type ReferralCheckDeps } from "../growth/referral-guard-store.ts";
import { referralCheckDeps } from "../growth/referral-guard-deps.server.ts";

export function replayBenefitJobs(store: GuardStore, args: Readonly<{ wallet?: string; limit?: number; budgetMs?: number; now?: string; env?: NodeJS.ProcessEnv; firstTen?: FirstTenCheckDeps | null; referral?: ReferralCheckDeps | null; exclude?: readonly ("REWARDS" | "POINTS" | "CROSS_SWAP" | "FIRST_TEN_CHECK" | "REFERRAL_CHECK")[] }> = {}) {
  const now = args.now ?? new Date().toISOString();
  return drainBenefitJobs(store, { ...args, now, process: async job => {
    /* Done once the check decided, or once there is no window to check; a read that did not answer waits. */
    if (job.kind === "FIRST_TEN_CHECK") {
      const outcome = await checkFirstTen(store, job.wallet, args.firstTen !== undefined ? args.firstTen : firstTenCheckDeps(args.env ?? process.env), now);
      return outcome.state !== "WAITING";
    }
    /* The pair check of a friend's trade: done once it decided; a read that did not answer waits. */
    if (job.kind === "REFERRAL_CHECK") {
      const outcome = await checkReferralPair(store, args.referral !== undefined ? args.referral : referralCheckDeps(store, args.env ?? process.env), { inviter: job.operationId, trader: job.wallet, now });
      return outcome.state !== "WAITING";
    }
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
