import { createHash } from "node:crypto";

import { z } from "zod";

import { REWARD_RANKS } from "../rewards/rules.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { positionSteps } from "./trader-pnl.ts";

/**
 * Trade cards — a picture of one trade through Ryntra, to post on X with the
 * person's own invitation link.
 *
 * ## A card is a receipt, drawn
 *
 * Every figure on a card comes from the wallet's own settled swaps — the same
 * rows and the same average-cost rule as the traders' board
 * (`trader-pnl.ts`). A sale's result is what the sold tokens brought against
 * what was paid for them through Ryntra; a token that came from somewhere
 * else, or a buy whose dollar value was not measured, has no known cost, and
 * a sale of only such tokens has no result — so it gets no result card,
 * rather than one that turns a transfer-in into profit. Nothing is priced
 * later: an open position has no result, and a buy card says only what was
 * paid and when.
 *
 * ## A loss is drawn like a profit
 *
 * The same size, the same place, its own sign and colour. There is no choice
 * of «only my wins»: the list offers every measured trade, newest first.
 *
 * ## Frozen once made
 *
 * A card is written once with its figures, the rank of that moment and the
 * person's code, and its address carries a version of exactly that — so the
 * picture X caches is the picture the record describes, and a card that
 * looks different (another language, dollars shown) is another card.
 */

/** The revision of the card's drawing: a new one gives every card a new version, so X fetches it again. */
export const TRADE_CARD_ART_REVISION = "2026-10-06.1";

export const TRADE_CARD_SCHEMA = "ryntra.growth.trade-card";

export type TradeKind = "SELL" | "BUY";

/** One trade a card can be made of, measured from the receipts. */
export type TradeMoment = Readonly<{
  /** The receipt's id — the swap's signature. */
  actionId: string;
  kind: TradeKind;
  mint: string;
  /** What the receipt itself calls the token, if anything. */
  symbol: string | null;
  decimals: number | null;
  /** When the trade settled. */
  at: string;
  /** SELL: when the position it closed was opened (its first buy since it was last empty). */
  openedAt: string | null;
  /** SELL: what the closed part cost; BUY: what was paid. USD micros. */
  costMicros: bigint;
  /** SELL: what the closed part brought; BUY: null. */
  proceedsMicros: bigint | null;
  /** SELL: the closed part with a known cost; BUY: what arrived. Raw base units. */
  quantityRaw: bigint;
  /** SELL: the result in hundredths of a percent, rounded toward zero. */
  resultBps: number | null;
}>;

/**
 * Every trade of `wallet` a card can be made of, newest first: each sale
 * with a measured result, and each buy with a measured price. A swap of one
 * token for another is both — the sale of the first and the buy of the
 * second, in that order.
 */
export function shareableTrades(actions: readonly SolanaWalletAction[], wallet: string): readonly TradeMoment[] {
  const groups: TradeMoment[][] = [];
  for (const { action, sale, buy } of positionSteps(actions, wallet)) {
    const moments: TradeMoment[] = [];
    if (sale) {
      moments.push({
        actionId: action.actionId,
        kind: "SELL",
        mint: sale.mint,
        symbol: sale.symbol,
        decimals: sale.decimals,
        at: action.startedAt,
        openedAt: sale.openedAt,
        costMicros: sale.cost,
        proceedsMicros: sale.proceeds,
        quantityRaw: sale.quantity,
        resultBps: Number(((sale.proceeds - sale.cost) * 10_000n) / sale.cost),
      });
    }
    if (buy) {
      moments.push({
        actionId: action.actionId,
        kind: "BUY",
        mint: buy.mint,
        symbol: buy.symbol,
        decimals: buy.decimals,
        at: action.startedAt,
        openedAt: null,
        costMicros: buy.value,
        proceedsMicros: null,
        quantityRaw: buy.quantity,
        resultBps: null,
      });
    }
    if (moments.length > 0) groups.push(moments);
  }
  return groups.reverse().flat();
}

/** A trade's own key: one swap can be a sale and a buy. */
export function tradeKey(moment: Pick<TradeMoment, "actionId" | "kind">): string {
  return `${moment.kind}:${moment.actionId}`;
}

const MICROS = /^(0|[1-9][0-9]*)$/;

export const TradeCardSchema = z
  .object({
    schema: z.literal(TRADE_CARD_SCHEMA),
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9]{20}$/),
    wallet: z.string().min(32).max(44),
    /** The person's invitation code, carried by the card's link. */
    code: z.string().min(1).max(32),
    locale: z.enum(["en", "uk"]),
    /** Dollar figures on the card — only when the person chose them. */
    amounts: z.boolean(),
    /** The rank at the moment the card was made; null when hidden from the boards or unknown. */
    rank: z.enum(REWARD_RANKS).nullable(),
    token: z
      .object({
        mint: z.string().min(32).max(44),
        symbol: z.string().min(1).max(16),
        name: z.string().max(64).nullable(),
        icon: z.string().max(512).nullable(),
        /** A tokenized stock carries the stock line under the card. */
        stock: z.boolean(),
      })
      .strict(),
    trade: z
      .object({
        actionId: z.string().min(1).max(128),
        kind: z.enum(["SELL", "BUY"]),
        at: z.string(),
        openedAt: z.string().nullable(),
        costMicros: z.string().regex(MICROS),
        proceedsMicros: z.string().regex(MICROS).nullable(),
        quantityRaw: z.string().regex(MICROS),
        decimals: z.number().int().min(0).max(18).nullable(),
        resultBps: z.number().int().nullable(),
      })
      .strict(),
    createdAt: z.string(),
  })
  .strict();

export type TradeCard = z.output<typeof TradeCardSchema>;

/**
 * The card's id: the wallet, the trade and how it is drawn. The same request
 * gives the same card, so sharing twice never makes two.
 */
export function tradeCardId(args: Readonly<{ wallet: string; key: string; locale: "en" | "uk"; amounts: boolean }>): string {
  return createHash("sha256")
    .update(`${TRADE_CARD_SCHEMA}|${args.wallet}|${args.key}|${args.locale}|${args.amounts ? 1 : 0}`)
    .digest("hex")
    .slice(0, 20);
}

/** The version in the picture's address: the drawing's revision and every figure on it. */
export function tradeCardVersion(card: TradeCard): string {
  const { createdAt: _created, ...drawn } = card;
  return createHash("sha256").update(`${TRADE_CARD_ART_REVISION}|${JSON.stringify(drawn)}`).digest("hex").slice(0, 12);
}

/** The page a card is shared as: the person's invitation with the card on it. */
export function tradeCardPath(card: Pick<TradeCard, "code" | "id">): string {
  return `/r/${encodeURIComponent(card.code)}/c/${card.id}`;
}

/** The picture itself, versioned. */
export function tradeCardImagePath(card: TradeCard): string {
  return `/api/growth/cards/${card.id}/image?v=${tradeCardVersion(card)}`;
}

/** A token's short name when nothing names it: four and four of the mint. */
export function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** Whole days between two moments, at least one when they differ. */
export function heldDays(from: string | null, to: string): number | null {
  if (!from) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * The average price of one whole token, in dollars — for display only: the
 * figures it comes from are exact, the division into a float is not money.
 */
export function unitPrice(micros: bigint, quantityRaw: bigint, decimals: number | null): number | null {
  if (decimals === null || quantityRaw <= 0n) return null;
  const tokens = Number(quantityRaw) / 10 ** decimals;
  if (!(tokens > 0)) return null;
  return Number(micros) / 1_000_000 / tokens;
}
