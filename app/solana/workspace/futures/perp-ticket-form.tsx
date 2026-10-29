"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Icon, formatBps, type BookSnapshot } from "@ryntra/core/ui";

import type { FuturesAccount, FuturesMarket } from "@/lib/phoenix/market-data";
import { LIMIT_TIFS, MARKET_TIFS, ticksFromUsd, tifOf, DEFAULT_LIMIT_TIF, DEFAULT_MARKET_TIF, type PerpUnits } from "@/lib/phoenix/orders-model";

import { ConnectWalletButton } from "../wallet-gate";
import { formatAmount, formatTerminalPrice, formatUsdMoney, priceDecimals } from "../spot/spot-format";

import {
  accountLeverageAfter,
  bookFill,
  decimalInput,
  freeCollateralUsd,
  legPriceOf,
  legResult,
  LEG_UNITS,
  leverageSteps,
  lotsOfUnits,
  maxUsdOfLots,
  onlyReduces,
  perpOrderOf,
  SDK_FRESH_MS,
  sdkCheck,
  sizeAtPercent,
  sizeUnitsOf,
  tierLeverage,
  type PerpDraft,
  type PerpOrder,
} from "./perp-order-model";
import { perpsWord, type PerpsWordKey } from "./perps-words";
import { useTrackOnce } from "./perps-telemetry";
import { pageClock, useTicketMargin, type TicketQuestion } from "./use-futures-data";

import styles from "./perps.module.css";

type Lang = "en" | "uk";

/** The asset's amount as the ticket's text: its lot's digits, trailing zeros only after a point — 1200 stays 1200. */
const coinText = (units: number, decimals: number) => {
  const text = units.toFixed(Math.max(0, decimals));
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
};

const SLIPPAGES = [10, 50, 100, 200] as const;
const SHARES = [25, 50, 75, 100] as const;

/** Why the action cannot be pressed now, in the order the person meets it; null — it can. */
export type TicketGate = "connect" | "closed" | "noAccount" | "gated" | "isolated" | null;

/** A wall-clock time as the reader's hours, minutes and seconds. */
const clockText = (at: number, intl: string) => new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(at);

/**
 * The Perps terminal's order ticket (PERP-2): the margin mode and the leverage on top, market or limit, long or short,
 * the size in USD or in the asset with the share of what the collateral allows at that leverage, reduce-only and
 * TP/SL; under them what the order is before the Review — its value, the margin it takes, the account's leverage
 * after, the liquidation price and the fees — and one action. The margin, the most and the liquidation are Phoenix's
 * own SDK's (PERP-4, `/api/solana/futures/ticket`), never a formula of Ryntra's; while the market's data does not
 * update, an order that adds risk waits and one that only cuts goes on. The core's ticket parts
 * (`ryntra-ticket__*`), so it reads as every ticket of Ryntra does; the perpetual's own fields are its own.
 *
 * Controlled: the draft and the leverage live with the panel, so a Review that is closed brings back what was typed.
 */
export function PerpTicketForm({
  market,
  units,
  draft,
  onDraft,
  leverage,
  onLeverage,
  account,
  wallet,
  opened,
  stale,
  maxNotionalUsd,
  builder,
  builderBps,
  book,
  bookFresh,
  heldUnits,
  positionsValueUsd,
  gate,
  busy,
  lang,
  density = "compact",
  onLegs,
  onReview,
}: {
  market: FuturesMarket;
  units: PerpUnits;
  draft: PerpDraft;
  onDraft: (next: PerpDraft) => void;
  leverage: number;
  onLeverage: (next: number) => void;
  account: FuturesAccount | null;
  /** The wallet the figures are the account of. */
  wallet: string | null;
  opened: boolean;
  /** The market's data stopped updating: the time of its last update (null — never came). Null — it is live. */
  stale: Readonly<{ updatedAt: number | null }> | null;
  /** The first check's ceiling on a new position's value, when the gate is a canary. */
  maxNotionalUsd: number | null;
  /** Whether Ryntra's builder rides on the orders, and its fee as the chain holds it (null — not read). */
  builder: boolean;
  builderBps: number | null;
  book: BookSnapshot | null;
  /** Whether the book is fresh enough to count a market order's fill from. */
  bookFresh: boolean;
  /** The position held on this market (subaccount 0), signed. */
  heldUnits: number;
  /** Every position's value at its mark, for the account's leverage after. */
  positionsValueUsd: number;
  gate: TicketGate;
  busy: boolean;
  lang: Lang;
  /** The core's density (PERP-6): Pro's compact, Simple's regular — the same fields and the same action. */
  density?: "regular" | "compact";
  /**
   * The prices the TP/SL come to, whichever of the three units they were typed in — the same figures the order will
   * carry, so the chart draws what is sent (PERP-5). Null where nothing is set.
   */
  onLegs?: (legs: Readonly<{ tp: number | null; sl: number | null }>) => void;
  onReview: (order: PerpOrder) => void;
}) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: PerpsWordKey, fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill);
  const coin = market.symbol;
  const mark = market.markPrice;
  const decimals = priceDecimals(mark);
  const set = (patch: Partial<PerpDraft>) => onDraft({ ...draft, ...patch });
  const pct = (value: number, digits = 2) => `${formatAmount(value, intl, digits)}${lang === "en" ? "%" : " %"}`;
  const rate = (bps: number) => pct(bps / 100, 4);

  /* The figures the size is counted from: the limit's price, else the mark; the free collateral; the most at the leverage —
     by the SDK, never above the tier a position of that size falls in. */
  const limit = draft.type === "limit";
  const typedPrice = limit ? decimalInput(draft.price) : null;
  const countPrice = limit ? (typedPrice === null ? null : Number(typedPrice)) : mark;
  const margin = account?.margin ?? null;
  /* Ryntra's fee: none without a builder; unknown — never «0» — when there is one and the chain was not read. */
  const ryntraKnown = !builder || builderBps !== null;
  const ryntraRate = builder && builderBps !== null && builderBps > 0 ? builderBps / 10_000 : 0;
  const takerRate = market.takerRate ?? null;
  /* The fees come out of the same collateral: Phoenix's taker rate and Ryntra's, when it is known. */
  const feeRate = (takerRate ?? 0) + ryntraRate;

  /* The question to the SDK: everything but the size first (the most), then the size as lots when one is typed. */
  const limitTicks = limit && typedPrice !== null && draft.side !== null ? ticksFromUsd(typedPrice, units, draft.side === "long" ? "floor" : "ceil") : null;
  const typedUnits = sizeUnitsOf(draft, countPrice);
  const typedLots = typedUnits === null ? null : lotsOfUnits(typedUnits, units);
  const question: TicketQuestion | null =
    opened && wallet && draft.side !== null && gate !== "isolated" && (!limit || limitTicks !== null)
      ? {
          wallet,
          symbol: market.symbol,
          side: draft.side,
          type: draft.type,
          leverage,
          slippageBps: draft.slippageBps,
          feeBps: feeRate * 10_000,
          sizeLots: typedLots === null ? null : typedLots.toString(),
          limitTicks: limitTicks === null ? null : limitTicks.toString(),
          reduceOnly: draft.reduceOnly,
          /* The book moves every two seconds: the SDK counts the fill at the mark, so the question stands while the book moves. */
          fillTicks: null,
        }
      : null;
  const sdk = useTicketMargin(question);
  /* The SDK's figures count only while they are fresh and the market's data is live: an old answer is never shown as now. */
  const sdkAge = sdk.figuresAt === null ? null : pageClock() - sdk.figuresAt;
  const sdkFresh = !sdk.failed && stale === null && sdk.figures !== null && sdkAge !== null && sdkAge <= SDK_FRESH_MS;
  /* What new orders may take: the SDK's free margin, Phoenix's own view of it until the SDK answers. */
  const free = !opened ? null : sdk.account ? sdk.account.availableUsd : freeCollateralUsd(margin);
  /* The most only from a live answer: never an old one after the reads failed or the data went quiet. */
  const maxUsd = draft.reduceOnly || sdk.failed || stale !== null ? null : maxUsdOfLots(sdk.maxLots, units, countPrice, maxNotionalUsd, draft.slippageBps);

  const best = useMemo(() => ({ bid: book?.bids[0]?.price ?? null, ask: book?.asks[0]?.price ?? null }), [book]);
  /* Built in two passes: the first gives the size a leg's share of the margin is counted on, the second the order. */
  const shared = { units, markUsd: mark, maxUsd, heldUnits, ceilingUsd: draft.reduceOnly ? null : maxNotionalUsd, best: bookFresh ? best : null } as const;
  const sized = perpOrderOf({ ...shared, draft: draft.tpsl ? { ...draft, tpsl: false } : draft });
  const sizeUnits = sized && "order" in sized ? sized.sizeUnits : typedUnits;
  const signed = sizeUnits === null || draft.side === null ? null : draft.side === "long" ? sizeUnits : -sizeUnits;
  /* A market order's fill from the book while it is fresh; a book that stopped coming fills nothing here. */
  const fill = !limit && sizeUnits !== null && draft.side !== null && bookFresh ? bookFill(draft.side, sizeUnits, book) : null;
  const fillUsd = fill && fill !== "thin" ? fill.averageUsd : countPrice;
  const valueUsd = sizeUnits !== null && fillUsd !== null ? sizeUnits * fillUsd : null;
  const reduces = draft.reduceOnly || (signed !== null && onlyReduces(heldUnits, signed));
  /* The leverage Phoenix holds the position's margin at: its tier's, whatever leverage sized the order. */
  const tier = signed === null ? null : tierLeverage(market, heldUnits + signed);
  /* A leg set as a share of the margin or as dollars is counted on the price the order would fill at and the margin
     Phoenix holds — the same two figures the hint under the field shows, so screen and packet never differ. */
  const legEntryUsd = fillUsd;
  const legLeverage = tier ?? leverage;
  const made = perpOrderOf({ ...shared, draft, legEntryUsd, legLeverage });
  const feesUsd = !limit && valueUsd !== null && takerRate !== null ? valueUsd * (takerRate + ryntraRate) : null;
  /* The SDK's figures for this very size: the margin Phoenix holds, the liquidation after, whether it is carried. */
  const figures = sdkFresh ? (sdk.figures?.order ?? null) : null;
  const liquidation = figures?.liquidation ?? null;
  const marginUsd = reduces ? null : (figures?.marginUsd ?? null);
  const leverageAfter = signed !== null && mark !== null ? accountLeverageAfter(positionsValueUsd, heldUnits, signed, mark, margin?.portfolioUsd ?? null) : null;
  /* Phoenix refuses an order the collateral cannot carry with its fees: said here, before anything is built. */
  const carried = reduces || figures === null ? true : figures.carried;
  /* While the market's data does not update, new risk waits; a cut goes on (spec §7, §16). */
  const staleBlock = stale !== null && !reduces;
  /* New risk goes to Review only once the SDK has checked this very size: never on a check that has not come or failed. */
  const check = sdkCheck({ addsRisk: !reduces && made !== null && "order" in made, failed: sdk.failed, answered: sdk.figures !== null, hasOrder: sdk.figures?.order != null, ageMs: sdkAge });
  const unchecked = check === "ok" ? null : check;
  /*
   * A book that cannot fill the whole size stops a fill-or-kill — it would fill nothing — but not an
   * immediate-or-cancel, which exists to take what there is. For it the thin book is a note, not a block, and the
   * server allows the part too.
   */
  const partial = draft.type === "market" && tifOf(draft.type, draft.tif) === "ioc";
  const thin = fill === "thin";
  const thinBlocks = thin && !partial;
  const block = made && "block" in made ? made.block : thinBlocks ? "thin" : staleBlock ? "STALE" : (unchecked ?? (!carried ? "MARGIN" : null));
  /* Telemetry (spec §18): a risk warning the person sees — the collateral not carrying the order, a liquidation within a tenth of the mark. */
  const nearLiquidation = liquidation?.kind === "price" && mark !== null && Math.abs(liquidation.priceUsd - mark) / mark < 0.1;
  useTrackOnce(block === "MARGIN", "risk_warning_shown", market.symbol, "margin", lang);
  useTrackOnce(nearLiquidation, "risk_warning_shown", market.symbol, "liquidation", lang);
  const order = made && "order" in made && !thinBlocks && carried && !staleBlock && unchecked === null ? made.order : null;

  /* The slider shows the share the size is of the most now — whatever moved since: the price, the collateral, the leverage. */
  const share = valueUsd !== null && maxUsd !== null && maxUsd > 0 ? Math.min(100, Math.max(0, (valueUsd / maxUsd) * 100)) : 0;
  const setShare = (percent: number) => onDraft({ ...draft, percent, size: sizeAtPercent(percent, maxUsd, countPrice, draft.unit, units) });
  /* A new leverage keeps the share the slider set, at the new most. */
  const lastLeverage = useRef(leverage);
  useEffect(() => {
    if (lastLeverage.current === leverage) return;
    lastLeverage.current = leverage;
    if (draft.percent !== null) onDraft({ ...draft, size: sizeAtPercent(draft.percent, maxUsd, countPrice, draft.unit, units) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leverage]);
  /* Another unit keeps the size: what was typed in USD becomes the asset at the counted price, and back. */
  const switchUnit = (unit: "usd" | "coin") => {
    if (unit === draft.unit) return;
    const size = sizeUnits === null || countPrice === null ? "" : unit === "coin" ? coinText(sizeUnits, units.baseLotsDecimals) : (Math.floor(sizeUnits * countPrice * 100) / 100).toFixed(2);
    onDraft({ ...draft, unit, size });
  };

  const mid = best.bid !== null && best.ask !== null ? (best.bid + best.ask) / 2 : mark;
  const plainPrice = (value: number | null) => (value === null ? "" : value.toFixed(decimals));

  /* Pro is the compact density (decision 64: one terminal at another depth): the time in force shows there. */
  const pro = density === "compact";
  const tif = tifOf(draft.type, draft.tif);
  /* Simple does not show the choice, so it does not carry one: a post-only or IOC picked in Pro goes back to the
     type's own when the terminal is read at Simple's depth — never sent where it cannot be seen or changed. */
  useEffect(() => {
    if (pro) return;
    const own = draft.type === "market" ? DEFAULT_MARKET_TIF : DEFAULT_LIMIT_TIF;
    if (draft.tif !== own) onDraft({ ...draft, tif: own });
    // `busy` is a dependency on purpose: while a Review is being prepared `onDraft` does nothing, so the reset is
    // retried the moment the ticket is free again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pro, busy, draft.type, draft.tif]);
  const legSymbol = draft.legUnit === "price" ? "USD" : draft.legUnit === "percent" ? "%" : "USDC";

  const [leverageOpen, setLeverageOpen] = useState(false);
  const maxLeverage = market.maxLeverage;
  const steps = leverageSteps(maxLeverage);

  const ryntraWord = !builder ? rate(0) : builderBps === null ? w("liquidationReview") : rate(builderBps);
  const staleSince = stale?.updatedAt == null ? null : clockText(stale.updatedAt, intl);

  /**
   * What a leg's typed figure comes to: its price (whatever of the three units it was typed in), and the result on the
   * position in dollars and as a share of the margin Phoenix holds — its tier's leverage, so the share is of what the
   * position really takes.
   */
  /** The price a leg's typed figure comes to, in whichever of the three units it was typed; null when there is none. */
  const legPrice = (leg: "tp" | "sl", text: string): number | null => {
    const value = decimalInput(text);
    if (value === null || sizeUnits === null || legEntryUsd === null || draft.side === null) return null;
    return legPriceOf({ leg, side: draft.side, unit: draft.legUnit, value: Number(value), entryUsd: legEntryUsd, sizeUnits, leverage: legLeverage });
  };
  /* The chart draws the prices the order will carry, not the figures typed in another unit (PERP-5). */
  const drawnLegs = useMemo(
    () => ({ tp: draft.tpsl && !limit && !draft.reduceOnly ? legPrice("tp", draft.tp) : null, sl: draft.tpsl && !limit && !draft.reduceOnly ? legPrice("sl", draft.sl) : null }),
    // The figures the prices are counted from are the dependencies; `legPrice` closes over them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.tpsl, draft.tp, draft.sl, draft.legUnit, draft.side, limit, draft.reduceOnly, sizeUnits, legEntryUsd, legLeverage],
  );
  useEffect(() => {
    onLegs?.(drawnLegs);
  }, [onLegs, drawnLegs]);

  const legHint = (leg: "tp" | "sl", text: string) => {
    const legUsd = legPrice(leg, text);
    if (legUsd === null || sizeUnits === null || legEntryUsd === null || draft.side === null) return null;
    const result = legResult(draft.side, legEntryUsd, legUsd, sizeUnits, legLeverage);
    const money = `≈ ${result.usd >= 0 ? "+" : "−"}${formatUsdMoney(Math.abs(result.usd), intl)}`;
    const share = `${result.percent >= 0 ? "+" : "−"}${pct(Math.abs(result.percent), 1)}`;
    return draft.legUnit === "price" ? w("legResult", { usd: money, pct: share }) : w("legResultAt", { price: formatTerminalPrice(legUsd, intl, decimals), usd: money, pct: share });
  };

  const actionWord =
    gate === null && draft.side === null
      ? w("action.pickSide")
      : gate === null && staleBlock
      ? w("action.stale")
      : gate === "closed"
      ? w("action.closed")
      : gate === "noAccount"
        ? w("action.noAccount")
        : gate === "gated"
          ? w("action.gated")
          : gate === "isolated"
            ? w("action.isolated")
            : busy
              ? w("action.preparing")
              : draft.reduceOnly
                ? w("action.reduce", { coin })
                : w(draft.side === "long" ? "action.long" : "action.short", { coin });

  return (
    <form
      className={`ryntra-ticket ${styles.ticket}`}
      data-density={density}
      data-perp-ticket
      data-perp-now={draft.side ?? "none"}
      data-perp-stale={stale ? "" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (order && gate === null && !busy) onReview(order);
      }}
    >
      {/* Market or limit, then the margin mode and the leverage — what every perpetual's ticket opens with, in one row. */}
      <div className={styles.modeRow} data-dense>
        <fieldset className={`ryntra-ticket__seg ${styles.types}`} aria-label={`${w("market")} / ${w("limit")}`}>
          {(["market", "limit"] as const).map((type) => (
            <label key={type} className="ryntra-ticket__seg-option">
              <input
                type="radio"
                name="perp-type"
                checked={draft.type === type}
                onChange={() => set({ type, tif: type === "market" ? DEFAULT_MARKET_TIF : DEFAULT_LIMIT_TIF, percent: null, ...(type === "limit" && draft.price === "" ? { price: plainPrice(mid) } : {}) })}
              />
              <span className="ryntra-ticket__seg-word">{w(type)}</span>
            </label>
          ))}
        </fieldset>
        <span className={styles.modeChip} title={w("crossHint")} data-perp-margin="cross">
          {w("cross")}
        </span>
        <button type="button" className={styles.leverageChip} aria-expanded={leverageOpen} aria-label={`${w("leverage")} ${leverage}×`} onClick={() => setLeverageOpen((open) => !open)} data-perp-leverage>
          {`${leverage}×`}
          <Icon name="chevron-down" size={14} />
        </button>
      </div>
      {leverageOpen ? (
        <div className={styles.leveragePanel} role="group" aria-label={w("leverageTitle", { coin })} data-perp-leverage-panel>
          <div className={styles.leverageHead}>
            <b>{w("leverageTitle", { coin })}</b>
            <span className={styles.leverageValue}>{`${leverage}×`}</span>
          </div>
          <input
            type="range"
            className="ryntra-ticket__range"
            min={1}
            max={Math.max(1, Math.floor(maxLeverage ?? 1))}
            step={1}
            value={leverage}
            onChange={(event) => onLeverage(Number(event.target.value))}
            aria-label={w("leverage")}
            style={{ ["--ticket-share" as string]: `${((leverage - 1) / Math.max(1, Math.floor(maxLeverage ?? 1) - 1)) * 100}%` }}
          />
          <div className={`ryntra-ticket__chips ${styles.steps}`}>
            {steps.map((step) => (
              <button key={step} type="button" className="ryntra-ticket__chip" aria-pressed={leverage === step} onClick={() => onLeverage(step)}>
                {`${step}×`}
              </button>
            ))}
          </div>
          <p className="ryntra-ticket__hint">{w("leverageHint", { x: formatAmount(maxLeverage, intl, 0) })}</p>
          <Button variant="secondary" lang={lang} onClick={() => setLeverageOpen(false)}>
            {w("leverageApply")}
          </Button>
        </div>
      ) : null}

      {/* Long or short: neither is chosen for the person (spec §9) — until one is, the action says which to pick. */}
      <fieldset className={`ryntra-ticket__seg ${styles.sides}`} aria-label={`${w("long")} / ${w("short")}`} data-perp-sides={draft.side ?? "none"}>
        {(["long", "short"] as const).map((side) => (
          <label key={side} className="ryntra-ticket__seg-option" data-tone={side === "long" ? "up" : "down"}>
            <input type="radio" name="perp-side" checked={draft.side === side} onChange={() => set({ side })} data-perp-side={side} />
            <span className="ryntra-ticket__seg-word">{w(side)}</span>
          </label>
        ))}
      </fieldset>
      {pro ? (
        /* Pro: how long the order stands, within what Phoenix's SDK has — each with one sentence of what it does. */
        <div className={styles.tifRow} data-perp-tif-row>
          <fieldset className="ryntra-ticket__seg" aria-label={w("tif")}>
            {(limit ? LIMIT_TIFS : MARKET_TIFS).map((value) => (
              <label key={value} className="ryntra-ticket__seg-option">
                <input type="radio" name="perp-tif" checked={tif === value} onChange={() => set({ tif: value })} data-perp-tif={value} />
                <span className="ryntra-ticket__seg-word">{w(`tif.${value}` as PerpsWordKey)}</span>
              </label>
            ))}
          </fieldset>
          <p className="ryntra-ticket__hint" data-perp-tif-note={tif}>
            {w(`tifNote.${tif}` as PerpsWordKey)}
          </p>
        </div>
      ) : null}

      <dl className={styles.available}>
        <dt>{w("available")}</dt>
        <dd data-perp-available>{free === null ? "—" : `${formatAmount(free, intl, 2)} USDC`}</dd>
      </dl>

      {limit ? (
        <div className="ryntra-ticket__field">
          <div className="ryntra-ticket__field-head">
            <span>{`${w("price")}, USD`}</span>
            <span className={styles.priceChips}>
              <button type="button" className="ryntra-ticket__chip" onClick={() => set({ price: plainPrice(best.bid) })} disabled={best.bid === null} title={w("bestBidHint")} data-perp-best="bid">
                {w("bestBid")}
              </button>
              <button type="button" className="ryntra-ticket__chip" onClick={() => set({ price: plainPrice(mid) })} disabled={mid === null}>
                {w("mid")}
              </button>
              <button type="button" className="ryntra-ticket__chip" onClick={() => set({ price: plainPrice(best.ask) })} disabled={best.ask === null} title={w("bestAskHint")} data-perp-best="ask">
                {w("bestAsk")}
              </button>
            </span>
          </div>
          <div className={`ryntra-ticket__price${block === "PRICE" ? " ryntra-ticket__price--error" : ""}`}>
            <input className="ryntra-ticket__price-input" inputMode="decimal" autoComplete="off" placeholder={plainPrice(mark)} value={draft.price} onChange={(event) => set({ price: event.target.value })} aria-label={w("price")} aria-invalid={block === "PRICE" || undefined} data-perp-price />
            <span className="ryntra-ticket__symbol">USD</span>
          </div>
        </div>
      ) : null}

      <div className="ryntra-ticket__field">
        <div className="ryntra-ticket__field-head">
          <span>{w("size")}</span>
          <fieldset className="ryntra-ticket__seg" aria-label={w("size")}>
            {(["usd", "coin"] as const).map((unit) => (
              <label key={unit} className="ryntra-ticket__seg-option">
                <input type="radio" name="perp-unit" checked={draft.unit === unit} onChange={() => switchUnit(unit)} />
                <span className="ryntra-ticket__seg-word">{unit === "usd" ? "USD" : coin}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className={`ryntra-ticket__amount${block === "SIZE" || block === "OVER_MAX" ? " ryntra-ticket__amount--error" : ""}`}>
          <input className="ryntra-ticket__input" inputMode="decimal" autoComplete="off" placeholder="0" value={draft.size} onChange={(event) => set({ size: event.target.value, percent: null })} aria-label={w("size")} data-perp-size />
          <span className="ryntra-ticket__symbol">{draft.unit === "usd" ? "USD" : coin}</span>
        </div>
        <p className="ryntra-ticket__sub">
          <span>{sizeUnits === null ? "—" : `${formatAmount(sizeUnits, intl, 6)} ${coin}`}</span>
          <span>{valueUsd === null ? "" : formatUsdMoney(valueUsd, intl)}</span>
        </p>
        <div className="ryntra-ticket__share">
          <input
            type="range"
            className="ryntra-ticket__range"
            min={0}
            max={100}
            step={1}
            value={Math.round(share)}
            disabled={maxUsd === null}
            onChange={(event) => setShare(Number(event.target.value))}
            aria-label={`${w("size")} %`}
            style={{ ["--ticket-share" as string]: `${share}%` }}
            data-perp-share
          />
          <span className="ryntra-ticket__share-value">{pct(Math.round(share), 0)}</span>
        </div>
        <div className={styles.shares} data-dense>
          {SHARES.map((value) => (
            <button key={value} type="button" aria-pressed={draft.percent === value} disabled={maxUsd === null} onClick={() => setShare(value)}>
              {pct(value, 0)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.toggles}>
        <label className={styles.check}>
          <input type="checkbox" checked={draft.reduceOnly} onChange={(event) => set({ reduceOnly: event.target.checked, percent: null, ...(event.target.checked ? { tpsl: false } : {}) })} data-perp-reduce-only />
          <span>{w("reduceOnly")}</span>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={draft.tpsl} disabled={limit || draft.reduceOnly} onChange={(event) => set({ tpsl: event.target.checked })} data-perp-tpsl />
          <span>{w("tpsl")}</span>
        </label>
      </div>

      {draft.tpsl && !limit && !draft.reduceOnly ? (
        <div className={styles.legs} data-perp-legs>
          <div className={styles.legUnits}>
            <fieldset className="ryntra-ticket__seg" aria-label={w("legUnit")}>
              {LEG_UNITS.map((unit) => (
                <label key={unit} className="ryntra-ticket__seg-option">
                  <input type="radio" name="perp-leg-unit" checked={draft.legUnit === unit} onChange={() => set({ legUnit: unit, tp: "", sl: "" })} data-perp-leg-unit={unit} />
                  <span className="ryntra-ticket__seg-word">{unit === "price" ? "USD" : unit === "percent" ? "%" : "USDC"}</span>
                </label>
              ))}
            </fieldset>
            <span className="ryntra-ticket__hint">{w(`legUnitNote.${draft.legUnit}` as PerpsWordKey)}</span>
          </div>
          {(["tp", "sl"] as const).map((leg) => {
            const value = draft[leg];
            const hint = legHint(leg, value);
            const wrong = block === (leg === "tp" ? "TP" : "SL") || block === (leg === "tp" ? "TP_SIDE" : "SL_SIDE");
            return (
              <div key={leg} className={styles.leg}>
                <span className={styles.legLabel}>{w(leg)}</span>
                <div className={`ryntra-ticket__price${wrong ? " ryntra-ticket__price--error" : ""}`}>
                  <input className="ryntra-ticket__price-input" inputMode="decimal" autoComplete="off" placeholder="—" value={value} onChange={(event) => set({ [leg]: event.target.value } as Partial<PerpDraft>)} aria-label={w(leg)} aria-invalid={wrong || undefined} data-perp-leg={leg} />
                  <span className="ryntra-ticket__symbol">{legSymbol}</span>
                </div>
                <span className={styles.legHint} data-tone={hint === null ? undefined : leg === "tp" ? "up" : "down"}>
                  {hint ?? ""}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <dl className="ryntra-ticket__summary" data-perp-summary>
        <div className={`ryntra-ticket__row${nearLiquidation ? " ryntra-ticket__row--down" : ""}`}>
          <dt title={w("liquidationNote")}>{w("liquidation")}</dt>
          <dd data-perp-liquidation aria-busy={sdk.loading || undefined}>
            {liquidation === null
              ? signed === null || sdk.loading || !sdkFresh
                ? "—"
                : w("liquidationReview")
              : liquidation.kind === "price"
                ? `≈ ${formatTerminalPrice(liquidation.priceUsd, intl, decimals)}`
                : liquidation.kind === "none"
                  ? w("liquidationNone")
                  : w("liquidationReview")}
          </dd>
        </div>
        <div className="ryntra-ticket__row">
          <dt>{w("value")}</dt>
          <dd>{valueUsd === null ? "—" : `${limit ? "" : "≈ "}${formatUsdMoney(valueUsd, intl)}`}</dd>
        </div>
        {!reduces ? (
          <div className="ryntra-ticket__row">
            <dt title={w("marginNote")}>{w("margin")}</dt>
            <dd data-perp-margin-usd>{marginUsd === null ? "—" : `≈ ${formatUsdMoney(marginUsd, intl)}`}</dd>
          </div>
        ) : null}
        <div className="ryntra-ticket__row">
          <dt>{w("accountLeverage")}</dt>
          <dd>{leverageAfter === null ? "—" : `${formatAmount(leverageAfter, intl, 2)}×`}</dd>
        </div>
        <div className="ryntra-ticket__row">
          <dt>{w("fees")}</dt>
          <dd title={limit ? w("feesLimit", { maker: market.makerRate == null ? "—" : rate(market.makerRate * 10_000), taker: takerRate === null ? "—" : rate(takerRate * 10_000), ryntra: ryntraWord }) : w("feesRates", { phoenix: takerRate === null ? "—" : rate(takerRate * 10_000), ryntra: ryntraWord })} data-perp-fees>
            {limit
              ? w("feesLimitShort", { maker: market.makerRate == null ? "—" : rate(market.makerRate * 10_000), taker: takerRate === null ? "—" : rate(takerRate * 10_000), ryntra: ryntraWord })
              : `${feesUsd === null || !ryntraKnown ? "" : `${w("feesMarket", { x: formatAmount(feesUsd, intl, 4) })} · `}${takerRate === null ? "—" : rate(takerRate * 10_000)} + ${ryntraWord}`}
          </dd>
        </div>
      </dl>

      {!limit ? (
        <details className="ryntra-ticket__settings">
          <summary>
            <span>{w("slippage")}</span>
            <span className="ryntra-ticket__hint">{formatBps(draft.slippageBps, lang)}</span>
            <Icon name="chevron-down" size={16} className="ryntra-ticket__chevron" />
          </summary>
          <div className="ryntra-ticket__settings-body">
            <div className="ryntra-ticket__chips">
              {SLIPPAGES.map((bps) => (
                <button key={bps} type="button" className="ryntra-ticket__chip" aria-pressed={draft.slippageBps === bps} onClick={() => set({ slippageBps: bps })}>
                  {formatBps(bps, lang)}
                </button>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      <div className="ryntra-ticket__action">
        {block ? (
          <p className="ryntra-ticket__note" role="status" data-perp-block={block}>
            <Icon name="triangle-alert" size={14} />
            {block === "STALE" ? w(staleSince ? "block.STALE_AT" : "block.STALE", { at: staleSince ?? "" }) : w(`block.${block}` as PerpsWordKey)}
          </p>
        ) : thin ? (
          /* An immediate-or-cancel may go on a thin book: the note says what it will leave behind, and nothing stops. */
          <p className="ryntra-ticket__note" role="status" data-perp-note="thinIoc">
            <Icon name="triangle-alert" size={14} />
            {w("note.thinIoc")}
          </p>
        ) : null}
        {gate === "connect" ? (
          <ConnectWalletButton block />
        ) : (
          <Button type="submit" variant="primary" block lang={lang} loading={busy} disabled={gate !== null || busy || order === null} data-perp-action>
            {actionWord}
          </Button>
        )}
      </div>
    </form>
  );
}
