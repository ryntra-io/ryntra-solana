import { budgetIssue, DAYS_MAX, type AgentBudget } from '../../lib/mandate/budget.ts';
import { EXTENSION, STOCK_MINT_EXTENSIONS } from '../../lib/mandate/mint-features.ts';
import { STEADY, type StrategyPlan } from '../../lib/mandate/plans.ts';
import { passesForStock } from '../../lib/stocks/stock-book.ts';
import { spotLogo } from '../coin/staples.ts';

/**
 * «Recurring buys» of a tokenized stock, on the bot as it is (the mandate's engine, `lib/mandate`): what the
 * form decides apart from its markup. Pure.
 *
 * - The stocks the bot offers are the stocks engine's own shelf of verified companies (`GET /api/v1/stocks/popular`, the
 *   shelf of `lib/stocks/shelf.ts`: xStocks and Backpack, one card a company, the issuer's own token) with their logos —
 *   never a coin that only takes a stock's ticker or name (`passesForStock`, the look-alike rule), and only the cards the
 *   issuer's catalogue names (`catalogued`, contract 1.107.0): the agent's engine buys no token only a venue's tag vouches for.
 * - «A week»: the person writes her budget a week; the bot spends it as the engine spends any budget — the week's
 *   seventh each day, one buy a day — so the money she gives is exactly her weeks' sums.
 * - «Only while the exchange is open» — `hours` in the plan's text (`lib/mandate/plans.ts`): a buy the rhythm allows
 *   waits while the stock's exchange is not in its regular session. On for a stock unless she turns it off; never on a
 *   coin that is no stock.
 */

/** The shelf's companies, as many as the engine lists at once. */
export const STOCKS_READ = '/api/v1/stocks/popular?limit=24';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const TICKER = /^[\p{L}\p{N}.$-]{1,16}$/u;

/** A stock the bot may buy: its token's mint and ticker, the company's name and its logo. */
export type StockCoin = Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;

/**
 * The stocks of an answer of the engine, in its order (the day's trading, the same for everyone); anything out of shape,
 * a second card of one mint, or a ticker that passes for another stock is left out.
 */
export function stockCoinsOf(body: unknown): StockCoin[] {
  const data = (body as { data?: unknown } | null)?.data ?? body;
  const companies = (data as { companies?: unknown } | null)?.companies;
  if (!Array.isArray(companies)) return [];
  const out: StockCoin[] = [];
  for (const card of companies) {
    const c = (card ?? {}) as Record<string, unknown>;
    if (typeof c.mint !== 'string' || !MINT.test(c.mint) || typeof c.ticker !== 'string' || !TICKER.test(c.ticker)) continue;
    /* A card only the venue's tag vouches for is no stock the agent buys (`isShelfStock`): the review would refuse it. */
    if (c.catalogued === false) continue;
    if (out.some((one) => one.mint === c.mint)) continue;
    const coin: StockCoin = {
      mint: c.mint,
      symbol: c.ticker,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : c.ticker,
      /* The engine's own logo route, as every other coin of the terminal: the issuer's picture host is not one the page may load from. */
      icon: spotLogo(c.mint),
    };
    if (passesForStock({ symbol: coin.symbol, mint: coin.mint, name: coin.name, verified: true }) !== null) continue;
    out.push(coin);
  }
  return out;
}

/** The stocks shown at hand: the first `count`, and the one picked where it is further down the list. */
export function stocksShown(stocks: readonly StockCoin[], picked: string | null, count = 8): StockCoin[] {
  const first = stocks.slice(0, count);
  const pick = picked ? stocks.find((one) => one.mint === picked) : undefined;
  return pick && !first.includes(pick) ? [...first.slice(0, count - 1), pick] : first;
}

/** The plan with the exchange's hours on or off — nothing else of it changes; none yet is the steady one. */
export function planWithHours(given: StrategyPlan | null, on: boolean): StrategyPlan {
  const plan = given ?? STEADY;
  if (on) return plan.hours ? plan : { ...plan, hours: true };
  if (!plan.hours) return plan;
  const { hours: _off, ...rest } = plan;
  return rest as StrategyPlan;
}

/** How the person counts her budget: a day (the bot's own fields), or a week. */
export const BUDGET_UNITS = ['day', 'week'] as const;
export type BudgetUnit = (typeof BUDGET_UNITS)[number];

/**
 * The unit after the coin changes (QA 20.11: «A week» stayed on after going back from a stock to JUP): from a stock to a
 * coin that is no stock, the coin's own — «A day»; a unit a sentence chose for this very coin (`said`, its mint) stays,
 * and so does every other change of coin.
 */
export function unitOnCoin(unit: BudgetUnit, change: Readonly<{ wasStock: boolean; isStock: boolean; said: string | null; mint: string | null }>): BudgetUnit {
  return change.wasStock && !change.isStock && change.said !== change.mint ? 'day' : unit;
}

export const WEEK_DAYS = 7;
/** The longest term in weeks: the engine's own longest term. */
export const WEEKS_MAX = Math.floor(DAYS_MAX / WEEK_DAYS);
/** The term a week's budget starts at when she writes none: a quarter. */
export const WEEKS_DEFAULT = 12;

/** A day's part of a week is cut down to this — 0.0001 SOL — so the day reads at a glance and never adds up to more than her week. */
export const DAY_STEP_LAMPORTS = 100_000n;

/**
 * Her budget a week as the engine's budget: the week's seventh a day (cut down to `DAY_STEP_LAMPORTS`), one buy of it a
 * day, for her weeks. Null when the numbers are not a budget the engine takes (`budgetIssue`: a day under the least
 * trade, a term out of range).
 */
export function weekBudget(perWeek: bigint, weeks: number): AgentBudget | null {
  if (perWeek <= 0n || !Number.isInteger(weeks) || weeks < 1 || weeks > WEEKS_MAX) return null;
  const perDay = (perWeek / BigInt(WEEK_DAYS) / DAY_STEP_LAMPORTS) * DAY_STEP_LAMPORTS;
  if (perDay <= 0n) return null;
  const budget: AgentBudget = { perDay, perTrade: perDay, days: weeks * WEEK_DAYS };
  return budgetIssue(budget) === null ? budget : null;
}

/** A budget read back as a week's: the week's sum and the weeks, when it is one `weekBudget` makes; null otherwise. */
export function weekOf(budget: AgentBudget | null): Readonly<{ perWeek: bigint; weeks: number }> | null {
  if (!budget || budget.perTrade !== budget.perDay || budget.days % WEEK_DAYS !== 0) return null;
  return { perWeek: budget.perDay * BigInt(WEEK_DAYS), weeks: budget.days / WEEK_DAYS };
}

/**
 * What every stock's mint on the shelf gives its issuer (xStocks and Backpack, read from mainnet): a permanent delegate, a
 * pause, a program it may name to check transfers, hidden amounts, a scaled amount, and the state a new wallet starts in.
 */
export const STOCK_MINT_FEATURES: readonly number[] = Object.freeze([
  EXTENSION.PermanentDelegate,
  EXTENSION.PausableConfig,
  EXTENSION.TransferHook,
  EXTENSION.ConfidentialTransferMint,
  EXTENSION.ScaledUiAmountConfig,
  EXTENSION.DefaultAccountState,
]);

/**
 * Whether the agent's engine buys a tokenized stock. The engine's rule on Token-2022 coins refuses every one of a stock's
 * features on any coin (`lib/mandate/token-2022.ts`), and takes them only on a mint of the shelf of verified companies,
 * under the stock's own conditions — its own narrow list, `STOCK_MINT_EXTENSIONS`, never the common one. The form's
 * signature opens exactly when that list holds every feature a stock's mint has; without one of them a mandate signed
 * for a stock would buy nothing, and the form says the signature is coming (`stock-buys.test.mjs` keeps the two together).
 */
export const ENGINE_BUYS_STOCKS = STOCK_MINT_FEATURES.every((type) => STOCK_MINT_EXTENSIONS.includes(type));

/**
 * The stocks' group in «Recurring buys» — the group, the day-or-week budget, the exchange over the chart and the
 * issuer's lines — only where the build opens it (exactly `open`). Closed, the bot's card is the one it always was.
 * This switch only decides what the card offers: the engine and the agent's signer take a stock only where the server's
 * own switch is open too (`RYNTRA_BOTS_STOCKS`, `lib/mandate/stocks.server.ts`) — without it a budget for a stock is
 * refused before a signature.
 */
export const BOTS_STOCKS_OPEN = process.env.NEXT_PUBLIC_RYNTRA_BOTS_STOCKS === 'open';

/** What the bot's card adds for stocks: everything with the switch open, nothing with it closed. */
export function stockPartsOn<T>(open: boolean, parts: T): T | undefined {
  return open ? parts : undefined;
}
