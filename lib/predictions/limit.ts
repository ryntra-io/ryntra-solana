/**
 * Limit orders of Ryntra Predictions: the Review, the one send, the state the
 * person sees, and the cancel that takes back whatever has not filled.
 *
 * The shape of it, step by step:
 *
 * 1. **Review.** The person names a price, an amount and how long the order
 *    stands. Ryntra reads the market and its book, moves the price onto the
 *    venue's grid in the person's favour, and states the arithmetic: the
 *    contracts, Ryntra's fee, the venue's own fee (unknown before the fill
 *    and said to be unknown), what it pays if the outcome wins, and what
 *    happens if it never fills. The Review is stored under its own id.
 * 2. **One Review, one order.** Confirming it turns the record from
 *    `reviewed` to `sending` with a compare-and-set: a second click, a second
 *    tab or a late retry finds it taken and gets the record as it stands.
 *    Ryntra's own id for the Review is the venue's `clientOrderId`, so even a
 *    send with no clear answer can only ever be the same one order.
 * 3. **The state.** Whatever the venue says is what the record says —
 *    accepted, partly filled, filled, cancelled, lapsed. Nothing is called
 *    finished on a read that failed: a reconnect reads the provider's own
 *    list and finds the order by that id rather than sending another.
 * 4. **The cancel.** One act on what is still working; a part already filled
 *    stays filled.
 *
 * **Paper by default.** The provider's limit call takes no mode — it has no
 * paper limit order — so with `PREDICTIONS_LIVE_*` switched off the order is
 * Ryntra's own simulation over the venue's real book: it fills only at or
 * below the price named, never more than the book shows, lapses at its own
 * expiry, and is marked a simulation everywhere a person reads it. No money
 * moves and no venue is told anything.
 *
 * Notifications go out through the one prediction channel (`notify/**`), the
 * same one settlement uses; nothing here is a second channel.
 *
 * Server only. The shapes, the grid and the arithmetic are in
 * `limit-model.ts`, which the browser reads too.
 */

import { randomBytes } from "node:crypto";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure } from "./failure.ts";
import type { LiveBalance } from "./funding.ts";
import {
  LIMIT_ID,
  LIMIT_MAX_AMOUNT_USD,
  LIMIT_MIN_AMOUNT_USD,
  LIMIT_PRICE_MAX,
  LIMIT_PRICE_MIN,
  LIMIT_REVIEW_MAX_AGE_S,
  LIMIT_UNSEEN_GRACE_MS,
  alignLimitPrice,
  bookEdges,
  isLimitLife,
  limitCancellable,
  limitExpiryAt,
  limitFigures,
  limitFillAgainstBook,
  limitSignature,
  limitStateOf,
  limitTimeInForce,
  limitWorking,
  type LimitFigures,
  type LimitLife,
  type LimitOrderState,
} from "./limit-model.ts";
import { liveVenuesFor, readLiveSettings, type TradeMode } from "./live.ts";
import type { PaperBalance, PredictionBook, PredictionBookLevel, PredictionEvent } from "./model.ts";
import { deliverNotes, listNotes, note, pruneNotes, readPrefs, type Note, type NotifyTransports } from "./notify/channel.ts";
import { limitNoteWords, type NoteLocale } from "./notify/words.ts";
import { readPredictionPlan, type PredictionPlan } from "./plan.ts";
import type { PredictionProvider, Result } from "./provider.ts";
import { linkStatus, withProviderSession, type LinkStatus } from "./session.ts";

export * from "./limit-model.ts";

const COLLECTION = "predictionOrders" as const;
const KEY_PREFIX = "limit:solana:mainnet:";

function rows(store: GuardStore) {
  return store.versioned<PredictionLimitRecord>(COLLECTION);
}
export function limitKey(wallet: string, id: string): string {
  return `${KEY_PREFIX}${wallet}:${id}`;
}
function newLimitId(): string {
  return `plim_${randomBytes(12).toString("hex")}`;
}

/** How many of a wallet's working orders one pass reconciles. */
const RECONCILE_PER_PASS = 8;
/** How many records a wallet keeps in its list. */
const LIST_LIMIT = 50;

/* ------------------------------------------------------------- the Review */

export type LimitCheckState = "pass" | "warn" | "fail";
export type LimitCheck = Readonly<{ id: string; state: LimitCheckState; detail: string; figure: string | null }>;

export type LimitReview = Readonly<{
  /** `live` — real USDC held by the provider; `paper` — Ryntra's own simulation over the venue's book. */
  mode: TradeMode;
  id: string;
  event: Readonly<{ id: string; title: string; endDate: string | null }>;
  market: Readonly<{ id: string; question: string; venue: string; tickSize: number | null; minOrderSize: number | null }>;
  outcome: Readonly<{ id: string; label: string }>;
  side: "buy";
  /** The price the person named, and the one the venue's grid takes. */
  askedPrice: number;
  amountUsd: number;
  figures: LimitFigures;
  life: LimitLife;
  timeInForce: "GTC" | "GTD";
  /** When the order lapses by itself; null — it stands until it is cancelled. */
  expiresAt: string | null;
  /** The market's own book when the Review was built; null when it could not be read. */
  book: Readonly<{ bestAsk: number | null; bestBid: number | null; tickSize: number | null; readAt: string }> | null;
  /** The price is at or above the best ask: part of it, or all of it, fills the moment it is placed. */
  fillsAtOnce: boolean;
  balance: PaperBalance | null;
  checks: readonly LimitCheck[];
  warnings: readonly string[];
  plan: Readonly<{ id: string; version: number; checks: readonly LimitCheck[] }> | null;
  canPlace: boolean;
  blockedBy: readonly string[];
  /** The ticket this Review belongs to: a ticket changed in any of its parts makes it stale. */
  signature: string;
  reviewedAt: string;
  /** Past this the figures are re-read before anything is placed. */
  reviewExpiresAt: string;
}>;

export type PredictionLimitRecord = Readonly<{
  version: number;
  wallet: string;
  id: string;
  mode: TradeMode;
  eventId: string;
  eventTitle: string;
  venueMarketId: string;
  question: string;
  outcomeId: string;
  outcomeLabel: string;
  venue: string;
  side: "buy";
  review: LimitReview;
  planId: string | null;
  planVersion: number | null;
  state: LimitOrderState;
  /** The cancel has been asked for and the venue has not finished it. */
  cancelRequested: boolean;
  providerOrderId: string | null;
  /** The venue's own word for the order's state, as last read. */
  providerStatus: string | null;
  /** What the provider holds against the order while it stands; null when it states none. */
  reservedUsd: number | null;
  filledShares: number;
  filledUsd: number;
  avgFillPrice: number | null;
  expiresAt: string | null;
  error: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type LimitLocale = "en" | "uk";

const WORDS = {
  en: {
    modePaper: "Simulation: Ryntra fills this order against the venue's own book, so you can see how a limit order behaves. No venue is told anything, no funds move, and a simulated fill does not become a position in the simulated account — the provider has no paper limit order of its own.",
    modeLive: "Real money: USDC from your predictions balance, held by AGG. The venue receives a real resting order.",
    priceOut: (min: string, max: string) => `A price is a probability between ${min} and ${max}.`,
    priceOk: (price: string) => `You pay at most ${price} a share.`,
    priceMoved: (asked: string, price: string, tick: string) => `The venue's grid is ${tick}: ${asked} becomes ${price}, in your favour.`,
    amountLow: (min: string) => `The amount is below the ${min} minimum.`,
    amountHigh: (max: string) => `The amount is above the ${max} ceiling.`,
    amountOk: (amount: string) => `${amount} at most, fees included.`,
    liveAmountHigh: (max: string) => `A live order is at most ${max} for now.`,
    sizeNone: "That amount buys nothing at that price.",
    sizeOk: (n: string) => `${n} shares at the price named.`,
    sizeBelowMin: (min: string) => `The venue's smallest order on this market is ${min} shares; the venue checks the size again and may refuse it.`,
    balanceShort: (cash: string, total: string) => `The available balance (${cash}) does not cover ${total}.`,
    balanceOk: (cash: string) => `Available balance ${cash} covers it.`,
    balanceUnknown: "The balance could not be read; a live order needs it read first.",
    balancePaper: "The simulated balance could not be read before this Review.",
    liveVenueClosed: (venue: string) => `This market trades on ${venue}, where live orders are not open yet.`,
    liveVenueOk: (venue: string) => `Live orders are open on ${venue}.`,
    marketGone: "The market is no longer in this event.",
    marketResolved: "The market has resolved; nothing more can be placed on it.",
    marketClosed: "The market is closed to new orders.",
    marketUnknown: "The market's state is not stated by the provider.",
    marketOpen: "The market is open.",
    outcomeGone: "The outcome is not part of this market any more.",
    expiryAt: (when: string) => `It stands until ${when} UTC and then lapses by itself.`,
    expiryGtc: "It stands until you cancel it.",
    expiryPastEnd: "It stands past the event's own close; after the close nothing more fills.",
    fillNow: (ask: string) => `The best ask is ${ask}: part of this order, or all of it, fills the moment it is placed.`,
    fillRest: (ask: string) => `The best ask is ${ask}: this order rests until someone sells at your price.`,
    fillNoBook: "The book could not be read, so whether it fills at once is not known.",
    venueFee: "The venue takes its own fee out of what actually fills, and does not name it before the fill. The receipt of the filled order carries it.",
    notFilled: "If it never fills: nothing is spent, the amount stays yours, and the order ends by itself or when you cancel it.",
    notFilledPaper: "If it never fills: nothing happens — this is a simulation either way.",
    planNotActive: (status: string) => `The plan is ${status}; only an active plan is executed.`,
    planActive: "The plan is active.",
    planOtherOutcome: (label: string, question: string) => `The plan is for “${label}” on “${question}”, not this outcome.`,
    planOutcome: (label: string) => `The plan's outcome: ${label}.`,
    planAmountOver: (allowed: string, asked: string) => `The plan allows ${allowed}; this order asks ${asked}.`,
    planAmountOk: (allowed: string) => `Within the plan's ${allowed}.`,
    planBoundOver: (price: string, bound: string) => `The price ${price} is above the plan's bound of ${bound}.`,
    planBoundOk: (price: string, bound: string) => `${price} is within the plan's bound of ${bound}.`,
    planNoBound: (price: string) => `No bound set; this order pays at most ${price}.`,
    planDeadlinePassed: "The plan's resolution deadline has passed.",
    planDeadline: (date: string) => `Resolution expected by ${date}.`,
  },
  uk: {
    modePaper: "Симуляція: Ryntra виконує цей ордер за справжнім стаканом майданчика, щоб ви побачили, як лімітка поводиться. Майданчику нічого не повідомляють, кошти не рухаються, а симульоване виконання не стає позицією на симульованому рахунку — своїх paper-лімітних ордерів у постачальника немає.",
    modeLive: "Справжні гроші: USDC з вашого балансу прогнозів, який тримає AGG. Майданчик отримує справжній ордер у стакан.",
    priceOut: (min: string, max: string) => `Ціна — це ймовірність між ${min} і ${max}.`,
    priceOk: (price: string) => `Ви платите щонайбільше ${price} за акцію.`,
    priceMoved: (asked: string, price: string, tick: string) => `Крок цін майданчика — ${tick}: ${asked} стає ${price}, на вашу користь.`,
    amountLow: (min: string) => `Сума нижча за мінімум ${min}.`,
    amountHigh: (max: string) => `Сума вища за стелю ${max}.`,
    amountOk: (amount: string) => `Щонайбільше ${amount} разом із комісіями.`,
    liveAmountHigh: (max: string) => `Справжній ордер поки що — щонайбільше ${max}.`,
    sizeNone: "За цією ціною ця сума не купує нічого.",
    sizeOk: (n: string) => `${n} акцій за названою ціною.`,
    sizeBelowMin: (min: string) => `Найменший ордер майданчика на цьому ринку — ${min} акцій; майданчик перевіряє розмір ще раз і може відмовити.`,
    balanceShort: (cash: string, total: string) => `Доступний баланс (${cash}) не покриває ${total}.`,
    balanceOk: (cash: string) => `Доступний баланс ${cash} покриває це.`,
    balanceUnknown: "Баланс не вдалося прочитати; для справжнього ордера його треба прочитати спершу.",
    balancePaper: "Симульований баланс не вдалося прочитати перед цим Review.",
    liveVenueClosed: (venue: string) => `Цей ринок торгується на ${venue}, де справжні ордери ще не відкрито.`,
    liveVenueOk: (venue: string) => `Справжні ордери відкрито на ${venue}.`,
    marketGone: "Ринку більше немає в цій події.",
    marketResolved: "Ринок вирішено; на нього більше нічого не розмістити.",
    marketClosed: "Ринок закрито для нових ордерів.",
    marketUnknown: "Постачальник не вказує стан ринку.",
    marketOpen: "Ринок відкритий.",
    outcomeGone: "Цього наслідку більше немає в ринку.",
    expiryAt: (when: string) => `Стоїть до ${when} UTC і далі гасне сам.`,
    expiryGtc: "Стоїть, доки ви його не скасуєте.",
    expiryPastEnd: "Стоїть довше, ніж триває сама подія; після її закриття більше нічого не виконається.",
    fillNow: (ask: string) => `Найкраща ціна продажу — ${ask}: частина цього ордера або весь він виконається одразу.`,
    fillRest: (ask: string) => `Найкраща ціна продажу — ${ask}: ордер чекає, поки хтось продасть за вашою ціною.`,
    fillNoBook: "Стакан не вдалося прочитати, тож чи виконається ордер одразу — невідомо.",
    venueFee: "Майданчик бере свою комісію з того, що справді виконалося, і до виконання її не називає. Вона є у квитанції виконаного ордера.",
    notFilled: "Якщо ордер не виконається: нічого не витрачено, сума лишається вашою, а ордер гасне сам або коли ви його скасуєте.",
    notFilledPaper: "Якщо ордер не виконається: не станеться нічого — це симуляція в будь-якому разі.",
    planNotActive: (status: string) => `План у стані ${status}; виконується лише активний план.`,
    planActive: "План активний.",
    planOtherOutcome: (label: string, question: string) => `План — на «${label}» у «${question}», не на цей наслідок.`,
    planOutcome: (label: string) => `Наслідок плану: ${label}.`,
    planAmountOver: (allowed: string, asked: string) => `План дозволяє ${allowed}; цей ордер просить ${asked}.`,
    planAmountOk: (allowed: string) => `У межах ${allowed} плану.`,
    planBoundOver: (price: string, bound: string) => `Ціна ${price} вище межі плану ${bound}.`,
    planBoundOk: (price: string, bound: string) => `${price} у межах плану ${bound}.`,
    planNoBound: (price: string) => `Межі не задано; цей ордер платить щонайбільше ${price}.`,
    planDeadlinePassed: "Дедлайн резолюції плану минув.",
    planDeadline: (date: string) => `Резолюція очікується до ${date}.`,
  },
} as const;

const money = (value: number) => `$${value.toFixed(2)}`;
const pct = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);

/* ------------------------------------------------------------- building the Review */

export type LimitReviewInput = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  /** The price the person named, 0–1. */
  price: number;
  amountUsd: number;
  life: LimitLife;
  planId?: string | null;
  locale?: LimitLocale;
  /** Paper unless `live` is asked for — and live is reviewed only where `live.ts` opens it. */
  mode?: TradeMode;
}>;

/**
 * Whether a live limit order may be reviewed for this wallet now: the
 * deployment opens live money to it on at least one venue and the provider's
 * app is in live mode, read fresh.
 */
async function liveOpen(provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv): Promise<Result<Readonly<{ venues: readonly string[]; maxOrderUsd: number }>>> {
  const venues = liveVenuesFor(wallet, env);
  if (venues.length === 0) return failure("FORBIDDEN", "Live trading is not open to this wallet here.");
  const appMode = await provider.appMode();
  if (!appMode.ok) return appMode;
  if (appMode.value !== "live") return failure("FORBIDDEN", "The provider's app trades on paper only; a live order cannot be placed yet.");
  return { ok: true, value: { venues, maxOrderUsd: readLiveSettings(env).maxOrderUsd } };
}

function liveCash(balance: LiveBalance): PaperBalance {
  return { startingBalance: 0, cashBalance: balance.availableUsd, positionsValue: balance.positionsUsd, realizedPnl: 0, unrealizedPnl: 0, earnings: 0 };
}

type BookSide = Readonly<{ asks: readonly PredictionBookLevel[]; bids: readonly PredictionBookLevel[]; tickSize: number | null }>;

/** The book of the venue this order goes to; the aggregated one when that venue has none of its own. */
function venueBook(book: PredictionBook | null, venue: string): BookSide | null {
  if (!book) return null;
  const own = book.venues.find((v) => v.venue.toLowerCase() === venue.toLowerCase());
  if (own) return { asks: own.asks, bids: own.bids, tickSize: own.tickSize ?? book.requested?.tickSize ?? null };
  if (book.venues.length === 0) return null;
  return { asks: book.aggregated.asks, bids: book.aggregated.bids, tickSize: book.requested?.tickSize ?? null };
}

export function buildLimitReview(input: Readonly<{
  event: PredictionEvent;
  venueMarketId: string;
  outcomeId: string;
  askedPrice: number;
  amountUsd: number;
  life: LimitLife;
  book: PredictionBook | null;
  balance: PaperBalance | null;
  plan: PredictionPlan | null;
  id: string;
  nowMs: number;
  locale?: LimitLocale;
  mode?: TradeMode;
  live?: Readonly<{ venues: readonly string[]; maxOrderUsd: number }>;
}>): LimitReview {
  const w = WORDS[input.locale ?? "en"];
  const mode: TradeMode = input.mode === "live" ? "live" : "paper";
  const market = input.event.markets.find((m) => m.id === input.venueMarketId) ?? input.event.markets[0];
  const outcome = market?.outcomes.find((o) => o.id === input.outcomeId);
  const venue = market?.venue ?? input.event.venue;
  const edge = venueBook(input.book, venue);
  const tickSize = edge?.tickSize ?? market?.tickSize ?? null;
  const price = alignLimitPrice(input.askedPrice, tickSize, "buy");
  const figures = limitFigures({ price, amountUsd: input.amountUsd });
  const expiresAt = limitExpiryAt(input.life, input.nowMs);

  const checks: LimitCheck[] = [];
  const warnings: string[] = [];
  const blockedBy: string[] = [];
  const block = (id: string, detail: string, figure: string | null = null) => {
    checks.push({ id, state: "fail", detail, figure });
    blockedBy.push(id);
  };
  const warn = (id: string, detail: string, figure: string | null = null) => {
    checks.push({ id, state: "warn", detail, figure });
    warnings.push(detail);
  };
  const pass = (id: string, detail: string, figure: string | null = null) => checks.push({ id, state: "pass", detail, figure });

  /* Said first, so nobody mistakes a simulation for real money or the other way round. */
  pass("mode", mode === "live" ? w.modeLive : w.modePaper, mode);

  /* The market. */
  if (!market) block("market", w.marketGone);
  else if (market.status === "resolved") block("market", w.marketResolved, market.status);
  else if (market.status === "closed") block("market", w.marketClosed, market.status);
  else if (market.status === "unknown") warn("market", w.marketUnknown, market.status);
  else pass("market", w.marketOpen, market.status);
  if (!outcome) block("outcome", w.outcomeGone);

  /* The price, and the grid it lands on. */
  if (!(price >= LIMIT_PRICE_MIN && price <= LIMIT_PRICE_MAX)) block("price", w.priceOut(pct(LIMIT_PRICE_MIN), pct(LIMIT_PRICE_MAX)), pct(price > 0 ? price : null));
  else pass("price", w.priceOk(pct(price)), pct(price));
  if (price > 0 && Math.abs(price - input.askedPrice) > 1e-9) pass("grid", w.priceMoved(pct(input.askedPrice), pct(price), pct(tickSize)), pct(price));

  /* The amount. A live order is capped lower, on everything the order may take. */
  const ceiling = mode === "live" ? Math.min(LIMIT_MAX_AMOUNT_USD, input.live?.maxOrderUsd ?? 0) : LIMIT_MAX_AMOUNT_USD;
  if (!(input.amountUsd >= LIMIT_MIN_AMOUNT_USD)) block("amount", w.amountLow(money(LIMIT_MIN_AMOUNT_USD)), money(input.amountUsd));
  else if (input.amountUsd > ceiling) block("amount", mode === "live" ? w.liveAmountHigh(money(ceiling)) : w.amountHigh(money(ceiling)), money(input.amountUsd));
  else pass("amount", w.amountOk(money(input.amountUsd)), money(input.amountUsd));

  /* The size the amount buys at that price. */
  if (!(figures.shares > 0)) block("size", w.sizeNone);
  else {
    pass("size", w.sizeOk(figures.shares.toFixed(2)), figures.shares.toFixed(2));
    const min = market?.minOrderSize ?? null;
    if (min != null && min > 0 && figures.shares + 1e-9 < min) warn("size_min", w.sizeBelowMin(min.toFixed(2)), min.toFixed(2));
  }

  /* Live: only where live orders are open on this market's own venue. */
  if (mode === "live") {
    const open = (input.live?.venues ?? []).map((v) => v.toLowerCase());
    if (!open.includes(venue.toLowerCase())) block("live_venues", w.liveVenueClosed(venue), venue);
    else pass("live_venues", w.liveVenueOk(venue), venue);
  }

  /* The balance. A live order is never placed on a balance nobody read. */
  if (input.balance) {
    if (input.balance.cashBalance + 1e-9 < figures.totalUsd) block("balance", w.balanceShort(money(input.balance.cashBalance), money(figures.totalUsd)), money(input.balance.cashBalance));
    else pass("balance", w.balanceOk(money(input.balance.cashBalance)), money(input.balance.cashBalance));
  } else if (mode === "live") block("balance", w.balanceUnknown);
  else warn("balance", w.balancePaper);

  /* How long it stands. */
  if (expiresAt === null) pass("expiry", w.expiryGtc, "GTC");
  else pass("expiry", w.expiryAt(expiresAt.replace("T", " ").slice(0, 19)), expiresAt.replace("T", " ").slice(0, 16));
  if (expiresAt && input.event.endDate && Date.parse(expiresAt) > Date.parse(input.event.endDate)) warn("expiry_past_end", w.expiryPastEnd, input.event.endDate);

  /* Whether it fills at once or rests. */
  const edges = edge ? bookEdges(edge.asks, edge.bids) : { bestAsk: null, bestBid: null };
  const fillsAtOnce = edges.bestAsk != null && price + 1e-9 >= edges.bestAsk;
  if (edges.bestAsk == null) warn("fill_now", w.fillNoBook);
  else if (fillsAtOnce) pass("fill_now", w.fillNow(pct(edges.bestAsk)), pct(edges.bestAsk));
  else pass("fill_now", w.fillRest(pct(edges.bestAsk)), pct(edges.bestAsk));

  /* The two sentences the person is owed before confirming. */
  warn("venue_fee", w.venueFee);
  pass("not_filled", mode === "live" ? w.notFilled : w.notFilledPaper);

  /* The plan's conditions, judged against the limit price rather than a route. */
  let planBlock: LimitReview["plan"] = null;
  if (input.plan) {
    const r = input.plan.current.rules;
    const planChecks: LimitCheck[] = [];
    const pcheck = (id: string, state: LimitCheckState, detail: string, figure: string | null = null) => {
      planChecks.push({ id, state, detail, figure });
      if (state === "fail") blockedBy.push(`plan:${id}`);
      if (state === "warn") warnings.push(detail);
    };
    if (input.plan.status !== "active") pcheck("status", "fail", w.planNotActive(input.plan.status), input.plan.status);
    else pcheck("status", "pass", w.planActive, input.plan.status);
    if (r.outcomeId !== input.outcomeId) pcheck("outcome", "fail", w.planOtherOutcome(r.outcomeLabel, r.question));
    else pcheck("outcome", "pass", w.planOutcome(r.outcomeLabel));
    if (input.amountUsd > r.amountUsd + 1e-9) pcheck("amount", "fail", w.planAmountOver(money(r.amountUsd), money(input.amountUsd)), money(r.amountUsd));
    else pcheck("amount", "pass", w.planAmountOk(money(r.amountUsd)), money(r.amountUsd));
    if (r.maxProbability !== null) {
      if (price > r.maxProbability + 1e-9) pcheck("max_probability", "fail", w.planBoundOver(pct(price), pct(r.maxProbability)), pct(r.maxProbability));
      else pcheck("max_probability", "pass", w.planBoundOk(pct(price), pct(r.maxProbability)), pct(r.maxProbability));
    } else pcheck("max_probability", "pass", w.planNoBound(pct(price)), pct(price));
    if (r.resolutionDeadline && Date.parse(r.resolutionDeadline) <= input.nowMs) pcheck("deadline", "fail", w.planDeadlinePassed);
    else if (r.resolutionDeadline) pcheck("deadline", "pass", w.planDeadline(r.resolutionDeadline.slice(0, 10)));
    planBlock = { id: input.plan.id, version: input.plan.version, checks: planChecks };
  }

  const reviewedAt = new Date(input.nowMs).toISOString();
  return {
    mode,
    id: input.id,
    event: { id: input.event.id, title: input.event.title, endDate: input.event.endDate },
    market: market
      ? { id: market.id, question: market.question, venue: market.venue, tickSize, minOrderSize: market.minOrderSize }
      : { id: input.venueMarketId, question: input.event.title, venue, tickSize, minOrderSize: null },
    outcome: { id: input.outcomeId, label: outcome?.label ?? "—" },
    side: "buy",
    askedPrice: input.askedPrice,
    amountUsd: input.amountUsd,
    figures,
    life: input.life,
    timeInForce: limitTimeInForce(input.life),
    expiresAt,
    book: input.book ? { bestAsk: edges.bestAsk, bestBid: edges.bestBid, tickSize, readAt: input.book.readAt } : null,
    fillsAtOnce,
    balance: input.balance,
    checks,
    warnings,
    plan: planBlock,
    canPlace: blockedBy.length === 0,
    blockedBy,
    signature: limitSignature({ eventId: input.event.id, venueMarketId: input.venueMarketId, outcomeId: input.outcomeId, priceInput: input.askedPrice, amountUsd: input.amountUsd, life: input.life, mode, planId: input.plan?.id ?? null }),
    reviewedAt,
    reviewExpiresAt: new Date(input.nowMs + LIMIT_REVIEW_MAX_AGE_S * 1000).toISOString(),
  };
}

export type LimitReviewResult = Readonly<{ review: LimitReview; record: PredictionLimitRecord; link: LinkStatus }>;

/** The Review of a limit order: the market and its book read fresh, the balance read, the plan judged, the record stored as `reviewed`. */
export async function reviewLimitOrder(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  input: LimitReviewInput,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<LimitReviewResult>> {
  if (!Number.isFinite(input.price) || input.price <= 0) return failure("VALIDATION_ERROR", "Name a price above zero.", { issues: [{ path: "price", message: "above zero" }] });
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) return failure("VALIDATION_ERROR", "Name an amount above zero.", { issues: [{ path: "amountUsd", message: "above zero" }] });
  if (!isLimitLife(input.life)) return failure("VALIDATION_ERROR", "Say how long the order stands.", { issues: [{ path: "life", message: "unknown" }] });
  const mode: TradeMode = input.mode === "live" ? "live" : "paper";
  const live = mode === "live" ? await liveOpen(provider, wallet, env) : null;
  if (live && !live.ok) return live;
  const event = await provider.event(input.eventId);
  if (!event.ok) return event;
  const link = await linkStatus(store, wallet);
  const plan = input.planId ? await readPredictionPlan(store, wallet, input.planId, nowMs) : null;
  if (plan && !plan.ok) return plan;

  const read = await withProviderSession(
    store,
    provider,
    wallet,
    async (session) => {
      const [book, balance] = await Promise.all([
        provider.book(input.venueMarketId, 25),
        mode === "live" ? provider.liveBalance(session).then((b): Result<PaperBalance | null> => (b.ok ? { ok: true, value: liveCash(b.value) } : b)) : provider.paperBalance(session),
      ]);
      /* A book that could not be read is not a refusal: the Review says so and the person decides. */
      return { ok: true as const, value: { book: book.ok ? book.value : null, balance: balance.ok ? balance.value : null } };
    },
    env,
    nowMs,
  );
  if (!read.ok) return read;

  const id = newLimitId();
  const review = buildLimitReview({
    event: event.value,
    venueMarketId: input.venueMarketId,
    outcomeId: input.outcomeId,
    askedPrice: input.price,
    amountUsd: input.amountUsd,
    life: input.life,
    book: read.value.book,
    balance: read.value.balance,
    plan: plan ? plan.value : null,
    id,
    nowMs,
    locale: input.locale ?? "en",
    mode,
    live: live?.ok ? live.value : undefined,
  });
  const at = new Date(nowMs).toISOString();
  const record: PredictionLimitRecord = {
    version: 1,
    wallet,
    id,
    mode,
    eventId: event.value.id,
    eventTitle: event.value.title,
    venueMarketId: review.market.id,
    question: review.market.question,
    outcomeId: input.outcomeId,
    outcomeLabel: review.outcome.label,
    venue: review.market.venue,
    side: "buy",
    review,
    planId: plan ? plan.value.id : null,
    planVersion: plan ? plan.value.version : null,
    state: "reviewed",
    cancelRequested: false,
    providerOrderId: null,
    providerStatus: null,
    reservedUsd: null,
    filledShares: 0,
    filledUsd: 0,
    avgFillPrice: null,
    expiresAt: review.expiresAt,
    error: null,
    submittedAt: null,
    closedAt: null,
    createdAt: at,
    updatedAt: at,
  };
  if (!(await rows(store).insertIfAbsent(limitKey(wallet, id), record))) return failure("UNAVAILABLE", "The Review could not be recorded; ask for a fresh one.");
  return { ok: true, value: { review, record, link } };
}

/* ------------------------------------------------------------- store helpers */

async function patch(store: GuardStore, wallet: string, id: string, apply: (current: PredictionLimitRecord) => PredictionLimitRecord): Promise<PredictionLimitRecord | null> {
  const collection = rows(store);
  const key = limitKey(wallet, id);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return null as never;
      const next = { ...apply(current), version: current.version + 1 };
      return (await collection.compareAndSet(key, current.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

export async function readLimitRecord(store: GuardStore, wallet: string, id: string): Promise<PredictionLimitRecord | null> {
  if (!LIMIT_ID.test(id)) return null;
  return (await rows(store).get(limitKey(wallet, id))) ?? null;
}

/**
 * The wallet's records, newest first — but an order the venue may still move
 * ahead of a finished one, so a run of Reviews nobody confirmed can never
 * crowd a standing order out of the list a page reads.
 */
export async function listLimitRecords(store: GuardStore, wallet: string, limit = LIST_LIMIT): Promise<readonly PredictionLimitRecord[]> {
  const found = await rows(store).valuesWithPrefix(`${KEY_PREFIX}${wallet}:`).catch(() => [] as PredictionLimitRecord[]);
  const newestFirst = (a: PredictionLimitRecord, b: PredictionLimitRecord) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const mine = found.filter((r) => r.wallet === wallet && typeof r.id === "string");
  return [...mine.filter((r) => limitWorking(r.state)).sort(newestFirst), ...mine.filter((r) => !limitWorking(r.state)).sort(newestFirst)].slice(0, limit);
}

/** Every wallet with a limit order recorded here, for the operator's pass. */
export async function limitWallets(store: GuardStore): Promise<readonly string[]> {
  const found = await rows(store).valuesWithPrefix(KEY_PREFIX).catch(() => [] as PredictionLimitRecord[]);
  return [...new Set(found.filter((r) => typeof r.wallet === "string").map((r) => r.wallet))];
}

/* ------------------------------------------------------------- placing */

/** Refusals that come before the venue is told anything: the same Review may be confirmed again. */
const NOTHING_CREATED: ReadonlySet<string> = new Set(["RATE_LIMITED", "SESSION_EXPIRED", "FORBIDDEN", "NOT_FOUND", "NOT_LINKED", "LINK_UNAVAILABLE", "UNAUTHORIZED"]);

/**
 * Place the reviewed limit order.
 *
 * One Review sends one order: the record is turned from `reviewed` into
 * `sending` by the write that lands, and only that request sends. Everything
 * the Review checked is checked again here — live still open to this wallet
 * on this venue, the amount within today's cap, the Review not stale — and
 * the order carries Ryntra's own id, so even an answer that never arrives can
 * only ever be the same one order.
 */
export async function placeLimitOrder(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  id: string,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<PredictionLimitRecord>> {
  const current = await readLimitRecord(store, wallet, id);
  if (!current) return failure("NOT_FOUND", "No Review for that limit order; ask for a fresh one.");
  if (current.state !== "reviewed") return { ok: true, value: current };
  if (!current.review.canPlace) return failure("ORDER_REFUSED", `The Review refused this order: ${current.review.blockedBy.join(", ")}.`);
  if (Date.parse(current.review.reviewExpiresAt) <= nowMs) {
    await patch(store, wallet, id, (c) => (c.state === "reviewed" ? { ...c, state: "failed", error: "review_expired", closedAt: new Date(nowMs).toISOString(), updatedAt: new Date(nowMs).toISOString() } : c));
    return failure("QUOTE_EXPIRED", "The Review is no longer fresh; ask for a new one.");
  }
  if (current.mode === "live") {
    const live = await liveOpen(provider, wallet, env);
    if (!live.ok) return live;
    if (!live.value.venues.map((v) => v.toLowerCase()).includes(current.venue.toLowerCase())) return failure("ORDER_REFUSED", `Live orders are no longer open on ${current.venue}; ask for a fresh Review.`);
    if (current.review.amountUsd > live.value.maxOrderUsd) return failure("ORDER_REFUSED", "The amount is above today's limit for a live order; ask for a fresh Review.");
  }

  /* The claim: decided by the write that landed, not by comparing times. */
  const claim = new Date(nowMs).toISOString();
  let won = false;
  const claimed = await patch(store, wallet, id, (c) => {
    won = c.state === "reviewed";
    return won ? { ...c, state: "sending", submittedAt: claim, updatedAt: claim } : c;
  });
  if (!claimed) return failure("UNAVAILABLE", "The order could not be recorded before sending; nothing was sent — try again.");
  if (!won) return { ok: true, value: claimed };
  const mine = (c: PredictionLimitRecord) => c.state === "sending" && c.submittedAt === claim && c.providerOrderId === null;

  /* Paper: Ryntra's own order over the venue's book. No venue is told anything. */
  if (current.mode === "paper") {
    const accepted = await patch(store, wallet, id, (c) => (mine(c) ? { ...c, state: "accepted", providerOrderId: `paper:${id}`, providerStatus: "open", updatedAt: new Date(nowMs).toISOString() } : c));
    if (!accepted) return failure("UNAVAILABLE", "The simulated order could not be recorded; reload to see it.");
    return syncLimitOrder(store, provider, wallet, id, nowMs, env);
  }

  let sent = false;
  const answer = await withProviderSession(
    store,
    provider,
    wallet,
    (session) => {
      sent = true;
      return provider.placeLimitOrder(session, {
        venue: current.venue,
        outcomeId: current.outcomeId,
        side: "buy",
        price: current.review.figures.price,
        shares: current.review.figures.shares,
        timeInForce: current.review.timeInForce,
        expiresAt: current.review.expiresAt,
        clientOrderId: id,
      });
    },
    env,
    nowMs,
  );
  if (!answer.ok) {
    const at = new Date().toISOString();
    /* The venue refused the order itself: nothing stands, and this Review cannot be confirmed again. */
    if (sent && (answer.code === "VALIDATION_ERROR" || answer.code === "ORDER_REFUSED" || answer.code === "QUOTE_UNAVAILABLE")) {
      await patch(store, wallet, id, (c) => (mine(c) ? { ...c, state: "failed", error: answer.code, closedAt: at, updatedAt: at } : c));
      return failure("ORDER_REFUSED", answer.message);
    }
    /* Never sent, or refused before the provider looked at it: the Review is free again. */
    if (!sent || NOTHING_CREATED.has(answer.code)) {
      await patch(store, wallet, id, (c) => (mine(c) ? { ...c, state: "reviewed", submittedAt: null, updatedAt: at } : c));
      return answer;
    }
    /* No answer is not a no: the order is looked for by Ryntra's own id, never sent again. */
    const read = await syncLimitOrder(store, provider, wallet, id, nowMs, env);
    return read.ok ? read : { ok: true, value: (await readLimitRecord(store, wallet, id)) ?? claimed };
  }

  const placed = answer.value;
  const at = new Date(nowMs).toISOString();
  const filled = placed.filledShares ?? 0;
  const written = await patch(store, wallet, id, (c) =>
    mine(c)
      ? {
          ...c,
          state: limitStateOf(placed.status, filled),
          providerOrderId: placed.orderId,
          providerStatus: placed.status,
          reservedUsd: placed.reservedUsd,
          filledShares: filled,
          updatedAt: at,
        }
      : c,
  );
  if (!written) return failure("UNAVAILABLE", "The venue took the order but it could not be recorded; reload to see it.");
  return syncLimitOrder(store, provider, wallet, id, nowMs, env);
}

/* ------------------------------------------------------------- reading it back */

/**
 * Read the order's state back and write it on the record.
 *
 * Live: the provider's own limit-order list is the truth, and the order is
 * found in it by Ryntra's id (`clientOrderId`) or by the provider's. A list
 * that could not be read changes nothing — a dropped stream never turns an
 * order into a finished one. A send that left no trace is closed as never
 * received only once the list was read fine, holds nothing of it, no order id
 * was ever given, and the Review's own grace has passed.
 *
 * Paper: Ryntra's own arithmetic over the venue's real book — it fills only
 * at or below the price named and lapses at its own expiry.
 */
export async function syncLimitOrder(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  id: string,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<PredictionLimitRecord>> {
  const current = await readLimitRecord(store, wallet, id);
  if (!current) return failure("NOT_FOUND", "No such limit order for this wallet.");
  if (current.state === "reviewed" || !limitWorking(current.state)) return { ok: true, value: current };
  const read = current.mode === "paper" ? await syncPaperLimit(store, provider, wallet, current, nowMs) : await syncLiveLimit(store, provider, wallet, current, nowMs, env);
  /* Whatever moved is told once, here, so a fill is a note whether a page or the scheduler noticed it. */
  if (read.ok && (read.value.state !== current.state || read.value.filledShares !== current.filledShares)) await writeLimitNote(store, wallet, read.value, nowMs);
  return read;
}

async function syncLiveLimit(store: GuardStore, provider: PredictionProvider, wallet: string, current: PredictionLimitRecord, nowMs: number, env: NodeJS.ProcessEnv): Promise<Result<PredictionLimitRecord>> {
  const listed = await withProviderSession(store, provider, wallet, (session) => provider.limitOrders(session, 100), env, nowMs);
  if (!listed.ok) return listed;
  const row = listed.value.find((o) => o.clientOrderId === current.id || (current.providerOrderId !== null && o.id === current.providerOrderId));
  const at = new Date(nowMs).toISOString();
  if (!row) {
    /* Nothing of it in the provider's own list. Only once the Review's grace has passed is that an order that never reached a venue. */
    const graceOver = Date.parse(current.review.reviewExpiresAt) + LIMIT_UNSEEN_GRACE_MS <= nowMs;
    if (current.state === "sending" && current.providerOrderId === null && graceOver) {
      const closed = await patch(store, wallet, current.id, (c) => (c.state === "sending" && c.providerOrderId === null ? { ...c, state: "failed", error: "not_received", closedAt: at, updatedAt: at } : c));
      if (closed) return { ok: true, value: closed };
    }
    return { ok: true, value: current };
  }
  const filledShares = row.filledShares ?? current.filledShares;
  const state = limitStateOf(row.status, filledShares);
  const next = await patch(store, wallet, current.id, (c) => ({
    ...c,
    state,
    providerOrderId: row.id,
    providerStatus: row.status,
    reservedUsd: row.reservedUsd ?? c.reservedUsd,
    filledShares,
    filledUsd: row.filledUsd ?? c.filledUsd,
    avgFillPrice: row.avgFillPrice ?? c.avgFillPrice,
    cancelRequested: row.cancelRequestedAt !== null || c.cancelRequested,
    expiresAt: row.expiresAt ?? c.expiresAt,
    error: row.error ?? c.error,
    closedAt: limitWorking(state) ? c.closedAt : (c.closedAt ?? at),
    updatedAt: at,
  }));
  return next ? { ok: true, value: next } : failure("UNAVAILABLE", "The limit order could not be updated; reload.");
}

async function syncPaperLimit(store: GuardStore, provider: PredictionProvider, wallet: string, current: PredictionLimitRecord, nowMs: number): Promise<Result<PredictionLimitRecord>> {
  const at = new Date(nowMs).toISOString();
  const lapsed = current.expiresAt !== null && Date.parse(current.expiresAt) <= nowMs;
  const book = await provider.book(current.venueMarketId, 25);
  /* An unread book fills nothing: a simulation that invents a fill is worse than one that waits. */
  const edge = book.ok ? venueBook(book.value, current.venue) : null;
  const remaining = Math.max(0, current.review.figures.shares - current.filledShares);
  const fill = edge && remaining > 0 && !lapsed ? limitFillAgainstBook(edge.asks, current.review.figures.price, remaining) : { shares: 0, usd: 0, avgPrice: null };
  const next = await patch(store, wallet, current.id, (c) => {
    if (!limitWorking(c.state)) return c;
    const filledShares = Math.round((c.filledShares + fill.shares) * 1e6) / 1e6;
    const filledUsd = Math.round((c.filledUsd + fill.usd) * 1e6) / 1e6;
    const whole = filledShares + 1e-9 >= c.review.figures.shares;
    const state: LimitOrderState = whole ? "filled" : lapsed ? "expired" : filledShares > 0 ? "partially_filled" : "accepted";
    return {
      ...c,
      state,
      providerStatus: whole ? "filled" : lapsed ? "expired" : filledShares > 0 ? "partially_filled_open" : "open",
      filledShares,
      filledUsd,
      avgFillPrice: filledShares > 0 ? Math.round((filledUsd / filledShares) * 1e6) / 1e6 : null,
      closedAt: limitWorking(state) ? c.closedAt : (c.closedAt ?? at),
      updatedAt: at,
    };
  });
  return next ? { ok: true, value: next } : failure("UNAVAILABLE", "The simulated order could not be updated; reload.");
}

/* ------------------------------------------------------------- cancelling */

/**
 * *Cancel* — one act on what has not filled. A part already filled stays
 * filled, and the record says what the venue says: gone, or a cancel the
 * venue has yet to finish.
 */
export async function cancelLimitOrder(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  id: string,
  nowMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<PredictionLimitRecord>> {
  const current = await readLimitRecord(store, wallet, id);
  if (!current) return failure("NOT_FOUND", "No such limit order for this wallet.");
  if (!limitCancellable(current)) return failure("ORDER_REFUSED", "Nothing of this order is still working; there is nothing to cancel.");
  const at = new Date(nowMs).toISOString();

  if (current.mode === "paper") {
    const cancelled = await patch(store, wallet, id, (c) => (limitWorking(c.state) ? { ...c, state: "cancelled", providerStatus: "cancelled", cancelRequested: true, closedAt: c.closedAt ?? at, updatedAt: at } : c));
    return cancelled ? { ok: true, value: cancelled } : failure("UNAVAILABLE", "The simulated order could not be updated; reload.");
  }

  const orderId = current.providerOrderId;
  if (orderId === null) return failure("ORDER_REFUSED", "The venue has not named this order yet; it cannot be cancelled before it is known.");
  const asked = await withProviderSession(store, provider, wallet, (session) => provider.cancelOrder(session, orderId), env, nowMs);
  /* Whatever came of the cancel, the order is read back: it may have filled before the cancel reached the venue. */
  await patch(store, wallet, id, (c) => (limitWorking(c.state) ? { ...c, cancelRequested: true, updatedAt: at } : c));
  const synced = await syncLimitOrder(store, provider, wallet, id, nowMs, env);
  if (!asked.ok) return asked;
  return synced;
}

/* ------------------------------------------------------------- the pass */

export type LimitSweep = Readonly<{
  wallet: string;
  orders: readonly PredictionLimitRecord[];
  notes: readonly Note[];
  /** Set when the provider could not be read; the rest is what the store holds. */
  providerFailure: Readonly<{ code: string; message: string }> | null;
  readAt: string;
}>;

export type LimitSweepDeps = Readonly<{ transports?: NotifyTransports; locale?: NoteLocale }>;

/**
 * One pass for one wallet: read every working order back, tell the person
 * what became of the ones that moved, and send what is due.
 *
 * It is the same pass whether a page asked for it or the scheduler did, so a
 * fill is noticed with the page closed. Each note is written under its own
 * identity, so a pass that runs every few minutes tells nobody twice.
 */
export async function sweepLimitOrders(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
  deps: LimitSweepDeps = {},
): Promise<LimitSweep> {
  const before = await listLimitRecords(store, wallet);
  const working = before.filter((r) => limitWorking(r.state)).slice(0, RECONCILE_PER_PASS);
  let providerFailure: LimitSweep["providerFailure"] = null;
  for (const row of working) {
    const synced = await syncLimitOrder(store, provider, wallet, row.id, nowMs, env).catch(() => null);
    if (synced && !synced.ok) providerFailure ??= { code: synced.code, message: synced.message };
  }
  if (deps.transports) {
    const locale = deps.locale ?? "en";
    const prefs = await readPrefs(store, wallet, nowMs);
    await deliverNotes(store, wallet, { transports: deps.transports, words: (n) => limitNoteWords(n, locale), prefs }, nowMs).catch(() => undefined);
  }
  await pruneNotes(store, wallet, nowMs).catch(() => undefined);
  const after = await listLimitRecords(store, wallet);
  return { wallet, orders: after, notes: await listNotes(store, wallet), providerFailure, readAt: new Date(nowMs).toISOString() };
}

/**
 * What became of one order, as a note: filled, part filled, cancelled or
 * lapsed. A finished order is a standing fact and is said once; a part
 * filling again raises that note's count rather than writing a second.
 */
async function writeLimitNote(store: GuardStore, wallet: string, record: PredictionLimitRecord, nowMs: number): Promise<void> {
  const kind =
    record.state === "filled" ? "limit_filled"
    : record.state === "partially_filled" ? "limit_partial"
    : record.state === "cancelled" ? "limit_cancelled"
    : record.state === "expired" ? "limit_expired"
    : null;
  if (kind === null) return;
  await note(
    store,
    wallet,
    {
      kind,
      identity: `limit:${record.id}:${kind}`,
      facts: {
        question: record.question,
        outcome: record.outcomeLabel,
        price: record.review.figures.price,
        shares: record.review.figures.shares,
        filledShares: record.filledShares,
        filledUsd: Math.round(record.filledUsd * 100) / 100,
        amountUsd: record.review.amountUsd,
      },
      href: `/app/predictions/${record.eventId}`,
      paper: record.mode === "paper",
      once: kind !== "limit_partial",
    },
    nowMs,
  ).catch(() => undefined);
}

/* ------------------------------------------------------------- the view */

export type LimitOrdersView = Readonly<{
  wallet: string;
  mode: TradeMode;
  orders: readonly PredictionLimitRecord[];
  /** Live trading as it stands for this wallet, so the ticket offers real money only where it is open. */
  live: Readonly<{ open: boolean; venues: readonly string[]; maxOrderUsd: number }>;
  providerFailure: Readonly<{ code: string; message: string }> | null;
  readAt: string;
}>;

/** The wallet's limit orders, the working ones read back from the venue first. */
export async function readLimitOrders(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
  deps: LimitSweepDeps = {},
): Promise<LimitOrdersView> {
  const swept = await sweepLimitOrders(store, provider, wallet, env, nowMs, deps);
  const venues = liveVenuesFor(wallet, env);
  return {
    wallet,
    mode: venues.length > 0 ? "live" : "paper",
    orders: swept.orders,
    live: { open: venues.length > 0, venues, maxOrderUsd: readLiveSettings(env).maxOrderUsd },
    providerFailure: swept.providerFailure,
    readAt: swept.readAt,
  };
}
