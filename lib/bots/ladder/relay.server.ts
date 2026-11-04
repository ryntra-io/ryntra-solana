/**
 * The ladder's relay on devnet: the person's signed transactions, checked and
 * forwarded — nothing more.
 *
 * It does not sign, and it holds nothing that could: no keypair, no secret, no
 * signer module. Each transaction must already carry every signature it needs —
 * the person's wallet, and on a placement the order account's own, which the
 * browser added after the wallet — and each must be real over the exact message
 * (`signedByAll`). The limits lane's reading decides what a ladder transaction
 * may hold (`inspectDlmmTransaction`: the wallet pays; only the order and the
 * wallet's own housekeeping; the order names the wallet as owner, payer and
 * sender; a cancellation returns the money to the wallet). On top of that a
 * placement must sit in a pool the deployment lists, as one order of at most
 * 50 non-empty bins whose account signed and is not the wallet.
 *
 * Every transaction of a bundle is checked before the first is sent: a bundle
 * with one bad transaction sends nothing. Once sent, each lands or not on its
 * own — the answer says which, and the window shows a partly placed ladder as
 * «not finished — finish or cancel».
 */

import type { Connection } from "@solana/web3.js";

import { inspectDlmmTransaction, signedByAll } from "../../solana/limits/dlmm-tx.ts";
import { DLMM_LIMIT_MAX_BINS } from "../../solana/limits/model.ts";
import { ladderConnection, onDevnet } from "./connection.server.ts";
import { readLadderTransaction } from "./tx.ts";

export type RelayKind = "place" | "cancel";

export type RelayItem = Readonly<{ wireBase64: string; limitOrder: string }>;

export type RelayCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; index: number; code: string; reason: string }>;

/** Check one bundle against the rules above, without sending anything. */
export function checkLadderBundle(
  args: Readonly<{ owner: string; kind: RelayKind; items: readonly RelayItem[]; pools: readonly string[] }>,
): RelayCheck {
  if (args.items.length === 0 || args.items.length > 8) return { ok: false, index: -1, code: "VALIDATION_ERROR", reason: "One to eight transactions." };
  if (new Set(args.items.map((item) => item.limitOrder)).size !== args.items.length) return { ok: false, index: -1, code: "VALIDATION_ERROR", reason: "Each transaction is its own order." };
  for (const [index, item] of args.items.entries()) {
    const read = inspectDlmmTransaction(item.wireBase64, { owner: args.owner, kind: args.kind, limitOrder: item.limitOrder, pool: null });
    if (!read.ok) return { ok: false, index, code: "SIGNED_MISMATCH", reason: read.reason };
    if (!signedByAll(item.wireBase64)) return { ok: false, index, code: "NOT_SIGNED", reason: "A signature is missing or does not match." };
    if (args.kind === "cancel") continue;
    if (!read.pool || !args.pools.includes(read.pool)) return { ok: false, index, code: "POOL_NOT_LISTED", reason: "The order sits in a pool not open to ladders." };
    const tx = readLadderTransaction(item.wireBase64);
    const order = tx?.orders.length === 1 ? tx.orders[0]! : null;
    if (!tx || !order) return { ok: false, index, code: "SIGNED_MISMATCH", reason: "Not exactly one order." };
    if (order.owner !== args.owner || order.limitOrder !== item.limitOrder || tx.feePayer !== args.owner) return { ok: false, index, code: "SIGNED_MISMATCH", reason: "The order is not this wallet's." };
    if (!tx.signers.includes(item.limitOrder) || item.limitOrder === args.owner) return { ok: false, index, code: "SIGNED_MISMATCH", reason: "The order account is not a signer of its own." };
    if (order.data.relativeBin !== null || order.data.bins.length === 0 || order.data.bins.length > DLMM_LIMIT_MAX_BINS || order.data.bins.some((bin) => bin.amount <= 0n)) {
      return { ok: false, index, code: "SIGNED_MISMATCH", reason: "The order's bins are not a ladder's." };
    }
  }
  return { ok: true };
}

export type RelayLeg = Readonly<{
  limitOrder: string;
  signature: string | null;
  /** `confirmed` — on chain; `sent` — accepted, not yet seen confirmed; `failed` — refused or lost. */
  state: "confirmed" | "sent" | "failed";
  reason: string | null;
}>;

const CONFIRM_MS = 25_000;
const POLL_MS = 1_500;

function fromBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

/**
 * Check, then forward each signed transaction to devnet in order and watch for its confirmation. Returns one line per
 * transaction; a refused bundle forwards none.
 */
export async function relayLadder(
  args: Readonly<{ owner: string; kind: RelayKind; items: readonly RelayItem[]; pools: readonly string[] }>,
  deps: Readonly<{ connection?: Pick<Connection, "getGenesisHash" | "sendRawTransaction" | "getSignatureStatuses">; sleep?: (ms: number) => Promise<void>; now?: () => number }> = {},
): Promise<Readonly<{ ok: true; legs: readonly RelayLeg[] }> | Readonly<{ ok: false; code: string; reason: string; index: number }>> {
  const checked = checkLadderBundle(args);
  if (!checked.ok) return checked;
  const connection = deps.connection ?? ladderConnection();
  /* The chain says which network it is: a wrong endpoint never receives the person's transactions. */
  if (!(await onDevnet(connection))) return { ok: false, code: "NOT_DEVNET", reason: "The endpoint does not serve devnet.", index: -1 };
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = deps.now ?? Date.now;
  const legs: { limitOrder: string; signature: string | null; state: RelayLeg["state"]; reason: string | null }[] = [];
  for (const item of args.items) {
    try {
      const signature = await connection.sendRawTransaction(fromBase64(item.wireBase64), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
      legs.push({ limitOrder: item.limitOrder, signature, state: "sent", reason: null });
    } catch (failure) {
      legs.push({ limitOrder: item.limitOrder, signature: null, state: "failed", reason: failure instanceof Error ? failure.message.slice(0, 300) : "Refused." });
    }
  }
  const until = now() + CONFIRM_MS;
  while (legs.some((leg) => leg.state === "sent") && now() < until) {
    await sleep(POLL_MS);
    const waiting = legs.filter((leg) => leg.state === "sent");
    const statuses = await connection.getSignatureStatuses(waiting.map((leg) => leg.signature!)).catch(() => null);
    statuses?.value.forEach((status, index) => {
      const leg = waiting[index]!;
      if (!status) return;
      if (status.err) {
        leg.state = "failed";
        leg.reason = JSON.stringify(status.err).slice(0, 300);
      } else if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        leg.state = "confirmed";
      }
    });
  }
  return { ok: true, legs };
}
