import { withBoundedCasRetry, type GuardStore, type GuardAtomicVersionedWrite } from "../guard/store.ts";
import { readClaim, RewardClaimSchema, type RewardClaim } from "./claim.ts";
import { claimEntry } from "./ledger.ts";
import { rewardEntryKey, RewardEntrySchema } from "./model.ts";
import { consumeReserve, releaseReserve } from "./reserve.ts";

export type ClaimSignatureStatus = Readonly<{ seen: boolean; confirmationStatus?: string | null; err?: unknown }>;
export type ClaimReconciliation = Readonly<{ stillOpen: boolean; state: string }>;

/** Reads evidence and settles the ledger. This module cannot build or send. */
export async function reconcileRewardClaim(store: GuardStore, claim: RewardClaim, deps: Readonly<{
  now: string;
  readStatus: (signature: string) => Promise<ClaimSignatureStatus | null>;
  blockhashValid?: (blockhash: string) => Promise<boolean | null>;
}>): Promise<ClaimReconciliation> {
  const pending = { stillOpen: true, state: claim.state };
  try {
    if (claim.state === "PAID") { await consumeReserve(store, claim.claimId, deps.now); return { stillOpen: false, state: "PAID" }; }
    if (claim.state === "FAILED") { await releaseReserve(store, claim.claimId, deps.now); return { stillOpen: false, state: "FAILED" }; }
    let outcome: "PAID" | "FAILED" | null = null;
    const confirmed = (status: ClaimSignatureStatus | null) => status?.seen
      && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
    if (!claim.signature) {
      // Old claims did not persist before broadcast. Their missing signature
      // cannot prove non-execution, however long ago they were opened.
      if (claim.protocolVersion !== 2 || claim.state !== "CLAIMING" || !claim.preparationExpiresAt
        || Date.parse(deps.now) < Date.parse(claim.preparationExpiresAt)) return pending;
      outcome = "FAILED";
    } else {
      let status = await deps.readStatus(claim.signature);
      if (!status) return pending;
      if (!status.seen && claim.blockhash && deps.blockhashValid && await deps.blockhashValid(claim.blockhash) === false) {
        // A status read made before expiry cannot close an unknown payout.
        status = await deps.readStatus(claim.signature);
        if (!status) return pending;
        if (!status.seen) outcome = "FAILED";
      }
      if (confirmed(status)) {
        if (status.err === null) outcome = "PAID";
        else if (status.err !== undefined) outcome = "FAILED";
      }
      if (!outcome) return pending;
    }

    const settled = await withBoundedCasRetry<ClaimReconciliation>(async () => {
      const current = await readClaim(store, claim.wallet);
      if (!current || current.claimId !== claim.claimId) return pending;
      if (current.state === "PAID" || current.state === "FAILED") return { stillOpen: false, state: current.state };
      if (current.signature !== claim.signature || current.state !== claim.state) return pending;
      const next = RewardClaimSchema.parse({ ...current, state: outcome, resolvedAt: deps.now, version: current.version + 1 });
      const writes: GuardAtomicVersionedWrite[] = [{ collection: "rewardClaims", key: claim.wallet, expectedVersion: current.version, next }];
      if (outcome === "PAID") {
        const entry = RewardEntrySchema.parse({ ...claimEntry({ wallet: claim.wallet, claimId: claim.claimId,
          usdMicros: BigInt(claim.usdMicros), signature: claim.signature, now: deps.now }), version: 0 });
        const key = rewardEntryKey({ recipient: claim.wallet, type: "CLAIM", ref: claim.claimId });
        const prior = await store.collection("rewardEntries").get(key);
        if (prior) {
          const existing = RewardEntrySchema.parse(prior);
          if (existing.usdMicros !== entry.usdMicros || existing.signature !== entry.signature) return pending;
        } else writes.push({ collection: "rewardEntries", key, expectedVersion: null, next: { ...entry, version: 0 } });
      }
      return await store.compareAndSetMany(writes) ? { stillOpen: false, state: outcome! } : false;
    });
    if (!settled.stillOpen) {
      if (settled.state === "PAID") await consumeReserve(store, claim.claimId, deps.now);
      else await releaseReserve(store, claim.claimId, deps.now);
    }
    return settled;
  } catch { return pending; }
}
