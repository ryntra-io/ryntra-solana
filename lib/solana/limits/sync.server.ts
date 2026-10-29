/**
 * The limits lane's truth, kept in step with the venues: the record says what
 * Ryntra relayed; Jupiter's order book and the DLMM order account say where
 * each order is now. «Мої ордери» reads through here, and so does the
 * reconciler every ten minutes — the record never drifts from the chain for
 * longer than a page load or a cron tick.
 */

import { PublicKey, type Connection } from "@solana/web3.js";

import { USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import type { GuardStore } from "../../guard/store.ts";
import { limitsConnection } from "./chain.server.ts";
import type { DlmmOrderRow } from "./dlmm.server.ts";
import { impliedPrice, type LimitSide, type LimitVenue } from "./model.ts";
import { noteLimitTransition, type LimitNotesDeps } from "./notes.server.ts";
import {
  advanceLimitOrder,
  FINAL_LIMIT_STATES,
  limitOrderKey,
  listLimitOrders,
  listUnsettledLimitOrders,
  mergeFills,
  type LimitOrderFill,
  type LimitOrderRecord,
  type LimitOrderState,
  type LimitRecordInput,
} from "./store.server.ts";
import { listTriggerOrders, type TriggerOrderRow } from "./trigger.server.ts";

/** What the ticket prices in, in the order a pair picks its quote: a dollar before SOL. */
export const LIMIT_QUOTE_MINTS = [USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT] as const;

/** Which side of a pair an order is, read off its two mints: the quote is the one the ticket prices in. */
export function sideOfMints(inputMint: string, outputMint: string): Readonly<{ side: LimitSide; baseMint: string; quoteMint: string }> {
  const rank = (mint: string) => {
    const index = (LIMIT_QUOTE_MINTS as readonly string[]).indexOf(mint);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  /* The better-ranked quote is the quote; a pair of two quotes prices the second in the first. */
  return rank(outputMint) <= rank(inputMint)
    ? { side: "sell", baseMint: inputMint, quoteMint: outputMint }
    : { side: "buy", baseMint: outputMint, quoteMint: inputMint };
}

export type LimitOrderView = Readonly<{
  key: string;
  venue: LimitVenue;
  order: string;
  side: LimitSide;
  baseMint: string;
  quoteMint: string;
  inputMint: string;
  outputMint: string;
  makingRaw: string;
  takingRaw: string;
  /** What has left the order and what has come back, raw units. */
  filledInputRaw: string;
  filledOutputRaw: string;
  /** Ryntra's fee taken from the fills so far, raw units of the output. */
  ryntraFeeRaw: string;
  ryntraBps: number;
  /** Quote per base the order fills at; null for an order seen only at the venue with unknown decimals. */
  fillPrice: number | null;
  state: LimitOrderState;
  placeSignature: string | null;
  cancelSignature: string | null;
  fills: readonly LimitOrderFill[];
  createdAt: string;
  updatedAt: string;
  /** Placed through Ryntra (a record exists) or found only at the venue. */
  throughRyntra: boolean;
  canCancel: boolean;
  /** A DLMM order converted and waiting to be taken back. */
  canClaim: boolean;
  pool: string | null;
}>;

function sumRaw(values: readonly string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value || "0"), 0n).toString();
}

function triggerState(row: TriggerOrderRow): LimitOrderState {
  const status = row.status.toLowerCase();
  if (status === "completed") return "FILLED";
  /* Cancelled after part of it filled is still final: the fills stay on the row, the rest came back. */
  if (status === "cancelled") return "CANCELLED";
  if (status === "expired") return "EXPIRED";
  if (status === "open") return row.trades.some((trade) => trade.action.toLowerCase() === "fill") ? "PARTIAL" : "OPEN";
  return "OPEN";
}

function triggerFills(row: TriggerOrderRow): LimitOrderFill[] {
  return row.trades
    .filter((trade) => trade.action.toLowerCase() === "fill" && trade.signature)
    .map((trade) => ({ signature: trade.signature, inputRaw: trade.inputRaw, outputRaw: trade.outputRaw, feeRaw: trade.feeRaw, at: trade.confirmedAt }));
}

/** A DLMM order in the person's terms: what left is the deposit's side, what came back is the swapped side. */
function dlmmFlows(row: DlmmOrderRow): Readonly<{ inputMint: string; outputMint: string; makingRaw: string; filledInputRaw: string; filledOutputRaw: string }> {
  return row.isAskSide
    ? { inputMint: row.tokenXMint, outputMint: row.tokenYMint, makingRaw: row.depositX, filledInputRaw: (BigInt(row.depositX) - BigInt(row.unfilledX)).toString(), filledOutputRaw: row.swappedY }
    : { inputMint: row.tokenYMint, outputMint: row.tokenXMint, makingRaw: row.depositY, filledInputRaw: (BigInt(row.depositY) - BigInt(row.unfilledY)).toString(), filledOutputRaw: row.swappedX };
}

function fromRecord(record: LimitOrderRecord, override: Partial<LimitOrderView> = {}): LimitOrderView {
  const filledInputRaw = sumRaw(record.fills.map((fill) => fill.inputRaw));
  const filledOutputRaw = sumRaw(record.fills.map((fill) => fill.outputRaw));
  const ryntraFeeRaw = record.fee.ryntraBps > 0 ? sumRaw(record.fills.map((fill) => fill.feeRaw)) : "0";
  return {
    key: limitOrderKey(record),
    venue: record.venue,
    order: record.order,
    side: record.side,
    baseMint: record.baseMint,
    quoteMint: record.quoteMint,
    inputMint: record.inputMint,
    outputMint: record.outputMint,
    makingRaw: record.makingRaw,
    takingRaw: record.takingRaw,
    filledInputRaw,
    filledOutputRaw,
    ryntraFeeRaw,
    ryntraBps: record.fee.ryntraBps,
    fillPrice: record.fillPrice,
    state: record.state,
    placeSignature: record.placeSignature,
    cancelSignature: record.cancelSignature,
    fills: record.fills,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    throughRyntra: true,
    canCancel: record.state === "OPEN" || record.state === "PARTIAL",
    canClaim: false,
    pool: record.pool,
    ...override,
  };
}

/**
 * Advance one row exactly as `advanceLimitOrder` does, and say the state the
 * applied step moved it from — null when the step left the row as it was or
 * the write failed. Only what the store applied is news for a note.
 */
async function advanceSeen(
  store: GuardStore,
  key: string,
  step: (record: LimitOrderRecord) => Partial<LimitRecordInput> | null,
  now: string,
): Promise<Readonly<{ advanced: Awaited<ReturnType<typeof advanceLimitOrder>>; from: LimitOrderState | null }>> {
  /* An object, not a `let`: the step runs inside the store's retry, and its last run is the one written. */
  const seen: { from: LimitOrderState | null } = { from: null };
  const advanced = await advanceLimitOrder(store, key, (current) => {
    const change = step(current);
    seen.from = change === null ? null : current.state;
    return change;
  }, now);
  return { advanced, from: advanced.ok ? seen.from : null };
}

/** After an applied transition: the note it is news of («Ордер виконано», and from the reconciler «Квитанція готова»). Never throws. */
async function noteSeen(store: GuardStore, seen: Readonly<{ advanced: Awaited<ReturnType<typeof advanceLimitOrder>>; from: LimitOrderState | null }>, notes: LimitNotesDeps | null, receipts: boolean): Promise<void> {
  if (notes === null || seen.from === null || !seen.advanced.ok) return;
  await noteLimitTransition(store, seen.from, seen.advanced.record, { ...notes, receipts });
}

/**
 * Read a wallet's orders at both venues, advance the records they contradict,
 * and return one list: Ryntra's records first-class, venue-only orders (placed
 * elsewhere) shown too — they are the person's orders, and cancellable here.
 */
export async function syncWalletLimits(
  store: GuardStore,
  wallet: string,
  deps: Readonly<{ connection?: Connection; now?: () => string; notes?: LimitNotesDeps | null }> = {},
): Promise<Readonly<{ orders: readonly LimitOrderView[]; complete: boolean }>> {
  const now = deps.now ?? (() => new Date().toISOString());
  /* «Ордер виконано» for every record this read moves into FILLED; null writes none (a caller that notes itself). */
  const notes = deps.notes === undefined ? {} : deps.notes;
  const connection = deps.connection ?? limitsConnection();
  const [stored, active, history, dlmm] = await Promise.all([
    listLimitOrders(store, wallet).catch(() => ({ records: [] as LimitOrderRecord[], complete: false })),
    listTriggerOrders(wallet, "active"),
    listTriggerOrders(wallet, "history"),
    /* The DLMM SDK loads only when a wallet's orders are read: the reconciler's ledger half needs none of it. */
    import("./dlmm.server.ts").then(({ listDlmmOrders }) => listDlmmOrders(wallet, { connection })).catch((failure: unknown) => ({ ok: false as const, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) })),
  ]);
  let complete = stored.complete && active.ok && history.ok && dlmm.ok;
  const records = new Map(stored.records.map((record) => [limitOrderKey(record), record]));
  const views = new Map<string, LimitOrderView>();

  /* Jupiter: active and history are one list keyed by order. */
  const triggerRows = new Map<string, TriggerOrderRow>();
  for (const row of [...(history.ok ? history.orders : []), ...(active.ok ? active.orders : [])]) triggerRows.set(row.order, row);
  for (const row of triggerRows.values()) {
    const key = limitOrderKey({ wallet, venue: "trigger", order: row.order });
    const state = triggerState(row);
    const fills = triggerFills(row);
    const record = records.get(key);
    if (record) {
      const advanced = FINAL_LIMIT_STATES.has(record.state) && record.state === state && fills.length === record.fills.length
        ? null
        : await advanceSeen(store, key, (current) => (current.state === state && current.fills.length === fills.length) || (current.state === "CANCELLING" && (state === "OPEN" || state === "PARTIAL")) ? null : ({ state, fills: mergeFills(current.fills, fills), cancelFrom: null, cancelSignature: current.cancelSignature ?? (state === "CANCELLED" ? row.closeTx : null) }), now());
      if (advanced) await noteSeen(store, advanced, notes, false);
      const latest = advanced && advanced.advanced.ok ? advanced.advanced.record : record;
      views.set(key, fromRecord(latest));
      continue;
    }
    const { side, baseMint, quoteMint } = sideOfMints(row.inputMint, row.outputMint);
    views.set(key, {
      key,
      venue: "trigger",
      order: row.order,
      side,
      baseMint,
      quoteMint,
      inputMint: row.inputMint,
      outputMint: row.outputMint,
      makingRaw: row.makingRaw,
      takingRaw: row.takingRaw,
      filledInputRaw: sumRaw(fills.map((fill) => fill.inputRaw)),
      filledOutputRaw: sumRaw(fills.map((fill) => fill.outputRaw)),
      ryntraFeeRaw: "0",
      ryntraBps: 0,
      fillPrice: null,
      state,
      placeSignature: row.openTx,
      cancelSignature: state === "CANCELLED" ? row.closeTx : null,
      fills,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      throughRyntra: false,
      canCancel: state === "OPEN" || (state === "PARTIAL" && row.status.toLowerCase() === "open"),
      canClaim: false,
      pool: null,
    });
  }

  /* DLMM: the order account is the truth while it exists; a closed account is a cancelled or claimed order. */
  const liveDlmm = new Map((dlmm.ok ? dlmm.orders : []).map((row) => [row.limitOrder, row]));
  for (const row of liveDlmm.values()) {
    const key = limitOrderKey({ wallet, venue: "dlmm", order: row.limitOrder });
    const flows = dlmmFlows(row);
    const state: LimitOrderState = row.status === "FILLED" ? "FILLED" : row.status === "PARTIAL" ? "PARTIAL" : "OPEN";
    const record = records.get(key);
    const decimalsKnown = record !== undefined;
    const base = record ?? null;
    let latest = record ?? null;
    if (record && record.state !== state && !FINAL_LIMIT_STATES.has(record.state) && record.state !== "CANCELLING") {
      const advanced = await advanceSeen(store, key, (current) => (current.state === state ? null : { state }), now());
      await noteSeen(store, advanced, notes, false);
      if (advanced.advanced.ok) latest = advanced.advanced.record;
    }
    const sideInfo = base ? { side: base.side, baseMint: base.baseMint, quoteMint: base.quoteMint } : sideOfMints(flows.inputMint, flows.outputMint);
    views.set(key, {
      ...(latest ? fromRecord(latest) : {
        key,
        venue: "dlmm" as const,
        order: row.limitOrder,
        ...sideInfo,
        inputMint: flows.inputMint,
        outputMint: flows.outputMint,
        makingRaw: flows.makingRaw,
        takingRaw: "0",
        ryntraFeeRaw: "0",
        ryntraBps: 0,
        fillPrice: null,
        placeSignature: null,
        cancelSignature: null,
        fills: [],
        createdAt: "",
        updatedAt: "",
        throughRyntra: false,
        pool: row.pool,
      }),
      filledInputRaw: flows.filledInputRaw,
      filledOutputRaw: flows.filledOutputRaw,
      state: latest?.state === "CANCELLING" ? "CANCELLING" : state,
      fillPrice: latest?.fillPrice ?? (decimalsKnown ? null : null),
      canCancel: state !== "FILLED" && latest?.state !== "CANCELLING",
      canClaim: state === "FILLED" && latest?.state !== "CANCELLING",
    });
  }

  /* Records the venues no longer list: a DLMM order whose account is gone was taken back; a Trigger order Jupiter forgot keeps its record. */
  for (const record of records.values()) {
    const key = limitOrderKey(record);
    if (views.has(key)) continue;
    let latest = record;
    if (record.venue === "dlmm" && dlmm.ok && (record.state === "CANCELLING" || record.state === "OPEN" || record.state === "PARTIAL" || record.state === "FILLED")) {
      const gone = await connection.getAccountInfo(new PublicKey(record.order), "confirmed").then((info) => info === null).catch(() => false);
      if (gone && record.placeSignature !== null) {
        const advanced = await advanceSeen(store, key, (current) => {
          if (FINAL_LIMIT_STATES.has(current.state)) return null;
          /* Taken back after it converted: a fill, with the claim's own signature as its receipt. */
          if (current.claim && current.cancelSignature) {
            return { state: current.claim.inputRaw === current.makingRaw ? "FILLED" : "CANCELLED", cancelFrom: null, claim: null, fills: mergeFills(current.fills, [{ signature: current.cancelSignature, inputRaw: current.claim.inputRaw, outputRaw: current.claim.outputRaw, feeRaw: "0", at: now() }]) };
          }
          return { state: "CANCELLED", cancelFrom: null, claim: null };
        }, now());
        await noteSeen(store, advanced, notes, false);
        if (advanced.advanced.ok) latest = advanced.advanced.record;
      }
    }
    views.set(key, fromRecord(latest, { canCancel: false, canClaim: false }));
  }
  if (!dlmm.ok) complete = false;
  const orders = [...views.values()].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  return { orders, complete };
}

/** Quote per base an order's two amounts imply, for display — the record keeps the reviewed one. */
export function viewPrice(view: LimitOrderView, decimals: Readonly<Record<string, number>>): number | null {
  if (view.fillPrice !== null) return view.fillPrice;
  const base = decimals[view.baseMint];
  const quote = decimals[view.quoteMint];
  if (base === undefined || quote === undefined || view.takingRaw === "0") return null;
  const price = impliedPrice({ baseMint: view.baseMint, baseDecimals: base, quoteMint: view.quoteMint, quoteDecimals: quote }, view.side, view.makingRaw, view.takingRaw);
  return Number.isFinite(price) ? price : null;
}

/* ------------------------------------------------------------- reconcile */

export type LimitReconcileDecision = Readonly<{ key: string; before: LimitOrderState; after: LimitOrderState; applied: boolean }>;

/** How many wallets with open orders one reconcile pass reads at their venues; the rest wait their turn. */
export const LIMIT_WALLETS_PER_RUN = 15;
/** The cron's own beat — the turn a pass takes in the rotation over wallets. */
export const LIMIT_RECONCILE_EVERY_MS = 10 * 60 * 1000;

/**
 * The wallets with open orders this pass reads, in turn: every wallet comes up
 * within ⌈wallets / perRun⌉ passes, however many orders the oldest of them
 * hold — no order lies still for long enough to keep its fill unnoticed while
 * its owner is away.
 */
export function walletsInTurn(wallets: readonly string[], nowMs: number, perRun: number = LIMIT_WALLETS_PER_RUN): string[] {
  const sorted = [...new Set(wallets)].sort();
  if (sorted.length <= perRun) return sorted;
  const start = (Math.floor(nowMs / LIMIT_RECONCILE_EVERY_MS) * perRun) % sorted.length;
  return Array.from({ length: perRun }, (_, index) => sorted[(start + index) % sorted.length] as string);
}

/** The share of the cron's minute this pass may spend starting reads; what it leaves waits for the next pass. */
export const LIMIT_RECONCILE_BUDGET_MS = 30_000;

/** How long a submission may sit without an answer before the chain is asked about it. */
export const LIMIT_RECONCILE_MIN_AGE_MS = 2 * 60 * 1000;

/**
 * Settle what a request left unsettled: a placement or a cancellation whose
 * relay did not answer is read by its signature on chain; an open order is
 * refreshed from its venue. Never moves money; only records.
 */
export async function reconcileLimitOrders(
  store: GuardStore,
  options: Readonly<{ limit?: number; walletsPerRun?: number; budgetMs?: number; nowMs?: number; connection?: Connection; sync?: (wallet: string) => Promise<unknown>; notes?: LimitNotesDeps | null }> = {},
): Promise<readonly LimitReconcileDecision[]> {
  const nowMs = options.nowMs ?? Date.now();
  /* The cron route has a minute for every reconciler: this pass stops starting reads after its share of it. */
  const deadline = Date.now() + (options.budgetMs ?? LIMIT_RECONCILE_BUDGET_MS);
  /* «Квитанція готова» for each submission settled here, «Ордер виконано» where it filled; null writes none. */
  const notes = options.notes === undefined ? {} : options.notes;
  const connection = options.connection ?? limitsConnection();
  const all = await listUnsettledLimitOrders(store);
  /* Submissions without an answer, read by their signatures; open orders never take their places. */
  const unsettled = all
    .filter((record) => (record.state === "PLACING" || record.state === "CANCELLING") && nowMs - Date.parse(record.updatedAt) >= LIMIT_RECONCILE_MIN_AGE_MS)
    .slice(0, options.limit ?? 25);
  const decisions: LimitReconcileDecision[] = [];
  /* Open orders: every wallet that has one, a slice of them each pass in turn (`walletsInTurn`). */
  const wallets = new Set<string>(walletsInTurn(all.filter((record) => record.state === "OPEN" || record.state === "PARTIAL").map((record) => record.wallet), nowMs, options.walletsPerRun));
  for (const record of unsettled) {
    if (Date.now() > deadline) break;
    const key = limitOrderKey(record);
    const signature = record.state === "PLACING" ? record.placeSignature : record.state === "CANCELLING" ? record.cancelSignature : null;
    if (signature === null) {
      wallets.add(record.wallet);
      continue;
    }
    const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).then((answer) => answer.value[0]).catch(() => undefined);
    if (status === undefined) continue;
    const landed = status !== null && status.err === null && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
    const failed = status !== null && status.err !== null;
    /* Unseen after the window: a placement never happened; a cancellation did not, and the order stands as it was. */
    const at = new Date(nowMs).toISOString();
    const after: LimitOrderState = record.state === "PLACING"
      ? (landed ? "OPEN" : failed || status === null ? "FAILED" : "PLACING")
      : landed ? (record.claim && record.claim.inputRaw === record.makingRaw ? "FILLED" : "CANCELLED") : failed || status === null ? (record.cancelFrom ?? "OPEN") : "CANCELLING";
    if (after === record.state) continue;
    const seen = await advanceSeen(store, key, (current) => {
      if (current.state !== record.state) return null;
      if (current.state === "PLACING") return { state: after, reason: after === "FAILED" ? "The placement never landed." : current.reason };
      if (landed && current.claim) {
        return { state: after, cancelFrom: null, claim: null, fills: mergeFills(current.fills, [{ signature, inputRaw: current.claim.inputRaw, outputRaw: current.claim.outputRaw, feeRaw: "0", at }]) };
      }
      return { state: after, cancelFrom: null, claim: null, cancelSignature: after === "CANCELLED" ? current.cancelSignature : null };
    }, at);
    await noteSeen(store, seen, notes, true);
    decisions.push({ key, before: record.state, after, applied: seen.advanced.ok });
    if (after === "OPEN" || after === "PARTIAL") wallets.add(record.wallet);
  }
  /* Open orders: one venue read per wallet advances their fills and endings. */
  const sync = options.sync ?? ((wallet: string) => syncWalletLimits(store, wallet, { connection, notes }));
  for (const wallet of wallets) {
    if (Date.now() > deadline) break;
    await sync(wallet).catch(() => undefined);
  }
  return decisions;
}
