"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Receipt, Review, formatBps, type BookFeed, type ReviewLine, type ReviewRow } from "@ryntra/core/ui";

import type { FuturesAccount, FuturesMarket, FuturesOrder, FuturesPosition } from "@/lib/phoenix/market-data";
import { liquidationDistancePercent } from "@/lib/phoenix/collateral-model";
import { DEFAULT_PERP_SLIPPAGE_BPS, feeSplitOf, fillsSummary, orderOutcomeOf, priceImpactPercent, STOP_SLIPPAGE_BPS, ticksFromUsd, type OrderOutcome, type OrderReview, type PerpSide } from "@/lib/phoenix/orders-model";
import { mayOpenWallet } from "@/lib/solana/blockhash-life";
import { explorerTxUrl } from "@/lib/solana/explorer";

import type { SolanaConnectionValue } from "../connection";
import { formatAmount, formatTerminalPrice, priceDecimals } from "../spot/spot-format";

import { futuresWord } from "./futures-words";
import { orderFailure, orderWord, type OrderWordKey } from "./order-words";
import { ORDER_FOLLOW_MS, ORDER_SENT_MS, reviewOrder, signableMsOfOrder, signAndRelayOrder, useFollowedOrderRelay, walletSignsV1, type OrderBody, type OrderRelay, type OrderStates } from "./orders-api";
import { shareLots, unitsOf } from "./perp-ticket";
import { CAREFUL_LEVERAGE, clampLeverage, newPerpDraft, type PerpDraft, type PerpOrder } from "./perp-order-model";
import { PerpTicketForm, type TicketGate } from "./perp-ticket-form";
import { useBookSnapshot } from "./perp-book";
import { trackPerps } from "./perps-telemetry";
import { perpsOrderKind } from "@/lib/phoenix/telemetry";
import { BOOK_MAX_AGE_MS } from "./use-futures-data";

import styles from "./futures.module.css";

/** What the panel does: the ticket, or one action on a position or a resting order chosen in the account's tables. */
export type OrderIntent =
  | Readonly<{ kind: "ticket" }>
  | Readonly<{ kind: "position"; position: FuturesPosition }>
  | Readonly<{ kind: "reduce"; position: FuturesPosition }>
  | Readonly<{ kind: "close"; position: FuturesPosition }>
  | Readonly<{ kind: "protect"; position: FuturesPosition }>
  | Readonly<{ kind: "cancel"; order: FuturesOrder }>
  /** Every resting order of one market, in one instruction (`buildCancelAll`). */
  | Readonly<{ kind: "cancelAll"; symbol: string }>
  /** One conditional order of the position — a take profit or a stop loss Phoenix holds — by its own index. */
  | Readonly<{ kind: "cancelConditional"; order: FuturesOrder }>;

/** The prices the person is setting, for the chart: a limit's, a take profit's and a stop loss's. */
export type DraftLevels = Readonly<{ limit: number | null; tp: number | null; sl: number | null }>;

/* A Review, its signature and its receipt belong to the wallet it was built for (`signer`), whatever is connected later. */
type Phase =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "reviewing"; symbol: string }>
  | Readonly<{ kind: "review"; review: OrderReview; body: OrderBody; at: number; signer: string }>
  | Readonly<{ kind: "signing"; review: OrderReview; body: OrderBody; at: number; signer: string }>
  /* The wallet has signed and the bytes are on their way to the relay: the signature is known, the sending is not (spec §10). */
  | Readonly<{ kind: "signed"; review: OrderReview; body: OrderBody; at: number; signer: string; signature: string }>
  | Readonly<{ kind: "done"; review: OrderReview; relay: OrderRelay; at: number; signer: string }>;

type Lang = "en" | "uk";
const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const sol = (lamports: bigint, intl: string) => `${formatAmount(Number(lamports) / 1e9, intl, 6)} SOL`;
/** A size Phoenix states as an exact decimal, the reader's way. */
const sizeText = (decimal: string, intl: string) => formatAmount(Number(decimal), intl, 8);
/** A rate in bps as an exact share of the notional: 3.5 bps is «0,035 %», never rounded to «0,04 %». */
const rateText = (bps: number, lang: Lang) => `${formatAmount(bps / 100, lang === "uk" ? "uk-UA" : "en-US", 4)}${lang === "en" ? "%" : " %"}`;

const LEVERAGE_KEY = "ryntra.perps.leverage.v1";
/**
 * The leverage a market opens with before the person picks one (spec §9): a careful two times, or the market's highest
 * when that is lower. A first order is never greeted by ten.
 */
const DEFAULT_LEVERAGE = CAREFUL_LEVERAGE;

/** The leverage picked per market, kept in this browser. */
function useLeverage(symbol: string, max: number | null): [number, (next: number) => void] {
  const [kept, setKept] = useState<Readonly<Record<string, number>>>({});
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(LEVERAGE_KEY) ?? "{}") as unknown;
      if (stored && typeof stored === "object") setKept(stored as Record<string, number>);
    } catch {
      /* A denied or broken store keeps the default. */
    }
  }, []);
  const leverage = clampLeverage(kept[symbol] ?? DEFAULT_LEVERAGE, max);
  const set = (next: number) => {
    const value = clampLeverage(next, max);
    setKept((current) => {
      const updated = { ...current, [symbol]: value };
      try {
        window.localStorage.setItem(LEVERAGE_KEY, JSON.stringify(updated));
      } catch {
        /* Nothing to keep. */
      }
      return updated;
    });
  };
  return [leverage, set];
}

/**
 * The orders of the Perps terminal (B6b, PERP-2): the perpetual's own ticket — the margin mode and the leverage, market
 * or limit, long or short, the size and its share of what the collateral allows, reduce-only, TP/SL, and the order's
 * liquidation, margin and fees before anything is built — and the actions on what the account holds: cut, close and
 * TP/SL of a position, the cancel of a resting order. Each goes through one Review built by the server — Phoenix's own
 * view of the account after the order — and one signature of the person's wallet, and ends in a receipt with what
 * Phoenix filled.
 */
export function OrderPanel({
  connection,
  states,
  account,
  opened,
  market,
  book: bookFeed,
  lang,
  intent,
  onIntent,
  onLevels,
  onHold,
  pricePick,
  sidePick,
  density,
  orderType = "market",
  onBusy,
  heldUnits,
  positionsValueUsd,
  stale = null,
}: {
  connection: SolanaConnectionValue["connection"];
  /** Phoenix's book of this market as the page polls it: the ticket's fill of a market order. */
  book: BookFeed | null;
  /** What the gate lets this wallet do (`useOrderStates`), read once by the page for the panel and the tables' actions. */
  states: OrderStates;
  account: FuturesAccount | null;
  opened: boolean;
  market: FuturesMarket;
  lang: Lang;
  intent: OrderIntent;
  onIntent: (next: OrderIntent) => void;
  onLevels?: (levels: DraftLevels) => void;
  onHold?: (held: boolean) => void;
  /** A price pressed in the book: the ticket takes it as a limit's price. */
  pricePick?: Readonly<{ price: number; at: number }> | null;
  /** A side pressed outside the ticket (a phone's Long or Short, PERP-6): the ticket opens on it. */
  sidePick?: Readonly<{ side: "long" | "short"; at: number }> | null;
  /** The core's density the ticket is drawn at (PERP-6): Simple's regular, Pro's compact. */
  density?: "regular" | "compact";
  /** The order type a new ticket starts with (the terminal's settings, PERP-6). */
  orderType?: "market" | "limit";
  /** Whether an order is under way — a Review, a signature, a receipt: a phone leads back to it. */
  onBusy?: (busy: boolean) => void;
  /** The position held on this market (subaccount 0), signed. */
  heldUnits: number;
  /** Every position's value at its mark. */
  positionsValueUsd: number;
  /** The market's data stopped updating (PERP-4): new risk waits, a cut and a close go on. */
  stale?: Readonly<{ updatedAt: number | null }> | null;
}) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: OrderWordKey, fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill);
  const owner = connection?.address ?? null;
  const units = unitsOf(market);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [failure, setFailure] = useState<string | null>(null);
  const attempt = useRef(0);
  const signingNow = useRef(false);
  const ownerNow = useRef(owner);
  const held = phase.kind === "signing" || phase.kind === "signed" || phase.kind === "done";
  useEffect(() => {
    onHold?.(held);
  }, [held, onHold]);
  useEffect(() => {
    onBusy?.(phase.kind !== "edit");
  }, [phase.kind, onBusy]);
  useEffect(() => {
    ownerNow.current = owner;
    if (signingNow.current) return;
    attempt.current += 1;
    setPhase((current) => (current.kind === "done" ? current : { kind: "edit" }));
    setFailure(null);
  }, [owner]);

  /* The ticket's draft, per market: another market starts from an empty one, and a Review not yet signed is dropped with it. */
  const [draft, setDraft] = useState<PerpDraft>(() => ({ ...newPerpDraft(DEFAULT_PERP_SLIPPAGE_BPS), type: orderType }));
  const [leverage, setLeverage] = useLeverage(market.symbol, market.maxLeverage);
  useEffect(() => {
    setDraft((current) => ({ ...newPerpDraft(current.slippageBps, current.unit), side: current.side, type: current.type }));
    if (signingNow.current) return;
    /* A Review asked for this very market (a table's row chose it) stays; another market's is dropped, unsigned. */
    setPhase((current) => {
      const own = current.kind === "review" ? current.review.symbol : current.kind === "reviewing" ? current.symbol : null;
      if (own === null || own.toLowerCase() === market.symbol.toLowerCase()) return current;
      attempt.current += 1;
      return { kind: "edit" };
    });
  }, [market.symbol]);

  /* A price pressed in the book becomes the limit's price — while the ticket is being typed, never under a Review, a
     signature or a position's own form. */
  const phaseNow = useRef(phase.kind);
  phaseNow.current = phase.kind;
  useEffect(() => {
    if (!pricePick || phaseNow.current !== "edit" || intent.kind !== "ticket") return;
    const digits = priceDecimals(market.markPrice);
    setDraft((current) => ({ ...current, type: "limit", price: pricePick.price.toFixed(digits), percent: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricePick]);
  /* A side pressed outside the ticket is the ticket's side — while it is being typed, as a price from the book is. */
  useEffect(() => {
    if (!sidePick || phaseNow.current !== "edit" || intent.kind !== "ticket") return;
    setDraft((current) => (current.side === sidePick.side ? current : { ...current, side: sidePick.side, reduceOnly: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidePick]);

  /* The chart draws what is being set: a limit's price and the legs. */
  const typed = (text: string) => {
    const value = Number(text.replace(",", "."));
    return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
  };
  const limitLevel = draft.type === "limit" ? typed(draft.price) : null;
  /* A TP/SL may be typed as a price, a share of the margin or dollars: the ticket resolves it to the price the order
     will carry, and that — never the figure typed — is what the chart draws (PERP-5). */
  const [legLevels, setLegLevels] = useState<Readonly<{ tp: number | null; sl: number | null }>>({ tp: null, sl: null });
  const onLegs = useCallback((legs: Readonly<{ tp: number | null; sl: number | null }>) => setLegLevels((current) => (current.tp === legs.tp && current.sl === legs.sl ? current : legs)), []);
  /* The ticket leaves the screen under a Review, a signature or a receipt: its draft lines leave the chart with it. */
  useEffect(() => {
    if (phase.kind !== "edit") setLegLevels((current) => (current.tp === null && current.sl === null ? current : { tp: null, sl: null }));
  }, [phase.kind]);
  useEffect(() => {
    const own = intent.kind === "ticket";
    onLevels?.({ limit: own ? limitLevel : null, tp: own ? legLevels.tp : null, sl: own ? legLevels.sl : null });
  }, [onLevels, intent.kind, limitLevel, legLevels]);

  const { book, ageMs: bookAge } = useBookSnapshot(bookFeed);
  const format = connection && walletSignsV1(connection.wallet) ? { format: "v1" as const } : {};
  /* Why the ticket's action cannot be pressed now, in the order the person meets it. */
  const gate: TicketGate = owner === null ? "connect" : !states.open ? "closed" : market.status === "gated" ? "gated" : market.isolatedOnly ? "isolated" : !opened ? "noAccount" : null;

  /* The draft a standing Review was built from: any change to the ticket makes it stale (spec §9). */
  const reviewedDraft = useRef<PerpDraft | null>(null);
  useEffect(() => {
    if (phase.kind !== "review" || intent.kind !== "ticket") return;
    if (reviewedDraft.current === null || reviewedDraft.current === draft) return;
    reviewedDraft.current = null;
    attempt.current += 1;
    setPhase({ kind: "edit" });
    setFailure(w("reviewStale"));
    // The words and the intent do not re-run this: a changed draft does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, phase.kind]);

  async function review(body: OrderBody, again?: boolean) {
    if (!owner) return;
    reviewedDraft.current = draft;
    setFailure(null);
    setPhase({ kind: "reviewing", symbol: body.symbol });
    const mine = ++attempt.current;
    const answer = await reviewOrder(body);
    if (mine !== attempt.current) return;
    if (!answer.ok) {
      setFailure(orderFailure(lang, answer.code));
      setPhase({ kind: "edit" });
      return;
    }
    setPhase({ kind: "review", review: answer.value, body, at: Date.now(), signer: owner });
    trackPerps(again ? "review_invalidated" : "order_review_opened", body.symbol, again ? "aged" : perpsOrderKind(body.kind), lang);
    if (again) setFailure(w("reviewRefreshed"));
  }

  async function sign(shown: Extract<Phase, { kind: "review" }>) {
    if (!connection || connection.address !== shown.signer) {
      setFailure(orderFailure(lang, "WALLET_MISMATCH"));
      setPhase({ kind: "edit" });
      return;
    }
    /* The bytes live ~30 s: a Review signed later than its window is built again and read anew. */
    if (!mayOpenWallet({ receivedAtMs: shown.at, signableMs: signableMsOfOrder(shown.review) })) {
      await review(shown.body, true);
      return;
    }
    setFailure(null);
    setPhase({ ...shown, kind: "signing" });
    const mine = ++attempt.current;
    signingNow.current = true;
    /* The signature is known the moment the wallet signs: the screen shows that step while the relay sends and waits. */
    const onSigned = (signature: string) => {
      if (mine !== attempt.current) return;
      trackPerps("transaction_signed", shown.review.symbol, perpsOrderKind(shown.review.kind), lang);
      setPhase({ ...shown, kind: "signed", signature, at: Date.now() });
    };
    const relayed = await signAndRelayOrder({ wallet: connection.wallet, address: connection.address }, shown.review, shown.at, onSigned)
      .catch(() => ({ ok: false as const, code: "WALLET_REFUSED" }))
      .finally(() => {
        signingNow.current = false;
      });
    if (mine !== attempt.current) return;
    if (relayed.ok) {
      setDraft((current) => ({ ...current, size: "", percent: null, tp: "", sl: "", tpsl: false }));
      setPhase({ kind: "done", review: shown.review, relay: relayed.value, at: Date.now(), signer: shown.signer });
      return;
    }
    if (ownerNow.current !== shown.signer) {
      setFailure(orderFailure(lang, relayed.code));
      setPhase({ kind: "edit" });
      return;
    }
    if (relayed.code === "REVIEW_AGED" || relayed.code === "TICKET_EXPIRED") {
      await review(shown.body, true);
      return;
    }
    setFailure(orderFailure(lang, relayed.code));
    setPhase(relayed.code === "WALLET_REFUSED" ? shown : { kind: "edit" });
  }

  /* A close and a cancel go straight to their Review: there is nothing to set. */
  const started = useRef<OrderIntent | null>(null);
  useEffect(() => {
    if (started.current === intent || !owner || phase.kind !== "edit") return;
    started.current = intent;
    if (intent.kind === "close") void review({ kind: "reduce", owner, symbol: intent.position.symbol, size: "1", close: true, ...format });
    if (intent.kind === "cancel" && intent.order.sequence) void review({ kind: "cancel", owner, symbol: intent.order.symbol, order: intent.order.sequence, ...format });
    if (intent.kind === "cancelAll") void review({ kind: "cancelAll", owner, symbol: intent.symbol, ...format });
    if (intent.kind === "cancelConditional" && intent.order.conditional != null) void review({ kind: "cancelConditional", owner, symbol: intent.order.symbol, index: intent.order.conditional, ...format });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, owner]);

  const backToTicket = () => {
    attempt.current += 1;
    setFailure(null);
    setPhase({ kind: "edit" });
    onIntent({ kind: "ticket" });
  };

  if (phase.kind === "done") {
    return (
      <OrderReceipt
        relay={phase.relay}
        review={phase.review}
        at={phase.at}
        owner={phase.signer}
        lang={lang}
        onAgain={() => {
          setPhase({ kind: "edit" });
          onIntent({ kind: "ticket" });
        }}
      />
    );
  }
  if (phase.kind === "signed") {
    return (
      <div className={styles.orderPanel} data-futures-order="signed">
        <OrderSigned signature={phase.signature} at={phase.at} lang={lang} />
        {failure ? <p className={styles.alert} role="alert">{failure}</p> : null}
      </div>
    );
  }
  if (phase.kind === "review" || phase.kind === "signing") {
    const straight = intent.kind === "close" || intent.kind === "cancel" || intent.kind === "cancelAll" || intent.kind === "cancelConditional";
    return (
      <div className={styles.orderPanel} data-futures-order="review">
        <OrderReviewView
          review={phase.review}
          signer={phase.signer}
          signing={phase.kind === "signing"}
          lang={lang}
          onCancel={phase.kind === "signing" ? undefined : () => (straight ? backToTicket() : setPhase({ kind: "edit" }))}
          onConfirm={phase.kind === "review" ? () => void sign(phase) : undefined}
        />
        {failure ? <p className={styles.alert} role="alert">{failure}</p> : null}
      </div>
    );
  }

  const busy = phase.kind === "reviewing";
  if (intent.kind === "position") {
    const position = intent.position;
    return (
      <div className={styles.orderPanel} data-futures-order="position">
        <h3 className={styles.subhead}>{`${capital(sideName(position.side, lang))} ${position.size === null ? "" : formatAmount(position.size, intl)} ${position.symbol}-PERP`}</h3>
        <div className={styles.positionActions}>
          <Button variant="secondary" lang={lang} disabled={!states.open} onClick={() => onIntent({ kind: "protect", position })} data-futures-act="protect">
            {w("tpsl")}
          </Button>
          <Button variant="secondary" lang={lang} disabled={!states.open} onClick={() => onIntent({ kind: "reduce", position })} data-futures-act="reduce">
            {w("reduce")}
          </Button>
          <Button variant="secondary" lang={lang} disabled={!states.open} onClick={() => onIntent({ kind: "close", position })} data-futures-act="close">
            {w("close")}
          </Button>
        </div>
        <Button variant="ghost" lang={lang} onClick={backToTicket}>
          {w("back")}
        </Button>
      </div>
    );
  }
  if (intent.kind !== "ticket") {
    return (
      <div className={styles.orderPanel} data-futures-order={intent.kind}>
        {intent.kind === "reduce" || intent.kind === "protect" ? (
          <PositionForm intent={intent} market={market} lang={lang} busy={busy} disabled={!states.open} onReview={(body) => owner && void review({ ...body, owner, ...format } as OrderBody)} />
        ) : busy ? (
          <p className={styles.muted} aria-busy="true">{w("preparing")}</p>
        ) : null}
        {failure ? <p className={styles.alert} role="alert">{failure}</p> : null}
        <Button variant="secondary" lang={lang} disabled={busy} onClick={backToTicket}>
          {w("back")}
        </Button>
      </div>
    );
  }

  if (!units) return <p className={styles.muted}>{w("gatedNote")}</p>;
  const toBody = (order: PerpOrder): OrderBody | null => {
    if (!owner) return null;
    if (order.kind === "reduce") return { kind: "reduce", owner, symbol: market.symbol, size: order.size, slippageBps: order.slippageBps, ...format };
    if (order.type === "limit") return { kind: "open", owner, symbol: market.symbol, side: order.side, type: "limit", tif: order.tif, size: order.size, price: order.price, ...format };
    return { kind: "open", owner, symbol: market.symbol, side: order.side, type: "market", tif: order.tif, size: order.size, slippageBps: order.slippageBps, tp: order.tp, sl: order.sl, ...format };
  };
  return (
    <div className={styles.orderPanel} data-futures-order="ticket" data-futures-orders={states.open ? "open" : "closed"}>
      <PerpTicketForm
        market={market}
        units={units}
        draft={draft}
        onDraft={busy ? () => undefined : setDraft}
        leverage={leverage}
        onLeverage={setLeverage}
        account={account}
        wallet={owner}
        opened={opened}
        stale={stale}
        maxNotionalUsd={states.maxNotionalUsd}
        builder={states.builder}
        builderBps={states.builderBps ?? null}
        book={book}
        bookFresh={bookAge !== null && bookAge <= BOOK_MAX_AGE_MS}
        heldUnits={heldUnits}
        positionsValueUsd={positionsValueUsd}
        gate={gate}
        busy={busy}
        lang={lang}
        density={density}
        onLegs={onLegs}
        onReview={(order) => {
          const body = toBody(order);
          if (body) void review(body);
        }}
      />
      {failure ? <p className={styles.alert} role="alert">{failure}</p> : null}
    </div>
  );
}

/** Cut a position by a share of it, or set its TP/SL — each to a Review. */
function PositionForm({ intent, market, lang, busy, disabled, onReview }: { intent: Extract<OrderIntent, { kind: "reduce" | "protect" }>; market: FuturesMarket; lang: Lang; busy: boolean; disabled: boolean; onReview: (body: Readonly<Record<string, unknown>>) => void }) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: OrderWordKey, fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill);
  const position = intent.position;
  const units = unitsOf(market);
  const [percent, setPercent] = useState(50);
  const decimals = priceDecimals(market.markPrice);
  const plain = (value: number | null | undefined) => (value == null ? "" : value.toFixed(decimals));
  const [tp, setTp] = useState(plain(position.tpPrice));
  const [sl, setSl] = useState(plain(position.slPrice));
  const sideWord = sideName(position.side, lang);
  if (!units) return null;
  if (intent.kind === "reduce") {
    const lots = position.size === null ? null : shareLots(position.size, percent, units);
    return (
      <div className={styles.positionForm}>
        <h3 className={styles.subhead}>{w("reduceTitle", { side: sideWord, coin: market.symbol })}</h3>
        <p className={styles.muted}>{w("reduceShare", { size: formatAmount(position.size, intl), coin: market.symbol })}</p>
        <div className={styles.segment} role="group" aria-label={w("reduce")}>
          {[25, 50, 75].map((value) => (
            <button key={value} type="button" aria-pressed={percent === value} disabled={busy} onClick={() => setPercent(value)}>
              {`${value}${lang === "en" ? "%" : " %"}`}
            </button>
          ))}
        </div>
        <Button variant="primary" block lang={lang} loading={busy} disabled={busy || disabled || lots === null} onClick={() => lots !== null && onReview({ kind: "reduce", symbol: position.symbol, size: lots.toString() })}>
          {busy ? w("preparing") : w("reduce")}
        </Button>
      </div>
    );
  }
  const ticks = (text: string, rounding: "floor" | "ceil") => (text.trim() === "" ? null : ticksFromUsd(text, units, rounding));
  /* Rounded toward the side each guards: a long's TP down and SL up, a short's the other way — never past what was typed by more than a tick. */
  const long = position.side === "long";
  const tpTicks = ticks(tp, long ? "floor" : "ceil");
  const slTicks = ticks(sl, long ? "ceil" : "floor");
  const invalid = (tp.trim() !== "" && tpTicks === null) || (sl.trim() !== "" && slTicks === null);
  return (
    <div className={styles.positionForm}>
      <h3 className={styles.subhead}>{w("protectTitle", { side: sideWord, coin: market.symbol })}</h3>
      <label className={styles.amount}>
        <span>{w("tpField")}</span>
        <input inputMode="decimal" autoComplete="off" placeholder="—" value={tp} disabled={busy} onChange={(event) => setTp(event.target.value)} aria-invalid={tp.trim() !== "" && tpTicks === null ? true : undefined} data-futures-tp />
      </label>
      <label className={styles.amount}>
        <span>{w("slField")}</span>
        <input inputMode="decimal" autoComplete="off" placeholder="—" value={sl} disabled={busy} onChange={(event) => setSl(event.target.value)} aria-invalid={sl.trim() !== "" && slTicks === null ? true : undefined} data-futures-sl />
      </label>
      <p className={styles.muted}>{w("protectNote")}</p>
      <p className={styles.muted}>{w("stopSlip", { x: formatBps(STOP_SLIPPAGE_BPS, lang) })}</p>
      <Button variant="primary" block lang={lang} loading={busy} disabled={busy || disabled || invalid} onClick={() => onReview({ kind: "protect", symbol: position.symbol, tp: tpTicks === null ? null : tpTicks.toString(), sl: slTicks === null ? null : slTicks.toString() })}>
        {busy ? w("preparing") : w("tpsl")}
      </Button>
    </div>
  );
}

const sideName = (side: PerpSide, lang: Lang) => (lang === "uk" ? (side === "long" ? "лонг" : "шорт") : side);

/** The Review of an order, from the server's answer alone: what was built and simulated is what is shown. */
function OrderReviewView({ review, signer, signing, lang, onCancel, onConfirm }: { review: OrderReview; signer: string; signing: boolean; lang: Lang; onCancel?: (() => void) | undefined; onConfirm?: (() => void) | undefined }) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: OrderWordKey, fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill);
  const coin = review.symbol;
  const side = sideName(review.side, lang);
  const decimals = priceDecimals(review.markUsd);
  const price = (value: number | null) => formatTerminalPrice(value, intl, decimals);
  const usd = (value: number | null) => (value === null ? "—" : new Intl.NumberFormat(intl, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value));
  const size = sizeText(review.sizeUnits, intl);
  const after = review.after;
  const close = review.kind === "reduce" && after !== null && Number(after.positionUnits) === 0;
  const title =
    review.kind === "open"
      ? w("title.open", { side: capital(side), size, coin, type: w(review.type === "limit" ? "limit" : "market") })
      : review.kind === "reduce"
        ? close
          ? w("title.close", { side, size, coin })
          : w("title.reduce", { side, size, coin })
        : review.kind === "protect"
          ? w("title.protect", { side: capital(side), coin })
          : review.kind === "cancelAll"
            ? w("title.cancelAll", { n: String(review.cancelAll?.count ?? 0), coin })
            : review.kind === "cancelConditional"
              ? w(legsWord(review, "title"), { coin })
              : w("title.cancel", { coin });
  const marginUsed = after?.initialMarginUsd != null && review.before?.initialMarginUsd != null ? after.initialMarginUsd - review.before.initialMarginUsd : null;
  const pay =
    review.kind === "open"
      ? w("pay.margin", { x: usd(marginUsed !== null && marginUsed > 0 ? marginUsed : null) })
      : review.kind === "reduce"
        ? w("pay.position", { side: capital(side), size, coin })
        : w("pay.none");
  const get =
    review.kind === "open"
      ? w("get.position", { side: capital(side), size, coin, x: usd(review.notionalUsd) })
      : review.kind === "reduce"
        ? w("get.collateral", { x: usd(after?.collateralChangeUsd ?? null) })
        : review.kind === "protect"
          ? review.tpUsd === null && review.slUsd === null
            ? w("get.lift")
            : w("get.legs")
          : review.kind === "cancelAll"
            ? w("get.cancelAll", { n: String(review.cancelAll?.count ?? 0) })
            : review.kind === "cancelConditional"
              ? w(bothLegs(review) ? "get.cancelLegs" : "get.cancelLeg")
              : w("get.cancel");

  /*
   * The fields of contract 1.77.0 are read as absent-or-null: a Review from a server that has not been released yet,
   * or served from the edge before it was, must not take the panel down with it.
   */
  const impact = review.impact ?? null;
  const tif = review.tif ?? null;
  const rows: ReviewRow[] = [];
  if (review.kind === "open" || review.kind === "reduce") {
    rows.push({ label: w("row.type"), value: w(review.type === "limit" ? "limit" : "market") });
    if (tif) rows.push({ label: w("row.tif"), value: `${w(`tif.${tif}` as OrderWordKey)} · ${w(`tifNote.${tif}` as OrderWordKey)}` });
    rows.push({ label: w(review.type === "limit" ? "row.limit" : "row.worst"), value: `${price(review.priceUsd)} USD` });
    if (review.slippageBps !== null) rows.push({ label: w("row.slippage"), value: formatBps(review.slippageBps, lang) });
    /*
     * The price impact of the size, from Phoenix's own book as the server read it: an estimate, and said as one. Where
     * there is no figure the row says which of four things happened, never one word for all of them — a limit that may
     * cross is not an order that takes no liquidity, and a book that answered «not this size» is not a silent one.
     */
    rows.push({
      label: w("row.impact"),
      value: impact
        ? w("row.impactValue", { price: price(impact.averageUsd), best: price(impact.bestUsd), pct: `${formatAmount(impact.percent, intl, 3)}${lang === "en" ? "%" : " %"}` })
        : w(`row.impact.${review.book ?? (review.type === "limit" ? "unsure" : "quiet")}` as OrderWordKey),
      ...(impact && impact.percent >= 1 ? { tone: "down" as const } : {}),
    });
  }
  if (review.kind === "cancelAll" && review.cancelAll) {
    const size = review.cancelAll.sizeUnits;
    rows.push({ label: w("row.orders"), value: size == null ? String(review.cancelAll.count) : `${review.cancelAll.count} · ${sizeText(size, intl)} ${coin}` });
  }
  if (review.kind === "cancelConditional" && review.conditional) {
    /* Each trigger the one conditional order holds: Phoenix's cancel takes it whole, so both are shown. */
    if (review.conditional.tpUsd != null) rows.push({ label: w("row.tp"), value: `${price(review.conditional.tpUsd)} USD` });
    if (review.conditional.slUsd != null) rows.push({ label: w("row.sl"), value: `${price(review.conditional.slUsd)} USD` });
  }
  if (review.kind === "cancel" && review.order) rows.push({ label: w("row.order"), value: `${capital(sideName(review.order.side === "buy" ? "long" : "short", lang))} ${review.order.sizeUnits === null ? "—" : sizeText(review.order.sizeUnits, intl)} ${coin} · ${price(review.order.priceUsd)}` });
  rows.push({ label: w("row.mark"), value: `${price(review.markUsd)} USD` });
  if (after) {
    rows.push({ label: w("row.positionAfter"), value: `${sizeText(after.positionUnits, intl)} ${coin}` });
    const leverage = after.leverage;
    rows.push({ label: w("row.leverageAfter"), value: leverage === null ? "—" : `${formatAmount(leverage, intl, 2)}×`, ...(leverage !== null && leverage >= 5 ? { tone: "down" as const } : {}) });
    const flat = Number(after.positionUnits) === 0;
    const away = after.liquidationUsd !== null && review.markUsd !== null ? liquidationDistancePercent(Number(after.positionUnits) >= 0 ? "long" : "short", review.markUsd, after.liquidationUsd) : null;
    rows.push({
      label: w("row.liquidation"),
      value: flat
        ? w("row.noLiquidation")
        : after.liquidationUsd === null
          ? w("row.liquidationNotFound")
          : `${review.before?.liquidationUsd != null ? `${price(review.before.liquidationUsd)} → ` : ""}${price(after.liquidationUsd)}${away === null ? "" : ` · ${w("row.liquidationAway", { x: `${formatAmount(away, intl, 1)}${lang === "en" ? "%" : " %"}` })}`}`,
      ...(away !== null && away < 10 ? { tone: "down" as const } : {}),
    });
    rows.push({ label: w("row.collateralAfter"), value: `${usd(after.collateralUsd)} USDC` });
    rows.push({ label: w("row.freeAfter"), value: `${usd(after.freeCollateralUsd)} USDC` });
  }
  if (review.funding) {
    const rate = `${review.funding.ratePercent >= 0 ? "+" : "−"}${formatAmount(Math.abs(review.funding.ratePercent), intl, 4)}${lang === "en" ? "%" : " %"}`;
    rows.push({ label: w("row.funding"), value: review.funding.payer === "long" ? w("row.fundingLongs", { x: rate }) : review.funding.payer === "short" ? w("row.fundingShorts", { x: rate }) : rate });
  }
  if (review.tpUsd !== null) rows.push({ label: w("row.tp"), value: `${price(review.tpUsd)} USD` });
  if (review.slUsd !== null) rows.push({ label: w("row.sl"), value: `${price(review.slUsd)} USD · ${w("stopSlip", { x: formatBps(STOP_SLIPPAGE_BPS, lang) })}` });
  if (review.clearsLegs) rows.push({ label: w("row.legsLifted"), value: w("legsLiftedValue") });

  const networkLamports = BigInt(review.networkFeeLamports);
  const rentLamports = BigInt(review.rentLamports);
  /*
   * `venueLiquidity` came with contract 1.77.0: a Review built before it is read as what it was — a plain limit's parts
   * are not known before it fills (`mixed`), everything else takes liquidity now.
   */
  const fees = { ...review.fees, venueLiquidity: review.fees.venueLiquidity ?? (review.kind === "open" && review.type === "limit" ? ("mixed" as const) : ("taker" as const)) };
  const takerBps = fees.takerRate === null ? null : rateText(fees.takerRate * 10_000, lang);
  const makerBps = fees.makerRate === null ? null : rateText(fees.makerRate * 10_000, lang);
  const phoenixCost =
    fees.venueLiquidity === "mixed"
      ? w("cost.limit", { maker: makerBps ?? "—", taker: takerBps ?? "—" })
      : fees.venueLiquidity === "maker"
        ? w("cost.whenFilled", { x: usd(fees.venueUsd), bps: makerBps ?? "—" })
        : fees.venueUsd !== null && fees.venueUsd > 0
          ? w("cost.taker", { x: usd(fees.venueUsd), bps: takerBps ?? "—" })
          : w("cost.none");
  const ryntraCost =
    fees.builderBps > 0 && fees.venueLiquidity === "maker"
      ? w("cost.makerOnly")
      : fees.builderBps > 0 && fees.builderUsd === null
        ? w("cost.builderLimit", { bps: rateText(fees.builderBps, lang) })
        : fees.builderBps > 0 && fees.builderUsd !== null && fees.builderUsd > 0
          ? w("cost.taker", { x: usd(fees.builderUsd), bps: rateText(fees.builderBps, lang) })
          : w("cost.none");
  const costs: ReviewLine[] = [
    { label: w("cost.phoenix"), value: phoenixCost },
    { label: w("cost.ryntra"), value: ryntraCost },
    { label: w("cost.network"), value: sol(networkLamports, intl) },
    ...(rentLamports > 0n ? [{ label: w("cost.rent"), value: sol(rentLamports, intl) }] : []),
  ];
  /* An order that is not filling now pays nothing yet: its total is the network's alone, its rates stand on their lines. */
  const usdcCosts = fees.venueLiquidity === "taker" ? (fees.venueUsd ?? 0) + (fees.builderUsd ?? 0) : 0;
  const costsTotal = usdcCosts > 0 ? w("costsTotal", { x: usd(usdcCosts), sol: sol(networkLamports + rentLamports, intl) }) : w("costsTotalSol", { sol: sol(networkLamports + rentLamports, intl) });
  const whatPrice = `${price(review.priceUsd)} USD`;
  const whatItIs =
    review.kind === "open"
      ? tif === "post_only"
        ? w("what.open.postOnly", { price: whatPrice })
        : tif === "ioc"
          ? w("what.open.ioc", { price: whatPrice })
          : w(review.type === "limit" ? "what.open.limit" : "what.open.market", { price: whatPrice })
      : review.kind === "reduce"
        ? w(close ? "what.close" : "what.reduce", { price: whatPrice })
        : review.kind === "protect"
          ? w("what.protect")
          : review.kind === "cancelAll"
            ? w("what.cancelAll")
            : review.kind === "cancelConditional"
              ? w("what.cancelLeg")
              : w("what.cancel");
  return (
    <Review
      lang={lang}
      titleAs="h3"
      title={title}
      pay={pay}
      get={get}
      costs={costs}
      costsTotal={costsTotal}
      rows={rows}
      whatItIs={whatItIs}
      risk={w("risk")}
      signer={short(signer)}
      signing={signing}
      {...(onCancel ? { onCancel } : {})}
      {...(onConfirm ? { onConfirm } : {})}
      data-futures-review={review.kind}
      details={
        <dl className={styles.details}>
          <div><dt>{futuresWord(lang, "traderAccount")}</dt><dd translate="no">{review.traderAccount}</dd></div>
          <div><dt>{futuresWord(lang, "program")}</dt><dd translate="no">EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih</dd></div>
          <div><dt>{futuresWord(lang, "transactions")}</dt><dd>1</dd></div>
        </dl>
      }
    />
  );
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Whether the conditional order this cancel lifts holds both a take profit and a stop loss. */
const bothLegs = (review: OrderReview): boolean => (review.conditional?.legs?.length ?? 0) > 1;

/**
 * The word for what a single conditional cancel lifts. Ryntra places a take profit and a stop loss as one conditional
 * order, and Phoenix's cancel takes that order whole — so when both are on it, the words say both go.
 */
function legsWord(review: OrderReview, group: "title" | "receipt"): OrderWordKey {
  if (bothLegs(review)) return `${group}.cancelLegs` as OrderWordKey;
  return `${group}.${review.conditional?.legs?.[0] === "sl" ? "cancelSl" : "cancelTp"}` as OrderWordKey;
}

/**
 * The step between the signature and the chain (spec §10, step 3): the wallet has signed and the bytes are on their way
 * to the relay, which sends them once and waits up to forty seconds for the landing. The signature is known — but it is
 * not yet a transaction anyone can look up: the relay may refuse before sending, and then nothing was sent at all. So
 * this step says what is true (signed, going out), shows the signature without an explorer link, and claims nothing
 * about Solana having it — let alone that a position is open.
 */
function OrderSigned({ signature, at, lang }: { signature: string; at: number; lang: Lang }) {
  const w = (key: OrderWordKey, fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill);
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((ORDER_SENT_MS - (Date.now() - at)) / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil((ORDER_SENT_MS - (Date.now() - at)) / 1000))), 1_000);
    return () => clearInterval(timer);
  }, [at]);
  return (
    <section className={styles.sent} data-futures-signed aria-busy="true">
      <h3 className={styles.subhead}>{w("sent.title")}</h3>
      <p className={styles.muted} role="status">{left > 0 ? w("sent.waiting", { s: String(left) }) : w("sent.waitingOn")}</p>
      <dl className={styles.details}>
        <div>
          <dt>{w("sent.signature")}</dt>
          <dd translate="no">{short(signature)}</dd>
        </div>
      </dl>
      <p className={styles.muted}>{w("sent.note")}</p>
    </section>
  );
}

/** The word of the outcome, for the receipt's title. */
function outcomeTitle(outcome: OrderOutcome, review: OrderReview, closed: boolean, lang: Lang): string {
  const w = (key: OrderWordKey, fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill);
  if (outcome === "pending") return w("receipt.pending");
  if (outcome === "failed") return w("receipt.failed");
  if (review.kind === "protect") return w(review.tpUsd === null && review.slUsd === null ? "receipt.lift" : "receipt.protect");
  if (review.kind === "cancelAll") return w("receipt.cancelAll", { n: String(review.cancelAll?.count ?? 0) });
  if (review.kind === "cancelConditional") return w(legsWord(review, "receipt"));
  if (review.kind === "cancel") return w("receipt.cancel");
  if (outcome === "accepted") return w("receipt.accepted");
  if (outcome === "cancelled") return w("receipt.cancelledUnfilled");
  if (outcome === "partial") return w("receipt.partial");
  if (review.kind === "reduce") return w(closed ? "receipt.closed" : "receipt.reduced");
  return w("receipt.filled");
}

/**
 * The receipt: what Phoenix actually filled once the transaction landed — the size, the average price, the fees told
 * apart and the result — waiting while the chain has not said, failed otherwise (spec §10, step 5). Every figure comes
 * from Phoenix's record of this signature; the Review's own numbers never stand in for a fill.
 */
function OrderReceipt({ relay: answered, review, at, owner, lang, onAgain }: { relay: OrderRelay; review: OrderReview; at: number; owner: string; lang: Lang; onAgain: () => void }) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: OrderWordKey, fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill);
  /*
   * Phoenix's record of the fills is followed for every order that can fill — a limit that crossed filled too, and
   * saying it «rests» would be a firmer claim than the chain's. A Review built before 1.77.0 carries no `tif`: a limit
   * is read as resting by its type, a market order as all-or-nothing, which is what each was.
   */
  const trades = review.kind === "reduce" || review.kind === "open";
  const tif = review.tif ?? (review.kind === "open" ? (review.type === "limit" ? "gtc" : "fok") : null);
  const relay = useFollowedOrderRelay(answered, owner, trades);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), Math.max(0, ORDER_FOLLOW_MS - (Date.now() - at)));
    return () => clearTimeout(timer);
  }, [at]);
  const result = relay.results[0];
  const state = result?.state ?? "UNKNOWN";
  const fills = result?.fills ?? null;
  const summary = fills ? fillsSummary(fills) : null;
  const orderedUnits = Number(review.sizeUnits);
  const filledUnits = summary ? summary.sizeUnits : null;
  /* What became of the order, by the chain and Phoenix's own record — never by what the Review expected. */
  const outcome = orderOutcomeOf({ state, kind: review.kind, tif, sizeUnits: orderedUnits, filledUnits });
  const status = outcome === "pending" ? "pending" : outcome === "failed" ? "failed" : "completed";
  /* Telemetry (spec §18): confirmed once it landed, then what Phoenix did with it — by its record, never the Review's. */
  const told = useRef(false);
  useEffect(() => {
    if (told.current || outcome === "pending" || outcome === "failed") return;
    told.current = true;
    trackPerps("tx_confirmed", review.symbol, perpsOrderKind(review.kind), lang);
    if (outcome === "cancelled") trackPerps("order_cancelled", review.symbol, perpsOrderKind(review.kind), lang);
    else if (outcome === "partial") trackPerps("order_partial_fill", review.symbol, perpsOrderKind(review.kind), lang);
    else if (outcome === "filled") trackPerps("order_filled", review.symbol, perpsOrderKind(review.kind), lang);
  }, [outcome, review, lang]);
  const signature = result?.signature ?? "";
  const decimals = priceDecimals(review.markUsd);
  const usd = (value: number | null) => (value === null ? "—" : new Intl.NumberFormat(intl, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value));
  const coin = review.symbol;
  const closed = review.kind === "reduce" && review.after !== null && Number(review.after.positionUnits) === 0;
  const title = outcomeTitle(outcome, review, closed, lang);
  /* What Phoenix filled, by its own record of this signature; the Review's figures never stand in for a fill. */
  const filledSide = review.kind === "reduce" ? (review.side === "long" ? "short" : "long") : review.side;
  const fillLine =
    summary && summary.sizeUnits > 0
      ? w("receipt.fill", { side: capital(sideName(filledSide, lang)), size: formatAmount(summary.sizeUnits, intl), coin, price: formatTerminalPrice(summary.averageUsd, intl, decimals) })
      : outcome === "accepted"
        ? w("receipt.noFill")
        : trades
          ? w("receipt.fillPending")
          : "—";
  /* The remainder of a part-filled order: what rests in the book, or what the time in force cancelled. */
  const leftUnits = filledUnits === null ? null : Math.max(0, orderedUnits - filledUnits);
  const restLine =
    outcome === "partial" && leftUnits !== null
      ? w(tif === "gtc" || tif === "post_only" ? "receipt.restsLeft" : "receipt.cancelledLeft", { size: formatAmount(leftUnits, intl), coin })
      : null;
  const amountLine = status === "completed" ? [fillLine, restLine].filter(Boolean).join(" · ") : "—";
  /* Phoenix's fee and Ryntra's told apart on the fills themselves: the maker's rate where Phoenix recorded a maker
     fill, the taker's where it recorded a taker, and the builder's bps on the taker part alone (spec §17). */
  const split = fills ? feeSplitOf(fills, { takerRate: review.fees.takerRate, makerRate: review.fees.makerRate, builderBps: review.fees.builderBps }) : null;
  /* The impact the fill actually had: its average price against the best price the Review read on that side. */
  const impact = summary && summary.averageUsd !== null && review.impact != null ? priceImpactPercent(filledSide, summary.averageUsd, review.impact.bestUsd) : null;
  const networkLine = sol(BigInt(review.networkFeeLamports) + (status === "failed" ? 0n : BigInt(review.rentLamports)), intl);
  /* What the fills cost in all: Phoenix's own recorded figure where it sent one, else the two sides this page counted. */
  const paidUsd = split === null ? null : (split.recordedUsd ?? (split.phoenixUsd !== null && split.ryntraUsd !== null ? split.phoenixUsd + split.ryntraUsd : null));
  const paidLine = paidUsd === null ? (trades ? w("receipt.feePending") : "—") : w(split?.recordedUsd == null ? "receipt.feesByRates" : "receipt.fees", { x: usd(paidUsd) });
  const costs =
    status === "failed" ? (
      `${w("cost.network")} ${networkLine}`
    ) : (
      <dl className={styles.receiptCosts} data-futures-receipt-costs>
        <div>
          <dt title={w("receipt.splitNote")}>{`${w("cost.phoenix")} · ${w("receipt.byRates")}`}</dt>
          <dd>{split?.phoenixUsd == null ? w("receipt.feePending") : `${usd(split.phoenixUsd)} USDC`}</dd>
        </div>
        <div>
          <dt title={w("receipt.splitNote")}>{`${w("cost.ryntra")} · ${w("receipt.byRates")}`}</dt>
          <dd>{split?.ryntraUsd == null ? w("receipt.feePending") : `${usd(split.ryntraUsd)} USDC`}</dd>
        </div>
        <div>
          <dt>{w("cost.network")}</dt>
          <dd>{networkLine}</dd>
        </div>
        <div>
          <dt title={w("receipt.impactNote")}>{w("row.impact")}</dt>
          <dd>{impact === null ? "—" : `${formatAmount(impact, intl, 3)}${lang === "en" ? "%" : " %"}`}</dd>
        </div>
        {split && split.agrees === false ? (
          <div>
            <dt>{w("receipt.feeCheck")}</dt>
            <dd>{w("receipt.feeDisagrees", { x: usd(split.recordedUsd) })}</dd>
          </div>
        ) : null}
      </dl>
    );
  const heldLine = review.kind === "open" && summary && summary.sizeUnits > 0 ? w("receipt.held", { size: formatAmount(summary.sizeUnits, intl), coin }) : null;
  const pnlLine = review.kind === "reduce" && summary?.realizedPnlUsd != null ? w("receipt.pnl", { x: `${summary.realizedPnlUsd >= 0 ? "+" : "−"}${usd(Math.abs(summary.realizedPnlUsd))}` }) : null;
  return (
    <div className={styles.orderPanel} data-futures-order="receipt" data-futures-outcome={outcome}>
      <Receipt
        lang={lang}
        variant="full"
        titleAs="h3"
        title={title}
        status={status}
        amount={amountLine}
        paid={status === "failed" ? "—" : paidLine}
        got={status === "failed" ? "—" : (pnlLine ?? heldLine ?? (review.kind === "protect" || review.kind === "cancel" || review.kind === "cancelAll" || review.kind === "cancelConditional" ? title : "—"))}
        costs={costs}
        time={new Date(at).toLocaleTimeString(intl)}
        network="Solana · Phoenix"
        transaction={short(signature)}
        reason={status === "failed" ? w("receipt.nothing") : undefined}
        onVerify={() => window.open(explorerTxUrl("mainnet", signature), "_blank", "noopener,noreferrer")}
        actionsDisabled={status === "pending"}
      />
      <Button variant="secondary" lang={lang} onClick={onAgain} disabled={status === "pending" && !waited}>
        {w("again")}
      </Button>
      {status === "pending" && !waited ? <p className={styles.muted}>{w("againWait")}</p> : null}
    </div>
  );
}
