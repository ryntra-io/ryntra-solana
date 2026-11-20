/**
 * The stocks a DLMM Pro pier may stand on.
 *
 * A **stock pier** is a pool of SOL against a token the stocks engine keeps on its shelf (`lib/stocks/**`): a mint the
 * venue verified, tagged as a stock of a named issuer and — where the issuer publishes a list — named on it
 * (`lib/stocks/representations.ts`). Nothing here names a coin: Anthropic's ANT by Backpack Securities was the first, and
 * any other listed company's token the engine checks is one the same way.
 *
 * Only a listed company's token whose issuer still supports a new purchase stands in a pier: not a private company's
 * pre-IPO token (it prices a token, not a share), not one its issuer halted, paused, retired or is converting. What the
 * engine could not read is no stock — new money never goes in on a guess. Whether a deployment serves stock piers at all
 * is `./gate.ts` (`RYNTRA_EARN_PRO_STOCKS`); who reads the shelf is the route's (`./stocks.server.ts`).
 *
 * Pure: no I/O.
 */

/** A stock as a pier carries it: its mint, its ticker and its issuer's name. */
export type StockSeat = Readonly<{ mint: string; symbol: string; issuer: string }>;

/** The shelf's answer for some mints: the ones that are stocks a pier may stand on. */
export type StockSeats = (mints: readonly string[]) => Promise<ReadonlyMap<string, StockSeat>>;

/** No shelf: no coin is a stock. What a test or a rehearsal leaves unsaid, and what a read that failed answers. */
export const NO_STOCKS: StockSeats = async () => new Map();

/** The parts of a stock row of the engine's universe (`lib/stocks/universe.server.ts`, `StockRow`) the rule reads. */
export type StockSeatRow = Readonly<{
  representation: Readonly<{
    mint: string;
    symbol: string;
    issuer: Readonly<{ label: string }>;
    instrument: Readonly<{ class: string }>;
    tradingHalted: boolean | null;
  }>;
  lifecycle: Readonly<{ state: string; tradable: boolean }>;
}>;

/** The longest ticker a pier carries — the contract's own bound. */
const SYMBOL = /^[A-Za-z0-9.]{1,10}$/;
/** The issuer's states in which a new purchase is what it supports. */
const LIVE = new Set(["active", "unknown"]);

/** A stock row as a seat of a pier, or null where it is none: not a listed company's, halted, or not taking new money. */
export function stockSeatOf(row: StockSeatRow): StockSeat | null {
  const { representation: stock, lifecycle } = row;
  if (stock.instrument.class !== "listed-equity") return null;
  if (stock.tradingHalted === true) return null;
  if (!lifecycle.tradable || !LIVE.has(lifecycle.state)) return null;
  const symbol = stock.symbol.trim();
  if (!SYMBOL.test(symbol)) return null;
  const issuer = stock.issuer.label.trim().slice(0, 60);
  if (!issuer) return null;
  return { mint: stock.mint, symbol, issuer };
}

/** The seats among `mints` in a universe's rows. */
export function stockSeatsOf(rows: readonly StockSeatRow[], mints: readonly string[]): ReadonlyMap<string, StockSeat> {
  const wanted = new Set(mints);
  const out = new Map<string, StockSeat>();
  for (const row of rows) {
    if (!wanted.has(row.representation.mint) || out.has(row.representation.mint)) continue;
    const seat = stockSeatOf(row);
    if (seat) out.set(seat.mint, seat);
  }
  return out;
}
