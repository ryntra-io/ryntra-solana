/**
 * Settle the rows the ledger left open — from the lane's own durable evidence,
 * never from a guess. Server only.
 *
 * The history row of a swap is written twice: once as `IN_FLIGHT` before the
 * bytes go out, once as `DONE` after the receipt. When the second write does
 * not land — the request died after the receipt, the store refused the
 * compare-and-set, the tab closed — the row stays *in flight* although the
 * lane finished. Two such rows existed on production on 2026-09-16: one swap
 * finalized and receipted on 2026-09-09 whose `DONE` write never arrived, and
 * one attempt of 2026-09-11 that expired after submission and was already read
 * as *Did not happen* by History, which overlays the lane's state at read
 * time. The ledger itself said neither.
 *
 * This module writes the lane's answer into the row, so the ledger — the one
 * source the statistics read — says what History already knew:
 *
 * - a swap whose owner lock is `RECEIPTED` has its receipt and its signed
 *   bundle in the settled archive; the row becomes `DONE` with the legs the
 *   receipt observed, the fee the receipt settled, the origin the bundle
 *   carried and the provider's request id;
 * - a swap whose lock or send attempt is expired or failed becomes `FAILED`;
 * - anything else — a lane still open, an archive that cannot be found, a
 *   record that will not parse — is left exactly as it is and reported, so
 *   an operator sees the row rather than a state somebody invented for it.
 *
 * It changes the state of rows that already exist; it never creates one and
 * never counts anything twice: the key is the lane and the action id, and a
 * row settled here is the same row a settlement route would have written.
 */

import { OutcomeReceiptArtifactSchema } from "../agent-control/artifacts.ts";
import type { GuardStore } from "../guard/store.ts";
import {
  actionFeeFromServiceFee,
  recordSolanaAction,
  sendOutcome,
  SolanaWalletActionSchema,
  swapOutcome,
  type SolanaWalletAction,
} from "./action-ledger.ts";
import { isLaunchOrigin, SolanaActionOriginSchema, type SolanaActionOrigin } from "./action-origin.ts";
import { statedUsdOf } from "./action-value.ts";
import { readSendAttempt } from "./send-attempt.ts";
import { readSwapOwnerRecovery } from "./swap-owner-lock.ts";
import { parseSwapReceiptFactsFromEffects } from "./swap-receipt.ts";

/** What only the bundle carries, read field by field so an older bundle still answers. */
function lenientBundle(bundle: unknown): Readonly<{ origin: SolanaActionOrigin | null; inUsdValue: string | null }> {
  const raw = (bundle && typeof bundle === "object" ? bundle : {}) as { origin?: unknown; review?: { quote?: { inUsdValue?: unknown } } };
  const origin = SolanaActionOriginSchema.safeParse(raw.origin);
  const inUsdValue = raw.review?.quote?.inUsdValue;
  return { origin: origin.success ? origin.data : null, inUsdValue: typeof inUsdValue === "string" ? inUsdValue : null };
}

/** A row younger than this is a swap that may still be settling; it is not touched. */
export const RECONCILE_MIN_AGE_MS = 5 * 60_000;

/** The later of two moments — a row never moves backwards past its own last write. */
function latest(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export type ReconcileDecision = Readonly<{
  key: string;
  lane: SolanaWalletAction["lane"];
  wallet: string;
  actionId: string;
  before: SolanaWalletAction["outcome"];
  /** The outcome the evidence names, or null when nothing durable names one. */
  after: SolanaWalletAction["outcome"] | null;
  /** Where the answer came from, or why there is none — for a log or an operator, never a screen. */
  evidence: string;
  /** True when the row was written (apply mode and the write succeeded). */
  applied: boolean;
}>;

export type ReconcileReport = Readonly<{
  examined: number;
  decisions: readonly ReconcileDecision[];
  /** Confirmed swap rows written before the provider's request id existed on the row, filled in from the archived lock. */
  enriched: readonly Readonly<{ key: string; providerRef: string; applied: boolean }>[];
}>;

type Evidence = Readonly<{ after: SolanaWalletAction["outcome"] | null; evidence: string; write?: Parameters<typeof recordSolanaAction>[1] }>;

/** The swap lane: the owner lock (live or archived) is the durable truth, the send attempt the fallback. */
async function swapEvidence(store: GuardStore, row: SolanaWalletAction): Promise<Evidence> {
  if (!row.signature) return { after: null, evidence: "no signature on the row" };
  const lock = await readSwapOwnerRecovery({ store, owner: row.wallet, signature: row.signature });
  if (lock.ok) {
    const outcome = swapOutcome(lock.record.state);
    if (outcome === "DONE") {
      const receipt = OutcomeReceiptArtifactSchema.safeParse(lock.record.receipt);
      const facts = receipt.success ? parseSwapReceiptFactsFromEffects(receipt.data.outcome.observedEffects) : null;
      if (!receipt.success || !facts) {
        return { after: null, evidence: `lock ${lock.record.state} but its receipt cannot be read` };
      }
      const observation = facts.independentObservation;
      if (observation.signature !== row.signature) {
        return { after: null, evidence: "the archived receipt observed a different signature" };
      }
      /* The receipt's facts are the source of the legs and the fee. The bundle
         is read leniently for what only it carries — the origin and the
         provider's dollar figure — because a bundle written before the fee
         model changed (the 2026-09-09 swap) no longer parses whole, and a
         swap whose receipt verifies must not stay open over a field the
         receipt never needed. */
      const bundle = lenientBundle(lock.record.bundle);
      const fee = actionFeeFromServiceFee(facts.fees.serviceFee);
      /* The row's moment is the settlement's, not this write's: a swap that
         confirmed on the 9th is not an operation of the day it was noticed. */
      return {
        after: "DONE",
        evidence: `owner lock RECEIPTED, receipt ${receipt.data.contentHash.slice(0, 10)}… observed at ${observation.observedAt}`,
        write: {
          network: row.network,
          wallet: row.wallet,
          actionId: row.actionId,
          lane: "SWAP",
          outcome: "DONE",
          out: { mint: facts.quote.inputMint, amountRaw: observation.actualInputRaw, decimals: null, symbol: null },
          in: { mint: facts.quote.outputMint, amountRaw: observation.actualOutputRaw, decimals: null, symbol: null },
          signature: row.signature,
          receiptHash: receipt.data.contentHash,
          ...(fee ? { fee } : {}),
          origin: bundle.origin,
          providerRef: lock.record.requestId,
          statedUsd: statedUsdOf(bundle.inUsdValue, facts.quote.inputRaw, observation.actualInputRaw),
          now: latest(observation.observedAt, row.updatedAt),
        },
      };
    }
    if (outcome === "FAILED") {
      return {
        after: "FAILED",
        evidence: `owner lock ${lock.record.state} at ${lock.record.updatedAt}`,
        write: { network: row.network, wallet: row.wallet, actionId: row.actionId, lane: "SWAP", outcome: "FAILED", providerRef: lock.record.requestId, now: latest(lock.record.updatedAt, row.updatedAt) },
      };
    }
    return { after: null, evidence: `owner lock still ${lock.record.state}` };
  }
  const attempt = await readSendAttempt({ store, network: row.network, signature: row.signature });
  if (!attempt.ok) return { after: null, evidence: `no owner lock (${lock.code}) and no send attempt (${attempt.code})` };
  const outcome = sendOutcome(attempt.record.state);
  if (outcome === "FAILED") {
    return {
      after: "FAILED",
      evidence: `send attempt ${attempt.record.state} at ${attempt.record.updatedAt}, no owner lock (${lock.code})`,
      write: { network: row.network, wallet: row.wallet, actionId: row.actionId, lane: "SWAP", outcome: "FAILED", now: latest(attempt.record.updatedAt, row.updatedAt) },
    };
  }
  /* A receipted attempt without its archived lock has no legs to write; the
     row is reported rather than marked done with nothing in it. */
  return { after: null, evidence: `send attempt ${attempt.record.state}, no owner lock (${lock.code})` };
}

/** The send lane: the attempt record alone decides, and only its terminal states. */
async function sendEvidence(store: GuardStore, row: SolanaWalletAction): Promise<Evidence> {
  if (!row.signature) return { after: null, evidence: "no signature on the row" };
  const attempt = await readSendAttempt({ store, network: row.network, signature: row.signature });
  if (!attempt.ok) return { after: null, evidence: `no send attempt (${attempt.code})` };
  const outcome = sendOutcome(attempt.record.state);
  if (outcome === "DONE" || outcome === "FAILED") {
    return {
      after: outcome,
      evidence: `send attempt ${attempt.record.state} at ${attempt.record.updatedAt}`,
      write: { network: row.network, wallet: row.wallet, actionId: row.actionId, lane: "SEND", outcome, now: latest(attempt.record.updatedAt, row.updatedAt) },
    };
  }
  return { after: null, evidence: `send attempt still ${attempt.record.state}` };
}

/**
 * Examine every mainnet row still in flight and older than the minimum age;
 * write the lane's terminal answer into it when `apply` is set.
 */
export async function reconcileSolanaWalletActions(
  store: GuardStore,
  deps: Readonly<{ apply: boolean; now?: () => Date; minAgeMs?: number; limit?: number }>,
): Promise<ReconcileReport> {
  const now = (deps.now ?? (() => new Date()))();
  const minAge = deps.minAgeMs ?? RECONCILE_MIN_AGE_MS;
  const limit = deps.limit ?? 50;
  const raw = await store.collection<unknown>("solanaWalletActions").valuesWithPrefix("solana:mainnet:");
  const open: SolanaWalletAction[] = [];
  const unnamed: SolanaWalletAction[] = [];
  for (const candidate of raw) {
    const parsed = SolanaWalletActionSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const row = parsed.data;
    /* A launch's trade has no provider id and no swap lock: its own reconciliation settles it (`lib/launch/record.server.ts`). */
    if (isLaunchOrigin(row.origin)) continue;
    if (row.lane === "SWAP" && row.outcome === "DONE" && row.providerRef === null && row.signature) unnamed.push(row);
    if (row.outcome !== "IN_FLIGHT") continue;
    if (now.getTime() - Date.parse(row.updatedAt) < minAge) continue;
    open.push(row);
  }
  open.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const decisions: ReconcileDecision[] = [];
  for (const row of open.slice(0, limit)) {
    const key = `${row.lane}:${row.actionId}`;
    let evidence: Evidence;
    try {
      evidence =
        row.lane === "SWAP"
          ? await swapEvidence(store, row)
          : row.lane === "SEND"
            ? await sendEvidence(store, row)
            : { after: null, evidence: `${row.lane} rows settle through their own status route` };
    } catch (failure) {
      evidence = { after: null, evidence: `evidence unreadable: ${failure instanceof Error ? failure.message : String(failure)}` };
    }
    let applied = false;
    if (deps.apply && evidence.write) {
      const wrote = await recordSolanaAction(store, evidence.write);
      applied = wrote.ok;
      if (!wrote.ok) evidence = { ...evidence, evidence: `${evidence.evidence}; write refused: ${wrote.reason}` };
    }
    decisions.push({ key, lane: row.lane, wallet: row.wallet, actionId: row.actionId, before: row.outcome, after: evidence.after, evidence: evidence.evidence, applied });
  }
  /* Rows confirmed before the provider's request id lived on the row take it
     from the archived lock, so the admin can match every swap to Jupiter's
     own record without opening the archive. The row's moment is untouched. */
  const enriched: Array<{ key: string; providerRef: string; applied: boolean }> = [];
  for (const row of unnamed.slice(0, limit)) {
    try {
      const lock = await readSwapOwnerRecovery({ store, owner: row.wallet, signature: row.signature! });
      if (!lock.ok) continue;
      let applied = false;
      if (deps.apply) {
        const wrote = await recordSolanaAction(store, { network: row.network, wallet: row.wallet, actionId: row.actionId, lane: "SWAP", outcome: "DONE", providerRef: lock.record.requestId, now: row.updatedAt });
        applied = wrote.ok;
      }
      enriched.push({ key: `${row.lane}:${row.actionId}`, providerRef: lock.record.requestId, applied });
    } catch {
      /* An archive that cannot be read leaves the row as it is. */
    }
  }
  return { examined: open.length, decisions, enriched };
}
