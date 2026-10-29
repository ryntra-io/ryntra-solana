"use client";

import { ArrowSquareOut, CaretRight, CircleNotch, Info, Warning } from "@phosphor-icons/react";
import { Block, Button, HeroNumber } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchCreatorResponse, LaunchHolderRow, LaunchMarketHealthResponse, LaunchMarketResponse, LaunchRiskFactView, LaunchTradeRow } from "@/lib/api/v1/contract";

import { coreLang, Unread } from "../launch-blocks";
import { explorerUrl, formatBps, formatCountShort, formatDate, formatMoneyShort, formatMove, formatPrice, formatRaw, rovingNext, shortAddress } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import { LAUNCH_READ_HEADER } from "@/lib/launch/read-header";
import styles from "../launch.module.css";
import { FlightLog, LadderCard, RecentLog, useFlightLog } from "./flight-log";
import { ExplainMove } from "@/app/app/ryn/explain-move";
import { LaunchChart, type OwnTrade } from "./launch-chart";
import { FEW_HOLDERS, LiquidityHealth, MarketEngine, NoGuarantee, RiskHealth, healthOf, useMarketHealth, type HealthRead } from "./market-health";
import { useHydrated } from "../use-hydrated";
import { TokenMarketSkeleton } from "./market-skeleton";
import { PoolPanel } from "./pool-panel";
import { LaunchReadContext } from "./proof-context";
import { riskFactEvidence } from "@/lib/core/launch/proof";
import { TradePanel } from "./trade-panel";
import { cabinetWords } from "../mine/cabinet-words";

/** The page's sections, one open at a time under the chart: what Ryntra does here, the liquidity, the risk, the history. */
type Section = "overview" | "liquidity" | "risk" | "activity";
const SECTIONS: readonly Section[] = ["overview", "liquidity", "risk", "activity"];
const SECTION_WORD: Readonly<Record<Section, LaunchWordKey>> = { overview: "secOverview", liquidity: "secLiquidity", risk: "secRisk", activity: "secActivity" };
/** The history's lists: the trades and the holders. */
type List = "trades" | "holders";
const LISTS: readonly List[] = ["trades", "holders"];
const LIST_WORD: Readonly<Record<List, LaunchWordKey>> = { trades: "tabTrades", holders: "tabHolders" };
/** Anchors that open a section: the section's own name, and the «Чесний лаунч» marks the rules point to. */
const ANCHOR_SECTION: Readonly<Record<string, Section>> = { overview: "overview", liquidity: "liquidity", risk: "risk", activity: "activity", "launch-marks": "risk", "launch-constitution": "risk" };

type Word = ReturnType<typeof launchWords>;

const API_HEADERS = { "X-Ryntra-API": "1" } as const;
/** How often the page reads the market again while it is in view. */
const REFRESH_MS = 20_000;
/** A first answer (SOL-P1: `x-ryntra-read: first`) — the newest page of the history; the full read is asked for this soon after. */
const FOLLOW_MS = 2_000;
/** How many times in a row a first answer is followed so soon; past it the page reads on its own clock (`REFRESH_MS`). */
const FOLLOWS = 10;

/**
 * A launched token's market on its page. First the token, its price and market cap, and the facts worth a look before a
 * trade, each in a word; then the chart with the trade beside it. Under the chart one section at a time: the overview —
 * Ryntra's Market Engine here, the latest on chain, the creator and the token's words —, the liquidity — Ryntra's ladder,
 * the depth, the budget and the pool —, the risk — every fact with its reason, the creator's lock, what governs the
 * market and the «Чесний лаунч» marks — and the history — the flight log, the trades and the holders. The server's read
 * comes first; the page reads again while it is in view and at once after a trade.
 */
export function TokenMarket({
  initial,
  token,
  symbol,
  locale,
  slots,
  paused = false,
  marksShown = [],
  initialFirst = false,
  renderedAt,
  creation = null,
}: {
  initial: LaunchMarketResponse | null;
  /** The server's read was a first answer (SOL-P1): the full read is asked for at once after the page is up. */
  initialFirst?: boolean;
  /** The server's clock when it drew the page: the first draw in the browser counts «ago» from the same moment. */
  renderedAt?: number;
  /** The launch's creation transaction: the token's age is checked there (SOL-L3). */
  creation?: string | null;
  token: string;
  symbol: string;
  locale: WorkspaceLocale;
  /** The codes of the marks «Чесний лаунч» shows on this page — «Здоров'я ринку» does not say them twice. */
  marksShown?: readonly string[];
  /** Launch's operator stop is closed: the trade panel says so in place of its action. */
  paused?: boolean;
  slots: Readonly<{ head: ReactNode; marks: ReactNode; about: ReactNode; share: ReactNode; receipt: ReactNode; /** SOL-L5: what the creator offers buyers (Launch Boost) — above the action, so it is read before a purchase. */ offer?: ReactNode; /** MOS-1: the market's constitution, beside the launch's proof. */ constitution?: ReactNode }>;
}) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const [market, setMarket] = useState<LaunchMarketResponse | null>(initial);
  /* The page shows at once; the market comes from the chain after it — «reading» until the first answer. */
  const [reading, setReading] = useState(initial === null);
  const [tried, setTried] = useState(initial !== null);
  const [launches, setLaunches] = useState<LaunchCreatorResponse | "reading" | "failed">("reading");
  const [section, setSection] = useState<Section>("overview");
  const [list, setList] = useState<List>("trades");
  const [now, setNow] = useState(() => renderedAt ?? Date.now());
  const busy = useRef(false);
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const tradeRef = useRef<HTMLDivElement | null>(null);
  /* On a phone the trade is above: once it is scrolled past, one button brings it back. */
  const [tradePassed, setTradePassed] = useState(false);
  /* A trade made here: the share card is drawn again, so its list of the person's trades has the new one. */
  const [shareRound, setShareRound] = useState(0);

  /* A section opened from elsewhere on the page: shown, scrolled to, its tab focused; the address keeps it for a link. */
  const open = useCallback((next: Section, scroll = true) => {
    setSection(next);
    try {
      window.history.replaceState(null, "", `#${next}`);
    } catch {
      /* The address is a convenience; the section opens without it. */
    }
    if (!scroll) return;
    sectionsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    document.getElementById(`launch-sec-${next}`)?.focus({ preventScroll: true });
  }, []);

  /* A link to a section — `#risk`, or the marks the rules point to — opens it. */
  useEffect(() => {
    const follow = () => {
      const target = ANCHOR_SECTION[window.location.hash.slice(1)];
      if (target) setSection(target);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const readLaunches = useCallback(async () => {
    setLaunches("reading");
    const answer = await fetch(`/api/v1/launch/${token}/creator`, { headers: API_HEADERS, cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as LaunchCreatorResponse) : null))
      .catch(() => null);
    setLaunches(answer ?? "failed");
  }, [token]);

  /* The last refresh failed: the chart shows the last read as stale. */
  const [behind, setBehind] = useState(false);
  const follow = useRef<number | null>(null);
  const followed = useRef(0);
  /* A read that ends after the page is gone schedules nothing more. */
  const alive = useRef(true);
  const read = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setReading(true);
    try {
      const response = await fetch(`/api/v1/launch/${token}/market`, { headers: API_HEADERS, cache: "no-store" });
      if (response.ok) setMarket((await response.json()) as LaunchMarketResponse);
      setBehind(!response.ok);
      /* A first answer: the rest of the history, the creator's own trades and the opening minutes come with the next read. */
      const firstAnswer = response.ok && response.headers.get(LAUNCH_READ_HEADER) === "first";
      followed.current = firstAnswer ? followed.current + 1 : 0;
      if (firstAnswer && followed.current <= FOLLOWS && alive.current) {
        if (follow.current !== null) window.clearTimeout(follow.current);
        follow.current = window.setTimeout(() => {
          follow.current = null;
          void readRef.current();
        }, FOLLOW_MS);
      }
    } catch {
      /* The last read stays, and the chart says it is stale; the next one comes on its own. */
      setBehind(true);
    } finally {
      busy.current = false;
      setReading(false);
      setTried(true);
      setNow(Date.now());
    }
  }, [token]);

  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);
  useEffect(() => {
    if (initial === null) void read();
    else setNow(Date.now());
    /* The server drew a first answer: the rest of the history and the creator's own trades come with the next read. */
    if (initial !== null && initialFirst) {
      follow.current = window.setTimeout(() => {
        follow.current = null;
        void readRef.current();
      }, FOLLOW_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the page's first draw
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (follow.current !== null) window.clearTimeout(follow.current);
    };
  }, []);

  /* The creator's other launches, after the market: the page never waits for them. */
  const hasMarket = market !== null;
  useEffect(() => {
    if (hasMarket) void readLaunches();
  }, [hasMarket, readLaunches]);

  /* The market's health and its flight log read again when the trades or the way to the DEX change, never on their own clock. */
  const refresh = market ? `${market.trades.read}:${market.trades.rows[0]?.signature ?? ""}:${market.progress.migrated}` : null;
  const health = useMarketHealth(token, refresh);
  const journal = useFlightLog(token, refresh);
  /* The holders and the ten largest are said once, by «Здоров'я ринку»'s definitions: the market's own facts of them stand aside. */
  const facts = market ? pageRisk(market.risk) : [];
  const healthNow = healthOf(health.health);
  const healthFlags = holderFlags(healthNow);
  /* «Доказ запуску» (SOL-L3), drawn by the server in the marks' slot, states what this read holds with its links. */
  const proofRead = useMemo(() => ({ market, health: healthNow }), [market, healthNow]);
  const provide = (node: ReactNode) => <LaunchReadContext.Provider value={proofRead}>{node}</LaunchReadContext.Provider>;

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
  /* The chart's marks in words: a creator's buy and sale, as the legend over the chart says them. */
  const creatorWord = useMemo(() => ({ buy: word("chartLegendBuy"), sell: word("chartLegendSell") }), [word]);

  if (!market) {
    /* Not read: said so once, where the market would be, with one press to read again — the token's own blocks stay. */
    if (!(reading || !tried)) {
      return provide(
        <div className={styles.tokenLayout}>
          {slots.head ? <div className={styles.headSlot}>{slots.head}</div> : null}
          <div className={styles.slotChart}>
            <Unread text={word("marketUnread")} again={word("readAgain")} onAgain={() => void read()} lang={lang} />
          </div>
          <div className={styles.asideCol}>
            {slots.offer ? <div className={styles.slotOffer}>{slots.offer}</div> : null}
            <div className={styles.slotShare}>{slots.share}</div>
          </div>
          <div className={styles.mainCol}>
            <div className={styles.slotMarks}>{slots.marks}</div>
            {slots.constitution ? <div className={styles.slotMarks}>{slots.constitution}</div> : null}
            <div className={styles.slotAbout}>{slots.about}</div>
            <div className={styles.slotReceipt}>{slots.receipt}</div>
          </div>
        </div>,
      );
    }
    /* While the market is read: its skeleton in the market's own shape (SOL-P1). */
    return provide(<TokenMarketSkeleton locale={locale} symbol={symbol} slots={slots} />);
  }

  const price = formatPrice(market.price.usd ?? market.price.pair, locale);
  const moneyOf = (value: { pair: number; usd: number | null }) => formatMoneyShort(value.usd ?? value.pair, locale, value.usd !== null, market.pair.symbol);
  const nowSeconds = Math.floor(now / 1000);
  const launchedAt = market.chart.points[0]?.t ?? null;

  return provide(
    <div className={styles.tokenLayout}>
      <div className={styles.headSlot}>
        {slots.head}
        <div className={styles.priceBlock}>
          {/* The page's one number: the market cap, its move since the launch beside it — the sign says it, not only the colour. */}
          <HeroNumber
            label={word("marketCap")}
            value={moneyOf(market.marketCap)}
            change={{ value: formatMove(market.sinceLaunchBps, locale), direction: market.sinceLaunchBps > 0 ? "up" : market.sinceLaunchBps < 0 ? "down" : "flat" }}
            note={word("sinceLaunchNote")}
            lang={lang}
          />
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
            <Stat label={word("hHolders")} value={<HoldersFigure health={health.health} locale={locale} word={word} />} />
            <Stat label={word("age")} value={ageOf(market, nowSeconds, word)} />
          </dl>
        </div>
        {/* What is worth a look before a trade stands on the first screen, a word each; the sentences and reasons are in «Risk». */}
        <RiskStrip market={market} facts={facts} health={healthNow} healthReading={health.health === "reading"} locale={locale} word={word} now={nowSeconds} onAll={() => open("risk")} />
      </div>

      {/* In the order a person reads on a phone — the price, the chart, the trade, the sections — and the same order
          for a keyboard and a screen reader; on a desk the trade stands beside them. */}
      <Block title={word("chartTitle")} titleAs="h2" icon="chart-line" lang={lang} id="launch-chart" className={styles.slotChart}>
        <div className={styles.blockBar}><ul className={styles.legend}>
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
          {/* AI-06a: what moved this token's price — the assistant's side panel with the question asked (the Assistant line). */}
          <ExplainMove mint={token} symbol={symbol} locale={locale} /></div>
        <LaunchChart
          chart={market.chart}
          own={own}
          unit={market.pair.dollar ? "USD" : market.pair.symbol}
          observedAt={market.observedAt}
          stale={behind}
          lang={lang}
          creatorWord={creatorWord}
          ownWord={word("you")}
          dexWord={word("chartLegendDex")}
          label={`${word("chartTitle")} ${symbol}`}
        />
        {market.trades.rows.length === 0 && market.trades.complete ? <p className={styles.hint}>{word("chartNoTrades")}</p> : null}
      </Block>

      <div className={styles.asideCol}>
        {slots.offer ? <div className={styles.slotOffer}>{slots.offer}</div> : null}
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
        {/* The market's one line of risk stands under the action, on every section. */}
        <NoGuarantee locale={locale} />
        <div className={styles.slotShare} key={shareRound}>
          {slots.share}
        </div>
      </div>

      <div className={styles.mainCol} ref={sectionsRef}>
        <TabBar order={SECTIONS} value={section} onChange={(next) => open(next, false)} prefix="launch-sec" label={word("secLabel")} name={(entry) => word(SECTION_WORD[entry])} count={(entry) => (entry === "risk" ? facts.filter((fact) => fact.level === "attention").length + Number(healthFlags.concentrated) + Number(healthFlags.few) : 0)} countLabel={(n) => word("tabRiskCount", { n })} wide />

        {/* Every panel is in the page, the inactive ones hidden: each tab controls a panel that exists, and a link finds its anchor. */}
        <div role="tabpanel" id="launch-sec-overview-panel" aria-labelledby="launch-sec-overview" hidden={section !== "overview"} className={styles.sectionPanel}>
          <MarketEngine read={health} locale={locale} launchedAt={launchedAt} progressBps={market.progress.bps} />
          <RecentLog read={journal} locale={locale} symbol={symbol} onAll={() => open("activity")} />
          <div className={styles.slotAbout}>{slots.about}</div>
        </div>

        <div role="tabpanel" id="launch-sec-liquidity-panel" aria-labelledby="launch-sec-liquidity" hidden={section !== "liquidity"} className={styles.sectionPanel}>
          {/* On the curve its way to the DEX; once there, the pool is said in the survival, not as a full bar. */}
          {market.progress.migrated ? null : <Progress market={market} locale={locale} word={word} />}
          <div className={styles.liquidityGrid}>
            <div className={styles.liquidityMain}>
              <LadderCard read={journal} locale={locale} symbol={symbol} />
              <LiquidityHealth read={health} locale={locale} pool={market.progress.migrated ? market.trading.pool : null} />
            </div>
            {/* After the DEX, a holder's position in the pool — drawn only for a wallet the entry is open to, or one holding a position here. */}
            {market.progress.migrated ? <PoolPanel market={market} symbol={symbol} locale={locale} paused={paused} collectorRuns={collectorRunsOf(healthNow)} /> : null}
          </div>
        </div>

        <div role="tabpanel" id="launch-sec-risk-panel" aria-labelledby="launch-sec-risk" hidden={section !== "risk"} className={styles.sectionPanel}>
          <Block title={word("attentionTitle")} titleAs="h2" lang={lang} id="launch-attention">
            <div className={styles.blockBar}><span className={styles.cellSub}>{word("riskLede")}</span></div>
            <RiskList market={market} facts={facts} locale={locale} word={word} now={nowSeconds} creation={creation} />
          </Block>
          <RiskHealth read={health} locale={locale} marksShown={marksShown} />
          {/* The creator's other launches and what became of them: the context of a fact, beside the facts. */}
          <Creator market={market} launches={launches} locale={locale} word={word} onRead={() => void readLaunches()} />
          <div className={styles.slotMarks}>{slots.marks}</div>
          {slots.constitution ? <div className={styles.slotMarks}>{slots.constitution}</div> : null}
          <div className={styles.slotReceipt}>{slots.receipt}</div>
        </div>

        <div role="tabpanel" id="launch-sec-activity-panel" aria-labelledby="launch-sec-activity" hidden={section !== "activity"} className={styles.sectionPanel}>
          <FlightLog read={journal} locale={locale} symbol={symbol} />
          <Block title={word("activityLabel")} titleAs="h2" lang={lang} className={styles.slotTabs}>
            <TabBar order={LISTS} value={list} onChange={setList} prefix="launch-tab" label={word("activityLabel")} name={(entry) => word(LIST_WORD[entry])} />
            <div role="tabpanel" id="launch-tab-trades-panel" aria-labelledby="launch-tab-trades" hidden={list !== "trades"} className={styles.tabPanel}>
              <Trades market={market} wallet={wallet} locale={locale} word={word} now={nowSeconds} symbol={symbol} />
            </div>
            <div role="tabpanel" id="launch-tab-holders-panel" aria-labelledby="launch-tab-holders" hidden={list !== "holders"} className={styles.tabPanel}>
              <Holders market={market} health={health.health} wallet={wallet} locale={locale} word={word} now={nowSeconds} />
            </div>
          </Block>
        </div>
      </div>
      {tradePassed ? (
        <Button
          variant="primary"
          className={styles.tradeJump}
          lang={lang}
          onClick={() => {
            tradeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
            tradeRef.current?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.focus({ preventScroll: true });
          }}
        >
          {word("tradeJump", { symbol })}
        </Button>
      ) : null}
    </div>,
  );
}

/** The curve's way to the DEX, or the pool it trades in once there. */
function Progress({ market, locale, word }: { market: LaunchMarketResponse; locale: WorkspaceLocale; word: Word }) {
  return (
    <Block title={market.progress.migrated ? word("graduated") : word("progress")} titleAs="h2" lang={coreLang(locale)} id="launch-progress" className={styles.slotProgress}>
      <p className={styles.progressValue}>{formatBps(market.progress.bps, locale)}</p>
      <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(market.progress.bps / 100)} aria-label={market.progress.migrated ? word("graduated") : word("progress")}>
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
    </Block>
  );
}

/** The creator: their address, how many tokens they made on Meteora, and their other launches on Ryntra with what became of each. */
function Creator({
  market,
  launches,
  locale,
  word,
  onRead,
}: {
  market: LaunchMarketResponse;
  launches: LaunchCreatorResponse | "reading" | "failed";
  locale: WorkspaceLocale;
  word: Word;
  onRead: () => void;
}) {
  return (
    <Block title={word("creatorTitle")} titleAs="h2" lang={coreLang(locale)} id="launch-creator" className={styles.slotCreator}>
      <div className={styles.blockBar}><a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(market.network, "account", market.creator.address)} target="_blank" rel="noreferrer noopener">
          {shortAddress(market.creator.address)} <ArrowSquareOut size={12} aria-hidden />
        </a>
        <Link className={styles.markLink} href={`/app/launch/creator/${market.creator.address}`} prefetch={false}>
          {cabinetWords(locale)("creatorProfileLink")}
        </Link></div>
      {market.creator.curves !== null ? <p className={styles.hint}>{word("creatorCurves", { n: Math.max(0, market.creator.curves - 1) })}</p> : null}
      {launches === "reading" ? (
        <p className={styles.unread}>
          <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("creatorReading")}
        </p>
      ) : launches === "failed" ? (
        <div className={styles.unreadRow}>
          <p className={styles.unread}>{word("creatorUnread")}</p>
          <Button variant="ghost" onClick={onRead} lang={coreLang(locale)}>
            {word("readAgain")}
          </Button>
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
    </Block>
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

/** Under the price, a word each: every fact worth a look but «the creator sold» (its own chip, first), and a history read in part. */
const inAttention = (fact: LaunchRiskFactView) => (fact.level === "attention" && fact.code !== "CREATOR_SOLD") || fact.code === "HISTORY_PARTIAL";

/** A fact's word under the price: its own short word, with the variants its sentence has. */
function chipKey(fact: LaunchRiskFactView): LaunchWordKey {
  if (fact.code === "CREATOR_SOLD" && fact.values.soldBps === undefined) return "riskChip_CREATOR_SOLD_SUPPLY";
  if (fact.code === "BUNDLE_HOLDS" && fact.values.atLeast) return "riskChip_BUNDLE_HOLDS_AT_LEAST";
  if (fact.code === "HISTORY_PARTIAL" && !fact.values.trades) return "riskChip_HISTORY_UNREAD";
  return `riskChip_${fact.code}` as LaunchWordKey;
}

/**
 * The facts worth a look before a trade, on the first screen: «the creator sold» first and to its transaction, then each
 * fact in a word — its sentence and reason in its title and, written out, in «Risk», one press away. A sale not read is
 * not «did not sell»: said in its own quiet word.
 */
function RiskStrip({
  market,
  facts: all,
  health,
  locale,
  word,
  now,
  onAll,
  healthReading = false,
}: {
  market: LaunchMarketResponse;
  facts: readonly LaunchRiskFactView[];
  health: LaunchMarketHealthResponse | null;
  /** The market's health is still read: its flags may come yet. */
  healthReading?: boolean;
  locale: WorkspaceLocale;
  word: Word;
  now: number;
  onAll: () => void;
}) {
  const sold = all.find((fact) => fact.code === "CREATOR_SOLD") ?? null;
  const facts = all.filter(inAttention);
  const salesUnread = !sold && !market.creator.tradesComplete;
  const flags = holderFlags(health);
  /* Nothing to say yet while the health is still read: the line keeps its place, so the page does not move when it comes (SOL-P1). */
  if (!sold && !facts.length && !salesUnread && !flags.concentrated && !flags.few) return healthReading ? <div className={styles.stripSkeleton} aria-hidden /> : null;
  return (
    <div className={styles.riskStrip} role="group" aria-labelledby="launch-strip">
      <span id="launch-strip" className={styles.stripLabel}>
        <Warning size={16} weight="fill" aria-hidden /> {word("stripLabel")}
      </span>
      {/* Below a wide desk the chips scroll sideways: the row takes the keyboard and says what it is. */}
      <ul className={styles.stripChips} tabIndex={0} aria-label={word("stripLabel")}>
        {sold ? (
          <li>
            <a
              className={styles.stripChip}
              data-tone="sold"
              href={sold.source ? explorerUrl(market.network, sold.source.kind, sold.source.id) : undefined}
              target="_blank"
              rel="noreferrer noopener"
              title={`${word(riskKey(sold), riskValues(sold, locale, word, now))}${sold.values.at ? ` · ${word("creatorSoldWhen", { ago: agoText(word, Math.max(0, now - sold.values.at)) })}` : ""}`}
            >
              {word(chipKey(sold), riskValues(sold, locale, word, now))} <ArrowSquareOut size={12} aria-hidden />
            </a>
          </li>
        ) : null}
        {facts.map((fact) => (
          <li key={fact.code}>
            <span className={styles.stripChip} data-tone={fact.level} title={`${word(riskKey(fact), riskValues(fact, locale, word, now))}. ${word(`riskWhy_${fact.code}` as LaunchWordKey)}`}>
              {word(chipKey(fact), riskValues(fact, locale, word, now))}
            </span>
          </li>
        ))}
        {health && flags.concentrated && health.concentration.top10Bps !== null ? (
          <li>
            <span className={styles.stripChip} data-tone="attention" title={word(health.concentration.atLeast ? "hTop10AtLeast" : "hTop10", { pct: formatBps(health.concentration.top10Bps, locale) })}>
              {word("chipTop10", { pct: `${health.concentration.atLeast ? "≥ " : ""}${formatBps(health.concentration.top10Bps, locale)}` })}
            </span>
          </li>
        ) : null}
        {health && flags.few ? (
          <li>
            <span className={styles.stripChip} data-tone="attention" title={word("hFewHolders", { n: FEW_HOLDERS })}>
              {word("riskChip_FEW_HOLDERS")}
            </span>
          </li>
        ) : null}
        {salesUnread ? (
          <li>
            <span className={styles.stripChip} data-tone="info" title={word("creatorSalesUnread")}>
              {word("chipCreatorSalesUnread")}
            </span>
          </li>
        ) : null}
      </ul>
      <button type="button" className={styles.stripAll} onClick={onAll}>
        {word("attentionAll")} <CaretRight size={12} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Whether Ryntra's collector makes its rounds on this market now: the executor acts — its passes fresh — and the operator
 * has not stopped it here (the collector skips a stopped market). Null while the market's health, or whether the executor
 * acts, is not read.
 */
function collectorRunsOf(health: LaunchMarketHealthResponse | null): boolean | null {
  if (!health) return null;
  if (health.engine.pause?.code === "OPERATOR") return false;
  /* Whether the executor acts was not read now: not said as a collector that does not run (1.47.0). */
  if (health.engine.actsUnread) return null;
  return health.engine.acts;
}

/** Defined once, by «Здоров'я ринку»: the market's own facts of the holders and the ten largest stand aside for its figures. */
const HEALTH_DEFINED: ReadonlySet<LaunchRiskFactView["code"]> = new Set(["TOP10_HOLD", "FEW_HOLDERS", "HOLDERS_UNCOUNTED"]);
const pageRisk = (facts: readonly LaunchRiskFactView[]) => facts.filter((fact) => !HEALTH_DEFINED.has(fact.code));

/** What «Здоров'я ринку» marks worth a look among the holders: the ten largest over its mark, and a thin market by its count. */
function holderFlags(health: LaunchMarketHealthResponse | null): Readonly<{ concentrated: boolean; few: boolean }> {
  if (!health) return { concentrated: false, few: false };
  const count = health.holders.count;
  return { concentrated: health.concentration.marked === true, few: count !== null && !health.holders.atLeast && count < FEW_HOLDERS };
}

/** The holders over $1 as «Здоров'я ринку» counts them: a floor with «+», «not read» when not read — never a count of something else. */
function HoldersFigure({ health, locale, word }: { health: HealthRead; locale: WorkspaceLocale; word: Word }) {
  const read = healthOf(health);
  if (!read || read.holders.count === null) return <span className={styles.statUnread}>{word(health === "reading" ? "reading" : "groupUnread")}</span>;
  return <>{`${formatCountShort(read.holders.count, locale)}${read.holders.atLeast ? "+" : ""}`}</>;
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

/**
 * A row of tabs, each controlling a panel that exists: the arrows move between them as a tab list's keys do, the open one
 * takes the Tab key. A count beside a tab — the facts worth a look — is drawn for the eye and said in words.
 */
function TabBar<T extends string>({
  order,
  value,
  onChange,
  prefix,
  label,
  name,
  count,
  countLabel,
  wide = false,
}: {
  order: readonly T[];
  value: T;
  onChange: (next: T) => void;
  prefix: string;
  label: string;
  name: (entry: T) => string;
  count?: (entry: T) => number;
  countLabel?: (n: number) => string;
  /** The page's sections: a bar of its own above the panels, not a control inside a card. */
  wide?: boolean;
}) {
  const move = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = rovingNext(order, value, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    document.getElementById(`${prefix}-${next}`)?.focus();
  };
  return (
    <div className={wide ? styles.sectionTabs : styles.tabs} role="tablist" aria-label={label}>
      {order.map((entry) => {
        const n = count?.(entry) ?? 0;
        return (
          <button
            key={entry}
            id={`${prefix}-${entry}`}
            type="button"
            role="tab"
            aria-selected={value === entry}
            aria-controls={`${prefix}-${entry}-panel`}
            tabIndex={value === entry ? 0 : -1}
            className={wide ? styles.sectionTab : styles.tab}
            onClick={() => onChange(entry)}
            onKeyDown={move}
          >
            {name(entry)}
            {n > 0 ? (
              <>
                <span className={styles.tabCount} aria-hidden>
                  {n}
                </span>
                {countLabel ? <span className={styles.visuallyHidden}>, {countLabel(n)}</span> : null}
              </>
            ) : null}
          </button>
        );
      })}
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
  /* A trade's time of day in the reader's own zone: drawn once the page has hydrated (SOL-P1). */
  const hydrated = useHydrated();
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
                <a href={explorerUrl(market.network, "tx", row.signature)} target="_blank" rel="noreferrer noopener" title={hydrated ? new Date(row.at).toLocaleString(locale === "uk" ? "uk-UA" : "en-US") : undefined}>
                  {agoText(word, Math.max(0, now - Math.floor(Date.parse(row.at) / 1000)))}
                  <ArrowSquareOut size={12} aria-hidden />
                </a>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {all.length > shown ? (
        <Button variant="ghost" onClick={() => setShown((count) => count + TRADES_PAGE)}>
          {word("tradesMore", { n: Math.min(TRADES_PAGE, all.length - shown) })}
        </Button>
      ) : null}
    </>
  );
}

function Holders({ market, health, wallet, locale, word, now }: { market: LaunchMarketResponse; health: HealthRead; wallet: string | null; locale: WorkspaceLocale; word: Word; now: number }) {
  const groups = market.holders.groups;
  /* The ten largest and the count by «Здоров'я ринку»'s definitions — the same figures as the risk and the open API. */
  const read = healthOf(health);
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
          <span className={styles.groupValue} data-unread={read?.concentration.top10Bps != null ? undefined : ""}>
            {read?.concentration.top10Bps != null
              ? `${read.concentration.atLeast ? "≥ " : ""}${formatBps(read.concentration.top10Bps, locale)}`
              : word(health === "reading" ? "reading" : read && !read.holders.atLeast ? "hNoCirculating" : "groupUnread")}
          </span>
        </li>
      </ul>
      <p className={styles.hint}>{word("labelLegend")} {word("holdersPeople")}{changes.size > 0 ? ` ${word("holdersChangeHint")}` : ""}</p>
      <p className={styles.hint}>
        {word("hHolders")}: <HoldersFigure health={health} locale={locale} word={word} />
      </p>
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

function RiskList({ market, facts, locale, word, now, creation }: { market: LaunchMarketResponse; facts: readonly LaunchRiskFactView[]; locale: WorkspaceLocale; word: Word; now: number; creation: string | null }) {
  return (
    <>
      <ul className={styles.riskList}>
        {facts.map((fact) => {
          /* A count over many holders is checked at the mint, which lists them all (SOL-L3): no fact of the token without its link. */
          const source = fact.source ?? riskFactEvidence(fact.code, { token: market.token, creator: market.creator.address, creation });
          return (
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
              {source ? (
                <a className={styles.markLink} href={explorerUrl(market.network, source.kind, source.id)} target="_blank" rel="noreferrer noopener">
                  {source.kind === "tx" ? word("sourceTx") : word("sourceAccount")} <ArrowSquareOut size={12} aria-hidden />
                </a>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

