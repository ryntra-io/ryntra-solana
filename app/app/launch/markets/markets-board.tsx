"use client";

import { ArrowsClockwise, CheckCircle, CircleNotch, ImageSquare, Lock, RocketLaunch, TrendDown } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchMarketRow, LaunchMarketsResponse } from "@/lib/api/v1/contract";

import { formatBps, formatCountShort, formatMoneyShort } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";
import { daysText, pairMoney, shortDate, sinceShort, sinceText, stateTone } from "../market-view";

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
 * never as zero. On a phone each row is a card of the same facts. Drawn in the
 * browser only — its times are the reader's own clock's.
 */
export function MarketsBoard({ locale, network }: { locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet" }) {
  const word = launchWords(locale);
  const [list, setList] = useState<LaunchMarketsResponse | null>(null);
  const [state, setState] = useState<"reading" | "ready" | "failed">("reading");
  const busy = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const [opened] = useState(() => Date.now());
  const router = useRouter();
  /* A press anywhere on a row opens its token — a link inside it, or a selection of its text, keeps its own way. */
  const open = useCallback(
    (event: MouseEvent<HTMLTableRowElement>, href: string) => {
      if ((event.target as HTMLElement).closest("a, button") || window.getSelection()?.toString()) return;
      if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
      else router.push(href);
    },
    [router],
  );

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

  useEffect(() => {
    void read();
  }, [read]);

  const complete = list?.complete ?? false;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, complete ? REFRESH_MS : FILL_MS);
    return () => window.clearInterval(timer);
  }, [read, complete]);

  const markets = list?.markets ?? [];
  /* The oldest read among the rows read: every figure is at least this fresh. */
  const reads = markets.filter((row) => row.read).map((row) => Date.parse(row.observedAt));
  const oldestRead = reads.length ? new Date(Math.min(...reads)).toISOString() : null;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headRow}>
          <h1 className={styles.title}>{word("marketsTitle")}</h1>
          {network === "solana:devnet" ? <span className={styles.netChip}>{word("devnet")}</span> : null}
        </div>
        <p className={styles.lede}>{word("marketsLede")}</p>
      </header>

      {list === null ? (
        <section className={`${styles.card} ${styles.marketsState}`} aria-live="polite" aria-busy={state === "reading"}>
          {state === "reading" ? (
            <p className={styles.unread}>
              <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("marketsReading")}
            </p>
          ) : (
            <div className={styles.unreadRow} role="status">
              <p className={styles.unread}>{word("marketsUnread")}</p>
              <button type="button" className={styles.textButton} onClick={() => void read()}>
                <ArrowsClockwise size={14} aria-hidden /> {word("readAgain")}
              </button>
            </div>
          )}
        </section>
      ) : markets.length === 0 ? (
        <section className={`${styles.card} ${styles.marketsState}`}>
          <p className={styles.unread}>{word("marketsEmpty")}</p>
          <Link className="rw-btn rw-btn--primary" href="/app/launch/new">
            <RocketLaunch size={16} aria-hidden /> {word("title")}
          </Link>
        </section>
      ) : (
        <section className={styles.marketsBoard} aria-labelledby="markets-count">
          <div className={styles.marketsBar}>
            <p id="markets-count" className={styles.marketsCount}>
              {word("marketsCount", { n: markets.length })}
            </p>
            <p className={styles.marketsLegend}>
              <span className={styles.liveDot} aria-hidden /> {word("live")} — {word("liveHint").toLocaleLowerCase(locale === "uk" ? "uk-UA" : "en-US")}
            </p>
          </div>
          {!list.complete ? <p className={styles.hint}>{word("marketsPartial")}</p> : null}
          <div className={styles.marketsWrap}>
            {/* The roles are written out: on a phone the rows are drawn as cards, and a table drawn so keeps them only this way. */}
            <table className={styles.marketsTable} aria-label={word("marketsTable")} role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    {word("colToken")}
                  </th>
                  <th scope="col" role="columnheader">
                    {word("colState")}
                  </th>
                  <th scope="col" role="columnheader">
                    {word("colWay")}
                  </th>
                  <th scope="col" role="columnheader" data-num>
                    {word("colPool")}
                  </th>
                  <th scope="col" role="columnheader" data-num>
                    {word("colDepth")}
                  </th>
                  <th scope="col" role="columnheader">
                    {word("colBudget")}
                  </th>
                  <th scope="col" role="columnheader" data-num>
                    {word("colHolders")}
                  </th>
                  <th scope="col" role="columnheader">
                    {word("colCreator")}
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {markets.map((row) => (
                  <MarketRow key={row.token} row={row} locale={locale} word={word} now={now} reading={now - opened < READING_MS} open={open} />
                ))}
              </tbody>
            </table>
          </div>
          <footer className={styles.marketsFoot}>
            <p className={styles.hint}>
              {word("marketsOrder")}
              {oldestRead ? ` ${word("marketsRead", { ago: sinceText(oldestRead, word, locale, now) })}.` : null}
            </p>
            <p className={styles.noGuarantee}>{word("noGuarantee")}</p>
          </footer>
        </section>
      )}
    </div>
  );
}

function NotRead({ word }: { word: Word }) {
  return <span className={styles.cellUnread}>{word("notRead")}</span>;
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
        <span className={styles.cellSub}>{word(ours ? "budgetPoolClaims" : "budgetPoolWaits")}</span>
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

function MarketRow({
  row,
  locale,
  word,
  now,
  reading,
  open,
}: {
  row: LaunchMarketRow;
  locale: WorkspaceLocale;
  word: Word;
  now: number;
  /** The page opened a moment ago: a market not read yet is being read, said once across its row. */
  reading: boolean;
  open: (event: MouseEvent<HTMLTableRowElement>, href: string) => void;
}) {
  const money = (raw: string) => pairMoney(raw, row.pair, locale);
  const href = `/app/launch/${row.token}`;
  const token = (
    <th scope="row" role="rowheader" className={styles.marketToken}>
      <Link className={styles.marketLink} href={href} prefetch={false}>
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
        {row.technicalValidation ? (
          <span className={styles.techChip} title={word("techHint")}>
            {word("techChip")}
          </span>
        ) : null}
      </span>
    </th>
  );
  if (!row.read && reading) {
    return (
      <tr className={styles.marketRow} role="row" onClick={(event) => open(event, href)}>
        {token}
        <td colSpan={7} role="cell" className={styles.rowReading} data-label="">
          <span className={styles.unread}>
            <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("rowReading")}
          </span>
          {row.creatorLock ? (
            <span className={styles.creatorLock}>
              <Lock size={14} weight="fill" aria-hidden /> {word("creatorLockUnread")}
            </span>
          ) : null}
        </td>
      </tr>
    );
  }
  return (
    <tr className={styles.marketRow} data-live={row.traded24h === true ? "" : undefined} role="row" onClick={(event) => open(event, href)}>
      {token}
      <td data-label={word("colState")} role="cell">
        {row.state ? (
          <span className={styles.stateCell}>
            <span className={styles.stateChip} data-tone={stateTone(row.state.code)} title={word(`stateHint_${row.state.code}`)}>
              <span className={styles.stateDot} aria-hidden />
              {word(`state_${row.state.code}`)}
            </span>
            {row.state.since ? <span className={styles.cellSub}>{sinceShort(row.state.since, word, locale, now)}</span> : null}
          </span>
        ) : (
          <NotRead word={word} />
        )}
      </td>
      <td data-label={word("colWay")} role="cell">
        {row.progress ? (
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
        )}
      </td>
      <td data-label={word("colPool")} data-num role="cell">
        {row.poolLiquidity ? (
          <span className={styles.cellFigure}>{formatMoneyShort(row.poolLiquidity.usd ?? row.poolLiquidity.pair, locale, row.poolLiquidity.usd !== null, row.pair.symbol)}</span>
        ) : row.progress && !row.progress.migrated ? (
          <span className={styles.cellMuted}>{word("stillOnCurve")}</span>
        ) : (
          <NotRead word={word} />
        )}
      </td>
      <td data-label={word("colDepth")} data-num role="cell">
        {row.venue === "curve" && row.state && FULL_CURVE.has(row.state.code) ? (
          /* A full curve takes no sale until it moves to the DEX. */
          <span className={styles.cellMuted}>{word("curveFull")}</span>
        ) : row.depth5Raw !== null ? (
          <span className={styles.cellFigure}>{money(row.depth5Raw)}</span>
        ) : (
          <NotRead word={word} />
        )}
      </td>
      <td data-label={word("colBudget")} role="cell">
        <BudgetCell budget={row.budget} ours={row.technicalValidation} read={row.read} money={money} word={word} />
      </td>
      <td data-label={word("colHolders")} data-num role="cell">
        {row.holders !== null ? (
          /* The ones found when the node would not scan every account: a floor, «4+». */
          <span className={styles.cellFigure} title={row.holdersAtLeast ? word("hAtLeastHint") : undefined}>
            {formatCountShort(row.holders, locale)}
            {row.holdersAtLeast ? "+" : ""}
          </span>
        ) : row.holdersAtLeast ? (
          <span className={styles.cellUnread}>{word("holdersUncounted")}</span>
        ) : (
          <NotRead word={word} />
        )}
      </td>
      <td data-label={word("colCreator")} role="cell">
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
      </td>
    </tr>
  );
}

/** The creator's lock: whole until its cliff, then freed step by step to its end; a lock whose dates were not read is said locked. */
function CreatorLock({ row, locale, word, now }: { row: LaunchMarketRow; locale: WorkspaceLocale; word: Word; now: number }) {
  const lock = row.creatorLock;
  if (!lock) return <span className={styles.cellMuted}>{word("creatorNoLock")}</span>;
  const text =
    lock.cliffAt && Date.parse(lock.cliffAt) > now
      ? word("creatorLockedUntil", { date: shortDate(lock.cliffAt, locale, now) })
      : lock.endsAt && Date.parse(lock.endsAt) > now
        ? word("creatorVestingUntil", { date: shortDate(lock.endsAt, locale, now) })
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
