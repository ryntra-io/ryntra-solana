import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BellSlash,
  Broadcast,
  CheckCircle,
  ClockCounterClockwise,
  Database,
  Eye,
  GitBranch,
  Question,
  ShieldWarning,
  Timer,
  TrendUp,
} from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { MaterialChange } from "@/lib/home/research/change";
import type {
  ResearchProjection,
  ResearchSourceState,
  ResearchViewProjection,
  ScheduledRule,
} from "@/lib/home/research/read-model";
import styles from "./research.module.css";

/**
 * The Research display layer.
 *
 * Every component reads a field off the projection and renders it. No
 * arithmetic, no re-derivation, no second opinion about what a change means —
 * `lib/home/research` decided all of that with tests on it.
 *
 * The chrome is the Portfolio surface's, imported rather than copied: `Section`
 * and `StateChip` already carry the Home system's spacing, tone vocabulary and
 * info control, and a second implementation of them would be two surfaces
 * drifting apart one commit at a time.
 *
 * Two presentation rules apply here:
 *
 *   **Unknown is neutral.** Never green, never zero, never absent.
 *
 *   **A conflict shows every value.** There is no reconciled figure anywhere in
 *   this file, because there is none in the model.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file — release checks regex this source for the exact English strings.
 * English is byte-identical to what shipped; `uk` is its twin. Evidence
 * arriving from `lib/home/research` (labels, reasons, source words) is
 * rendered as received in both locales.
 */
type ResearchTilesCopy = Readonly<{
  radarViews: string;
  threshold: (reading: string) => string;
  open: string;
  lastRun: string;
  nextRun: string;
  cooldown: string;
  minutes: (n: number) => string;
  alertCeiling: string;
  perDay: (n: number) => string;
  maxSourceAge: string;
  seconds: (n: number) => string;
  quietHours: string;
  none: string;
  unknown: string;
  noRules: string;
  enrolled: string;
  noRunRecord: string;
  onEvent: string;
  anyStateChange: string;
  bps: string;
  absolute: string;
  sourcesEmpty: string;
  version: string;
  state: string;
  inScope: string;
  sources: string;
  dataReadsPerDay: string;
  aiCallsPerDay: string;
  alertsPerDay: string;
  executionAuthority: string;
}>;

const COPY = {
  en: {
    radarViews: "Radar views",
    threshold: (reading: string) => `threshold ${reading}`,
    open: "Open",
    lastRun: "Last run",
    nextRun: "Next run",
    cooldown: "Cooldown",
    minutes: (n: number) => `${n} min`,
    alertCeiling: "Alert ceiling",
    perDay: (n: number) => `${n}/day`,
    maxSourceAge: "Max source age",
    seconds: (n: number) => `${n}s`,
    quietHours: "Quiet hours",
    none: "None",
    unknown: "Unknown",
    noRules: "This mandate compiled no rule, so nothing is scheduled and nothing is being watched.",
    enrolled: "Enrolled",
    noRunRecord: "No run record",
    onEvent: "on event",
    anyStateChange: "any state change",
    bps: "bps",
    absolute: "absolute",
    sourcesEmpty: "No source is connected, so nothing on this page is a current fact.",
    version: "Version",
    state: "State",
    inScope: "In scope",
    sources: "Sources",
    dataReadsPerDay: "Data reads/day",
    aiCallsPerDay: "AI calls/day",
    alertsPerDay: "Alerts/day",
    executionAuthority: "Execution authority",
  },
  uk: {
    radarViews: "Види радара",
    threshold: (reading: string) => `поріг ${reading}`,
    open: "Відкрити",
    lastRun: "Останній запуск",
    nextRun: "Наступний запуск",
    cooldown: "Пауза між спрацюваннями",
    minutes: (n: number) => `${n} хв`,
    alertCeiling: "Стеля сповіщень",
    perDay: (n: number) => `${n}/день`,
    maxSourceAge: "Макс. вік джерела",
    seconds: (n: number) => `${n} с`,
    quietHours: "Тихі години",
    none: "Немає",
    unknown: "Невідомо",
    noRules: "Цей мандат не скомпілював жодного правила, тож ніщо не заплановано і ніщо не відстежується.",
    enrolled: "У розкладі",
    noRunRecord: "Без запису запусків",
    onEvent: "за подією",
    anyStateChange: "будь-яка зміна стану",
    bps: "б.п.",
    absolute: "абс.",
    sourcesEmpty: "Жодне джерело не підключено, тож ніщо на цій сторінці не є поточним фактом.",
    version: "Версія",
    state: "Стан",
    inScope: "В обсязі",
    sources: "Джерела",
    dataReadsPerDay: "Читань даних/день",
    aiCallsPerDay: "AI-викликів/день",
    alertsPerDay: "Сповіщень/день",
    executionAuthority: "Право на виконання",
  },
} as const satisfies Record<WorkspaceLocale, ResearchTilesCopy>;

/**
 * Ukrainian twins for the six view labels, keyed by the stable view id. The
 * English path keeps rendering `view.label` exactly as the read model wrote
 * it, so the projection stays the single English authority; only the display
 * language `uk` substitutes, and only by id, never by rewording lib copy.
 */
const UK_VIEW_LABEL: Readonly<Record<ResearchViewProjection["id"], string>> = {
  FOR_ME: "Для мене",
  WATCHLIST: "Список спостереження",
  MARKET: "Ринок",
  CONFLICTS: "Конфлікти",
  UNKNOWNS: "Невідоме",
  SCHEDULED: "Заплановано",
};

export function stateTone(state: MaterialChange["state"]): Tone {
  if (state === "CONFLICT") return "caution";
  if (state === "MATERIAL") return "risk";
  if (state === "UNKNOWN") return "unknown";
  return "quiet";
}

export function surfaceTone(state: ResearchProjection["state"]): Tone {
  if (state === "CALM") return "good";
  if (state === "ERROR") return "risk";
  if (state === "DEGRADED" || state === "ATTENTION") return "caution";
  return "unknown";
}

export const SectionIcons = {
  radar: <Broadcast size={17} weight="bold" aria-hidden />,
  mandate: <Eye size={17} weight="bold" aria-hidden />,
  scheduled: <Timer size={17} weight="bold" aria-hidden />,
  sources: <Database size={17} weight="bold" aria-hidden />,
  change: <TrendUp size={17} weight="bold" aria-hidden />,
  rule: <GitBranch size={17} weight="bold" aria-hidden />,
  evidence: <ShieldWarning size={17} weight="bold" aria-hidden />,
} as const;

/** The six views as a rail, each carrying the count that makes it worth opening. */
export function ViewRail({
  views,
  active,
  locale = "en",
}: {
  views: readonly ResearchViewProjection[];
  active: ResearchViewProjection["id"];
  locale?: WorkspaceLocale;
}) {
  return (
    <nav aria-label={COPY[locale].radarViews}>
      <ul className={styles.views}>
        {views.map((view) => {
          const count = view.id === "SCHEDULED" ? view.scheduled.length : view.items.length;
          return (
            <li key={view.id}>
              <Link
                className={`${styles.view} ${view.id === active ? styles.viewActive : ""}`}
                href={`/app/research?view=${view.id}`}
                aria-current={view.id === active ? "page" : undefined}
                data-view={view.id}
              >
                {locale === "uk" ? UK_VIEW_LABEL[view.id] : view.label}
                <span className={styles.viewCount}>{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The reading, on its own line rather than inside the meta row.
 *
 * Found by looking: a conflict renders as a *list*, and a list inline between a
 * fact name and a timestamp pushed the timestamp to the vertical middle of two
 * stacked pills. The row read as broken. Values get their own line, so a
 * conflict stacks cleanly and a move stays on one line.
 */
function Reading({ change }: { change: MaterialChange }) {
  if (change.state === "CONFLICT") {
    return (
      <ul className={styles.conflict}>
        {change.conflict.map((entry) => (
          <li key={entry.sourceId} className={styles.conflictRow}>
            <span>{entry.sourceId}</span>
            <span className={styles.conflictValue}>{entry.value}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (change.previous === null && change.current === null) return null;
  return (
    <span className={styles.move}>
      {change.previous === null ? null : (
        <>
          <span className={styles.moveFrom}>{change.previous.value}</span>
          <ArrowRight size={12} weight="bold" aria-hidden className={styles.moveArrow} />
        </>
      )}
      <span className={styles.moveTo}>{change.current?.value ?? "—"}</span>
    </span>
  );
}

export function ChangeRow({ change, locale = "en" }: { change: MaterialChange; locale?: WorkspaceLocale }) {
  const c = COPY[locale];
  const threshold = change.threshold?.value === null || change.threshold === null
    ? null
    : c.threshold(`${change.threshold.value}${change.threshold.unit === null ? "" : ` ${change.threshold.unit}`}`);
  return (
    <li className={styles.change} data-state={change.state} data-kind={change.kind}>
      <div className={styles.changeBody}>
        <span className={styles.changeTitle}>
          <StateChip tone={stateTone(change.state)} label={change.state} />
          {change.subjectLabel}
        </span>
        <span className={styles.changeMeta}>
          <b>{change.factKey}</b>
          {change.measured === null ? null : (
            <span>
              {`${change.measured.value}${change.measured.unit === null ? "" : ` ${change.measured.unit}`}`}
              {threshold === null ? "" : ` · ${threshold}`}
            </span>
          )}
          {change.observedAt === null ? null : <time dateTime={change.observedAt}>{change.observedAt.slice(11, 19)}Z</time>}
        </span>
        <Reading change={change} />
        {/* An unknown row that shows a dash and no reason is the state this
            product refuses everywhere else. The reason is the row. */}
        {change.unknown.length === 0 ? null : (
          <span className={styles.changeReason}>{change.unknown[0]}</span>
        )}
      </div>
      <Link className={styles.link} href={`/app/research/${change.id}`}>
        {c.open} <ArrowRight size={13} weight="bold" aria-hidden />
      </Link>
    </li>
  );
}

export function ChangeList({ view, locale = "en" }: { view: ResearchViewProjection; locale?: WorkspaceLocale }) {
  if (view.items.length === 0) {
    /* A tick beside "Ryntra has no server-readable watchlist" is a pass mark on
       something that was never measured. Calm and unanswerable get different
       marks, and only calm gets the tick. */
    return (
      <p className={styles.empty} data-tone={view.emptyTone}>
        {view.emptyTone === "CALM"
          ? <CheckCircle size={15} weight="fill" aria-hidden />
          : <Question size={15} weight="bold" aria-hidden />}
        {view.emptyReason}
      </p>
    );
  }
  return (
    <ul className={styles.changes}>
      {view.items.map((change) => <ChangeRow key={change.id} change={change} locale={locale} />)}
    </ul>
  );
}

function RunFact({ rule, locale = "en" }: { rule: ScheduledRule; locale?: WorkspaceLocale }) {
  const c = COPY[locale];
  return (
    <div className={styles.facts}>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.lastRun}</span>
        {rule.run.last.state === "OBSERVED" && rule.run.last.at !== null ? (
          <time className={styles.factValue} dateTime={rule.run.last.at}>{rule.run.last.at.slice(0, 16).replace("T", " ")}Z</time>
        ) : (
          <span className={styles.factUnknown}>{c.unknown}</span>
        )}
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.nextRun}</span>
        {rule.run.next.state === "DECLARED" && rule.run.next.at !== null ? (
          <time className={styles.factValue} dateTime={rule.run.next.at}>{rule.run.next.at.slice(0, 16).replace("T", " ")}Z</time>
        ) : (
          <span className={styles.factUnknown}>{c.unknown}</span>
        )}
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.cooldown}</span>
        <span className={styles.factValue}>{c.minutes(Math.round(rule.cooldownSeconds / 60))}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.alertCeiling}</span>
        <span className={styles.factValue}>{rule.maxAlerts === null ? "—" : c.perDay(rule.maxAlerts)}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.maxSourceAge}</span>
        <span className={styles.factValue}>{rule.maxSourceAgeSeconds === null ? "—" : c.seconds(rule.maxSourceAgeSeconds)}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.quietHours}</span>
        {rule.quietHours === null ? (
          <span className={styles.factUnknown}>{c.none}</span>
        ) : (
          <span className={styles.factValue}>{rule.quietHours.fromHourUtc}–{rule.quietHours.toHourUtc} UTC</span>
        )}
      </div>
    </div>
  );
}

export function RuleList({ rules, locale = "en" }: { rules: readonly ScheduledRule[]; locale?: WorkspaceLocale }) {
  const c = COPY[locale];
  if (rules.length === 0) {
    return (
      <p className={styles.empty}>
        <Question size={15} weight="bold" aria-hidden />
        {c.noRules}
      </p>
    );
  }
  return (
    <ul className={styles.rules}>
      {rules.map((rule) => (
        <li key={rule.ruleId} className={styles.rule} data-rule={rule.ruleId}>
          <div className={styles.ruleHead}>
            <span className={styles.ruleName}>
              {SectionIcons.rule}
              {rule.label}
              <StateChip tone="quiet" label={rule.scopeKind} />
            </span>
            {/* Two bare icons and a raw cron expression is what this was, and it
                read as three stray asterisks beside two unlabelled glyphs.
                Enrolment is now a named chip, and the expression sits in a
                literal so it reads as a schedule rather than as punctuation. */}
            <span className={styles.changeMeta}>
              {rule.run.enrolled
                ? <Bell size={14} weight="fill" aria-hidden />
                : <BellSlash size={14} weight="bold" aria-hidden />}
              <StateChip tone="quiet" label={rule.run.enrolled ? c.enrolled : c.noRunRecord} />
              <ClockCounterClockwise size={14} weight="bold" aria-hidden />
              <code className={styles.cron}>{rule.schedule ?? c.onEvent}</code>
            </span>
          </div>
          <ul className={styles.rows}>
            {rule.triggers.map((trigger) => (
              <li key={`${rule.ruleId}:${trigger.factKey}`} className={styles.row}>
                <span className={styles.rowName}>
                  <b>{trigger.factKey}</b>
                  <span>{trigger.comparison === "STATE_CHANGE" ? c.anyStateChange : `${trigger.value} ${trigger.comparison === "RELATIVE_BPS" ? c.bps : c.absolute}`}</span>
                </span>
                <StateChip tone="quiet" label={trigger.severity} />
              </li>
            ))}
          </ul>
          <RunFact rule={rule} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

export function Sources({
  sources,
  locale = "en",
}: {
  sources: readonly ResearchSourceState[];
  locale?: WorkspaceLocale;
}) {
  if (sources.length === 0) {
    return (
      <p className={styles.empty}>
        <Question size={15} weight="bold" aria-hidden />
        {COPY[locale].sourcesEmpty}
      </p>
    );
  }
  return (
    <ul className={styles.rows}>
      {sources.map((source) => (
        <li key={source.sourceId} className={styles.row}>
          <span className={styles.rowName}>
            {source.label}
            <StateChip tone="quiet" label={source.entitlement} />
            {source.reason === null ? null : <span>{source.reason}</span>}
          </span>
          <StateChip tone={source.state === "OK" ? "good" : source.state === "STALE" ? "caution" : "risk"} label={source.state} />
        </li>
      ))}
    </ul>
  );
}

export function MandateFacts({
  projection,
  locale = "en",
}: {
  projection: ResearchProjection;
  locale?: WorkspaceLocale;
}) {
  const { mandate } = projection;
  const c = COPY[locale];
  return (
    <div className={styles.facts}>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.version}</span>
        <span className={styles.factValue}>{mandate.version}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.state}</span>
        <span className={styles.factValue}>{mandate.state}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.inScope}</span>
        <span className={styles.factValue}>{mandate.scopeCount}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.sources}</span>
        <span className={styles.factValue}>{mandate.sourceCount}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.dataReadsPerDay}</span>
        <span className={styles.factValue}>{mandate.budgets.dataReadsPerDay ?? "—"}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.aiCallsPerDay}</span>
        <span className={styles.factValue}>{mandate.budgets.aiCallsPerDay ?? "—"}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.alertsPerDay}</span>
        <span className={styles.factValue}>{mandate.budgets.maxAlertsPerDay ?? "—"}</span>
      </div>
      <div className={styles.fact}>
        <span className={styles.factKey}>{c.executionAuthority}</span>
        <span className={styles.factValue}>{mandate.executionAuthority}</span>
      </div>
    </div>
  );
}
