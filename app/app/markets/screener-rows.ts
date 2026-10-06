import type { ScreenerRow } from "@/lib/markets/screener";
import type { StockRow } from "@/lib/stocks/universe.server";

import { ISSUER_SHORT } from "../stocks/stock-model";

const price = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Number(value.toPrecision(6)));
const percent = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100);
const dollars = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value));

/**
 * One token of the stock universe as a row of «Ринки»: a listed stock or ETF,
 * or a private company's token (PreStocks) — «Це не акція». The figures are
 * the universe's own, the same the stock screener drew: the venue's price and
 * day, the exchange's session, the deviation from the exchange's price, and
 * for a private company the token against the issuer's own valuation.
 */
export function stockScreenerRow(row: StockRow): ScreenerRow {
  const rep = row.representation;
  const privateCompany = rep.instrument?.class === "pre-ipo";
  return {
    kind: privateCompany ? "private" : "stock",
    mint: rep.mint,
    symbol: rep.symbol,
    name: rep.underlying.name ?? rep.name,
    icon: row.market.icon,
    href: `/app/stocks/${encodeURIComponent(rep.symbol)}`,
    price: price(row.market.priceUsd),
    change1h: null,
    change24h: percent(row.market.change24hPct),
    volume24h: dollars(row.market.volume24hUsd),
    liquidity: dollars(row.market.liquidityUsd),
    marketCap: null,
    verified: row.market.verified,
    suspicious: false,
    ageDays: null,
    organic: null,
    topHoldersPct: null,
    devPct: null,
    mintAuthorityOff: null,
    freezeAuthorityOff: null,
    issuer: ISSUER_SHORT[rep.issuer.id],
    period: privateCompany ? null : row.session.period,
    deviation: privateCompany ? null : percent(row.deviationPct),
    markPremium: privateCompany ? percent(row.markPremiumPct ?? null) : null,
    halted: rep.tradingHalted === true,
    tradable: row.lifecycle?.tradable ?? true,
  };
}
