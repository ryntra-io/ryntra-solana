"use client";

import { CheckCircle, ImageSquare, Lock, TrendDown } from "@phosphor-icons/react";
import { NAV_WORDS } from "@ryntra/core/nav";
import { Block, EmptyState, Page, Skeleton, Table, type TableColumn } from "@ryntra/core/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchMarketRow, LaunchMarketsResponse } from "@/lib/api/v1/contract";

import { coreLang, LinkButton, Unread } from "../launch-blocks";
import { formatBps, formatCountShort, formatMoneyShort } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { daysText, pairMoney, shortDate, sinceShort, sinceText, stateTone } from "../market-view";
import { useHydrated } from "../use-hydrated";
import { publicLaunchMarkets } from "./public-markets";
import { SurvivalBlock } from "./survival-block";

type Word = ReturnType<typeof launchWords>;

const API_HEADERS = { "X-Ryntra-API": "1" } as const;
/** How often the list is read again while it is in view — sooner while some market was not read yet, so its row fills in. */
const REFRESH_MS = 60_000;
const FILL_MS = 8_000;
/** For this long after the page opens a market not read yet is «reading»; after it, each of its figures says «not read». */
const READING_MS = 60_000;

/** The states of a full curve not yet on the DEX: it takes no sale until it moves. */
const FULL_CURVE: ReadonlySet<NonNullable<LaunchMarketRow["state"]>["code"]> = new Set(["GRADUATION_READY", "MIGRATING", "MIGRATION_FAILED"]);

/**
 * «Лаунчі на Ryntra»: a row per market launched on Ryntra, in the data's own
 * order — the markets traded in the last day first. Read from the server's
 * list of the chain; every figure the chain did not give is said as not read,
 * never as zero. One block of the core with the core's table in it: on a phone
 * the table scrolls sideways inside its block, the token's name standing still.
 * Drawn by the server with its list (SOL-P1) and again in the browser: its
 * «ago» counts from the server's moment until the page is up, its dates are
 * in the reader's own zone once it has hydrated.
 */
export function MarketsBoard({
  locale,
  network,
  initial = null,
  renderedAt,
}: {
  locale: WorkspaceLocale;
  network: "solana:devnet" | "solana:mainnet";
  /** The server's list, drawn with the page (SOL-P1); null — the browser reads it. */
  initial?: LaunchMarketsResponse | null;
  /** The server's clock when it drew the page: the first draw in the browser counts from the same moment. */
  renderedAt?: number;
}) {
  const word = launchWords(locale);
  const lang = coreLang(locale);
  const [list, setList] = useState<LaunchMarketsResponse | null>(initial);
  const [state, setState] = useState<"reading" | "ready" | "failed">(initial ? "ready" : "reading");
  const busy = useRef(false);
  const [now, setNow] = useState(() => renderedAt ?? Date.now());
  const [opened] = useState(() => renderedAt ?? Date.now());
  const router = useRouter();

  const read = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch("/api/v1/launch/markets", { headers: API_HEADERS, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setList((await response.json()) as LaunchMarketsResponse);
      setState("ready");
    } catch {
      /* The last list stays; with none, the page says it could not read. */
      setState((before) => (before === "ready" ? "ready" : "failed"));
    } finally {
      busy.current = false;
      setNow(Date.now());
    }
  }, []);

  /* The server's list is the first read; without it the browser reads at once. */
  const drawnWith = useRef(initial !== null);
  useEffect(() => {
    if (drawnWith.current) setNow(Date.now());
    else void read();
  }, [read]);

  const complete = list?.complete ?? false;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, complete ? REFRESH_MS : FILL_MS);
    return () => window.clearInterval(timer);
  }, [read, complete]);

  /* People's launches only: the team's technical validations are not on a public board (B15). */
  const markets = publicLaunchMarkets(list?.markets ?? []);
  /* The oldest read among the rows read: every figure is at least this fresh. */
  const reads = markets.filter((row) => row.read).map((row) => Date.parse(row.observedAt));
  const oldestRead = reads.length ? new Date(Math.min(...reads)).toISOString() : null;
  const columns = marketColumns({ locale, word, now, reading: now - opened < READING_MS });
  return (
    <Page
      kind="overview"
      className={styles.corePage}
      title={
        <>
          {NAV_WORDS[locale].items.launch}
          {network === "solana:devnet" ? <span className={styles.netChip}>{word("devnet")}</span> : null}
        </>
      }
      /* «Мої лаунчі» and the launch form stand under the row «Лаунч» (Menu 3, NAV-1): no tab above the page leads there. */
      action={
        <div className={styles.boardActions}>
          <LinkButton href="/app/launch/mine">{word("mineTitle")}</LinkButton>
          <LinkButton href="/app/launch/new" variant="primary">
            {word("title")}
          </LinkButton>
        </div>
      }
      help={`${word("marketsLede")} ${word("marketsOrder")}`}
    >
      {list === null ? (
        state === "reading" ? (
          /* The same block and bars as the route's skeleton (`launch-loading.tsx`), so the board does not change shape twice. */
          <Block title={word("marketsTable")} titleAs="h2" icon="chart-column" lang={lang} aria-live="polite" aria-busy="true">
            <Skeleton lines={6} label={word("marketsReading")} />
          </Block>
        ) : (
          <Unread text={word("marketsUnread")} again={word("readAgain")} onAgain={() => void read()} lang={lang} />
        )
      ) : markets.length === 0 ? (
        /* The page's one orange action is «Запустити токен» beside the heading; the empty board offers the same way quietly. */
        <EmptyState
          icon="inbox"
          text={word("marketsEmpty")}
          data-launch-board="empty"
          action={<LinkButton href="/app/launch/new">{word("title")}</LinkButton>}
        />
      ) : (
        <Block title={word("marketsCount", { n: markets.length })} titleAs="h2" icon="chart-column" lang={lang}>
          <div className={styles.blockStack}>
            <p className={styles.marketsLegend}>
              <span className={styles.liveDot} aria-hidden /> {word("live")} — {word("liveHint").toLocaleLowerCase(locale === "uk" ? "uk-UA" : "en-US")}
            </p>
            {!list.complete ? <p className={styles.hint}>{word("marketsPartial")}</p> : null}
            <Table
              className={styles.marketsTable}
              caption={word("marketsTable")}
              columns={columns}
              rows={markets}
              rowKey={(row) => row.token}
              /* A press on a row opens its token — a selection of its text keeps its own way; the name is the link a new tab opens. */
              onRowClick={(row) => {
                if (window.getSelection()?.toString()) return;
                router.push(`/app/launch/${row.token}`);
              }}
              lang={lang}
            />
            {/* How the rows are ordered lives behind the page's «?»; under the table — only when it was read. */}
            {oldestRead ? <p className={styles.hint}>{word("marketsRead", { ago: sinceText(oldestRead, word, locale, now) })}.</p> : null}
            <p className={styles.noGuarantee}>{word("noGuarantee")}</p>
          </div>
        </Block>
      )}
      {/* SOL-L3: how many of people's markets lived to 7, 30 and 90 days, each with its proof — whatever the board shows. */}
      <SurvivalBlock locale={locale} network={network} />
    </Page>
  );
}

function NotRead({ word }: { word: Word }) {
  return <span className={styles.cellUnread}>{word("notRead")}</span>;
}

/**
 * The board's columns — each figure the chain did not give said as not read, never as zero. The rows keep the server's
 * order (live markets first, then by stage and the newest): no column sorts them by hand. A market not read yet while
 * the page has just opened says «reading» once, in its state's cell, and its other figures wait quietly.
 */
function marketColumns({ locale, word, now, reading }: { locale: WorkspaceLocale; word: Word; now: number; reading: boolean }): TableColumn<LaunchMarketRow>[] {
  const waits = (row: LaunchMarketRow) => !row.read && reading;
  return [
    { key: "token", label: word("colToken"), render: (row) => <TokenCell row={row} word={word} /> },
    {
      key: "state",
      label: word("colState"),
      render: (row) =>
        waits(row) ? (
          <span className={styles.cellUnread}>{word("rowReading")}</span>
        ) : row.state ? (
          <span className={styles.stateCell}>
            <span className={styles.stateChip} data-tone={stateTone(row.state.code)} title={word(`stateHint_${row.state.code}`)}>
              <span className={styles.stateDot} aria-hidden />
              {word(`state_${row.state.code}`)}
            </span>
            {row.state.since ? <span className={styles.cellSub}><SinceShort at={row.state.since} word={word} locale={locale} now={now} /></span> : null}
          </span>
        ) : (
          <NotRead word={word} />
        ),
    },
    {
      key: "way",
      label: word("colWay"),
      render: (row) =>
        waits(row) ? null : row.progress ? (
          row.progress.migrated ? (
            <span className={styles.stateCell}>
              <span className={styles.wayDone}>
                <CheckCircle size={16} weight="fill" aria-hidden /> {word("onDex")}
              </span>
              {/* Days on the DEX stand where the way to it ended. */}
              {row.daysSinceDex !== null ? <span className={styles.cellSub}>{daysText(row.daysSinceDex, word)}</span> : null}
            </span>
          ) : (
            <span className={styles.wayCell}>
              <span className={styles.wayValue}>{formatBps(row.progress.bps, locale)}</span>
              <span className={styles.wayBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress.bps / 100)} aria-label={word("colWay")}>
                <span style={{ width: `${Math.max(row.progress.bps / 100, 1)}%` }} />
              </span>
            </span>
          )
        ) : (
          <NotRead word={word} />
        ),
    },
    {
      key: "pool",
      label: word("colPool"),
      numeric: true,
      render: (row) =>
        waits(row) ? null : row.poolLiquidity ? (
          <span className={styles.cellFigure}>{formatMoneyShort(row.poolLiquidity.usd ?? row.poolLiquidity.pair, locale, row.poolLiquidity.usd !== null, row.pair.symbol)}</span>
        ) : row.progress && !row.progress.migrated ? (
          <span className={styles.cellMuted}>{word("stillOnCurve")}</span>
        ) : (
          <NotRead word={word} />
        ),
    },
    {
      key: "depth",
      label: word("colDepth"),
      numeric: true,
      render: (row) =>
        waits(row) ? null : row.venue === "curve" && row.state && FULL_CURVE.has(row.state.code) ? (
          /* A full curve takes no sale until it moves to the DEX. */
          <span className={styles.cellMuted}>{word("curveFull")}</span>
        ) : row.depth5Raw !== null ? (
          <span className={styles.cellFigure}>{pairMoney(row.depth5Raw, row.pair, locale)}</span>
        ) : (
          <NotRead word={word} />
        ),
    },
    {
      key: "budget",
      label: word("colBudget"),
      render: (row) => (waits(row) ? null : <BudgetCell budget={row.budget} ours={row.technicalValidation} read={row.read} money={(raw) => pairMoney(raw, row.pair, locale)} word={word} />),
    },
    {
      key: "holders",
      label: word("colHolders"),
      numeric: true,
      render: (row) =>
        waits(row) ? null : row.holders !== null ? (
          /* The ones found when the node would not scan every account: a floor, «4+». */
          <span className={styles.cellFigure} title={row.holdersAtLeast ? word("hAtLeastHint") : undefined}>
            {formatCountShort(row.holders, locale)}
            {row.holdersAtLeast ? "+" : ""}
          </span>
        ) : row.holdersAtLeast ? (
          <span className={styles.cellUnread}>{word("holdersUncounted")}</span>
        ) : (
          <NotRead word={word} />
        ),
    },
    {
      key: "creator",
      label: word("colCreator"),
      render: (row) =>
        waits(row) ? (
          row.creatorLock ? (
            <span className={styles.creatorLock}>
              <Lock size={14} weight="fill" aria-hidden /> {word("creatorLockUnread")}
            </span>
          ) : null
        ) : (
          <span className={styles.stateCell}>
            {/* A row not read knows only the lock its record holds: no lock there is «not read», never «no lock». */}
            {!row.read && !row.creatorLock ? <NotRead word={word} /> : <CreatorLock row={row} locale={locale} word={word} now={now} />}
            {row.creatorSold === true ? (
              <span className={styles.creatorSold}>
                <TrendDown size={14} aria-hidden /> {word("creatorSoldYes")}
              </span>
            ) : row.creatorSold === false ? (
              <span className={styles.cellSub}>{word("creatorSoldNo")}</span>
            ) : (
              <span className={styles.cellSub}>{word("creatorSoldUnread")}</span>
            )}
          </span>
        ),
    },
  ];
}

/** The token's picture, name and ticker — the link a keyboard and a screen reader open it by — and its two marks. */
function TokenCell({ row, word }: { row: LaunchMarketRow; word: Word }) {
  return (
    <span className={styles.marketToken}>
      <Link className={styles.marketLink} href={`/app/launch/${row.token}`} prefetch={false}>
        <span className={styles.marketPicture}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
          {row.image ? <img src={row.image} alt="" /> : <ImageSquare size={18} aria-hidden />}
        </span>
        <span className={styles.marketNames}>
          <span className={styles.marketName}>{row.name}</span>
          <span className={styles.marketSymbol} translate="no">
            ${row.symbol}
          </span>
        </span>
      </Link>
      <span className={styles.marketChips}>
        {row.traded24h === true ? (
          <span className={styles.liveChip} title={word("liveHint")}>
            <span className={styles.liveDot} aria-hidden />
            {word("live")}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * A market's budget in its row: what Ryntra's executor collected and what stands in the ladder; what waits in Meteora's
 * pool where nothing is collected; on a preset whose partner fees go to the multisig, the ladder if any and that no
 * budget is kept — never a zero for what is not there.
 */
function BudgetCell({ budget, ours, read, money, word }: { budget: LaunchMarketRow["budget"]; ours: boolean; read: boolean; money: (raw: string) => string; word: Word }) {
  if (budget.state === "COUNTED" && budget.earnedRaw !== null) {
    return (
      <span className={styles.stateCell}>
        <span className={styles.cellLine}>
          <span className={styles.cellFigure}>{money(budget.earnedRaw)}</span> {word("budgetEarned")}
        </span>
        <span className={styles.cellSub}>
          {budget.exhausted
            ? word("budgetExhaustedShort")
            : budget.deployed
              ? `${money(budget.deployed.pairRaw)} ${word("budgetInLadder")}${budget.reserveRaw !== null ? ` · ${word("budgetReserveShort", { amount: money(budget.reserveRaw) })}` : ""}`
              : read
                ? word("budgetNoLadderYet")
                : word("notRead")}
        </span>
      </span>
    );
  }
  if (budget.state === "IN_POOL") {
    return (
      <span className={styles.stateCell}>
        <span className={styles.cellLine}>
          {budget.earnedRaw !== null ? <span className={styles.cellFigure}>{money(budget.earnedRaw)}</span> : <NotRead word={word} />} {word("budgetInPool")}
        </span>
        <span className={styles.cellSub}>{word(ours || budget.claims ? "budgetPoolClaims" : "budgetPoolWaits")}</span>
      </span>
    );
  }
  if (budget.deployed) {
    return (
      <span className={styles.stateCell}>
        <span className={styles.cellLine}>
          <span className={styles.cellFigure}>{money(budget.deployed.pairRaw)}</span> {word("budgetInLadder")}
        </span>
        <span className={styles.cellSub}>{word("budgetRest")}</span>
      </span>
    );
  }
  /* No budget on this preset: a quiet dash, the words for a screen reader and a pointer. */
  return (
    <span className={`${styles.cellMuted} ${styles.cellLine}`} title={word("budgetNotCounted")}>
      <span aria-hidden>—</span>
      <span className={styles.visuallyHidden}>{word("budgetNotCounted")}</span>
    </span>
  );
}

/** When a state began, as `sinceShort` says it — its date in the reader's zone once the page has hydrated (SOL-P1). */
function SinceShort({ at, word, locale, now }: { at: string; word: Word; locale: WorkspaceLocale; now: number }) {
  return <>{sinceShort(at, word, locale, now, useHydrated() ? undefined : "UTC")}</>;
}

/** The creator's lock: whole until its cliff, then freed step by step to its end; a lock whose dates were not read is said locked. */
function CreatorLock({ row, locale, word, now }: { row: LaunchMarketRow; locale: WorkspaceLocale; word: Word; now: number }) {
  /* The server draws the board too (SOL-P1): a date in the reader's own zone once the page has hydrated, in UTC before. */
  const zone = useHydrated() ? undefined : "UTC";
  const lock = row.creatorLock;
  if (!lock) return <span className={styles.cellMuted}>{word("creatorNoLock")}</span>;
  const text =
    lock.cliffAt && Date.parse(lock.cliffAt) > now
      ? word("creatorLockedUntil", { date: shortDate(lock.cliffAt, locale, now, zone) })
      : lock.endsAt && Date.parse(lock.endsAt) > now
        ? word("creatorVestingUntil", { date: shortDate(lock.endsAt, locale, now, zone) })
        : lock.cliffAt || lock.endsAt
          ? null
          : word("creatorLockUnread");
  if (text === null) return <span className={styles.cellMuted}>{word("creatorNoLock")}</span>;
  return (
    <span className={styles.creatorLock}>
      <Lock size={14} weight="fill" aria-hidden /> {text}
    </span>
  );
}
