/**
 * The codes of «У парі з акцією» with nothing behind them, so the contract and a page can name them without
 * loading the stocks engine: the flag, the line before the signature, why a curve could not be sized, which rule sized
 * it, and the exchange as a pool page reads it (`../../stocks/pool-facts.ts`). The rules are in `./stock-pair.ts`.
 */

/** The environment variable that opens a launch paired with a stock; `open` — open, anything else — closed. */
export const STOCK_PAIR_FLAG = "RYNTRA_LAUNCH_STOCK_PAIR";

/** What a stock's issuer can do to it, and what the exchange is doing — each a code for the line before the signature. */
export const STOCK_PAIR_RISKS = [
  /** A pause stops every transfer of the stock: the curve neither buys nor sells while it lasts. */
  "ISSUER_CAN_PAUSE",
  /** The permanent delegate can take the stock from any account — the curve's vault among them. */
  "ISSUER_CAN_TAKE",
  /** The freeze authority can freeze any account of the stock. */
  "ISSUER_CAN_FREEZE",
  /** The hook's authority can assign a hook program; the curve's swap then stops. */
  "ISSUER_CAN_SET_HOOK",
  /** The exchange is not in its regular session: the dollars are of the last price, and the open may jump. */
  "EXCHANGE_CLOSED",
  /** No source says whether the exchange is open. */
  "EXCHANGE_UNKNOWN",
] as const;
export type StockPairRisk = (typeof STOCK_PAIR_RISKS)[number];

/** Why a curve on a stock could not be sized: no price, no known depth, or a stock too thin to feed even the floor. */
export const STOCK_PAIR_SIZING_REFUSALS = ["PRICE_UNKNOWN", "DEPTH_UNKNOWN", "TOO_THIN"] as const;
export type StockPairThresholdRefusal = (typeof STOCK_PAIR_SIZING_REFUSALS)[number];

/** Which rule set the threshold: the keeper's floor, the stock's depth, or the ceiling. */
export const STOCK_PAIR_BASES = ["floor", "depth", "ceiling"] as const;

/** The exchange as a pool page reads it — the regular session, before or after it, closed, or unknown. */
export const STOCK_PAIR_SESSIONS = ["open", "pre", "post", "closed", "unknown"] as const;
