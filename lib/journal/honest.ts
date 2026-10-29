import { honestPnl, type HonestPnl, type PnlClose, type PnlUnmarked } from "../core/pnl/honest.ts";

/**
 * The Journal by the honest standard (DSC-2, `lib/core/pnl/honest.ts`), in dollars — the paper book and the real fills
 * as two results, never one: a simulated result summed with a real one would read as real performance.
 *
 * - **Paper.** A closed trade's `pnl` is already after its fees (`paper_close`: the move less the entry's and the
 *   exit's fee), so its gross is `pnl + fees` and the fees come off again by the standard — the same figure, with the
 *   fees said. An open paper trade has no mark read here: a part not known, never a zero.
 * - **Real fills.** A closing fill's `closedPnl` is the venue's figure before fees; every fill's fee — the opening ones
 *   too — comes off. Positions still open at the venue are not marked here (the Portfolio reads them): said beside.
 *
 * Pure and client-safe.
 */

type PaperTradeLike = Readonly<{
  id: string;
  market: string;
  entry_price: number;
  size: number;
  fees: number;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
}>;

type FillLike = Readonly<{ tradeId: string; marketDisplayName: string; size: string; price: string; fee: string; closedPnl: string; positionEffect: string; createdAt: number }>;

const seconds = (iso: string | null): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};
const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return typeof value !== "boolean" && value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null;
};
const notional = (price: unknown, size: unknown): number | null => {
  const p = num(price);
  const s = num(size);
  return p !== null && s !== null ? Math.abs(p * s) : null;
};

export function paperHonest(book: Readonly<{ open: readonly PaperTradeLike[]; closed: readonly PaperTradeLike[] }>, nowS: number): HonestPnl {
  const closes: PnlClose[] = book.closed.map((trade) => {
    const pnl = num(trade.pnl);
    const fee = num(trade.fees);
    return { id: `paper:${trade.id}`, asset: trade.market, at: seconds(trade.closed_at), gross: pnl !== null && fee !== null ? pnl + fee : null, fee, capital: notional(trade.entry_price, trade.size) };
  });
  const unmarked: PnlUnmarked[] = book.open.map((trade) => ({ id: `paper:${trade.id}`, asset: trade.market, at: seconds(trade.opened_at), capital: notional(trade.entry_price, trade.size) }));
  return honestPnl({ unit: "USD", nowS, closes, unmarked });
}

export function fillsHonest(fills: readonly FillLike[], nowS: number): HonestPnl {
  const closes: PnlClose[] = fills.map((fill) => {
    const closing = fill.positionEffect?.startsWith("CLOSE") ?? false;
    const at = num(fill.createdAt);
    return {
      id: `arcus:fill:${fill.tradeId}`,
      asset: fill.marketDisplayName,
      /* The venue's time is in milliseconds. */
      at: at === null ? null : Math.floor(at > 1e12 ? at / 1000 : at),
      /* An opening fill made nothing yet; its fee is paid now. */
      gross: closing ? num(fill.closedPnl) : 0,
      fee: num(fill.fee),
      capital: notional(fill.price, fill.size),
    };
  });
  return honestPnl({ unit: "USD", nowS, closes });
}
