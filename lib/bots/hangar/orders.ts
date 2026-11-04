/**
 * The Hangar's orders: one shape for a wallet's limit orders at both venues,
 * read off what the venues say now and what the limits lane recorded when it
 * relayed them — Jupiter Trigger V1's order book, the DLMM order accounts and
 * the `solanaLimitOrders` rows.
 *
 * The Hangar only reads. It never advances a record (that is «Мої ордери»'s
 * and the reconciler's job, `lib/solana/limits/sync.server.ts`), so the venue
 * is the truth for where an order stands and the record adds what only Ryntra
 * knows: the signature that placed it and that it went through Ryntra.
 *
 * Pure and client-safe: the venue rows and the records are arguments.
 */

import { USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import type { DlmmOrderRow } from "../../solana/limits/dlmm.server.ts";
import type { LimitSide, LimitVenue } from "../../solana/limits/model.ts";
import type { LimitOrderRecord, LimitOrderState } from "../../solana/limits/store.server.ts";
import type { TriggerOrderRow } from "../../solana/limits/trigger.server.ts";

export type HangarFill = Readonly<{ signature: string; inputRaw: string; outputRaw: string; at: string }>;

export type HangarOrder = Readonly<{
  venue: LimitVenue;
  order: string;
  pool: string | null;
  side: LimitSide;
  baseMint: string;
  quoteMint: string;
  inputMint: string;
  outputMint: string;
  /** What went into the order and what it must deliver, raw units. */
  makingRaw: string;
  takingRaw: string;
  /** What has left the order and what came back, raw units. */
  filledInputRaw: string;
  filledOutputRaw: string;
  state: LimitOrderState;
  createdAt: string;
  updatedAt: string;
  /** Trigger V1: when the keeper stops filling it; null — never. */
  expiredAt: string | null;
  placeSignature: string | null;
  fills: readonly HangarFill[];
  /** A record of Ryntra's relay exists; false — found only at the venue. */
  throughRyntra: boolean;
  /** A DLMM order whose deposit converted and waits for the person to take it back. */
  canClaim: boolean;
}>;

/** The quotes a pair is priced in, best first: a dollar before SOL — the limits lane's own order. */
const QUOTES: readonly string[] = [USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT];

/** Which side of its pair an order is, from its two mints — the same reading as `sideOfMints` in the limits lane. */
export function orderSide(inputMint: string, outputMint: string): Readonly<{ side: LimitSide; baseMint: string; quoteMint: string }> {
  const rank = (mint: string) => {
    const index = QUOTES.indexOf(mint);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  return rank(outputMint) <= rank(inputMint) ? { side: "sell", baseMint: inputMint, quoteMint: outputMint } : { side: "buy", baseMint: outputMint, quoteMint: inputMint };
}

const sumRaw = (values: readonly string[]): string => values.reduce((sum, value) => sum + BigInt(/^\d+$/.test(value) ? value : "0"), 0n).toString();

function triggerState(row: TriggerOrderRow): LimitOrderState {
  const status = row.status.toLowerCase();
  if (status === "completed") return "FILLED";
  if (status === "cancelled") return "CANCELLED";
  if (status === "expired") return "EXPIRED";
  return row.trades.some((trade) => trade.action.toLowerCase() === "fill") ? "PARTIAL" : "OPEN";
}

function triggerOrder(row: TriggerOrderRow, record: LimitOrderRecord | undefined): HangarOrder {
  const fills = row.trades
    .filter((trade) => trade.action.toLowerCase() === "fill" && trade.signature)
    .map((trade) => ({ signature: trade.signature, inputRaw: trade.inputRaw, outputRaw: trade.outputRaw, at: trade.confirmedAt }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const sides = record ? { side: record.side, baseMint: record.baseMint, quoteMint: record.quoteMint } : orderSide(row.inputMint, row.outputMint);
  return {
    venue: "trigger",
    order: row.order,
    pool: null,
    ...sides,
    inputMint: row.inputMint,
    outputMint: row.outputMint,
    makingRaw: row.makingRaw,
    takingRaw: row.takingRaw,
    filledInputRaw: sumRaw(fills.map((fill) => fill.inputRaw)),
    filledOutputRaw: sumRaw(fills.map((fill) => fill.outputRaw)),
    state: triggerState(row),
    createdAt: record?.createdAt ?? row.createdAt,
    updatedAt: row.updatedAt || record?.updatedAt || row.createdAt,
    expiredAt: row.expiredAt,
    placeSignature: record?.placeSignature ?? row.openTx,
    fills,
    throughRyntra: record !== undefined,
    canClaim: false,
  };
}

function dlmmOrder(row: DlmmOrderRow, record: LimitOrderRecord | undefined): HangarOrder {
  const ask = row.isAskSide;
  const inputMint = ask ? row.tokenXMint : row.tokenYMint;
  const outputMint = ask ? row.tokenYMint : row.tokenXMint;
  const makingRaw = ask ? row.depositX : row.depositY;
  const filledInputRaw = (BigInt(makingRaw) - BigInt(ask ? row.unfilledX : row.unfilledY)).toString();
  const filledOutputRaw = ask ? row.swappedY : row.swappedX;
  const sides = record ? { side: record.side, baseMint: record.baseMint, quoteMint: record.quoteMint } : orderSide(inputMint, outputMint);
  return {
    venue: "dlmm",
    order: row.limitOrder,
    pool: row.pool,
    ...sides,
    inputMint,
    outputMint,
    makingRaw,
    takingRaw: record?.takingRaw ?? "0",
    filledInputRaw,
    filledOutputRaw,
    state: row.status,
    createdAt: record?.createdAt ?? "",
    updatedAt: record?.updatedAt ?? "",
    expiredAt: null,
    placeSignature: record?.placeSignature ?? null,
    fills: record?.fills.map((fill) => ({ signature: fill.signature, inputRaw: fill.inputRaw, outputRaw: fill.outputRaw, at: fill.at })) ?? [],
    throughRyntra: record !== undefined,
    canClaim: BigInt(filledOutputRaw || "0") > 0n,
  };
}

function recordOrder(record: LimitOrderRecord): HangarOrder {
  return {
    venue: record.venue,
    order: record.order,
    pool: record.pool,
    side: record.side,
    baseMint: record.baseMint,
    quoteMint: record.quoteMint,
    inputMint: record.inputMint,
    outputMint: record.outputMint,
    makingRaw: record.makingRaw,
    takingRaw: record.takingRaw,
    filledInputRaw: sumRaw(record.fills.map((fill) => fill.inputRaw)),
    filledOutputRaw: sumRaw(record.fills.map((fill) => fill.outputRaw)),
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiredAt: null,
    placeSignature: record.placeSignature,
    fills: record.fills.map((fill) => ({ signature: fill.signature, inputRaw: fill.inputRaw, outputRaw: fill.outputRaw, at: fill.at })),
    throughRyntra: true,
    canClaim: false,
  };
}

export type VenueRead = Readonly<{
  records: readonly LimitOrderRecord[];
  /** Jupiter's active and history pages together; an order in both is the active one. */
  trigger: readonly TriggerOrderRow[];
  /** The DLMM order accounts that exist now; a closed account is gone from the chain. */
  dlmm: readonly DlmmOrderRow[];
}>;

/** One list of the wallet's orders: every venue row, then the records no venue lists any more, newest first. */
export function hangarOrders(read: VenueRead): HangarOrder[] {
  const records = new Map(read.records.map((record) => [`${record.venue}:${record.order}`, record]));
  const out = new Map<string, HangarOrder>();
  for (const row of read.trigger) out.set(`trigger:${row.order}`, triggerOrder(row, records.get(`trigger:${row.order}`)));
  for (const row of read.dlmm) out.set(`dlmm:${row.limitOrder}`, dlmmOrder(row, records.get(`dlmm:${row.limitOrder}`)));
  /*
   * A record no venue lists: a placement still in flight or one that failed, a DLMM order whose account was closed
   * (cancelled or claimed), or a Trigger order past Jupiter's first page of history. The record's own word stands.
   */
  for (const [key, record] of records) if (!out.has(key)) out.set(key, recordOrder(record));
  return [...out.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.order.localeCompare(b.order));
}

export const OPEN_ORDER_STATES: ReadonlySet<LimitOrderState> = new Set(["OPEN", "PARTIAL", "PLACING", "CANCELLING"]);

export function isOpenOrder(order: Pick<HangarOrder, "state">): boolean {
  return OPEN_ORDER_STATES.has(order.state);
}
