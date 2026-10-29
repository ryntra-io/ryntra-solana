"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "@ryntra/core/ui";

import { HonestStateChip } from "@/app/shell/honest-state-chip";
import type { HonestState } from "@/lib/core/authority-matrix";
import { feedStale, type FeedState } from "@/lib/phoenix/feed-lifecycle";
import { FUTURES_GROUPS, dayChange, fundingPayer, markIndexGap, marketMatches, stateOf, symbolKey, type FuturesFunding, type FuturesGroup, type FuturesMarket } from "@/lib/phoenix/market-data";

import { formatAmount, formatPercent, formatTerminalPrice, formatUsdCompact, toneOf } from "../spot/spot-format";

import { perpsWord, type PerpsWordKey } from "./perps-words";

import styles from "./perps.module.css";

type Lang = "en" | "uk";

const FAVORITES_KEY = "ryntra.perps.favorites.v1";

/** The markets a person starred, kept in this browser by symbol; starring changes no order. */
export function useFavorites(): [ReadonlySet<string>, (symbol: string) => void] {
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) setKept(new Set(stored.filter((entry): entry is string => typeof entry === "string").slice(0, 200)));
    } catch {
      /* A denied or broken store keeps none. */
    }
  }, []);
  const toggle = useCallback((symbol: string) => {
    setKept((current) => {
      const next = new Set(current);
      const key = symbolKey(symbol);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {
        /* Nothing to keep. */
      }
      return next;
    });
  }, []);
  return [kept, toggle];
}

/** The picker's groups: all, the favorites, then the catalog's groups that have a market. */
type PickerGroup = "all" | "favorites" | FuturesGroup;

/** A wall-clock time as the reader's hours, minutes and seconds. */
const clockText = (at: number, intl: string) => new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(at);
const clockShort = (at: number, intl: string) => new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit" }).format(at);

/**
 * The market's head (PERP-2, PERP-4): the market's name with its leverage — pressed, every Phoenix market with its
 * price, day and volume, found by typing its symbol or Phoenix's name for it, in the catalog's groups and the person's
 * favorites — the mark price large, then the index and the mark's signed gap to it, the funding rate with who pays and
 * the next settlement, the day's change, its volume and the highest leverage (the open interest waits for a live read
 * that fixes what Phoenix counts in it); where the market stands — trading, its underlying closed, priced by Phoenix
 * itself, paused — and, when Phoenix's prices stop coming, «Дані не оновлюються» with the time of the last update;
 * whether trading is open here; the layout's menu at the end. One line on a desk. Before «whether trading is open»,
 * Phoenix orders' honest state from the authority matrix (EXE-1), as a word.
 */
export function PerpsHeader({
  markets,
  market,
  onChoose,
  lang,
  trade,
  ordersState,
  tools,
  feed,
  funding,
}: {
  markets: readonly FuturesMarket[];
  market: FuturesMarket | null;
  onChoose: (symbol: string) => void;
  lang: Lang;
  trade: "open" | "view" | "gated";
  ordersState?: HonestState;
  tools?: ReactNode;
  /** The markets' life: stale says «Дані не оновлюються» with the last update's time. */
  feed?: FeedState;
  /** The market's funding rate now; null — none read, or none recent. */
  funding?: FuturesFunding | null;
}) {
  const intl = lang === "uk" ? "uk-UA" : "en-US";
  const w = (key: PerpsWordKey, fill?: Readonly<Record<string, string>>) => perpsWord(lang, key, fill);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<PickerGroup>("all");
  const [favorites, toggleFavorite] = useFavorites();
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        opener.current?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !opener.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  /* The catalog's groups that have a market: a group of none is not offered. */
  const groups = useMemo<PickerGroup[]>(() => ["all", "favorites", ...FUTURES_GROUPS.filter((entry) => markets.some((each) => each.group === entry))], [markets]);
  const found = useMemo(
    () =>
      markets.filter(
        (entry) => marketMatches(entry, query) && (group === "all" || (group === "favorites" ? favorites.has(symbolKey(entry.symbol)) : entry.group === group)),
      ),
    [markets, query, group, favorites],
  );

  const stale = feed ? feedStale(feed) : false;
  const staleAt = stale && feed?.updatedAt != null ? clockText(feed.updatedAt, intl) : null;
  const state = market ? stateOf(market) : "trading";
  const change = market ? dayChange(market) : null;
  const tone = stale ? undefined : toneOf(change === null ? null : change * 100);
  const gap = market ? markIndexGap(market) : null;
  const signedUsd = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatTerminalPrice(Math.abs(value), intl)}`;
  const signedPct = (fraction: number, digits: number) => `${fraction > 0 ? "+" : fraction < 0 ? "−" : ""}${formatAmount(Math.abs(fraction) * 100, intl, digits)}${lang === "en" ? "%" : " %"}`;
  /* The funding rate as Phoenix states it, for its period; who pays only where the mark's side of the index agrees. */
  const own = funding && market && symbolKey(funding.symbol) === symbolKey(market.symbol) ? funding : null;
  const period = own?.periodSeconds ?? market?.fundingIntervalSeconds ?? null;
  const periodWord = period === null ? null : period === 3_600 ? w("head.hour") : w("head.hours", { n: formatAmount(period / 3_600, intl, 1) });
  const payer = own ? fundingPayer(own.ratePercent, gap) : null;
  const fundingValue = own === null ? "—" : periodWord ? w("head.fundingRate", { rate: signedPct(own.ratePercent / 100, 4), period: periodWord }) : signedPct(own.ratePercent / 100, 4);
  const fundingNote = [payer ? w(payer === "long" ? "head.fundingLongs" : "head.fundingShorts") : null, market?.nextFundingAt ? w("head.fundingNext", { at: clockShort(market.nextFundingAt, intl) }) : null].filter(Boolean).join(" · ");
  const stats: { label: string; value: string; tone?: string | undefined; note?: string; hint?: string; id?: string }[] = market
    ? [
        { label: w("head.index"), value: formatTerminalPrice(market.oraclePrice, intl) },
        { label: w("head.premium"), value: gap === null ? "—" : `${signedUsd(gap.usd)} · ${signedPct(gap.fraction, 3)}`, id: "premium" },
        { label: w("head.funding"), value: fundingValue, note: fundingNote || undefined, hint: w("head.fundingHint"), id: "funding" },
        { label: w("head.change"), value: formatPercent(change === null ? null : change * 100, intl), tone },
        { label: w("head.volume"), value: formatUsdCompact(market.dayVolumeUsd, intl) },
        { label: w("head.leverage"), value: market.maxLeverage === null ? "—" : `${formatAmount(market.maxLeverage, intl, 0)}×`, id: "leverage" },
      ]
    : [];

  return (
    <header className={styles.head} data-perps-head lang={lang}>
      <div className={styles.pickerWrap}>
        <button ref={opener} type="button" className={styles.picker} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)} data-perps-picker>
          <span className={styles.pickerName} translate="no">{market ? `${market.symbol}-PERP` : "—"}</span>
          {market?.maxLeverage ? <span className={styles.pickerLev}>{`${formatAmount(market.maxLeverage, intl, 0)}×`}</span> : null}
          <Icon name="chevron-down" size={16} />
        </button>
        {open ? (
          <div ref={menu} className={styles.marketMenu} role="dialog" aria-label={w("head.markets")} data-perps-markets data-dense>
            <input className={styles.marketSearch} type="search" autoFocus placeholder={w("head.search")} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={w("head.search")} />
            <div className={styles.marketGroups} role="group" aria-label={w("head.markets")} data-perps-groups>
              {groups.map((entry) => (
                <button key={entry} type="button" aria-pressed={group === entry} title={entry === "rwa" ? w("group.rwaHint") : undefined} onClick={() => setGroup(entry)} data-perps-group={entry}>
                  {w(`group.${entry}` as PerpsWordKey)}
                </button>
              ))}
            </div>
            <div className={styles.marketTable} aria-label={w("head.markets")}>
              <div className={styles.marketRowHead} aria-hidden="true">
                <span>{w("col.market")}</span>
                <span>{w("col.price")}</span>
                <span>{w("col.change")}</span>
                <span>{w("col.volume")}</span>
              </div>
              {found.length === 0 ? <p className={styles.muted}>{w(group === "favorites" && !query.trim() ? "group.none" : "head.noMatch")}</p> : null}
              {found.map((entry) => {
                const entryChange = dayChange(entry);
                const starred = favorites.has(symbolKey(entry.symbol));
                const entryState = stateOf(entry);
                return (
                  <div key={entry.symbol} className={styles.marketItem}>
                    <button
                      type="button"
                      className={styles.marketStar}
                      aria-pressed={starred}
                      aria-label={w(starred ? "fav.remove" : "fav.add", { coin: entry.symbol })}
                      onClick={() => toggleFavorite(entry.symbol)}
                      data-perps-favorite={starred ? "on" : "off"}
                    >
                      <span aria-hidden="true">{starred ? "★" : "☆"}</span>
                    </button>
                    <button
                      type="button"
                      aria-current={entry.symbol === market?.symbol ? "true" : undefined}
                      className={styles.marketRow}
                      onClick={() => {
                        onChoose(entry.symbol);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className={styles.marketName} translate="no">
                        {entry.symbol}
                        {entry.maxLeverage ? <small>{`${formatAmount(entry.maxLeverage, intl, 0)}×`}</small> : null}
                        {entryState !== "trading" ? <small data-perps-state={entryState}>{w(`state.${entryState}` as PerpsWordKey)}</small> : null}
                      </span>
                      <span>{formatTerminalPrice(entry.markPrice, intl)}</span>
                      <span data-tone={toneOf(entryChange === null ? null : entryChange * 100)}>{formatPercent(entryChange === null ? null : entryChange * 100, intl)}</span>
                      <span>{formatUsdCompact(entry.dayVolumeUsd, intl)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.headPrice}>
        <span className={styles.headMark} data-tone={tone} data-stale={stale ? "" : undefined} data-perps-mark>
          {formatTerminalPrice(market?.markPrice ?? null, intl)}
        </span>
        <span className={styles.headMarkLabel}>{w("head.mark")}</span>
      </div>

      <dl className={styles.headStats}>
        {stats.map((stat) => (
          <div key={stat.label} title={stat.hint} data-perps-stat={stat.id}>
            <dt>{stat.label}</dt>
            <dd data-tone={stat.tone}>
              {stat.value}
              {stat.note ? <small className={styles.headNote}>{stat.note}</small> : null}
            </dd>
          </div>
        ))}
      </dl>

      {stale ? (
        <span className={styles.staleChip} role="status" title={w("head.staleHint")} data-perps-stale>
          <Icon name="triangle-alert" size={14} />
          {staleAt ? w("head.staleAt", { at: staleAt }) : w("head.stale")}
        </span>
      ) : null}
      {market && state !== "trading" ? (
        <span className={styles.stateChip} data-perps-state={state} title={w(`state.${state}Hint` as PerpsWordKey)}>
          {w(`state.${state}` as PerpsWordKey)}
        </span>
      ) : null}

      {/* A canary wallet trades while the public state says otherwise (a canary is never announced): its own chip then speaks alone. */}
      {ordersState && !(trade === "open" && ordersState !== "LIVE") ? (
        <span data-authority="phoenix.orders">
          <HonestStateChip state={ordersState} locale={lang} />
        </span>
      ) : null}
      <span className={styles.tradeChip} data-trade={trade} data-perps-mode={trade === "open" ? "trade" : "view"}>
        {w(trade === "open" ? "head.trade" : trade === "gated" ? "head.gated" : "head.view")}
      </span>
      {tools ? <div className={styles.headTools}>{tools}</div> : null}
    </header>
  );
}
