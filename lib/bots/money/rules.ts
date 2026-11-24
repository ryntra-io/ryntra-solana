/**
 * «Сітка» and «Сигнали» on the person's budget: the two bots' own rules,
 * pure and client-safe, read by every place that runs them — the agent with money (`lib/mandate/tick.server.ts`,
 * `lib/mandate/bots.server.ts`), the week on paper (`lib/mandate/paper/step.server.ts`), the run on history
 * (`lib/mandate/backtest.ts`) and the screens (`terminal/bots/**`). The plan's text and its bounds stay the mandate's own
 * (`lib/mandate/plans.ts`); this file is the arithmetic of a level and of a condition.
 *
 * A bot is a rule the person sets; it decides nothing beyond it:
 * - **the grid** buys one trade at each level the price comes down to under where it started, and sells that level's
 *   coins once the price stands one step above the level — the level opens again for the next buy. Every sale is weighed
 *   against its own line with the venue's quote for exactly its coins: a level is never sold under the step it waits for.
 * - **a signal** buys on the mandate's rhythm while its condition holds — the price against where it started, the change
 *   over the day, the trading against its pace, or the fast average over the slow — and «cross» sells everything once
 *   the fast average falls under the slow. The person's exit rules (`lib/mandate/exit.ts`) run beside it as on any budget.
 *
 * What the rules never change: the amount of a buy (the trade cap), the day's cap, the rhythm, the venue, where the money
 * lands (the chain lets a sale land only in her own wallet, `lib/mandate/terms.ts` `salePolicyOf`). A figure not read is
 * no guess: the condition is «unread» and the bot waits.
 */

/** One price the bot saw, in whatever unit the reader gives — the rules only compare prices with each other. */
export type PriceMark = Readonly<{ at: number; price: number }>;

/** The day the change and the trading are measured over. */
export const DAY_WINDOW_MS = 86_400_000;

/* ------------------------------------------------------------------ the grid */

/** The grid's level `k` under its anchor: `anchor × (1 − step)^k`. Level −1 is one step above the anchor. */
export const gridLevel = (anchor: number, stepBps: number, k: number): number => anchor * (1 - stepBps / 10_000) ** k;

/** The price a level's coins are sold at: one step above the level — the level before it. */
export const gridSaleLine = (anchor: number, stepBps: number, k: number): number => gridLevel(anchor, stepBps, k - 1);

/** A buy as the book keeps it, as far as the grid reads it. */
export type LotBuy = Readonly<{ at: number; status: string; spentRaw: string; receivedRaw: string | null; level?: number }>;

/** A sale as the book keeps it, as far as the grid reads it; `costRaw` — the cost its coins carried out of the level. */
export type LotSale = Readonly<{ at: number; status: string; soldRaw: string; why: string; level?: number; unsettled?: true; partial?: true; costRaw?: string }>;

/** One level the grid holds: the buy that filled it, its coins and what they cost. */
export type GridLot = Readonly<{ level: number; at: number; coinsRaw: bigint; costRaw: bigint }>;

/** A grid sale of this level that took its coins out: sold, or sent and not read yet — the coins may have left. */
const tookLevel = (sale: LotSale, level: number): boolean => sale.why === "grid" && sale.level === level && (sale.status === "ok" || sale.unsettled === true);

const DIGITS = /^\d{1,30}$/u;
const rawOf = (text: string | null | undefined): bigint => (DIGITS.test(text ?? "") ? BigInt(text!) : 0n);

/**
 * The levels the grid holds now, deepest last: for each level, its newest landed buy that no whole grid sale of that level
 * followed. A sale the day's limit of the sale's policy cut short (`partial`) does not close its level: the
 * level stays held with the coins still in the vault and the cost they still carry, and the rest is sold as the limit
 * comes back — never bought over. The caller hands in the open position's buys and sales only (`lib/mandate/exit.ts`
 * `positionTrades`) — a full exit closed every level. A buy whose coins are not read yet holds its level, with no coins
 * to sell.
 */
export function gridLots(buys: readonly LotBuy[], sales: readonly LotSale[]): GridLot[] {
  const newest = new Map<number, LotBuy>();
  for (const buy of buys) {
    if (buy.status !== "ok" || buy.level === undefined || !Number.isInteger(buy.level) || buy.level < 0) continue;
    const was = newest.get(buy.level);
    if (!was || buy.at >= was.at) newest.set(buy.level, buy);
  }
  const lots: GridLot[] = [];
  for (const [level, buy] of newest) {
    const took = sales.filter((sale) => sale.at >= buy.at && tookLevel(sale, level));
    if (took.some((sale) => sale.partial !== true)) continue;
    const sold = took.reduce((sum, sale) => sum + rawOf(sale.soldRaw), 0n);
    const carried = took.reduce((sum, sale) => sum + rawOf(sale.costRaw), 0n);
    const coins = rawOf(buy.receivedRaw) - sold;
    const cost = BigInt(buy.spentRaw) - carried;
    /* Every coin of the level sold in parts: nothing left to hold — the level is open again. */
    if (took.length > 0 && coins <= 0n) continue;
    lots.push({ level, at: buy.at, coinsRaw: coins > 0n ? coins : 0n, costRaw: cost > 0n ? cost : 0n });
  }
  return lots.sort((a, b) => a.level - b.level);
}

/** The levels the grid holds now — what the rule of a buy reads as taken. */
export const gridHeld = (buys: readonly LotBuy[], sales: readonly LotSale[]): number[] => gridLots(buys, sales).map((lot) => lot.level);

/**
 * The buys a grid that sells is judged by — its pause before a buy, its exit, the rule's position: the levels it holds
 * now. A level sold left with what it fetched; what is left is what the grid stands in. Buys that did not land, or are
 * not read yet, stay as they are: they are the pass's own business (a failure in a row, a fate to read).
 */
export function gridOpenBuys<T extends LotBuy>(buys: readonly T[], sales: readonly LotSale[]): T[] {
  const lots = gridLots(buys, sales);
  return buys.filter((buy) => buy.status !== "ok" || lots.some((lot) => lot.level === buy.level && lot.at === buy.at));
}

/**
 * The level the grid sells now by the price marks: of the levels it holds with coins, the deepest whose line the price
 * stands at — the cheapest coins first. One a pass: the sale is weighed again against its own line with the venue's quote
 * (`gridSaleDue`). Null — none.
 */
export function gridSaleNext(input: Readonly<{ anchor: number | null; stepBps: number; lots: readonly GridLot[]; price: number | null }>): GridLot | null {
  const { anchor, price } = input;
  if (anchor === null || !(anchor > 0) || price === null || !(price > 0)) return null;
  const due = input.lots.filter((lot) => lot.coinsRaw > 0n && price >= gridSaleLine(anchor, input.stepBps, lot.level));
  return due.length ? due.reduce((deepest, lot) => (lot.level > deepest.level ? lot : deepest)) : null;
}

/**
 * Whether the venue's quote for exactly `coinsRaw` of the level's coins is at its line: `quote ÷ coins`, read in the
 * marks' unit (`unitRaw` coins — a whole coin for the agent, the start's trade for the paper), at least one step above
 * the level. A quote not read is no sale.
 */
export function gridSaleDue(input: Readonly<{ anchor: number; stepBps: number; level: number; coinsRaw: bigint; quoteRaw: bigint | null; unitRaw: bigint }>): boolean {
  if (input.quoteRaw === null || input.quoteRaw <= 0n || input.coinsRaw <= 0n || input.unitRaw <= 0n) return false;
  const line = gridSaleLine(input.anchor, input.stepBps, input.level);
  if (!Number.isFinite(line) || !(line > 0)) return false;
  return Number(input.quoteRaw) * Number(input.unitRaw) >= line * Number(input.coinsRaw);
}

/**
 * A level is never sold under what it cost (the lead's review of #1965): the least the sale is sure to bring, after Ryntra's
 * fee — the route's minimum on chain for the agent, the quote less the fee on paper — covers the level's own buy. The step
 * above the level is the rule's line; this is the floor under it, so a step narrower than the fees waits for a price that
 * pays them rather than closing the level at a loss. A figure not read is no sale.
 */
export function gridCoversCost(input: Readonly<{ outRaw: bigint | null; costRaw: bigint }>): boolean {
  return input.outRaw !== null && input.outRaw > 0n && input.costRaw >= 0n && input.outRaw >= input.costRaw;
}

/** The network's base fee of one transaction the agent signs alone, lamports (one signature). */
export const AGENT_SIGNATURE_LAMPORTS = 5_000n;

/** The rent a token account the agent opens holds, lamports (165 bytes under the token program). */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/**
 * What a level's round trip pays the network on top of its cost, lamports of the budget's SOL (the review of
 * #1965: «network fees into the level's floor»): the buy's and the sale's signatures, their priority price — the agent
 * sets none today (`lib/mandate/agent.ts`, `unitPriceMicroLamports` 0) — and the rent of each token account the sale's
 * setup opens and the agent pays for (her wSOL account, the first time). All of it comes out of the SOL she gave the agent
 * for its fees, so a level that only covers its buy still loses: its floor is the cost and these together.
 */
export function gridNetworkRaw(input: Readonly<{ accountsOpened?: number; priorityRaw?: bigint }> = {}): bigint {
  const opened = Number.isInteger(input.accountsOpened) && input.accountsOpened! > 0 ? BigInt(input.accountsOpened!) : 0n;
  const priority = input.priorityRaw !== undefined && input.priorityRaw > 0n ? input.priorityRaw : 0n;
  return 2n * (AGENT_SIGNATURE_LAMPORTS + priority) + opened * TOKEN_ACCOUNT_RENT_LAMPORTS;
}

/* ------------------------------------------------------------------ signals */

/**
 * A signal's condition, with its numbers:
 * - `cross` — the average of the last `fast` prices over the average of the last `slow` (the marks' spacing,
 *   `lib/mandate/tick.server.ts` `MARK_EVERY_MS`); under it, «cross» sells everything;
 * - `above` / `below` — the price at least `bps` over / under where the bot started;
 * - `move` — the price at least `bps` over the day's low (the change);
 * - `volume` — the last 6 hours traded at least `pct` % of the day's 6-hour pace.
 */
export type SignalTrigger =
  | Readonly<{ kind: "cross"; fast: number; slow: number }>
  | Readonly<{ kind: "above"; bps: number }>
  | Readonly<{ kind: "below"; bps: number }>
  | Readonly<{ kind: "move"; bps: number }>
  | Readonly<{ kind: "volume"; pct: number }>;

export const SIGNAL_KINDS = ["cross", "above", "below", "move", "volume"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Every bound of a signal: a condition outside them is not read. */
export const SIGNAL_BOUNDS = Object.freeze({
  fast: { min: 2, max: 48 },
  slow: { min: 3, max: 144 },
  priceBps: { min: 100, max: 5_000 },
  moveBps: { min: 200, max: 5_000 },
  volumePct: { min: 120, max: 1_000 },
});

/** The condition a signal starts with, when a reader names its kind and no numbers: the screen's own defaults. */
export const SIGNAL_DEFAULTS: Readonly<Record<SignalKind, SignalTrigger>> = Object.freeze({
  cross: { kind: "cross", fast: 6, slow: 24 },
  above: { kind: "above", bps: 500 },
  below: { kind: "below", bps: 500 },
  move: { kind: "move", bps: 800 },
  volume: { kind: "volume", pct: 200 },
});

const within = (value: number, bound: Readonly<{ min: number; max: number }>) => Number.isInteger(value) && value >= bound.min && value <= bound.max;

/** Why the condition is not one the bots run; null when it is. */
export function signalRefusal(trigger: SignalTrigger): string | null {
  switch (trigger.kind) {
    case "cross":
      if (!within(trigger.fast, SIGNAL_BOUNDS.fast) || !within(trigger.slow, SIGNAL_BOUNDS.slow)) return "the averages are 2–48 and 3–144 prices";
      return trigger.slow > trigger.fast ? null : "the slow average is longer than the fast";
    case "above":
    case "below":
      return within(trigger.bps, SIGNAL_BOUNDS.priceBps) ? null : "the price is 1 % to 50 % from the start";
    case "move":
      return within(trigger.bps, SIGNAL_BOUNDS.moveBps) ? null : "the change is 2 % to 50 %";
    case "volume":
      return within(trigger.pct, SIGNAL_BOUNDS.volumePct) ? null : "the trading is 1.2x to 10x its pace";
  }
}

/** The condition as text, after `signal:` in the plan: `cross:6:24`, `above:500`, `volume:200`. */
export function signalText(trigger: SignalTrigger): string {
  switch (trigger.kind) {
    case "cross":
      return `cross:${trigger.fast}:${trigger.slow}`;
    case "volume":
      return `volume:${trigger.pct}`;
    default:
      return `${trigger.kind}:${trigger.bps}`;
  }
}

const INT = /^\d{1,6}$/u;

/** A condition from the parts of its text after `signal`; null when any part is missing, not a number or out of bounds. */
export function signalFrom(parts: readonly string[]): SignalTrigger | null {
  const [kind, ...ints] = parts;
  if (!ints.every((part) => INT.test(part))) return null;
  const [a, b] = ints.map(Number);
  let trigger: SignalTrigger | null = null;
  if (kind === "cross" && ints.length === 2) trigger = { kind: "cross", fast: a!, slow: b! };
  else if ((kind === "above" || kind === "below" || kind === "move") && ints.length === 1) trigger = { kind, bps: a! };
  else if (kind === "volume" && ints.length === 1) trigger = { kind: "volume", pct: a! };
  return trigger && signalRefusal(trigger) === null ? trigger : null;
}

/** The coin's trading, USD, as the market's reader answers it; null — not read. */
export type SignalMarket = Readonly<{ volumeH6Usd: number | null; volumeH24Usd: number | null }>;

export type SignalRead = "on" | "off" | "unread";

/**
 * The mean of the last `count` prices; null with fewer: an average over a gap is not the average of its window (the engine's marks come every 10 minutes; one
 * missed for hours would mix a morning's price into the «fast» line). No `maxGapMs` — a history of even bars, read as is.
 */
export function average(marks: readonly PriceMark[], count: number, maxGapMs: number | null = null): number | null {
  if (!Number.isInteger(count) || count < 1 || marks.length < count) return null;
  const window = marks.slice(-count);
  if (maxGapMs !== null) for (let i = 1; i < window.length; i += 1) if (!(window[i]!.at - window[i - 1]!.at <= maxGapMs)) return null;
  let sum = 0;
  for (const mark of window) sum += mark.price;
  return sum / count;
}

/** The lowest price of the last day the bot saw; null with no price. */
export function dayLow(marks: readonly PriceMark[], now: number): number | null {
  let low: number | null = null;
  for (const mark of marks) if (now - mark.at <= DAY_WINDOW_MS && mark.price > 0 && (low === null || mark.price < low)) low = mark.price;
  return low;
}

/**
 * Whether the condition holds now. `marks` — fresh prices only, oldest first (an old price is not the price now: the
 * caller hands none); `anchor` — the first price the bot saw; `market` — the coin's trading, for `volume`; `maxGapMs` —
 * the widest step between two marks an average is read over (the engine's own spacing): wider — «unread».
 */
export function signalNow(trigger: SignalTrigger, input: Readonly<{ marks: readonly PriceMark[]; anchor: number | null; market?: SignalMarket | null; now: number; maxGapMs?: number | null }>): SignalRead {
  if (trigger.kind === "volume") {
    const h6 = input.market?.volumeH6Usd ?? null;
    const h24 = input.market?.volumeH24Usd ?? null;
    if (h6 === null || h24 === null || !Number.isFinite(h6) || !Number.isFinite(h24) || h6 < 0 || !(h24 > 0)) return "unread";
    return h6 * 4 * 100 >= h24 * trigger.pct ? "on" : "off";
  }
  const price = input.marks.at(-1)?.price ?? null;
  if (price === null || !(price > 0)) return "unread";
  switch (trigger.kind) {
    case "cross": {
      const fast = average(input.marks, trigger.fast, input.maxGapMs ?? null);
      const slow = average(input.marks, trigger.slow, input.maxGapMs ?? null);
      if (fast === null || slow === null) return "unread";
      return fast > slow ? "on" : "off";
    }
    case "above":
    case "below": {
      const anchor = input.anchor ?? price;
      const line = anchor * (1 + ((trigger.kind === "above" ? 1 : -1) * trigger.bps) / 10_000);
      return (trigger.kind === "above" ? price >= line : price <= line) ? "on" : "off";
    }
    case "move": {
      const low = dayLow(input.marks, input.now);
      if (low === null) return "unread";
      return price >= low * (1 + trigger.bps / 10_000) ? "on" : "off";
    }
  }
}

/** Whether the signal itself sells everything now: «cross» once the fast average stands under the slow. */
export const signalLeaves = (trigger: SignalTrigger, read: SignalRead): boolean => trigger.kind === "cross" && read === "off";

/** Whether a signal needs the price marks (every one but the trading's). */
export const signalMarks = (trigger: SignalTrigger): boolean => trigger.kind !== "volume";
