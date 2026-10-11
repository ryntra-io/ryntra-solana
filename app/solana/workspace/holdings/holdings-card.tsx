"use client";

/**
 * Portfolio — what this wallet owns, and what it is worth where that is known.
 *
 * Rebuilt on 2026-09-12 as a proper portfolio: the value first with the day's
 * change, the allocation as one bar, the holdings as a table a broker would
 * show — icon, price, the day's move, amount, value, share — grouped by what
 * the asset is (Crypto · Stocks/RWA · Memes), and the dust folded under one
 * line instead of forty anonymous rows between the real positions.
 *
 * ## The one rule that is not cosmetic
 *
 * **An unknown price is not zero.** The total is the sum of what could be
 * priced, it says how many assets it could not price, and an unpriced row
 * shows a dash rather than $0.00. When the balance read itself failed, the
 * list does not render as an empty wallet.
 *
 * ## Width and the one action
 *
 * From 1280 px the positions take a main column and «Автоінвест» the right
 * one, as on Home; the value reads in big figures in the reader's language
 * with what the money is in beside it, and carries the page's one orange
 * action — the wallet's next step, said as Home says it (`FundingActions`).
 *
 * ## Read by address
 *
 * Public onchain balances are readable by address, so this needs no
 * signature. It is keyed by the wallet, never the browser.
 */

import { ArrowUpRight, CaretDown, CaretUp, HourglassMedium } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { AutoinvestBlock } from "@/app/app/invest/autoinvest-block";
import { CoinPositionSale } from "@/app/app/stocks/[ticker]/coin-sale";
import { PositionSale } from "@/app/app/stocks/[ticker]/sell-sheet";
import { FundingActions } from "@/app/app/invest/funding-actions";
import { WarnSheet, WatchLine } from "@/app/app/invest/position-watch";
import { usePositions } from "@/app/app/invest/use-positions";
import { fundingNeed, fundsOf } from "@/app/app/invest/funding-model";
import { numberLocale } from "@/app/app/invest/invest-words";
import { useWalletData } from "@/app/app/wallet-data";
import { holdingSymbol, holdingValue, shownRaw, usdValueIn, walletValue, type WalletHolding } from "@/app/app/wallet-view-model";
import { Panel } from "@/app/shell/panel";
import type { PositionWatchView } from "@/lib/api/v1/contract";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { displayAmount } from "@/lib/solana/amounts";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";
import { eventLine, isWatched, SELL_FOR_USDC, swapActionWord, windowState } from "@/lib/stocks/conversion-watch";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint } from "@/lib/stocks/retired";
import { mintHref } from "../assets/featured.ts";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { MarketIcon } from "../spot/market-list.tsx";
import { StockRowChips, useStockRows } from "../spot/stock-context.tsx";
import { formatPercent, formatPrice } from "../spot/spot-format.ts";
import { PlanLink, usePlansByMint } from "./plan-link.tsx";
import { RewardsSummary } from "./rewards-summary.tsx";
import { ShareTrade } from "../rewards/share-trade.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import styles from "./holdings.module.css";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** Below this a position is dust: folded away, still counted, never hidden. */
const DUST_MICRO_USD = 10_000n;
const ALLOCATION_SLICES = 6;

type Category = "crypto" | "stock" | "meme" | "other";
type CategoryFilter = "all" | Category;

type Row = Readonly<{
  holding: WalletHolding;
  value: bigint | null;
  ticker: string;
  name: string | null;
  mint: string;
  icon: string | null;
  category: Category;
  price: number | null;
  change: number | null;
  tradeable: boolean;
  retired: boolean;
  /** The issuer's event about the token (the IPO and conversion watch): the holder's line, the swap and the quiet sale; null for every other token. */
  event: RowEvent | null;
}>;

type RowEvent = Readonly<{ line: string; swap: Readonly<{ word: string; href: string }> | null; sell: Readonly<{ word: string; href: string }> | null }>;

/**
 * A holding's issuer event, in the reader's language: «SpaceX вийшла на
 * біржу. Обміняй SPACEX до 12 березня 2027 — після строку токен згорить.»,
 * the swap and the quiet sale on the token's page — or, once the window has
 * closed, the line alone.
 */
function rowEventOf(mint: string | null, lang: "en" | "uk", nowMs: number): RowEvent | null {
  const event = mint ? lifecycleEventFor(mint) : null;
  if (!isWatched(event)) return null;
  const page = `/app/stocks/${encodeURIComponent(event.watch.symbol)}`;
  const open = windowState(event, nowMs) === "open";
  const swapWord = open ? swapActionWord(event.watch, lang) : null;
  return {
    line: eventLine(event, "holder", lang, nowMs),
    swap: swapWord ? { word: swapWord, href: `${page}?convert=1` } : null,
    sell: open ? { word: SELL_FOR_USDC[lang], href: `${page}?sell=1` } : null,
  };
}

function categoryOf(holding: WalletHolding): Category {
  const value = holding.catalog?.category;
  return value === "stock" || value === "meme" || value === "crypto" ? value : "other";
}

/**
 * What the connected wallet owns. The empty states are the beginner's, for
 * everyone, because there is one version: a guest reads «Під'єднай
 * гаманець — і побач, що в тебе є», a wallet with nothing yet
 * reads «Поповни — і зроби першу купівлю» and the way to top up.
 */
export function HoldingsCard() {
  const { text, locale } = useSolanaI18n();
  const { connection } = useSolanaConnection();
  const { holdings, activity, refresh } = useWalletData();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  /* The stock context for the rows that are tokenized stocks: the session and the
     token's deviation from the issuer's reference, from the same read the Stocks
     page uses. Asked for only when such a row exists. */
  const stockMints = useMemo(
    () => (holdings.status === "ready" ? holdings.data.flatMap((holding) => (holding.catalog?.category === "stock" && holding.mint ? [holding.mint] : [])) : []),
    [holdings],
  );
  const stockRows = useStockRows(stockMints);
  /* The plan a holding belongs to: the wallet's own plans by mint, so a position can be opened as the decision it came from. Nothing about value is computed here. */
  const plansByMint = usePlansByMint(connection?.address ?? null);
  const [dustOpen, setDustOpen] = useState(false);
  /* «Продати з позиції»: the position whose sale's sheet is open — a company's or a coin's — and its own logo and name for the head while it is read. */
  const [sale, setSale] = useState<Readonly<{ mint: string; name: string; icon: string | null; coin: boolean }> | null>(null);
  /* Нагляд over each company the wallet holds: its state and one action under the row; «Ryntra попередить» opens its sheet. */
  const watches = usePositions();
  const [warning, setWarning] = useState<PositionWatchView | null>(null);
  /* A closed sale re-reads Нагляд: a position sold, or sold in part, says so at once. */
  const { reload: reloadWatches } = watches;
  const saleWas = useRef<string | null>(null);
  useEffect(() => {
    if (saleWas.current !== null && sale === null) reloadWatches();
    saleWas.current = sale?.mint ?? null;
  }, [sale, reloadWatches]);

  /* Money that has left this wallet and not yet settled: named beside the
     total, never folded into it. */
  const moving = useMemo(
    () => activity.status === "ready"
      ? activity.data.filter((action) => action.outcome === "IN_FLIGHT" || action.outcome === "NEEDS_YOU")
      : [],
    [activity],
  );

  /* Every holding as a row, priced first and by value, then by name. */
  const allRows = useMemo<readonly Row[]>(() => {
    if (holdings.status !== "ready") return [];
    const nowMs = Date.now();
    const lang = locale === "uk" ? "uk" : "en";
    return holdings.data
      .map((holding): Row => {
        const mint = holding.mint ?? WRAPPED_SOL;
        const price = holding.catalog?.usdPrice ? Number(holding.catalog.usdPrice) : null;
        const change = holding.catalog?.dayChangePct;
        return {
          holding,
          value: holdingValue(holding),
          ticker: holdingSymbol(holding),
          name: holding.catalog?.name ?? holding.name ?? null,
          mint,
          icon: holding.catalog?.icon ?? null,
          category: holding.kind === "NATIVE_SOL" ? "crypto" : categoryOf(holding),
          price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
          change: typeof change === "number" && Number.isFinite(change) ? change : null,
          /* A token Ryntra no longer supports opens no ticket: its row says so and where it can be sold. */
          tradeable: (Boolean(holding.catalog?.symbol) || holding.kind === "NATIVE_SOL") && !isRetiredMint(holding.mint),
          retired: isRetiredMint(holding.mint),
          event: rowEventOf(holding.mint, lang, nowMs),
        };
      })
      .sort((a, b) => {
        if (a.value !== null && b.value !== null) return a.value > b.value ? -1 : a.value < b.value ? 1 : 0;
        if (a.value !== null) return -1;
        if (b.value !== null) return 1;
        return a.ticker.localeCompare(b.ticker);
      });
  }, [holdings, locale]);

  const totals = useMemo(() => (holdings.status === "ready" ? walletValue(holdings.data) : { total: 0n, unpriced: 0, priced: 0 }), [holdings]);
  /* The wallet's next step — the page's one orange action, as Home says it. */
  const funds = useMemo(() => (holdings.status === "ready" ? fundsOf(holdings.data, holdings.complete) : null), [holdings]);
  const need = funds ? fundingNeed(funds) : "unknown";
  const numbers = numberLocale(locale);
  const percent = new Intl.NumberFormat(numbers, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /* The day's change, from the assets whose price and day are both known.
     Value today less value yesterday: v − v / (1 + Δ). Shown only for what it
     covers, and only when it covers most of the value. */
  const dayChange = useMemo(() => {
    let covered = 0;
    let delta = 0;
    for (const row of allRows) {
      if (row.value === null || row.change === null) continue;
      const value = Number(row.value) / 1_000_000;
      const ratio = 1 + row.change / 100;
      if (ratio <= 0) continue;
      covered += value;
      delta += value - value / ratio;
    }
    const total = Number(totals.total) / 1_000_000;
    if (total <= 0 || covered / total < 0.9) return null;
    const previous = covered - delta;
    return { usd: delta, pct: previous > 0 ? (delta / previous) * 100 : 0 };
  }, [allRows, totals]);

  const counts = useMemo(() => {
    const out: Record<CategoryFilter, number> = { all: 0, crypto: 0, stock: 0, meme: 0, other: 0 };
    for (const row of allRows) {
      if (row.value === null || row.value < DUST_MICRO_USD) continue;
      out.all += 1;
      out[row.category] += 1;
    }
    return out;
  }, [allRows]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (category !== "all" && row.category !== category) return false;
      if (needle === "") return true;
      return row.ticker.toLowerCase().includes(needle) || (row.holding.mint ?? "").toLowerCase().includes(needle) || (row.name ?? "").toLowerCase().includes(needle);
    });
  }, [allRows, category, query]);

  const positions = rows.filter((row) => row.value !== null && row.value >= DUST_MICRO_USD);
  const dust = rows.filter((row) => row.value === null || row.value < DUST_MICRO_USD);
  const searching = query.trim() !== "";

  const share = (value: bigint | null): number | null => (value === null || totals.total <= 0n ? null : (Number(value) / Number(totals.total)) * 100);

  /* The allocation: the largest positions, the rest as one slice. */
  const allocation = useMemo(() => {
    const priced = allRows.filter((row) => row.value !== null && row.value >= DUST_MICRO_USD);
    const head = priced.slice(0, ALLOCATION_SLICES).map((row, index) => ({ key: row.mint, label: row.ticker, value: row.value as bigint, index }));
    const rest = priced.slice(ALLOCATION_SLICES).reduce((sum, row) => sum + (row.value as bigint), 0n);
    return rest > 0n ? [...head, { key: "other", label: text("Other"), value: rest, index: ALLOCATION_SLICES }] : head;
  }, [allRows, text]);

  const categoryLabel = (option: CategoryFilter): string => {
    if (option === "all") return text("All");
    if (option === "crypto") return text("Crypto");
    if (option === "stock") return text("Stocks/RWA");
    if (option === "meme") return text("Memes");
    return text("Other");
  };

  if (!connection) {
    return (
      <Panel id="portfolio-value" title={text("Wallet")} w={12} h={8} essential stretch>
        <WalletGate title={text("Connect a wallet — and see what you hold")} />
      </Panel>
    );
  }

  return (
    <div className={styles.workspace}>
      {/* What it is worth, and what that number does and does not include. */}
      <section className={`${styles.panel} ${styles.valuePanel}`} id="portfolio-value" aria-label={text("Value")}>
        <div className={styles.valueBody}>
          <div className={styles.valueMain}>
            <span className={styles.eyebrow}>{text("Total value")}</span>
            <strong className={styles.totalValue} translate="no">
              {holdings.status === "ready" && holdings.complete ? (totals.priced === 0 && totals.unpriced > 0 ? "\u2014" : usdValueIn(totals.total, locale)) : "\u2014"}
            </strong>
            {holdings.status === "ready" && holdings.complete && dayChange ? (
              <span className={styles.dayChange} data-tone={dayChange.usd > 0 ? "up" : dayChange.usd < 0 ? "down" : undefined} translate="no">
                {dayChange.usd >= 0 ? "+" : "−"}{usdValueIn(BigInt(Math.round(Math.abs(dayChange.usd) * 1_000_000)), locale)} · {formatPercent(dayChange.pct, numbers)} <span>{text("today")}</span>
              </span>
            ) : null}
            {/* The page's one orange action: the wallet's next step. */}
            <FundingActions need={need} firstStep={need === "usdc" && funds !== null && !funds.ownsCompany} locale={locale} />
            <dl className={styles.coverage}>
              <div className={styles.fact}>
                <dt>{text("Priced assets")}</dt>
                <dd translate="no">{holdings.status === "ready" ? totals.priced : "—"}</dd>
              </div>
              {totals.unpriced > 0 ? (
                <div className={styles.fact} data-tone="unknown">
                  <dt>{text("Without a price")}</dt>
                  <dd translate="no">{totals.unpriced}</dd>
                </div>
              ) : null}
              {moving.length > 0 ? (
                <div className={styles.fact} data-tone="motion">
                  <dt>{text("In motion")}</dt>
                  <dd translate="no">{moving.length}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className={styles.valueSide}>
            {allocation.length > 0 ? (
              <div className={styles.allocation} aria-label={text("Allocation")}>
                <div className={styles.bar} role="img" aria-label={text("Allocation")}>
                  {allocation.map((slice) => (
                    <span key={slice.key} className={styles.slice} data-slice={slice.index} style={{ flexGrow: Number(slice.value) }} title={`${slice.label} ${(share(slice.value) ?? 0).toFixed(1)}%`} />
                  ))}
                </div>
                <ul className={styles.legend}>
                  {allocation.map((slice) => (
                    <li key={slice.key} className={styles.legendRow}>
                      <span className={styles.dot} data-slice={slice.index} aria-hidden="true" />
                      <span className={styles.legendLabel} translate="no">{slice.label}</span>
                      <span className={styles.legendShare} translate="no">{percent.format(share(slice.value) ?? 0)}%</span>
                      <span className={styles.legendValue} translate="no">{usdValueIn(slice.value, locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Waiting in Rewards: a claim against Ryntra, never part of the total. */}
            <RewardsSummary />

            {/* Money that has left and not yet arrived. */}
            <div className={styles.motion} id="portfolio-motion" data-tone={moving.length > 0 ? "caution" : undefined}>
              {activity.status === "loading" ? (
                <p className={styles.quiet}>{text("Reading…")}</p>
              ) : activity.status === "error" || (activity.status === "ready" && !activity.complete && moving.length === 0) ? (
                <p className={styles.quiet}>{text("Some activity could not be loaded.")}</p>
              ) : moving.length === 0 ? null : (
                <ul className={styles.motionList}>
                  {moving.map((action) => (
                    <li key={action.actionId}>
                      <Link className={styles.motionRow} href={`/app/activity?action=${encodeURIComponent(action.actionId)}`}>
                        <span>{laneWord(action, text)}</span>
                        <span translate="no">{movingAmount(action)}</span>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Every asset, and the way into trading it. */}
      <section className={`${styles.panel} ${styles.holdings}`} id="portfolio-holdings" aria-label={text("Holdings")}>
        <div className={styles.head}>
          <div className={styles.categories} role="group" aria-label={text("Narrow this list")}>
            {(["all", "crypto", "stock", "meme"] as const).filter((option) => option === "all" || counts[option] > 0).map((option) => (
              <button key={option} type="button" className={styles.category} data-active={option === category} aria-pressed={option === category} onClick={() => setCategory(option)}>
                {categoryLabel(option)}
                <span className={styles.categoryCount} translate="no">{counts[option]}</span>
              </button>
            ))}
          </div>
          {/* «Поділитися»: a card of a trade through Ryntra with the wallet's invitation link — from Rewards; at the end of the categories' row, so search keeps its width on a phone; nothing without a measured trade. */}
          <ShareTrade align="end" />
          <div className={styles.tools}>
            <input
              className={styles.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text("Search")}
              aria-label={text("Search your holdings")}
              autoComplete="off"
            />
            <button className={styles.action} type="button" onClick={refresh} disabled={holdings.status === "loading"}>
              {holdings.status === "loading" ? text("Reading…") : text("Refresh")}
            </button>
          </div>
        </div>

        {holdings.status === "error" ? (
          <p className={styles.error}>{text("Balances could not be loaded just now. Try again in a moment.")}</p>
        ) : null}

        {holdings.status === "ready" && !holdings.complete ? (
          <p className={styles.note}>{text("Some balances could not be read, so this list may be incomplete.")}</p>
        ) : null}

        {/* A wallet with nothing of value yet — an empty SOL balance is not a position — reads its first step. */}
        {holdings.status === "ready" && holdings.complete && !searching && positions.length === 0 ? (
          <p className={styles.note} data-empty="wallet">
            {text("Top up — and make your first buy.")}{" "}
            <Link href="/app/top-up">{text("Top up")}</Link>
          </p>
        ) : holdings.status === "ready" && holdings.complete && rows.length === 0 ? (
          <p className={styles.note}>
            {query.trim() === "" ? text("This wallet holds no tokens yet.") : text("Nothing here matches that.")}
          </p>
        ) : null}

        {positions.length > 0 || (dustOpen && dust.length > 0) || searching ? (
          <div className={styles.tableHead} aria-hidden="true">
            <span>{text("Asset")}</span>
            <span>{text("Price")}</span>
            <span>{text("24h")}</span>
            <span>{text("Amount")}</span>
            <span>{text("Value")}</span>
            <span>{text("Of wallet")}</span>
            <span />
          </div>
        ) : null}

        <ul className={styles.list}>
          {(searching ? rows : [...positions, ...(dustOpen ? dust : [])]).map((row) => {
            /* A company the wallet holds is sold from its position: a stock Ryntra lists, priced, not paused, and not dust. A position whose issuer event already offers the sale keeps that one. */
            const listed = row.category === "stock" && !row.retired && !row.event && row.price !== null && row.value !== null && row.value >= DUST_MICRO_USD ? stockRows?.get(row.mint) : undefined;
            /* And a coin the same way, into USDC from the same sheet: any priced coin Spot trades, not dust — never USDC itself. */
            const coinSellable = row.category !== "stock" && row.tradeable && !row.retired && !row.event && row.mint !== SOLANA_MAINNET_USDC_MINT && row.price !== null && row.value !== null && row.value >= DUST_MICRO_USD;
            const sellable = (listed !== undefined && !listed.halted) || coinSellable;
            const watch = row.category === "stock" && !row.retired ? watches.of(row.mint) : null;
            const openSale = () => setSale({ mint: row.mint, name: listed?.name ?? row.name ?? row.ticker, icon: row.icon, coin: coinSellable });
            /* «Пауза емітента»: nothing can be sold now. «Дія»: the row's own «Продати» is the sale the watch asks for — marked in the state's colour, and the line under the name says why. */
            const sellButton = sellable && watch?.state !== "issuer-paused";
            const urgent = sellButton && watch?.action === "open-sale" ? (watch.reason === "target" ? "target" : "limit") : undefined;
            return (
            <li className={styles.row} key={row.holding.mint ?? "native-sol"} data-dust={row.value === null || row.value < DUST_MICRO_USD} data-event={row.event ? "true" : undefined} data-sell={sellButton ? "true" : undefined} data-watch={watch ? watch.state : undefined}>
              <div className={styles.assetCell}>
                <Link className={styles.asset} href={row.retired ? `/app/stocks/${encodeURIComponent(row.mint)}` : row.tradeable ? `/app/spot?mint=${encodeURIComponent(row.mint)}` : mintHref(row.holding.mint ?? WRAPPED_SOL)}>
                  <MarketIcon mint={row.mint} icon={row.icon} symbol={row.ticker} size={32} className={styles.icon} />
                  <span className={styles.assetText}>
                    <span className={styles.ticker} translate="no">{row.ticker}</span>
                    {row.name && row.name !== row.ticker ? <span className={styles.assetName}>{row.name}</span> : null}
                    {/* The way out is on the token's own page, one press from this row. */}
                    {row.retired ? <span className={styles.assetRetired}>{text("No longer supported in Ryntra")}</span> : null}
                    {row.category === "stock" && stockRows?.get(row.mint) ? <StockRowChips row={stockRows.get(row.mint)!} /> : null}
                  </span>
                </Link>
                {/* The decision this position came from — a door, never a second calculation. */}
                <PlanLink plans={plansByMint.get(row.mint) ?? []} text={text} />
              </div>
              <span className={styles.price} translate="no">{row.price === null ? "—" : `$${formatPrice(row.price, locale)}`}</span>
              <span className={styles.change} data-tone={row.change === null ? undefined : row.change > 0 ? "up" : row.change < 0 ? "down" : undefined} translate="no">
                {row.change === null ? "—" : formatPercent(row.change, numbers)}
              </span>
              <span className={styles.amount} translate="no">
                {/* The amount as the wallet shows it: a scaled mint's raw amount times its multiplier (1.15.0). */}
                {localFigure(displayAmount(shownRaw(row.holding).toString(), row.holding.decimals), locale)}
              </span>
              <span className={styles.value} translate="no" data-unpriced={row.value === null}>
                {row.value === null ? "\u2014" : usdValueIn(row.value, locale)}
              </span>
              <span className={styles.share} translate="no">{share(row.value) === null ? "" : `${percent.format(share(row.value) as number)}%`}</span>
              {/* Quiet: the page's one orange action is the wallet's next step above. */}
              <span className={styles.sellCell}>
                {sellButton ? (
                  <button type="button" className={`rw-btn ${styles.sell}`} aria-haspopup="dialog" onClick={openSale} data-urgent={urgent}>
                    {text("Sell")}
                  </button>
                ) : null}
              </span>
              {row.holding.mint ? (
                <Link className={styles.open} href={mintHref(row.holding.mint)} aria-label={`${text("Asset details")}: ${row.ticker}`} title={text("Asset details")}>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              ) : (
                <span className={styles.open} aria-hidden />
              )}
              {/* The issuer's event under the position, as wide as the row: the deadline, the swap, the quiet sale — each on the token's own page. */}
              {row.event ? (
                <div className={styles.rowEvent} data-holding-event>
                  <p>
                    <HourglassMedium size={14} weight="bold" aria-hidden="true" />
                    <span>{row.event.line}</span>
                  </p>
                  {row.event.swap ? (
                    <Link className={styles.eventSwap} href={row.event.swap.href} prefetch={false}>
                      {row.event.swap.word}
                    </Link>
                  ) : null}
                  {row.event.sell ? (
                    <Link className={styles.eventSell} href={row.event.sell.href} prefetch={false}>
                      {row.event.sell.word}
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {/* Нагляд over the position: a line of the row itself, under the name — the state, its figures, its one action — never orange here (the page's one orange action is the wallet's next step). */}
              {watch ? (
                <div className={styles.rowWatch} data-row-watch>
                  <WatchLine view={watch} locale={locale} place="row" onSale={sellable ? openSale : undefined} onWarn={() => setWarning(watch)} saleBeside={sellButton} />
                </div>
              ) : null}
            </li>
            );
          })}
        </ul>

        {!searching && dust.length > 0 ? (
          <button type="button" className={styles.dustToggle} onClick={() => setDustOpen((open) => !open)} aria-expanded={dustOpen}>
            {dustOpen ? <CaretUp size={14} aria-hidden="true" /> : <CaretDown size={14} aria-hidden="true" />}
            {dustOpen ? text("Hide small and unpriced balances") : `${text("Small and unpriced balances")} · ${dust.length}`}
          </button>
        ) : null}
      </section>

      <PositionSale mint={sale && !sale.coin ? sale.mint : null} placeholder={sale} locale={locale} onClose={() => setSale(null)} />
      <CoinPositionSale mint={sale && sale.coin ? sale.mint : null} placeholder={sale} locale={locale} onClose={() => setSale(null)} />
      <WarnSheet view={warning} locale={locale} onClose={() => setWarning(null)} />

      {/* «Автоінвест» — the wallet's rules and the month's budget, the block Home draws: the right column from 1280 px, under the value on a narrower desk, after the positions on a phone. */}
      <div className={styles.autoinvest}>
        <AutoinvestBlock locale={locale} />
      </div>
    </div>
  );
}

/** An amount the English way in the reader's: «52.34» → «52,34», «1,234.5» → «1 234,5». */
function localFigure(english: string, locale: "en" | "uk"): string {
  if (locale !== "uk") return english;
  return english.replace(/,/g, " ").replace(/\.(\d)/, ",$1");
}

/** What kind of operation is in flight, in the product's own words. */
function laneWord(action: SolanaWalletAction, text: (value: string) => string): string {
  if (action.lane === "BRIDGE") {
    return action.destination === "SOLANA" ? text("Moving to Solana") : action.destination === "BASE" ? text("Moving to Base") : text("Moving between chains");
  }
  if (action.lane === "RECEIVE") return text("Receiving");
  if (action.lane === "CROSS_SWAP") return text("Swapping across chains");
  return action.lane === "SWAP" ? text("Swapping") : text("Sending");
}

function movingAmount(action: SolanaWalletAction): string {
  const movement = action.out ?? action.in;
  if (movement === null) return "";
  if (movement.decimals === null) return movement.symbol ?? "";
  const amount = displayAmount(movement.amountRaw, movement.decimals);
  return movement.symbol === null ? amount : `${amount} ${movement.symbol}`;
}
