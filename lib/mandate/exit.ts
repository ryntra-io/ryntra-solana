/**
 * The agent leaves a trade on its own: the stop sells — it does not only stop
 * the buys; half goes at 2x, once; everything goes when the coin's trading fades, and when the person's time is up. A
 * price that was not read is never a sale: the agent waits a little, then pauses and tells her. Pure and client-safe, so
 * the ticket says before her signature the very rules the engine runs (`./tick.server.ts`), and «Скаут» and the
 * practice on paper run the same decision.
 *
 * What the rules decide is only whether, and how much of, what the agent holds for her is sold now. Where the money goes
 * is not theirs to decide: the chain lets a sale land only in her own wallet (`./terms.ts` `heldCoin`). Every figure is
 * the chain's or the venue's — the coins the vault holds, the cost of the buys that brought them, the venue's quote for
 * exactly those coins; nothing is estimated, and a figure not read is null, never zero.
 */

/** The rules the person signs with her budget. Basis points of what the coins cost her; hours of the position's age. */
export type ExitRules = Readonly<{
  /** Sell everything once what it holds is worth this much less than it paid (1 500 — at −15 %). */
  stopBps: number;
  /** Sell half, once, when what it holds is worth this multiple of what it paid (20 000 — 2x); null — off. */
  halfAtBps: number | null;
  /** Sell everything once the last 6 hours traded under this share of the day's 6-hour pace (2 000 — a fifth); null — off. */
  fadeBps: number | null;
  /** Sell everything this many hours after the position's first buy; null — off. */
  holdH: number | null;
}>;

/** Every bound of the rules: a text outside them is not read. */
export const EXIT_BOUNDS = Object.freeze({
  stopBps: { min: 300, max: 5_000 },
  halfAtBps: { min: 12_000, max: 100_000 },
  fadeBps: { min: 500, max: 5_000 },
  holdH: { min: 1, max: 24 * 90 },
});

/** The fade is looked at only after the position is this old: the first half hour of a coin says nothing of its day. */
export const EXIT_FADE_AFTER_MS = 30 * 60_000;

/** A price unread this long while the agent holds coins: it pauses and tells her — it never sells blind. */
export const EXIT_UNREAD_MS = 30 * 60_000;

/**
 * After `FAILURES_TO_PAUSE` sales in a row the chain or the signer said no to (`./strategy.ts`), the agent waits this
 * long before it tries again — and tells her once — rather than paying the network every minute to hear «no». It never
 * stops trying for good: a stop that is not sold is a loss she did not choose. A sale that could not even be built — the
 * network, Jupiter's rate, the route — is no answer of the chain and counts for nothing; the agent tries again next
 * minute, and tells her once if that lasts `EXIT_UNREAD_MS`.
 */
export const EXIT_RETRY_MS = 30 * 60_000;

/**
 * Her stop is the one sale that is not spaced so far: in a fall a stop refused for its minimum (the price ran
 * past the route's 1 % while it landed) is tried again with a fresh route on the next pass, every five minutes, not half
 * an hour later at a deeper loss. Each try costs the network a signature; a loss she did not choose costs more.
 */
export const EXIT_STOP_RETRY_MS = 5 * 60_000;

/** How long after the last «no» the agent tries the sale again: her stop soon, any other sale after a pause. */
export const exitRetryMs = (why: ExitWhy): number => (why === "stop" ? EXIT_STOP_RETRY_MS : EXIT_RETRY_MS);

/** The span the sale's policy counts a day's limit over (`./terms.ts` `heldDailyMax`). */
export const EXIT_DAY_MS = 24 * 3_600_000;

/**
 * The Trader's rules: the stop at the agent's own autostop (−15 %, `./strategy.ts` `AUTOSTOP`), half at 2x, out when the
 * trading fades; no clock — a coin the person named is held while she wants it.
 */
export const TRADER_EXIT: ExitRules = Object.freeze({ stopBps: 1_500, halfAtBps: 20_000, fadeBps: 2_000, holdH: null });

/** «Скаут»'s rules, the AI desk's (`docs/research/agents-desk-2026-11-17/REPORT.md`): −35 %, half at 2x, fade, a day. */
export const SCOUT_EXIT: ExitRules = Object.freeze({ stopBps: 3_500, halfAtBps: 20_000, fadeBps: 2_000, holdH: 24 });

const within = (value: number, bound: Readonly<{ min: number; max: number }>) => Number.isInteger(value) && value >= bound.min && value <= bound.max;

/** Why the rules are not ones the engine runs; null when they are. */
export function exitRefusal(rules: ExitRules): string | null {
  if (!within(rules.stopBps, EXIT_BOUNDS.stopBps)) return "the stop is between 3 % and 50 %";
  if (rules.halfAtBps !== null && !within(rules.halfAtBps, EXIT_BOUNDS.halfAtBps)) return "the half is taken between 1.2x and 10x";
  if (rules.fadeBps !== null && !within(rules.fadeBps, EXIT_BOUNDS.fadeBps)) return "the fade is between 5 % and 50 % of the day's pace";
  if (rules.holdH !== null && !within(rules.holdH, EXIT_BOUNDS.holdH)) return "the clock is between 1 hour and 90 days";
  return null;
}

/* ---------------------------------------------------------------- the rules as text */

/**
 * The rules in a few characters, the one form the book, the routes and the ticket share: `exit:1500:20000:2000:-` — the
 * stop, the half, the fade, the clock; `-` — off.
 */
export function exitText(rules: ExitRules): string {
  const part = (value: number | null) => (value === null ? "-" : String(value));
  return `exit:${rules.stopBps}:${part(rules.halfAtBps)}:${part(rules.fadeBps)}:${part(rules.holdH)}`;
}

const INT = /^\d{1,6}$/u;

/** The rules from their text; null when any part is missing, not a number or outside its bounds. */
export function exitFrom(text: unknown): ExitRules | null {
  if (typeof text !== "string" || text.length > 40) return null;
  const parts = text.split(":");
  if (parts.length !== 5 || parts[0] !== "exit") return null;
  const read = (part: string, optional: boolean): number | null | undefined => {
    if (optional && part === "-") return null;
    return INT.test(part) ? Number(part) : undefined;
  };
  const stopBps = read(parts[1]!, false);
  const halfAtBps = read(parts[2]!, true);
  const fadeBps = read(parts[3]!, true);
  const holdH = read(parts[4]!, true);
  if (stopBps === undefined || stopBps === null || halfAtBps === undefined || fadeBps === undefined || holdH === undefined) return null;
  const rules: ExitRules = { stopBps, halfAtBps, fadeBps, holdH };
  return exitRefusal(rules) ? null : rules;
}

/* ---------------------------------------------------------------- the position and the decision */

/** What the agent holds for her of its coin, as the chain and the venue answer it now. */
export type ExitPosition = Readonly<{
  /** The coins the agent holds for her, base units — the most a sale sells. */
  heldRaw: bigint;
  /** What those coins cost her, base units of the budget's token: the buys' spend, less what earlier sales took out. */
  costRaw: bigint;
  /** Exactly `heldRaw` quoted back into the budget's token at the venue's price now; null — not read. */
  worthRaw: bigint | null;
  /** The position's first buy, ms; null — not known. */
  openedAt: number | null;
  /** The half was taken already in this position. */
  halfTaken: boolean;
}>;

/** The coin's trading, USD, as the market's reader answers it; null — not read. A rule on a figure not read is not applied. */
export type ExitMarket = Readonly<{ volumeH6Usd: number | null; volumeH24Usd: number | null }>;

export const NO_MARKET: ExitMarket = Object.freeze({ volumeH6Usd: null, volumeH24Usd: null });

/**
 * Why the agent sold: her rules — the stop, half at 2x, the fade, the clock: «grid» —
 * one level's coins one step above it (`../bots/money/rules.ts`), «signal» — everything, once the signal turned off.
 */
export type ExitWhy = "stop" | "half" | "fade" | "time" | "grid" | "signal";

/** The sales of a bot's own rule: the agent goes on after them — they pause nothing. */
export type BotWhy = Extract<ExitWhy, "grid" | "signal">;

/**
 * A full exit — everything sold by her rules, the agent pauses after it; the half is the one rule after which it goes on,
 * and a bot's own sales pause nothing.
 */
export const isFullExit = (why: ExitWhy): why is "stop" | "fade" | "time" => why === "stop" || why === "fade" || why === "time";

/** A sale that closes the position: a full exit, or a signal that sold everything; the next buy starts afresh. */
export const closesPosition = (why: ExitWhy): boolean => isFullExit(why) || why === "signal";

export type ExitDecision =
  | Readonly<{ do: "hold" }>
  /** The price was not read: no sale this pass. */
  | Readonly<{ do: "wait"; why: "unread" }>
  /** The price stayed unread: the agent pauses and tells her. */
  | Readonly<{ do: "pause"; why: "unread" }>
  | Readonly<{ do: "sell"; why: ExitWhy; share: 50 | 100; amountRaw: bigint }>;

export type ExitInput = Readonly<{
  rules: ExitRules;
  position: ExitPosition;
  market: ExitMarket;
  now: number;
  /** Since when the price stays unread, ms; null — it was read last time. */
  unreadSince: number | null;
}>;

/**
 * Whether the agent sells now, and how much. Asked on every pass while it holds coins, before any buy. The losses' rules
 * first — the stop, the clock, the fade — then the gain's. A price not read sells nothing; unread for `EXIT_UNREAD_MS`,
 * the agent pauses.
 */
export function exitDecision(input: ExitInput): ExitDecision {
  const { rules, position, market, now } = input;
  if (position.heldRaw <= 0n) return { do: "hold" };
  if (position.worthRaw === null) {
    const since = input.unreadSince ?? now;
    return now - since >= EXIT_UNREAD_MS ? { do: "pause", why: "unread" } : { do: "wait", why: "unread" };
  }
  const all = { share: 100 as const, amountRaw: position.heldRaw };
  const cost = position.costRaw;
  const worth = position.worthRaw;
  if (cost > 0n && worth * 10_000n <= cost * BigInt(10_000 - rules.stopBps)) return { do: "sell", why: "stop", ...all };
  const age = position.openedAt === null ? null : now - position.openedAt;
  if (rules.holdH !== null && age !== null && age >= rules.holdH * 3_600_000) return { do: "sell", why: "time", ...all };
  if (rules.fadeBps !== null && age !== null && age >= EXIT_FADE_AFTER_MS && faded(market, rules.fadeBps)) return { do: "sell", why: "fade", ...all };
  if (rules.halfAtBps !== null && !position.halfTaken && cost > 0n && worth * 10_000n >= cost * BigInt(rules.halfAtBps)) {
    const half = position.heldRaw / 2n;
    if (half > 0n) return { do: "sell", why: "half", share: 50, amountRaw: half };
  }
  return { do: "hold" };
}

/** The last 6 hours traded under `fadeBps` of the day's 6-hour pace: v6 < share × v24 ÷ 4. A figure not read is no fade. */
export function faded(market: ExitMarket, fadeBps: number): boolean {
  const { volumeH6Usd: h6, volumeH24Usd: h24 } = market;
  if (h6 === null || h24 === null || !Number.isFinite(h6) || !Number.isFinite(h24) || h6 < 0 || !(h24 > 0)) return false;
  return h6 * 4 * 10_000 < h24 * fadeBps;
}

/** What is left of the cost once `soldRaw` of `heldRaw` coins is sold: the sold share of it leaves with them. */
export function costAfterSale(costRaw: bigint, heldRaw: bigint, soldRaw: bigint): bigint {
  if (heldRaw <= 0n || soldRaw >= heldRaw) return 0n;
  return costRaw - (costRaw * soldRaw) / heldRaw;
}

/* ---------------------------------------------------------------- the agent's own sales, as the book keeps them */

/** One sale the agent made on its own: public facts only. */
export type AgentSale = Readonly<{
  at: number;
  why: ExitWhy;
  status: "ok" | "failed" | "refused";
  signature: string | null;
  /** The coins it sold, base units. */
  soldRaw: string;
  /** What landed in her wallet, base units of the budget's token; null — not read. */
  gotRaw: string | null;
  /** The cost the sold coins carried out of the position, base units of the budget's token. */
  costRaw: string;
  /** The least the sale itself demanded for her, base units of the budget's token. */
  minOutRaw?: string;
  /** Sent, its fate not read yet: cleared once the chain has answered. */
  unsettled?: true;
  /**
   * The rules asked for more than the day's limit of the sale's policy let go (`./terms.ts` `heldDailyMax`): this sale
   * sold what the day allowed, and the rest is sold as the limit comes back. Never a full exit of the position.
   */
  partial?: true;
  /** The grid's level whose coins a «grid» sale sold. */
  level?: number;
  validUntilHeight?: number;
  reason: string | null;
}>;

/** The sale that closed a position: everything sold by a full exit or a signal — not a part the day's limit held back. */
const closedPosition = (sale: AgentSale): boolean => sale.status === "ok" && closesPosition(sale.why) && sale.partial !== true;

/** The buys of the position open now: those after its last full exit (the stop, the fade, the clock) or signal's sale. */
export function positionTrades<T extends Readonly<{ at: number }>>(buys: readonly T[], sales: readonly AgentSale[]): readonly T[] {
  const lastFull = [...sales].reverse().find(closedPosition);
  return lastFull ? buys.filter((buy) => buy.at > lastFull.at) : buys;
}

/** The sales of the position open now — those after the sale that closed the last one. */
export function positionSales(sales: readonly AgentSale[]): readonly AgentSale[] {
  const lastFull = [...sales].reverse().find(closedPosition);
  return lastFull ? sales.filter((sale) => sale.at > lastFull.at) : sales;
}

/**
 * What the sale's policy still lets out of the vault today, base units: its day's limit less what the agent's sales took
 * out over the last `EXIT_DAY_MS` — sold, or sent and not read yet. Counted over the last whole day, never the program's
 * own period, so it is never more than the chain allows; never below zero.
 */
export function saleRoom(sales: readonly AgentSale[], dailyMax: bigint, now: number): bigint {
  const out = sales.filter((sale) => sale.at > now - EXIT_DAY_MS && tookCoins(sale)).reduce((sum, sale) => sum + BigInt(sale.soldRaw), 0n);
  return dailyMax > out ? dailyMax - out : 0n;
}

/** The sales that took coins out of the position: sold, or sent and not read yet — the coins may have left. */
export const tookCoins = (sale: AgentSale): boolean => sale.status === "ok" || sale.unsettled === true;

/**
 * The position from the book: the buys since the last full exit, less what its sales sold — never more than the vault
 * holds now (`vaultRaw`, the chain's figure; another mandate of hers may route the same coin). `halfTaken` — this position
 * already sold its half.
 */
export function positionOf(
  input: Readonly<{ buys: readonly Readonly<{ at: number; status: string; spentRaw: string; receivedRaw: string | null }>[]; sales: readonly AgentSale[]; vaultRaw: bigint | null; worthRaw?: bigint | null }>,
): Omit<ExitPosition, "worthRaw"> & Readonly<{ unread: boolean }> {
  const lastFull = [...input.sales].reverse().find(closedPosition);
  const since = lastFull?.at ?? -Infinity;
  const buys = positionTrades(input.buys, input.sales).filter((buy) => buy.status === "ok");
  const sales = input.sales.filter((sale) => sale.at > since && tookCoins(sale));
  const unread = buys.some((buy) => buy.receivedRaw === null) || sales.some((sale) => sale.unsettled === true) || input.vaultRaw === null;
  const bought = buys.reduce((sum, buy) => sum + BigInt(buy.receivedRaw ?? "0"), 0n);
  const spent = buys.reduce((sum, buy) => sum + BigInt(buy.spentRaw), 0n);
  const sold = sales.reduce((sum, sale) => sum + BigInt(sale.soldRaw), 0n);
  const carried = sales.reduce((sum, sale) => sum + BigInt(sale.costRaw), 0n);
  const book = bought - sold;
  const held = input.vaultRaw === null ? book : book < input.vaultRaw ? book : input.vaultRaw;
  return {
    heldRaw: held > 0n ? held : 0n,
    costRaw: spent > carried ? spent - carried : 0n,
    openedAt: buys[0]?.at ?? null,
    halfTaken: sales.some((sale) => sale.status === "ok" && sale.why === "half"),
    unread,
  };
}

/* ---------------------------------------------------------------- the event the drive reads */

/**
 * What the agent did that the person hears of at once: kept in the agent's
 * book beside its trades (`./book.server.ts` `BookEntry.events`), the newest `EVENTS_KEPT`, and logged as one JSON line
 * `agent.event`. Public facts only — never a key, never a word of hers.
 *
 * - `sold` — the agent sold on its own: why, how much, what reached her wallet, the cost those coins carried (so the
 *   card of a closed trade shows the real multiple: got ÷ cost), the signature.
 * - `paused` — the agent paused itself after an exit or because it could not see: why.
 * - `exit_failed` — her rules call for a sale and it does not go: three sales in a row refused (`tries`), or none could be
 *   built for `EXIT_UNREAD_MS`; `retryAt` — when it tries again. Once for each such stretch; the drive tells her at once.
 */
export type AgentEvent =
  | Readonly<{ v: 1; kind: "sold"; at: number; policy: string; owner: string; coin: string; why: ExitWhy; share: 50 | 100; soldRaw: string; gotRaw: string | null; costRaw: string; signature: string; partial?: true; level?: number }>
  | Readonly<{ v: 1; kind: "paused"; at: number; policy: string; owner: string; coin: string; why: ExitWhy | "unread" | "refused" }>
  | Readonly<{ v: 1; kind: "exit_failed"; at: number; policy: string; owner: string; coin: string; why: ExitWhy; tries: number; retryAt: number }>;

/** The events a mandate keeps: the newest ones — the drive sends each once, by its `at` and `kind`. */
export const EVENTS_KEPT = 50;

/** The book's events with one more, the newest kept. */
export const withEvent = (events: readonly AgentEvent[] | undefined, event: AgentEvent): readonly AgentEvent[] => [...(events ?? []), event].slice(-EVENTS_KEPT);
