/**
 * One action, four projections (EXE-2; spec §3.3).
 *
 * The canonical record is the ledger's; a surface draws a projection of it and keeps nothing of its own. Each
 * projection carries the same core — `actionId`, `actionDigest`, `policyVersion`, the signer, the signatures, the
 * effects the chain showed and the reconciliation — and adds only what its reader needs:
 *
 * - **trade** — what a trader's History shows: the venue, what was spent, the state;
 * - **team spend** — a team's budget line: the budget, what was reserved and spent of it (null outside a team);
 * - **agent action** — Agent Control's act under a mandate (null for an action no agent or bot made);
 * - **SDK receipt** — the Outcome Receipt that proves it, with the ledger's verdict (null until one is verified).
 *
 * ## The lanes that exist today
 *
 * Swap (and Spot, and a launch's trades — lane `SWAP` with origin `LAUNCH`), Send, the bridges and a payment received
 * through `/pay` (lane `RECEIVE`) each write a History row (`solanaWalletActions`). Their `actionId` here is a
 * function of the row's own key (`adoptedActionId`) — the History row, its receipt and the ledger name one action
 * without any of them storing another's id. With `RYNTRA_ACTION_LEDGER=adopt` the History writer also records each row
 * here (`adoptHistoryRow`), after the row is written and without being able to fail it; off by default, so the money
 * paths write exactly what they wrote before. The paths that are not rows yet — a launch's creation, the payer's side
 * of `/pay`, the treasury's builds — stay EXE-3's (card `docs/solana/EXE-2-ACTION-LEDGER.md`).
 */

import type { GuardStore } from "../../guard/store.ts";
import { adoptAction, type LedgerResult } from "./ledger.ts";
import { adoptedActionId, WRAPPED_SOL_MINT, type ActionCluster, type ActionEvent, type ActionIntent, type Amount, type ObservedDelta } from "./model.ts";
import { hashCanonical } from "../../guard/canonical.ts";

/* ------------------------------------------------------------- projections */

export type ActionCore = Readonly<{
  actionId: string;
  actionDigest: string;
  authorityId: string;
  cluster: ActionCluster;
  policyVersion: string | null;
  signerRef: string | null;
  txSignatures: readonly string[];
  actualEffects: readonly ObservedDelta[];
  reconciliation: Readonly<{ status: ActionIntent["status"]; receiptVerified: boolean; spentRaw: string | null; overspentRaw: string | null }>;
}>;

export type ActionProjections = Readonly<{
  core: ActionCore;
  trade: Readonly<{ actionId: string; venue: string; spend: Amount | null; recipient: string | null; status: ActionIntent["status"]; at: string }>;
  teamSpend: Readonly<{ actionId: string; orgId: string; budgetId: string | null; reservedRaw: string | null; spentRaw: string | null; mint: string | null }> | null;
  agentAction: Readonly<{ actionId: string; actorKind: "AGENT" | "BOT"; actorId: string; mandateId: string | null; policyVersion: string | null; mode: ActionIntent["mode"] }> | null;
  sdkReceipt: Readonly<{ actionId: string; receiptId: string; contentHash: string; transactionHash: string; verified: true }> | null;
}>;

export function projectAction(action: ActionIntent, events: readonly ActionEvent[]): ActionProjections {
  const last = <T extends ActionEvent["type"]>(...types: T[]) => [...events].reverse().find((event) => (types as string[]).includes(event.type)) ?? null;
  const handoff = last("HANDOFF_ISSUED");
  const settled = last("OBSERVED", "FAILED", "OVERSPEND_DETECTED");
  const spentRaw = !settled ? null : settled.type === "OVERSPEND_DETECTED" ? action.reservation?.amountRaw ?? action.spend?.amountRaw ?? null : settled.amountRaw;
  const core: ActionCore = Object.freeze({
    actionId: action.actionId,
    actionDigest: action.actionDigest,
    authorityId: action.authorityId,
    cluster: action.cluster,
    policyVersion: action.policyVersion,
    signerRef: handoff?.signerRef ?? null,
    txSignatures: action.signatures,
    actualEffects: settled?.observedDeltas ?? [],
    reconciliation: Object.freeze({
      status: action.status,
      receiptVerified: action.status === "RECONCILED" && action.receipt !== null,
      spentRaw,
      overspentRaw: settled?.type === "OVERSPEND_DETECTED" ? settled.amountRaw : settled ? "0" : null,
    }),
  });
  return Object.freeze({
    core,
    trade: Object.freeze({ actionId: action.actionId, venue: action.venue, spend: action.spend, recipient: action.recipient, status: action.status, at: action.updatedAt }),
    teamSpend: action.orgId === null
      ? null
      : Object.freeze({
          actionId: action.actionId,
          orgId: action.orgId,
          budgetId: action.reservation?.budgetId ?? null,
          reservedRaw: action.reservation?.amountRaw ?? null,
          spentRaw,
          mint: action.spend?.mint ?? null,
        }),
    agentAction: action.actor.kind === "AGENT" || action.actor.kind === "BOT"
      ? Object.freeze({ actionId: action.actionId, actorKind: action.actor.kind, actorId: action.actor.id, mandateId: action.mandateId, policyVersion: action.policyVersion, mode: action.mode })
      : null,
    sdkReceipt: action.status === "RECONCILED" && action.receipt
      ? Object.freeze({ actionId: action.actionId, ...action.receipt, verified: true as const })
      : null,
  });
}

/* ---------------------------------------------------------- History rows */

/**
 * The fields of a History row (`lib/solana/action-ledger.ts`) this module reads — named here rather than imported,
 * so the History writer can call in without a cycle.
 */
export type HistoryRowLike = Readonly<{
  network: "mainnet" | "devnet";
  wallet: string;
  actionId: string;
  lane: "SEND" | "SWAP" | "BRIDGE" | "RECEIVE" | "CROSS_SWAP";
  outcome: "IN_FLIGHT" | "DONE" | "FAILED" | "NEEDS_YOU";
  out: Readonly<{ mint: string | null; amountRaw: string; decimals: number | null }> | null;
  signature: string | null;
  origin: Readonly<{ surface: string }> | null;
  updatedAt: string;
}>;

/** The authority matrix row (EXE-1) a History lane acts under. */
export function authorityOfHistoryRow(row: Pick<HistoryRowLike, "lane" | "origin">): string {
  switch (row.lane) {
    case "SEND":
      return "solana.send";
    case "RECEIVE":
      return "solana-pay.pay";
    case "BRIDGE":
      return "circle-cctp.bridge";
    case "CROSS_SWAP":
      return "relay.cross-swap";
    case "SWAP":
      return row.origin?.surface === "LAUNCH" ? "meteora-dbc.trade" : "jupiter.swap";
  }
}

const VENUE_OF: Readonly<Record<string, string>> = {
  "solana.send": "solana",
  "solana-pay.pay": "solana-pay",
  "circle-cctp.bridge": "circle-cctp",
  "relay.cross-swap": "relay",
  "meteora-dbc.trade": "meteora-dbc",
  "jupiter.swap": "jupiter",
};

/** The `actionId` of a History row — the same whoever computes it, written or not. */
export function actionIdOfHistoryRow(row: Pick<HistoryRowLike, "network" | "lane" | "wallet" | "actionId">): string {
  return adoptedActionId({ cluster: row.network, lane: row.lane, wallet: row.wallet, legacyId: row.actionId });
}

const STATUS_OF: Readonly<Record<HistoryRowLike["outcome"], "SUBMITTED" | "OBSERVED" | "FAILED" | "RECOVERY">> = {
  IN_FLIGHT: "SUBMITTED",
  DONE: "OBSERVED",
  FAILED: "FAILED",
  NEEDS_YOU: "RECOVERY",
};

/** Record a History row in the ledger as an adopted, person-signed action. Never throws. */
export async function adoptHistoryRow(store: GuardStore, row: HistoryRowLike): Promise<LedgerResult> {
  const authorityId = authorityOfHistoryRow(row);
  const out = row.out;
  const spend: Amount | null = out && out.decimals !== null && out.amountRaw !== "0"
    ? { mint: out.mint ?? WRAPPED_SOL_MINT, decimals: out.decimals, amountRaw: out.amountRaw }
    : null;
  try {
    return await adoptAction(store, {
      actionId: actionIdOfHistoryRow(row),
      cluster: row.network,
      authorityId,
      actor: { kind: "PERSON", id: row.wallet },
      venue: VENUE_OF[authorityId],
      spend,
      idempotencyKey: `adopt-${hashCanonical({ network: row.network, lane: row.lane, wallet: row.wallet, legacyId: row.actionId }).slice(2, 42)}`,
      status: STATUS_OF[row.outcome],
      signature: row.signature,
      /* A payment received is the payer's transaction: the recipient's row does not claim its signature. */
      claimSignature: row.lane !== "RECEIVE",
      projection: { kind: "HISTORY_ROW", key: `solana:${row.network}:${row.wallet}:${row.actionId}`.slice(0, 256) },
      observer: "history",
      now: row.updatedAt,
    });
  } catch (failure) {
    return { ok: false, code: "LEDGER_UNAVAILABLE", reasons: [failure instanceof Error ? failure.message.slice(0, 200) : "UNKNOWN"], retryable: true, action: null, event: null };
  }
}
