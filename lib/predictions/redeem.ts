/**
 * Collecting a resolved win on live money. Some venues pay a winning
 * position on their own; others (Polymarket, Limitless, Predict, Myriad)
 * pay only when asked. The person asks with one act on the positions the
 * provider marks `eligible`; Ryntra sends exactly those outcomes, keeps the
 * provider's answer as the receipt, and reads the position back — a
 * position is paid when the provider says `redeemed`, never because the
 * request was sent.
 *
 * Receipts live beside the orders in `predictionOrders`, keyed
 * `redeem:solana:mainnet:<wallet>:<redeemId>`. Server only.
 */

import type { GuardStore } from "../guard/store.ts";
import { failure } from "./failure.ts";
import { fundingEnabled } from "./funding.ts";
import type { PaperPosition } from "./model.ts";
import type { PredictionProvider, RedeemLeg, Result } from "./provider.ts";
import { withProviderSession } from "./session.ts";

export type RedeemReceipt = Readonly<{
  version: number;
  kind: "redeem";
  wallet: string;
  redeemId: string;
  /** What the person saw and asked for: each outcome with the value the provider marked on it. */
  asked: readonly Readonly<{ outcomeId: string; question: string; label: string; valueUsd: number }>[];
  legs: readonly RedeemLeg[];
  createdAt: string;
}>;

const PREFIX = "redeem:solana:mainnet:";
const MAX_OUTCOMES = 20;

function receipts(store: GuardStore) {
  return store.versioned<RedeemReceipt>("predictionOrders");
}

/**
 * The outcomes of live positions the provider says can be paid out now, with
 * what each is marked at. An outcome held on several venues is one line per
 * venue, each with its own share of the value — never the whole value twice.
 */
export function redeemable(positions: readonly PaperPosition[]): readonly Readonly<{ outcomeId: string; question: string; label: string; valueUsd: number }>[] {
  const out: { outcomeId: string; question: string; label: string; valueUsd: number }[] = [];
  for (const p of positions) {
    if (p.redeemStatus !== "eligible") continue;
    for (const o of p.outcomes) {
      if (o.winner !== true || o.totalSize <= 0) continue;
      const held = o.venues.reduce((sum, v) => sum + Math.max(v.size, 0), 0);
      for (const v of o.venues) out.push({ outcomeId: v.outcomeId, question: p.question, label: o.label, valueUsd: held > 0 ? (o.totalValue * Math.max(v.size, 0)) / held : o.totalValue / o.venues.length });
    }
  }
  return out;
}

export async function redeemPositions(store: GuardStore, provider: PredictionProvider, wallet: string, outcomeIds: readonly string[], env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<Result<RedeemReceipt>> {
  /* Like a withdrawal: a win already held is collected by its owner while money is on, listed for new money or not. */
  if (!fundingEnabled(env)) return failure("FUNDING_OFF", "Live money is not switched on here.");
  const wanted = [...new Set(outcomeIds)];
  if (wanted.length === 0 || wanted.length > MAX_OUTCOMES) return failure("VALIDATION_ERROR", `Name between 1 and ${MAX_OUTCOMES} outcomes.`);

  /* Only what the provider itself marks payable now — never an id the browser made up. */
  const read = await withProviderSession(store, provider, wallet, async (session) => {
    const [active, closed] = await Promise.all([provider.paperPositions(session, "active", "live"), provider.paperPositions(session, "closed", "live")]);
    if (!active.ok) return active;
    if (!closed.ok) return closed;
    return { ok: true as const, value: [...active.value, ...closed.value] };
  });
  if (!read.ok) return read;
  const payable = new Map(redeemable(read.value).map((r) => [r.outcomeId, r] as const));
  const missing = wanted.filter((id) => !payable.has(id));
  if (missing.length > 0) return failure("ORDER_REFUSED", "The provider does not mark these as payable now; reload the positions.");

  const sent = await withProviderSession(store, provider, wallet, (session) => provider.redeem(session, wanted));
  if (!sent.ok) return sent;
  const receipt: RedeemReceipt = {
    version: 1,
    kind: "redeem",
    wallet,
    redeemId: sent.value.redeemId,
    asked: wanted.map((id) => payable.get(id)!),
    legs: sent.value.legs,
    createdAt: now.toISOString(),
  };
  /* Keyed by the provider's id, or by the moment when it gave none; a receipt that could not be kept still leaves the provider's own record of the payout. */
  await receipts(store).insertIfAbsent(`${PREFIX}${wallet}:${receipt.redeemId || `local-${receipt.createdAt}`}`, receipt).catch(() => false);
  return { ok: true, value: receipt };
}

export async function listRedeemReceipts(store: GuardStore, wallet: string, limit = 20): Promise<readonly RedeemReceipt[]> {
  const rows = await receipts(store).valuesWithPrefix(`${PREFIX}${wallet}:`);
  return rows
    .filter((r) => r.kind === "redeem" && r.wallet === wallet)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}
