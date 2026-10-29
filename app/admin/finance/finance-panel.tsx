"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import { WORKSPACE_LOCALES, WORKSPACE_LOCALE_META, persistWorkspaceLocale, type WorkspaceLocale } from "@/app/shell/locale";
import { FINANCE_LINES, FINANCE_SCOPES, type FinanceCheck, type FinanceFigure, type FinanceLine, type FinanceMetric, type FinanceModel, type FinanceScope } from "@/lib/admin/finance";
import type { SuccessMetric } from "@/lib/admin/success";
import { INCOME_SOURCES, incomeRule } from "@/lib/core/launch/revenue-rule";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import fin from "./finance.module.css";
import { formatUsd } from "../format";
import { FINANCE_WORDS, diffWord, lineWord, sourceWord, unreadWord } from "./finance-words";

/**
 * Ryntra's financial panel (SOL-F1): one number first — the net result —, then the eight sums, each with its check
 * against the chain; the differences named one by one; the launch business's figures; the rule behind it all one
 * disclosure down. Read only.
 */

type Word = { en: string; uk: string };
type Loaded = { scope: FinanceScope; model: FinanceModel };

const SOLSCAN = "https://solscan.io";
const CHECK_TONE: Record<FinanceCheck, string> = { MATCH: ext.chipOk!, DIFF: ext.chipRisk!, UNREAD: ext.chipWarn! };
const METHOD_PRESETS = ["classic", "protected", "micro"] as const;
/** The differences shown at once; the rest one disclosure down — a list, never a wall. */
const DIFFERENCES_AT_ONCE = 12;

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function FinancePanel({ initialLocale }: { initialLocale: WorkspaceLocale }) {
  const [locale, setLocale] = useState<WorkspaceLocale>(initialLocale);
  const [scope, setScope] = useState<FinanceScope>("all");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<"session" | "failed" | null>(null);
  const [loading, setLoading] = useState(true);
  const w = useCallback((word: Word) => word[locale], [locale]);

  const load = useCallback(async (next: FinanceScope, fresh = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/finance?scope=${next}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 401 ? "session" : "failed");
        return;
      }
      const body = (await response.json()) as { finance: FinanceModel };
      setLoaded({ scope: next, model: body.finance });
      setError(null);
    } catch {
      setError("failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const chooseLocale = (next: WorkspaceLocale) => {
    persistWorkspaceLocale(next);
    setLocale(next);
  };

  const model = loaded?.model ?? null;
  const money = (value: FinanceFigure) =>
    value.usd === null ? (
      <span className={fin.unread}>{w(FINANCE_WORDS.unreadValue)}</span>
    ) : (
      <>
        {value.atLeast ? <span className={fin.atLeast} title={w(FINANCE_WORDS.atLeast)}>≥ </span> : value.atMost ? <span className={fin.atLeast} title={w(FINANCE_WORDS.atMost)}>≤ </span> : null}
        {formatUsd(value.usd)}
      </>
    );
  const moneyText = (value: number | null) => (value === null ? "—" : formatUsd(value));

  return (
    <div className={fin.root} lang={locale === "uk" ? "uk" : "en"}>
      <div className={fin.head}>
        <div className={fin.titleRow}>
          <h1 className={styles.pageTitle}>{w(FINANCE_WORDS.title)}</h1>
          <InfoControl label={w(FINANCE_WORDS.infoLabel)}>
            <p>{w(FINANCE_WORDS.info)}</p>
          </InfoControl>
        </div>
        <p className={fin.lead}>{w(FINANCE_WORDS.lead)}</p>
        <div className={fin.controls}>
          <div className={fin.segment} role="group" aria-label={w(FINANCE_WORDS.scopeLabel)}>
            {FINANCE_SCOPES.map((id) => (
              <button key={id} type="button" className={fin.segmentButton} aria-pressed={scope === id} onClick={() => setScope(id)}>
                {w(FINANCE_WORDS[`scope_${id}`])}
              </button>
            ))}
          </div>
          <div className={fin.segment} role="group" aria-label={w(FINANCE_WORDS.langLabel)}>
            {WORKSPACE_LOCALES.map((id) => (
              <button key={id} type="button" className={fin.segmentButton} aria-pressed={locale === id} onClick={() => chooseLocale(id)} lang={id === "uk" ? "uk" : "en"}>
                {WORKSPACE_LOCALE_META[id].short}
              </button>
            ))}
          </div>
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`} onClick={() => void load(scope, true)} disabled={loading}>
            <ArrowsClockwise size={14} aria-hidden="true" />
            {w(FINANCE_WORDS.refresh)}
          </button>
          {model ? (
            <span className={fin.readAt}>
              {w(FINANCE_WORDS.readAt)} {new Date(model.readAt).toLocaleString(locale === "uk" ? "uk-UA" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : null}
        </div>
      </div>

      {error && !model ? (
        <div className={`${styles.card} ${fin.state}`} role="alert">
          <p>{w(error === "session" ? FINANCE_WORDS.failedSession : FINANCE_WORDS.failed)}</p>
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => void load(scope)}>
            {w(FINANCE_WORDS.retry)}
          </button>
        </div>
      ) : null}

      {!model && !error ? (
        <div className={`${styles.card} ${fin.state}`} aria-busy="true">
          <p className={fin.stateTitle}>{w(FINANCE_WORDS.reading)}</p>
          <p className={fin.muted}>{w(FINANCE_WORDS.readingSlow)}</p>
        </div>
      ) : null}

      {model ? (
        <div className={fin.stack} aria-busy={loading}>
          <Hero model={model} w={w} money={money} />

          <section className={fin.lines} aria-label={w(FINANCE_WORDS.sources)}>
            {FINANCE_LINES.filter((id) => id !== "net").map((id) => (
              <LineBlock key={id} line={model.lines[id]} w={w} money={money} moneyText={moneyText} />
            ))}
          </section>

          <Margin model={model} w={w} money={money} locale={locale} />
          <Success model={model} w={w} locale={locale} />
          <Differences model={model} w={w} moneyText={moneyText} />
          <Metrics model={model} w={w} locale={locale} />
          <Launches model={model} w={w} money={money} />
          <Method w={w} />
        </div>
      ) : null}
    </div>
  );
}

type W = (word: Word) => string;
type Money = (value: FinanceFigure) => React.ReactNode;

function CheckChip({ check, w, count }: { check: FinanceCheck; w: W; count?: number }) {
  const text = check === "DIFF" && count ? `${count} ${w(FINANCE_WORDS.differencesCount)}` : w(FINANCE_WORDS[`check_${check}`]);
  return (
    <span className={`${ext.chip} ${CHECK_TONE[check]}`} data-check={check}>
      {text}
    </span>
  );
}

function Hero({ model, w, money }: { model: FinanceModel; w: W; money: Money }) {
  const net = model.lines.net;
  const tone = net.usd === null ? "" : net.usd < 0 ? fin.down : fin.up;
  return (
    <section className={`${styles.card} ${fin.hero}`} aria-labelledby="finance-net">
      <div className={fin.heroTop}>
        <span id="finance-net" className={fin.heroLabel}>
          {w(FINANCE_WORDS.netTitle)}
        </span>
        <CheckChip check={model.allMatched ? "MATCH" : model.differences.length > 0 ? "DIFF" : "UNREAD"} count={model.differences.length} w={w} />
      </div>
      <b className={`${fin.heroValue} ${tone}`}>{money(net)}</b>
      <span className={fin.muted}>{w(FINANCE_WORDS.netCaption)}</span>
      <dl className={fin.heroParts}>
        <div>
          <dt>{w(FINANCE_WORDS.revenue)}</dt>
          <dd>{money(model.split.revenue)}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.rewardsOwed)}</dt>
          <dd>{money(figureOf(net.parts.find((part) => part.id === "rewards")))}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.costsShort)}</dt>
          <dd>{money(figureOf(net.parts.find((part) => part.id === "costs")))}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.budget)}</dt>
          <dd>{money(model.split.budget)}</dd>
        </div>
      </dl>
      {model.split.notValued > 0 ? (
        <span className={fin.muted}>
          + {model.split.notValued} {w(FINANCE_WORDS.notValued)}
        </span>
      ) : null}
    </section>
  );
}

const figureOf = (part: { usd: number | null; atLeast: boolean } | undefined): FinanceFigure => (part ? { usd: part.usd, atLeast: part.atLeast } : { usd: null, atLeast: false });

function LineBlock({ line, w, money, moneyText }: { line: FinanceLine; w: W; money: Money; moneyText: (value: number | null) => string }) {
  const hint = FINANCE_WORDS[`hint_${line.id}` as `hint_${Exclude<FinanceLine["id"], "net">}`];
  return (
    <article className={fin.line} data-line={line.id} data-check={line.check}>
      <span className={fin.lineLabel}>{w(lineWord(line.id))}</span>
      <b className={fin.lineValue}>{money(line)}</b>
      <CheckChip check={line.check} w={w} />
      <details className={fin.lineDetails}>
        <summary>{w(FINANCE_WORDS.sources)}</summary>
        <p className={fin.muted}>{w(hint)}</p>
        <dl className={fin.parts}>
          {line.parts.map((part) => (
            <div key={part.id} data-check={part.check}>
              <dt>{w(FINANCE_WORDS[`part_${part.id}` as keyof typeof FINANCE_WORDS] as Word)}</dt>
              <dd>{money(part)}</dd>
            </div>
          ))}
        </dl>
        {line.ledgerUsd !== null || line.chainUsd !== null ? (
          <p className={fin.ledger}>
            {w(FINANCE_WORDS.ledgerVsChain)}: {moneyText(line.ledgerUsd)} · {moneyText(line.chainUsd)}
          </p>
        ) : null}
        {line.id === "claimed" ? <p className={fin.muted}>{w(FINANCE_WORDS.claimedNoLedger)}</p> : null}
      </details>
    </article>
  );
}

function Differences({ model, w, moneyText }: { model: FinanceModel; w: W; moneyText: (value: number | null) => string }) {
  return (
    <section className={styles.card} aria-labelledby="finance-differences">
      <div className={styles.cardHead}>
        <h2 id="finance-differences" className={styles.cardTitle}>
          {w(FINANCE_WORDS.differencesTitle)}
        </h2>
        <CheckChip check={model.differences.length > 0 ? "DIFF" : "MATCH"} count={model.differences.length} w={w} />
      </div>
      {model.differences.length === 0 ? (
        <p className={fin.muted}>{w(FINANCE_WORDS.differencesNone)}</p>
      ) : (
        <>
          <DifferenceTable rows={model.differences.slice(0, DIFFERENCES_AT_ONCE)} w={w} moneyText={moneyText} />
          {model.differences.length > DIFFERENCES_AT_ONCE ? (
            <details className={fin.unreadList}>
              <summary>
                {w(FINANCE_WORDS.differencesMore)} · {model.differences.length - DIFFERENCES_AT_ONCE}
              </summary>
              <DifferenceTable rows={model.differences.slice(DIFFERENCES_AT_ONCE)} w={w} moneyText={moneyText} />
            </details>
          ) : null}
        </>
      )}
      {model.unread.length > 0 ? (
        <details className={fin.unreadList}>
          <summary>
            {w(FINANCE_WORDS.unreadTitle)} · {model.unread.length}
          </summary>
          <ul>
            {model.unread.map((entry, index) => (
              <li key={`${entry.kind}:${entry.subject}:${index}`}>
                {w(lineWord(entry.line))} — {w(unreadWord(entry.kind))}
                {entry.subject && entry.subject.length < 12 ? ` · ${entry.subject}` : ""}
                {entry.count ? ` · ${entry.count}` : ""}
                {entry.hint ? <span className={fin.mono}> · {entry.hint}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function DifferenceTable({ rows, w, moneyText }: { rows: FinanceModel["differences"]; w: W; moneyText: (value: number | null) => string }) {
  return (
    <div className={`${styles.tableWrap} ${fin.scrollTable}`} tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{w(FINANCE_WORDS.colWhat)}</th>
            <th scope="col">{w(FINANCE_WORDS.colLine)}</th>
            <th scope="col">{w(FINANCE_WORDS.colWhere)}</th>
            <th scope="col" className={styles.cellNum}>
              {w(FINANCE_WORDS.colLedger)}
            </th>
            <th scope="col" className={styles.cellNum}>
              {w(FINANCE_WORDS.colChain)}
            </th>
            <th scope="col">{w(FINANCE_WORDS.colRef)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((difference, index) => (
            <tr key={`${difference.kind}:${difference.ref ?? index}:${index}`}>
              <td>{w(diffWord(difference.kind))}</td>
              <td>{w(lineWord(difference.line))}</td>
              <td>{subjectText(difference.subject, w)}</td>
              <td className={styles.cellNum}>{moneyText(difference.ledgerUsd)}</td>
              <td className={styles.cellNum}>{moneyText(difference.chainUsd)}</td>
              <td>
                {difference.ref ? (
                  <a className={fin.mono} href={`${SOLSCAN}/${difference.refKind === "account" ? "account" : "tx"}/${difference.ref}`} target="_blank" rel="noreferrer">
                    {short(difference.ref)}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A difference's subject: a launch's ticker as it is, a product or a ledger by its word. */
function subjectText(subject: string, w: W): string {
  const word = (FINANCE_WORDS as Record<string, Word | undefined>)[`subject_${subject}`];
  return word ? w(word) : `$${subject}`;
}

function percentText(value: number | null, locale: WorkspaceLocale): string {
  return value === null ? "—" : value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { style: "percent", maximumFractionDigits: 0 });
}

/** A count read in part is a floor (≥); a share or a median of part of the data is only approximate (~). */
function Metric({ label, value, note, metric, kind = "count" }: { label: string; value: string; note: string; metric: FinanceMetric; kind?: "count" | "share" }) {
  return (
    <div className={fin.metric} data-at-least={metric.atLeast}>
      <span className={fin.metricLabel}>{label}</span>
      <b className={fin.metricValue}>
        {metric.atLeast && metric.value !== null ? <span className={fin.atLeast}>{kind === "count" ? "≥ " : "~ "}</span> : null}
        {value}
      </b>
      <span className={fin.muted}>{note}</span>
    </div>
  );
}

function Metrics({ model, w, locale }: { model: FinanceModel; w: W; locale: WorkspaceLocale }) {
  const m = model.metrics;
  const count = (metric: FinanceMetric) => (metric.value === null ? "—" : metric.value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US"));
  return (
    <section className={styles.card} aria-labelledby="finance-metrics">
      <div className={styles.cardHead}>
        <h2 id="finance-metrics" className={styles.cardTitle}>
          {w(FINANCE_WORDS.metricsTitle)}
        </h2>
      </div>
      <div className={fin.metrics}>
        <Metric label={w(FINANCE_WORDS.metric_median)} value={m.medianRevenuePerLaunch.value === null ? "—" : formatUsd(m.medianRevenuePerLaunch.value)} note={`${w(FINANCE_WORDS.ofLaunches)}: ${m.medianRevenuePerLaunch.n}`} metric={m.medianRevenuePerLaunch} kind="share" />
        <Metric label={w(FINANCE_WORDS.metric_creators)} value={count(m.activeCreators)} note={`${w(FINANCE_WORDS.ofCreators)}: ${m.activeCreators.n}`} metric={m.activeCreators} />
        <Metric label={w(FINANCE_WORDS.metric_repeat)} value={count(m.repeatTraders)} note={`${w(FINANCE_WORDS.ofTraders)}: ${m.traders.value ?? "—"}`} metric={m.repeatTraders} />
        <Metric label={w(FINANCE_WORDS.metric_d7)} value={percentText(m.d7.value, locale)} note={`${w(FINANCE_WORDS.eligible)}: ${m.d7.n}`} metric={m.d7} kind="share" />
        <Metric label={w(FINANCE_WORDS.metric_d30)} value={percentText(m.d30.value, locale)} note={`${w(FINANCE_WORDS.eligible)}: ${m.d30.n}`} metric={m.d30} kind="share" />
        <Metric label={w(FINANCE_WORDS.metric_success)} value={percentText(m.executionSuccess.value, locale)} note={`${w(FINANCE_WORDS.ofFinished)}: ${m.executionSuccess.n}`} metric={m.executionSuccess} kind="share" />
      </div>
      <details className={ext.defs}>
        <summary className={ext.defsSummary}>{w(FINANCE_WORDS.howCounted)}</summary>
        <dl className={ext.defsList}>
          {(
            [
              ["metric_median", "def_median"],
              ["metric_creators", "def_creators"],
              ["metric_repeat", "def_repeat"],
              ["metric_d7", "def_retention"],
              ["metric_success", "def_success"],
            ] as const
          ).map(([label, definition]) => (
            <div key={label} className={ext.defsItem}>
              <dt>{w(FINANCE_WORDS[label])}</dt>
              <dd>{w(FINANCE_WORDS[definition])}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

const wordOf = (key: string): Word | undefined => (FINANCE_WORDS as Record<string, Word | undefined>)[key];

/** MET-1: gross revenue by source, what is beside it and never added, each cost with «manual» where it is a bill, the contribution. */
function Margin({ model, w, money, locale }: { model: FinanceModel; w: W; money: Money; locale: WorkspaceLocale }) {
  const margin = model.margin;
  const incentives = margin.incentives;
  return (
    <section className={styles.card} aria-labelledby="finance-margin">
      <div className={styles.cardHead}>
        <h2 id="finance-margin" className={styles.cardTitle}>
          {w(FINANCE_WORDS.marginTitle)}
        </h2>
      </div>
      <p className={fin.muted}>{w(FINANCE_WORDS.marginLead)}</p>
      <dl className={fin.heroParts}>
        <div>
          <dt>{w(FINANCE_WORDS.gross)}</dt>
          <dd>{money(margin.gross)}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.contribution)}</dt>
          <dd>{money(margin.contribution)}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.contributionShare)}</dt>
          <dd>{percentText(margin.share, locale)}</dd>
        </div>
      </dl>

      <div className={`${styles.tableWrap} ${fin.scrollTable}`} tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{w(FINANCE_WORDS.colSource)}</th>
              <th scope="col" className={styles.cellNum}>
                {w(FINANCE_WORDS.colGross)}
              </th>
              <th scope="col" className={styles.cellNum}>
                {w(FINANCE_WORDS.colVenue)}
              </th>
              <th scope="col" className={styles.cellNum}>
                {w(FINANCE_WORDS.colRyntra)}
              </th>
              <th scope="col" className={styles.cellNum}>
                {w(FINANCE_WORDS.colFlows)}
              </th>
            </tr>
          </thead>
          <tbody>
            {margin.sources.map((source) => (
              <tr key={source.id} data-source={source.id}>
                <th scope="row">{w(wordOf(`src_${source.id}`) ?? FINANCE_WORDS.colSource)}</th>
                {source.task ? (
                  <td className={styles.cellNum} colSpan={4}>
                    <span className={fin.unread}>
                      {w(FINANCE_WORDS.noSourceYet)} {source.task}
                    </span>
                  </td>
                ) : (
                  <>
                    <td className={styles.cellNum}>{money(source.gross)}</td>
                    <td className={styles.cellNum}>{money(source.venue)}</td>
                    <td className={styles.cellNum}>{money(source.ryntra)}</td>
                    <td className={styles.cellNum}>{source.flows ?? "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className={fin.lineDetails}>
        <summary>{w(FINANCE_WORDS.notAddedTitle)}</summary>
        <dl className={fin.parts}>
          {(["claimed", "claimable", "budget", "creators"] as const).map((id) => (
            <div key={id}>
              <dt>{w(FINANCE_WORDS[`notAdded_${id}`])}</dt>
              <dd>{money(margin.notAdded[id])}</dd>
            </div>
          ))}
        </dl>
      </details>

      <h3 className={styles.cardTitle}>{w(FINANCE_WORDS.costsTitle)}</h3>
      <div className={`${styles.tableWrap} ${fin.scrollTable}`} tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{w(FINANCE_WORDS.colCost)}</th>
              <th scope="col" className={styles.cellNum}>
                {w(FINANCE_WORDS.costsShort)}
              </th>
              <th scope="col">{w(FINANCE_WORDS.sources)}</th>
            </tr>
          </thead>
          <tbody>
            {margin.costs.map((cost) => (
              <tr key={cost.id} data-cost={cost.id} data-manual={cost.manual}>
                <th scope="row">
                  {w(wordOf(`cost_${cost.id}`) ?? FINANCE_WORDS.colCost)}
                  {cost.manual ? <span className={fin.own}>{w(FINANCE_WORDS.manual)}</span> : null}
                </th>
                <td className={styles.cellNum}>{cost.usd === null ? <span className={fin.unread}>{w(FINANCE_WORDS.noData)}</span> : money(cost)}</td>
                <td>
                  {cost.parts.map((part, index) => (
                    <span key={part.id} className={fin.muted}>
                      {index > 0 ? " · " : ""}
                      {w(wordOf(`costPart_${part.id}`) ?? FINANCE_WORDS.sources)}: {part.usd === null ? w(FINANCE_WORDS.noData) : money(part)}
                      {part.manual && cost.parts.length > 1 ? ` (${w(FINANCE_WORDS.manual)})` : ""}
                      {part.months?.length ? ` · ${w(FINANCE_WORDS.manualMonths)} ${part.months.join(", ")}` : ""}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={fin.muted}>{w(FINANCE_WORDS.manualHow)}</p>
      {margin.manualRefused > 0 ? (
        <p className={fin.muted} role="status">
          {margin.manualRefused} {w(FINANCE_WORDS.manualRefused)}
        </p>
      ) : null}

      <h3 className={styles.cardTitle}>{w(FINANCE_WORDS.incentivesTitle)}</h3>
      <dl className={fin.heroParts}>
        <div>
          <dt>{w(FINANCE_WORDS.incentivesBase)}</dt>
          <dd>{money(incentives.base)}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.incentivesAccrued)}</dt>
          <dd>{money(incentives.accrued)}</dd>
        </div>
        <div>
          <dt>{w(FINANCE_WORDS.incentivesRate)}</dt>
          <dd>{percentText(incentives.rate, locale)}</dd>
        </div>
      </dl>
      {incentives.aboveReceived ? (
        <p role="alert">
          <span className={`${ext.chip} ${ext.chipRisk}`}>{w(FINANCE_WORDS.incentivesAbove)}</span>
        </p>
      ) : null}
      {incentives.grossBaseRows > 0 || incentives.baseUnknownRows > 0 ? (
        <p className={fin.muted}>
          {incentives.grossBaseRows > 0 ? `${incentives.grossBaseRows} ${w(FINANCE_WORDS.incentivesGrossRows)}` : ""}
          {incentives.grossBaseRows > 0 && incentives.baseUnknownRows > 0 ? " · " : ""}
          {incentives.baseUnknownRows > 0 ? `${incentives.baseUnknownRows} ${w(FINANCE_WORDS.incentivesUnknownRows)}` : ""}
        </p>
      ) : null}
      <p className={fin.muted}>{w(FINANCE_WORDS.ratesTerminal)}</p>
      <p className={fin.muted}>{w(FINANCE_WORDS.ratesLaunch)}</p>
    </section>
  );
}

function successValue(metric: SuccessMetric, w: W, locale: WorkspaceLocale): string {
  if (metric.value === null) return metric.state === "UNREAD" ? w(FINANCE_WORDS.unreadValue) : w(FINANCE_WORDS.noData);
  if (metric.unit === "share") return percentText(metric.value, locale);
  if (metric.unit === "ms") return metric.value >= 1_000 ? `${(metric.value / 1_000).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 1 })} s` : `${Math.round(metric.value)} ms`;
  return metric.value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US");
}

function successNote(metric: SuccessMetric, w: W): string {
  if (metric.state === "NO_SOURCE") return `${w(FINANCE_WORDS.noSourceYet)} ${metric.task ?? ""}`;
  const notes: string[] = [];
  if (metric.n !== null) notes.push(`${w(FINANCE_WORDS.successOf)} ${metric.n}`);
  if (metric.recent !== undefined && metric.recent !== null) notes.push(`${metric.recent} ${w(FINANCE_WORDS.successLast30)}`);
  for (const part of metric.parts ?? []) notes.push(`${w(wordOf(`successPart_${part.id}`) ?? FINANCE_WORDS.sources)} ${part.value ?? "—"}`);
  if (metric.target !== undefined) notes.push(w(FINANCE_WORDS.successTarget));
  if (metric.approximate) notes.push(w(FINANCE_WORDS.successApprox));
  return notes.join(" · ");
}

/** MET-1: what people and Ryntra's automation did; unknown is «no data», never 0. */
function Success({ model, w, locale }: { model: FinanceModel; w: W; locale: WorkspaceLocale }) {
  return (
    <section className={styles.card} aria-labelledby="finance-success">
      <div className={styles.cardHead}>
        <h2 id="finance-success" className={styles.cardTitle}>
          {w(FINANCE_WORDS.successTitle)}
        </h2>
      </div>
      <p className={fin.muted}>{w(FINANCE_WORDS.successLead)}</p>
      <div className={fin.metrics}>
        {model.success.metrics.map((metric) => (
          <div key={metric.id} className={fin.metric} data-metric={metric.id} data-state={metric.state} data-at-least={metric.atLeast}>
            <span className={fin.metricLabel}>{w(wordOf(`success_${metric.id}`) ?? FINANCE_WORDS.successTitle)}</span>
            <b className={metric.value === null ? fin.unread : fin.metricValue}>
              {metric.atLeast && metric.value !== null ? <span className={fin.atLeast}>{metric.unit === "share" ? "~ " : "≥ "}</span> : null}
              {successValue(metric, w, locale)}
            </b>
            <span className={fin.muted}>{successNote(metric, w)}</span>
          </div>
        ))}
      </div>
      <details className={ext.defs}>
        <summary className={ext.defsSummary}>{w(FINANCE_WORDS.howCounted)}</summary>
        <p className={fin.muted}>{w(FINANCE_WORDS.successDefs)}</p>
      </details>
    </section>
  );
}

function Launches({ model, w, money }: { model: FinanceModel; w: W; money: Money }) {
  return (
    <section className={styles.card} aria-labelledby="finance-launches">
      <div className={styles.cardHead}>
        <h2 id="finance-launches" className={styles.cardTitle}>
          {w(FINANCE_WORDS.launchesTitle)}
        </h2>
      </div>
      {model.launches.length === 0 ? (
        <p className={fin.muted}>{w(FINANCE_WORDS.launchesEmpty)}</p>
      ) : (
        <div className={`${styles.tableWrap} ${fin.scrollTable}`} tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{w(FINANCE_WORDS.colToken)}</th>
                <th scope="col">{w(FINANCE_WORDS.colPreset)}</th>
                <th scope="col" className={styles.cellNum}>
                  {w(FINANCE_WORDS.colRevenue)}
                </th>
                <th scope="col" className={styles.cellNum}>
                  {w(FINANCE_WORDS.colBudget)}
                </th>
                <th scope="col" className={styles.cellNum}>
                  {w(FINANCE_WORDS.colClaimable)}
                </th>
                <th scope="col" className={styles.cellNum}>
                  {w(FINANCE_WORDS.colClaimed)}
                </th>
                <th scope="col" className={styles.cellNum}>
                  {w(FINANCE_WORDS.colCreators)}
                </th>
                <th scope="col">{w(FINANCE_WORDS.colState)}</th>
              </tr>
            </thead>
            <tbody>
              {model.launches.map((launch) => (
                <tr key={launch.token}>
                  <td>
                    <a href={`/app/launch/${launch.token}`} className={fin.token}>
                      ${launch.symbol}
                    </a>
                    {launch.own ? <span className={fin.own}>{w(FINANCE_WORDS.own)}</span> : null}
                  </td>
                  <td>{w(FINANCE_WORDS[`preset_${launch.preset}` as keyof typeof FINANCE_WORDS] as Word)}</td>
                  <td className={styles.cellNum}>{money(launch.revenue)}</td>
                  <td className={styles.cellNum}>{money(launch.budget)}</td>
                  <td className={styles.cellNum}>{money(launch.claimable)}</td>
                  <td className={styles.cellNum}>{money(launch.claimed)}</td>
                  <td className={styles.cellNum}>{money(launch.creators)}</td>
                  <td>
                    <CheckChip check={launch.check} w={w} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Method({ w }: { w: W }) {
  const rule = incomeRule();
  const cell = (preset: (typeof METHOD_PRESETS)[number], source: (typeof INCOME_SOURCES)[number]) => rule.find((row) => row.preset === preset && row.source === source)!;
  const pct = (bps: number) => `${bps / 100} %`;
  return (
    <section className={styles.card} aria-labelledby="finance-method">
      <details className={fin.method}>
        <summary id="finance-method" className={styles.cardTitle}>
          {w(FINANCE_WORDS.methodTitle)}
        </summary>
        <p className={fin.muted}>{w(FINANCE_WORDS.methodLead)}</p>
        <div className={`${styles.tableWrap} ${fin.scrollTable}`} tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{w(FINANCE_WORDS.methodSource)}</th>
                {METHOD_PRESETS.map((preset) => (
                  <th key={preset} scope="col">
                    {w(FINANCE_WORDS[`preset_${preset}`])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INCOME_SOURCES.map((source) => (
                <tr key={source}>
                  <th scope="row">{w(sourceWord(source))}</th>
                  {METHOD_PRESETS.map((preset) => {
                    const row = cell(preset, source);
                    return (
                      <td key={preset}>
                        {w(FINANCE_WORDS.methodRevenue)} {pct(row.revenueBps)}
                        {row.budgetBps > 0 ? ` · ${w(FINANCE_WORDS.methodBudget)} ${pct(row.budgetBps)}` : ""}
                        {!row.fee ? <span className={fin.muted}> · {w(FINANCE_WORDS.methodNotFee)}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={fin.muted}>{w(FINANCE_WORDS.methodSubmit)}</p>
      </details>
    </section>
  );
}
