import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { Section, StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { MaterialChange } from "@/lib/home/research/change";
import type { ResearchProjection, ScheduledRule } from "@/lib/home/research/read-model";
import { SectionIcons, stateTone } from "./tiles";
import styles from "./research.module.css";

/**
 * Every reader-facing literal on the change detail, per locale, in this file —
 * release checks regex this source for the exact English strings. English is
 * byte-identical to what shipped; `uk` is its twin. Evidence fields (subject,
 * values, source ids, refs) are rendered as received.
 */
type DetailCopy = Readonly<{
  eyebrow: string;
  radar: string;
  whatChangedTitle: string;
  whatChangedInfo: ReactNode;
  fact: string;
  kind: string;
  severity: string;
  observed: string;
  unknown: string;
  baseline: string;
  current: string;
  noneRecorded: string;
  notSupplied: string;
  measurementTitle: string;
  measurementInfo: ReactNode;
  threshold: string;
  none: string;
  measured: string;
  notMeasurable: string;
  state: string;
  ruleTitle: string;
  ruleInfo: ReactNode;
  rule: string;
  ruleVersion: string;
  mandateVersion: string;
  executionAuthority: string;
  schedule: string;
  onEvent: string;
  nextRun: string;
  evidenceTitle: string;
  evidenceInfo: ReactNode;
}>;

const COPY = {
  en: {
    eyebrow: "Ryntra Home · Research",
    radar: "Radar",
    whatChangedTitle: "What changed",
    whatChangedInfo: (
      <p>
        Both readings and their sources, never a reconciled number. When two sources
        disagree each keeps its own row: an average would be a value nobody reported and
        no evidence supports.
      </p>
    ),
    fact: "Fact",
    kind: "Kind",
    severity: "Severity",
    observed: "Observed",
    unknown: "Unknown",
    baseline: "Baseline",
    current: "Current",
    noneRecorded: "None recorded",
    notSupplied: "Not supplied",
    measurementTitle: "Measured against",
    measurementInfo: (
      <p>
        A threshold, a measurement and the gap between them. A relative move is rounded
        away from zero, so a reading just over its threshold is reported rather than
        quietly swallowed — under-reporting is the expensive direction of that error.
      </p>
    ),
    threshold: "Threshold",
    none: "None",
    measured: "Measured",
    notMeasurable: "Not measurable",
    state: "State",
    ruleTitle: "The rule that surfaced it",
    ruleInfo: (
      <p>
        Every change points at the exact versioned rule that produced it, and every rule
        points at the exact versioned mandate it was compiled from. A rule authorizes
        watching and nothing else — its execution authority is <b>NONE</b> and there is
        no field on it that could say otherwise.
      </p>
    ),
    rule: "Rule",
    ruleVersion: "Rule version",
    mandateVersion: "Mandate version",
    executionAuthority: "Execution authority",
    schedule: "Schedule",
    onEvent: "on event",
    nextRun: "Next run",
    evidenceTitle: "Evidence",
    evidenceInfo: (
      <p>
        The sources that reported this change and the evidence references they carry.
        Evidence stays multi-axis — source, entitlement, observation time, freshness,
        conflict group and lineage — and never collapses into one confidence number.
      </p>
    ),
  },
  uk: {
    eyebrow: "Ryntra Home · Дослідження",
    radar: "Радар",
    whatChangedTitle: "Що змінилося",
    whatChangedInfo: (
      <p>
        Обидва показники та їхні джерела, ніколи не зведене число. Коли два джерела
        розходяться, кожне зберігає власний рядок: середнє було б значенням, якого
        ніхто не звітував і яке не підтверджує жоден доказ.
      </p>
    ),
    fact: "Факт",
    kind: "Тип",
    severity: "Серйозність",
    observed: "Спостережено",
    unknown: "Невідомо",
    baseline: "База",
    current: "Поточне",
    noneRecorded: "Не зафіксовано",
    notSupplied: "Не надано",
    measurementTitle: "Проти чого виміряно",
    measurementInfo: (
      <p>
        Поріг, вимірювання і розрив між ними. Відносний рух округлюється від нуля, тож
        показник, що ледь перевищив поріг, звітується, а не тихо ковтається —
        недозвітування тут дорожчий напрямок помилки.
      </p>
    ),
    threshold: "Поріг",
    none: "Немає",
    measured: "Виміряно",
    notMeasurable: "Неможливо виміряти",
    state: "Стан",
    ruleTitle: "Правило, що це виявило",
    ruleInfo: (
      <p>
        Кожна зміна вказує на точне версіоноване правило, що її породило, а кожне
        правило — на точний версіонований мандат, з якого його скомпільовано. Правило
        дозволяє відстеження і більше нічого — його право на виконання <b>NONE</b>, і
        на ньому немає поля, яке могло б стверджувати інакше.
      </p>
    ),
    rule: "Правило",
    ruleVersion: "Версія правила",
    mandateVersion: "Версія мандата",
    executionAuthority: "Право на виконання",
    schedule: "Розклад",
    onEvent: "за подією",
    nextRun: "Наступний запуск",
    evidenceTitle: "Докази",
    evidenceInfo: (
      <p>
        Джерела, що звітували цю зміну, і посилання на докази, які вони несуть. Докази
        лишаються багатовимірними — джерело, право, час спостереження, свіжість, група
        конфлікту й походження — і ніколи не згортаються в одне число впевненості.
      </p>
    ),
  },
} as const satisfies Record<WorkspaceLocale, DetailCopy>;

/**
 * One change, in full — the body of `/app/research/[id]`.
 *
 * It lives here rather than inside the route so the same markup can be driven
 * by literal evidence in a rendered-QA harness. A detail surface that can only
 * be looked at through a live account and a live venue is a surface nobody
 * looks at, and this repository's rule is that somebody looks at it every time.
 *
 * Everything is a field off the change. There is no reconciliation, no derived
 * "best" value and no arithmetic; when two sources disagree both rows are here
 * and neither is chosen.
 */
export function ChangeDetail({
  change,
  rule,
  projection,
  locale = "en",
}: {
  change: MaterialChange;
  rule: ScheduledRule | null;
  projection: ResearchProjection | null;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={styles.surface} data-surface-state={change.state}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>{c.eyebrow}</p>
          <h1>{change.subjectLabel}</h1>
        </div>
        <div className={styles.headMeta}>
          <StateChip tone={stateTone(change.state)} label={change.state} />
          <Link className={styles.link} href="/app/research">{c.radar} <ArrowRight size={13} weight="bold" aria-hidden /></Link>
        </div>
      </header>

      <Section
        id="what-changed"
        title={c.whatChangedTitle}
        icon={SectionIcons.change}
        locale={locale}
        info={c.whatChangedInfo}
      >
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.fact}</span>
            <span className={styles.factValue}>{change.factKey}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.kind}</span>
            <span className={styles.factValue}>{change.kind}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.severity}</span>
            <span className={styles.factValue}>{change.severity}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.observed}</span>
            {change.observedAt === null
              ? <span className={styles.factUnknown}>{c.unknown}</span>
              : <time className={styles.factValue} dateTime={change.observedAt}>{change.observedAt.slice(0, 19).replace("T", " ")}Z</time>}
          </div>
        </div>

        {change.conflict.length > 0 ? (
          <ul className={styles.conflict}>
            {change.conflict.map((entry) => (
              <li key={entry.sourceId} className={styles.conflictRow}>
                <span>{entry.sourceId}</span>
                <span className={styles.conflictValue}>{entry.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className={styles.rows}>
            <li className={styles.row}>
              <span className={styles.rowName}>
                {c.baseline}
                {change.previous === null ? null : <span>{change.previous.source}</span>}
              </span>
              {change.previous === null
                ? <span className={styles.factUnknown}>{c.noneRecorded}</span>
                : <span className={styles.conflictValue}>{change.previous.value}</span>}
            </li>
            <li className={styles.row}>
              <span className={styles.rowName}>
                {c.current}
                {change.current === null ? null : <span>{change.current.source}</span>}
              </span>
              {change.current === null
                ? <span className={styles.factUnknown}>{c.notSupplied}</span>
                : <span className={styles.conflictValue}>{change.current.value}</span>}
            </li>
          </ul>
        )}
      </Section>

      <Section
        id="measurement"
        title={c.measurementTitle}
        icon={SectionIcons.evidence}
        locale={locale}
        info={c.measurementInfo}
      >
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.threshold}</span>
            {change.threshold === null
              ? <span className={styles.factUnknown}>{c.none}</span>
              : (
                <span className={styles.factValue}>
                  {change.threshold.value === null
                    ? change.threshold.comparison
                    : `${change.threshold.value} ${change.threshold.unit ?? ""}`.trim()}
                </span>
              )}
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.measured}</span>
            {change.measured === null
              ? <span className={styles.factUnknown}>{c.notMeasurable}</span>
              : <span className={styles.factValue}>{`${change.measured.value} ${change.measured.unit ?? ""}`.trim()}</span>}
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.state}</span>
            <span className={styles.factValue}>{change.state}</span>
          </div>
        </div>
        {change.unknown.length === 0 ? null : (
          <ul className={styles.note}>
            {change.unknown.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </Section>

      <Section
        id="rule"
        title={c.ruleTitle}
        icon={SectionIcons.rule}
        locale={locale}
        info={c.ruleInfo}
      >
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.rule}</span>
            <span className={styles.factValue}>{change.ruleId}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.ruleVersion}</span>
            <span className={styles.factValue}>{change.ruleVersion}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.mandateVersion}</span>
            <span className={styles.factValue}>{projection?.mandate.version ?? "—"}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.executionAuthority}</span>
            <span className={styles.factValue}>{projection?.mandate.executionAuthority ?? "NONE"}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.schedule}</span>
            <code className={styles.cron}>{rule?.schedule ?? c.onEvent}</code>
          </div>
          <div className={styles.fact}>
            <span className={styles.factKey}>{c.nextRun}</span>
            {rule?.run.next.state === "DECLARED" && rule.run.next.at !== null
              ? <time className={styles.factValue} dateTime={rule.run.next.at}>{rule.run.next.at.slice(0, 16).replace("T", " ")}Z</time>
              : <span className={styles.factUnknown}>{c.unknown}</span>}
          </div>
        </div>
      </Section>

      <Section
        id="evidence"
        title={c.evidenceTitle}
        icon={SectionIcons.sources}
        locale={locale}
        info={c.evidenceInfo}
      >
        <ul className={styles.rows}>
          {change.sources.map((sourceId) => (
            <li key={sourceId} className={styles.row}>
              <span className={styles.rowName}>{sourceId}</span>
              <StateChip
                tone="quiet"
                label={projection?.sources.find((entry) => entry.sourceId === sourceId)?.entitlement ?? "UNKNOWN"}
              />
            </li>
          ))}
        </ul>
        {change.evidenceRefs.length === 0 ? null : (
          <ul className={styles.note}>
            {change.evidenceRefs.map((ref) => <li key={ref}>{ref}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}
