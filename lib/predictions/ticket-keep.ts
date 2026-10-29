/**
 * The market page's ticket as the page keeps it: the amount the person typed,
 * the plan they chose and the Review open over the ticket. The workspace may
 * take the ticket's panel down and build it again at any moment — a layout
 * changed, the panel put away and brought back, Ryntra folded beside it, the
 * window turned from a desk to a phone — so none of this lives in the panel:
 * the page holds one keep for as long as it is open, the panel and the Review
 * read it, and an answer that arrives while the panel is being rebuilt still
 * opens the Review. The outcome (YES / NO) is the page's own choice, beside it.
 *
 * One quote or order at a time; an order being placed is never closed over,
 * so what the provider reports for it is always shown.
 *
 * Two kinds of ticket share the keep: a market order, priced by the route,
 * and a limit order, priced by the person. They never hold a Review at the
 * same time — changing the kind puts away whatever was open. A limit Review
 * carries the fingerprint of the ticket it was built for, and any change to
 * the ticket marks it stale: a Review is only ever confirmed for the ticket
 * a person was actually looking at.
 *
 * Pure apart from the `send` it is handed (the browser's fetch).
 */

import { LIMIT_PRICE_MAX, LIMIT_PRICE_MIN, limitFromPlan, type LimitLife } from "./limit-model.ts";
import type { LimitReview, PredictionLimitRecord } from "./limit.ts";
import type { PaperReview, PredictionOrderRecord } from "./paper.ts";
import type { PredictionPlan } from "./plan-model.ts";

export type TicketFlow =
  | Readonly<{ stage: "ticket" }>
  | Readonly<{ stage: "quoting" }>
  | Readonly<{ stage: "review"; review: PaperReview; order: PredictionOrderRecord }>
  | Readonly<{ stage: "placing"; review: PaperReview }>
  | Readonly<{ stage: "placed"; order: PredictionOrderRecord }>
  | Readonly<{ stage: "failed"; code: string; message: string; review: PaperReview | null }>
  | Readonly<{ stage: "limitReview"; review: LimitReview; order: PredictionLimitRecord; stale: boolean }>
  | Readonly<{ stage: "limitPlacing"; review: LimitReview }>
  | Readonly<{ stage: "limitPlaced"; order: PredictionLimitRecord }>
  | Readonly<{ stage: "limitFailed"; code: string; message: string; review: LimitReview | null }>;

export type TicketState = Readonly<{
  amount: string;
  /** The person typed an amount or picked a plan: the usual amount no longer fills the field. */
  ownAmount: boolean;
  planId: string | null;
  /** Simulation unless the person chose real money — offered only where live trading is open to them. */
  mode: "paper" | "live";
  /** `market` — at whatever the route fills; `limit` — at the price the person names, and not above it. */
  kind: "market" | "limit";
  /** The limit price as a percentage, as the person types it. */
  price: string;
  /** How long a limit order stands. */
  life: LimitLife;
  flow: TicketFlow;
}>;

/** What a Review is asked for: the outcome bought, the dollars spent, the plan it is under. */
export type QuoteAsk = Readonly<{ eventId: string; venueMarketId: string; outcomeId: string; spendUsd: number; planId: string | null; locale: string; mode?: "paper" | "live" }>;

/** What a limit Review is asked for: the price as a probability, the dollars behind it, how long it stands. */
export type LimitTicketAsk = Readonly<{ eventId: string; venueMarketId: string; outcomeId: string; price: number; amountUsd: number; life: LimitLife; planId: string | null; locale: string; mode?: "paper" | "live" }>;

export type TicketSend = (path: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

export type TicketKeep = Readonly<{
  get: () => TicketState;
  subscribe: (listener: () => void) => () => void;
  /** The usual amount, taken only while the person has not typed their own. */
  offerAmount: (amount: string) => void;
  /** An amount the person typed or picked. */
  typeAmount: (amount: string) => void;
  /** A plan chosen, with the amount it brings; none — no plan. */
  choosePlan: (planId: string | null, amount?: string) => void;
  /** Simulation or real money; any open Review is of the other kind, so it closes. */
  chooseMode: (mode: "paper" | "live") => void;
  /** A market ticket or a limit one; whatever Review was open is put away. */
  chooseKind: (kind: "market" | "limit") => void;
  /** The limit price the person typed, as a percentage. */
  typePrice: (price: string) => void;
  /** How long a limit order stands. */
  chooseLife: (life: LimitLife) => void;
  /**
   * The plan turned into a limit order in one step: the amount it allows, at
   * the highest price it is willing to pay, and the Review of it opened.
   * Nothing is placed — the person confirms that Review, or does not.
   */
  fromPlan: (plan: PredictionPlan, locale: string) => Promise<void>;
  /** The Review of a limit order; nothing is placed by it. */
  reviewLimit: (ask: LimitTicketAsk) => Promise<void>;
  /** The reviewed limit order placed — once per Review, whatever a second press does. */
  placeLimit: (review: LimitReview) => Promise<void>;
  /** A working limit order read again, until the venue reports how it ended. */
  rereadLimit: () => Promise<void>;
  /** The limit order cancelled in one act; whatever has filled stays filled. */
  cancelLimit: () => Promise<void>;
  quote: (ask: QuoteAsk) => Promise<void>;
  /** The last Review asked again, for a fresh price. */
  requote: () => Promise<void>;
  place: (review: PaperReview) => Promise<void>;
  /** A submitted order read again, until the provider reports how it ended. */
  reread: () => Promise<void>;
  /** The part of a submitted order still working, asked to cancel; what the provider says comes back on the order. */
  cancel: () => Promise<void>;
  /** The Review closed; not while an order is being placed. */
  close: () => void;
}>;

type ApiFailure = { error?: { code?: string; message?: string } };

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

/** Limit-order states the venue may still move: a read is worth making, and a cancel is worth offering. */
const LIMIT_LIVE_STATES: ReadonlySet<PredictionLimitRecord["state"]> = new Set(["sending", "accepted", "partially_filled"]);

export function createTicketKeep({ amount, send }: Readonly<{ amount: string; send: TicketSend }>): TicketKeep {
  let state: TicketState = { amount, ownAmount: false, planId: null, mode: "paper", kind: "market", price: "", life: "7d", flow: { stage: "ticket" } };
  const listeners = new Set<() => void>();
  /** Bumped when a Review is closed or asked again: an answer to an earlier ask lands nowhere. */
  let turn = 0;
  let lastAsk: QuoteAsk | null = null;
  let lastLimitAsk: LimitTicketAsk | null = null;
  /** A read of a submitted order on its way: the next waits, so an older answer never lands over a newer one. */
  let reading = false;

  const set = (patch: Partial<TicketState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const busy = () => state.flow.stage === "quoting" || state.flow.stage === "placing" || state.flow.stage === "limitPlacing";
  /** A limit Review belongs to the ticket it was built for: any change to the ticket marks it stale. */
  const staleLimit = () => {
    if (state.flow.stage === "limitReview" && !state.flow.stale) set({ flow: { ...state.flow, stale: true } });
  };

  const quote = async (ask: QuoteAsk) => {
    if (busy()) return;
    lastAsk = ask;
    const mine = ++turn;
    set({ flow: { stage: "quoting" } });
    let flow: TicketFlow;
    try {
      const response = await send("/api/predictions/quote", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ eventId: ask.eventId, venueMarketId: ask.venueMarketId, outcomeId: ask.outcomeId, side: "buy", spendUsd: ask.spendUsd, planId: ask.planId, locale: ask.locale, ...(ask.mode === "live" ? { mode: "live" } : {}) }),
      });
      const body = ((await response.json().catch(() => null)) ?? {}) as { review?: PaperReview; order?: PredictionOrderRecord } & ApiFailure;
      flow =
        response.ok && body.review && body.order
          ? { stage: "review", review: body.review, order: body.order }
          : { stage: "failed", code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? "", review: null };
    } catch {
      flow = { stage: "failed", code: "NETWORK", message: "", review: null };
    }
    if (mine === turn && state.flow.stage === "quoting") set({ flow });
  };

  const reviewLimit = async (ask: LimitTicketAsk) => {
    if (busy()) return;
    lastLimitAsk = ask;
    const mine = ++turn;
    set({ flow: { stage: "quoting" } });
    let flow: TicketFlow;
    try {
      const response = await send("/api/predictions/limit/review", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          eventId: ask.eventId,
          venueMarketId: ask.venueMarketId,
          outcomeId: ask.outcomeId,
          price: ask.price,
          amountUsd: ask.amountUsd,
          life: ask.life,
          planId: ask.planId,
          locale: ask.locale,
          ...(ask.mode === "live" ? { mode: "live" } : {}),
        }),
      });
      const body = ((await response.json().catch(() => null)) ?? {}) as { review?: LimitReview; order?: PredictionLimitRecord } & ApiFailure;
      flow =
        response.ok && body.review && body.order
          ? { stage: "limitReview", review: body.review, order: body.order, stale: false }
          : { stage: "limitFailed", code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? "", review: null };
    } catch {
      flow = { stage: "limitFailed", code: "NETWORK", message: "", review: null };
    }
    if (mine === turn && state.flow.stage === "quoting") set({ flow });
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    offerAmount: (next) => {
      if (!state.ownAmount && state.amount !== next) set({ amount: next });
    },
    typeAmount: (next) => {
      set({ amount: next, ownAmount: true });
      staleLimit();
    },
    choosePlan: (planId, next) => {
      set(next === undefined ? { planId } : { planId, amount: next, ownAmount: true });
      staleLimit();
    },
    chooseMode: (mode) => {
      if (busy() || state.mode === mode) return;
      turn += 1;
      lastAsk = null;
      lastLimitAsk = null;
      set({ mode, flow: { stage: "ticket" } });
    },
    chooseKind: (kind) => {
      if (busy() || state.kind === kind) return;
      turn += 1;
      lastAsk = null;
      lastLimitAsk = null;
      set({ kind, flow: { stage: "ticket" } });
    },
    typePrice: (next) => {
      set({ price: next });
      staleLimit();
    },
    chooseLife: (life) => {
      if (state.life === life) return;
      set({ life });
      staleLimit();
    },
    fromPlan: async (plan, locale) => {
      if (busy()) return;
      const asked = limitFromPlan(plan.current.rules);
      const price = Math.min(LIMIT_PRICE_MAX, Math.max(LIMIT_PRICE_MIN, asked.priceInput));
      turn += 1;
      lastAsk = null;
      lastLimitAsk = null;
      set({
        kind: "limit",
        planId: plan.id,
        amount: String(asked.amountUsd),
        ownAmount: true,
        price: String(Math.round(price * 1000) / 10),
        life: asked.life,
        flow: { stage: "ticket" },
      });
      await reviewLimit({ eventId: asked.eventId, venueMarketId: asked.venueMarketId, outcomeId: asked.outcomeId, price, amountUsd: asked.amountUsd, life: asked.life, planId: plan.id, locale, mode: state.mode });
    },
    reviewLimit,
    placeLimit: async (review) => {
      if (busy()) return;
      set({ flow: { stage: "limitPlacing", review } });
      let flow: TicketFlow;
      try {
        const response = await send("/api/predictions/limit/orders", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: review.id }) });
        const body = ((await response.json().catch(() => null)) ?? {}) as { order?: PredictionLimitRecord } & ApiFailure;
        flow = response.ok && body.order ? { stage: "limitPlaced", order: body.order } : { stage: "limitFailed", code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? "", review };
      } catch {
        flow = { stage: "limitFailed", code: "NETWORK", message: "", review };
      }
      /* Whatever came of it is shown: the order may stand even when the answer says nothing. */
      set({ flow });
    },
    rereadLimit: async () => {
      const flow = state.flow;
      if (reading || flow.stage !== "limitPlaced" || !LIMIT_LIVE_STATES.has(flow.order.state)) return;
      const id = flow.order.id;
      reading = true;
      try {
        const response = await send(`/api/predictions/limit/orders/${encodeURIComponent(id)}`, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const body = ((await response.json().catch(() => null)) ?? {}) as { order?: PredictionLimitRecord };
        const now = state.flow;
        if (response.ok && body.order && now.stage === "limitPlaced" && now.order.id === id) set({ flow: { stage: "limitPlaced", order: body.order } });
      } catch {
        /* Unanswered within ten seconds: the next read tries again. A dropped read never ends an order. */
      } finally {
        reading = false;
      }
    },
    cancelLimit: async () => {
      const flow = state.flow;
      if (reading || flow.stage !== "limitPlaced" || !LIMIT_LIVE_STATES.has(flow.order.state)) return;
      const id = flow.order.id;
      reading = true;
      try {
        const response = await send(`/api/predictions/limit/orders/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { accept: "application/json" } });
        const body = ((await response.json().catch(() => null)) ?? {}) as { order?: PredictionLimitRecord };
        const now = state.flow;
        if (response.ok && body.order && now.stage === "limitPlaced" && now.order.id === id) set({ flow: { stage: "limitPlaced", order: body.order } });
      } catch {
        /* No answer: the order is read again by the usual re-read; a cancel is asked again only by the person. */
      } finally {
        reading = false;
      }
    },
    quote,
    requote: async () => {
      if (state.kind === "limit") {
        if (lastLimitAsk) await reviewLimit(lastLimitAsk);
        return;
      }
      if (lastAsk) await quote(lastAsk);
    },
    place: async (review) => {
      if (busy()) return;
      set({ flow: { stage: "placing", review } });
      let flow: TicketFlow;
      try {
        const response = await send("/api/predictions/orders", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ quoteId: review.quoteId }) });
        const body = ((await response.json().catch(() => null)) ?? {}) as { order?: PredictionOrderRecord } & ApiFailure;
        flow = response.ok && body.order ? { stage: "placed", order: body.order } : { stage: "failed", code: body.error?.code ?? "UNAVAILABLE", message: body.error?.message ?? "", review };
      } catch {
        flow = { stage: "failed", code: "NETWORK", message: "", review };
      }
      // Whatever came of the order is shown: it may exist even when the answer says otherwise.
      set({ flow });
    },
    reread: async () => {
      const flow = state.flow;
      if (reading || flow.stage !== "placed" || flow.order.state !== "submitted") return;
      const quoteId = flow.order.quoteId;
      reading = true;
      try {
        const response = await send(`/api/predictions/orders/${encodeURIComponent(quoteId)}`, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const body = ((await response.json().catch(() => null)) ?? {}) as { order?: PredictionOrderRecord };
        const now = state.flow;
        if (response.ok && body.order && now.stage === "placed" && now.order.quoteId === quoteId && now.order.state === "submitted") set({ flow: { stage: "placed", order: body.order } });
      } catch {
        // Unanswered within ten seconds or failed: the next read tries again.
      } finally {
        reading = false;
      }
    },
    cancel: async () => {
      const flow = state.flow;
      if (reading || flow.stage !== "placed" || flow.order.state !== "submitted") return;
      const quoteId = flow.order.quoteId;
      reading = true;
      try {
        const response = await send(`/api/predictions/orders/${encodeURIComponent(quoteId)}/cancel`, { method: "POST", headers: { accept: "application/json" } });
        const body = ((await response.json().catch(() => null)) ?? {}) as { order?: PredictionOrderRecord };
        const now = state.flow;
        if (response.ok && body.order && now.stage === "placed" && now.order.quoteId === quoteId) set({ flow: { stage: "placed", order: body.order } });
      } catch {
        // No answer: the order is read again by the usual re-read; a cancel is asked again only by the person.
      } finally {
        reading = false;
      }
    },
    close: () => {
      if (state.flow.stage === "placing" || state.flow.stage === "limitPlacing") return;
      turn += 1;
      if (state.flow.stage !== "ticket") set({ flow: { stage: "ticket" } });
    },
  };
}
