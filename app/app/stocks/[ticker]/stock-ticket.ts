/**
 * The company's sheets on the core's ticket: what `useSpotTicket` knows — the live quote, the exact order of a Review,
 * the settlement — said in the ticket's words (`TradeTicket`'s stage, its quote, what was agreed to, the result). The
 * execution stays the sheets' one path: `/quote` → `/order` → the wallet's signature over the reviewed bytes →
 * `/execute` → `/recover`. Nothing here asks, signs or sends; the figures are the server's, said once.
 */

import { ticketModel, ticketSnapshot, type Lang, type Prices, type TicketDraft, type TicketGas, type TicketInput, type TicketMarket, type TicketReference, type TicketResult, type TicketReviewed } from "@ryntra/core/ui";
import type { Amount, AssetId } from "@ryntra/core/adapters";

import type { SpotOrder, SpotQuote, SpotSettlement } from "../../../solana/workspace/spot/use-spot-ticket";
import { classifySpotFill, type SpotFillOutcome } from "../../../../lib/solana/fill-outcome.ts";
import { jupiterFigures, plainRaw, rawAmount, settledReceipt, ticketQuote, uiUnits, type TicketCoin } from "../../../../lib/ticket/solana-ticket.ts";

/** Jupiter executes every sheet's order: the venue as Review's title names it. */
export const STOCK_VENUE = "Jupiter";
export const STOCK_VENUE_ID = "jupiter";
/** How long a live quote holds before the venue is asked again — the quote route's own life. */
const QUOTE_LIFE_MS = 30_000;

/** The parts of `useSpotTicket` the ticket reads. */
export type SpotTicketState = Readonly<{
  phase: "IDLE" | "PREPARING" | "REVIEW" | "SIGNING" | "EXECUTING" | "RECOVERING" | "SETTLED" | "RECOVERY";
  quoted: SpotQuote | null;
  quoting: boolean;
  prepared: SpotOrder | null;
  preparedReadiness: Readonly<{ ready: boolean }> | null;
  bytesChanged: boolean;
  reviewSecondsLeft: number | null;
  settled: SpotSettlement | null;
  attempt: unknown;
}>;

export type StockTicketInput = Readonly<{
  spot: SpotTicketState;
  side: "buy" | "sell";
  market: TicketMarket;
  base: TicketCoin;
  quote: TicketCoin;
  draft: TicketDraft;
  balances: Readonly<Record<AssetId, Amount>> | null;
  prices: Prices;
  reference: TicketReference | null;
  gas: TicketGas;
  /** Why the venue gave no price, as the sheet says it; null — it did or has not been asked. */
  quoteFailed: string | null;
  /** The venue takes no order for this asset now: said on the market type, nothing to press. */
  unavailable: string | null;
  /** Nothing is asked of the venue while the sheet does something else first (the wallet's proof, the plan). */
  holding: boolean;
  /** The sides this sheet offers: its own, and the other where the page has a sheet for it. */
  sides?: readonly ("buy" | "sell")[];
  /**
   * What the person agreed to, as the sheet kept it from its Review: the hook lets the prepared order go before the
   * answer settles, so the result reads the sale or purchase, its figures and its costs from here.
   */
  agreed?: TicketReviewed | null;
  /** When the result happened, as the reader reads the time. */
  time: string;
  lang: Lang;
  /** ms */
  now: number;
}>;

export type StockTicketView = Readonly<{
  stage: "form" | "review" | "result";
  input: TicketInput;
  reviewed: TicketReviewed | undefined;
  result: TicketResult | undefined;
  signing: boolean;
  /** The settlement's kind, when there is one: the sheet adds its own lines under the receipt. */
  outcome: SpotFillOutcome | null;
  /** Review is on screen but its price no longer holds: the sheet offers a fresh one. */
  stale: boolean;
  /** The form's own count, for the sheet's quick checks. */
  model: ReturnType<typeof ticketModel>;
}>;

const working = (phase: SpotTicketState["phase"]) => phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";

/** «Купівля зараз недоступна.» → «купівля зараз недоступна»: a sentence as the clause after the core's dash. */
export function asClause(sentence: string): string {
  const bare = sentence.trim().replace(/[.!]+$/u, "");
  return bare.charAt(0).toLocaleLowerCase() + bare.slice(1);
}

/**
 * The ticket before the venue answers: the market, what was typed, the wallet, the prices — what the sheet sizes its
 * order from. Review is the exact order the sheet asks for on the press, so the live quote only previews it and never
 * holds the action (`exactReview`), as the sheets' «Купити за $10» never waited for one.
 */
export function stockTicketBase(input: Omit<StockTicketInput, "spot" | "quoteFailed" | "holding" | "time" | "lang">): TicketInput {
  return {
    market: input.market,
    draft: input.draft,
    balances: input.balances,
    prices: input.prices,
    reference: input.reference,
    gas: input.gas,
    fees: [],
    maxLegs: 1,
    /* The core says «{type} — {until}.»: the sheet's sentence goes in as its clause — no full stop of its own, no capital after the dash. */
    swap: input.unavailable ? { status: "later", until: asClause(input.unavailable) } : { status: "on" },
    limit: { status: "off" },
    slippageChoices: [],
    sides: input.sides ?? [input.side],
    exactReview: true,
    venue: STOCK_VENUE,
    venueId: STOCK_VENUE_ID,
    now: input.now,
  };
}

/**
 * The ticket's stage, quote and result from the sheet's one execution path. A Review is what the exact order says —
 * the server's figures on the bytes the wallet signs — held as it arrived; a price that no longer holds keeps its
 * figures and waits, grey, for a fresh one.
 */
export function stockTicketView(input: StockTicketInput): StockTicketView {
  const { spot, side, market, base, quote: quoteCoin, lang, now } = input;
  const pay = side === "buy" ? quoteCoin : base;
  const get = side === "buy" ? base : quoteCoin;
  const baseInput = stockTicketBase(input);
  const typed = ticketModel(baseInput, lang);
  /* A sale counts in the shares the wallet shows: the quote is matched to what was typed, not to its chain units. */
  const paidOverride = side === "sell" ? typed.paid : null;
  /* The network's fee is not counted against the wallet a second time: the sheet's SOL reserve (`gas.reserve`) is
     already its ceiling, the one `solShort` the sheets always checked — a quote's own fee on top of it would refuse a
     wallet the sheet lets trade, and keep less than all of a sale of SOL. */
  const figuresOf = (order: SpotQuote["order"], at: number, expiresAt: number) => {
    const figures = jupiterFigures(order, { pay, get }, at, expiresAt);
    const { gas: _gas, ...fees } = figures.fees;
    void _gas;
    return { ...figures, fees };
  };
  const quoteOf = (order: SpotQuote["order"], expiresAt: number) =>
    ticketQuote({
      figures: figuresOf(order, expiresAt - QUOTE_LIFE_MS, expiresAt),
      side,
      market,
      pay,
      get,
      executor: STOCK_VENUE,
      venueId: STOCK_VENUE_ID,
      paid: paidOverride,
    });

  const live = !input.holding && spot.phase !== "PREPARING" && !spot.quoting && spot.quoted ? quoteOf(spot.quoted.order, Date.parse(spot.quoted.expiresAt) || now + QUOTE_LIFE_MS) : null;
  const formInput: TicketInput = { ...baseInput, ...(live ? { quote: live } : {}), ...(input.quoteFailed && !spot.quoting ? { quoteFailed: input.quoteFailed } : {}) };
  const model = ticketModel(formInput, lang);

  /* What was agreed to, as Review drew it: the exact order over a wallet the sheet already checked — the server checks
     the order again — so a Review never dies on the ticket's own count, and the receipt knows a sale from a purchase. */
  const agreed = (order: SpotQuote["order"], expiresAt: number, fresh: boolean): TicketReviewed | undefined => {
    /* A sale's Review says exactly what the bytes sell — the order's own units, in the shares the wallet shows — never the
       sum typed in dollars that stood for them (a whole position typed within half a cent of its value). */
    const sold = side === "sell" && /^\d+$/.test(order.inAmountRaw) ? uiUnits(BigInt(order.inAmountRaw), pay) : null;
    const agreedDraft = sold !== null ? { ...baseInput.draft, unit: "token" as const, amount: plainRaw(sold, pay.decimals) } : baseInput.draft;
    const agreedBase: TicketInput = { ...baseInput, draft: agreedDraft, balances: {} };
    const exact =
      sold !== null
        ? ticketQuote({ figures: figuresOf(order, expiresAt - QUOTE_LIFE_MS, expiresAt), side, market, pay, get, executor: STOCK_VENUE, venueId: STOCK_VENUE_ID, paid: ticketModel(agreedBase, lang).paid })
        : quoteOf(order, expiresAt);
    const agreedInput: TicketInput = { ...agreedBase, ...(exact ? { quote: exact } : {}) };
    const snapshot = ticketSnapshot(ticketModel(agreedInput, lang), agreedInput, lang);
    if (!snapshot) return undefined;
    return !fresh && snapshot.quote ? { ...snapshot, quote: { ...snapshot.quote, expires_at: 0 } } : snapshot;
  };
  const agreedOrder = spot.prepared?.order ?? null;

  /* The settlement, and an order whose answer is still being looked for. */
  const outcome = spot.phase === "SETTLED" && spot.settled ? classifySpotFill(spot.settled) : null;
  if (outcome && spot.settled) {
    const settled = spot.settled;
    const filled = outcome.kind === "FILLED";
    const order = spot.prepared?.order ?? null;
    const kept = input.agreed ?? (order ? (agreed(order, now + 1000, false) ?? null) : null);
    const agreedPaid = kept?.paid ?? null;
    const agreedOut = kept?.expected ?? null;
    const receipt =
      filled && settled.observation && agreedPaid && agreedOut
        ? settledReceipt({
            intentId: settled.signature,
            venueId: STOCK_VENUE_ID,
            marketId: market.id,
            side,
            state: "filled",
            paid: agreedPaid,
            expected: agreedOut,
            atLeast: kept?.atLeast ?? null,
            actualIn: rawAmount(settled.observation.actualInputRaw, pay),
            actualOut: rawAmount(settled.observation.actualOutputRaw, get),
            fees: kept?.fees ?? {},
            signature: settled.signature,
            signer: "",
            executor: STOCK_VENUE,
            at: now,
          })
        : undefined;
    const state: TicketResult["state"] = filled ? "filled" : outcome.kind === "UNPLACED" ? "unknown" : "rejected";
    return {
      stage: "result",
      input: formInput,
      reviewed: kept ? { ...kept, quote: kept.quote ? { ...kept.quote, expires_at: 0 } : null } : undefined,
      result: { state, time: input.time, tx: settled.signature, ...(receipt ? { receipt } : {}) },
      signing: false,
      outcome,
      stale: false,
      model,
    };
  }
  if (spot.phase === "RECOVERY" || spot.phase === "RECOVERING" || spot.attempt) {
    const kept = input.agreed ?? (agreedOrder ? (agreed(agreedOrder, now + 1000, false) ?? null) : null);
    return { stage: "result", input: formInput, reviewed: kept ? { ...kept, quote: kept.quote ? { ...kept.quote, expires_at: 0 } : null } : undefined, result: { state: "unknown", time: input.time }, signing: false, outcome: null, stale: false, model };
  }

  /* Review: the exact order's figures, held as they arrived. */
  const inReview = (spot.phase === "REVIEW" || spot.phase === "SIGNING" || spot.phase === "EXECUTING") && spot.prepared !== null;
  if (inReview && spot.prepared) {
    const fresh = spot.preparedReadiness?.ready === true && !spot.bytesChanged;
    const holds = fresh ? now + Math.max(1, spot.reviewSecondsLeft ?? 1) * 1000 : now + 1000;
    const exact = quoteOf(spot.prepared.order, holds);
    const reviewInput: TicketInput = { ...baseInput, ...(exact ? { quote: exact } : {}) };
    /* A price that no longer holds keeps its figures on screen and cannot be signed. */
    const reviewed = agreed(spot.prepared.order, holds, fresh);
    return { stage: "review", input: reviewInput, reviewed, result: undefined, signing: spot.phase === "SIGNING" || spot.phase === "EXECUTING", outcome: null, stale: !fresh, model };
  }

  return { stage: "form", input: formInput, reviewed: undefined, result: undefined, signing: working(spot.phase), outcome: null, stale: false, model };
}
