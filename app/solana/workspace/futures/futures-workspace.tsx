"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ChartLevel } from "@ryntra/core/adapters";
import { RyntraChart } from "@ryntra/core/chart";
import { ChartTelemetry } from "@ryntra/core/chart/telemetry";
import { EmptyState, Icon, Skeleton, Table, type TableColumn } from "@ryntra/core/ui";

import type { HonestState } from "@/lib/core/authority-matrix";
import { feedStale } from "@/lib/phoenix/feed-lifecycle";
import type { FuturesFundingEvent, FuturesOrderRecord, FuturesTrade } from "@/lib/phoenix/history";
import { liquidationDistancePercent, readSubaccounts, type PhoenixPositionRisk } from "@/lib/phoenix/collateral-model";
import { dayChange, isFuturesTimeframe, lotUnits, symbolKey, tickUsd, unrealisedPnl, type FuturesMarket, type FuturesOrder, type FuturesPosition, type FuturesTimeframe } from "@/lib/phoenix/market-data";

import { useSolanaConnection } from "../connection";
import { useSolanaI18n } from "../i18n/provider";
import { WalletGate } from "../wallet-gate";
import { formatAmount, formatPercent, formatTerminalPrice, formatUsdCompact, formatUsdMoney, toneOf } from "../spot/spot-format";

import { CollateralPanel } from "./collateral-panel";
import { PhoneTicketLauncher, PhoneTicketScreen, type PerpSide } from "./perps-phone";
import { cardsFor, densityOf, largeTargets } from "./perps-settings";
import { useOwnWidth, usePerpsSettings, usePerpsWidth } from "./use-perps-settings";
import { OrderPanel, type DraftLevels, type OrderIntent } from "./order-panel";
import { orderWord } from "./order-words";
import { useOrderStates } from "./orders-api";
import { FuturesChartFeed, LAST_BASIS, resolutionOf, timeframeOf } from "./futures-chart-source";
import { futuresWord, phoenixWord, type FuturesWordKey } from "./futures-words";
import { PerpBook, useBookSnapshot } from "./perp-book";
import type { ScalpRates } from "./scalp-check";
import { PerpsHeader } from "./perps-header";
import type { PerpsPanelId } from "./perps-layout";
import { trackPerps, useTrackOnce } from "./perps-telemetry";
import { PerpsTerminal } from "./perps-terminal";
import { perpsWord, type PerpsWordKey } from "./perps-words";
import { BOOK_MAX_AGE_MS, useFuturesAccount, useFuturesBook, useFuturesCandles, useFuturesFunding, useFuturesFundingHistory, useFuturesMarkets, useFuturesOrderHistory, useFuturesTrades, type PolledBookFeed } from "./use-futures-data";

import styles from "./perps.module.css";

const TF_KEY = "ryntra.futures.timeframe.v1";
const DEFAULT_SYMBOL = "SOL";
/** From this leverage a position's liquidation is red with the warning sign. */
const HIGH_LEVERAGE = 5;

/** A position as the table draws it: the trader state's row with the margin view's liquidation price and leverage. */
type PositionRow = FuturesPosition & Readonly<{ risk: PhoenixPositionRisk | null; read: boolean }>;

/** Phoenix's own word for what became of an order, in the reader's language; an unknown word stands as Phoenix sent it. */
const STATUS_WORDS: Readonly<Record<string, PerpsWordKey>> = Object.freeze({ active: "status.active", open: "status.active", filled: "status.filled", cancelled: "status.cancelled", canceled: "status.cancelled", expired: "status.expired" });

/** Which market an action belongs to; null for the ticket, which follows whichever market is open. */
function intentSymbol(intent: OrderIntent): string | null {
  switch (intent.kind) {
    case "ticket":
      return null;
    case "cancel":
    case "cancelConditional":
      return intent.order.symbol;
    case "cancelAll":
      return intent.symbol;
    default:
      return intent.position.symbol;
  }
}

/**
 * The markets in the order of the first read — the busiest first — kept while the page is open: the list does not
 * reshuffle itself under the pointer every five seconds when two volumes cross (UX-356).
 */
function useSteadyOrder(list: readonly FuturesMarket[]): readonly FuturesMarket[] {
  const order = useRef(new Map<string, number>());
  return useMemo(() => {
    for (const market of list) if (!order.current.has(market.symbol)) order.current.set(market.symbol, order.current.size);
    return [...list].sort((a, b) => (order.current.get(a.symbol) ?? 0) - (order.current.get(b.symbol) ?? 0));
  }, [list]);
}

/** The page's chosen timeframe, kept in this browser. */
function useTimeframe(): [FuturesTimeframe, (next: FuturesTimeframe) => void] {
  const [timeframe, setTimeframe] = useState<FuturesTimeframe>("1h");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TF_KEY);
      if (isFuturesTimeframe(stored)) setTimeframe(stored);
    } catch {
      /* A denied store keeps the default. */
    }
  }, []);
  const set = useCallback((next: FuturesTimeframe) => {
    setTimeframe(next);
    try {
      window.localStorage.setItem(TF_KEY, next);
    } catch {
      /* Nothing to keep. */
    }
  }, []);
  return [timeframe, set];
}

/**
 * Where the ticket stands now — its panel. The ticket lives in one node of its own that this place takes in: the
 * terminal builds its panels again for a preset or a panel brought back, but the ticket — what is typed, a Review, a
 * signature on its way — is the same one throughout.
 */
function TicketSlot({ home }: { home: HTMLElement | null }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = slot.current;
    if (!place || !home) return undefined;
    place.appendChild(home);
    return () => {
      if (home.parentNode === place) place.removeChild(home);
    };
  }, [home]);
  return <div ref={slot} className={styles.ticketSlot} data-ticket-slot />;
}

/** The book's panel: the book polled every two seconds, read here so its clock does not redraw the whole terminal. */
function BookPanel({ feed, coin, markUsd, lang, pro, rates, onPick }: { feed: PolledBookFeed | null; coin: string; markUsd: number | null; lang: "en" | "uk"; pro: boolean; rates: ScalpRates; onPick: (price: number) => void }) {
  const { book, ageMs } = useBookSnapshot(feed);
  return <PerpBook book={book} ageMs={ageMs} maxAgeMs={BOOK_MAX_AGE_MS} coin={coin} markUsd={markUsd} lang={lang} pro={pro} rates={rates} onPick={onPick} />;
}

/**
 * The positions or the orders as their panel's width allows (PERP-6, spec §5 and §15): the table where every column —
 * TP/SL and the actions included — stands whole, cards where it would not, and always in Simple. Nothing scrolls aside.
 */
function TableOrCards({ cards, table, mode }: { cards: ReactNode; table: ReactNode; mode: "simple" | "pro" }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useOwnWidth(box);
  const asCards = cardsFor(mode, width);
  return (
    <div ref={box} className={styles.tableOrCards} data-perps-view={asCards ? "cards" : "table"}>
      {asCards ? cards : <div className={styles.scroll} data-dense>{table}</div>}
    </div>
  );
}

/**
 * Perps — Phoenix's perpetuals inside Ryntra on Solana as a trader's terminal
 * (PERP-2): the market's head in one line, then the core's terminal — the chart, the order book, the order ticket with
 * its leverage, the positions, the orders, the account with its collateral, and the markets — panels that are dragged,
 * resized, split, put away and brought back, the arrangement kept in this browser. Every order goes through the
 * server's Review of Phoenix's own view of the account and the wallet's signature; the page builds and signs nothing.
 *
 * `?market=SOL` opens a market directly, so a market can be shared as a link.
 */
export function FuturesWorkspace({ initialSymbol, ordersState }: { initialSymbol: string | null; ordersState?: HonestState }) {
  const { locale, setLocale } = useSolanaI18n();
  const lang = locale === "uk" ? "uk" : "en";
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = useCallback((key: FuturesWordKey, fill?: Readonly<Record<string, string>>) => futuresWord(lang, key, fill), [lang]);
  const pw = useCallback((key: PerpsWordKey, fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill), [lang]);
  const ow = useCallback((key: Parameters<typeof orderWord>[1], fill?: Readonly<Record<string, string>>) => orderWord(lang, key, fill), [lang]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const markets = useFuturesMarkets();
  const list = useSteadyOrder(useMemo(() => markets.value?.markets ?? [], [markets.value]));
  /* Phoenix's own spelling is kept; an address in another case still finds its market. */
  const requested = symbolKey(params.get("market") ?? initialSymbol ?? DEFAULT_SYMBOL);
  const market: FuturesMarket | null = list.find((entry) => symbolKey(entry.symbol) === requested) ?? list.find((entry) => symbolKey(entry.symbol) === symbolKey(DEFAULT_SYMBOL)) ?? list[0] ?? null;
  const symbol = market?.symbol ?? null;

  const choose = useCallback(
    (next: string) => {
      const query = new URLSearchParams(params.toString());
      query.set("market", next);
      router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  /* The chart's feed: one per market, on Phoenix's own price step and lot — a price that flickers never remakes it. */
  const reference = market?.markPrice ?? null;
  const tick = market ? tickUsd(market) : null;
  const lot = market ? lotUnits(market) : null;
  const [feed, setFeed] = useState<FuturesChartFeed | null>(null);
  useEffect(() => {
    if (!symbol) return;
    const next = new FuturesChartFeed(symbol, { tick, lot, price: reference });
    setFeed(next);
    return () => next.dispose();
    // The step from a price is the fallback only; the feed is the market's and its units'.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tick, lot]);
  const [timeframe, setTimeframe] = useTimeframe();
  /* Simple or Pro, the chart's lines, the reader's own needs (PERP-6), and the window's class of width. */
  const [settings, setSettings] = usePerpsSettings();
  const width = usePerpsWidth();
  const phone = width === "phone";
  const density = densityOf(settings.mode);
  useFuturesCandles(
    feed ? symbol : null,
    timeframe,
    (candles, arrival) => {
      if (candles.symbol === symbol) feed?.put(candles, arrival.ageMs);
    },
    () => feed?.fail(timeframe),
  );

  const book = useFuturesBook(symbol);
  const funding = useFuturesFunding(symbol);
  /* Phoenix's prices stopped coming (a read failed, or silence): the head and the ticket say so, and new risk waits. */
  const stale = feedStale(markets.feed);
  const staleSince = useMemo(() => (stale ? { updatedAt: markets.feed.updatedAt } : null), [stale, markets.feed.updatedAt]);
  /* Telemetry (spec §18): the markets gone quiet, and the core chart's own alerts on its data's age and gaps. */
  useTrackOnce(stale && list.length > 0, "market_stream_stale", symbol, "markets", lang);
  const chartTelemetry = useMemo(
    () =>
      symbol
        ? new ChartTelemetry({
            surface: "perps",
            onEvent: (event) => {
              if (event.type === "alert" && event.on && (event.rule === "age" || event.rule === "gap")) trackPerps("market_stream_stale", symbol, "chart", lang);
            },
          })
        : null,
    [symbol, lang],
  );
  const { connection } = useSolanaConnection();
  const wallet = connection?.address ?? null;
  const account = useFuturesAccount(wallet);
  /* A wallet with a Phoenix account sees its positions and its collateral; anyone else, the one line that says why not. */
  const opened = account.value !== null && account.value.wallet === wallet && account.value.state !== "none" && account.value.state !== "uninitialized";
  /* A Review being signed or a receipt keeps «Застава» on screen even when another wallet connects meanwhile. */
  const [collateralHeld, setCollateralHeld] = useState(false);
  const showCollateral = opened || collateralHeld;
  /* The wallet's own history on Phoenix (PERP-5, spec §11.1): the fills, the orders and the funding settlements. */
  const trades = useFuturesTrades(opened ? wallet : null, null);
  const orderHistory = useFuturesOrderHistory(opened ? wallet : null, null);
  const fundingHistory = useFuturesFundingHistory(opened ? wallet : null, null);
  /* Orders (B6b): what the gate lets this wallet do, the panel's action from the tables, and the prices being set. */
  const orderStates = useOrderStates(wallet);
  const [intent, setIntent] = useState<OrderIntent>({ kind: "ticket" });
  const [draftLevels, setDraftLevels] = useState<DraftLevels>({ limit: null, tp: null, sl: null });
  const [pricePick, setPricePick] = useState<Readonly<{ price: number; at: number }> | null>(null);
  /* Another wallet starts from the ticket; another market keeps an action on its own market (a table's row may choose it). */
  useEffect(() => setIntent({ kind: "ticket" }), [wallet]);
  const lastSymbol = useRef(symbol);
  useEffect(() => {
    if (lastSymbol.current === symbol) return;
    lastSymbol.current = symbol;
    /* A price pressed in another market's book is not this market's. */
    setPricePick(null);
    setIntent((current) => {
      const own = intentSymbol(current);
      return own !== null && symbolKey(own) === symbolKey(symbol ?? "") ? current : { kind: "ticket" };
    });
  }, [symbol]);
  /* Rounded down: a distance to liquidation is never shown larger than it is. */
  const percent = useCallback((value: number) => {
    const step = value < 10 ? 10 : 1;
    return new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: value < 10 ? 1 : 0 }).format(Math.floor(value * step) / step / 100);
  }, [intl]);

  /* Each subaccount's margin view beside the trader state's positions: the cross-margin one and every isolated one. */
  const positions = useMemo<PositionRow[]>(() => {
    const own = account.value;
    if (!own || own.wallet !== wallet) return [];
    const risks = [own.margin, ...(own.subaccountMargins ?? [])].flatMap((margin) => margin?.positions ?? []);
    const read = readSubaccounts(own);
    return own.positions.map((position) => ({ ...position, read: read.has(position.subaccount), risk: risks.find((risk) => risk.subaccount === position.subaccount && symbolKey(risk.symbol) === symbolKey(position.symbol)) ?? null }));
  }, [account.value, wallet]);
  const orders = useMemo<readonly FuturesOrder[]>(() => (account.value && account.value.wallet === wallet ? account.value.orders : []), [account.value, wallet]);

  /* Case-blind, as every match of a symbol here: the trader state and the market list may spell it differently. */
  const markBy = useMemo(() => new Map(list.map((entry) => [symbolKey(entry.symbol), entry.markPrice])), [list]);
  const markOf = useCallback((value: string) => markBy.get(symbolKey(value)) ?? null, [markBy]);
  const signedSize = (position: FuturesPosition) => (position.size === null ? 0 : position.side === "long" ? position.size : -position.size);
  /* The position the ticket adds to or reduces: subaccount 0 on this market, the account Ryntra trades. */
  const heldUnits = useMemo(() => {
    const own = positions.find((position) => position.subaccount === 0 && symbolKey(position.symbol) === symbolKey(symbol ?? ""));
    return own ? signedSize(own) : 0;
  }, [positions, symbol]);
  const positionsValueUsd = useMemo(() => positions.filter((position) => position.subaccount === 0).reduce((sum, position) => sum + Math.abs(position.size ?? 0) * (markOf(position.symbol) ?? 0), 0), [positions, markOf]);

  /* The position the chart's own trading layer draws (PERP-5): subaccount 0 on this market — the one Ryntra trades. */
  const ownPosition = useMemo(() => positions.find((row) => row.subaccount === 0 && symbolKey(row.symbol) === symbolKey(symbol ?? "")) ?? null, [positions, symbol]);

  /*
   * The core chart's trading layer (PERP-5, spec §7): the traded position's own lines — entry, liquidation, break-even
   * and the unrealised result — are the layer's `PositionLines`, so the chart draws them as it draws every product's
   * and Perps keeps no line of its own. It also says whether new orders may be drafted (PERP-4): never while the data
   * is stale. The chart drafts nothing here yet — no `new_orders` until PERP-9's plans.
   */
  /*
   * The rate the core counts a break-even and a ghost's P/L after (`fee_rate`: «the venue's rate for a taker plus
   * whatever else is charged on the order — a builder's fee once»): Phoenix's taker rate and Ryntra's together, the
   * same sum the ticket shows. Null when either side is not known rather than counted as nothing.
   */
  const ryntraRate = orderStates.builder ? (orderStates.builderBps == null ? null : orderStates.builderBps / 10_000) : 0;
  const feeRate = market?.takerRate == null || ryntraRate === null ? null : market.takerRate + ryntraRate;
  /*
   * What a round trip pays, for Scalp Check (PERP-7): Phoenix's two rates from its catalogue and Ryntra's from the
   * gate. A builder whose bps the chain has not given is null, not nothing — the check then shows no total at all.
   */
  const scalpRates = useMemo<ScalpRates>(
    () => ({ takerRate: market?.takerRate ?? null, makerRate: market?.makerRate ?? null, builderBps: orderStates.builder ? (orderStates.builderBps ?? null) : 0 }),
    [market?.takerRate, market?.makerRate, orderStates.builder, orderStates.builderBps],
  );
  const chartPosition = useMemo(() => {
    if (!feed || !ownPosition || !settings.lines.positions || ownPosition.size === null || ownPosition.entryPrice === null) return null;
    const mark = markOf(ownPosition.symbol);
    /* Without the mark there is no result to state: the layer gets no position rather than a zero PnL. */
    if (mark === null) return null;
    /* A price is quantised by the price step, a size by the lot — never one by the other (a size rounded to the price
       step is zero on a market whose step is a dollar, and the core reads the side from that sign). */
    const onStep = (step: string) => {
      const unit = Number(step);
      const places = step.includes(".") ? step.length - step.indexOf(".") - 1 : 0;
      return (value: number) => (unit > 0 ? (Math.round(value / unit) * unit).toFixed(places) : value.toFixed(places));
    };
    const atPrice = onStep(feed.instrument.tick);
    const atSize = onStep(feed.instrument.lot);
    const tick = Number(feed.instrument.tick);
    const long = ownPosition.side === "long";
    const entry = ownPosition.entryPrice;
    const size = ownPosition.size;
    const leverage = ownPosition.risk?.leverage ?? null;
    const quote = unrealisedPnl(ownPosition, mark);
    const notional = size * entry;
    /* Phoenix's leverage is the position's value at the mark over the margin it holds: the margin is that value over it. */
    const margin = leverage !== null && leverage > 0 ? (size * mark) / leverage : null;
    const base = margin ?? notional;
    /* Break-even: where the way out pays back the way in, with the taker fee on both sides; null without a rate. */
    const breakEven = feeRate === null ? null : long ? (entry * (1 + feeRate)) / (1 - feeRate) : (entry * (1 - feeRate)) / (1 + feeRate);
    if (quote === null || !(base > 0)) return null;
    return {
      size: atSize(long ? size : -size),
      entry: atPrice(entry),
      liquidation: ownPosition.risk?.liquidationPriceUsd == null ? null : atPrice(ownPosition.risk.liquidationPriceUsd),
      break_even: breakEven === null ? null : atPrice(breakEven),
      leverage,
      pnl: {
        quote: quote.toFixed(6),
        percent: ((quote / base) * 100).toFixed(2),
        percent_of: (margin !== null ? "margin" : "notional") as "margin" | "notional",
        pips: tick > 0 ? ((long ? mark - entry : entry - mark) / tick).toFixed(0) : "0",
        after_fees: false,
        estimate: true as const,
      },
    };
  }, [feed, ownPosition, settings.lines.positions, markOf, feeRate]);
  /* The wallet's position and orders on this market, as lines on the chart. */
  const levels = useMemo<ChartLevel[]>(() => {
    if (!symbol || !feed) return [];
    const step = feed.instrument.tick;
    const at = (value: number) => (Math.round(value / Number(step)) * Number(step)).toFixed(step.includes(".") ? step.length - step.indexOf(".") - 1 : 0);
    const out: ChartLevel[] = [];
    for (const position of settings.lines.positions ? positions : []) {
      if (symbolKey(position.symbol) !== symbolKey(symbol)) continue;
      /* The entry and the liquidation of the traded position are the core's `PositionLines` — but only while the layer
         has them: without a mark, a size or an entry it draws nothing, and then these lines are the only ones there are. */
      const own = position === ownPosition && chartPosition !== null;
      if (!own && position.entryPrice !== null) out.push({ id: `position-${position.subaccount}`, kind: "level", price: at(position.entryPrice), basis: LAST_BASIS, label: `${w(position.side)} ${position.size === null ? "" : formatAmount(position.size, intl)} · ${w("entry")}` });
      /* Phoenix liquidates by the mark price; the chart draws the traded one — the line says which it is. */
      const liquidation = own ? null : (position.risk?.liquidationPriceUsd ?? null);
      if (liquidation !== null) out.push({ id: `liquidation-${position.subaccount}`, kind: "level", price: at(liquidation), basis: LAST_BASIS, label: w("liquidationLine") });
      /* The position's TP/SL as Phoenix holds them (B6b): they fire on the mark price. */
      if (position.tpPrice != null) out.push({ id: `tp-${position.subaccount}`, kind: "level", price: at(position.tpPrice), basis: LAST_BASIS, label: `TP · ${w("mark")}` });
      if (position.slPrice != null) out.push({ id: `sl-${position.subaccount}`, kind: "level", price: at(position.slPrice), basis: LAST_BASIS, label: `SL · ${w("mark")}` });
    }
    /* What the ticket is setting now: a limit's price and the legs, before any Review. */
    if (settings.lines.draft && draftLevels.limit !== null) out.push({ id: "draft-limit", kind: "level", price: at(draftLevels.limit), basis: LAST_BASIS, label: ow("limit") });
    if (settings.lines.draft && draftLevels.tp !== null) out.push({ id: "draft-tp", kind: "level", price: at(draftLevels.tp), basis: LAST_BASIS, label: ow("row.tp") });
    if (settings.lines.draft && draftLevels.sl !== null) out.push({ id: "draft-sl", kind: "level", price: at(draftLevels.sl), basis: LAST_BASIS, label: ow("row.sl") });
    for (const order of settings.lines.orders ? orders : []) {
      if (symbolKey(order.symbol) !== symbolKey(symbol) || order.price === null) continue;
      out.push({ id: `order-${order.id}`, kind: "level", price: at(order.price), basis: LAST_BASIS, label: `${w(order.side)} ${order.size === null ? "" : formatAmount(order.size, intl)}`.trim() });
    }
    return out;
  }, [positions, orders, symbol, feed, w, intl, draftLevels, ow, settings.lines, ownPosition, chartPosition]);
  const chartMarks = useMemo(() => ({ marks: [], levels }), [levels]);
  const chartTrading = useMemo(
    () => (feed ? { instrument: feed.instrument, view: LAST_BASIS, lines: [], position: chartPosition, tradable: !stale, not_tradable_reason: stale ? pw("head.stale") : null, armed: false, ...(feeRate === null ? {} : { fee_rate: String(feeRate) }), ...(market?.markPrice == null ? {} : { prices: { mark: String(market.markPrice) } }) } : null),
    [feed, stale, pw, chartPosition, feeRate, market?.markPrice],
  );

  /* The position's actions (B6b): its own market's cut, close and TP/SL — subaccount 0 only, the account Ryntra trades. */
  const actOn = useCallback((next: OrderIntent, position: { symbol: string }) => {
    if (symbolKey(position.symbol) !== symbolKey(symbol ?? "")) choose(position.symbol);
    setIntent(next);
  }, [symbol, choose]);

  /*
   * The scale's own actions (PERP-7): «Зменшити» and «Закрити» take the position nearest its liquidation — the one a
   * critical account is critical because of — and «Скасувати заявки» the market whose orders are resting, since
   * Phoenix cancels per market. Each opens the same Review and the same signature as the table's own action.
   */
  const riskiest = useMemo<PositionRow | null>(() => {
    let nearest: PositionRow | null = null;
    let room: number | null = null;
    for (const position of positions) {
      if (position.subaccount !== 0 || !position.size) continue;
      const own = liquidationDistancePercent(position.side, markOf(position.symbol), position.risk?.liquidationPriceUsd ?? null);
      if (nearest === null || (own !== null && (room === null || own < room))) {
        nearest = position;
        room = own;
      }
    }
    return nearest;
  }, [positions, markOf]);
  const riskAct = useCallback(
    (action: "reduce" | "close" | "cancelAll") => {
      if (action === "cancelAll") {
        const resting = orders.find((order) => order.subaccount === 0);
        if (!resting) return;
        if (symbolKey(resting.symbol) !== symbolKey(symbol ?? "")) choose(resting.symbol);
        setIntent({ kind: "cancelAll", symbol: resting.symbol });
        return;
      }
      if (!riskiest) return;
      actOn({ kind: action, position: riskiest }, riskiest);
    },
    [orders, riskiest, symbol, choose, actOn],
  );

  /* Each cell once, for the table and for the cards alike: the same data and the same actions in either (PERP-6). */
  const cells = useMemo(() => {
    const market = (row: { symbol: string }) => (
      <button type="button" className={styles.cellLink} onClick={() => choose(row.symbol)}>
        <span className={styles.symbol} translate="no">{row.symbol}</span>
      </button>
    );
    const liquidation = (row: PositionRow) => {
      const price = row.risk?.liquidationPriceUsd ?? null;
      /* Unread is not unknown: Phoenix has the figure for a subaccount this read did not reach. */
      if (price === null) return <span className={styles.unknown}>{w(row.read ? "liquidationUnknown" : "liquidationUnread")}</span>;
      const distance = liquidationDistancePercent(row.side, markOf(row.symbol), price);
      /* From 5× the line that loses the whole margin is red, bold and signed (C-09); below it, a number like the others. */
      const high = (row.risk?.leverage ?? 0) >= HIGH_LEVERAGE || (distance !== null && distance < 10);
      return (
        <span className={styles.liquidation} data-tone={high ? "down" : undefined} data-futures-liquidation={high ? "high" : "normal"}>
          <span className={styles.liquidationPrice}>
            {high ? <Icon name="triangle-alert" size={14} /> : null}
            {formatTerminalPrice(price, intl)}
          </span>
          {distance === null ? null : <span className={styles.away}>{w("liquidationAway", { x: percent(distance) })}</span>}
        </span>
      );
    };
    const pnl = (row: PositionRow) => {
      const value = unrealisedPnl(row, markOf(row.symbol));
      const base = row.entryPrice !== null && row.size !== null ? Math.abs(row.size) * row.entryPrice : null;
      return (
        <span data-tone={toneOf(value)} className={styles.pnl}>
          <span>{value === null ? "—" : `${value < 0 ? "−" : value > 0 ? "+" : ""}${formatUsdMoney(Math.abs(value), intl)}`}</span>
          {value !== null && base ? <small>{formatPercent((value / base) * 100, intl)}</small> : null}
        </span>
      );
    };
    const value = (row: PositionRow) => formatUsdMoney(row.size === null || markOf(row.symbol) === null ? null : Math.abs(row.size) * markOf(row.symbol)!, intl);
    const leverage = (row: PositionRow) => (row.risk?.leverage == null ? "—" : `${formatAmount(row.risk.leverage, intl, 1)}×`);
    const actions = (row: PositionRow) =>
      row.subaccount !== 0 ? (
        <span className={styles.unknown}>{pw("pos.isolated")}</span>
      ) : (
        <span className={styles.rowActions}>
          <button type="button" onClick={() => actOn({ kind: "protect", position: row }, row)} aria-label={`${pw("pos.edit")} · ${row.symbol}-PERP`} data-futures-act="protect">{pw("pos.edit")}</button>
          <button type="button" onClick={() => actOn({ kind: "reduce", position: row }, row)} aria-label={`${pw("pos.reduce")} · ${row.symbol}-PERP`} data-futures-act="reduce">{pw("pos.reduce")}</button>
          <button type="button" onClick={() => actOn({ kind: "close", position: row }, row)} aria-label={`${pw("pos.close")} · ${row.symbol}-PERP`} data-futures-act="close">{pw("pos.close")}</button>
        </span>
      );
    const cancel = (row: FuturesOrder) => {
      if (row.subaccount !== 0) return null;
      /* A plain resting order is cancelled by its own sequence number. */
      if (!row.stop && row.sequence) {
        return (
          <span className={styles.rowActions}>
            <button type="button" onClick={() => actOn({ kind: "cancel", order: row }, row)} aria-label={`${pw("ord.cancel")} · ${row.symbol}-PERP`} data-futures-act="cancel">{pw("ord.cancel")}</button>
          </span>
        );
      }
      /* A conditional order of the position is lifted by its index — the one Phoenix's own trigger names (PERP-5). */
      if (row.conditional != null) {
        return (
          <span className={styles.rowActions}>
            <button type="button" onClick={() => actOn({ kind: "cancelConditional", order: row }, row)} aria-label={`${pw("ord.cancelLeg")} · ${row.symbol}-PERP`} data-futures-act="cancel-leg">{pw("ord.cancelLeg")}</button>
          </span>
        );
      }
      /* A stop Phoenix gives no index for: said plainly, instead of a button that could not work. */
      return row.stop ? <span className={styles.unknown}>{pw("ord.cancelStopNote")}</span> : null;
    };
    const orderType = (row: FuturesOrder) => [phoenixWord(lang, row.type), row.stop ? w("stop") : null, row.reduceOnly ? w("reduceOnly") : null].filter(Boolean).join(" · ");
    return { market, liquidation, pnl, value, leverage, actions, cancel, orderType };
  }, [w, pw, intl, lang, markOf, percent, actOn, choose]);

  /* Eight columns, two lines where two figures belong together: TP/SL and the actions stand whole in a desk's panel. */
  const positionColumns = useMemo<TableColumn<PositionRow>[]>(() => {
    const columns: TableColumn<PositionRow>[] = [
      {
        key: "symbol",
        label: pw("col.market"),
        render: (row) => (
          <span className={styles.stacked}>
            {cells.market(row)}
            <small data-side={row.side}>{w(row.side)}</small>
          </span>
        ),
      },
      {
        key: "size",
        label: pw("pos.size"),
        numeric: true,
        render: (row) => (
          <span className={styles.stacked}>
            <span>{`${formatAmount(row.size, intl)} ${row.symbol}`}</span>
            <small>{cells.value(row)}</small>
          </span>
        ),
      },
      {
        key: "entryPrice",
        label: `${pw("pos.entry")} / ${pw("card.mark")}`,
        numeric: true,
        render: (row) => (
          <span className={styles.stacked}>
            <span>{formatTerminalPrice(row.entryPrice, intl)}</span>
            <small>{formatTerminalPrice(markOf(row.symbol), intl)}</small>
          </span>
        ),
      },
      { key: "liquidation", label: pw("pos.liq"), numeric: true, render: cells.liquidation },
      { key: "leverage", label: pw("pos.margin"), numeric: true, render: cells.leverage },
      { key: "pnl", label: pw("pos.pnl"), numeric: true, render: cells.pnl },
      {
        key: "tpsl",
        label: pw("pos.tpsl"),
        numeric: true,
        render: (row) => (
          <span className={styles.stacked}>
            <span>{formatTerminalPrice(row.tpPrice ?? null, intl)}</span>
            <small>{formatTerminalPrice(row.slPrice ?? null, intl)}</small>
          </span>
        ),
      },
    ];
    if (orderStates.open) columns.push({ key: "actions", label: ow("actions"), render: cells.actions });
    return columns;
  }, [w, pw, ow, intl, markOf, orderStates.open, cells]);

  const orderColumns = useMemo<TableColumn<FuturesOrder>[]>(
    () => [
      {
        key: "symbol",
        label: pw("col.market"),
        render: (row) => (
          <span className={styles.stacked}>
            {cells.market(row)}
            <small data-side={row.side === "buy" ? "long" : "short"}>{w(row.side)}</small>
          </span>
        ),
      },
      { key: "type", label: pw("ord.type"), render: cells.orderType },
      { key: "price", label: pw("ord.price"), numeric: true, render: (row) => formatTerminalPrice(row.price, intl) },
      {
        key: "size",
        label: pw("ord.left"),
        numeric: true,
        render: (row) => (
          <span className={styles.stacked}>
            <span>{`${formatAmount(row.size, intl)} ${row.symbol}`}</span>
            <small>{formatUsdMoney(row.size === null || row.price === null ? null : row.size * row.price, intl)}</small>
          </span>
        ),
      },
      ...(orderStates.open ? [{ key: "cancel", label: ow("actions"), render: cells.cancel }] : []),
    ],
    [w, pw, ow, intl, orderStates.open, cells],
  );

  /* The same rows as cards (spec §15, «Position card: PnL, liquidation distance, edit, reduce, close»). */
  const positionCards = (
    <ul className={styles.cards} aria-label={w("positionsCaption")} data-perps-cards="positions">
      {positions.length === 0 ? <li className={styles.muted}>{pw("pos.none")}</li> : null}
      {positions.map((row) => (
        <li key={`${row.subaccount}:${row.symbol}`} className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.stacked}>
              {cells.market(row)}
              <small data-side={row.side}>{`${w(row.side)} · ${cells.leverage(row)}`}</small>
            </span>
            {cells.pnl(row)}
          </div>
          <dl className={styles.cardFacts}>
            <div><dt>{pw("pos.size")}</dt><dd>{`${formatAmount(row.size, intl)} ${row.symbol}`}</dd></div>
            <div><dt>{pw("card.value")}</dt><dd>{cells.value(row)}</dd></div>
            <div><dt>{pw("card.entry")}</dt><dd>{formatTerminalPrice(row.entryPrice, intl)}</dd></div>
            <div><dt>{pw("card.mark")}</dt><dd>{formatTerminalPrice(markOf(row.symbol), intl)}</dd></div>
            <div><dt>{pw("pos.liq")}</dt><dd>{cells.liquidation(row)}</dd></div>
            <div><dt>{pw("pos.tpsl")}</dt><dd>{`${formatTerminalPrice(row.tpPrice ?? null, intl)} / ${formatTerminalPrice(row.slPrice ?? null, intl)}`}</dd></div>
          </dl>
          {orderStates.open ? <div className={styles.cardActions}>{cells.actions(row)}</div> : null}
        </li>
      ))}
    </ul>
  );
  const orderCards = (
    <ul className={styles.cards} aria-label={w("ordersCaption")} data-perps-cards="orders">
      {orders.length === 0 ? <li className={styles.muted}>{pw("ord.none")}</li> : null}
      {orders.map((row) => (
        <li key={row.id} className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.stacked}>
              {cells.market(row)}
              <small data-side={row.side === "buy" ? "long" : "short"}>{`${w(row.side)} · ${cells.orderType(row)}`}</small>
            </span>
            <span className={styles.stacked}>
              <span>{formatTerminalPrice(row.price, intl)}</span>
              <small>{`${formatAmount(row.size, intl)} ${row.symbol}`}</small>
            </span>
          </div>
          {orderStates.open && cells.cancel(row) ? <div className={styles.cardActions}>{cells.cancel(row)}</div> : null}
        </li>
      ))}
    </ul>
  );

  /*
   * The five numbers of a perpetual account kept apart (PERP-5, spec §11.2): the unrealised result of the open
   * positions, counted here from the marks; the realised result, the fees and the funding — paid and received each on
   * its own — from Phoenix's own history of this wallet. A figure Phoenix has not shown is «—», never a zero.
   */
  const unrealisedUsd = useMemo(() => {
    /* Subaccount 0 only — the account Ryntra trades and the one Phoenix's histories beside these numbers are read for. */
    const own = positions.filter((row) => row.subaccount === 0);
    if (own.length === 0) return null;
    let sum: number | null = 0;
    for (const row of own) {
      const value = unrealisedPnl(row, markOf(row.symbol));
      sum = sum === null || value === null ? null : sum + value;
    }
    return sum;
  }, [positions, markOf]);
  const money = useCallback(
    (value: number | null, signed = false) => (value === null ? "—" : `${signed ? (value < 0 ? "−" : value > 0 ? "+" : "") : ""}${formatUsdMoney(Math.abs(value), intl)}`),
    [intl],
  );
  const pnlSummary = (
    <dl className={styles.sums} data-perps-sums>
      <div>
        <dt>{pw("sum.unrealised")}</dt>
        <dd data-tone={toneOf(unrealisedUsd)}>{money(unrealisedUsd, true)}</dd>
      </div>
      <div>
        <dt>{pw("sum.realised")}</dt>
        <dd data-tone={toneOf(trades.value?.realizedPnlUsd ?? null)}>{money(trades.value?.realizedPnlUsd ?? null, true)}</dd>
      </div>
      <div>
        <dt>{pw("sum.fees")}</dt>
        <dd>{money(trades.value?.feesUsd ?? null)}</dd>
      </div>
      <div>
        <dt>{pw("sum.fundingPaid")}</dt>
        <dd>{money(fundingHistory.value?.paidUsd ?? null)}</dd>
      </div>
      <div>
        <dt>{pw("sum.fundingGot")}</dt>
        <dd>{money(fundingHistory.value?.receivedUsd ?? null)}</dd>
      </div>
    </dl>
  );
  /* Which way Phoenix's own sign runs is checked on the chain at PERP-G1: said here rather than assumed silently. */
  const fundingNote = <p className={styles.muted}>{pw("fnd.signNote")}</p>;

  /*
   * «Cancel all» on this market: one instruction takes every order of this wallet resting in this market's book — the
   * plain ones and the ones a TP/SL placed — so the count is of that whole set, the same one the Review names.
   */
  const restingHere = useMemo(
    /* The rows the Review counts too: this market's, at subaccount 0, each with the sequence number Phoenix gave it. */
    () => orders.filter((row) => row.subaccount === 0 && !!row.sequence && symbolKey(row.symbol) === symbolKey(symbol ?? "")).length,
    [orders, symbol],
  );
  const cancelAllButton =
    orderStates.open && restingHere > 0 && symbol ? (
      <button type="button" className={styles.quietChip} onClick={() => setIntent({ kind: "cancelAll", symbol })} data-futures-act="cancel-all">
        {pw("ord.cancelAllOn", { n: String(restingHere), coin: symbol })}
      </button>
    ) : null;

  const when = useCallback((at: number | null) => (at === null ? "—" : new Date(at).toLocaleString(intl, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })), [intl]);

  const tradeColumns = useMemo<TableColumn<FuturesTrade>[]>(
    () => [
      { key: "at", label: pw("trd.time"), render: (row) => when(row.at) },
      { key: "symbol", label: pw("col.market"), render: (row) => cells.market(row) },
      { key: "side", label: pw("trd.side"), render: (row) => <span data-side={row.side === "buy" ? "long" : "short"}>{w(row.side)}</span> },
      { key: "sizeUnits", label: pw("trd.size"), numeric: true, render: (row) => `${formatAmount(row.sizeUnits, intl)} ${row.symbol}` },
      { key: "priceUsd", label: pw("trd.price"), numeric: true, render: (row) => formatTerminalPrice(row.priceUsd, intl) },
      { key: "feeUsd", label: pw("trd.fee"), numeric: true, render: (row) => money(row.feeUsd) },
      { key: "realizedPnlUsd", label: pw("trd.result"), numeric: true, render: (row) => <span data-tone={toneOf(row.realizedPnlUsd)}>{money(row.realizedPnlUsd, true)}</span> },
      { key: "liquidity", label: pw("trd.role"), render: (row) => pw(row.liquidity === "maker" ? "trd.maker" : "trd.taker") },
    ],
    [pw, w, intl, when, money, cells],
  );

  const fundingColumns = useMemo<TableColumn<FuturesFundingEvent>[]>(
    () => [
      { key: "at", label: pw("fnd.time"), render: (row) => when(row.at) },
      { key: "symbol", label: pw("col.market"), render: (row) => cells.market(row) },
      {
        key: "amountUsd",
        label: pw("fnd.amount"),
        numeric: true,
        render: (row) => (
          <span data-tone={toneOf(row.amountUsd)}>{`${money(row.amountUsd, true)} · ${pw(row.amountUsd < 0 ? "fnd.paid" : "fnd.got")}`}</span>
        ),
      },
      { key: "ratePercent", label: pw("fnd.rate"), numeric: true, render: (row) => (row.ratePercent === null ? "—" : formatPercent(row.ratePercent, intl)) },
      { key: "positionUnits", label: pw("fnd.position"), numeric: true, render: (row) => (row.positionUnits === null ? "—" : `${formatAmount(row.positionUnits, intl)} ${row.symbol}`) },
    ],
    [pw, intl, when, money, cells],
  );

  const historyColumns = useMemo<TableColumn<FuturesOrderRecord>[]>(
    () => [
      { key: "at", label: pw("hst.time"), render: (row) => when(row.endedAt ?? row.placedAt) },
      { key: "symbol", label: pw("col.market"), render: (row) => cells.market(row) },
      { key: "side", label: pw("trd.side"), render: (row) => <span data-side={row.side === "buy" ? "long" : "short"}>{`${w(row.side)}${row.stop ? ` · ${w("stop")}` : ""}${row.reduceOnly ? ` · ${w("reduceOnly")}` : ""}`}</span> },
      { key: "priceUsd", label: pw("ord.price"), numeric: true, render: (row) => formatTerminalPrice(row.priceUsd, intl) },
      {
        key: "sizeUnits",
        /* Two figures that belong together on one line, as the positions table does: the panel keeps its columns whole. */
        label: `${pw("hst.filled")} / ${pw("trd.size")}`,
        numeric: true,
        render: (row) => (
          <span className={styles.stacked}>
            <span>{`${formatAmount(row.filledUnits, intl)} ${row.symbol}`}</span>
            <small>{formatAmount(row.sizeUnits, intl)}</small>
          </span>
        ),
      },
      { key: "status", label: pw("hst.status"), render: (row) => (STATUS_WORDS[row.status] ? pw(STATUS_WORDS[row.status]!) : row.status) },
    ],
    [pw, w, intl, when, cells],
  );

  /*
   * The same rows as cards wherever the table would not stand whole (PERP-6, spec §15): nothing on a phone scrolls
   * aside, so the dock's three histories read as cards there and as tables on a desk.
   */
  const historyCards = <T,>(rows: readonly T[], key: (row: T) => string, empty: string, head: (row: T) => ReactNode, facts: (row: T) => readonly Readonly<{ label: string; value: ReactNode }>[], label: string) => (
    <ul className={styles.cards} aria-label={label}>
      {rows.length === 0 ? <li className={styles.muted}>{empty}</li> : null}
      {rows.map((row) => (
        <li key={key(row)} className={styles.card}>
          <div className={styles.cardHead}>{head(row)}</div>
          <dl className={styles.cardFacts}>
            {facts(row).map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );

  const tradeCards = historyCards(
    trades.value?.trades ?? [],
    (row) => row.id,
    pw("trd.none"),
    (row) => (
      <>
        <span className={styles.stacked}>
          {cells.market(row)}
          <small data-side={row.side === "buy" ? "long" : "short"}>{`${w(row.side)} · ${pw(row.liquidity === "maker" ? "trd.maker" : "trd.taker")}`}</small>
        </span>
        <span data-tone={toneOf(row.realizedPnlUsd)} className={styles.pnl}>{money(row.realizedPnlUsd, true)}</span>
      </>
    ),
    (row) => [
      { label: pw("trd.time"), value: when(row.at) },
      { label: pw("trd.size"), value: `${formatAmount(row.sizeUnits, intl)} ${row.symbol}` },
      { label: pw("trd.price"), value: formatTerminalPrice(row.priceUsd, intl) },
      { label: pw("trd.fee"), value: money(row.feeUsd) },
    ],
    pw("panel.trades"),
  );

  const fundingCards = historyCards(
    fundingHistory.value?.events ?? [],
    (row) => `${row.symbol}:${row.at}`,
    pw("fnd.none"),
    (row) => (
      <>
        <span className={styles.stacked}>
          {cells.market(row)}
          <small>{pw(row.amountUsd < 0 ? "fnd.paid" : "fnd.got")}</small>
        </span>
        <span data-tone={toneOf(row.amountUsd)} className={styles.pnl}>{money(row.amountUsd, true)}</span>
      </>
    ),
    (row) => [
      { label: pw("fnd.time"), value: when(row.at) },
      { label: pw("fnd.rate"), value: row.ratePercent === null ? "—" : formatPercent(row.ratePercent, intl) },
      { label: pw("fnd.position"), value: row.positionUnits === null ? "—" : `${formatAmount(row.positionUnits, intl)} ${row.symbol}` },
    ],
    pw("panel.funding"),
  );

  const orderHistoryCards = historyCards(
    orderHistory.value?.orders ?? [],
    (row) => row.id,
    pw("hst.none"),
    (row) => (
      <>
        <span className={styles.stacked}>
          {cells.market(row)}
          <small data-side={row.side === "buy" ? "long" : "short"}>{`${w(row.side)}${row.stop ? ` · ${w("stop")}` : ""}${row.reduceOnly ? ` · ${w("reduceOnly")}` : ""}`}</small>
        </span>
        <span>{STATUS_WORDS[row.status] ? pw(STATUS_WORDS[row.status]!) : row.status}</span>
      </>
    ),
    (row) => [
      { label: pw("hst.time"), value: when(row.endedAt ?? row.placedAt) },
      { label: pw("ord.price"), value: formatTerminalPrice(row.priceUsd, intl) },
      { label: pw("trd.size"), value: `${formatAmount(row.sizeUnits, intl)} ${row.symbol}` },
      { label: pw("hst.filled"), value: `${formatAmount(row.filledUnits, intl)} ${row.symbol}` },
      { label: pw("hst.left"), value: `${formatAmount(row.leftUnits, intl)} ${row.symbol}` },
    ],
    pw("panel.history"),
  );

  const marketColumns = useMemo<TableColumn<FuturesMarket>[]>(
    () => [
      { key: "symbol", label: pw("col.market"), sortable: true, render: (row) => <span className={styles.symbol} translate="no">{row.symbol}</span> },
      { key: "markPrice", label: pw("col.price"), numeric: true, sortable: true, render: (row) => formatTerminalPrice(row.markPrice, intl) },
      {
        key: "change",
        label: pw("col.change"),
        numeric: true,
        sortable: true,
        sortValue: (row) => dayChange(row) ?? -Infinity,
        render: (row) => {
          const change = dayChange(row);
          return <span data-tone={toneOf(change === null ? null : change * 100)}>{formatPercent(change === null ? null : change * 100, intl)}</span>;
        },
      },
      { key: "dayVolumeUsd", label: pw("col.volume"), numeric: true, sortable: true, render: (row) => formatUsdCompact(row.dayVolumeUsd, intl) },
      { key: "maxLeverage", label: pw("col.leverage"), numeric: true, sortable: true, render: (row) => (row.maxLeverage === null ? "—" : `${formatAmount(row.maxLeverage, intl, 0)}×`) },
    ],
    [pw, intl],
  );

  /* The ticket's own node (see `TicketSlot`), made once in the browser. */
  const [ticketHome, setTicketHome] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = document.createElement("div");
    node.className = styles.ticketHome ?? "";
    setTicketHome(node);
  }, []);

  /* The order on a phone (spec §15): Long or Short opens it on a screen of its own, the side already chosen. */
  const [phoneTicket, setPhoneTicket] = useState(false);
  const [sidePick, setSidePick] = useState<Readonly<{ side: PerpSide; at: number }> | null>(null);
  const openPhoneTicket = useCallback((side: PerpSide) => {
    setIntent({ kind: "ticket" });
    setSidePick({ side, at: Date.now() });
    setPhoneTicket(true);
  }, []);
  /* A position's or an order's action pressed on a phone opens its form on the order's screen. */
  useEffect(() => {
    if (phone && intent.kind !== "ticket") setPhoneTicket(true);
  }, [phone, intent]);
  useEffect(() => {
    if (!phone) setPhoneTicket(false);
  }, [phone]);
  const [orderBusy, setOrderBusy] = useState(false);

  const failed = markets.failed && list.length === 0;
  const coin = symbol ?? "";
  const trade = !market ? "view" : market.status === "gated" ? "gated" : orderStates.open ? "open" : "view";

  const walletLine = <WalletGate title={pw("acc.connect")} />;
  const accountLoading = wallet !== null && (account.value === null || account.value.wallet !== wallet);
  const accountBody =
    wallet === null ? (
      walletLine
    ) : accountLoading ? (
      <p className={styles.muted} aria-busy={account.loading || undefined}>{account.failed ? w("unavailable") : w("loading")}</p>
    ) : !showCollateral ? (
      <EmptyState text={pw("acc.none")} />
    ) : (
      <CollateralPanel connection={connection} account={account.value} lang={lang} w={w} onHold={setCollateralHeld} folded stale={stale} pro={settings.mode === "pro"} onRiskAct={riskAct} />
    );
  const tableOrGate = (table: ReactNode) => (wallet === null ? walletLine : accountLoading ? <Skeleton lines={3} label={w("loading")} /> : !opened ? <EmptyState text={pw("acc.none")} /> : table);

  const panels: Readonly<Record<PerpsPanelId, Readonly<{ title: string; children: ReactNode }>>> = {
    chart: {
      title: pw("panel.chart"),
      children:
        feed && symbol ? (
          <RyntraChart
            key={symbol}
            source={feed.source}
            instrument={symbol}
            resolution={resolutionOf(timeframe)}
            onResolutionChange={(next) => {
              const tf = timeframeOf(next);
              if (tf) setTimeframe(tf);
            }}
            basis={LAST_BASIS}
            lang={lang}
            symbol={<span className={styles.symbol}>{symbol}-PERP</span>}
            label={`${symbol}-PERP · ${w("price")}`}
            marks={chartMarks}
            trading={chartTrading}
            telemetry={chartTelemetry}
            drawings={{ profile: null }}
            className={styles.coreChart}
          />
        ) : (
          <Skeleton lines={8} label={w("loading")} />
        ),
    },
    ticket: {
      title: pw("panel.ticket"),
      children: phone ? <PhoneTicketLauncher coin={coin} lang={lang} busy={orderBusy || intent.kind !== "ticket"} onOpen={openPhoneTicket} onResume={() => setPhoneTicket(true)} /> : <TicketSlot home={ticketHome} />,
    },
    book: { title: pw("panel.book"), children: <BookPanel feed={book.feed} coin={coin} markUsd={market?.markPrice ?? null} lang={lang} pro={settings.mode === "pro"} rates={scalpRates} onPick={(price) => setPricePick({ price, at: Date.now() })} /> },
    positions: {
      title: `${pw("panel.positions")}${positions.length ? ` · ${positions.length}` : ""}`,
      children: tableOrGate(
        <>
          {pnlSummary}
          <TableOrCards mode={settings.mode} cards={positionCards} table={<Table columns={positionColumns} rows={positions} rowKey={(row) => `${row.subaccount}:${row.symbol}`} caption={w("positionsCaption")} empty={pw("pos.none")} lang={lang} />} />
          <p className={styles.muted}>{pw("sum.note")}</p>
        </>,
      ),
    },
    orders: {
      title: `${pw("panel.orders")}${orders.length ? ` · ${orders.length}` : ""}`,
      children: tableOrGate(
        <>
          {cancelAllButton ? <div className={styles.panelActions}>{cancelAllButton}</div> : null}
          <TableOrCards mode={settings.mode} cards={orderCards} table={<Table columns={orderColumns} rows={orders} rowKey={(row) => row.id} caption={w("ordersCaption")} empty={pw("ord.none")} lang={lang} />} />
        </>,
      ),
    },
    trades: {
      title: pw("panel.trades"),
      children: tableOrGate(
        trades.failed && trades.value === null ? (
          <p className={styles.muted} role="status">{pw("hist.unavailable")}</p>
        ) : (
          <TableOrCards
            mode={settings.mode}
            cards={tradeCards}
            table={<Table columns={tradeColumns} rows={trades.value?.trades ?? []} rowKey={(row) => row.id} caption={pw("panel.trades")} empty={pw("trd.none")} maxHeight="100%" lang={lang} />}
          />
        ),
      ),
    },
    funding: {
      title: pw("panel.funding"),
      children: tableOrGate(
        fundingHistory.failed && fundingHistory.value === null ? (
          <p className={styles.muted} role="status">{pw("hist.unavailable")}</p>
        ) : (
          <>
            <TableOrCards
              mode={settings.mode}
              cards={fundingCards}
              table={<Table columns={fundingColumns} rows={fundingHistory.value?.events ?? []} rowKey={(row) => `${row.symbol}:${row.at}`} caption={pw("panel.funding")} empty={pw("fnd.none")} maxHeight="100%" lang={lang} />}
            />
            {fundingNote}
          </>
        ),
      ),
    },
    history: {
      title: pw("panel.history"),
      children: tableOrGate(
        orderHistory.failed && orderHistory.value === null ? (
          <p className={styles.muted} role="status">{pw("hist.unavailable")}</p>
        ) : (
          <TableOrCards
            mode={settings.mode}
            cards={orderHistoryCards}
            table={<Table columns={historyColumns} rows={orderHistory.value?.orders ?? []} rowKey={(row) => row.id} caption={pw("panel.history")} empty={pw("hst.none")} maxHeight="100%" lang={lang} />}
          />
        ),
      ),
    },
    account: { title: pw("panel.account"), children: <div className={styles.accountPanel}>{accountBody}</div> },
    markets: {
      title: pw("panel.markets"),
      children: (
        <Table
          columns={marketColumns}
          rows={list}
          rowKey={(row) => row.symbol}
          caption={w("marketsCaption")}
          onRowClick={(row) => choose(row.symbol)}
          rowProps={(row) => ({ "aria-current": row.symbol === symbol ? "true" : undefined, "data-current": row.symbol === symbol ? "" : undefined } as Record<string, string | undefined>)}
          rowLabel={(row) => `${row.symbol}-PERP`}
          maxHeight="100%"
          lang={lang}
        />
      ),
    },
  };

  return (
    <div
      className={styles.page}
      data-futures-page
      lang={lang}
      data-perps-mode-now={settings.mode}
      data-density={density}
      data-scale={settings.scale === 100 ? undefined : settings.scale}
      data-motion={settings.motion === "reduce" ? "reduce" : undefined}
      data-contrast={settings.contrast === "more" ? "more" : undefined}
      data-targets={largeTargets(settings, phone) ? "large" : undefined}
    >
      <h1 className="sr-only">{w("title")}</h1>
      {failed ? (
        <p className={styles.notice} role="status" data-futures-state="UNAVAILABLE">
          {w("unavailable")}
        </p>
      ) : markets.loading && list.length === 0 ? (
        <div data-futures-state="LOADING" aria-busy="true">
          <Skeleton lines={8} label={w("loading")} />
        </div>
      ) : list.length === 0 ? (
        <p className={styles.notice} role="status" data-futures-state="EMPTY">
          {w("noMarkets")}
        </p>
      ) : (
        <PerpsTerminal
          panels={panels}
          lang={lang}
          width={width}
          settings={settings}
          onSettings={setSettings}
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          onLang={setLocale}
          head={(tools) => <PerpsHeader markets={list} market={market} onChoose={choose} lang={lang} trade={trade} ordersState={ordersState} tools={tools} feed={markets.feed} funding={funding.failed ? null : funding.value} />} />
      )}
      {phone ? (
        <PhoneTicketScreen open={phoneTicket} coin={coin} lang={lang} onClose={() => setPhoneTicket(false)}>
          <TicketSlot home={ticketHome} />
        </PhoneTicketScreen>
      ) : null}
      {/* The one ticket, drawn into whichever place holds it now. */}
      {ticketHome && market
        ? createPortal(
            <OrderPanel
              connection={connection}
              states={orderStates}
              account={account.value}
              opened={opened}
              market={market}
              book={book.feed}
              lang={lang}
              intent={intent}
              onIntent={setIntent}
              onLevels={setDraftLevels}
              pricePick={pricePick}
              sidePick={sidePick}
              density={density}
              orderType={settings.orderType}
              onBusy={setOrderBusy}
              heldUnits={heldUnits}
              positionsValueUsd={positionsValueUsd}
              stale={staleSince}
            />,
            ticketHome,
          )
        : null}
    </div>
  );
}
