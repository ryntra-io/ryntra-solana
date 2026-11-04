import type { Coin, Side } from '../command/parse.ts';

/**
 * What the agent reads from one sentence (CITY-176): a regular purchase, or an order that waits for a price — a limit
 * the venue fills by itself, or a stop the engine watches. Pure data: the reader fills what was said, the card asks for
 * the rest with taps, and nothing here signs, sends or holds anything.
 */

export type Cadence = 'daily' | 'weekly' | 'monthly';

/** The price that sets an order off: a price in dollars, or a move from the price now, in whole or decimal per cent. */
export type Trigger = Readonly<{ kind: 'price'; price: string }> | Readonly<{ kind: 'move'; pct: number }>;

/**
 * - `recurring` — «buy $20 of SOL every week»: a purchase on a schedule, in dollars (USDC).
 * - `order` — «buy JUP if it drops to 0.7», «sell half my BONK if it falls 10%», «stop on JUP at 0.8»: a limit (filled by
 *   the venue at the price or better) or a stop (watched; the sale is the person's own signature when it is reached).
 *   `mode` null: said without a direction («when it hits 1.2») — the price now decides, never a guess.
 *
 * A buy is sized in dollars (`usd`); a sale in a share of what the wallet holds (`share`, 1–100) or a count of the coin
 * (`count`). A field not said, or said two ways, is null — the card asks for it with taps; `options` carries the two
 * ways when the sentence named both, so the taps offer exactly those.
 */
export type Instruction =
  | Readonly<{
      kind: 'recurring';
      said: string;
      coin: Coin | null;
      usd: string | null;
      cadence: Cadence | null;
      /** ISO weekday, 1 Monday … 7 Sunday, when said («every Monday»). */
      weekday: number | null;
      /** «HH:MM» when said («at 09:30»). */
      time: string | null;
      options: Readonly<{ cadences?: readonly Cadence[] }>;
    }>
  | Readonly<{
      kind: 'order';
      said: string;
      mode: 'limit' | 'stop' | null;
      side: Side;
      coin: Coin | null;
      trigger: Trigger | null;
      usd: string | null;
      share: number | null;
      count: string | null;
      options: Readonly<{ prices?: readonly string[] }>;
    }>;

/** What the card asks next, in this order: the coin, how often, the price, how much. */
export type Missing = 'coin' | 'cadence' | 'trigger' | 'size';

export function missingOf(instruction: Instruction): Missing | null {
  if (!instruction.coin) return 'coin';
  if (instruction.kind === 'recurring') {
    if (!instruction.cadence) return 'cadence';
    if (!instruction.usd) return 'size';
    return null;
  }
  if (!instruction.trigger) return 'trigger';
  if (instruction.side === 'buy' ? !instruction.usd : instruction.share === null && !instruction.count) return 'size';
  return null;
}
