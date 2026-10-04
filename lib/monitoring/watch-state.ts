/**
 * Нагляд за позицією — the state a company position the wallet holds is in,
 * and its one action.
 *
 * A position is watched as a position, not as a plan: the plan it was bought
 * under stops at «Виконано», the position does not. Its exit is the loss limit
 * and the target — of that plan, or of «Ryntra попередить» turned on for the
 * position itself — and a position with neither is told so, always: «Увага:
 * куплено — вихід не налаштований», one amber line and one action.
 *
 * | State | When | One action |
 * |---|---|---|
 * | «Пауза емітента» | the issuer paused the token | «Деталі»: selling is impossible now |
 * | «Дія» | the price reached the loss limit or the target | «Відкрити продаж» |
 * | «Увага: куплено — вихід не налаштований» | held, and no exit is set | «Увімкнути „Ryntra попередить“», or «Підключи Telegram» without a channel |
 * | «Не вдалося перевірити» | an exit is set, but no fresh price | — |
 * | «Увага» | ≤2 % above the limit · an issuer's event · >1 % above the exchange · the exchange closed | «Подивитись» |
 * | «Все за планом» | the price between the limit and the target | — |
 *
 * The states are decided by deterministic rules and prices, never a model:
 * the words are a reader's. A price older than half an hour decides nothing —
 * «Все за планом» is never said on a price nobody saw lately. Pure.
 */

export const WATCH_STATES = ["on-plan", "attention", "action", "issuer-paused", "exit-not-set", "unknown"] as const;
export type WatchState = (typeof WATCH_STATES)[number];

export const WATCH_REASONS = [
  "between",
  "near-limit",
  "issuer-event",
  "above-exchange",
  "exchange-closed",
  "limit",
  "target",
  "issuer-paused",
  "no-exit",
  "no-price",
] as const;
export type WatchReason = (typeof WATCH_REASONS)[number];

export const WATCH_ACTIONS = ["look", "open-sale", "details", "warn", "connect-telegram"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

/** Where a position's exit comes from: the plan it was bought under, or «Ryntra попередить» turned on for it. */
export const WATCH_SOURCES = ["plan", "watch"] as const;
export type WatchSource = (typeof WATCH_SOURCES)[number];

/** Within this share of the price above the loss limit, the position needs a look («до межі ≤2 %»). */
export const NEAR_LIMIT_PCT = 2;
/** Above the exchange by more than this is «Дорого», and a watched position is told. */
export const ABOVE_EXCHANGE_PCT = 1;
/** A price older than this decides nothing — the half hour a rule's fall trusts (`lib/autoinvest/dip.ts`). */
export const WATCH_PRICE_MAX_AGE_MS = 30 * 60_000;

export type WatchExit = Readonly<{
  source: WatchSource;
  /** The loss limit, USD per unit as the wallet shows the token. */
  limit: number;
  /** The target, same unit; null where none is set. */
  target: number | null;
}>;

export type WatchInput = Readonly<{
  /** The token's price, USD per unit as the wallet shows it; null where unread. */
  price: number | null;
  /** When that price was observed (ISO); null where the read did not say. */
  observedAt: string | null;
  nowMs: number;
  /** The position's exit; null where none is set. */
  exit: WatchExit | null;
  /** The issuer says the token is paused. */
  issuerPaused: boolean;
  /** An issuer's event the holder must act on is open for this token. */
  issuerEvent: boolean;
  /** The token against the exchange's current reference, percent; null where there is none. */
  deviationPct: number | null;
  /** The issuer says its exchange is closed now — a weekend or a holiday, from the issuer's own trading period. */
  exchangeClosed: boolean;
  /** A channel Ryntra can warn through is connected (Telegram). */
  channel: boolean;
}>;

export type WatchJudgement = Readonly<{
  state: WatchState;
  reason: WatchReason;
  /** The one action; null where there is nothing to do («Все за планом») or nothing to do yet. */
  action: WatchAction | null;
  /** The price the state was judged on — fresh enough to judge — else null. */
  price: number | null;
  /** How far the price stands above the loss limit, percent of the price; null without a judged price or an exit. */
  toLimitPct: number | null;
}>;

/** A price that may decide: positive, finite, and observed within the half hour. */
export function freshPrice(price: number | null, observedAt: string | null, nowMs: number): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const at = observedAt === null ? Number.NaN : Date.parse(observedAt);
  if (!Number.isFinite(at) || nowMs - at > WATCH_PRICE_MAX_AGE_MS) return null;
  return price;
}

/** An exit that can be judged: a positive limit, and a target only where it stands above the limit. */
function usableExit(exit: WatchExit | null): WatchExit | null {
  if (!exit || !Number.isFinite(exit.limit) || exit.limit <= 0) return null;
  const target = exit.target !== null && Number.isFinite(exit.target) && exit.target > exit.limit ? exit.target : null;
  return { source: exit.source, limit: exit.limit, target };
}

export function judgeWatch(input: WatchInput): WatchJudgement {
  const exit = usableExit(input.exit);
  const price = freshPrice(input.price, input.observedAt, input.nowMs);
  const toLimitPct = exit && price !== null ? ((price - exit.limit) / price) * 100 : null;
  const judged = (state: WatchState, reason: WatchReason, action: WatchAction | null): WatchJudgement => ({ state, reason, action, price, toLimitPct });

  /* Selling is impossible while the issuer holds the token paused: nothing else can be acted on. */
  if (input.issuerPaused) return judged("issuer-paused", "issuer-paused", "details");
  if (exit && price !== null) {
    if (price <= exit.limit) return judged("action", "limit", "open-sale");
    if (exit.target !== null && price >= exit.target) return judged("action", "target", "open-sale");
  }
  /* Bought and not watched is said always — one amber line — whatever else is true of the token. */
  if (!exit) return judged("exit-not-set", "no-exit", input.channel ? "warn" : "connect-telegram");
  /* An exit set and no price to hold it against: never «Все за планом» on a price nobody saw. */
  if (price === null) return judged("unknown", "no-price", null);
  if (toLimitPct !== null && toLimitPct <= NEAR_LIMIT_PCT) return judged("attention", "near-limit", "look");
  if (input.issuerEvent) return judged("attention", "issuer-event", "look");
  if (input.deviationPct !== null && Number.isFinite(input.deviationPct) && input.deviationPct > ABOVE_EXCHANGE_PCT) return judged("attention", "above-exchange", "look");
  if (input.exchangeClosed) return judged("attention", "exchange-closed", "look");
  return judged("on-plan", "between", null);
}
