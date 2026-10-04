/**
 * Paper execution as Ryntra records it: quote → Review → *Place paper order*
 * → the provider's execution status to a terminal state → the order, the
 * position and the balance re-read from the provider → reconciled on every
 * later read.
 *
 * The smart route is the provider's infrastructure; the person sees the
 * Review — the event, the outcome, the paper amount, the probability the
 * route buys at, the payout if right, the whole amount as the principal at
 * risk, the fees, the quote's age, the venues, the settlement summary, the
 * plan's conditions, every warning, and the mode. A Review that refuses
 * says exactly why (`blockedBy`); a Review that warns leaves the decision
 * to the person.
 *
 * One record per quote in Guard `predictionOrders`, keyed `<wallet>:<quoteId>`;
 * the provider's own ledger is the truth of what happened to the order and
 * the record is reconciled to it, never the other way round. Nothing here
 * moves real funds: every provider call carries `mode: "paper"` and the app
 * itself is a paper app at the provider (`tradingMode: paper`).
 *
 * Server only.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure, type PredictionFailure } from "./failure.ts";
import type { PaperBalance, PaperExecution, PaperOrder, PaperPosition, PredictionEvent, PredictionRoute, PredictionSettlement } from "./model.ts";
import { readPredictionPlan, recordPredictionPlanExecution, type PredictionPlan } from "./plan.ts";
import type { PredictionProvider, Result } from "./provider.ts";
import { linkStatus, withProviderSession, type LinkStatus } from "./session.ts";

export type ReviewCheckState = "pass" | "warn" | "fail";
export type ReviewCheck = Readonly<{ id: string; state: ReviewCheckState; detail: string; figure?: string | null }>;

export type PaperReview = Readonly<{
  mode: "paper";
  quoteId: string;
  event: Readonly<{ id: string; title: string; endDate: string | null }>;
  market: Readonly<{ id: string; question: string; venue: string; resolutionDate: string | null; rules: Readonly<{ primary: string | null; secondary: string | null }> }>;
  outcome: Readonly<{ id: string; label: string }>;
  side: "buy" | "sell";
  requested: number;
  route: PredictionRoute;
  figures: Readonly<{
    probability: number | null;
    shares: number;
    costUsd: number;
    feesUsd: number;
    totalUsd: number;
    payoutIfRightUsd: number;
    profitIfRightUsd: number;
    maxLossUsd: number;
    returnIfRightPct: number | null;
  }>;
  quote: Readonly<{ quotedAt: string; expiresAt: string; ageSeconds: number; expired: boolean }>;
  venues: readonly string[];
  settlement: PredictionSettlement | null;
  balance: PaperBalance | null;
  checks: readonly ReviewCheck[];
  warnings: readonly string[];
  plan: Readonly<{ id: string; version: number; checks: readonly ReviewCheck[] }> | null;
  canPlace: boolean;
  blockedBy: readonly string[];
}>;

export type PaperOrderState = "reviewed" | "submitted" | "filled" | "partially_filled" | "failed" | "expired" | "cancelled";

export type PredictionOrderRecord = Readonly<{
  version: number;
  wallet: string;
  quoteId: string;
  eventId: string;
  eventTitle: string;
  venueMarketId: string;
  question: string;
  outcomeId: string;
  outcomeLabel: string;
  side: "buy" | "sell";
  requested: number;
  review: PaperReview;
  planId: string | null;
  planVersion: number | null;
  state: PaperOrderState;
  providerOrderIds: readonly string[];
  execution: PaperExecution | null;
  /** The provider's own order rows for this quote, as last reconciled. */
  providerOrders: readonly PaperOrder[];
  submittedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

const QUOTE_MAX_AGE_S = 90;
const MIN_SPEND_USD = 1;
const MAX_SPEND_USD = 10_000;

function orders(store: GuardStore) {
  return store.versioned<PredictionOrderRecord>("predictionOrders");
}
const ORDER_PREFIX = "solana:mainnet:";
export function orderKey(wallet: string, quoteId: string): string {
  return `${ORDER_PREFIX}${wallet}:${quoteId}`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}
function pct(p: number | null): string {
  return p == null ? "—" : `${(p * 100).toFixed(1)}%`;
}

export type ReviewLocale = "en" | "uk";

/**
 * The Review's sentences in the person's language. The server writes them
 * once, at the Review, in the language the request named; the record keeps
 * them as written.
 */
const REVIEW_WORDS = {
  en: {
    mode: "Paper trading: simulated funds, no venue receives an order.",
    routeFail: (status: string, error: string | null) => `The provider could not build a route: ${status}${error ? ` — ${error}` : ""}.`,
    routePass: (n: number, shares: string, cost: string) => `${n} venue${n === 1 ? "" : "s"} fill ${shares} shares for ${cost}.`,
    fillNothing: "The route fills nothing at this amount.",
    quoteOld: (s: number) => `The quote is ${s}s old; a paper order needs a fresh one.`,
    quoteFresh: (s: number, until: string) => `Quoted ${s}s ago; valid until ${until} UTC.`,
    amountLow: (min: string) => `The paper amount is below the ${min} minimum.`,
    amountHigh: (max: string) => `The paper amount is above the ${max} ceiling.`,
    amountOk: (amount: string) => `${amount} of paper funds at most.`,
    balanceShort: (cash: string, total: string) => `The paper balance (${cash}) does not cover ${total}.`,
    balanceOk: (cash: string) => `Paper balance ${cash} covers it.`,
    balanceUnknown: "The paper balance could not be read before this Review.",
    sellShares: (n: string) => `${n} shares to sell.`,
    marketGone: "The market is no longer in this event.",
    marketResolved: "The market has resolved; nothing more can be placed on it.",
    marketClosed: "The market is closed to new orders.",
    marketUnknown: "The market's state is not stated by the provider.",
    marketOpen: "The market is open.",
    outcomeGone: "The outcome is not part of this market any more.",
    endsSoon: (when: string) => `The event ends in less than six hours (${when} UTC).`,
    priceMove: (route: string, market: string) => `The route buys at ${route} while the market last showed ${market}.`,
    planNotActive: (status: string) => `The plan is ${status}; only an active plan is executed.`,
    planActive: "The plan is active.",
    planOtherOutcome: (label: string, question: string) => `The plan is for “${label}” on “${question}”, not this outcome.`,
    planOutcome: (label: string) => `The plan's outcome: ${label}.`,
    planAmountOver: (allowed: string, asked: string) => `The plan allows ${allowed}; this order asks ${asked}.`,
    planAmountOk: (allowed: string) => `Within the plan's ${allowed}.`,
    planBoundOver: (route: string, bound: string) => `The route buys at ${route}, above the plan's bound of ${bound}.`,
    planBoundOk: (route: string, bound: string) => `${route} is within the plan's bound of ${bound}.`,
    planNoBound: (route: string) => `No bound set; the route buys at ${route}.`,
    planInvalidated: (market: string, bound: string) => `The market shows ${market}, below the plan's invalidation at ${bound}: the thesis is written off, not bought.`,
    planAboveInvalidation: (bound: string) => `Above the invalidation at ${bound}.`,
    planDeadlinePassed: "The plan's resolution deadline has passed.",
    planDeadline: (date: string) => `Resolution expected by ${date}.`,
  },
  uk: {
    mode: "Paper-торгівля: симульовані кошти, жоден майданчик не отримує ордера.",
    routeFail: (status: string, error: string | null) => `Постачальник не зміг побудувати маршрут: ${status}${error ? ` — ${error}` : ""}.`,
    routePass: (n: number, shares: string, cost: string) => `${n} ${n === 1 ? "майданчик виконує" : "майданчики виконують"} ${shares} акцій за ${cost}.`,
    fillNothing: "На цю суму маршрут нічого не виконує.",
    quoteOld: (s: number) => `Котируванню ${s} с; paper-ордер потребує свіжого.`,
    quoteFresh: (s: number, until: string) => `Котирування ${s} с тому; дійсне до ${until} UTC.`,
    amountLow: (min: string) => `Paper-сума нижча за мінімум ${min}.`,
    amountHigh: (max: string) => `Paper-сума вища за стелю ${max}.`,
    amountOk: (amount: string) => `Щонайбільше ${amount} paper-коштів.`,
    balanceShort: (cash: string, total: string) => `Paper-баланс (${cash}) не покриває ${total}.`,
    balanceOk: (cash: string) => `Paper-баланс ${cash} покриває це.`,
    balanceUnknown: "Paper-баланс не вдалося прочитати перед цим Review.",
    sellShares: (n: string) => `${n} акцій на продаж.`,
    marketGone: "Ринку більше немає в цій події.",
    marketResolved: "Ринок вирішено; на нього більше нічого не розмістити.",
    marketClosed: "Ринок закрито для нових ордерів.",
    marketUnknown: "Постачальник не вказує стан ринку.",
    marketOpen: "Ринок відкритий.",
    outcomeGone: "Цього наслідку більше немає в ринку.",
    endsSoon: (when: string) => `Подія завершується менш ніж за шість годин (${when} UTC).`,
    priceMove: (route: string, market: string) => `Маршрут купує за ${route}, тоді як ринок востаннє показував ${market}.`,
    planNotActive: (status: string) => `План у стані ${status}; виконується лише активний план.`,
    planActive: "План активний.",
    planOtherOutcome: (label: string, question: string) => `План — на «${label}» у «${question}», не на цей наслідок.`,
    planOutcome: (label: string) => `Наслідок плану: ${label}.`,
    planAmountOver: (allowed: string, asked: string) => `План дозволяє ${allowed}; цей ордер просить ${asked}.`,
    planAmountOk: (allowed: string) => `У межах ${allowed} плану.`,
    planBoundOver: (route: string, bound: string) => `Маршрут купує за ${route} — вище межі плану ${bound}.`,
    planBoundOk: (route: string, bound: string) => `${route} у межах плану ${bound}.`,
    planNoBound: (route: string) => `Межі не задано; маршрут купує за ${route}.`,
    planInvalidated: (market: string, bound: string) => `Ринок показує ${market} — нижче інвалідації плану ${bound}: тезу списано, не куплено.`,
    planAboveInvalidation: (bound: string) => `Вище інвалідації ${bound}.`,
    planDeadlinePassed: "Дедлайн резолюції плану минув.",
    planDeadline: (date: string) => `Резолюція очікується до ${date}.`,
  },
} as const;

/* ------------------------------------------------------------- the Review */

export function buildReview(input: Readonly<{
  event: PredictionEvent;
  venueMarketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  requested: number;
  route: PredictionRoute;
  balance: PaperBalance | null;
  plan: PredictionPlan | null;
  nowMs: number;
  locale?: ReviewLocale;
}>): PaperReview {
  const { event, route, balance, plan, nowMs } = input;
  const w = REVIEW_WORDS[input.locale ?? "en"];
  const market = event.markets.find((m) => m.id === input.venueMarketId) ?? event.markets[0];
  const outcome = market?.outcomes.find((o) => o.id === input.outcomeId);
  const checks: ReviewCheck[] = [];
  const warnings: string[] = [];
  const blockedBy: string[] = [];
  const block = (id: string, detail: string, figure?: string | null) => {
    checks.push({ id, state: "fail", detail, figure: figure ?? null });
    blockedBy.push(id);
  };
  const warn = (id: string, detail: string, figure?: string | null) => {
    checks.push({ id, state: "warn", detail, figure: figure ?? null });
    warnings.push(detail);
  };
  const pass = (id: string, detail: string, figure?: string | null) => checks.push({ id, state: "pass", detail, figure: figure ?? null });

  /* Mode — the app is a paper app; the route was priced in paper mode. */
  pass("mode", w.mode, "paper");

  /* The route itself. */
  const feesUsd = route.fees.venue + route.fees.builder + route.fees.settlement + (route.fees.app ?? 0);
  const totalUsd = route.totalCostIncFeesUsd ?? route.costUsd + feesUsd;
  const payout = route.estimatedPayoutUsd ?? route.shares;
  const profit = route.estimatedProfitUsd ?? payout - totalUsd;
  if (route.status !== "ok") block("route", w.routeFail(route.status, route.error), route.status);
  else pass("route", w.routePass(route.fills.length, route.shares.toFixed(2), money(route.costUsd)), `${route.fills.map((f) => f.venue).join(" + ")}`);
  if (route.status === "ok" && input.side === "buy" && route.shares <= 0) block("fill", w.fillNothing);

  /* Quote age. */
  const ageSeconds = Math.max(0, Math.round((nowMs - Date.parse(route.quotedAt)) / 1000));
  const expired = Date.parse(route.expiresAt) <= nowMs || ageSeconds > QUOTE_MAX_AGE_S;
  if (expired) block("quote_age", w.quoteOld(ageSeconds), `${ageSeconds}s`);
  else pass("quote_age", w.quoteFresh(ageSeconds, new Date(route.expiresAt).toISOString().slice(11, 19)), `${ageSeconds}s`);

  /* Amount and balance. */
  if (input.side === "buy") {
    if (input.requested < MIN_SPEND_USD) block("amount", w.amountLow(money(MIN_SPEND_USD)), money(input.requested));
    else if (input.requested > MAX_SPEND_USD) block("amount", w.amountHigh(money(MAX_SPEND_USD)), money(input.requested));
    else pass("amount", w.amountOk(money(input.requested)), money(input.requested));
    if (balance) {
      if (balance.cashBalance < totalUsd) block("balance", w.balanceShort(money(balance.cashBalance), money(totalUsd)), money(balance.cashBalance));
      else pass("balance", w.balanceOk(money(balance.cashBalance)), money(balance.cashBalance));
    } else warn("balance", w.balanceUnknown);
  } else {
    pass("amount", w.sellShares(input.requested.toFixed(2)), `${input.requested.toFixed(2)}`);
  }

  /* Market state. */
  if (!market) block("market", w.marketGone);
  else if (market.status === "resolved") block("market", w.marketResolved, market.status);
  else if (market.status === "closed") block("market", w.marketClosed, market.status);
  else if (market.status === "unknown") warn("market", w.marketUnknown, market.status);
  else pass("market", w.marketOpen, market.status);
  if (!outcome) block("outcome", w.outcomeGone);
  if (event.endDate && Date.parse(event.endDate) - nowMs < 6 * 3_600_000 && Date.parse(event.endDate) > nowMs) warn("resolution", w.endsSoon(new Date(event.endDate).toISOString().slice(0, 16).replace("T", " ")));

  /* Warnings the route names. */
  for (const w of route.warnings) warn(`route_warning`, `${w.venue}: ${w.reason}`);
  if (route.status === "ok" && route.avgProbability != null && outcome?.probability != null && Math.abs(route.avgProbability - outcome.probability) > 0.05) {
    warn("price_move", w.priceMove(pct(route.avgProbability), pct(outcome.probability)), pct(route.avgProbability));
  }

  /* The plan's conditions. */
  let planBlock: PaperReview["plan"] = null;
  if (plan) {
    const rules = plan.current.rules;
    const planChecks: ReviewCheck[] = [];
    const pcheck = (id: string, state: ReviewCheckState, detail: string, figure?: string | null) => {
      planChecks.push({ id, state, detail, figure: figure ?? null });
      if (state === "fail") blockedBy.push(`plan:${id}`);
      if (state === "warn") warnings.push(detail);
    };
    if (plan.status !== "active") pcheck("status", "fail", w.planNotActive(plan.status), plan.status);
    else pcheck("status", "pass", w.planActive, plan.status);
    if (rules.outcomeId !== input.outcomeId) pcheck("outcome", "fail", w.planOtherOutcome(rules.outcomeLabel, rules.question));
    else pcheck("outcome", "pass", w.planOutcome(rules.outcomeLabel));
    if (input.side === "buy" && input.requested > rules.amountUsd + 1e-9) pcheck("amount", "fail", w.planAmountOver(money(rules.amountUsd), money(input.requested)), money(rules.amountUsd));
    else pcheck("amount", "pass", w.planAmountOk(money(rules.amountUsd)), money(rules.amountUsd));
    if (rules.maxProbability !== null && route.avgProbability != null) {
      if (route.avgProbability > rules.maxProbability) pcheck("max_probability", "fail", w.planBoundOver(pct(route.avgProbability), pct(rules.maxProbability)), pct(rules.maxProbability));
      else pcheck("max_probability", "pass", w.planBoundOk(pct(route.avgProbability), pct(rules.maxProbability)), pct(rules.maxProbability));
    } else if (route.avgProbability != null) pcheck("max_probability", "pass", w.planNoBound(pct(route.avgProbability)), pct(route.avgProbability));
    if (rules.invalidation.probabilityBelow !== null && outcome?.probability != null && outcome.probability < rules.invalidation.probabilityBelow) {
      pcheck("invalidation", "fail", w.planInvalidated(pct(outcome.probability), pct(rules.invalidation.probabilityBelow)), pct(rules.invalidation.probabilityBelow));
    } else pcheck("invalidation", "pass", rules.invalidation.probabilityBelow !== null ? w.planAboveInvalidation(pct(rules.invalidation.probabilityBelow)) : rules.invalidation.text);
    if (rules.resolutionDeadline && Date.parse(rules.resolutionDeadline) <= nowMs) pcheck("deadline", "fail", w.planDeadlinePassed);
    else if (rules.resolutionDeadline) pcheck("deadline", "pass", w.planDeadline(rules.resolutionDeadline.slice(0, 10)));
    planBlock = { id: plan.id, version: plan.version, checks: planChecks };
  }

  return {
    mode: "paper",
    quoteId: route.quoteId,
    event: { id: event.id, title: event.title, endDate: event.endDate },
    market: market ? { id: market.id, question: market.question, venue: market.venue, resolutionDate: market.resolutionDate, rules: market.rules } : { id: input.venueMarketId, question: event.title, venue: event.venue, resolutionDate: null, rules: { primary: null, secondary: null } },
    outcome: { id: input.outcomeId, label: outcome?.label ?? "—" },
    side: input.side,
    requested: input.requested,
    route,
    figures: {
      probability: route.avgProbability,
      shares: route.shares,
      costUsd: route.costUsd,
      feesUsd,
      totalUsd,
      payoutIfRightUsd: payout,
      profitIfRightUsd: profit,
      maxLossUsd: input.side === "buy" ? totalUsd : 0,
      returnIfRightPct: route.returnPct ?? (totalUsd > 0 ? (profit / totalUsd) * 100 : null),
    },
    quote: { quotedAt: route.quotedAt, expiresAt: route.expiresAt, ageSeconds, expired },
    venues: route.fills.map((f) => f.venue),
    settlement: event.settlement,
    balance,
    checks,
    warnings,
    plan: planBlock,
    canPlace: blockedBy.length === 0,
    blockedBy,
  };
}

/* ------------------------------------------------------------- quote */

export type QuoteInput = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  spendUsd?: number;
  sellShares?: number;
  planId?: string | null;
  locale?: ReviewLocale;
}>;

export type QuoteResult = Readonly<{ review: PaperReview; link: LinkStatus; record: PredictionOrderRecord }>;

/**
 * Build the Review for a paper order: the event read fresh, the route priced
 * in paper mode for the person's own session (so the provider's balance
 * check is real), the paper balance read, the plan's conditions judged, the
 * record stored as `reviewed` under the quote id.
 */
export async function quotePaper(store: GuardStore, provider: PredictionProvider, wallet: string, input: QuoteInput, nowMs: number = Date.now()): Promise<Result<QuoteResult>> {
  const requested = input.side === "buy" ? (input.spendUsd ?? 0) : (input.sellShares ?? 0);
  if (!Number.isFinite(requested) || requested <= 0) return failure("VALIDATION_ERROR", "Name an amount above zero.", { issues: [{ path: input.side === "buy" ? "spendUsd" : "sellShares", message: "above zero" }] });
  const event = await provider.event(input.eventId);
  if (!event.ok) return event;
  const link = await linkStatus(store, wallet);
  const plan = input.planId ? await readPredictionPlan(store, wallet, input.planId, nowMs) : null;
  if (plan && !plan.ok) return plan;

  const priced = await withProviderSession(store, provider, wallet, async (session) => {
    const [route, balance] = await Promise.all([
      provider.route(session, { outcomeId: input.outcomeId, side: input.side, spendUsd: input.spendUsd, sellShares: input.sellShares }),
      provider.paperBalance(session),
    ]);
    if (!route.ok) return route;
    return { ok: true as const, value: { route: route.value, balance: balance.ok ? balance.value : null } };
  });
  if (!priced.ok) return priced;

  const review = buildReview({
    event: event.value,
    venueMarketId: input.venueMarketId,
    outcomeId: input.outcomeId,
    side: input.side,
    requested,
    route: priced.value.route,
    balance: priced.value.balance,
    plan: plan ? plan.value : null,
    nowMs,
    locale: input.locale ?? "en",
  });
  const at = new Date(nowMs).toISOString();
  const record: PredictionOrderRecord = {
    version: 1,
    wallet,
    quoteId: review.quoteId,
    eventId: event.value.id,
    eventTitle: event.value.title,
    venueMarketId: review.market.id,
    question: review.market.question,
    outcomeId: input.outcomeId,
    outcomeLabel: review.outcome.label,
    side: input.side,
    requested,
    review,
    planId: plan ? plan.value.id : null,
    planVersion: plan ? plan.value.version : null,
    state: "reviewed",
    providerOrderIds: [],
    execution: null,
    providerOrders: [],
    submittedAt: null,
    settledAt: null,
    createdAt: at,
    updatedAt: at,
  };
  const inserted = await orders(store).insertIfAbsent(orderKey(wallet, review.quoteId), record);
  if (!inserted) return failure("UNAVAILABLE", "This quote was already reviewed; ask for a fresh one.");
  if (plan) await recordPredictionPlanExecution(store, wallet, plan.value.id, { quoteId: review.quoteId, state: "reviewed", kind: "reviewed" }, new Date(nowMs));
  return { ok: true, value: { review, link, record } };
}

/* ------------------------------------------------------------- place */

async function patchOrder(store: GuardStore, wallet: string, quoteId: string, patch: (current: PredictionOrderRecord) => PredictionOrderRecord): Promise<PredictionOrderRecord | null> {
  const collection = orders(store);
  const key = orderKey(wallet, quoteId);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return null as never;
      const next = { ...patch(current), version: current.version + 1 };
      return (await collection.compareAndSet(key, current.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

function stateOf(execution: PaperExecution): PaperOrderState {
  switch (execution.state) {
    case "filled":
      return "filled";
    case "partially_filled":
      return "partially_filled";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "submitted";
  }
}

const SETTLE_POLL_MS = 1_200;
const SETTLE_POLL_MAX_MS = 12_000;

/**
 * Place the reviewed paper order: the quote must still be fresh and the
 * Review must not have refused; the provider accepts the fill and the
 * execution is polled to a terminal state (at most twelve seconds here,
 * the rest by `syncPaperOrder`). Every state the provider reports is written
 * on the record; nothing is claimed filled until the provider says so.
 */
export async function placePaper(store: GuardStore, provider: PredictionProvider, wallet: string, quoteId: string, nowMs: number = Date.now()): Promise<Result<PredictionOrderRecord>> {
  const current = await orders(store).get(orderKey(wallet, quoteId));
  if (!current) return failure("NOT_FOUND", "No Review for that quote; ask for a fresh one.");
  if (current.state !== "reviewed") return { ok: true, value: current };
  if (!current.review.canPlace) return failure("ORDER_REFUSED", `The Review refused this order: ${current.review.blockedBy.join(", ")}.`);
  if (Date.parse(current.review.route.expiresAt) <= nowMs || nowMs - Date.parse(current.review.route.quotedAt) > QUOTE_MAX_AGE_S * 1000) {
    await patchOrder(store, wallet, quoteId, (c) => ({ ...c, state: "expired", updatedAt: new Date(nowMs).toISOString() }));
    return failure("QUOTE_EXPIRED", "The quote expired before the order was placed; ask for a fresh Review.");
  }

  const accepted = await withProviderSession(store, provider, wallet, (session) =>
    provider.execute(session, {
      quoteId,
      fallback: { outcomeId: current.outcomeId, side: current.side, spendUsd: current.side === "buy" ? current.requested : undefined, sellShares: current.side === "sell" ? current.requested : undefined },
    }),
  );
  if (!accepted.ok) {
    if (accepted.code === "VALIDATION_ERROR" || accepted.code === "QUOTE_UNAVAILABLE") {
      await patchOrder(store, wallet, quoteId, (c) => ({ ...c, state: "failed", updatedAt: new Date(nowMs).toISOString() }));
      return failure("ORDER_REFUSED", accepted.message);
    }
    return accepted;
  }
  const submittedAt = new Date().toISOString();
  let record = await patchOrder(store, wallet, quoteId, (c) => ({ ...c, state: "submitted", providerOrderIds: accepted.value.orderIds, submittedAt, updatedAt: submittedAt }));
  if (!record) return failure("UNAVAILABLE", "The order was accepted by the provider but could not be recorded; reload to see it.");

  const deadline = Date.now() + SETTLE_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const synced = await syncPaperOrder(store, provider, wallet, quoteId);
    if (!synced.ok) break;
    record = synced.value;
    if (record.state !== "submitted") break;
    const wait = Math.min(Math.max(record.execution?.pollAfterMs ?? SETTLE_POLL_MS, 600), 3_000);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (record.planId) await recordPredictionPlanExecution(store, wallet, record.planId, { quoteId, state: record.state, kind: "executed" });
  return { ok: true, value: record };
}

/** Read the provider's execution status and its order rows for the quote and write them on the record. */
export async function syncPaperOrder(store: GuardStore, provider: PredictionProvider, wallet: string, quoteId: string): Promise<Result<PredictionOrderRecord>> {
  const current = await orders(store).get(orderKey(wallet, quoteId));
  if (!current) return failure("NOT_FOUND", "No such paper order.");
  if (current.state === "reviewed" || current.state === "expired") return { ok: true, value: current };
  const read = await withProviderSession(store, provider, wallet, async (session) => {
    const [execution, list] = await Promise.all([provider.executionStatus(session, quoteId), provider.paperOrders(session, 50)]);
    if (!execution.ok) return execution;
    return { ok: true as const, value: { execution: execution.value, providerOrders: list.ok ? list.value.filter((o) => o.quoteId === quoteId || current.providerOrderIds.includes(o.id)) : current.providerOrders } };
  });
  if (!read.ok) return read;
  const state = stateOf(read.value.execution);
  const at = new Date().toISOString();
  const next = await patchOrder(store, wallet, quoteId, (c) => ({
    ...c,
    state,
    execution: read.value.execution,
    providerOrders: read.value.providerOrders,
    providerOrderIds: read.value.execution.orderIds.length > 0 ? read.value.execution.orderIds : c.providerOrderIds,
    settledAt: read.value.execution.terminal ? (c.settledAt ?? at) : c.settledAt,
    updatedAt: at,
  }));
  return next ? { ok: true, value: next } : failure("UNAVAILABLE", "The paper order could not be updated; reload.");
}

export async function readPaperOrder(store: GuardStore, wallet: string, quoteId: string): Promise<PredictionOrderRecord | null> {
  return (await orders(store).get(orderKey(wallet, quoteId))) ?? null;
}

export async function listPaperOrders(store: GuardStore, wallet: string, limit = 50): Promise<readonly PredictionOrderRecord[]> {
  const rows = await orders(store).valuesWithPrefix(`${ORDER_PREFIX}${wallet}:`);
  return rows
    .filter((r) => r.wallet === wallet)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

/* ------------------------------------------------------------- the account */

export type PaperAccountView = Readonly<{
  link: LinkStatus;
  balance: PaperBalance | null;
  positions: readonly PaperPosition[];
  closedPositions: readonly PaperPosition[];
  providerOrders: readonly PaperOrder[];
  /** Ryntra's own records, newest first, states reconciled to the provider where they were still open. */
  orders: readonly PredictionOrderRecord[];
  readAt: string;
  /** Set when the provider could not be read; the rest is what the store holds. */
  providerFailure: PredictionFailure | null;
}>;

export async function readPaperAccount(store: GuardStore, provider: PredictionProvider, wallet: string): Promise<PaperAccountView> {
  const link = await linkStatus(store, wallet);
  const records = await listPaperOrders(store, wallet);
  const readAt = new Date().toISOString();
  if (link.state !== "active") return { link, balance: null, positions: [], closedPositions: [], providerOrders: [], orders: records, readAt, providerFailure: null };
  const read = await withProviderSession(store, provider, wallet, async (session) => {
    const [balance, positions, closed, list] = await Promise.all([provider.paperBalance(session), provider.paperPositions(session, "active"), provider.paperPositions(session, "closed"), provider.paperOrders(session, 100)]);
    if (!balance.ok) return balance;
    return { ok: true as const, value: { balance: balance.value, positions: positions.ok ? positions.value : [], closed: closed.ok ? closed.value : [], list: list.ok ? list.value : [] } };
  });
  if (!read.ok) return { link: await linkStatus(store, wallet), balance: null, positions: [], closedPositions: [], providerOrders: [], orders: records, readAt, providerFailure: read };
  /* Records the provider has not settled yet are re-read here, so a reload never shows a stale `submitted`. */
  const open = records.filter((r) => r.state === "submitted");
  const synced: PredictionOrderRecord[] = [];
  for (const r of open.slice(0, 5)) {
    const s = await syncPaperOrder(store, provider, wallet, r.quoteId);
    synced.push(s.ok ? s.value : r);
  }
  const byQuote = new Map(synced.map((r) => [r.quoteId, r] as const));
  return {
    link,
    balance: read.value.balance,
    positions: read.value.positions,
    closedPositions: read.value.closed,
    providerOrders: read.value.list,
    orders: records.map((r) => byQuote.get(r.quoteId) ?? r),
    readAt,
    providerFailure: null,
  };
}
