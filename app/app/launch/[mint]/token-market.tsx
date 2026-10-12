"use client";

import { ArrowSquareOut, ArrowsClockwise, CircleNotch, Info, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchCreatorResponse, LaunchHolderRow, LaunchMarketResponse, LaunchRiskFactView, LaunchTradeRow } from "@/lib/api/v1/contract";

import { explorerUrl, formatBps, formatCountShort, formatDate, formatMoneyShort, formatMove, formatPrice, formatRaw, rovingNext, shortAddress } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { FlightLog } from "./flight-log";
import { LaunchChart, type OwnTrade } from "./launch-chart";
import { MarketHealth } from "./market-health";
import { PoolPanel } from "./pool-panel";
import { TradePanel } from "./trade-panel";

type Tab = "trades" | "holders" | "risk";
type Word = ReturnType<typeof launchWords>;

const API_HEADERS = { "X-Ryntra-API": "1" } as const;
/** How often the page reads the market again while it is in view. */
const REFRESH_MS = 20_000;

/**
 * A launched token's market on its page: the price and the market cap, the
 * chart, the trade panel, the curve's way to the DEX, the trades, the holders
 * and the facts of risk, and the creator with their other launches. The
 * server's read comes first; the page reads again while it is in view and at
 * once after a trade. The pieces the server draws — the «Чесний лаунч» marks,
 * the token's own words and links, the share link and the receipt — are
 * placed in this order, on a desk and on a phone.
 */
export function TokenMarket({
  initial,
  token,
  symbol,
  locale,
  slots,
  paused = false,
  marksShown = [],
}: {
  initial: LaunchMarketResponse | null;
  token: string;
  symbol: string;
  locale: WorkspaceLocale;
  /** The codes of the marks «Чесний лаунч» shows on this page — «Здоров'я ринку» does not say them twice. */
  marksShown?: readonly string[];
  /** Launch's operator stop is closed: the trade panel says so in place of its action. */
  paused?: boolean;
  slots: Readonly<{ head: ReactNode; marks: ReactNode; about: ReactNode; share: ReactNode; receipt: ReactNode }>;
}) {
  const word = launchWords(locale);
  const { connection } = useSolanaConnection();
  const [market, setMarket] = useState<LaunchMarketResponse | null>(initial);
  /* The page shows at once; the market comes from the chain after it — «reading» until the first answer. */
  const [reading, setReading] = useState(initial === null);
  const [tried, setTried] = useState(initial !== null);
  const [launches, setLaunches] = useState<LaunchCreatorResponse | "reading" | "failed">("reading");
  const [tab, setTab] = useState<Tab>("trades");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const tabsRef = useRef<HTMLElement | null>(null);
  const tradeRef = useRef<HTMLDivElement | null>(null);
  /* On a phone the trade is above: once it is scrolled past, one button brings it back. */
  const [tradePassed, setTradePassed] = useState(false);
  /* A trade made here: the share card is drawn again, so its list of the person's trades has the new one. */
  const [shareRound, setShareRound] = useState(0);

  const openRisk = useCallback(() => {
    setTab("risk");
    tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById("launch-tab-risk")?.focus({ preventScroll: true });
  }, []);

  const readLaunches = useCallback(async () => {
    setLaunches("reading");
    const answer = await fetch(`/api/v1/launch/${token}/creator`, { headers: API_HEADERS, cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as LaunchCreatorResponse) : null))
      .catch(() => null);
    setLaunches(answer ?? "failed");
  }, [token]);

  const read = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setReading(true);
    try {
      const response = await fetch(`/api/v1/launch/${token}/market`, { headers: API_HEADERS, cache: "no-store" });
      if (response.ok) setMarket((await response.json()) as LaunchMarketResponse);
    } catch {
      /* The last read stays; the next one comes on its own. */
    } finally {
      busy.current = false;
      setReading(false);
      setTried(true);
      setNow(Date.now());
    }
  }, [token]);

  useEffect(() => {
    if (initial === null) void read();
  }, [initial, read]);

  /* The creator's other launches, after the market: the page never waits for them. */
  const hasMarket = market !== null;
  useEffect(() => {
    if (hasMarket) void readLaunches();
  }, [hasMarket, readLaunches]);

  /*
   * The trade's place on the page: the button shows while the panel is out of the screen — not reached yet on the first
   * screen, or scrolled past — and only on a phone's one column. Read on every scroll — a jump straight from the bottom to the top crosses no edge an observer would see.
   */
  useEffect(() => {
    if (!hasMarket) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const box = tradeRef.current?.getBoundingClientRect();
      setTradePassed(Boolean(box && (box.bottom < 0 || box.top > window.innerHeight)));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hasMarket]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
    };
  }, [read]);

  const wallet = connection?.address ?? null;
  const own = useMemo<OwnTrade[]>(
    () => (market && wallet ? market.trades.rows.filter((row) => row.trader === wallet).map((row) => ({ t: Math.floor(Date.parse(row.at) / 1000), side: row.side })) : []),
    [market, wallet],
  );
  const pairMoney = useCallback(
    (value: number) => (market ? formatMoneyShort(value, locale, market.pair.dollar, market.pair.symbol) : String(value)),
    [market, locale],
  );

  if (!market) {
    return (
      <div className={styles.tokenLayout}>
        <div className={styles.headSlot}>{slots.head}</div>
        <section className={`${styles.card} ${styles.slotChart}`} aria-live="polite" aria-busy={reading || !tried}>
          {reading || !tried ? (
            <p className={styles.unread}>
              <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("marketReading")}
            </p>
          ) : (
            <>
              <p className={styles.unread}>{word("marketUnread")}</p>
              <button type="button" className="rw-btn" onClick={() => void read()} disabled={reading}>
                <ArrowsClockwise size={16} aria-hidden /> {word("readAgain")}
              </button>
            </>
          )}
        </section>
        <div className={styles.asideCol}>
          <div className={styles.slotShare}>{slots.share}</div>
        </div>
        <div className={styles.mainCol}>
          <div className={styles.slotMarks}>{slots.marks}</div>
          <div className={styles.slotAbout}>{slots.about}</div>
          <div className={styles.slotReceipt}>{slots.receipt}</div>
        </div>
      </div>
    );
  }

  const sold = market.risk.find((fact) => fact.code === "CREATOR_SOLD") ?? null;
  const price = formatPrice(market.price.usd ?? market.price.pair, locale);
  const moneyOf = (value: { pair: number; usd: number | null }) => formatMoneyShort(value.usd ?? value.pair, locale, value.usd !== null, market.pair.symbol);
  const ago = (seconds: number) => agoText(word, Math.max(0, seconds));
  const nowSeconds = Math.floor(now / 1000);

  const attention = market.risk.some(inAttention);

  return (
    <div className={styles.tokenLayout} data-attention={attention ? "" : undefined}>
      <div className={styles.headSlot}>
        {slots.head}
        <div className={styles.priceBlock}>
          <div className={styles.priceMain}>
            <span className={styles.priceLabel}>{word("marketCap")}</span>
            <span className={styles.priceCap}>{moneyOf(market.marketCap)}</span>
            <span className={styles.priceMove} data-dir={market.sinceLaunchBps > 0 ? "up" : market.sinceLaunchBps < 0 ? "down" : undefined}>
              {formatMove(market.sinceLaunchBps, locale)} <span className={styles.priceMoveLabel}>{word("sinceLaunch")}</span>
            </span>
          </div>
          <dl className={styles.stats}>
            <Stat
              label={word("price")}
              value={
                /* The zeros in a subscript are for the eye; a screen reader gets the number written out. */
                <span title={price.plain}>
                  <span aria-hidden>{market.price.usd !== null ? `$${price.text}` : `${price.text} ${market.pair.symbol}`}</span>
                  <span className={styles.visuallyHidden}>{market.price.usd !== null ? `$${price.plain}` : `${price.plain} ${market.pair.symbol}`}</span>
                </span>
              }
            />
            <Stat label={market.venue === "curve" ? word("liquidityCurve") : word("liquidity")} value={moneyOf(market.liquidity)} />
            {/* Counted from the trades read: «≥» when the day was not read whole, «not read» when nothing was. */}
            <Stat
              label={word("volume24h")}
              value={
                market.volume24h.complete ? (
                  moneyOf(market.volume24h)
                ) : market.trades.read === 0 ? (
                  <span className={styles.statUnread}>{word("groupUnread")}</span>
                ) : (
                  <span className={styles.statFloor}>≥ {moneyOf(market.volume24h)}</span>
                )
              }
            />
            <Stat label={word("holders")} value={`${formatCountShort(market.holders.count, locale)}${market.holders.atLeast ? "+" : ""}`} />
            <Stat label={word("top10")} value={formatBps(market.holders.groups.top10Bps, locale)} />
            <Stat label={word("age")} value={ageOf(market, nowSeconds, word)} />
          </dl>
        </div>
        {sold ? (
          <a className={styles.soldBanner} href={sold.source ? explorerUrl(market.network, sold.source.kind, sold.source.id) : undefined} target="_blank" rel="noreferrer noopener">
            <Warning size={18} weight="fill" aria-hidden />
            <span>
              {sold.values.soldBps !== undefined ? word("creatorSold", { pct: formatBps(sold.values.soldBps, locale) }) : word("creatorSoldSupply", { pct: formatBps(sold.values.supplyBps ?? 0, locale) })}
              {sold.values.at ? <span className={styles.soldWhen}> · {word("creatorSoldWhen", { ago: ago(nowSeconds - (sold.values.at ?? 0)) })}</span> : null}
            </span>
            <ArrowSquareOut size={14} aria-hidden />
          </a>
        ) : !market.creator.tradesComplete ? (
          /* Not read is not «did not sell»: said where the banner would stand, without its colour. */
          <p className={styles.soldUnread}>
            <Info size={16} aria-hidden /> {word("creatorSalesUnread")}
          </p>
        ) : null}
      </div>

      {/* In the order a person reads on a phone — the price, the chart, the trade, what is worth a look — and the same order
          for a keyboard and a screen reader; on a desk the trade stands beside them. */}
      <section className={`${styles.card} ${styles.slotChart}`} aria-labelledby="launch-chart">
        <div className={styles.cardHeadRow}>
          <h2 id="launch-chart" className={styles.cardTitle}>
            {word("chartTitle")}
          </h2>
          <ul className={styles.legend}>
            <li>
              <span className={styles.legendUp} aria-hidden>▲</span> {word("chartMarkCreator")} — {word("chartLegendBuy")}
            </li>
            <li>
              <span className={styles.legendDown} aria-hidden>▼</span> {word("chartMarkCreator")} — {word("chartLegendSell")}
            </li>
            {market.progress.migrated ? (
              <li>
                <span className={styles.legendDex} aria-hidden>●</span> {word("chartLegendDex")}
              </li>
            ) : null}
          </ul>
        </div>
        <LaunchChart
          chart={market.chart}
          own={own}
          money={pairMoney}
          creatorLetter={word("chartMarkCreator")}
          ownLetter={word("you")}
          label={(figures) => word("chartSummary", { ...figures, n: market.trades.read })}
        />
        {market.trades.rows.length === 0 && market.trades.complete ? <p className={styles.hint}>{word("chartNoTrades")}</p> : null}
      </section>

      <div className={styles.asideCol}>
        <div className={styles.slotTrade} ref={tradeRef} id="launch-trade">
          <TradePanel
            market={market}
            symbol={symbol}
            locale={locale}
            paused={paused}
            onTraded={() => {
              setShareRound((round) => round + 1);
              void read();
            }}
          />
        </div>
        {/* After the DEX, a holder's position in the pool — drawn only for a wallet the entry is open to, or one holding a position here. */}
        {market.progress.migrated ? <PoolPanel market={market} symbol={symbol} locale={locale} paused={paused} /> : null}
        <div className={styles.slotShare} key={shareRound}>
          {slots.share}
        </div>
      </div>

      {/* What is worth a look stands open beside the «Чесний лаунч» marks, never only behind a tab. */}
      <Attention market={market} locale={locale} word={word} now={nowSeconds} onAll={openRisk} />

      <div className={styles.mainCol}>
        <section className={`${styles.card} ${styles.slotProgress}`} aria-labelledby="launch-progress">
          <div className={styles.progressHead}>
            <h2 id="launch-progress" className={styles.cardTitle}>
              {market.progress.migrated ? word("graduated") : word("progress")}
            </h2>
            <span className={styles.progressValue}>{formatBps(market.progress.bps, locale)}</span>
          </div>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(market.progress.bps / 100)} aria-labelledby="launch-progress">
            <span className={styles.barFill} style={{ width: `${Math.max(market.progress.bps / 100, 1)}%` }} />
          </div>
          {market.progress.migrated ? (
            <p className={styles.progressLine}>
              {word("graduatedPool")} ·{" "}
              <a className={styles.markLink} href={explorerUrl(market.network, "account", market.trading.pool)} target="_blank" rel="noreferrer noopener">
                {word("pool")} <ArrowSquareOut size={12} aria-hidden />
              </a>
            </p>
          ) : (
            <p className={styles.progressLine}>
              {word("progressOf", {
                amount: formatRaw(market.progress.reserveRaw, market.pair.decimals, locale, 0),
                threshold: formatRaw(market.progress.thresholdRaw, market.pair.decimals, locale, 0),
                symbol: market.pair.symbol,
              })}{" "}
              ·{" "}
              {word("progressLeft", {
                amount: leftToDex(market.progress.thresholdRaw, market.progress.reserveRaw, market.pair.decimals, locale),
                symbol: market.pair.symbol,
              })}
            </p>
          )}
        </section>

        {/* The market's health and its flight log read again when the trades or the way to the DEX change, never on their own clock. */}
        <MarketHealth token={token} locale={locale} marksShown={marksShown} refresh={`${market.trades.read}:${market.trades.rows[0]?.signature ?? ""}:${market.progress.migrated}`} />

        <div className={styles.slotMarks}>{slots.marks}</div>

        <FlightLog token={token} locale={locale} symbol={symbol} refresh={`${market.trades.read}:${market.trades.rows[0]?.signature ?? ""}:${market.progress.migrated}`} />

        <section className={`${styles.card} ${styles.slotTabs}`} ref={tabsRef}>
          <Tabs tab={tab} onTab={setTab} word={word} attention={market.risk.filter((fact) => fact.level === "attention").length} />
          {/* Every panel is in the page, the inactive ones hidden: each tab controls a panel that exists. */}
          <div role="tabpanel" id="launch-panel-trades" aria-labelledby="launch-tab-trades" hidden={tab !== "trades"} className={styles.tabPanel}>
            <Trades market={market} wallet={wallet} locale={locale} word={word} now={nowSeconds} symbol={symbol} />
          </div>
          <div role="tabpanel" id="launch-panel-holders" aria-labelledby="launch-tab-holders" hidden={tab !== "holders"} className={styles.tabPanel}>
            <Holders market={market} wallet={wallet} locale={locale} word={word} now={nowSeconds} />
          </div>
          <div role="tabpanel" id="launch-panel-risk" aria-labelledby="launch-tab-risk" hidden={tab !== "risk"} className={styles.tabPanel}>
            <Risk market={market} locale={locale} word={word} now={nowSeconds} />
          </div>
        </section>

        <section className={`${styles.card} ${styles.slotCreator}`} aria-labelledby="launch-creator">
          <div className={styles.cardHeadRow}>
            <h2 id="launch-creator" className={styles.cardTitle}>
              {word("creatorTitle")}
            </h2>
            <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(market.network, "account", market.creator.address)} target="_blank" rel="noreferrer noopener">
              {shortAddress(market.creator.address)} <ArrowSquareOut size={12} aria-hidden />
            </a>
          </div>
          {market.creator.curves !== null ? <p className={styles.hint}>{word("creatorCurves", { n: Math.max(0, market.creator.curves - 1) })}</p> : null}
          {launches === "reading" ? (
            <p className={styles.unread}>
              <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("creatorReading")}
            </p>
          ) : launches === "failed" ? (
            <div className={styles.unreadRow}>
              <p className={styles.unread}>{word("creatorUnread")}</p>
              <button type="button" className={styles.textButton} onClick={() => void readLaunches()}>
                <ArrowsClockwise size={14} aria-hidden /> {word("readAgain")}
              </button>
            </div>
          ) : launches.launches.length ? (
            <>
              <h3 className={styles.subTitle}>{word("creatorOther")}</h3>
              <ul className={styles.launchList}>
                {launches.launches.map((entry) => (
                  <li key={entry.token} className={styles.launchItem}>
                    <span className={styles.launchHead}>
                      <Link className={styles.launchName} href={`/app/launch/${entry.token}`}>
                        {entry.name} <span className={styles.tokenSymbol}>${entry.symbol}</span>
                      </Link>
                      {/* Two launches may share a name: the address tells them apart. */}
                      <span className={`${styles.launchMint} ${styles.addr}`}>{shortAddress(entry.token)}</span>
                    </span>
                    <span className={styles.launchMeta}>
                      {formatDate(entry.launchedAt, locale)} ·{" "}
                      {entry.migrated ? word("outcomeDex") : entry.progressBps !== null ? word("outcomeCurve", { pct: formatBps(entry.progressBps, locale) }) : "—"}
                      {entry.creatorSoldBps !== null ? (
                        <span data-sold={entry.creatorSoldBps > 0 ? "" : undefined} className={styles.launchSold}>
                          {" "}
                          ·{" "}
                          {entry.creatorSoldBps > 0
                            ? word(entry.creatorSoldOf === "supply" ? "outcomeSoldSupply" : "outcomeSold", { pct: formatBps(entry.creatorSoldBps, locale) })
                            : word("outcomeKept")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.unread}>{word("creatorNone")}</p>
          )}
        </section>

        <div className={styles.slotAbout}>{slots.about}</div>
        <div className={styles.slotReceipt}>{slots.receipt}</div>
      </div>
      {tradePassed ? (
        <button
          type="button"
          className={`rw-btn rw-btn--primary ${styles.tradeJump}`}
          onClick={() => {
            tradeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
            tradeRef.current?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.focus({ preventScroll: true });
          }}
        >
          {word("tradeJump", { symbol })}
        </button>
      ) : null}
    </div>
  );
}

/**
 * What the curve still needs before the DEX: whole units, and cents once less than one is left — 0.26 USDC short of the
 * threshold read «0 USDC more» on $STAIR (10.10) while the curve stood at 99.48 %.
 */
function leftToDex(thresholdRaw: string, reserveRaw: string, decimals: number, locale: WorkspaceLocale): string {
  const left = BigInt(thresholdRaw) - BigInt(reserveRaw);
  if (left <= 0n) return formatRaw("0", decimals, locale, 0);
  const unit = 10n ** BigInt(decimals);
  /* Rounded up, never down: what is said is always enough — a cent below one unit, a whole unit above it. */
  const step = left < unit ? 10n ** BigInt(Math.max(0, decimals - 2)) : unit;
  return formatRaw((((left + step - 1n) / step) * step).toString(), decimals, locale, left < unit ? 2 : 0);
}

/** In the card «worth a look»: every fact worth a look but «the creator sold» (the banner above), and a history read in part as context beside them. */
const inAttention = (fact: LaunchRiskFactView) => (fact.level === "attention" && fact.code !== "CREATOR_SOLD") || fact.code === "HISTORY_PARTIAL";

/** The facts worth a look before a trade, open on the page: each with why it matters and where to see it. «The creator sold» is the banner above. */
function Attention({ market, locale, word, now, onAll }: { market: LaunchMarketResponse; locale: WorkspaceLocale; word: Word; now: number; onAll: () => void }) {
  const facts = market.risk.filter(inAttention);
  if (!facts.length) return null;
  return (
    <section className={`${styles.card} ${styles.slotAttention}`} aria-labelledby="launch-attention">
      <div className={styles.cardHeadRow}>
        <h2 id="launch-attention" className={styles.cardTitle}>
          {word("attentionTitle")}
        </h2>
        <button type="button" className={styles.textButton} onClick={onAll}>
          {word("attentionAll")}
        </button>
      </div>
      <RiskList market={market} facts={facts} locale={locale} word={word} now={now} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function agoText(word: Word, seconds: number): string {
  if (seconds < 10) return word("justNow");
  const time = seconds < 60 ? word("sec", { n: seconds }) : seconds < 3600 ? word("min", { n: Math.floor(seconds / 60) }) : seconds < 86_400 ? word("hour", { n: Math.floor(seconds / 3600) }) : word("day", { n: Math.floor(seconds / 86_400) });
  return word("ago", { time });
}

function durationText(word: Word, seconds: number): string {
  return seconds < 60 ? word("sec", { n: seconds }) : seconds < 3600 ? word("min", { n: Math.floor(seconds / 60) }) : seconds < 86_400 ? word("hour", { n: Math.floor(seconds / 3600) }) : word("day", { n: Math.floor(seconds / 86_400) });
}

function ageOf(market: LaunchMarketResponse, now: number, word: Word): string {
  const opened = market.chart.points[0]?.t;
  return opened ? durationText(word, Math.max(0, now - opened)) : "—";
}

function Tabs({ tab, onTab, word, attention }: { tab: Tab; onTab: (tab: Tab) => void; word: Word; attention: number }) {
  const order: Tab[] = ["trades", "holders", "risk"];
  const label: Record<Tab, LaunchWordKey> = { trades: "tabTrades", holders: "tabHolders", risk: "tabRisk" };
  const move = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = rovingNext(order, tab, event.key);
    if (!next) return;
    event.preventDefault();
    onTab(next);
    document.getElementById(`launch-tab-${next}`)?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label={word("tabsLabel")}>
      {order.map((entry) => (
        <button
          key={entry}
          id={`launch-tab-${entry}`}
          type="button"
          role="tab"
          aria-selected={tab === entry}
          aria-controls={`launch-panel-${entry}`}
          tabIndex={tab === entry ? 0 : -1}
          className={styles.tab}
          onClick={() => onTab(entry)}
          onKeyDown={move}
        >
          {word(label[entry])}
          {entry === "risk" && attention > 0 ? (
            <>
              <span className={styles.tabCount} aria-hidden>
                {attention}
              </span>
              <span className={styles.visuallyHidden}>, {word("tabRiskCount", { n: attention })}</span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Labels({ labels, word, mine }: { labels: readonly string[]; word: Word; mine?: boolean }) {
  if (!labels.length && !mine) return null;
  return (
    <span className={styles.labels}>
      {mine ? <span className={styles.label_you}>{word("you")}</span> : null}
      {labels.map((label) => (
        <span
          key={label}
          className={styles.holderLabel}
          data-label={label}
          title={label === "sniper" ? word("labelHint_sniper") : label === "bundle" ? word("labelHint_bundle") : undefined}
        >
          {word(`label_${label}` as LaunchWordKey)}
        </span>
      ))}
    </span>
  );
}

/** How many trades the list shows at first, and adds on each «more». */
const TRADES_PAGE = 20;

function Trades({ market, wallet, locale, word, now, symbol }: { market: LaunchMarketResponse; wallet: string | null; locale: WorkspaceLocale; word: Word; now: number; symbol: string }) {
  const [shown, setShown] = useState(TRADES_PAGE);
  const all = market.trades.rows;
  const rows = all.slice(0, shown);
  /* None read is not none made: «no trades yet» only when the whole history was read. */
  if (!all.length) return <p className={styles.unread}>{market.trades.complete ? word("tradesEmpty") : word("tradesUnread")}</p>;
  const pair = market.pair;
  return (
    <>
      {!market.trades.complete ? <p className={styles.hint}>{word("tradesLatest", { n: market.trades.read })}</p> : null}
      {/* The labels said in words where they are worn, not only in a hover a phone never shows. */}
      {rows.some((row) => row.traderLabels.some((label) => label === "sniper" || label === "bundle")) ? <p className={styles.hint}>{word("labelLegend")}</p> : null}
      {/* A table to a screen reader on every width: the column names drawn on a desk, where the row is one line, and
          only read on a phone, where each row is two lines and carries its own short words. */}
      <div role="table" aria-label={word("tabTrades")} className={styles.tradeTable}>
        <div role="rowgroup">
          <div role="row" className={styles.tradeHeadRow}>
            <span role="columnheader">{word("colSide")}</span>
            <span role="columnheader">{word("colTrader")}</span>
            <span role="columnheader">{word("colAmount")}</span>
            <span role="columnheader">{word("capAfter")}</span>
            <span role="columnheader">{word("colTime")}</span>
          </div>
        </div>
        <ol role="rowgroup" className={styles.tradeList}>
          {rows.map((row: LaunchTradeRow) => (
            <li role="row" key={`${row.signature}:${row.side}:${row.tokensRaw}`} className={styles.tradeRow} data-side={row.side}>
              <span role="cell" className={styles.tradeSide}>
                {row.side === "buy" ? word("sideBuy") : word("sideSell")}
              </span>
              <span role="cell" className={styles.tradeWho}>
                <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(market.network, "account", row.trader)} target="_blank" rel="noreferrer noopener">
                  {shortAddress(row.trader)}
                </a>
                <Labels labels={row.traderLabels} word={word} mine={row.trader === wallet} />
              </span>
              <span role="cell" className={styles.tradeAmount}>
                {formatMoneyShort(Number(row.pairRaw) / 10 ** pair.decimals, locale, pair.dollar, pair.symbol)}
                <span className={styles.tradeTokens}>
                  {formatRaw(row.tokensRaw, market.tokenDecimals, locale, 0)} ${symbol}
                </span>
              </span>
              <span role="cell" className={styles.tradeCap}>
                <span className={styles.tradeCapLabel} aria-hidden>
                  {word("capShort")}{" "}
                </span>
                {formatMoneyShort(row.marketCapPair, locale, pair.dollar, pair.symbol)}
              </span>
              <span role="cell" className={styles.tradeTime}>
                <a href={explorerUrl(market.network, "tx", row.signature)} target="_blank" rel="noreferrer noopener" title={new Date(row.at).toLocaleString(locale === "uk" ? "uk-UA" : "en-US")}>
                  {agoText(word, Math.max(0, now - Math.floor(Date.parse(row.at) / 1000)))}
                  <ArrowSquareOut size={12} aria-hidden />
                </a>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {all.length > shown ? (
        <button type="button" className={styles.textButton} onClick={() => setShown((count) => count + TRADES_PAGE)}>
          {word("tradesMore", { n: Math.min(TRADES_PAGE, all.length - shown) })}
        </button>
      ) : null}
    </>
  );
}

function Holders({ market, wallet, locale, word, now }: { market: LaunchMarketResponse; wallet: string | null; locale: WorkspaceLocale; word: Word; now: number }) {
  const groups = market.holders.groups;
  /* How each holding moved: the holder's own buys minus sells here over the last day, among the trades read. */
  const changes = new Map<string, bigint>();
  for (const trade of market.trades.rows) {
    if (Math.floor(Date.parse(trade.at) / 1000) < now - 86_400) continue;
    let tokens: bigint;
    try {
      tokens = BigInt(trade.tokensRaw);
    } catch {
      continue;
    }
    changes.set(trade.trader, (changes.get(trade.trader) ?? 0n) + (trade.side === "buy" ? tokens : -tokens));
  }
  const people = market.holders.rows.filter((row) => !row.labels.some((label) => NOT_PEOPLE.has(label)));
  const vaults = market.holders.rows.filter((row) => row.labels.some((label) => NOT_PEOPLE.has(label)));
  return (
    <>
      <ul className={styles.groupRow}>
        <li className={styles.group}>
          <span className={styles.groupName}>{word("label_creator")}</span>
          <span className={styles.groupValue}>{formatBps(groups.creatorBps, locale)}</span>
        </li>
        {/* The opening minutes not read: the snipers and the bundle are not known — never shown as none. */}
        <li className={styles.group} data-on={groups.snipers && groups.snipers.wallets > 0 ? "" : undefined}>
          <span className={styles.groupName}>{groups.snipers ? word("groupSnipers", { n: groups.snipers.wallets }) : word("groupSnipersName")}</span>
          <span className={styles.groupValue} data-unread={groups.snipers ? undefined : ""}>{groups.snipers ? formatBps(groups.snipers.shareBps, locale) : word("groupUnread")}</span>
        </li>
        {/* On a history read in part the bundle is a floor — «at least», or «not read in full» where none was seen. */}
        <li className={styles.group} data-on={groups.bundle && groups.bundle.wallets > 0 ? "" : undefined}>
          <span className={styles.groupName}>
            {!groups.bundle || (groups.bundle.atLeast && groups.bundle.wallets === 0)
              ? word("label_bundle")
              : word(groups.bundle.atLeast ? "groupBundleAtLeast" : "groupBundle", { n: groups.bundle.wallets })}
          </span>
          <span className={styles.groupValue} data-unread={!groups.bundle || (groups.bundle.atLeast && groups.bundle.wallets === 0) ? "" : undefined}>
            {!groups.bundle
              ? word("groupUnread")
              : groups.bundle.atLeast && groups.bundle.wallets === 0
                ? word("groupPartial")
                : `${groups.bundle.atLeast ? "≥ " : ""}${formatBps(groups.bundle.shareBps, locale)}`}
          </span>
        </li>
        <li className={styles.group}>
          <span className={styles.groupName}>{word("top10")}</span>
          <span className={styles.groupValue}>{formatBps(groups.top10Bps, locale)}</span>
        </li>
      </ul>
      <p className={styles.hint}>{word("labelLegend")} {word("holdersPeople")}{changes.size > 0 ? ` ${word("holdersChangeHint")}` : ""}</p>
      <p className={styles.hint}>{word("holdersCount", { n: `${formatCountShort(market.holders.count, locale)}${market.holders.atLeast ? "+" : ""}` })}</p>
      {/* People ranked by what they hold; the curve, the pool and the lock apart — they are not holders anyone races. */}
      <ol className={styles.holderList}>
        {people.map((row, index) => (
          <HolderRow key={row.owner} row={row} rank={index + 1} scale={people[0]?.shareBps ?? 0} market={market} wallet={wallet} locale={locale} word={word} change={changes.get(row.owner) ?? null} />
        ))}
      </ol>
      {vaults.length ? (
        <>
          <h3 className={styles.subTitle}>{word("notPeople")}</h3>
          <ul className={styles.holderList}>
            {vaults.map((row) => (
              <HolderRow key={row.owner} row={row} rank={null} scale={0} market={market} wallet={wallet} locale={locale} word={word} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

const NOT_PEOPLE = new Set(["curve", "pool", "lock"]);

/** A holder. The bar is on the people's own scale — the largest person full — so shares of a percent or two are not all dots. */
function HolderRow({ row, rank, scale, market, wallet, locale, word, change = null }: { row: LaunchHolderRow; rank: number | null; scale: number; market: LaunchMarketResponse; wallet: string | null; locale: WorkspaceLocale; word: Word; change?: bigint | null }) {
  return (
    <li className={styles.holderRow} data-vault={rank === null ? "" : undefined}>
      <span className={styles.holderRank}>{rank ?? ""}</span>
      <span className={styles.tradeWho}>
        <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(market.network, "account", row.owner)} target="_blank" rel="noreferrer noopener">
          {shortAddress(row.owner)}
        </a>
        <Labels labels={row.labels} word={word} mine={row.owner === wallet} />
      </span>
      <span className={styles.holderShare}>
        {formatBps(row.shareBps, locale)}
        {rank !== null ? (
          <span className={styles.shareBar} aria-hidden>
            <span style={{ width: `${scale > 0 ? Math.max((row.shareBps / scale) * 100, 2) : 0}%` }} />
          </span>
        ) : null}
        {change !== null && change !== 0n ? (
          <span className={styles.holderChange} data-tone={change > 0n ? "up" : "down"}>
            {/* Compact — «+5,9 млн» — so the line fits the share's narrow column; the exact count is in the holder's trades. */}
            {word("holderChange", { v: `${change > 0n ? "+" : "−"}${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(change > 0n ? change : -change) / 10 ** market.tokenDecimals)}` })}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** The words of a fact: «of the supply» when the creator sold more than they bought here, «at least» for a bundle on a history read in part. */
function riskKey(fact: LaunchRiskFactView): LaunchWordKey {
  if (fact.code === "CREATOR_SOLD" && fact.values.soldBps === undefined) return "risk_CREATOR_SOLD_SUPPLY";
  if (fact.code === "BUNDLE_HOLDS" && fact.values.atLeast) return "risk_BUNDLE_HOLDS_AT_LEAST";
  if (fact.code === "HISTORY_PARTIAL" && !fact.values.trades) return "risk_HISTORY_UNREAD";
  return `risk_${fact.code}` as LaunchWordKey;
}

function riskValues(fact: LaunchRiskFactView, locale: WorkspaceLocale, word: Word, now: number): Record<string, string | number> {
  const values = fact.values;
  return {
    pct: formatBps(values.soldBps ?? values.supplyBps ?? values.shareBps ?? 0, locale),
    wallets: values.wallets ?? 0,
    n: fact.code === "HISTORY_PARTIAL" ? (values.trades ?? 0) : (values.count ?? 0),
    age: durationText(word, Math.max(0, values.seconds ?? now)),
  };
}

function Risk({ market, locale, word, now }: { market: LaunchMarketResponse; locale: WorkspaceLocale; word: Word; now: number }) {
  return (
    <>
      <p className={styles.hint}>{word("riskLede")}</p>
      <RiskList market={market} facts={market.risk} locale={locale} word={word} now={now} />
    </>
  );
}

function RiskList({ market, facts, locale, word, now }: { market: LaunchMarketResponse; facts: readonly LaunchRiskFactView[]; locale: WorkspaceLocale; word: Word; now: number }) {
  return (
    <>
      <ul className={styles.riskList}>
        {facts.map((fact) => (
          <li key={fact.code} className={styles.riskRow} data-level={fact.level}>
            {fact.level === "attention" ? <Warning size={18} weight="fill" aria-hidden /> : <Info size={18} aria-hidden />}
            <span className={styles.riskText}>
              {/* «The creator sold» is a share of what they bought, or of the supply when they sold more than they bought here. */}
              <span>{word(riskKey(fact), riskValues(fact, locale, word, now))}</span>
              <span className={styles.riskWhy}>
                {word(`riskWhy_${fact.code}` as LaunchWordKey)}
                {fact.code === "HISTORY_PARTIAL" && market.creator.tradesComplete ? ` ${word("creatorReadWhole")}` : ""}
              </span>
            </span>
            {fact.source ? (
              <a className={styles.markLink} href={explorerUrl(market.network, fact.source.kind, fact.source.id)} target="_blank" rel="noreferrer noopener">
                {fact.source.kind === "tx" ? word("sourceTx") : word("sourceAccount")} <ArrowSquareOut size={12} aria-hidden />
              </a>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

