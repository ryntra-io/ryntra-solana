"use client";

import { ArrowSquareOut, ArrowsClockwise, CaretDown, CircleNotch, Lock, LockOpen, TrendDown } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchMarketHealthResponse } from "@/lib/api/v1/contract";

import { explorerUrl, formatCountShort, formatDate, formatMove, formatPrice } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { daysText, keeperWord, pairMoney, pct, ruleText, rulesShownInMarks, sinceShort, sinceText, stateTone } from "../market-view";

type Word = ReturnType<typeof launchWords>;
type Health = LaunchMarketHealthResponse;

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
  GRADUATED: "log_GRADUATED",
  FLOOR_POOL: "log_FLOOR_POOL",
  FLOOR_PLACED: "log_FLOOR_PLACED",
  FLOOR_WITHDRAWN: "log_FLOOR_WITHDRAWN",
  FLOOR_RAISED: "log_FLOOR_RAISED",
  FLOOR_ADDED: "log_FLOOR_ADDED",
};

/**
 * «Здоров'я ринку» on a token's page: the market's state of the cycle and its
 * figures by fixed definitions — executable depth at −2, −5 and −10 %, the
 * budget, survival, holders, the creator, concentration and Ryntra's executor
 * — then what governs the market, each marked a rule (a program enforces it)
 * or a policy (Ryntra's server runs it), with the difference written out, the
 * definitions one press away, and the line that no price is guaranteed. Read
 * after the market, and again when the trades or the way to the DEX change.
 */
export function MarketHealth({ token, locale, refresh, marksShown }: { token: string; locale: WorkspaceLocale; refresh: string | null; marksShown: readonly string[] }) {
  const word = launchWords(locale);
  const [health, setHealth] = useState<Health | "reading" | "failed">("reading");
  const [now, setNow] = useState(() => Date.now());
  const again = useRef<number | null>(null);

  const read = useCallback(
    async (followUp = false) => {
      const answer = await fetch(`/api/v1/launch/${token}/health`, { headers: API_HEADERS, cache: "no-store" })
        .then(async (response) => (response.ok ? ((await response.json()) as Health) : null))
        .catch(() => null);
      setHealth((before) => answer ?? (typeof before === "object" ? before : "failed"));
      setNow(Date.now());
      /* An old read stood in while the server reads the chain again: asked once more, a little later. */
      if (!followUp && answer && Date.now() - Date.parse(answer.observedAt) > OLD_MS) {
        if (again.current !== null) window.clearTimeout(again.current);
        again.current = window.setTimeout(() => void read(true), AGAIN_MS);
      }
    },
    [token],
  );

  useEffect(() => {
    if (refresh !== null) void read();
  }, [refresh, read]);

  useEffect(
    () => () => {
      if (again.current !== null) window.clearTimeout(again.current);
    },
    [],
  );

  if (health === "reading" || health === "failed") {
    return (
      <section className={`${styles.card} ${styles.slotHealth}`} aria-labelledby="launch-health" aria-busy={health === "reading"}>
        <h2 id="launch-health" className={styles.cardTitle}>
          {word("healthTitle")}
        </h2>
        {health === "reading" ? (
          <p className={styles.unread}>
            <CircleNotch size={14} className={styles.spin} aria-hidden /> {word("healthReading")}
          </p>
        ) : (
          <div className={styles.unreadRow} role="status">
            <p className={styles.unread}>{word("healthUnread")}</p>
            <button type="button" className={styles.textButton} onClick={() => void read()}>
              <ArrowsClockwise size={14} aria-hidden /> {word("readAgain")}
            </button>
          </div>
        )}
        <p className={styles.noGuarantee}>{word("noGuarantee")}</p>
      </section>
    );
  }

  const money = (raw: string) => pairMoney(raw, health.pair, locale);
  const notRead = <span className={styles.cellUnread}>{word("notRead")}</span>;
  const notCounted = <span className={styles.cellMuted}>{word("notCounted")}</span>;
  const deepest = Math.max(1, ...health.depth.map((level) => (level.pairRaw === null ? 0 : Number(level.pairRaw))));
  const curveFull = health.venue === "curve" && FULL_CURVE.has(health.state.code);
  /* «Чесний лаунч» on the same page says what its receipt's marks hold: here, the rest — nothing is lost when it shows fewer. */
  const inMarks = rulesShownInMarks(marksShown);
  const rules = health.rules.filter((rule) => !inMarks.has(rule.code));

  return (
    <section className={`${styles.card} ${styles.slotHealth}`} aria-labelledby="launch-health">
      <div className={styles.cardHeadRow}>
        <h2 id="launch-health" className={styles.cardTitle}>
          {word("healthTitle")}
        </h2>
        <span className={styles.stateCell} data-align="end">
          <span className={styles.stateChip} data-tone={stateTone(health.state.code)}>
            <span className={styles.stateDot} aria-hidden />
            {word(`state_${health.state.code}`)}
          </span>
          {health.state.since ? <span className={styles.cellSub}>{sinceShort(health.state.since, word, locale, now)}</span> : null}
        </span>
      </div>
      <p className={styles.healthStateLine}>
        {/* When Ryntra last moved its steps, in words; any other state's own sentence. */}
        {health.state.code === "MAINTAINING" && health.state.since ? word("stateLine_MAINTAINING", { ago: sinceText(health.state.since, word, locale, now) }) : word(`stateHint_${health.state.code}`)}
        {health.technicalValidation ? (
          <>
            {" "}
            <span className={styles.techChip} title={word("techHint")}>
              {word("techChip")}
            </span>
          </>
        ) : null}
      </p>

      <div className={styles.healthGrid}>
        <div className={`${styles.healthTile} ${styles.healthWide}`}>
          <h3 className={styles.healthLabel}>{word("hDepth")}</h3>
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
        </div>

        <div className={styles.healthTile}>
          <h3 className={styles.healthLabel}>{word("hBudget")}</h3>
          <dl className={styles.healthRows}>
            <div>
              <dt>{word("hEarned")}</dt>
              <dd>{health.budget.earnedRaw !== null ? <span className={styles.cellFigure}>{money(health.budget.earnedRaw)}</span> : notCounted}</dd>
            </div>
            <div>
              <dt>{word("hDeployed")}</dt>
              <dd>
                {health.budget.deployed ? (
                  <span className={styles.cellFigure}>{money(health.budget.deployed.pairRaw)}</span>
                ) : health.budget.ladder === "UNREAD" ? (
                  notRead
                ) : (
                  <span className={styles.cellMuted}>{word("hNoLadder")}</span>
                )}
              </dd>
            </div>
            <div>
              <dt>{word("hReserve")}</dt>
              <dd>{health.budget.reserveRaw !== null ? <span className={styles.cellFigure}>{money(health.budget.reserveRaw)}</span> : notCounted}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.healthTile}>
          <h3 className={styles.healthLabel}>{word("hSurvival")}</h3>
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
          </ul>
        </div>

        <div className={styles.healthTile}>
          <h3 className={styles.healthLabel}>{word("hHolders")}</h3>
          <p className={styles.healthFigure}>
            {health.holders.count === null ? (health.holders.atLeast ? <span className={styles.cellUnread}>{word("holdersUncounted")}</span> : notRead) : health.holders.atLeast ? word("hAtLeast", { n: formatCountShort(health.holders.count, locale) }) : formatCountShort(health.holders.count, locale)}
          </p>
          <p className={styles.cellSub}>{word("hHoldersSub")}</p>
          {health.holders.atLeast ? <p className={styles.cellSub}>{word(health.holders.count === null ? "hHoldersNoneFound" : "hAtLeastHint")}</p> : null}
        </div>

        <div className={styles.healthTile}>
          <h3 className={styles.healthLabel}>{word("hCreator")}</h3>
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
        </div>

        <div className={styles.healthTile}>
          <h3 className={styles.healthLabel}>{word("hConcentration")}</h3>
          {health.concentration.top10Bps !== null ? (
            <>
              <p className={styles.healthFigure}>{word(health.concentration.atLeast ? "hTop10AtLeast" : "hTop10", { pct: pct(health.concentration.top10Bps, locale) })}</p>
              {health.concentration.marked !== null ? (
                <p className={health.concentration.marked ? styles.healthMark : styles.cellSub}>
                  {word(health.concentration.marked ? "hMarked" : "hNotMarked", { pct: pct(health.concentration.markBps, locale) })}
                </p>
              ) : null}
              {health.concentration.atLeast ? <p className={styles.cellSub}>{word("hTop10Hint")}</p> : null}
            </>
          ) : (
            <p className={styles.healthFigure}>{notRead}</p>
          )}
        </div>

        <div className={styles.healthTile}>
          <h3 className={styles.healthLabel}>{word("hEngine")}</h3>
          <EngineLines health={health} locale={locale} word={word} now={now} />
        </div>
      </div>

      <h3 className={styles.subTitle}>{word("hRules")}</h3>
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
      <p className={styles.healthNote}>{word("hRulesLegend")}</p>
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
      <p className={styles.noGuarantee}>{word("noGuarantee")}</p>
      {/* A read the chain failed stands in with its own time: never a figure passed off as now. */}
      <p className={styles.marksChecked}>{word("marksChecked", { ago: sinceText(health.observedAt, word, locale, now) })}</p>
    </section>
  );
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

/** Ryntra's executor here: a stop first — the operator's, or steps that stand still —; then whether it acts here now, and its last action on this market. */
function EngineLines({ health, locale, word, now }: { health: Health; locale: WorkspaceLocale; word: Word; now: number }) {
  const engine = health.engine;
  if (engine.executor === null) return <p className={styles.cellSub}>{word("hNoExecutor")}</p>;
  return (
    <div className={styles.healthList}>
      {engine.pause ? <p className={styles.healthMark}>{word(`hPause_${engine.pause.code}`)}</p> : null}
      {/* Not acting: said once — by the pause where its steps stand, else in a line that names what is left to anyone. */}
      {!engine.acts && !engine.pause ? <p className={styles.cellSub}>{word(health.venue === "curve" ? "hExecutorIdle" : "hExecutorIdleDex")}</p> : null}
      {/* Acting here: what it does on this market, said before what it last did. */}
      {engine.acts && !engine.pause ? <p className={styles.healthEngine}>{word(health.venue === "curve" ? "hExecutorActs_curve" : "hExecutorActs_pool")}</p> : null}
      {engine.lastAction ? (
        <>
          <p className={styles.healthEngine}>{word("hLastAction", { action: word(ACTION_WORD[engine.lastAction.kind]) })}</p>
          {/* When and the transaction on a line of their own: a wrap never starts a line with its separator. */}
          <p className={styles.healthEngine}>
            {engine.lastAction.at ? <span className={styles.cellSub}>{sinceText(engine.lastAction.at, word, locale, now)} ·</span> : null}
            <a className={styles.markLink} href={explorerUrl(health.network, "tx", engine.lastAction.signature)} target="_blank" rel="noreferrer noopener">
              {word("logTx")} <ArrowSquareOut size={12} aria-hidden />
            </a>
          </p>
        </>
      ) : engine.acts && !engine.pause ? (
        <p className={styles.cellSub}>{word("hNoAction")}</p>
      ) : null}
    </div>
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
