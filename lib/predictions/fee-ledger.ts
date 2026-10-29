/**
 * Ryntra's fee ledger for live predictions: one line per trade, built from two
 * witnesses — the aggregator's signed webhooks, which arrive first, and its
 * own order list (`GET /apps/{appId}/orders`), which is the truth for money.
 *
 * Each line says what the trade was (filled, partial, cancelled, failed, still
 * open), what the person paid as Ryntra's fee, the aggregator's share of it,
 * the inviter's fee if there was one, whether the trade fell inside the
 * «0 % for the first 30 days» window, and what Ryntra keeps. A line whose two
 * witnesses disagree says so, field by field, instead of picking one.
 *
 * A trade is one execution run (`dagRunId`): the aggregator charges the fee
 * and the referral once per run and repeats them on every venue order of it.
 * A quote may run more than once, so the quote is kept beside the runs and
 * joined to them when the ledger is read, never used as the grouping key.
 *
 * Amounts are integer strings in six-decimal units (1 000 000 = $1.00), the
 * aggregator's own unit; arithmetic is BigInt so no cent is lost to floats.
 *
 * The aggregator takes its share of the app fee before anything else and pays
 * an inviter straight from the trade, out of the person's 0.3 % — so the
 * inviter is not a cost on Ryntra's side unless the app itself paid them.
 *
 * Server only; the store is the shared one (`lib/guard/store.ts`).
 */

import { createHash } from "node:crypto";

import { withBoundedCasRetry, type GuardStore, type GuardVersionedCollection } from "../guard/store.ts";

/** Ryntra's fee on a buy, in basis points of the filled amount: 0.3 %. */
export const RYNTRA_BUY_FEE_BIPS = 30;
/** The aggregator's share of the app fee, in basis points of that fee: 20 % (its starting rate). */
export const AGG_PLATFORM_SHARE_BIPS = 2_000;
/** The two inviter rates there are: a friend, or an ambassador. One inviter per trade, one level. */
export const REFERRAL_FEE_BIPS = { friend: 6, ambassador: 10 } as const;

export const FEE_LEDGER_COLLECTION = "predictionFeeLedger" as const;

const TERMINAL = new Set(["filled", "partial_fill", "failed", "expired", "cancelled"]);
/** On an equal timestamp the further-along status wins, so a redelivery never takes a fill back. */
const STATUS_RANK: Readonly<Record<string, number>> = { partial_fill: 1, filled: 2 };
const RAW = /^\d{1,30}$/;

export type Side = "buy" | "sell";

export type LedgerOrderApi = Readonly<{
  status: string;
  side: Side | null;
  venue: string | null;
  quoteId: string | null;
  dagRunId: string | null;
  /** The aggregator's simulated orders carry no order type; they never move money. */
  paper: boolean;
  amountRaw: string | null;
  filledAmountRaw: string | null;
  quotedAppFeeBips: number | null;
  updatedAt: string | null;
}>;

export type LedgerOrder = Readonly<{
  kind: "order";
  version: number;
  orderId: string;
  /** The run a self-custody trade's final fee named this order part of. */
  hookRun: string | null;
  userId: string | null;
  externalId: string | null;
  /** What the fill webhook said about this order. */
  hook: Readonly<{ status: string | null; filledAmountRaw: string | null; at: string | null }>;
  /** The order as the aggregator's order list last showed it. */
  api: LedgerOrderApi | null;
  events: readonly string[];
}>;

export type LedgerAppFee = Readonly<{ bips: number | null; dueRaw: string | null; collectedRaw: string | null; status: string | null }>;

export type LedgerReferral = Readonly<{
  referrer: string;
  payer: "user" | "app";
  feeBips: number;
  dueRaw: string | null;
  paidRaw: string | null;
  status: string | null;
}>;

/** The final fee of a self-custody trade as its webhook reported it, with both shares named when it named them. */
export type LedgerReconciledFee = Readonly<{
  status: string;
  dueRaw: string | null;
  collectedRaw: string | null;
  appShareRaw: string | null;
  platformShareRaw: string | null;
  chainId: string | null;
  tokenSymbol: string | null;
  appTxHash: string | null;
  platformTxHash: string | null;
  at: string | null;
}>;

/** One execution run: `r:<dagRunId>`, or `o:<orderId>` for an order that ran alone. */
export type LedgerTrade = Readonly<{
  kind: "trade";
  version: number;
  tradeKey: string;
  quoteId: string | null;
  dagRunId: string | null;
  userId: string | null;
  orderIds: readonly string[];
  hookFee: LedgerReconciledFee | null;
  apiFee: LedgerAppFee | null;
  referral: LedgerReferral | null;
  /** The order snapshot the fee and the referral were read from, so an older one never replaces them. */
  apiFeeAt: string | null;
  events: readonly string[];
}>;

/** A quote as its placement webhook announced it; joined to its runs when the ledger is read. */
export type LedgerQuote = Readonly<{
  kind: "quote";
  version: number;
  quoteId: string;
  userId: string | null;
  externalId: string | null;
  /** The outcome bought or sold, «yes» or «no». */
  outcomeSide: string | null;
  placedAt: string | null;
  events: readonly string[];
}>;

type LedgerCursor = Readonly<{ kind: "cursor"; version: number; cursor: string | null; syncedAt: string | null }>;
/** An order from the list the ledger could not read, kept as it came until the reader learns its shape. */
export type LedgerUnreadable = Readonly<{ kind: "unreadable"; version: number; raw: string; seenAt: string }>;
type LedgerRecord = LedgerOrder | LedgerTrade | LedgerQuote | LedgerCursor | LedgerUnreadable;

function ledger(store: GuardStore): GuardVersionedCollection<LedgerRecord> {
  return store.versioned<LedgerRecord>(FEE_LEDGER_COLLECTION);
}

const orderKey = (orderId: string) => `order:${orderId}`;
const tradeRecordKey = (tradeKey: string) => `trade:${tradeKey}`;
const quoteKey = (quoteId: string) => `quote:${quoteId}`;
const CURSOR_KEY = "cursor:orders";
const runKey = (dagRunId: string) => `r:${dagRunId}`;

export function rawOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && RAW.test(value) ? value.replace(/^0+(?=\d)/, "") : null;
}

const big = (raw: string | null | undefined): bigint => (raw && RAW.test(raw) ? BigInt(raw) : 0n);
const union = (left: readonly string[], right: readonly string[]): string[] => [...new Set([...left, ...right])];
const time = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Whether a report stamped `next` may replace one stamped `current`; an unstamped side never blocks. */
function notOlder(next: string | null, current: string | null): boolean {
  const a = time(next), b = time(current);
  return a === null || b === null || a >= b;
}

function emptyOrder(orderId: string): LedgerOrder {
  return { kind: "order", version: 0, orderId, hookRun: null, userId: null, externalId: null, hook: { status: null, filledAmountRaw: null, at: null }, api: null, events: [] };
}

function emptyTrade(tradeKey: string): LedgerTrade {
  return { kind: "trade", version: 0, tradeKey, quoteId: null, dagRunId: null, userId: null, orderIds: [], hookFee: null, apiFee: null, referral: null, apiFeeAt: null, events: [] };
}

function emptyQuote(quoteId: string): LedgerQuote {
  return { kind: "quote", version: 0, quoteId, userId: null, externalId: null, outcomeSide: null, placedAt: null, events: [] };
}

/**
 * Read, change and write one record under compare-and-set. `change` returns
 * null to leave the record as it is (an event already applied, an older
 * snapshot than the one kept). Resolves whether anything was written.
 */
async function upsert<T extends LedgerOrder | LedgerTrade | LedgerQuote>(store: GuardStore, key: string, empty: () => T, change: (current: T) => T | null): Promise<boolean> {
  const rows = ledger(store);
  return withBoundedCasRetry(async () => {
    const stored = (await rows.get(key)) as T | undefined;
    const next = change(stored ?? empty());
    if (next === null) return { wrote: false };
    return (await rows.compareAndSet(key, stored ? stored.version : null, { ...next, version: (stored?.version ?? 0) + 1 })) ? { wrote: true } : false;
  }).then((result) => result.wrote);
}

/* ------------------------------------------------------------------ */
/* The webhooks                                                        */
/* ------------------------------------------------------------------ */

export type AggWebhookEvent = Readonly<{ id: string; type: string; createdAt: string | null; data: Readonly<Record<string, unknown>> }>;

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null);

/** The webhook types that touch the fee ledger; every other type is recorded and left alone. */
export const LEDGER_EVENT_TYPES = ["trades.placed", "trades.filled", "trades.fee_reconciled"] as const;

export function isLedgerEvent(type: string): boolean {
  return (LEDGER_EVENT_TYPES as readonly string[]).includes(type);
}

export type LedgerApplied = "applied" | "ignored";

/**
 * Apply one verified webhook to the ledger. Safe to run twice: each record
 * keeps the ids of the events it took, so a retried delivery — or a replay the
 * operator asks for — changes nothing the second time.
 */
export async function applyLedgerEvent(store: GuardStore, event: AggWebhookEvent): Promise<LedgerApplied> {
  const data = event.data;
  const seen = (record: { events: readonly string[] }) => record.events.includes(event.id);

  if (event.type === "trades.placed") {
    /* The placement names the quote (its `orderId` is a quote id), not a venue order. */
    const quoteId = text(data.orderId);
    if (!quoteId) return "ignored";
    await upsert<LedgerQuote>(store, quoteKey(quoteId), () => emptyQuote(quoteId), (quote) =>
      seen(quote)
        ? null
        : {
            ...quote,
            userId: quote.userId ?? text(data.userId),
            externalId: quote.externalId ?? text(data.externalId),
            outcomeSide: text(data.side) ?? quote.outcomeSide,
            placedAt: quote.placedAt ?? text(data.timestamp) ?? event.createdAt,
            events: [...quote.events, event.id],
          },
    );
    return "applied";
  }

  if (event.type === "trades.filled") {
    const orderId = text(data.orderId);
    const status = text(data.status);
    if (!orderId || !status) return "ignored";
    await upsert<LedgerOrder>(store, orderKey(orderId), () => emptyOrder(orderId), (order) => {
      if (seen(order)) return null;
      const at = text(data.timestamp) ?? event.createdAt;
      /* Deliveries can arrive out of order: an older fill report does not overwrite a newer one, and on a tie the further fill stands. */
      const tie = time(at) !== null && time(at) === time(order.hook.at);
      const replace = tie ? (STATUS_RANK[status] ?? 0) >= (STATUS_RANK[order.hook.status ?? ""] ?? 0) : notOlder(at, order.hook.at);
      return {
        ...order,
        userId: order.userId ?? text(data.userId),
        externalId: order.externalId ?? text(data.externalId),
        hook: replace ? { status, filledAmountRaw: rawOrNull(data.filledAmountRaw), at } : order.hook,
        events: [...order.events, event.id],
      };
    });
    return "applied";
  }

  if (event.type === "trades.fee_reconciled") {
    const dagRunId = text(data.dagRunId);
    if (!dagRunId) return "ignored";
    const key = runKey(dagRunId);
    const orderIds = Array.isArray(data.orders)
      ? data.orders.map((o) => (o && typeof o === "object" ? text((o as Record<string, unknown>).orderId) : null)).filter((id): id is string => id !== null)
      : [];
    const hookFee: LedgerReconciledFee = {
      status: text(data.status) ?? "unknown",
      dueRaw: rawOrNull(data.feeDueRaw),
      collectedRaw: rawOrNull(data.feeCollectedRaw),
      appShareRaw: rawOrNull(data.appShareRaw),
      platformShareRaw: rawOrNull(data.platformShareRaw),
      chainId: text(data.chainId),
      tokenSymbol: text(data.tokenSymbol),
      appTxHash: text(data.appTxHash),
      platformTxHash: text(data.platformTxHash),
      at: text(data.timestamp) ?? event.createdAt,
    };
    await upsert<LedgerTrade>(store, tradeRecordKey(key), () => emptyTrade(key), (trade) =>
      seen(trade)
        ? null
        : {
            ...trade,
            quoteId: trade.quoteId ?? text(data.quoteId),
            dagRunId,
            userId: trade.userId ?? text(data.userId),
            orderIds: union(trade.orderIds, orderIds),
            hookFee: !trade.hookFee || notOlder(hookFee.at, trade.hookFee.at) ? hookFee : trade.hookFee,
            events: [...trade.events, event.id],
          },
    );
    for (const orderId of orderIds) {
      await upsert<LedgerOrder>(store, orderKey(orderId), () => emptyOrder(orderId), (order) => (order.hookRun === dagRunId ? null : { ...order, hookRun: order.hookRun ?? dagRunId }));
    }
    return "applied";
  }

  return "ignored";
}

/* ------------------------------------------------------------------ */
/* The order list                                                      */
/* ------------------------------------------------------------------ */

/** An order as `GET /apps/{appId}/orders` returns it — only the fields the ledger reads. */
export type AggOrder = Readonly<{
  id: string;
  quoteId?: string | null;
  dagRunId?: string | null;
  externalId?: string | null;
  userId?: string | null;
  venue?: string | null;
  status: string;
  side?: string | null;
  amountRaw?: string | null;
  orderType?: string | null;
  filledAmountRaw?: string | null;
  updatedAt?: string | null;
  fees?: Readonly<{
    quoted?: Readonly<{ appFeeRaw?: string | null; appFeeBips?: number | null; referralFeeRaw?: string | null }> | null;
    actual?: Readonly<{
      dagRunId?: string | null;
      appFee?: Readonly<{ bips?: number | null; dueRaw?: string | null; collectedRaw?: string | null; status?: string | null }> | null;
      referral?: Readonly<{ referrer?: string | null; payer?: string | null; feeBips?: number | null; dueRaw?: string | null; paidRaw?: string | null; status?: string | null }> | null;
    }> | null;
  }> | null;
}>;

const bips = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : null);

/** The run an order belongs to: its own run from the list, else the run a final fee named, else itself alone. */
function orderTradeKey(order: LedgerOrder): string | null {
  if (order.api?.dagRunId) return runKey(order.api.dagRunId);
  if (order.hookRun) return runKey(order.hookRun);
  return order.api ? `o:${order.orderId}` : null;
}

/** Take one order from the aggregator's list into the ledger: the order's own snapshot and its run's fee. */
export async function applyAggOrder(store: GuardStore, order: AggOrder): Promise<void> {
  const side: Side | null = order.side === "buy" || order.side === "sell" ? order.side : null;
  const listedRun = text(order.dagRunId) ?? text(order.fees?.actual?.dagRunId);
  const api: LedgerOrderApi = {
    status: order.status,
    side,
    venue: text(order.venue),
    quoteId: text(order.quoteId),
    dagRunId: listedRun,
    paper: !order.orderType,
    amountRaw: rawOrNull(order.amountRaw),
    filledAmountRaw: rawOrNull(order.filledAmountRaw),
    quotedAppFeeBips: bips(order.fees?.quoted?.appFeeBips),
    updatedAt: text(order.updatedAt),
  };
  /* An order returns each time it changes; a page read late never rolls a newer snapshot back — neither the order nor its run's fee. */
  /* An order the list shows without its run takes the run its final fee named, so its fee lands on that run, not beside it. */
  let run = listedRun;
  const fresh = await upsert<LedgerOrder>(store, orderKey(order.id), () => emptyOrder(order.id), (current) => {
    if (current.api && !notOlder(api.updatedAt, current.api.updatedAt)) return null;
    run = listedRun ?? current.hookRun;
    return { ...current, userId: current.userId ?? text(order.userId), externalId: current.externalId ?? text(order.externalId), api: { ...api, dagRunId: run } };
  });
  if (!fresh) return;

  const key = run ? runKey(run) : `o:${order.id}`;
  /* The fee and the referral cover the whole run and repeat on every order of it. */
  const actual = order.fees?.actual ?? null;
  const fee = actual?.appFee ?? null;
  const ref = actual?.referral ?? null;
  const referral: LedgerReferral | null =
    ref && text(ref.referrer) && bips(ref.feeBips) !== null
      ? { referrer: text(ref.referrer) as string, payer: ref.payer === "app" ? "app" : "user", feeBips: bips(ref.feeBips) as number, dueRaw: rawOrNull(ref.dueRaw), paidRaw: rawOrNull(ref.paidRaw), status: text(ref.status) }
      : null;
  await upsert<LedgerTrade>(store, tradeRecordKey(key), () => emptyTrade(key), (trade) => {
    const newerFee = notOlder(api.updatedAt, trade.apiFeeAt);
    return {
      ...trade,
      quoteId: trade.quoteId ?? api.quoteId,
      dagRunId: trade.dagRunId ?? run,
      userId: trade.userId ?? text(order.userId),
      orderIds: union(trade.orderIds, [order.id]),
      apiFee: fee && newerFee ? { bips: bips(fee.bips), dueRaw: rawOrNull(fee.dueRaw), collectedRaw: rawOrNull(fee.collectedRaw), status: text(fee.status) } : trade.apiFee,
      referral: newerFee && fee ? referral : trade.referral,
      apiFeeAt: fee && newerFee ? (api.updatedAt ?? trade.apiFeeAt) : trade.apiFeeAt,
    };
  });
}

const UNREADABLE_MAX_CHARS = 16_384;

/** Keep an order the ledger could not read, under its own id when it has one; seen again, it is written again. */
export async function quarantineAggOrder(store: GuardStore, item: unknown, seenAt: string): Promise<void> {
  const raw = (JSON.stringify(item) ?? "null").slice(0, UNREADABLE_MAX_CHARS);
  const id = item && typeof item === "object" ? text((item as Record<string, unknown>).id) : null;
  const key = `unreadable:${id ?? createHash("sha256").update(raw).digest("hex")}`;
  const rows = ledger(store);
  await withBoundedCasRetry(async () => {
    const stored = (await rows.get(key)) as LedgerUnreadable | undefined;
    return (await rows.compareAndSet(key, stored ? stored.version : null, { kind: "unreadable", version: (stored?.version ?? 0) + 1, raw, seenAt })) || false;
  });
}

export type LedgerCursorRead = Readonly<{ cursor: string | null; version: number | null }>;

export async function readLedgerCursor(store: GuardStore): Promise<LedgerCursorRead> {
  const row = (await ledger(store).get(CURSOR_KEY)) as LedgerCursor | undefined;
  return { cursor: row?.cursor ?? null, version: row?.version ?? null };
}

/**
 * Move the cursor on from the position this pass read. Resolves false when
 * another pass moved it first: this one then stops rather than set it back.
 */
export async function advanceLedgerCursor(store: GuardStore, from: LedgerCursorRead, cursor: string, syncedAt: string): Promise<boolean> {
  return ledger(store).compareAndSet(CURSOR_KEY, from.version, { kind: "cursor", version: (from.version ?? 0) + 1, cursor, syncedAt });
}

/* ------------------------------------------------------------------ */
/* The lines                                                           */
/* ------------------------------------------------------------------ */

export type TradeOutcome = "placed" | "open" | "filled" | "partial" | "cancelled" | "failed";
export type ReferralKind = "friend" | "ambassador" | "other";
export type Reconciliation = "matched" | "differs" | "awaiting_orders";

export type TradeLine = Readonly<{
  tradeKey: string;
  quoteId: string | null;
  userId: string | null;
  /** The latest moment the ledger knows of on this trade. */
  at: string | null;
  side: Side | null;
  outcomeSide: string | null;
  venues: readonly string[];
  paper: boolean;
  outcome: TradeOutcome;
  orderIds: readonly string[];
  /** What was actually filled, in six-decimal dollars. */
  filledRaw: string;
  /** Ryntra's fee rate on the trade, as the aggregator applied it. */
  feeBips: number | null;
  feeStatus: string | null;
  feeCollectedRaw: string;
  aggShareRaw: string;
  /** «reported» when the aggregator named its share; «estimated» at its 20 % otherwise. */
  aggShareSource: "reported" | "estimated";
  referral: (LedgerReferral & { kind: ReferralKind }) | null;
  /** A buy at a 0 bps fee: the «0 % for the first 30 days» window. */
  zeroWindow: boolean;
  /** Ryntra's fee less the aggregator's share, less any inviter fee Ryntra itself paid. */
  netRyntraRaw: string;
  reconciliation: Reconciliation;
  /** Each disagreement between the webhooks and the order list, and each departure from the fee rules. */
  issues: readonly string[];
}>;

/** A fill reported by webhook whose trade is not known yet: shown on its own, never counted as a trade. */
export type UnlinkedOrder = Readonly<{ orderId: string; userId: string | null; status: string | null; filledRaw: string | null; at: string | null }>;

function outcomeOf(statuses: readonly (string | null)[]): TradeOutcome {
  if (statuses.length === 0) return "placed";
  if (!statuses.every((s) => s !== null && TERMINAL.has(s))) return "open";
  const filled = statuses.filter((s) => s === "filled").length;
  const partial = statuses.filter((s) => s === "partial_fill").length;
  if (partial > 0 || (filled > 0 && filled < statuses.length)) return "partial";
  if (filled === statuses.length) return "filled";
  if (statuses.every((s) => s === "cancelled" || s === "expired")) return "cancelled";
  return "failed";
}

function referralKind(feeBips: number): ReferralKind {
  if (feeBips === REFERRAL_FEE_BIPS.friend) return "friend";
  if (feeBips === REFERRAL_FEE_BIPS.ambassador) return "ambassador";
  return "other";
}

/** The aggregator's share when it did not name it: 20 % of what was collected, rounded up so Ryntra's line is never overstated. */
export function estimatedAggShare(collectedRaw: bigint, shareBips: number = AGG_PLATFORM_SHARE_BIPS): bigint {
  return (collectedRaw * BigInt(shareBips) + 9_999n) / 10_000n;
}

const latest = (...stamps: (string | null | undefined)[]): string | null =>
  stamps.reduce<string | null>((best, s) => (s && (best === null || (time(s) ?? 0) > (time(best) ?? 0)) ? s : best), null);

export function buildTradeLine(trade: LedgerTrade | null, orders: readonly LedgerOrder[], quote: LedgerQuote | null = null, options: { aggShareBips?: number } = {}): TradeLine {
  const tradeKey = trade?.tradeKey ?? (orders[0] ? orderTradeKey(orders[0]) : null) ?? (quote ? `q:${quote.quoteId}` : "unknown");
  const issues: string[] = [];
  const side = orders.map((o) => o.api?.side ?? null).find((s) => s !== null) ?? null;
  const outcome = outcomeOf(orders.map((o) => o.api?.status ?? o.hook.status));
  const filled = orders.reduce((sum, o) => sum + big(o.api ? o.api.filledAmountRaw : o.hook.filledAmountRaw), 0n);
  const paper = orders.some((o) => o.api?.paper === true);

  const quotedBips = orders.map((o) => o.api?.quotedAppFeeBips ?? null).find((b) => b !== null) ?? null;
  const feeBips = trade?.apiFee?.bips ?? quotedBips;
  const hook = trade?.hookFee ?? null;
  const collectedSource = trade?.apiFee?.collectedRaw ?? hook?.collectedRaw ?? null;
  const collected = big(collectedSource);
  const feeStatus = trade?.apiFee?.status ?? hook?.status ?? null;

  /* The aggregator names both shares only on a self-custody trade's final fee; elsewhere its starting 20 % stands. */
  const named = hook && hook.status !== "none" && hook.appShareRaw !== null && hook.platformShareRaw !== null ? hook : null;
  if (hook && hook.status !== "none" && !named) issues.push("hook_fee_incomplete");
  const aggShare = named ? big(named.platformShareRaw) : estimatedAggShare(collected, options.aggShareBips);
  const ryntraShare = named ? big(named.appShareRaw) : collected - aggShare;
  if (named && big(named.appShareRaw) + big(named.platformShareRaw) !== collected) issues.push("shares_do_not_add_up");

  const referral = trade?.referral ? { ...trade.referral, kind: referralKind(trade.referral.feeBips) } : null;
  const zeroWindow = side === "buy" && feeBips === 0;
  const paidByRyntra = referral && referral.payer === "app" ? big(referral.paidRaw ?? referral.dueRaw) : 0n;

  if (referral && zeroWindow) issues.push("referral_in_zero_window");
  if (referral && referral.kind === "other") issues.push("referral_rate_off_policy");
  if (referral && referral.payer === "app") issues.push("referral_paid_by_ryntra");
  if (side === "buy" && feeBips !== null && feeBips !== 0 && feeBips + (referral?.feeBips ?? 0) !== RYNTRA_BUY_FEE_BIPS) issues.push("fee_split_off_policy");
  if (side === "sell" && collected > 0n) issues.push("fee_on_sell");
  if (feeStatus === "under_collected" || feeStatus === "failed") issues.push(`fee_${feeStatus}`);

  /* The two witnesses, side by side. */
  let awaiting = orders.length === 0 || orders.some((o) => o.api === null);
  for (const o of orders) {
    if (!o.api) continue;
    if (o.hook.status && TERMINAL.has(o.api.status) && o.hook.status !== o.api.status) issues.push(`status_differs:${o.orderId}`);
    if (o.hook.filledAmountRaw !== null && o.api.filledAmountRaw !== null && o.hook.filledAmountRaw !== o.api.filledAmountRaw) issues.push(`filled_differs:${o.orderId}`);
    if (o.hookRun && o.api.dagRunId && o.hookRun !== o.api.dagRunId) issues.push(`run_differs:${o.orderId}`);
  }
  if (hook && trade?.apiFee?.collectedRaw != null && hook.collectedRaw !== null && hook.status !== "none" && big(hook.collectedRaw) !== big(trade.apiFee.collectedRaw)) issues.push("fee_collected_differs");
  if (trade && trade.orderIds.some((id) => !orders.some((o) => o.orderId === id))) awaiting = true;
  const differs = issues.some((issue) => issue.includes("differs"));

  return {
    tradeKey,
    quoteId: trade?.quoteId ?? quote?.quoteId ?? orders.map((o) => o.api?.quoteId ?? null).find((q) => q !== null) ?? null,
    userId: trade?.userId ?? quote?.userId ?? orders.find((o) => o.userId)?.userId ?? null,
    at: latest(quote?.placedAt, hook?.at, trade?.apiFeeAt, ...orders.flatMap((o) => [o.hook.at, o.api?.updatedAt])),
    side,
    outcomeSide: quote?.outcomeSide ?? null,
    venues: [...new Set(orders.map((o) => o.api?.venue).filter((v): v is string => !!v))],
    paper,
    outcome,
    orderIds: orders.map((o) => o.orderId),
    filledRaw: String(filled),
    feeBips,
    feeStatus,
    feeCollectedRaw: String(collected),
    aggShareRaw: String(aggShare),
    aggShareSource: named ? "reported" : "estimated",
    referral,
    zeroWindow,
    netRyntraRaw: String(ryntraShare - paidByRyntra),
    reconciliation: differs ? "differs" : awaiting ? "awaiting_orders" : "matched",
    issues,
  };
}

export type LedgerView = Readonly<{ lines: TradeLine[]; unlinked: UnlinkedOrder[]; unreadableOrders: number }>;

export function ledgerViewOf(trades: readonly LedgerTrade[], orders: readonly LedgerOrder[], quotes: readonly LedgerQuote[], options: { aggShareBips?: number; unreadableOrders?: number } = {}): LedgerView {
  const byTrade = new Map<string, LedgerOrder[]>();
  const unlinked: UnlinkedOrder[] = [];
  for (const order of orders) {
    const key = orderTradeKey(order);
    if (key === null) {
      unlinked.push({ orderId: order.orderId, userId: order.userId, status: order.hook.status, filledRaw: order.hook.filledAmountRaw, at: order.hook.at });
      continue;
    }
    byTrade.set(key, [...(byTrade.get(key) ?? []), order]);
  }
  const tradeMap = new Map(trades.map((t) => [t.tradeKey, t]));
  /* A runless order's fee, read before its final fee named the run, belongs to that run's line: folded in, never a line of its own. */
  const orderMap = new Map(orders.map((o) => [o.orderId, o]));
  for (const trade of trades) {
    if (!trade.tradeKey.startsWith("o:")) continue;
    const owner = orderMap.get(trade.tradeKey.slice(2));
    const key = owner ? orderTradeKey(owner) : null;
    if (!key || key === trade.tradeKey) continue;
    tradeMap.delete(trade.tradeKey);
    const run = tradeMap.get(key);
    tradeMap.set(
      key,
      run
        ? { ...run, quoteId: run.quoteId ?? trade.quoteId, apiFee: run.apiFee ?? trade.apiFee, referral: run.referral ?? trade.referral, apiFeeAt: run.apiFee ? run.apiFeeAt : trade.apiFeeAt, orderIds: union(run.orderIds, trade.orderIds) }
        : { ...trade, tradeKey: key },
    );
  }
  const quoteMap = new Map(quotes.map((q) => [q.quoteId, q]));
  const keys = [...new Set<string>([...tradeMap.keys(), ...byTrade.keys()])];
  const joined = new Set<string>();
  const lines = keys.map((key) => {
    const trade = tradeMap.get(key) ?? null;
    const group = byTrade.get(key) ?? [];
    const quoteId = trade?.quoteId ?? group.map((o) => o.api?.quoteId ?? null).find((q) => q !== null) ?? null;
    const quote = quoteId ? (quoteMap.get(quoteId) ?? null) : null;
    if (quote) joined.add(quote.quoteId);
    return buildTradeLine(trade, group, quote, options);
  });
  /* A quote placed with no run yet is a trade waiting for its fill. */
  for (const quote of quotes) if (!joined.has(quote.quoteId)) lines.push(buildTradeLine(null, [], quote, options));
  lines.sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0) || a.tradeKey.localeCompare(b.tradeKey));
  return { lines, unlinked, unreadableOrders: options.unreadableOrders ?? 0 };
}

/** Every trade in the ledger, newest first, and the fills not yet tied to one. */
export async function readLedgerView(store: GuardStore, options: { aggShareBips?: number } = {}): Promise<LedgerView> {
  const rows = ledger(store);
  const [orders, trades, quotes, unreadable] = await Promise.all([rows.valuesWithPrefix("order:"), rows.valuesWithPrefix("trade:"), rows.valuesWithPrefix("quote:"), rows.valuesWithPrefix("unreadable:")]);
  return ledgerViewOf(trades as LedgerTrade[], orders as LedgerOrder[], quotes as LedgerQuote[], { ...options, unreadableOrders: unreadable.length });
}

export type LedgerTotals = Readonly<{
  trades: number;
  byOutcome: Readonly<Record<TradeOutcome, number>>;
  unlinkedOrders: number;
  /** Orders from the list the ledger could not read, kept in quarantine — their money is not in these totals. */
  unreadableOrders: number;
  paper: number;
  zeroWindow: number;
  withReferral: number;
  /** Live trades only: paper never moves money. */
  filledRaw: string;
  feeCollectedRaw: string;
  aggShareRaw: string;
  referralPaidRaw: string;
  netRyntraRaw: string;
  reconciliation: Readonly<Record<Reconciliation, number>>;
  issues: number;
}>;

export function ledgerTotals(view: LedgerView): LedgerTotals {
  const byOutcome: Record<TradeOutcome, number> = { placed: 0, open: 0, filled: 0, partial: 0, cancelled: 0, failed: 0 };
  const reconciliation: Record<Reconciliation, number> = { matched: 0, differs: 0, awaiting_orders: 0 };
  let filled = 0n, fee = 0n, agg = 0n, ref = 0n, net = 0n, paper = 0, zero = 0, withReferral = 0, issues = 0;
  for (const line of view.lines) {
    byOutcome[line.outcome] += 1;
    reconciliation[line.reconciliation] += 1;
    issues += line.issues.length;
    if (line.paper) {
      paper += 1;
      continue;
    }
    if (line.zeroWindow) zero += 1;
    if (line.referral) {
      withReferral += 1;
      ref += big(line.referral.paidRaw);
    }
    filled += BigInt(line.filledRaw);
    fee += BigInt(line.feeCollectedRaw);
    agg += BigInt(line.aggShareRaw);
    net += BigInt(line.netRyntraRaw);
  }
  return {
    trades: view.lines.length,
    byOutcome,
    unlinkedOrders: view.unlinked.length,
    unreadableOrders: view.unreadableOrders,
    paper,
    zeroWindow: zero,
    withReferral,
    filledRaw: String(filled),
    feeCollectedRaw: String(fee),
    aggShareRaw: String(agg),
    referralPaidRaw: String(ref),
    netRyntraRaw: String(net),
    reconciliation,
    issues,
  };
}
