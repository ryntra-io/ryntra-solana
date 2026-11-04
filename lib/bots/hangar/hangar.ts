/**
 * «Ангар» — the read model of every bot a wallet runs (bots hub, stage A).
 *
 * A bot here is the person's own on-chain order or position, or their own
 * reminder rule; nothing in the Hangar holds money or a key:
 *
 * | Bot                | What it is on chain                          | Who fills               |
 * |--------------------|----------------------------------------------|-------------------------|
 * | `grid`             | a DLMM position placed as a grid (B10)       | the pool's own swaps    |
 * | `range_lp`         | any other DLMM / DAMM v2 position            | the pool's own swaps    |
 * | `limit`            | one DLMM limit order or Trigger V1 order     | the pool / Jupiter's keeper |
 * | `ladder`           | several limit orders of one pair and side    | the pool / Jupiter's keeper |
 * | `dca`              | a reminder rule (`lib/autoinvest`)           | the person, one signature a purchase |
 *
 * Once placed, none of them needs a Ryntra signature to work — Ryntra has no
 * key that moves them. Each bot carries its status, its result against
 * holding what went in where the data allow it (with the period it covers),
 * its last fill with the receipt's link, and who fills it. The wallet's
 * issues — incomplete bundles and orphaned orders — and the Trigger V1 sunset
 * note travel beside the bots.
 *
 * Pure and client-safe: every read is an argument, the clock too.
 */

import type { AutoinvestRule } from "../../api/v1/contract.ts";
import type { PositionView } from "../../liquidity/catalog/positions.ts";
import { positionResult, type PositionEntry } from "../../liquidity/catalog/track.ts";
import { explorerTxUrl } from "../../solana/explorer.ts";
import { gridState, type GridBot } from "../grid.ts";
import { groupLadders, incompleteBundles, incompleteLadder, orphans, type BotBundle, type HangarIssue, type Ladder } from "./bundles.ts";
import type { HangarOrder } from "./orders.ts";
import { triggerV1SunsetNote, type SunsetNote } from "./sunset.ts";

export const BOT_KINDS = ["grid", "range_lp", "limit", "ladder", "dca"] as const;
export type BotKind = (typeof BOT_KINDS)[number];

export const BOT_STATUSES = ["working", "waiting", "partial", "out_of_range", "filled", "needs_you", "paused", "closed"] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

/** Why a bot stands where it does, where the status alone does not say. */
export type BotDetail =
  | "all_bought"
  | "all_sold"
  | "above"
  | "below"
  | "settling"
  | "placing"
  | "claim_waiting"
  | "reminder_open"
  | "expired"
  | "failed"
  | "cancelled"
  | null;

export type BotVenue = "meteora_dlmm" | "meteora_damm_v2" | "jupiter_trigger_v1" | "ryntra_reminder";
export type BotFiller = "pool_swaps" | "jupiter_keeper" | "you";

export type VsHold = Readonly<{
  /** The bot now against keeping what went in, both at today's prices, USD; fees counted. */
  usd: number;
  pct: number;
  /** The period the comparison covers, ISO. */
  from: string;
  to: string;
}>;

export type LastFill = Readonly<{ at: string; signature: string; receipt: string }>;

export type HangarBot = Readonly<{
  id: string;
  kind: BotKind;
  venue: BotVenue;
  /** «SOL/USDC», a rule's token. */
  name: string;
  status: BotStatus;
  detail: BotDetail;
  vsHold: VsHold | null;
  /** Fees the position earned, USD; null where the bot earns none or unpriced. */
  feesUsd: number | null;
  lastFill: LastFill | null;
  filler: BotFiller;
  /** Always true in stage A: Ryntra holds no key that moves the bot. */
  noRyntraSignature: true;
  /** Ladders: legs by where they stand. */
  legs: Readonly<{ total: number; filled: number; pending: number; closed: number }> | null;
  refs: Readonly<{ position?: string; pool?: string; orders?: readonly string[]; rule?: string }>;
}>;

export type HangarToken = Readonly<{ symbol: string | null; decimals: number | null; usd: number | null }>;

export type HangarInput = Readonly<{
  wallet: string;
  nowMs: number;
  /** The chain's read of the wallet's pool positions; null — not read. */
  positions: Readonly<{ views: readonly PositionView[]; at: number }> | null;
  /** Grids and entries the page that placed them keeps (`lib/bots/grid.ts`, the pools' entries). */
  grids: readonly GridBot[];
  entries: Readonly<Record<string, PositionEntry>>;
  /** Limit orders at both venues; null — not read. */
  orders: readonly HangarOrder[] | null;
  bundles: readonly BotBundle[];
  /** The wallet's reminder rules; null — not read (they are read only for a proven wallet). */
  rules: readonly AutoinvestRule[] | null;
  tokens: Readonly<Record<string, HangarToken>>;
  sunsetAt?: string | null;
}>;

export type HangarAnswer = Readonly<{
  wallet: string;
  at: number;
  bots: readonly HangarBot[];
  issues: readonly HangarIssue[];
  sunset: SunsetNote | null;
  read: Readonly<{ positions: boolean; orders: boolean; rules: boolean }>;
}>;

const iso = (ms: number) => new Date(ms).toISOString();
const receiptOf = (signature: string, at: string): LastFill => ({ at, signature, receipt: explorerTxUrl("mainnet", signature) });

/* ------------------------------------------------------------------ positions */

function positionBot(view: PositionView, grid: GridBot | undefined, entry: PositionEntry | null): HangarBot {
  const result = positionResult(view, entry);
  const vsHold: VsHold | null = result && entry ? { usd: result.net, pct: result.netPct, from: iso(entry.at), to: iso(view.at) } : null;
  const feesUsd = result ? result.fees : view.unclaimedUsd;
  const venue: BotVenue = view.kind === "dlmm" ? "meteora_dlmm" : "meteora_damm_v2";
  const common = { venue, vsHold, feesUsd, lastFill: null, filler: "pool_swaps" as const, noRyntraSignature: true as const, legs: null, refs: { position: view.address, pool: view.pool } };
  if (grid) {
    const state = gridState(grid, view, null);
    const status: BotStatus = state === "working" ? "working" : state === "waiting" ? "waiting" : "out_of_range";
    const detail: BotDetail = state === "all_bought" || state === "all_sold" ? state : null;
    return { id: `grid:${view.address}`, kind: "grid", name: grid.pair, status, detail, ...common };
  }
  const inRange = view.rangeState === "in_range";
  return { id: `range_lp:${view.address}`, kind: "range_lp", name: view.name, status: inRange ? "working" : "out_of_range", detail: inRange ? null : view.rangeState, ...common };
}

/** A grid the page keeps whose position the read no longer holds: settling while fresh, closed after. */
function missingGrid(grid: GridBot, readAt: number): HangarBot {
  const state = gridState(grid, null, { at: readAt });
  return {
    id: `grid:${grid.position}`,
    kind: "grid",
    venue: "meteora_dlmm",
    name: grid.pair,
    status: state === "closed" ? "closed" : "waiting",
    detail: state === "closed" ? null : "settling",
    vsHold: null,
    feesUsd: null,
    lastFill: null,
    filler: "pool_swaps",
    noRyntraSignature: true,
    legs: null,
    refs: { position: grid.position, pool: grid.pool },
  };
}

/* ------------------------------------------------------------------ orders */

function amountOf(raw: string, token: HangarToken | undefined): number | null {
  if (!token || token.decimals === null || !/^\d+$/.test(raw)) return null;
  return Number(raw) / 10 ** token.decimals;
}

/** What an order got against what it gave, both at today's prices: the order against keeping its input. */
function orderVsHold(orders: readonly HangarOrder[], tokens: HangarInput["tokens"], nowMs: number): VsHold | null {
  let gained = 0;
  let held = 0;
  let from = Number.POSITIVE_INFINITY;
  for (const order of orders) {
    if (order.state === "FAILED") continue;
    const input = tokens[order.inputMint];
    const output = tokens[order.outputMint];
    const making = amountOf(order.makingRaw, input);
    const gave = amountOf(order.filledInputRaw, input);
    const got = amountOf(order.filledOutputRaw, output);
    if (making === null || gave === null || got === null || input?.usd == null || output?.usd == null) return null;
    gained += got * output.usd - gave * input.usd;
    held += making * input.usd;
    const at = Date.parse(order.createdAt);
    if (Number.isFinite(at)) from = Math.min(from, at);
  }
  if (!(held > 0) || !Number.isFinite(from)) return null;
  return { usd: gained, pct: (gained / held) * 100, from: iso(from), to: iso(nowMs) };
}

function lastFillOf(orders: readonly HangarOrder[]): LastFill | null {
  const fills = orders.flatMap((order) => order.fills).filter((fill) => fill.signature && fill.at);
  fills.sort((a, b) => b.at.localeCompare(a.at));
  const last = fills[0];
  return last ? receiptOf(last.signature, last.at) : null;
}

function orderStatus(order: HangarOrder): Readonly<{ status: BotStatus; detail: BotDetail }> {
  switch (order.state) {
    case "PLACING":
      return { status: "waiting", detail: "placing" };
    case "OPEN":
    case "CANCELLING":
      return { status: "waiting", detail: null };
    case "PARTIAL":
      return { status: "partial", detail: null };
    case "FILLED":
      return order.canClaim ? { status: "needs_you", detail: "claim_waiting" } : { status: "filled", detail: null };
    case "EXPIRED":
      return { status: "closed", detail: "expired" };
    case "FAILED":
      return { status: "closed", detail: "failed" };
    default:
      return { status: "closed", detail: "cancelled" };
  }
}

const orderVenue = (order: HangarOrder): BotVenue => (order.venue === "trigger" ? "jupiter_trigger_v1" : "meteora_dlmm");
const orderFiller = (order: HangarOrder): BotFiller => (order.venue === "trigger" ? "jupiter_keeper" : "pool_swaps");

function pairName(order: HangarOrder, tokens: HangarInput["tokens"]): string {
  const name = (mint: string) => tokens[mint]?.symbol ?? `${mint.slice(0, 4)}…`;
  return `${name(order.baseMint)}/${name(order.quoteMint)}`;
}

function limitBot(order: HangarOrder, tokens: HangarInput["tokens"], nowMs: number): HangarBot {
  const { status, detail } = orderStatus(order);
  return {
    id: `limit:${order.venue}:${order.order}`,
    kind: "limit",
    venue: orderVenue(order),
    name: pairName(order, tokens),
    status,
    detail,
    vsHold: orderVsHold([order], tokens, nowMs),
    feesUsd: null,
    lastFill: lastFillOf([order]),
    filler: orderFiller(order),
    noRyntraSignature: true,
    legs: null,
    refs: { orders: [order.order], ...(order.pool ? { pool: order.pool } : {}) },
  };
}

function ladderBot(ladder: Ladder, tokens: HangarInput["tokens"], nowMs: number): HangarBot {
  const legs = ladder.orders.filter((order) => order.state !== "FAILED");
  const filled = legs.filter((order) => order.state === "FILLED").length;
  const pending = legs.filter((order) => order.state === "OPEN" || order.state === "PARTIAL" || order.state === "PLACING" || order.state === "CANCELLING").length;
  const closed = legs.length - filled - pending;
  const claim = legs.some((order) => order.state === "FILLED" && order.canClaim);
  const partial = legs.some((order) => order.state === "PARTIAL");
  let status: BotStatus;
  if (claim) status = "needs_you";
  else if (pending === 0) status = filled > 0 ? "filled" : "closed";
  else status = filled > 0 || partial ? "partial" : "waiting";
  const first = ladder.orders[0]!;
  return {
    id: ladder.id,
    kind: "ladder",
    venue: orderVenue(first),
    name: pairName(first, tokens),
    status,
    detail: claim ? "claim_waiting" : status === "closed" ? "cancelled" : null,
    vsHold: orderVsHold(ladder.orders, tokens, nowMs),
    feesUsd: null,
    lastFill: lastFillOf(ladder.orders),
    filler: orderFiller(first),
    noRyntraSignature: true,
    legs: { total: legs.length, filled, pending, closed },
    refs: { orders: ladder.orders.map((order) => order.order), ...(first.pool ? { pool: first.pool } : {}) },
  };
}

/* ------------------------------------------------------------------ reminders */

function dcaBot(rule: AutoinvestRule): HangarBot {
  const due = rule.occurrences.some((occurrence) => occurrence.state === "due");
  const bought = rule.occurrences
    .filter((occurrence) => occurrence.state === "bought" && occurrence.signature && occurrence.boughtAt)
    .sort((a, b) => (b.boughtAt ?? "").localeCompare(a.boughtAt ?? ""))[0];
  const status: BotStatus = rule.status === "paused" ? "paused" : due ? "needs_you" : "working";
  return {
    id: `dca:${rule.id}`,
    kind: "dca",
    venue: "ryntra_reminder",
    name: rule.name,
    status,
    detail: status === "needs_you" ? "reminder_open" : null,
    /* A reminder's History row keeps what was spent, not how much came in: no honest «vs hold» from it. */
    vsHold: null,
    feesUsd: null,
    lastFill: bought?.signature && bought.boughtAt ? receiptOf(bought.signature, bought.boughtAt) : null,
    filler: "you",
    noRyntraSignature: true,
    legs: null,
    refs: { rule: rule.id },
  };
}

/* ------------------------------------------------------------------ the hangar */

/** Needs the person first, then what works, then what waits; what is over last. */
const STATUS_RANK: Readonly<Record<BotStatus, number>> = { needs_you: 0, out_of_range: 1, partial: 2, working: 3, waiting: 4, paused: 5, filled: 6, closed: 7 };

/** Quote per base an order fills at, from its two amounts. */
function orderPriceOf(order: HangarOrder, tokens: HangarInput["tokens"]): number | null {
  const making = amountOf(order.makingRaw, tokens[order.inputMint]);
  const taking = amountOf(order.takingRaw, tokens[order.outputMint]);
  if (making === null || taking === null || !(making > 0) || !(taking > 0)) return null;
  return order.side === "buy" ? making / taking : taking / making;
}

function marketPriceOf(order: HangarOrder, tokens: HangarInput["tokens"]): number | null {
  const base = tokens[order.baseMint]?.usd;
  const quote = tokens[order.quoteMint]?.usd;
  return base != null && quote != null && base > 0 && quote > 0 ? base / quote : null;
}

export function buildHangar(input: HangarInput): HangarAnswer {
  const bots: HangarBot[] = [];
  const grids = new Map(input.grids.map((grid) => [grid.position, grid]));
  if (input.positions) {
    const held = new Set<string>();
    for (const view of input.positions.views) {
      held.add(view.address);
      bots.push(positionBot(view, grids.get(view.address), input.entries[view.address] ?? null));
    }
    for (const grid of input.grids) if (!held.has(grid.position)) bots.push(missingGrid(grid, input.positions.at));
  }
  const issues: HangarIssue[] = [];
  let sunset: SunsetNote | null = null;
  if (input.orders) {
    const { ladders, singles } = groupLadders(input.orders);
    for (const ladder of ladders) {
      bots.push(ladderBot(ladder, input.tokens, input.nowMs));
      const incomplete = incompleteLadder(ladder, input.nowMs);
      if (incomplete) issues.push(incomplete);
    }
    for (const order of singles) bots.push(limitBot(order, input.tokens, input.nowMs));
    /* A bundle the page kept knows its own legs: its word replaces the inferred one for the same orders. */
    const fromBundles = incompleteBundles(input.bundles, input.orders, input.nowMs);
    const covered = new Set(fromBundles.flatMap((issue) => issue.orders));
    for (let i = issues.length - 1; i >= 0; i -= 1) {
      const issue = issues[i]!;
      if (issue.kind === "incomplete_bundle" && issue.orders.some((order) => covered.has(order))) issues.splice(i, 1);
    }
    issues.push(...fromBundles);
    issues.push(...orphans(input.orders, ladders, { orderPrice: (order) => orderPriceOf(order, input.tokens), marketPrice: (order) => marketPriceOf(order, input.tokens) }, input.nowMs));
    sunset = triggerV1SunsetNote(input.orders, input.nowMs, input.sunsetAt);
  }
  for (const rule of input.rules ?? []) bots.push(dcaBot(rule));
  bots.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.id.localeCompare(b.id));
  return {
    wallet: input.wallet,
    at: input.nowMs,
    bots,
    issues,
    sunset,
    read: { positions: input.positions !== null, orders: input.orders !== null, rules: input.rules !== null },
  };
}
