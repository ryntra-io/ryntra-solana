"use client";

import { ArrowSquareOut, CaretDown } from "@phosphor-icons/react";
import { Block, Button, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { LaunchCabinetRow, LaunchStatsResponse } from "@/lib/api/v1/contract";
import type { WindowFigure } from "@/lib/core/launch/creator-stats";

import { coreLang, LinkButton } from "../launch-blocks";
import { explorerUrl, formatBps, formatDate, formatMoneyShort, formatRaw, shortAddress } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { cabinetWords } from "./cabinet-words";
import { countText, exact, launchPeriod, money, periodTotals, PERIODS, SOURCES, windowText, type EarnedSource, type Pair, type Period } from "./cabinet-figures";
import own from "./cabinet.module.css";

/**
 * The creator's cabinet in figures (SOL-L2): what the launches earned by source over the day, the week and all time;
 * the launches side by side; on each launch its market, its market after the DEX, the creator's own trades and lock;
 * the notifications and the public profile. Every figure is the chain's, and one not read is said so — never a zero.
 */

export type StatsRead = LaunchStatsResponse | "unread" | undefined;

const API_HEADERS = { "X-Ryntra-API": "1" } as const;

/** A figure, or «not read» / «reading…» in the quieter shade. */
function Figure({ text, reading, locale }: { text: string | null; reading?: boolean; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  if (text !== null) return <>{text}</>;
  return <span className={styles.statUnread}>{word(reading ? "periodReading" : "periodUnread")}</span>;
}

type SourceRow = Readonly<{ key: EarnedSource | "total"; label: string; figures: Readonly<Record<Period, WindowFigure | null>> }>;

/** A launch's surplus is shown where there is one: a curve stopped exactly at its threshold has none. */
const holdsSurplus = (figure: WindowFigure | undefined) => Boolean(figure && figure.raw !== null && BigInt(figure.raw) > 0n);

/**
 * What the launches earned — one table a currency: the sources in rows, the day, the week and all time in columns. A
 * period with a launch or a source not read is a floor («≥») or «not read», and says so under the table.
 */
export function EarnedBySource({
  rows,
  stats,
  locale,
}: {
  rows: readonly LaunchCabinetRow[];
  stats: Readonly<Record<string, StatsRead>>;
  locale: WorkspaceLocale;
}) {
  const word = cabinetWords(locale);
  const lang = coreLang(locale);
  const reading = rows.some((row) => stats[row.token] === undefined);
  const totals = PERIODS.map((period) => ({ period, totals: periodTotals(rows, stats, period) }));
  const pairs = totals[2]!.totals.map((entry) => entry.pair);
  return (
    <>
      {pairs.map((pair) => {
        const of = (period: Period) => totals.find((entry) => entry.period === period)!.totals.find((entry) => entry.pair.mint === pair.mint)!;
        const sourceRows: SourceRow[] = [
          ...SOURCES.map((source) => ({ key: source, label: word(`short_${source}`), figures: { day: of("day").sources[source], week: of("week").sources[source], all: of("all").sources[source] } })),
          /* The surplus is one amount, once the curve is full: all time only, a dash in the day's and the week's windows. */
          ...(holdsSurplus(of("all").sources.surplus) ? [{ key: "surplus" as const, label: word("short_surplus"), figures: { day: null, week: null, all: of("all").sources.surplus ?? null } }] : []),
          { key: "total" as const, label: word("totalRow"), figures: { day: of("day").total, week: of("week").total, all: of("all").total } },
        ];
        const partly = PERIODS.some((period) => of(period).total.atLeast || of(period).unread > 0);
        const columns: TableColumn<SourceRow>[] = [
          { key: "label", label: word("sourceColumn"), render: (row) => (row.key === "total" ? <b>{row.label}</b> : row.label) },
          ...PERIODS.map(
            (period): TableColumn<SourceRow> => ({
              key: period,
              label: word(`period_${period}`),
              numeric: true,
              render: (row) => {
                const figure = row.figures[period];
                if (figure === null) return <span className={styles.statUnread} title={word("surplusOnce")}>—</span>;
                const text = <Figure text={windowText(figure, pair, locale)} reading={reading && period !== "all"} locale={locale} />;
                return row.key === "total" ? <b>{text}</b> : text;
              },
            }),
          ),
        ];
        return (
          <div key={pair.mint} className={`${own.sources} ${own.fit} ${own.tight}`}>
            <Table caption={`${word("sourcesTitle")} · ${pair.symbol}`} columns={columns} rows={sourceRows} rowKey={(row) => row.key} lang={lang} />
            {partly && !reading ? <p className={styles.hint}>{word("periodPartly")}</p> : null}
            {sourceRows.some((row) => row.key === "surplus") ? <p className={styles.hint}>{word("surplusOnce")}</p> : null}
          </div>
        );
      })}
    </>
  );
}

type CompareRow = Readonly<{ row: LaunchCabinetRow; stats: LaunchStatsResponse | null; read: StatsRead }>;

/** The launches side by side — the core's table, sortable; a row opens the token's page. */
export function CompareLaunches({ rows, stats, locale }: { rows: readonly LaunchCabinetRow[]; stats: Readonly<Record<string, StatsRead>>; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const lang = coreLang(locale);
  const router = useRouter();
  const data: CompareRow[] = rows.map((row) => {
    const read = stats[row.token];
    return { row, read, stats: read && read !== "unread" ? read : null };
  });
  const figure = (entry: CompareRow, text: string | null) => <Figure text={text} reading={entry.read === undefined} locale={locale} />;
  const earned = (entry: CompareRow, period: Period) => {
    const figures = launchPeriod(entry.row, entry.stats, period);
    if (!figures) return null;
    const parts = [...SOURCES.map((source) => figures[source]), ...(figures.surplus ? [figures.surplus] : [])];
    if (parts.some((part) => part.raw === null)) return null;
    const raw = parts.reduce((total, part) => total + BigInt(part.raw!), 0n);
    return { raw, text: `${parts.some((part) => part.atLeast) ? "≥ " : ""}${money(raw, entry.row.pair, locale)}` };
  };
  const columns: TableColumn<CompareRow>[] = [
    {
      key: "token",
      label: word("colToken"),
      sortable: true,
      sortValue: (entry) => entry.row.symbol,
      render: (entry) => <b>${entry.row.symbol}</b>,
    },
    {
      key: "way",
      label: word("colWay"),
      numeric: true,
      sortable: true,
      sortValue: (entry) => entry.row.progressBps ?? -1,
      render: (entry) => figure(entry, entry.row.migrated ? word("onDex") : entry.row.progressBps === null ? null : formatBps(entry.row.progressBps, locale)),
    },
    {
      key: "holders",
      label: word("colHolders"),
      numeric: true,
      sortable: true,
      sortValue: (entry) => entry.stats?.holders.count ?? -1,
      render: (entry) => figure(entry, entry.stats ? countText(entry.stats.holders, locale) : null),
    },
    {
      key: "traders",
      label: `${word("colTraders")} · ${word("colRepeat")}`,
      numeric: true,
      sortable: true,
      sortValue: (entry) => entry.stats?.traders.count ?? -1,
      render: (entry) => {
        const traders = entry.stats ? countText(entry.stats.traders, locale) : null;
        const repeat = entry.stats ? countText(entry.stats.repeatTraders, locale) : null;
        return figure(entry, traders === null ? null : `${traders} · ${repeat ?? "—"}`);
      },
    },
    {
      key: "volume",
      label: word("colVolumeWeek"),
      numeric: true,
      sortable: true,
      sortValue: (entry) => Number(entry.stats?.volume.week.raw ?? -1),
      render: (entry) => figure(entry, entry.stats ? windowText(entry.stats.volume.week, entry.row.pair, locale) : null),
    },
    {
      key: "earnedWeek",
      label: word("colEarnedWeek"),
      numeric: true,
      sortable: true,
      sortValue: (entry) => Number(earned(entry, "week")?.raw ?? -1n),
      render: (entry) => figure(entry, earned(entry, "week")?.text ?? null),
    },
    {
      key: "earnedAll",
      label: word("colEarnedAll"),
      numeric: true,
      sortable: true,
      sortValue: (entry) => Number(earned(entry, "all")?.raw ?? -1n),
      render: (entry) => figure(entry, earned(entry, "all")?.text ?? null),
    },
  ];
  return (
    <Block title={word("compareTitle")} icon="chart-column" titleAs="h2" lang={lang}>
      <Table
        caption={word("compareCaption")}
        columns={columns}
        rows={data}
        rowKey={(entry) => entry.row.token}
        defaultSort={{ key: "earnedAll", direction: "desc" }}
        onRowClick={(entry) => router.push(`/app/launch/${entry.row.token}`)}
        rowLabel={(entry) => `${entry.row.name} $${entry.row.symbol}`}
        lang={lang}
      />
    </Block>
  );
}

/** A launch's market in the card: holders, traders and those who came back, the volume, the liquidity. */
export function LaunchMarketFigures({ row, read, locale }: { row: LaunchCabinetRow; read: StatsRead; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const stats = read && read !== "unread" ? read : null;
  const reading = read === undefined;
  const pair = row.pair;
  const cell = (label: string, text: string | null) => (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        <Figure text={text} reading={reading} locale={locale} />
      </dd>
    </div>
  );
  const traders = stats ? countText(stats.traders, locale) : null;
  const repeat = stats ? countText(stats.repeatTraders, locale) : null;
  return (
    <dl className={own.marketStats}>
      {cell(word("statHolders"), stats ? countText(stats.holders, locale) : null)}
      {cell(word("statTraders"), traders === null ? null : `${traders} · ${repeat ?? "—"}`)}
      {cell(word("statVolumeDay"), stats ? windowText(stats.volume.day, pair, locale) : null)}
      {cell(word("statVolumeWeek"), stats ? windowText(stats.volume.week, pair, locale) : null)}
      {cell(word("statLiquidity"), stats ? formatMoneyShort(stats.liquidity.pair, locale, pair.dollar, pair.symbol) : null)}
      {cell(word("statMarketCap"), stats ? formatMoneyShort(stats.marketCap.pair, locale, pair.dollar, pair.symbol) : null)}
    </dl>
  );
}

/** Where a launch's fees came from over the day, the week and all time — the wallet's part. */
export function LaunchSources({ row, read, locale }: { row: LaunchCabinetRow; read: StatsRead; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const launch = launchWords(locale);
  const lang = coreLang(locale);
  const stats = read && read !== "unread" ? read : null;
  const byPeriod = Object.fromEntries(PERIODS.map((period) => [period, launchPeriod(row, stats, period)])) as Record<Period, ReturnType<typeof launchPeriod>>;
  /* The surplus row only where the launch has one: all time only, the day's and the week's windows hold none. */
  const surplus = byPeriod.all?.surplus;
  const sourceRows: { source: EarnedSource; label: string }[] = [...SOURCES.map((source) => ({ source, label: word(`short_${source}`) })), ...(holdsSurplus(surplus) ? [{ source: "surplus" as const, label: word("short_surplus") }] : [])];
  const columns: TableColumn<(typeof sourceRows)[number]>[] = [
    { key: "label", label: word("sourceColumn") },
    ...PERIODS.map(
      (period): TableColumn<(typeof sourceRows)[number]> => ({
        key: period,
        label: word(`period_${period}`),
        numeric: true,
        render: (entry) => {
          const figures = byPeriod[period];
          /* A source a curve still on its way cannot have yet: said so, not as a zero. */
          if ((entry.source === "graduation" || entry.source === "lp") && row.migrated === false) return <span className={styles.statUnread}>—</span>;
          if (entry.source === "surplus") return period === "all" && figures?.surplus ? <>{windowText(figures.surplus, row.pair, locale)}</> : <span className={styles.statUnread} title={word("surplusOnce")}>—</span>;
          return <Figure text={figures ? windowText(figures[entry.source], row.pair, locale) : null} reading={read === undefined && period !== "all"} locale={locale} />;
        },
      }),
    ),
  ];
  return (
    <div className={`${own.fit} ${own.tight}`}>
      <Table caption={`${launch("mineBreakdown")} · $${row.symbol}`} columns={columns} rows={sourceRows} rowKey={(entry) => entry.source} lang={lang} />
      {sourceRows.some((entry) => entry.source === "surplus") ? <p className={styles.hint}>{word("surplusOnce")}</p> : null}
    </div>
  );
}

/** After the DEX: the depth ±2 %, the pool's fees and the creator's locked share of the pool — each to its account. */
export function LaunchDexMarket({ stats, pair, locale }: { stats: LaunchStatsResponse; pair: Pair; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const market = stats.market;
  if (!market) return null;
  return (
    <details className={`${styles.details} ${own.fit}`}>
      <summary className={styles.summary}>
        {word("marketTitle")} <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <dl className={styles.rows}>
        <div className={styles.row} title={word("depthHint")}>
          <dt>{word("depthUp")}</dt>
          <dd>
            <Figure text={market.depth ? money(market.depth.upRaw, pair, locale) : null} locale={locale} />
          </dd>
        </div>
        <div className={styles.row} title={word("depthHint")}>
          <dt>{word("depthDown")}</dt>
          <dd>
            <Figure text={market.depth ? money(market.depth.downRaw, pair, locale) : null} locale={locale} />
          </dd>
        </div>
        <div className={styles.row}>
          <dt>{word("poolFeesDay")}</dt>
          <dd>
            <Figure text={windowText(market.fees.day, pair, locale)} locale={locale} />
          </dd>
        </div>
        <div className={styles.row}>
          <dt>{word("poolFeesWeek")}</dt>
          <dd>
            <Figure text={windowText(market.fees.week, pair, locale)} locale={locale} />
          </dd>
        </div>
        <div className={styles.row}>
          <dt>{word("lpShare")}</dt>
          <dd>
            <Figure text={market.lpShareBps === null ? null : word("lpShareValue", { pct: formatBps(market.lpShareBps, locale) })} locale={locale} />
          </dd>
        </div>
      </dl>
      <p className={own.links}>
        {stats.links.pool ? <ChainLink network={stats.network} id={stats.links.pool} label={word("viewPool")} /> : null}
        {stats.links.position ? <ChainLink network={stats.network} id={stats.links.position} label={word("viewPosition")} /> : null}
      </p>
    </details>
  );
}

function ChainLink({ network, id, label, kind = "account" }: { network: LaunchStatsResponse["network"]; id: string; label: string; kind?: "account" | "tx" }) {
  return (
    <a className={styles.markLink} href={explorerUrl(network, kind, id)} target="_blank" rel="noreferrer noopener">
      {label} <span className={styles.addr}>{shortAddress(id)}</span> <ArrowSquareOut size={12} aria-hidden />
    </a>
  );
}

/** The creator's own buys and sales of the token, each sale to its transaction, and the lock of their first buy. */
export function LaunchOwnTrades({ stats, pair, locale }: { stats: LaunchStatsResponse; pair: Pair; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const trades = stats.creatorTrades;
  const tokens = (raw: string) => formatRaw(raw, stats.tokenDecimals, locale, 0);
  /* Read in part, what the creator bought and sold is a floor. */
  const floor = trades.complete ? "" : "≥ ";
  const lock = stats.lock;
  const soldLine =
    trades.soldBps === null ? null : trades.soldBps === 0 ? word("soldNone") : word(trades.soldOf === "supply" ? "soldShareSupply" : "soldShare", { pct: formatBps(trades.soldBps, locale) });
  return (
    <details className={`${styles.details} ${own.fit}`}>
      <summary className={styles.summary}>
        {word("tradesTitle")} <CaretDown size={14} aria-hidden className={styles.caret} />
      </summary>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>{word("bought")}</dt>
          <dd>{`${floor}${tokens(trades.boughtRaw)}`}</dd>
        </div>
        <div className={styles.row}>
          <dt>{word("sold")}</dt>
          <dd>
            {`${floor}${tokens(trades.soldRaw)}`}
            {soldLine ? <span className={styles.mineLeft}>{soldLine}</span> : null}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>{word("lockTitle")}</dt>
          <dd>
            {!lock
              ? word("lockNone")
              : lock.state === "PENDING"
                ? word("lockPending")
                : lock.state === "FAILED"
                  ? word("lockFailed")
                  : lock.lockedRaw === null
                    ? word("lockAmountUnread")
                    : word("lockLocked", { amount: tokens(lock.lockedRaw), date: formatDate(lock.cliffAt, locale) })}
            {lock?.state === "LOCKED" ? <span className={styles.mineLeft}>{word("lockUntil", { date: formatDate(lock.endAt, locale) })}</span> : null}
          </dd>
        </div>
      </dl>
      {!trades.complete ? <p className={styles.hint}>{word("soldPartly")}</p> : null}
      {trades.sales.length ? (
        <ul className={own.sales}>
          {trades.sales.map((sale) => (
            <li key={sale.signature}>
              <a className={styles.markLink} href={explorerUrl(stats.network, "tx", sale.signature)} target="_blank" rel="noreferrer noopener">
                {formatDate(sale.at, locale)} · {word("saleRow", { tokens: tokens(sale.tokensRaw), pair: exact(sale.pairRaw, pair, locale) })} <ArrowSquareOut size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {stats.links.lock ? (
        <p className={own.links}>
          <ChainLink network={stats.network} id={stats.links.lock} label={word("viewLock")} />
        </p>
      ) : null}
    </details>
  );
}

type Channel = Readonly<{ status: "unknown" | "none" | "connected"; username: string | null }>;

/** What the creator is told and where: always in the app, in Telegram once connected — read for the proven wallet only. */
export function NotesBlock({ locale }: { locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const lang = coreLang(locale);
  const proof = useWalletProof();
  const proven = proof.state.status === "proven";
  const [channel, setChannel] = useState<Channel>({ status: "unknown", username: null });
  useEffect(() => {
    if (!proven) {
      setChannel({ status: "unknown", username: null });
      return;
    }
    let live = true;
    fetch("/api/v1/notifications/telegram", { headers: API_HEADERS })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { telegram?: { connected?: boolean; username?: string | null } } | null;
        if (!live) return;
        /* A refused read says nothing of the channel: unknown, never «not connected». */
        if (!response.ok) return setChannel({ status: "unknown", username: null });
        const connected = body?.telegram?.connected === true;
        setChannel({ status: connected ? "connected" : "none", username: connected ? (body?.telegram?.username ?? null) : null });
      })
      .catch(() => {
        if (live) setChannel({ status: "unknown", username: null });
      });
    return () => {
      live = false;
    };
  }, [proven]);
  return (
    <Block title={word("notesTitle")} titleAs="h2" lang={lang} action={<LinkButton href="/app/alerts">{word("notesAll")}</LinkButton>}>
      <div className={styles.blockStack}>
        <p className={styles.hint}>{word("notesWhat")}</p>
        <ul className={own.channels}>
          <li>{word("notesInApp")}</li>
          <li>
            {channel.status === "connected"
              ? word("notesTelegramOn", { user: channel.username ? ` · @${channel.username}` : "" })
              : channel.status === "none"
                ? word("notesTelegramOff")
                : word("notesTelegramUnknown")}
            {channel.status === "none" ? (
              <>
                {" "}
                <Link className={styles.markLink} href="/app/settings" prefetch={false}>
                  {word("notesConnect")}
                </Link>
              </>
            ) : null}
          </li>
        </ul>
      </div>
    </Block>
  );
}

/** The creator's public profile: one link to open or copy. */
export function ProfileBlock({ wallet, locale }: { wallet: string; locale: WorkspaceLocale }) {
  const word = cabinetWords(locale);
  const lang = coreLang(locale);
  const [copied, setCopied] = useState(false);
  const href = `/app/launch/creator/${wallet}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Block title={word("profileTitle")} titleAs="h2" lang={lang}>
      <div className={styles.blockStack}>
        <p className={styles.hint}>{word("profileLine")}</p>
        <div className={styles.mineActions}>
          <LinkButton href={href}>{word("profileOpen")}</LinkButton>
          <Button variant="ghost" onClick={() => void copy()} lang={lang} aria-live="polite">
            {copied ? word("profileCopied") : word("profileCopy")}
          </Button>
        </div>
      </div>
    </Block>
  );
}
