/**
 * Ladders, bundles and orders left behind.
 *
 * A **ladder** is several limit orders of one pair and side at one venue,
 * placed within minutes of each other — the way a person buys a dip in steps.
 * The chain does not know they belong together; the Hangar reads them
 * together by venue, mints and time.
 *
 * A **bundle** is what the person meant to place: the legs a bot's Review
 * listed before the signatures. A bundle whose legs did not all land is
 * **incomplete** — some money sits in orders the person thinks are one bot,
 * and the rest of the plan is not on chain. Without a bundle the Hangar can
 * still tell an incomplete ladder by its own legs: a leg that failed or never
 * left «placing» beside legs that did.
 *
 * An **orphan** is an order that keeps the person's tokens and no longer does
 * what they placed it for:
 * - `expired_open` — Trigger V1 past its expiry: the keeper does not fill it, the tokens wait for a cancel;
 * - `stale_far` — open for a month and more, the market far from its price;
 * - `left_behind` — every other leg of its ladder was cancelled, this one still stands;
 * - `unclaimed` — a DLMM order converted long ago and was never taken back;
 * - `stuck_placing` — a placement Ryntra relayed that no venue has listed since.
 *
 * Pure and client-safe. Times are ISO strings or ms, the clock an argument.
 */

import type { LimitVenue } from "../../solana/limits/model.ts";
import type { HangarOrder } from "./orders.ts";

/** Orders of one pair and side placed this close together are one ladder. */
export const LADDER_WINDOW_MS = 10 * 60_000;
/** How long a bundle's legs may take to show at the venues before a missing one counts as missing. */
export const BUNDLE_SETTLE_MS = 5 * 60_000;
/** A placement no venue lists after this never landed. */
export const STUCK_PLACING_MS = 15 * 60_000;
/** An open order this old, with the market this far from its price, is stale. */
export const STALE_ORDER_MS = 30 * 86_400_000;
export const STALE_FAR_PCT = 40;
/** A converted DLMM order left unclaimed this long is forgotten. */
export const UNCLAIMED_MS = 7 * 86_400_000;

export type Ladder = Readonly<{
  id: string;
  venue: LimitVenue;
  inputMint: string;
  outputMint: string;
  /** Oldest first. */
  orders: readonly HangarOrder[];
}>;

const ms = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : Number.NaN;
};

/**
 * Orders grouped into ladders (two legs or more) and the orders that stand alone. An order without a known placing
 * time (a DLMM order Ryntra did not relay) always stands alone.
 */
export function groupLadders(orders: readonly HangarOrder[]): Readonly<{ ladders: readonly Ladder[]; singles: readonly HangarOrder[] }> {
  const byPair = new Map<string, HangarOrder[]>();
  const singles: HangarOrder[] = [];
  for (const order of orders) {
    if (!Number.isFinite(ms(order.createdAt))) {
      singles.push(order);
      continue;
    }
    const key = `${order.venue}:${order.inputMint}:${order.outputMint}`;
    const list = byPair.get(key) ?? [];
    list.push(order);
    byPair.set(key, list);
  }
  const ladders: Ladder[] = [];
  for (const list of byPair.values()) {
    list.sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.order.localeCompare(b.order));
    let run: HangarOrder[] = [];
    const close = () => {
      if (run.length >= 2) {
        const first = run[0]!;
        ladders.push({ id: `ladder:${first.venue}:${first.order}`, venue: first.venue, inputMint: first.inputMint, outputMint: first.outputMint, orders: run });
      } else singles.push(...run);
      run = [];
    };
    for (const order of list) {
      const last = run[run.length - 1];
      if (last && ms(order.createdAt) - ms(last.createdAt) > LADDER_WINDOW_MS) close();
      run.push(order);
    }
    close();
  }
  ladders.sort((a, b) => ms(b.orders[0]!.createdAt) - ms(a.orders[0]!.createdAt));
  return { ladders, singles };
}

/* ------------------------------------------------------------------ bundles */

export type BundleLeg = Readonly<{ venue: LimitVenue; inputMint: string; outputMint: string; makingRaw: string }>;

/** What a bot's Review listed before the signatures; kept by the page that placed it, as a grid is. */
export type BotBundle = Readonly<{
  id: string;
  /** ms, when the person signed. */
  at: number;
  legs: readonly BundleLeg[];
}>;

const SIGNED_BEFORE_SLACK_MS = 60_000;

/** A leg's order: same venue, mints and amount, placed from the bundle's signing on; each order answers one leg. */
function matchLegs(bundle: BotBundle, orders: readonly HangarOrder[], taken: Set<string>): (HangarOrder | null)[] {
  return bundle.legs.map((leg) => {
    const found = orders.find(
      (order) =>
        !taken.has(`${order.venue}:${order.order}`) &&
        order.venue === leg.venue &&
        order.inputMint === leg.inputMint &&
        order.outputMint === leg.outputMint &&
        order.makingRaw === leg.makingRaw &&
        (!Number.isFinite(ms(order.createdAt)) || ms(order.createdAt) >= bundle.at - SIGNED_BEFORE_SLACK_MS),
    );
    if (!found) return null;
    taken.add(`${found.venue}:${found.order}`);
    return found;
  });
}

export type IncompleteBundle = Readonly<{
  kind: "incomplete_bundle";
  /** The bundle's id, or the inferred ladder's. */
  bundle: string;
  planned: number;
  placed: number;
  /** The orders that did land, still holding the person's tokens or done. */
  orders: readonly string[];
  /** The legs a bundle listed that no venue holds; empty for an inferred ladder, which knows only its own legs. */
  missing: readonly BundleLeg[];
}>;

export type Orphan = Readonly<{
  kind: "orphan";
  venue: LimitVenue;
  order: string;
  reason: "expired_open" | "stale_far" | "left_behind" | "unclaimed" | "stuck_placing";
}>;

export type HangarIssue = IncompleteBundle | Orphan;

const landed = (order: HangarOrder) => order.state !== "FAILED" && order.state !== "PLACING";

/** Bundles whose legs did not all land, checked once each has had time to show. */
export function incompleteBundles(bundles: readonly BotBundle[], orders: readonly HangarOrder[], nowMs: number): IncompleteBundle[] {
  const taken = new Set<string>();
  const out: IncompleteBundle[] = [];
  for (const bundle of [...bundles].sort((a, b) => a.at - b.at)) {
    const matched = matchLegs(bundle, orders, taken);
    if (nowMs - bundle.at < BUNDLE_SETTLE_MS) continue;
    const placed = matched.filter((order): order is HangarOrder => order !== null && landed(order));
    if (placed.length === bundle.legs.length || placed.length === 0) continue;
    out.push({
      kind: "incomplete_bundle",
      bundle: bundle.id,
      planned: bundle.legs.length,
      placed: placed.length,
      orders: placed.map((order) => order.order),
      missing: bundle.legs.filter((_, index) => !matched[index] || !landed(matched[index]!)),
    });
  }
  return out;
}

/** An inferred ladder some of whose legs failed or never landed while others did. */
export function incompleteLadder(ladder: Ladder, nowMs: number): IncompleteBundle | null {
  const failed = ladder.orders.filter((order) => order.state === "FAILED" || (order.state === "PLACING" && nowMs - ms(order.updatedAt || order.createdAt) > STUCK_PLACING_MS));
  const placed = ladder.orders.filter(landed);
  if (failed.length === 0 || placed.length === 0) return null;
  return { kind: "incomplete_bundle", bundle: ladder.id, planned: ladder.orders.length, placed: placed.length, orders: placed.map((order) => order.order), missing: [] };
}

/* ------------------------------------------------------------------ orphans */

export type OrderPrices = Readonly<{
  /** Quote per base the order fills at; null when its decimals are unknown. */
  orderPrice: (order: HangarOrder) => number | null;
  /** Quote per base now; null when not priced. */
  marketPrice: (order: HangarOrder) => number | null;
}>;

/** The orders that keep the person's tokens and no longer do what they were placed for. */
export function orphans(orders: readonly HangarOrder[], ladders: readonly Ladder[], prices: OrderPrices, nowMs: number): Orphan[] {
  const out: Orphan[] = [];
  const ladderOf = new Map<string, Ladder>();
  for (const ladder of ladders) for (const order of ladder.orders) ladderOf.set(`${order.venue}:${order.order}`, ladder);
  for (const order of orders) {
    const at = (reason: Orphan["reason"]) => out.push({ kind: "orphan", venue: order.venue, order: order.order, reason });
    if (order.state === "PLACING") {
      if (nowMs - ms(order.updatedAt || order.createdAt) > STUCK_PLACING_MS) at("stuck_placing");
      continue;
    }
    if (order.venue === "dlmm" && order.canClaim && order.state === "FILLED") {
      const since = ms(order.updatedAt || order.createdAt);
      if (Number.isFinite(since) && nowMs - since > UNCLAIMED_MS) at("unclaimed");
      continue;
    }
    if (order.state !== "OPEN" && order.state !== "PARTIAL") continue;
    if (order.expiredAt !== null && Number.isFinite(ms(order.expiredAt)) && ms(order.expiredAt) <= nowMs) {
      at("expired_open");
      continue;
    }
    const ladder = ladderOf.get(`${order.venue}:${order.order}`);
    if (ladder) {
      const others = ladder.orders.filter((other) => other !== order);
      if (others.length > 0 && others.every((other) => other.state === "CANCELLED" || other.state === "EXPIRED")) {
        at("left_behind");
        continue;
      }
    }
    const age = nowMs - ms(order.createdAt);
    if (age > STALE_ORDER_MS) {
      const price = prices.orderPrice(order);
      const market = prices.marketPrice(order);
      if (price !== null && market !== null && price > 0 && market > 0 && (Math.abs(price - market) / market) * 100 >= STALE_FAR_PCT) at("stale_far");
    }
  }
  return out;
}

