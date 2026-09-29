/**
 * «Популярні компанії», listed by the server (`RYN-BUY-FLOW-001`, subtask 2;
 * contract 1.20.0) — one list for Home, the column beside a company's page
 * and the phone, so every surface shows the same companies in the same order.
 *
 * The shelf's own rule (`shelf.ts`): the listed companies a beginner is shown,
 * one card each, the representation a card stands for chosen by the issuer's
 * catalogue and then the deepest pool, in the published order — the company's
 * trading over the day across its representations, the same for everyone.
 * Beside a company's page the company itself is left out, by its mint and by
 * its name (another issuer's token of the same company is the same company).
 *
 * Pure: rows in, cards out.
 */

import { companyDisplayName, POPULAR_WIDE_COUNT, shelfCompanies, type ShelfCard } from "./shelf.ts";
import type { StockRow } from "./universe.server.ts";

/** How many «Популярне» answers when not asked — Home's wide list — and the most it answers. */
export const POPULAR_LIMIT = POPULAR_WIDE_COUNT;
export const POPULAR_LIMIT_MAX = 24;

/** A card as the list carries it: a listed company, so no premium against an issuer's mark. */
export type PopularCard = Omit<ShelfCard, "premiumPct" | "premiumAt">;

export type PopularOptions = Readonly<{
  /** How many cards, 1 to `POPULAR_LIMIT_MAX`; `POPULAR_LIMIT` when absent. */
  limit?: number;
  /** A company's mint — its page's own company, left out of the list beside it. */
  exclude?: string | null;
}>;

/** The company a mint belongs to, as the shelf names it — so the list beside its page can leave it out. */
function companyOf(rows: readonly StockRow[], mint: string): Readonly<{ mint: string; name: string }> | null {
  const row = rows.find((candidate) => candidate.representation.mint === mint);
  if (!row) return { mint, name: "" };
  const rep = row.representation;
  const privateCompany = rep.instrument?.class === "pre-ipo";
  return { mint, name: companyDisplayName(rep.underlying.name ?? rep.name, privateCompany ? null : rep.underlying.symbol) };
}

/** The popular companies, in the published order, without the one a page stands for. */
export function popularCompanies(rows: readonly StockRow[], options: PopularOptions = {}): PopularCard[] {
  const limit = Math.max(1, Math.min(POPULAR_LIMIT_MAX, Math.floor(options.limit ?? POPULAR_LIMIT)));
  const skip = options.exclude ? companyOf(rows, options.exclude) : null;
  const skipName = skip && skip.name ? skip.name.toLowerCase() : null;
  const cards = shelfCompanies(rows).filter((card) => !(skip && (card.mint === skip.mint || (skipName !== null && card.name.toLowerCase() === skipName))));
  return cards.slice(0, limit).map((card) => ({
    name: card.name,
    ticker: card.ticker,
    mint: card.mint,
    /* An empty or oversized icon address is no icon: the card draws the company's initial instead. */
    icon: card.icon && card.icon.length <= 2048 ? card.icon : null,
    price: card.price,
    change24h: card.change24h,
    volume24h: card.volume24h,
    issuer: card.issuer,
  }));
}
