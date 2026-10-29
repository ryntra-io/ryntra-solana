"use client";

import { ChatCircleText, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { venueAccess, type AccessFacts } from "@/lib/predictions/access";
import { payoutEstimate, type ReviewCostLineId } from "@/lib/predictions/costs";
import { eventInPlay, type PredictionEvent, type PredictionMarket } from "@/lib/predictions/model";
import { marketLive } from "@/lib/predictions/resolution";
import type { PaperReview } from "@/lib/predictions/paper";
import type { PredictionPlan } from "@/lib/predictions/plan-model";
import { parseDecimalInput } from "@/lib/plans/decimal-input";
import { cancellable } from "@/lib/predictions/order-state";
import { LIMIT_LIVES, LIMIT_PRICE_MAX, LIMIT_PRICE_MIN, limitCancellable, limitWorking, type LimitLife } from "@/lib/predictions/limit-model";
import type { LimitOrdersView, LimitReview } from "@/lib/predictions/limit";
import { createTicketKeep, type TicketFlow, type TicketKeep, type TicketState } from "@/lib/predictions/ticket-keep";
import { chanceHero } from "@/lib/predictions/units";
import { topicQuestion } from "@/lib/predictions/assistant/topics";

import { AccessChip } from "../access-chip";
import { ConnectAction, orderStateWord, orderTone } from "../account-card";
import { pct, shares, usd } from "../format";
import styles from "../predictions.module.css";
import { usePredictPrefs } from "../prefs-context";
import { useAccessFacts } from "../use-market-facts";
import type { usePaperAccount } from "../use-paper-account";
import { useLimitOrders } from "../use-limit";
import { useLive, type LiveData } from "../use-live";
import { limitStateWord, limitTone, lossSentence, outcomeLabel, payoffSentence, ryntraFeeLabel, savingSentence, venueName, wordsFor, type PredictionWord } from "../words";
import { BriefLine, ReviewBrief } from "./resolution-brief";

type Account = ReturnType<typeof usePaperAccount>;

const PRESETS = [5, 10, 25, 50] as const;

/**
 * The ticket as the page keeps it, and as it stands now; `live` — whether
 * real money is open to this wallet, as the server says; `limits` — the
 * wallet's standing limit orders, read back from the venue by the server.
 */
export type Ticket = Readonly<{ keep: TicketKeep; state: TicketState; live: LiveData | null; limits: LimitOrdersView | null; refreshLimits: () => Promise<void> }>;

/**
 * The ticket's keep, made once by the page and read by the ticket's panel and
 * by the Review the page draws — the amount (the usual one until the person
 * types or picks a plan; it may arrive later, from the account), the chosen
 * plan and the Review open — so the workspace rebuilding the panel, or the
 * person putting it away and bringing it back, loses none of it.
 */
export function useTicket(account: Account): Ticket {
  const { prefs } = usePredictPrefs();
  const [keep] = useState(() => createTicketKeep({ amount: String(prefs.amountUsd), send: (path, init) => fetch(path, init) }));
  const state = useSyncExternalStore(keep.subscribe, keep.get, keep.get);
  const linkedWallet = account.state.status === "ready" && account.state.account.link.state === "active" ? account.state.account.wallet : null;
  const { live, refresh: refreshLive } = useLive(linkedWallet, linkedWallet !== null);
  const { limits, refresh: refreshLimits } = useLimitOrders(linkedWallet, linkedWallet !== null);
  const liveOpen = live?.access.state === "open";

  useEffect(() => {
    keep.offerAmount(String(prefs.amountUsd));
  }, [keep, prefs.amountUsd]);

  /* Real money closed (or never open) for this wallet: the ticket is a simulation again. */
  useEffect(() => {
    if (!liveOpen && state.mode === "live") keep.chooseMode("paper");
  }, [keep, liveOpen, state.mode]);

  /* A submitted order is read again every two seconds until the provider reports a terminal state. */
  const submitted = state.flow.stage === "placed" && state.flow.order.state === "submitted" ? state.flow.order.quoteId : null;
  useEffect(() => {
    if (!submitted) return undefined;
    const timer = setInterval(() => void keep.reread(), 2_000);
    return () => clearInterval(timer);
  }, [keep, submitted]);

  const settled = state.flow.stage === "placed" && state.flow.order.state !== "submitted" ? `${state.flow.order.quoteId}:${state.flow.order.state}` : null;
  useEffect(() => {
    if (!settled) return;
    void account.refresh();
    void refreshLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the account is re-read once per settled order
  }, [settled]);

  /* A limit order the venue may still move is read again every three seconds. */
  const standing = state.flow.stage === "limitPlaced" && limitWorking(state.flow.order.state) ? state.flow.order.id : null;
  useEffect(() => {
    if (!standing) return undefined;
    const timer = setInterval(() => void keep.rereadLimit(), 3_000);
    return () => clearInterval(timer);
  }, [keep, standing]);

  const limitDone = state.flow.stage === "limitPlaced" ? `${state.flow.order.id}:${state.flow.order.state}` : null;
  useEffect(() => {
    if (!limitDone) return;
    void refreshLimits();
    void account.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the list is re-read once per state the venue reports
  }, [limitDone]);

  return useMemo(() => ({ keep, state, live, limits, refreshLimits }), [keep, state, live, limits, refreshLimits]);
}

/**
 * The ticket over the smart route, in simulation. The ticket asks two things
 * — which outcome and how much — and says beside the payout what is lost if
 * the outcome does not come true; a market that no longer trades says so to
 * everyone, a guest included. The rest is the server's: the route is priced
 * for the person's own paper session and shown in the Review (`TicketReview`,
 * drawn by the page), whose one act is *Place paper order*.
 */
export function PaperTicket({
  event,
  market,
  outcomeId,
  onOutcome,
  locale,
  account,
  askPrice,
  ticket,
  nowMs,
  onAsk,
}: {
  event: PredictionEvent;
  market: PredictionMarket;
  outcomeId: string;
  onOutcome: (outcomeId: string) => void;
  locale: WorkspaceLocale;
  account: Account;
  /** The outcome's best ask on the market's own venue, when the live read has one; the ticket's estimate prefers it to the midpoint. */
  askPrice: number | null;
  /** What the person has typed and chosen and the Review over it, kept by the page so it outlives the panel being rebuilt. */
  ticket: Ticket;
  /** The clock the event was read at: the deadline and its warning count from it. */
  nowMs?: number;
  /** «Ask Ryntra» what has to happen for the chosen outcome to win; absent where no assistant panel stands beside the ticket. */
  onAsk?: () => void;
}) {
  const word = wordsFor(locale);
  const { prefs } = usePredictPrefs();
  const [readAt] = useState(() => Date.now());
  const clock = nowMs ?? readAt;
  const { keep, state } = ticket;
  const { amount, planId, flow } = state;
  const liveAccess = ticket.live?.access.state === "open" ? ticket.live.access : null;
  const real = state.mode === "live" && liveAccess !== null;
  const outcome = market.outcomes.find((o) => o.id === outcomeId) ?? market.outcomes[0];
  const spend = parseDecimalInput(amount);
  const parsedOk = spend !== null && spend > 0;
  const linked = account.state.status === "ready" && account.state.account?.link.state === "active";
  const inPlay = eventInPlay(event, clock);
  const open = marketLive(market, event.endDate, clock, inPlay);
  /* A limit ticket is priced by the person, so its promise is read at their own price. */
  const limit = state.kind === "limit";
  const typedPct = parseDecimalInput(state.price);
  const limitPrice = typedPct == null ? null : Math.round((typedPct / 100) * 1e6) / 1e6;
  const limitPriceOk = limitPrice !== null && limitPrice >= LIMIT_PRICE_MIN && limitPrice <= LIMIT_PRICE_MAX;
  const payout = open ? payoutEstimate(spend, limit ? limitPrice : (askPrice ?? outcome?.probability ?? null)) : null;
  /* The best ask fills the price field once, so the person starts from the market rather than from nothing. */
  useEffect(() => {
    if (limit && state.price === "" && askPrice != null && askPrice > 0) keep.typePrice((askPrice * 100).toFixed(1));
  }, [keep, limit, state.price, askPrice]);
  /* On a Yes/No market the losing side has a name; with more outcomes it is «not this one». */
  const other = market.outcomes.length === 2 ? (market.outcomes.find((o) => o.id !== outcome?.id) ?? null) : null;
  const plans = useMemo(
    () => (account.state.account?.plans ?? []).filter((p) => p.status === "active" && p.current.rules.eventId === event.id),
    [account.state.account?.plans, event.id],
  );

  useEffect(() => {
    if (planId && !plans.some((p) => p.id === planId)) keep.choosePlan(null);
  }, [plans, planId, keep]);

  /* A plan chosen brings its own amount and outcome. */
  const applyPlan = useCallback(
    (plan: PredictionPlan | null) => {
      if (!plan) {
        keep.choosePlan(null);
        return;
      }
      keep.choosePlan(plan.id, String(plan.current.rules.amountUsd));
      onOutcome(plan.current.rules.outcomeId);
    },
    [keep, onOutcome],
  );

  const quote = () => {
    if (!outcome || spend == null || spend <= 0) return;
    if (limit) {
      if (!limitPriceOk) return;
      void keep.reviewLimit({ eventId: event.id, venueMarketId: market.id, outcomeId: outcome.id, price: limitPrice, amountUsd: spend, life: state.life, planId, locale, mode: real ? "live" : "paper" });
      return;
    }
    void keep.quote({ eventId: event.id, venueMarketId: market.id, outcomeId: outcome.id, spendUsd: spend, planId, locale, mode: real ? "live" : "paper" });
  };

  /* One step from the plan: its amount at the highest price it allows, and the Review of it opened. */
  const planToLimit = (plan: PredictionPlan) => {
    onOutcome(plan.current.rules.outcomeId);
    void keep.fromPlan(plan, locale);
  };

  return (
    <section className={styles.card} aria-labelledby="pred-ticket">
      <div className={styles.cardHead}>
        <h2 id="pred-ticket" className={styles.cardTitle}>
          {word("paperBuy")}
        </h2>
        <span className={styles.paperBadge} data-live={real ? "true" : undefined}>{real ? word("liveBadge") : word("paperBadge")}</span>
      </div>
      <div className={styles.ticket}>
        <p className={styles.muted}>{market.question}</p>
        <BriefLine event={event} market={market} outcomeLabel={outcome?.label ?? null} locale={locale} nowMs={clock} inPlay={inPlay && open} />
        <div className={styles.sideRow} role="group" aria-label={word("outcomes")}>
          {market.outcomes.slice(0, 2).map((o) => (
            <button key={o.id} type="button" className={styles.sideButton} aria-pressed={o.id === outcome?.id} onClick={() => onOutcome(o.id)}>
              {outcomeLabel(o.label, locale)}
              <small>{open ? chanceHero(o.probability, prefs.units, prefs.amountUsd).text : o.winner === true ? "✓" : "—"}</small>
            </button>
          ))}
        </div>
        {market.outcomes.length > 2 ? (
          <select className={styles.selectInput} value={outcome?.id} aria-label={word("outcome")} onChange={(e) => onOutcome(e.target.value)}>
            {market.outcomes.map((o) => (
              <option key={o.id} value={o.id}>
                {outcomeLabel(o.label, locale)} · {open ? chanceHero(o.probability, prefs.units, prefs.amountUsd).text : o.winner === true ? "✓" : "—"}
              </option>
            ))}
          </select>
        ) : null}
        {payout != null && outcome ? (
          <div className={styles.payoff}>
            <b>{payoffSentence(usd(spend, Number.isInteger(spend) ? 0 : 2), outcomeLabel(outcome.label, locale), usd(payout), locale)}</b>
            <span className={styles.loss}>{lossSentence(usd(spend, Number.isInteger(spend) ? 0 : 2), other ? outcomeLabel(other.label, locale) : null, locale)}</span>
            <span className={styles.hint}>{word("payoffHint")}</span>
          </div>
        ) : null}
        {!open ? <p className={styles.notice}>{market.status === "resolved" || market.outcomes.some((o) => o.winner === true) ? word("ticketResolved") : market.status === "open" ? word("ticketPast") : word("ticketClosed")}</p> : null}
        {onAsk && outcome && open ? (
          <button type="button" className={styles.askLink} onClick={onAsk}>
            <ChatCircleText size={16} aria-hidden="true" />
            <span>
              {word("askRyntra")}: {lowerFirst(topicQuestion("yes", locale, outcome.label))}
            </span>
          </button>
        ) : null}
        {/* A guest: one button. An account not yet enabled: its card under the ticket says what one signature does. */}
        {!open ? null : account.state.status === "guest" ? (
          <div className={styles.ticketAct}>
            <ConnectAction account={account} locale={locale} block />
          </div>
        ) : !linked ? null : (
          <>
            {liveAccess ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{word("modeLabel")}</span>
                <div className={styles.presets} role="group" aria-label={word("modeLabel")}>
                  <button type="button" className={styles.chip} aria-pressed={!real} onClick={() => keep.chooseMode("paper")}>
                    {word("modePaper")}
                  </button>
                  <button type="button" className={styles.chip} aria-pressed={real} onClick={() => keep.chooseMode("live")}>
                    {word("modeLive")}
                  </button>
                </div>
                {real ? <p className={styles.hint}>{word("liveLimit")} {usd(liveAccess.maxOrderUsd, 0)} · {liveAccess.venues.map(venueName).join(", ")}</p> : null}
              </div>
            ) : null}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{word("orderKind")}</span>
              <div className={styles.presets} role="group" aria-label={word("orderKind")}>
                <button type="button" className={styles.chip} aria-pressed={!limit} onClick={() => keep.chooseKind("market")}>
                  {word("kindMarket")}
                </button>
                <button type="button" className={styles.chip} aria-pressed={limit} onClick={() => keep.chooseKind("limit")}>
                  {word("kindLimit")}
                </button>
              </div>
              <p className={styles.hint}>{limit ? word("kindLimitHint") : word("kindMarketHint")}</p>
            </div>
            {limit ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pred-limit-price">
                  {word("limitPrice")} %
                </label>
                <input id="pred-limit-price" className={styles.input} inputMode="decimal" value={state.price} aria-invalid={!limitPriceOk} onChange={(e) => keep.typePrice(e.target.value)} />
                <p className={styles.hint}>{word("limitPriceHint")}</p>
              </div>
            ) : null}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="pred-amount">
                {word("amount")}
              </label>
              <input id="pred-amount" className={styles.input} inputMode="decimal" value={amount} aria-invalid={!parsedOk} onChange={(e) => keep.typeAmount(e.target.value)} />
              <div className={styles.presets}>
                {PRESETS.map((p) => (
                  <button key={p} type="button" className={styles.chip} aria-pressed={spend === p} onClick={() => keep.typeAmount(String(p))}>
                    ${p}
                  </button>
                ))}
              </div>
              {payout == null ? <p className={styles.hint}>{word("amountHint")}</p> : null}
            </div>
            {limit ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pred-limit-life">
                  {word("limitLife")}
                </label>
                <select id="pred-limit-life" className={styles.selectInput} value={state.life} onChange={(e) => keep.chooseLife(e.target.value as LimitLife)}>
                  {LIMIT_LIVES.map((life) => (
                    <option key={life} value={life}>
                      {word(LIFE_WORD[life])}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {plans.length > 0 ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="pred-plan">
                  {word("underPlan")}
                </label>
                <select id="pred-plan" className={styles.selectInput} value={planId ?? ""} onChange={(e) => applyPlan(plans.find((p) => p.id === e.target.value) ?? null)}>
                  <option value="">{word("noPlan")}</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.current.rules.outcomeLabel} · {usd(p.current.rules.amountUsd, 0)} · v{p.version}
                    </option>
                  ))}
                </select>
                {planId ? (
                  <>
                    <button type="button" className={styles.chip} disabled={flow.stage === "quoting"} onClick={() => planToLimit(plans.find((p) => p.id === planId)!)}>
                      {word("planToLimit")}
                    </button>
                    <p className={styles.hint}>{word("planToLimitHint")}</p>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className={styles.ticketAct}>
              <button type="button" className="rw-btn rw-btn--primary" disabled={!outcome || spend == null || spend <= 0 || (limit && !limitPriceOk) || flow.stage === "quoting"} onClick={quote}>
                {flow.stage === "quoting" ? word("quoting") : `${limit ? word("limitReview") : word("review")} · ${spend != null ? usd(spend, 0) : "—"}`}
              </button>
            </div>
            {(flow.stage === "failed" && !flow.review) || (flow.stage === "limitFailed" && !flow.review) ? <p className={styles.error}>{failureWords(flow.code, flow.message, locale)}</p> : null}
            <LimitOrders ticket={ticket} eventId={event.id} locale={locale} />
          </>
        )}
      </div>
    </section>
  );
}

const LIFE_WORD: Readonly<Record<LimitLife, PredictionWord>> = { "1h": "life1h", "6h": "life6h", "1d": "life1d", "3d": "life3d", "7d": "life7d", until_cancelled: "lifeGtc" };

/**
 * The wallet's standing limit orders on this market, as the venue has them:
 * the price, what has filled of them, the state in one word, and the one act
 * that takes back whatever has not filled.
 */
function LimitOrders({ ticket, eventId, locale }: { ticket: Ticket; eventId: string; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const [busy, setBusy] = useState<string | null>(null);
  const { limits, refreshLimits } = ticket;
  const mine = (limits?.orders ?? []).filter((o) => o.eventId === eventId && o.state !== "reviewed");
  /* Everything the venue may still move, and only the last few that are over: the ticket is not a history. */
  const rows = [...mine.filter((o) => limitWorking(o.state)), ...mine.filter((o) => !limitWorking(o.state)).slice(0, 3)];
  const cancel = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/predictions/limit/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { accept: "application/json" } });
    } catch {
      /* No answer: the list is read again below, and the venue's own state is what is shown. */
    }
    await refreshLimits();
    setBusy(null);
  };
  if (rows.length === 0) return null;
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{word("limitOrders")}</span>
      {limits?.providerFailure ? <p className={styles.notice}>{word("limitOrdersUnread")}</p> : null}
      <ul className={styles.limitRows}>
        {rows.map((order) => (
          <li key={order.id} className={styles.limitRow}>
            <span className={styles.limitFacts}>
              <b>{outcomeLabel(order.outcomeLabel, locale)}</b>
              <span>{pct(order.review.figures.price, 1)}</span>
              <span>{usd(order.review.amountUsd, 2)}</span>
              {order.filledShares > 0 ? (
                <span>
                  {word("limitFilledOf")} {shares(order.filledShares)}/{shares(order.review.figures.shares)}
                </span>
              ) : null}
              {order.expiresAt ? <span>{order.expiresAt.replace("T", " ").slice(0, 16)}</span> : <span>{word("limitStandsGtc")}</span>}
              {order.mode === "paper" ? <span>{word("paperBadge")}</span> : null}
            </span>
            <span className={styles.limitActs}>
              <span className={styles.stateChip} data-tone={limitTone(order.state)}>
                {limitStateWord(order.state, word)}
              </span>
              {limitCancellable(order) ? (
                <button type="button" className={styles.chip} disabled={busy === order.id} onClick={() => void cancel(order.id)}>
                  {busy === order.id ? word("cancelling") : word("limitCancel")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Review over the ticket — what the person puts on the outcome, what it
 * pays if right, what they lose if wrong, the fees, the quote's age, the
 * venues that fill it, the settlement summary and every check, and the one
 * act *Place paper order*; a refused Review names why and offers a fresh
 * price; a placed order shows what the provider reported, never more. Drawn
 * by the page, not by the ticket's panel: nothing the workspace does to its
 * panels closes it.
 */
export function TicketReview({
  ticket,
  event,
  market,
  outcomeId,
  locale,
  pro,
  account,
}: {
  ticket: Ticket;
  event: PredictionEvent;
  market: PredictionMarket;
  /** The outcome the page has chosen: a limit Review built for another one is out of date. */
  outcomeId: string;
  locale: WorkspaceLocale;
  pro: boolean;
  account: Account;
}) {
  const access = useAccessFacts(account.state);
  const { keep, state } = ticket;
  const flow = state.flow;
  const close = useCallback(() => keep.close(), [keep]);
  const place = useCallback((review: PaperReview) => void keep.place(review), [keep]);
  const requote = useCallback(() => void keep.requote(), [keep]);
  const cancel = useCallback(() => keep.cancel(), [keep]);
  const placeLimit = useCallback((review: LimitReview) => void keep.placeLimit(review), [keep]);
  const cancelLimit = useCallback(() => keep.cancelLimit(), [keep]);
  if (flow.stage === "limitReview" || flow.stage === "limitPlacing" || flow.stage === "limitPlaced" || (flow.stage === "limitFailed" && flow.review)) {
    return <LimitReviewSheet flow={flow} locale={locale} outcomeId={outcomeId} onClose={close} onPlace={placeLimit} onRequote={requote} onCancel={cancelLimit} />;
  }
  if (!(flow.stage === "review" || flow.stage === "placing" || flow.stage === "placed" || (flow.stage === "failed" && flow.review))) return null;
  return <ReviewSheet flow={flow} locale={locale} pro={pro} access={access} event={event} market={market} onClose={close} onPlace={place} onRequote={requote} onCancel={cancel} />;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function failureWords(code: string, message: string, locale: WorkspaceLocale): string {
  const word = wordsFor(locale);
  switch (code) {
    case "NOT_LINKED":
      return word("notLinkedText");
    case "SESSION_EXPIRED":
      return word("sessionExpired");
    case "QUOTE_EXPIRED":
      return word("expired");
    case "RATE_LIMITED":
      return word("rateLimited");
    case "PROVIDER_UNAVAILABLE":
    case "NETWORK":
      return word("unavailable");
    default:
      return message || word("unavailable");
  }
}

const COST_WORD: Readonly<Record<Exclude<ReviewCostLineId, "ryntra">, PredictionWord>> = {
  contracts: "costContracts",
  venue: "costVenue",
  gas: "costGas",
  bridge: "costBridge",
  setup: "costSetup",
  referral: "costReferral",
};

function ReviewSheet({
  flow,
  locale,
  pro,
  access,
  event,
  market,
  onClose,
  onPlace,
  onRequote,
  onCancel,
}: {
  flow: TicketFlow;
  locale: WorkspaceLocale;
  pro: boolean;
  access: AccessFacts;
  event: PredictionEvent;
  market: PredictionMarket;
  onClose: () => void;
  onPlace: (review: PaperReview) => void;
  onRequote: () => void;
  onCancel: () => Promise<void>;
}) {
  const word = wordsFor(locale);
  const [cancelling, setCancelling] = useState(false);
  const review = flow.stage === "review" || flow.stage === "placing" ? flow.review : flow.stage === "failed" ? flow.review : flow.stage === "placed" ? flow.order.review : null;
  const [ageSeconds, setAge] = useState(review?.quote.ageSeconds ?? 0);
  useEffect(() => {
    if (!review) return undefined;
    const tick = () => setAge(Math.max(0, Math.round((Date.now() - Date.parse(review.quote.quotedAt)) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [review]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!review) return null;
  const expired = Date.parse(review.route.expiresAt) <= Date.now() || ageSeconds > 90;
  const placed = flow.stage === "placed" ? flow.order : null;
  const real = review.mode === "live";
  const figures = review.figures;
  const costs = review.costs ?? null;
  /* A venue's own quote can say why it refuses this person; its reason weighs like a warning. */
  const said = [...review.route.warnings, ...(review.route.solos ?? []).flatMap((s) => (s.unavailableReason ? [{ venue: s.venue, reason: s.unavailableReason }] : []))];
  const routeAccess = [...new Set(review.venues)].map((v) => ({ venue: v, state: venueAccess(v, access, said) }));
  /* Ryntra's fee the order does not take sits under the total, so the lines above add up to it. */
  const taken = costs ? costs.lines.filter((l) => l.id !== "ryntra" || costs.ryntra.charged) : [];
  const restricted = routeAccess.some((a) => a.state !== "open");
  /* The rules as the Review's quote carries them: the comparison the route was priced against. */
  const settled: PredictionEvent = review.settlement ? { ...event, settlement: review.settlement } : event;
  const reviewed = event.markets.find((m) => m.id === review.market.id) ?? market;
  /* Drawn at the document's root — inside the page a fixed layer stays under the chart and the shell's header — in the product's own scope, so its buttons keep their look. */
  return createPortal(
    <div className="ry-product">
    <div className={styles.overlay} role="presentation" onClick={(e) => { if (e.target === e.currentTarget && flow.stage !== "placing") onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pred-review-title">
        <div className={styles.sheetHead}>
          <h2 id="pred-review-title">{placed ? (real ? word("placedLive") : word("placed")) : word("reviewTitle")}</h2>
          <span className={styles.actions}>
            <span className={styles.paperBadge} data-live={real ? "true" : undefined}>{real ? word("liveBadge") : word("paperBadge")}</span>
            <button type="button" className={styles.iconButton} aria-label={word("close")} onClick={onClose} disabled={flow.stage === "placing"}>
              <X size={18} />
            </button>
          </span>
        </div>
        <div className={styles.cardBody}>
          {!placed ? <p className={styles.note}>{real ? word("liveReviewIntro") : word("reviewIntro")}</p> : null}
          <dl className={styles.kv}>
            <dt>{word("marketLabel")}</dt>
            <dd data-prose="true">{review.market.question}</dd>
            <dt>{word("outcome")}</dt>
            <dd>{outcomeLabel(review.outcome.label, locale)}</dd>
            <dt>{word("routeVenues")}</dt>
            <dd data-prose="true">
              {routeAccess.length ? (
                <span className={styles.routeAccess}>
                  {routeAccess.map((a) => (
                    <span key={a.venue}>
                      {venueName(a.venue)} <AccessChip state={a.state} venue={a.venue} locale={locale} />
                    </span>
                  ))}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </dl>
          <div className={styles.reviewFigures}>
            <Figure label={word("amount")} value={usd(review.requested)} />
            <Figure label={word("buysAt")} value={pct(figures.probability, 1)} />
            <Figure label={word("payoutIfRight")} value={usd(figures.payoutIfRightUsd)} tone="pos" />
            <Figure label={word("maxLoss")} value={usd(figures.maxLossUsd)} tone="neg" />
          </div>
          {costs ? (
            <div>
              <h3 className={styles.sectionTitle}>{word("costsTitle")}</h3>
              <dl className={styles.kv}>
                {taken.map((line) => (
                  <div key={line.id} style={{ display: "contents" }}>
                    <dt>{line.id === "ryntra" ? ryntraFeeLabel(costs.ryntra.bips, locale) : word(COST_WORD[line.id])}</dt>
                    <dd>{line.usd == null ? <span className={styles.muted}>{word("costNotStated")}</span> : usd(line.usd, line.usd > 0 && line.usd < 0.01 ? 4 : 2)}</dd>
                  </div>
                ))}
                <dt>{word("total")}</dt>
                <dd data-strong="true">{usd(costs.totalUsd)}</dd>
                {costs.ryntra.charged ? null : (
                  <>
                    <dt>
                      {word("ryntraWithReal")}: {ryntraFeeLabel(costs.ryntra.bips, locale)}
                    </dt>
                    <dd>
                      +{usd(costs.ryntra.usd)}
                      <small className={styles.costNote}>{word("ryntraNotCharged")}</small>
                    </dd>
                  </>
                )}
              </dl>
              {costs.saving ? <p className={styles.saving}>{savingSentence(usd(costs.saving.usd), venueName(costs.saving.venue), locale)}</p> : null}
            </div>
          ) : null}
          <dl className={styles.kv}>
            <dt>{word("shares")}</dt>
            <dd>{shares(figures.shares)}</dd>
            {costs ? null : (
              <>
                <dt>{word("fees")}</dt>
                <dd>{usd(figures.feesUsd, 4)}</dd>
                <dt>{word("total")}</dt>
                <dd data-strong="true">{usd(figures.totalUsd)}</dd>
              </>
            )}
            <dt>{word("profitIfRight")}</dt>
            <dd data-tone="pos">{usd(figures.profitIfRightUsd)}</dd>
            <dt>{word("balance")}</dt>
            <dd>{review.balance ? usd(review.balance.cashBalance) : "—"}</dd>
            <dt>{word("custodyReview")}</dt>
            <dd data-prose="true">{real ? word("custodyLiveValue") : word("custodyReviewValue")}</dd>
            <dt>{word("quoteAge")}</dt>
            <dd data-tone={expired ? "neg" : undefined}>{ageSeconds}s</dd>
          </dl>
          <ReviewBrief event={settled} market={reviewed} outcomeLabel={review.outcome.label} routeVenues={[...new Set(review.venues)]} locale={locale} nowMs={Date.now()} />
          {review.settlement?.sharedSummary ? (
            <p className={styles.hint} lang="en">
              {review.settlement.sharedSummary}
            </p>
          ) : null}
          <div>
            <h3 className={styles.sectionTitle}>{word("checks")}</h3>
            <ul className={styles.checks}>
              {review.checks.map((c, i) => (
                <li key={`${c.id}:${i}`} className={styles.check} data-state={c.state}>
                  <i aria-hidden="true">{c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "×"}</i>
                  <span>{c.detail}</span>
                  <b>{c.figure ?? ""}</b>
                </li>
              ))}
            </ul>
          </div>
          {review.plan ? (
            <div>
              <h3 className={styles.sectionTitle}>
                {word("planChecks")} · v{review.plan.version}
              </h3>
              <ul className={styles.checks}>
                {review.plan.checks.map((c, i) => (
                  <li key={`${c.id}:${i}`} className={styles.check} data-state={c.state}>
                    <i aria-hidden="true">{c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "×"}</i>
                    <span>{c.detail}</span>
                    <b>{c.figure ?? ""}</b>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {placed ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{word("orderState")}</span>
              <span className={styles.actions}>
                <span className={styles.stateChip} data-tone={orderTone(placed.state)}>
                  {orderStateWord(placed.state, word)}
                </span>
                {placed.execution?.orders.map((o) => (
                  <span key={o.orderId} className={styles.muted}>
                    {venueName(o.venue)} · {o.status} · {o.actualShares != null ? `${shares(o.actualShares)} @ ${pct(o.executionPrice, 1)}` : ""}
                    {o.error ? ` · ${o.error}` : ""}
                  </span>
                ))}
              </span>
              {placed.state === "submitted" ? <p className={styles.hint}>{word("submitted")}</p> : null}
            </div>
          ) : null}
          {flow.stage === "failed" ? <p className={styles.error}>{failureWords(flow.code, flow.message, locale)}</p> : null}
          {!review.canPlace && !placed ? (
            <p className={styles.error}>
              {word("blocked")}. {[...review.checks, ...(review.plan?.checks ?? [])].filter((c) => c.state === "fail").map((c) => c.detail).join(" ")}
            </p>
          ) : null}
          {expired && !placed && flow.stage !== "placing" ? <p className={styles.notice}>{word("expired")}</p> : null}
          <div className={styles.formActions}>
            {placed ? (
              <>
                {cancellable(placed) ? (
                  <button
                    type="button"
                    className="rw-btn"
                    disabled={cancelling}
                    onClick={() => {
                      setCancelling(true);
                      void onCancel().finally(() => setCancelling(false));
                    }}
                  >
                    {cancelling ? word("cancelling") : word("cancelRest")}
                  </button>
                ) : null}
                <button type="button" className="rw-btn rw-btn--primary" onClick={onClose}>
                  {word("close")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="rw-btn" onClick={onRequote} disabled={flow.stage === "placing"}>
                  {word("requote")}
                </button>
                <button type="button" className="rw-btn rw-btn--primary" disabled={!review.canPlace || expired || flow.stage === "placing"} onClick={() => onPlace(review)}>
                  {flow.stage === "placing" ? word("placing") : real ? word("placeLive") : word("placePaper")}
                </button>
              </>
            )}
          </div>
          <details className={styles.disclosure} open={pro}>
            <summary>{word("routeDetail")}</summary>
            <div className={styles.disclosureBody}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{word("venue")}</th>
                      <th>{word("price")}</th>
                      <th>{word("shares")}</th>
                      <th>{word("fees")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.route.fills.map((f, i) => (
                      <tr key={`${f.venue}:${i}`}>
                        <th scope="row">{venueName(f.venue)}</th>
                        <td>{pct(f.avgPrice, 1)}</td>
                        <td>{shares(f.shares)}</td>
                        <td>{usd((f.fees.venue ?? 0) + (f.fees.builder ?? 0) + (f.fees.settlement ?? 0), 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {review.route.venueSolo.length > 0 ? (
                <p>
                  {word("venueComparison")}:{" "}
                  {review.route.venueSolo.map((v) => `${venueName(v.venue)} ${Object.entries(v.fields).filter(([k]) => /price|cost|shares|filled/i.test(k)).slice(0, 3).map(([k, val]) => `${k} ${typeof val === "number" ? val.toFixed(4) : String(val)}`).join(", ")}`).join(" · ")}
                </p>
              ) : null}
              {review.route.warnings.length > 0 ? <p>{review.route.warnings.map((w) => `${venueName(w.venue)}: ${w.reason}`).join("; ")}</p> : null}
              {costs ? <p>{word("costsNote")}</p> : null}
              {restricted ? <p>{word("accessSimulation")}</p> : null}
              <p>{word("custodyLine")}</p>
              <p className={styles.mono}>
                quote {review.quoteId} · {review.route.solveMs} ms / {review.route.verifyMs} ms · {word("expires")} {review.route.expiresAt.replace("T", " ").slice(0, 19)} UTC
              </p>
              <p>{word("providerNote")}</p>
            </div>
          </details>
        </div>
      </div>
    </div>
    </div>,
    document.body,
  );
}

/**
 * The Review of a limit order before anything is placed: the price on the
 * venue's grid, the shares the amount buys at it, Ryntra's fee, the venue's
 * own fee (unknown before the fill and said to be unknown), what it pays if
 * the outcome wins — and what happens if it never fills. Its one act is
 * *Place the limit order*.
 *
 * A Review belongs to the ticket it was built for: a ticket changed in any
 * part marks it out of date, and an out-of-date Review is priced again
 * rather than placed. Once placed, the sheet shows the venue's own state and
 * the one act that takes back whatever has not filled.
 */
function LimitReviewSheet({
  flow,
  locale,
  outcomeId,
  onClose,
  onPlace,
  onRequote,
  onCancel,
}: {
  flow: TicketFlow;
  locale: WorkspaceLocale;
  outcomeId: string;
  onClose: () => void;
  onPlace: (review: LimitReview) => void;
  onRequote: () => void;
  onCancel: () => Promise<void>;
}) {
  const word = wordsFor(locale);
  const [cancelling, setCancelling] = useState(false);
  const review =
    flow.stage === "limitReview" || flow.stage === "limitPlacing" ? flow.review
    : flow.stage === "limitPlaced" ? flow.order.review
    : flow.stage === "limitFailed" ? flow.review
    : null;
  const [ageSeconds, setAge] = useState(0);
  useEffect(() => {
    if (!review) return undefined;
    const tick = () => setAge(Math.max(0, Math.round((Date.now() - Date.parse(review.reviewedAt)) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [review]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!review) return null;
  const placed = flow.stage === "limitPlaced" ? flow.order : null;
  /* Out of date: the ticket moved under it, or its own figures are no longer fresh. */
  const stale = !placed && ((flow.stage === "limitReview" && flow.stale) || review.outcome.id !== outcomeId || Date.parse(review.reviewExpiresAt) <= Date.now());
  const real = review.mode === "live";
  const f = review.figures;
  return createPortal(
    <div className="ry-product">
      <div className={styles.overlay} role="presentation" onClick={(e) => { if (e.target === e.currentTarget && flow.stage !== "limitPlacing") onClose(); }}>
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pred-limit-title">
          <div className={styles.sheetHead}>
            <h2 id="pred-limit-title">{placed ? word("limitPlacedTitle") : word("limitReviewTitle")}</h2>
            <span className={styles.actions}>
              <span className={styles.paperBadge} data-live={real ? "true" : undefined}>{real ? word("liveBadge") : word("paperBadge")}</span>
              <button type="button" className={styles.iconButton} aria-label={word("close")} onClick={onClose} disabled={flow.stage === "limitPlacing"}>
                <X size={18} />
              </button>
            </span>
          </div>
          <div className={styles.cardBody}>
            {!placed ? <p className={styles.note}>{real ? word("limitReviewIntroLive") : word("limitReviewIntro")}</p> : null}
            <dl className={styles.kv}>
              <dt>{word("marketLabel")}</dt>
              <dd data-prose="true">{review.market.question}</dd>
              <dt>{word("outcome")}</dt>
              <dd>{outcomeLabel(review.outcome.label, locale)}</dd>
              <dt>{word("venue")}</dt>
              <dd>{venueName(review.market.venue)}</dd>
            </dl>
            <div className={styles.reviewFigures}>
              <Figure label={word("limitAtMost")} value={pct(f.price, 1)} />
              <Figure label={word("amount")} value={usd(review.amountUsd)} />
              <Figure label={word("payoutIfRight")} value={usd(f.payoutIfRightUsd)} tone="pos" />
              <Figure label={word("maxLoss")} value={usd(f.maxLossUsd)} tone="neg" />
            </div>
            <dl className={styles.kv}>
              <dt>{word("shares")}</dt>
              <dd>{shares(f.shares)}</dd>
              <dt>{word("costContracts")}</dt>
              <dd>{usd(f.contractsUsd, f.contractsUsd > 0 && f.contractsUsd < 0.01 ? 4 : 2)}</dd>
              <dt>{ryntraFeeLabel(f.ryntraBips, locale)}</dt>
              <dd>
                {usd(f.ryntraFeeUsd, f.ryntraFeeUsd > 0 && f.ryntraFeeUsd < 0.01 ? 4 : 2)}
                <small className={styles.costNote}>{word("limitRyntraOnFill")}</small>
              </dd>
              <dt>{word("limitVenueFee")}</dt>
              <dd>
                <span className={styles.muted}>{word("costNotStated")}</span>
                <small className={styles.costNote}>{word("limitVenueFeeUnknown")}</small>
              </dd>
              <dt>{word("total")}</dt>
              <dd data-strong="true">{usd(f.totalUsd)}</dd>
              <dt>{word("profitIfRight")}</dt>
              <dd data-tone="pos">{usd(f.profitIfRightUsd)}</dd>
              <dt>{word("limitStands")}</dt>
              <dd>{review.expiresAt ? `${review.expiresAt.replace("T", " ").slice(0, 16)} UTC` : word("limitStandsGtc")}</dd>
              <dt>{word("balance")}</dt>
              <dd>{review.balance ? usd(review.balance.cashBalance) : "—"}</dd>
              {placed?.reservedUsd != null ? (
                <>
                  <dt>{word("limitReserved")}</dt>
                  <dd>{usd(placed.reservedUsd)}</dd>
                </>
              ) : null}
              <dt>{word("limitReviewAge")}</dt>
              <dd data-tone={stale ? "neg" : undefined}>{ageSeconds}s</dd>
            </dl>
            <div>
              <h3 className={styles.sectionTitle}>{word("checks")}</h3>
              <ul className={styles.checks}>
                {review.checks.map((c, i) => (
                  <li key={`${c.id}:${i}`} className={styles.check} data-state={c.state}>
                    <i aria-hidden="true">{c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "×"}</i>
                    <span>{c.detail}</span>
                    <b>{c.figure ?? ""}</b>
                  </li>
                ))}
              </ul>
            </div>
            {review.plan ? (
              <div>
                <h3 className={styles.sectionTitle}>
                  {word("planChecks")} · v{review.plan.version}
                </h3>
                <ul className={styles.checks}>
                  {review.plan.checks.map((c, i) => (
                    <li key={`${c.id}:${i}`} className={styles.check} data-state={c.state}>
                      <i aria-hidden="true">{c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "×"}</i>
                      <span>{c.detail}</span>
                      <b>{c.figure ?? ""}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {placed ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{word("orderState")}</span>
                <span className={styles.actions}>
                  <span className={styles.stateChip} data-tone={limitTone(placed.state)}>
                    {limitStateWord(placed.state, word)}
                  </span>
                  {placed.filledShares > 0 ? (
                    <span className={styles.muted}>
                      {word("limitFilledOf")} {shares(placed.filledShares)} / {shares(placed.review.figures.shares)} · {usd(placed.filledUsd)}
                      {placed.avgFillPrice != null ? ` @ ${pct(placed.avgFillPrice, 1)}` : ""}
                    </span>
                  ) : null}
                  {placed.error ? <span className={styles.muted}>{placed.error}</span> : null}
                </span>
              </div>
            ) : null}
            {flow.stage === "limitFailed" ? <p className={styles.error}>{failureWords(flow.code, flow.message, locale)}</p> : null}
            {!review.canPlace && !placed ? (
              <p className={styles.error}>
                {word("blocked")}. {[...review.checks, ...(review.plan?.checks ?? [])].filter((c) => c.state === "fail").map((c) => c.detail).join(" ")}
              </p>
            ) : null}
            {stale && flow.stage !== "limitPlacing" ? <p className={styles.notice}>{word("limitStale")}</p> : null}
            <div className={styles.formActions}>
              {placed ? (
                <>
                  {limitCancellable(placed) ? (
                    <button
                      type="button"
                      className="rw-btn"
                      disabled={cancelling}
                      onClick={() => {
                        setCancelling(true);
                        void onCancel().finally(() => setCancelling(false));
                      }}
                    >
                      {cancelling ? word("cancelling") : word("limitCancel")}
                    </button>
                  ) : null}
                  <button type="button" className="rw-btn rw-btn--primary" onClick={onClose}>
                    {word("close")}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="rw-btn" onClick={onRequote} disabled={flow.stage === "limitPlacing"}>
                    {word("requote")}
                  </button>
                  <button type="button" className="rw-btn rw-btn--primary" disabled={!review.canPlace || stale || flow.stage === "limitPlacing"} onClick={() => onPlace(review)}>
                    {flow.stage === "limitPlacing" ? word("placingLimit") : real ? word("placeLimitLive") : word("placeLimit")}
                  </button>
                </>
              )}
            </div>
            <details className={styles.disclosure}>
              <summary>{word("limitIfNotFilled")}</summary>
              <div className={styles.disclosureBody}>
                <p>{review.checks.find((c) => c.id === "not_filled")?.detail ?? ""}</p>
                <p>{review.checks.find((c) => c.id === "fill_now")?.detail ?? ""}</p>
                <p className={styles.mono}>
                  {review.id} · {review.timeInForce}
                  {review.book ? ` · ${word("bestAsk")} ${pct(review.book.bestAsk, 1)} · ${review.book.readAt.replace("T", " ").slice(0, 19)} UTC` : ""}
                </p>
                <p>{word("providerNote")}</p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className={styles.figure} data-tone={tone}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
