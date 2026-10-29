"use client";

import { ArrowSquareOut, ArrowsClockwise, CaretDown, Check, CircleNotch, Lock, LockOpen, TrendDown } from "@phosphor-icons/react";
import { Block, Button } from "@ryntra/core/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchMarketHealthResponse } from "@/lib/api/v1/contract";
import { RISK_THRESHOLDS } from "@/lib/core/venues/meteora-dbc/market";

import { coreLang } from "../launch-blocks";
import { explorerUrl, formatBps, formatCountShort, formatDate, formatMove, formatPrice } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { daysText, keeperWord, pairMoney, pct, ruleText, rulesShownInMarks, sinceShort, sinceText, stateTone } from "../market-view";

type Word = ReturnType<typeof launchWords>;
type Health = LaunchMarketHealthResponse;
/** The market's health as the page holds it: the answer, or still reading, or not read. */
export type HealthRead = Health | "reading" | "failed";

/** The answer, when there is one. */
export const healthOf = (read: HealthRead): Health | null => (typeof read === "object" ? read : null);

/** Fewer holders over $1 than this, counted whole, is a thin market — the threshold the market's facts of risk use. */
export const FEW_HOLDERS = RISK_THRESHOLDS.fewHolders;

const API_HEADERS = { "X-Ryntra-API": "1" } as const;
/** A read older than this was answered from the last good one while the server reads again: asked once more after `AGAIN_MS`. */
const OLD_MS = 60_000;
const AGAIN_MS = 20_000;

/** The states of a full curve not yet on the DEX: it takes no sale until it moves. */
const FULL_CURVE: ReadonlySet<Health["state"]["code"]> = new Set(["GRADUATION_READY", "MIGRATING", "MIGRATION_FAILED"]);

/** What the log says Ryntra's executor did, in a few words. */
const ACTION_WORD: Readonly<Record<NonNullable<Health["engine"]["lastAction"]>["kind"], LaunchWordKey>> = {
  LAUNCHED: "log_LAUNCHED",
  CREATOR_LOCKED: "log_CREATOR_LOCKED",
  FEES_SHARED: "log_FEES_SHARED",
  CREATOR_SOLD: "log_CREATOR_SOLD",
  CREATOR_BOUGHT: "log_CREATOR_BOUGHT",
  GRADUATED: "log_GRADUATED",
  FLOOR_POOL: "log_FLOOR_POOL",
  FLOOR_PLACED: "log_FLOOR_PLACED",
  FLOOR_WITHDRAWN: "log_FLOOR_WITHDRAWN",
  FLOOR_RAISED: "log_FLOOR_RAISED",
  FLOOR_ADDED: "log_FLOOR_ADDED",
  FEE_CLAIMED: "log_FEE_CLAIMED",
};

/**
 * «Здоров'я ринку» of a token, read once for the whole page: its overview, its liquidity and its risk each draw a part
 * of the same answer. Read after the market, and again when the trades or the way to the DEX change, never on its own
 * clock; an old answer that stood in while the server read the chain is asked once more, a little later.
 */
export function useMarketHealth(token: string, refresh: string | null) {
  const [health, setHealth] = useState<HealthRead>("reading");
  const [now, setNow] = useState(() => Date.now());
  const again = useRef<number | null>(null);
  const last = useRef<string | null | undefined>(undefined);

  const read = useCallback(
    async (followUp = false) => {
      const answer = await fetch(`/api/v1/launch/${token}/health`, { headers: API_HEADERS, cache: "no-store" })
        .then(async (response) => (response.ok ? ((await response.json()) as Health) : null))
        .catch(() => null);
      setHealth((before) => answer ?? (typeof before === "object" ? before : "failed"));
      setNow(Date.now());
      if (!followUp && answer && Date.now() - Date.parse(answer.observedAt) > OLD_MS) {
        if (again.current !== null) window.clearTimeout(again.current);
        again.current = window.setTimeout(() => void read(true), AGAIN_MS);
      }
    },
    [token],
  );

  /* The first read goes at once, beside the market's — never after it; again when the trades or the way to the DEX change. */
  useEffect(() => {
    if (last.current === undefined || (refresh !== null && last.current !== null && refresh !== last.current)) void read();
    if (refresh !== null || last.current === undefined) last.current = refresh;
  }, [refresh, read]);

  useEffect(
    () => () => {
      if (again.current !== null) window.clearTimeout(again.current);
    },
    [],
  );

  return { health, now, read: () => void read() };
}

/** A part of the health not here yet: still reading, or not read with one press to read again. */
function Waiting({ health, onRead, word }: { health: "reading" | "failed"; onRead: () => void; word: Word }) {
  return health === "reading" ? (
    <p className={styles.unread} aria-busy>
      <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("healthReading")}
    </p>
  ) : (
    <div className={styles.unreadRow} role="status">
      <p className={styles.unread}>{word("healthUnread")}</p>
      <Button variant="ghost" onClick={onRead}>
        <ArrowsClockwise size={14} aria-hidden /> {word("readAgain")}
      </Button>
    </div>
  );
}

type Step = Readonly<{ key: string; name: string; value: string | null; state: "done" | "now" | "next" }>;

/**
 * Ryntra's Market Engine on this market, the first thing the overview says: the state of the cycle, the budget in three
 * figures, the market's way from the launch to the ladder — each step marked done only when the chain says so — and the
 * executor's last action with its transaction.
 */
export function MarketEngine({
  read,
  locale,
  launchedAt,
  progressBps,
}: {
  read: ReturnType<typeof useMarketHealth>;
  locale: WorkspaceLocale;
  /** When the market opened, in seconds — its first point on the chart. */
  launchedAt: number | null;
  progressBps: number;
}) {
  const word = launchWords(locale);
  const { health, now } = read;
  return (
    <Block title={word("engineTitle")} titleAs="h2" lang={coreLang(locale)} id="launch-engine" className={styles.engineCard}>
      <div className={styles.blockBar}>{typeof health === "object" ? (
          <span className={styles.stateCell} data-align="end">
            <span
              className={styles.stateChip}
              data-tone={stateTone(health.state.code)}
              title={health.state.code === "MAINTAINING" && health.state.since ? word("stateLine_MAINTAINING", { ago: sinceText(health.state.since, word, locale, now) }) : word(`stateHint_${health.state.code}`)}
            >
              <span className={styles.stateDot} aria-hidden />
              {word(`state_${health.state.code}`)}
            </span>
            {health.state.since ? <span className={styles.cellSub}>{sinceShort(health.state.since, word, locale, now)}</span> : null}
          </span>
        ) : null}</div>
      {typeof health !== "object" ? (
        <Waiting health={health} onRead={read.read} word={word} />
      ) : (
        <>
          <p className={styles.engineLede}>
            {word(engineLedeKey(health))}
            {health.technicalValidation ? (
              <>
                {" "}
                <span className={styles.techChip} title={word("techHint")}>
                  {word("techChip")}
                </span>
              </>
            ) : null}
          </p>
          <EngineFigures health={health} locale={locale} word={word} />
          <Cycle steps={cycleSteps(health, word, locale, now, launchedAt, progressBps)} word={word} />
          <EngineLast health={health} locale={locale} word={word} now={now} />
        </>
      )}
    </Block>
  );
}

/**
 * The engine's first sentence says only what runs on this market: a budget and its ladder where Ryntra keeps one; on a
 * market whose budget the executor claims but has not yet (a person's Micro market while Ryntra keeps people's markets
 * open — SOL-L6), the watch, the move and the budget to be claimed; on a market of a person's otherwise the watch and the
 * move to the DEX, the budget waiting in Meteora's pool where the preset keeps one; elsewhere the watch and
 * the move alone.
 */
function engineLedeKey(health: Health): LaunchWordKey {
  /* A person's market the executor kept while people's markets were open: what it did stands, and nothing more is done (SOL-L6). */
  if (health.budget.claims === false && (health.budget.ladder !== "NONE" || health.budget.state === "COUNTED")) return "engineLedeHeld";
  if (health.budget.ladder !== "NONE" || health.budget.state === "COUNTED") return "engineLede";
  /* After the DEX the move is done: said as done, not as still to send. */
  if (health.venue === "pool") {
    /* Said as watched only while the executor acts here; idle or not read, said so. */
    if (!health.engine.acts) return health.engine.actsUnread ? "engineLedeDexUnread" : "engineLedeDexIdle";
    if (health.budget.state === "IN_POOL") return health.budget.claims ? "engineLedeDexClaims" : "engineLedeDexWaiting";
    return "engineLedeDex";
  }
  /* On the curve the move is still to send: said as Ryntra's only while its executor acts here; anyone may send it. */
  if (!health.engine.acts) return health.engine.actsUnread ? "engineLedeUnread" : "engineLedeIdle";
  if (health.budget.state === "IN_POOL") return health.budget.claims ? "engineLedeClaims" : "engineLedeWaiting";
  return "engineLedeWatch";
}

/** The budget as three figures, each a number first: earned, in the ladder, the reserve — or what the market's preset keeps instead. */
function EngineFigures({ health, locale, word }: { health: Health; locale: WorkspaceLocale; word: Word }) {
  const budget = health.budget;
  const money = (raw: string) => pairMoney(raw, health.pair, locale);
  const deployed = budget.deployed ? money(budget.deployed.pairRaw) : budget.ladder === "UNREAD" ? null : word("hNoLadder");
  const figures: Array<Readonly<{ label: string; value: string | null; muted?: boolean }>> =
    budget.state === "COUNTED"
      ? [
          { label: word("engineCollected"), value: budget.earnedRaw !== null ? money(budget.earnedRaw) : null },
          { label: word("hDeployed"), value: deployed, muted: !budget.deployed },
          { label: word("hReserve"), value: budget.reserveRaw !== null ? money(budget.reserveRaw) : null },
        ]
      : budget.state === "IN_POOL"
        ? [
            { label: word("hEarnedInPool"), value: budget.earnedRaw !== null ? money(budget.earnedRaw) : null },
            { label: word("hDeployed"), value: deployed, muted: !budget.deployed },
          ]
        : budget.ladder !== "NONE"
          ? [{ label: word("hDeployed"), value: deployed, muted: !budget.deployed }]
          : [];
  if (!figures.length) return <p className={styles.cellSub}>{word("hBudgetNone")}</p>;
  return (
    <dl className={styles.engineFigures} aria-label={word("hBudget")}>
      {figures.map((figure) => (
        <div key={figure.label} className={styles.engineFigure}>
          <dt>{figure.label}</dt>
          <dd data-muted={figure.muted || figure.value === null ? "" : undefined}>{figure.value ?? word("notRead")}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The market's way: launched, on the DEX (or how far the curve is), fees into its budget, Ryntra's ladder. A step is done
 * only on the chain's word; the first step not done is the one the market is at, the rest are next.
 */
function cycleSteps(health: Health, word: Word, locale: WorkspaceLocale, now: number, launchedAt: number | null, progressBps: number): Step[] {
  const budget = health.budget;
  const onDex = health.venue === "pool" || health.survival.graduatedAt !== null;
  const earned = budget.earnedRaw !== null && BigInt(budget.earnedRaw) > 0n;
  const ladder = budget.deployed !== null || health.ladder !== null || budget.ladder === "PLACED";
  const marks: Array<Omit<Step, "state"> & Readonly<{ done: boolean }>> = [
    { key: "launched", name: word("cycleLaunched"), value: launchedAt ? formatDate(launchedAt * 1000, locale) : null, done: true },
    {
      key: "dex",
      name: word("cycleDex"),
      value: onDex
        ? health.survival.daysSinceDex !== null
          ? daysText(health.survival.daysSinceDex, word)
          : health.survival.graduatedAt
            ? sinceText(health.survival.graduatedAt, word, locale, now)
            : null
        : word("cycleCurve", { pct: formatBps(progressBps, locale) }),
      done: onDex,
    },
    /* The amounts are the figures above: the way says only that the step was taken. */
    { key: "fees", name: word("cycleFees"), value: null, done: earned },
    { key: "ladder", name: word("cycleLadder"), value: null, done: ladder },
  ];
  const at = marks.findIndex((mark) => !mark.done);
  return marks.map(({ done, ...mark }, index) => ({ ...mark, state: done ? "done" : index === at ? "now" : "next" }));
}

function Cycle({ steps, word }: { steps: readonly Step[]; word: Word }) {
  return (
    <ol className={styles.cycle} aria-label={word("cycleLabel")}>
      {steps.map((step) => (
        <li key={step.key} className={styles.cycleStep} data-state={step.state}>
          <span className={styles.cycleDot} aria-hidden>
            {step.state === "done" ? <Check size={12} weight="bold" /> : null}
          </span>
          <span className={styles.cycleText}>
            <span className={styles.cycleName}>{step.name}</span>
            {step.value ? <span className={styles.cycleValue}>{step.value}</span> : null}
            {step.state !== "done" ? <span className={styles.visuallyHidden}>, {word(step.state === "now" ? "cycleNow" : "cycleNext")}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The executor in one line: a pause first, then what it last did here, when, and its transaction. */
function EngineLast({ health, locale, word, now }: { health: Health; locale: WorkspaceLocale; word: Word; now: number }) {
  const engine = health.engine;
  return (
    <div className={styles.engineLast}>
      {engine.executor === null ? (
        <p className={styles.cellSub}>{word("hNoExecutor")}</p>
      ) : engine.pause ? (
        <p className={styles.healthMark}>
          {engine.pause.code === "RISK_LIMIT" && engine.pause.risks?.length
            ? word("hPauseRisks", { reasons: engine.pause.risks.map((risk) => word(`budgetRisk_${risk}`)).join("; ") })
            : word(`hPause_${engine.pause.code}`)}
        </p>
      ) : engine.lastAction ? (
        <p className={styles.engineAction}>
          <span className={styles.engineActionText}>{word("hLastAction", { action: word(ACTION_WORD[engine.lastAction.kind]) })}</span>
          {engine.lastAction.at ? <span className={styles.cellSub}>{sinceText(engine.lastAction.at, word, locale, now)}</span> : null}
          <a className={styles.markLink} href={explorerUrl(health.network, "tx", engine.lastAction.signature)} target="_blank" rel="noreferrer noopener">
            {word("logTx")} <ArrowSquareOut size={12} aria-hidden />
          </a>
          {/* Its last act stands; whether it acts now was not read (1.47.0) — said beside it. */}
          {engine.actsUnread ? <span className={styles.cellSub}>{word("hExecutorUnread")}</span> : null}
        </p>
      ) : (
        <p className={styles.cellSub}>{word(engine.acts ? "hNoAction" : engine.actsUnread ? "hExecutorUnread" : health.venue === "curve" ? "hExecutorIdle" : "hExecutorIdleDex")}</p>
      )}
    </div>
  );
}

/**
 * The market's liquidity by fixed definitions: the executable depth at −2, −5 and −10 % with Ryntra's ladder in it, the
 * budget with where it comes from, and the market's survival on the DEX.
 */
export function LiquidityHealth({ read, locale, pool }: { read: ReturnType<typeof useMarketHealth>; locale: WorkspaceLocale; /** The DEX pool once the market is there. */ pool: string | null }) {
  const word = launchWords(locale);
  const { health, now } = read;
  if (typeof health !== "object") {
    return (
      <Block title={word("hDepth")} titleAs="h2" lang={coreLang(locale)} id="launch-depth">
        <Waiting health={health} onRead={read.read} word={word} />
      </Block>
    );
  }
  const money = (raw: string) => pairMoney(raw, health.pair, locale);
  const notRead = <span className={styles.cellUnread}>{word("notRead")}</span>;
  const deepest = Math.max(1, ...health.depth.map((level) => (level.pairRaw === null ? 0 : Number(level.pairRaw))));
  const curveFull = health.venue === "curve" && FULL_CURVE.has(health.state.code);
  return (
    <>
      <Block title={word("hDepth")} titleAs="h2" lang={coreLang(locale)} id="launch-depth" className={styles.tileCard}>
        {curveFull ? (
          <p className={styles.healthNote}>{word("hDepthClosed")}</p>
        ) : (
          <>
            <p className={styles.cellSub}>{word("hDepthSub")}</p>
            <dl className={styles.depthRows}>
              {health.depth.map((level) => (
                <div key={level.dropBps} className={styles.depthRow}>
                  <dt>{word("dropLabel", { pct: pct(level.dropBps, locale) })}</dt>
                  <dd>
                    {level.pairRaw === null ? (
                      notRead
                    ) : (
                      <>
                        <span className={styles.depthBar} aria-hidden>
                          <span style={{ width: `${Math.max((Number(level.pairRaw) / deepest) * 100, Number(level.pairRaw) > 0 ? 2 : 0)}%` }} />
                        </span>
                        <span className={styles.cellFigure}>{money(level.pairRaw)}</span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {/* A curve that holds little gives all of it to the first drop: the same figure three times, said in words. */}
            {health.venue === "curve" && health.depth.every((level) => level.pairRaw !== null && level.pairRaw !== "0" && level.pairRaw === health.depth[0]!.pairRaw) ? (
              <p className={styles.cellSub}>{word("hDepthAll", { amount: money(health.depth[0]!.pairRaw as string) })}</p>
            ) : null}
            <LadderLine health={health} locale={locale} word={word} />
          </>
        )}
      </Block>

      <div className={styles.tileRow}>
        {/* The budget's three figures are the overview's; here, where they come from — or why there are none. */}
        {health.budget.state === "COUNTED" && health.budget.sources ? (
          <Block title={word("hSources")} titleAs="h2" lang={coreLang(locale)} id="launch-budget" className={styles.tileCard}>
            <BudgetSources health={health} money={money} word={word} />
          </Block>
        ) : (
          <Block title={word("hBudget")} titleAs="h2" lang={coreLang(locale)} id="launch-budget" className={styles.tileCard}>
            <BudgetLines health={health} money={money} word={word} notRead={notRead} />
          </Block>
        )}

        <Block title={word("hSurvival")} titleAs="h2" lang={coreLang(locale)} id="launch-survival" className={styles.tileCard}>
          <ul className={styles.healthList}>
            <li>{health.survival.daysSinceDex !== null ? word("hDaysOnDex", { n: daysText(health.survival.daysSinceDex, word) }) : health.venue === "curve" ? word("hOnCurve") : word("notRead")}</li>
            {health.survival.priceVsDexBps !== null ? (
              <li>
                {word("hVsDex")}{" "}
                <span className={styles.cellFigure} data-dir={health.survival.priceVsDexBps > 0 ? "up" : health.survival.priceVsDexBps < 0 ? "down" : undefined}>
                  {formatMove(health.survival.priceVsDexBps, locale)}
                </span>
              </li>
            ) : null}
            <li>
              {health.survival.traded24h === true ? (
                <>
                  <span className={styles.liveDot} aria-hidden /> {word("hTraded")}
                  {health.survival.lastTradeAt ? <span className={styles.cellSub}> · {sinceText(health.survival.lastTradeAt, word, locale, now)}</span> : null}
                </>
              ) : health.survival.traded24h === false ? (
                word("hNotTraded")
              ) : (
                <span className={styles.cellUnread}>{word("hTradedUnread")}</span>
              )}
            </li>
            {pool ? (
              <li>
                {word("graduatedPool")} ·{" "}
                <a className={styles.markLink} href={explorerUrl(health.network, "account", pool)} target="_blank" rel="noreferrer noopener">
                  {word("pool")} <ArrowSquareOut size={12} aria-hidden />
                </a>
              </li>
            ) : null}
          </ul>
        </Block>
      </div>
    </>
  );
}

/**
 * The market's risk by fixed definitions: the creator's lock and sales, the holders worth more than $1, then what governs
 * the market — each a rule (a program enforces it) or a policy (Ryntra's server runs it), with the difference written out,
 * the definitions one press away, and the line that no price is guaranteed.
 */
export function RiskHealth({
  read,
  locale,
  marksShown,
}: {
  read: ReturnType<typeof useMarketHealth>;
  locale: WorkspaceLocale;
  marksShown: readonly string[];
}) {
  const word = launchWords(locale);
  const { health, now } = read;
  if (typeof health !== "object") {
    return (
      <Block title={word("hRules")} titleAs="h2" lang={coreLang(locale)} id="launch-rules" aria-busy={health === "reading"}>
        <Waiting health={health} onRead={read.read} word={word} />
      </Block>
    );
  }
  const notRead = <span className={styles.cellUnread}>{word("notRead")}</span>;
  /* «Чесний лаунч» on the same page says what its receipt's marks hold: here, the rest — nothing is lost when it shows fewer. */
  const inMarks = rulesShownInMarks(marksShown);
  const rules = health.rules.filter((rule) => !inMarks.has(rule.code));
  return (
    <>
      <div className={styles.tileRow}>
        <Block title={word("hCreator")} titleAs="h2" lang={coreLang(locale)} id="launch-creator-risk" className={styles.tileCard}>
          <ul className={styles.healthList}>
            <li>
              <CreatorLockLine health={health} locale={locale} word={word} now={now} />
            </li>
            <li>
              {health.creator.sold === true ? (
                <span className={styles.creatorSold}>
                  <TrendDown size={14} aria-hidden />{" "}
                  {health.creator.soldBps !== null
                    ? word(health.creator.soldOf === "supply" ? "hCreatorSoldSupply" : "hCreatorSold", { pct: pct(health.creator.soldBps, locale) })
                    : word("creatorSoldYes")}
                </span>
              ) : health.creator.sold === false ? (
                word("creatorSoldNo")
              ) : (
                <span className={styles.cellUnread}>{word("creatorSoldUnread")}</span>
              )}
            </li>
          </ul>
          {/* Every trade of the creator's wallet is at its account (SOL-L3): the tile's words with their link. */}
          <ChainLink network={health.network} kind="account" id={health.creator.address} label={word("proofWhat_creator")} />
        </Block>

        <Block title={word("hHolders")} titleAs="h2" lang={coreLang(locale)} id="launch-holders-risk" className={styles.tileCard}>
          <p className={styles.healthFigure}>
            {health.holders.count === null ? (health.holders.atLeast ? <span className={styles.cellUnread}>{word("holdersUncounted")}</span> : notRead) : health.holders.atLeast ? word("hAtLeast", { n: formatCountShort(health.holders.count, locale) }) : formatCountShort(health.holders.count, locale)}
          </p>
          <p className={styles.cellSub}>{word("hHoldersSub")}</p>
          {health.holders.atLeast ? <p className={styles.cellSub}>{word(health.holders.count === null ? "hHoldersNoneFound" : "hAtLeastHint")}</p> : null}
          {health.holders.count !== null && !health.holders.atLeast && health.holders.count < FEW_HOLDERS ? <p className={styles.healthMark}>{word("hFewHolders", { n: FEW_HOLDERS })}</p> : null}
          {health.holders.count !== null ? <ChainLink network={health.network} kind="account" id={health.token} label={word("proofWhat_mint")} /> : null}
        </Block>

        <Block title={word("hConcentration")} titleAs="h2" lang={coreLang(locale)} id="launch-concentration" className={styles.tileCard}>
          {health.concentration.top10Bps !== null ? (
            <>
              <p className={styles.healthFigure}>{word(health.concentration.atLeast ? "hTop10AtLeast" : "hTop10", { pct: pct(health.concentration.top10Bps, locale) })}</p>
              {health.concentration.marked !== null ? (
                <p className={health.concentration.marked ? styles.healthMark : styles.cellSub}>
                  {word(health.concentration.marked ? "hMarked" : "hNotMarked", { pct: pct(health.concentration.markBps, locale) })}
                </p>
              ) : null}
              {health.concentration.atLeast ? <p className={styles.cellSub}>{word("hTop10Hint")}</p> : null}
              <ChainLink network={health.network} kind="account" id={health.token} label={word("proofWhat_mint")} />
            </>
          ) : (
            /* Every account read and none in circulation — all in the curve, the pool or the lock — is a fact, not a read that failed. */
            <p className={styles.healthFigure}>{health.holders.atLeast ? notRead : <span className={styles.cellSub}>{word("hNoCirculating")}</span>}</p>
          )}
        </Block>
      </div>

      <Block title={word("hRules")} titleAs="h2" lang={coreLang(locale)} id="launch-rules" className={styles.slotHealth}>
        <ul className={styles.ruleList}>
          {rules.map((rule, index) => {
            const text = ruleText(rule, health.pair, word, locale, now);
            return (
              <li key={`${rule.code}:${rule.source?.id ?? index}`} className={styles.ruleRow}>
                <span className={styles.enforceChip} data-enforcement={rule.enforcement}>
                  {word(`enforce_${rule.enforcement}`)}
                </span>
                <span className={styles.ruleText}>
                  {text}
                  <span className={styles.cellSub}> · {keeperWord(rule.by, word)}</span>
                </span>
                {rule.source ? (
                  <a className={styles.markLink} href={explorerUrl(health.network, rule.source.kind, rule.source.id)} target="_blank" rel="noreferrer noopener" aria-label={`${word("view")}: ${text} — ${word("ruleSource")}`}>
                    {word("view")} <ArrowSquareOut size={12} aria-hidden />
                  </a>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
        {inMarks.size ? (
          <p className={styles.cellSub}>
            <a className={styles.markLink} href="#launch-marks">
              {word("hRulesInMarks")}
            </a>
          </p>
        ) : null}
        {!health.rulesComplete ? <p className={styles.unread}>{word("hRulesIncomplete")}</p> : null}

        <details className={styles.details}>
          <summary className={styles.summary}>
            {word("hHow")} <CaretDown size={14} aria-hidden className={styles.caret} />
          </summary>
          <ul className={styles.defList}>
            <li>{word("hRulesLegend")}</li>
            {(["def_state", "def_depth", "def_budget", "def_survival", "def_holders", "def_creator", "def_concentration", "def_engine"] as const).map((key) => (
              <li key={key}>{word(key)}</li>
            ))}
            <li>
              {word("def_api")}{" "}
              <a className={styles.markLink} href={`/api/v1/launch/${health.token}/health`} target="_blank" rel="noreferrer noopener" translate="no">
                /api/v1/launch/…/health
              </a>
            </li>
          </ul>
        </details>
        {/* A read the chain failed stands in with its own time: never a figure passed off as now. */}
        <p className={styles.marksChecked}>{word("marksChecked", { ago: sinceText(health.observedAt, word, locale, now) })}</p>
      </Block>
    </>
  );
}

/** Where a tile's figure is checked on chain (SOL-L3): the account that holds it, one link under the figure. */
function ChainLink({ network, kind, id, label }: { network: Health["network"]; kind: "tx" | "account"; id: string; label: string }) {
  return (
    <p className={styles.tileLink}>
      <a className={styles.markLink} href={explorerUrl(network, kind, id)} target="_blank" rel="noreferrer noopener">
        {label} <ArrowSquareOut size={12} aria-hidden />
      </a>
    </p>
  );
}

/** The market's one line of risk, under the trade: no price is promised, liquidity can run out, the money stays the person's. */
export function NoGuarantee({ locale }: { locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  return <p className={styles.noGuarantee}>{word("noGuarantee")}</p>;
}

/**
 * Ryntra's ladder under the depth: what of it the deepest drop reaches; else where its steps stand against the price —
 * deeper than the drop, or bought through and holding the token. Never «$0» for steps that are there.
 */
function LadderLine({ health, locale, word }: { health: Health; locale: WorkspaceLocale; word: Word }) {
  const ladder = health.ladder;
  if (!ladder) return null;
  const deepest = health.depth.find((level) => level.dropBps === 1000) ?? null;
  const inReach = deepest?.ladderRaw ? BigInt(deepest.ladderRaw) : 0n;
  if (inReach > 0n) return <p className={styles.cellSub}>{word("hDepthLadder", { amount: pairMoney(String(inReach), health.pair, locale), pct: pct(1000, locale) })}</p>;
  if (ladder.pairFrom === null || ladder.pairTo === null) return <p className={styles.cellSub}>{word("hLadderUsed", { symbol: health.pair.symbol })}</p>;
  const price = (value: number) => {
    const text = formatPrice(value, locale).plain;
    return health.pair.dollar ? `$${text}` : `${text} ${health.pair.symbol}`;
  };
  const values = { from: price(ladder.pairFrom), to: price(ladder.pairTo), price: price(health.price.pair) };
  return <p className={styles.cellSub}>{word(ladder.pairTo < health.price.pair * 0.9 ? "hLadderDeeper" : "hLadderRange", values)}</p>;
}

/**
 * The market's budget: earned · deployed · reserve where Ryntra's executor collects it; on a market with no ladder, what
 * it earned waiting in Meteora's pool; on a preset whose partner fees go to the multisig, that no budget is kept. Where
 * the budget comes from and Ryntra's revenue apart — one press away.
 */
function BudgetLines({ health, money, word, notRead }: { health: Health; money: (raw: string) => string; word: Word; notRead: ReactNode }) {
  const budget = health.budget;
  const deployed = budget.deployed ? <span className={styles.cellFigure}>{money(budget.deployed.pairRaw)}</span> : budget.ladder === "UNREAD" ? notRead : <span className={styles.cellMuted}>{word("hNoLadder")}</span>;
  if (budget.state === "NOT_COUNTED") {
    return (
      <>
        {budget.ladder !== "NONE" ? (
          <dl className={styles.healthRows}>
            <div>
              <dt>{word("hDeployed")}</dt>
              <dd>{deployed}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.healthFigure}>
            <span className={styles.cellMuted}>{word("budgetNotCounted")}</span>
          </p>
        )}
        <p className={styles.cellSub}>{word("hBudgetNone")}</p>
      </>
    );
  }
  if (budget.state === "IN_POOL") {
    return (
      <>
        <dl className={styles.healthRows}>
          <div>
            <dt>{word("hEarnedInPool")}</dt>
            <dd>{budget.earnedRaw !== null ? <span className={styles.cellFigure}>{money(budget.earnedRaw)}</span> : notRead}</dd>
          </div>
          <div>
            <dt>{word("hDeployed")}</dt>
            <dd>{deployed}</dd>
          </div>
        </dl>
        <p className={styles.cellSub}>{word(budget.ladder !== "NONE" ? "hInPoolLadder" : health.technicalValidation || budget.claims ? "hInPoolOurs" : "hInPoolPeople")}</p>
      </>
    );
  }
  const sources = budget.sources ?? null;
  return (
    <>
      <dl className={styles.healthRows}>
        <div>
          <dt>{word("hEarned")}</dt>
          <dd>{budget.earnedRaw !== null ? <span className={styles.cellFigure}>{money(budget.earnedRaw)}</span> : notRead}</dd>
        </div>
        <div>
          <dt>{word("hDeployed")}</dt>
          <dd>{deployed}</dd>
        </div>
        <div>
          <dt>{word("hReserve")}</dt>
          <dd>{budget.reserveRaw !== null ? <span className={styles.cellFigure}>{money(budget.reserveRaw)}</span> : notRead}</dd>
        </div>
      </dl>
      {budget.exhausted ? <p className={styles.healthMark}>{word("hBudgetExhausted", { symbol: health.pair.symbol })}</p> : null}
      {budget.inPoolRaw && BigInt(budget.inPoolRaw) >= 10_000n ? <p className={styles.cellSub}>{word("hStillInPool", { amount: money(budget.inPoolRaw) })}</p> : null}
      {sources ? (
        <details className={styles.details}>
          <summary className={styles.summary}>
            {word("hSources")} <CaretDown size={14} aria-hidden className={styles.caret} />
          </summary>
          <dl className={styles.healthRows}>
            {(["migration", "surplus", "curve", "lp"] as const).map((source) => (
              <div key={source}>
                <dt>{word(`src_${source}`)}</dt>
                <dd>
                  <span className={styles.cellFigure}>{money(sources[source])}</span>
                </dd>
              </div>
            ))}
          </dl>
          {budget.revenueRaw && BigInt(budget.revenueRaw) > 0n ? <p className={styles.cellSub}>{word("hRevenueApart", { amount: money(budget.revenueRaw) })}</p> : null}
        </details>
      ) : null}
    </>
  );
}

/** Where a counted budget comes from, open: each source, then Ryntra's revenue kept apart, and a budget used up or still in the pool. */
function BudgetSources({ health, money, word }: { health: Health; money: (raw: string) => string; word: Word }) {
  const budget = health.budget;
  const sources = budget.sources;
  if (!sources) return null;
  return (
    <>
      <dl className={styles.healthRows}>
        {(["migration", "surplus", "curve", "lp"] as const).map((source) => (
          <div key={source}>
            <dt>{word(`src_${source}`)}</dt>
            <dd>
              <span className={styles.cellFigure}>{money(sources[source])}</span>
            </dd>
          </div>
        ))}
      </dl>
      {budget.revenueRaw && BigInt(budget.revenueRaw) > 0n ? <p className={styles.cellSub}>{word("hRevenueApart", { amount: money(budget.revenueRaw) })}</p> : null}
      {budget.exhausted ? <p className={styles.healthMark}>{word("hBudgetExhausted", { symbol: health.pair.symbol })}</p> : null}
      {budget.inPoolRaw && BigInt(budget.inPoolRaw) >= 10_000n ? <p className={styles.cellSub}>{word("hStillInPool", { amount: money(budget.inPoolRaw) })}</p> : null}
    </>
  );
}

function CreatorLockLine({ health, locale, word, now }: { health: Health; locale: WorkspaceLocale; word: Word; now: number }) {
  const lock = health.creator.lock;
  /* Micro locks the creator's first purchase; a lock that did not land is said as the preset's rule not kept. */
  if (!lock && health.creator.lockRequired) {
    return (
      <span className={styles.creatorSold}>
        <LockOpen size={14} aria-hidden /> {word("creatorLockMissing")}
      </span>
    );
  }
  if (!lock) return <>{word("creatorNoLock")}</>;
  const text =
    lock.cliffAt && Date.parse(lock.cliffAt) > now
      ? word("creatorLockedUntil", { date: formatDate(lock.cliffAt, locale) })
      : lock.endsAt && Date.parse(lock.endsAt) > now
        ? word("creatorVestingUntil", { date: formatDate(lock.endsAt, locale) })
        : lock.cliffAt || lock.endsAt
          ? word("creatorNoLock")
          : word("creatorLockUnread");
  return (
    <span className={styles.creatorLock}>
      <Lock size={14} weight="fill" aria-hidden /> {text}
    </span>
  );
}
