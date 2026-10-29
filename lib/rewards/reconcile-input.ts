import { InternalWalletSchema } from "../admin/internal-wallets.ts";
import type { GuardStore } from "../guard/store.ts";
import { rewardsActivation } from "./activation.ts";
import { RewardClaimSchema } from "./claim.ts";
import type { RewardEntry } from "./model.ts";
import { internalWalletsNamedBy } from "./internal.ts";
import type { ReconcileAccrual, ReconcileInput, ReconcileReceipt } from "./reconcile.ts";

type ActionRow = Readonly<{
  lane?: string;
  outcome?: string;
  network?: string;
  wallet: string;
  actionId: string;
  sourceTx?: string | null;
  startedAt?: string;
  updatedAt: string;
  origin?: Readonly<{ surface?: string }> | null;
  fee?: Readonly<{ collected?: boolean; amountRaw?: string | null; ryntraRaw?: string | null; usd?: number | null }> | null;
}>;

/**
 * Everything `reconcileRewards` needs, read from one whole store — for the script (`scripts/rewards/reconcile.mjs`)
 * and the stand, never for a person's page: it reads six collections whole, read only.
 *
 * Receipts: a swap's (`SWAP`, keyed by its signature) and a cross-chain swap's (`CROSS_SWAP`, keyed by its source
 * transaction — Relay's `operationRef` — and read only for the dollars Relay stated). Internal wallets: today's list;
 * a row of the admin's list that cannot be read stops the reading, as it stops money (`internal.ts`).
 */
export async function readReconcileInput(
  store: GuardStore,
  { env = process.env, network = "mainnet" }: Readonly<{ env?: Readonly<Record<string, string | undefined>>; network?: string }> = {},
): Promise<ReconcileInput> {
  const all = <T>(name: Parameters<GuardStore["collection"]>[0]) => store.collection<T>(name).valuesWithPrefix("");
  const [entries, accruals, claims, actions, jobs, listed] = await Promise.all([
    all<RewardEntry>("rewardEntries"), all<ReconcileAccrual>("rewardAccruals"), all<unknown>("rewardClaims"),
    all<ActionRow>("solanaWalletActions"), all<{ data?: { kind?: string; operationId?: unknown } }>("benefitJobs"), all<unknown>("adminInternalWallets"),
  ]);
  /* A Launch trade is a SWAP row too, but its fee (`METEORA_LAUNCH`) is not one Rewards shares: not a receipt here. */
  const ours = (action: ActionRow, lane: string) => action?.lane === lane && action.origin?.surface !== "LAUNCH" && action.network === network && !!action.fee;
  const done = (action: ActionRow, lane: string) => ours(action, lane) && action.outcome === "DONE";
  /* The receipt's moment is when the operation began — a later rewrite (a recover of an old swap) moves `updatedAt`,
     never `startedAt`, which is never after the settlement. */
  const at = (action: ActionRow) => action.startedAt ?? action.updatedAt;
  const usdOf = (action: ActionRow) => (typeof action.fee?.usd === "number" ? action.fee.usd : null);
  const receipts: ReconcileReceipt[] = [
    ...actions.filter((action) => done(action, "SWAP")).map((action) => ({
      operationRef: action.actionId, wallet: action.wallet, settledAt: at(action), collected: action.fee?.collected === true,
      grossRaw: action.fee?.amountRaw ?? null, ryntraRaw: action.fee?.ryntraRaw ?? null, usd: usdOf(action),
    })),
    ...actions.filter((action) => done(action, "CROSS_SWAP") && action.sourceTx).map((action) => ({
      operationRef: action.sourceTx!, wallet: action.wallet, settledAt: at(action), collected: action.fee?.collected === true,
      grossRaw: action.fee?.amountRaw ?? null, ryntraRaw: action.fee?.ryntraRaw ?? null, usd: usdOf(action), statedOnly: true,
    })),
  ];
  /* A finished operation whose row is still being written (`IN_FLIGHT` until the schedule completes it). */
  const unfinished = new Set(actions.filter((action) => (action?.lane === "SWAP" || action?.lane === "CROSS_SWAP") && action.network === network && action.outcome === "IN_FLIGHT").flatMap((action) => [action.actionId, ...(action.sourceTx ? [action.sourceTx] : [])]));
  const queued = new Set(jobs.flatMap((job) => (job?.data?.kind === "REWARDS" && typeof job.data.operationId === "string" ? [job.data.operationId.slice(job.data.operationId.indexOf(":") + 1)] : [])));
  const named = internalWalletsNamedBy(env);
  if (!named) throw new Error("RYNTRA_INTERNAL_WALLETS has an entry that is not an address.");
  const internal = new Set(named);
  for (const row of listed) internal.add(InternalWalletSchema.parse(row).wallet);
  const activation = rewardsActivation(env as NodeJS.ProcessEnv);
  return {
    entries,
    accruals,
    claims: claims.map((claim) => RewardClaimSchema.parse(claim)),
    receipts,
    queued,
    unfinished,
    activationAt: activation.state === "OPEN" ? activation.at : null,
    internal,
  };
}
