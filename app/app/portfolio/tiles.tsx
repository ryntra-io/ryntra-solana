import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  ChartPieSlice,
  ClockCounterClockwise,
  Coins,
  CurrencyDollar,
  Database,
  EyeSlash,
  Gauge,
  Question,
  Scales,
  ShieldWarning,
  Warning,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { InfoControl } from "@/app/shell/info-control";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AttentionItem } from "@/lib/home/portfolio/attention";
import { formatBps, formatMoney } from "@/lib/home/portfolio/format";
import type {
  HomeCashBucket,
  HomePortfolioProjection,
  HomeRiskCategory,
  HomeSourceState,
} from "@/lib/home/portfolio/read-model";
import type { PnlProjection } from "@/lib/home/portfolio/pnl";
import styles from "./portfolio.module.css";

/**
 * The Home portfolio display layer.
 *
 * Every component here reads a field off the projection and renders it. There
 * is no arithmetic in this file and there must not be: `read-model.ts` owns
 * what a number means and `format.ts` owns what it looks like, so a second
 * definition of "spendable" cannot appear on a screen.
 *
 * Two presentation rules carry the canon:
 *
 *   Unknown is grey. Never green, never zero, never absent — a missing fact is
 *   shown as a missing fact, with its reason one click away.
 *
 *   Prose goes behind `InfoControl`. A workspace that prints its explanation
 *   permanently is documentation with controls attached; the reader gets a
 *   number, a state and an action, and the sentence when they ask for it.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file: release checks regex this source for the exact English strings, so the
 * copy lives beside the components it feeds rather than in a shared catalog.
 * English is byte-identical to what shipped; `uk` is its twin. Machine tokens
 * (bucket ids, book names, component names, source states) stay as-is in both.
 */
type TilesCopy = Readonly<{
  about: (title: string) => string;
  observed: string;
  notObservable: string;
  positions: string;
  valueCoverageUnknown: string;
  ofValue: (share: string) => string;
  evidenceFor: (title: string) => string;
  sourceWord: string;
  observedWord: string;
  freshnessWord: string;
  noDestination: string;
  open: string;
  valuationState: Readonly<
    Record<"PRICED" | "ESTIMATED" | "STALE" | "UNPRICED" | "CONFLICTING" | "PRIVATE_HIDDEN", string>
  >;
  unknown: string;
  whyBucketUnknown: (bucket: string) => string;
  emptyCategory: string;
  limitsOn: (category: string) => string;
  bookHead: (book: string) => string;
  netAvailable: string;
  netWithheld: string;
  whyComponent: (book: string, component: string, state: string) => string;
  whyNetWithheld: (book: string) => string;
  withheld: string;
  distributionEmpty: string;
  distributionHead: string;
  sourcesEmpty: string;
  whyDegraded: (label: string) => string;
  records: string;
  manage: string;
  bookPositions: (book: string) => string;
  noSource: string;
}>;

const COPY = {
  en: {
    about: (title: string) => `About ${title}`,
    observed: "Observed",
    notObservable: "Not observable",
    positions: "positions",
    valueCoverageUnknown: "value coverage unknown",
    ofValue: (share: string) => `${share} of value`,
    evidenceFor: (title: string) => `Evidence for ${title}`,
    sourceWord: "Source",
    observedWord: "observed",
    freshnessWord: "freshness",
    noDestination: "No destination yet",
    open: "Open",
    valuationState: {
      PRICED: "PRICED",
      ESTIMATED: "ESTIMATED",
      STALE: "STALE",
      UNPRICED: "UNPRICED",
      CONFLICTING: "CONFLICTING",
      PRIVATE_HIDDEN: "PRIVATE HIDDEN",
    },
    unknown: "Unknown",
    whyBucketUnknown: (bucket: string) => `Why ${bucket} is unknown`,
    emptyCategory: "Nothing in this evidence read measures this category.",
    limitsOn: (category: string) => `Limits on ${category}`,
    bookHead: (book: string) => `${book} book`,
    netAvailable: "Net available",
    netWithheld: "Net withheld",
    whyComponent: (book: string, component: string, state: string) => `Why ${book} ${component} is ${state}`,
    whyNetWithheld: (book: string) => `Why ${book} Net is withheld`,
    withheld: "Withheld",
    distributionEmpty: "No priced position supports a distribution at this observation.",
    distributionHead: "Distribution by underlying",
    sourcesEmpty: "No source is connected to this workspace yet.",
    whyDegraded: (label: string) => `Why ${label} is degraded`,
    records: "record(s)",
    manage: "Manage",
    bookPositions: (book: string) => `${book} positions`,
    noSource: "No source",
  },
  uk: {
    about: (title: string) => `Про розділ «${title}»`,
    observed: "Спостережено",
    notObservable: "Не спостережено",
    positions: "позицій",
    valueCoverageUnknown: "покриття вартості невідоме",
    ofValue: (share: string) => `${share} вартості`,
    evidenceFor: (title: string) => `Докази для «${title}»`,
    sourceWord: "Джерело",
    observedWord: "спостережено",
    freshnessWord: "свіжість",
    noDestination: "Переходу ще немає",
    open: "Відкрити",
    valuationState: {
      PRICED: "Оцінені",
      ESTIMATED: "Орієнтовні",
      STALE: "Застарілі",
      UNPRICED: "Без ціни",
      CONFLICTING: "Суперечливі",
      PRIVATE_HIDDEN: "Приховані приватні",
    },
    unknown: "Невідомо",
    whyBucketUnknown: (bucket: string) => `Чому ${bucket} невідомо`,
    emptyCategory: "Ніщо в цьому читанні доказів не вимірює цю категорію.",
    limitsOn: (category: string) => `Обмеження для ${category}`,
    bookHead: (book: string) => `Книга ${book}`,
    netAvailable: "Net доступний",
    netWithheld: "Net утримано",
    whyComponent: (book: string, component: string, state: string) =>
      `Чому ${component} у книзі ${book} має стан ${state}`,
    whyNetWithheld: (book: string) => `Чому Net у книзі ${book} утримано`,
    withheld: "Утримано",
    distributionEmpty: "Жодна оцінена позиція не підтримує розподіл на цьому спостереженні.",
    distributionHead: "Розподіл за базовим активом",
    sourcesEmpty: "Жодне джерело ще не підключено до цього простору.",
    whyDegraded: (label: string) => `Чому джерело «${label}» деградувало`,
    records: "запис(ів)",
    manage: "Керувати",
    bookPositions: (book: string) => `Позиції ${book}`,
    noSource: "Без джерела",
  },
} as const satisfies Record<WorkspaceLocale, TilesCopy>;

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  good: styles.chipGood,
  caution: styles.chipCaution,
  risk: styles.chipRisk,
  unknown: styles.chipUnknown,
  quiet: styles.chipQuiet,
};

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "good") return <CheckCircle size={13} weight="fill" aria-hidden />;
  if (tone === "caution") return <Warning size={13} weight="fill" aria-hidden />;
  if (tone === "risk") return <XCircle size={13} weight="fill" aria-hidden />;
  if (tone === "unknown") return <Question size={13} weight="bold" aria-hidden />;
  return null;
}

export function StateChip({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`${styles.chip} ${TONE_CLASS[tone]}`} data-tone={tone} data-state={label}>
      <ToneIcon tone={tone} />
      {label}
    </span>
  );
}

function statusTone(status: HomeRiskCategory["status"]): Tone {
  if (status === "WITHIN") return "good";
  if (status === "EXCEEDED") return "risk";
  if (status === "DEGRADED") return "caution";
  return "unknown";
}

function sourceTone(state: HomeSourceState["state"]): Tone {
  if (state === "OK") return "good";
  if (state === "STALE") return "caution";
  return "risk";
}

export function SurfaceStateChip({ state }: { state: HomePortfolioProjection["state"] }) {
  const tone: Tone = state === "CALM"
    ? "good"
    : state === "ERROR"
      ? "risk"
      : state === "DEGRADED" || state === "ATTENTION"
        ? "caution"
        : "unknown";
  return <StateChip tone={tone} label={state} />;
}

export function Section({
  id,
  title,
  icon,
  info,
  aside,
  locale = "en",
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  info: ReactNode;
  aside?: ReactNode;
  locale?: WorkspaceLocale;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}>
        <h2 id={`${id}-title`}>
          {icon}
          {title}
          <InfoControl align="start" label={COPY[locale].about(title)}>{info}</InfoControl>
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Observed Value, and everything that makes it interpretable, in one block.
 *
 * The amount is never rendered without its coverage, currency, observation time
 * and source state, because those four are what separate "you hold this" from
 * "we could price two of your five holdings at 10:01". When there is nothing
 * priced the figure is an em dash with a reason — never `$0`.
 */
export function ObservedValue({
  projection,
  locale = "en",
}: {
  projection: HomePortfolioProjection;
  locale?: WorkspaceLocale;
}) {
  const { observedValue, coverage } = projection;
  const c = COPY[locale];
  const observed = observedValue.state === "OBSERVED" && observedValue.value !== null;
  return (
    <div className={styles.value}>
      <p
        className={`${styles.valueAmount} ${observed ? "" : styles.valueUnavailable}`}
        data-observed={observed ? "true" : "false"}
      >
        {observed ? formatMoney(observedValue.value) : "—"}
      </p>
      <div className={styles.valueMeta}>
        <StateChip
          tone={observed ? "good" : "unknown"}
          label={observed ? c.observed : c.notObservable}
        />
        <span>
          {coverage.includedPositionCount}/{coverage.eligiblePositionCount} {c.positions} ·{" "}
          {coverage.marketValueCoverageBps === null
            ? c.valueCoverageUnknown
            : c.ofValue(formatBps(coverage.marketValueCoverageBps))}
        </span>
        <span>{observedValue.currency}</span>
        <time dateTime={observedValue.asOf}>{observedValue.asOf.replace("T", " ").replace(/\.\d+Z$/, "Z")}</time>
        <StateChip
          tone={observedValue.sourceState === "CURRENT" ? "good" : observedValue.sourceState === "UNKNOWN" ? "unknown" : "caution"}
          label={observedValue.sourceState}
        />
      </div>
      {observedValue.reason === null ? null : (
        <p className={styles.tileNote} data-reason>{observedValue.reason}</p>
      )}
    </div>
  );
}

const SEVERITY_CLASS: Readonly<Record<AttentionItem["severity"], string>> = {
  CRITICAL: styles.itemCritical,
  HIGH: styles.itemHigh,
  MEDIUM: styles.itemHigh,
  LOW: styles.itemLow,
};

function AttentionIcon({ severity }: { severity: AttentionItem["severity"] }) {
  if (severity === "CRITICAL") return <ShieldWarning size={18} weight="fill" aria-hidden />;
  if (severity === "LOW") return <ClockCounterClockwise size={18} weight="bold" aria-hidden />;
  return <WarningCircle size={18} weight="fill" aria-hidden />;
}

/**
 * The ranked list, exactly as the read model ordered it.
 *
 * The component does not sort, filter or cap. An item with no destination
 * renders its limitation instead of a link, because a button that goes nowhere
 * is worse than no button.
 */
export function AttentionList({
  items,
  calm,
  locale = "en",
}: {
  items: readonly AttentionItem[];
  calm: string;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  if (items.length === 0) {
    return (
      <p className={styles.calm} data-attention="calm">
        <CheckCircle size={16} weight="fill" aria-hidden />
        {calm}
      </p>
    );
  }
  return (
    <ul className={styles.attention}>
      {items.map((item) => (
        <li key={item.id} className={styles.item} data-kind={item.kind} data-severity={item.severity}>
          <span className={`${styles.itemIcon} ${SEVERITY_CLASS[item.severity]}`} aria-hidden>
            <AttentionIcon severity={item.severity} />
          </span>
          <span className={styles.itemBody}>
            <b>{item.title}</b>
            <span>
              {item.reason}
              <InfoControl align="start" label={c.evidenceFor(item.title)}>
                <p>{item.reason}</p>
                <p>
                  {c.sourceWord} <code>{item.sourceRef}</code> · {c.observedWord} {item.observedAt} · {c.freshnessWord} {item.freshness}
                </p>
                {item.limitation === null ? null : <p>{item.limitation}</p>}
              </InfoControl>
            </span>
          </span>
          {item.detailHref === null ? (
            <span className={styles.itemBlocked} data-no-destination>{c.noDestination}</span>
          ) : (
            <Link className={styles.itemAction} href={item.detailHref}>
              {item.actionLabel ?? c.open} <ArrowRight size={13} weight="bold" aria-hidden />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CoverageStates({
  projection,
  locale = "en",
}: {
  projection: HomePortfolioProjection;
  locale?: WorkspaceLocale;
}) {
  const { coverage, hidden } = projection;
  return (
    <>
      <div className={styles.grid}>
        {(["PRICED", "ESTIMATED", "STALE", "UNPRICED", "CONFLICTING", "PRIVATE_HIDDEN"] as const).map((state) => (
          <div key={state} className={styles.tile} data-valuation-state={state}>
            <span className={styles.tileHead}>
              {COPY[locale].valuationState[state]}
              {state === "PRIVATE_HIDDEN" ? <EyeSlash size={14} weight="bold" aria-hidden /> : null}
            </span>
            <p className={styles.tileValue}>{coverage.stateCounts[state]}</p>
          </div>
        ))}
      </div>
      <ul className={styles.note} data-hidden-count={hidden.count}>
        {projection.coverageLimit.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </>
  );
}

export function CashBuckets({
  buckets,
  locale = "en",
}: {
  buckets: readonly HomeCashBucket[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={styles.grid}>
      {buckets.map((bucket) => (
        <div key={bucket.id} className={styles.tile} data-bucket={bucket.id} data-state={bucket.state}>
          <span className={styles.tileHead}>
            {bucket.id.replace(/_/g, " ")}
            {bucket.state === "UNKNOWN" ? <Question size={14} weight="bold" aria-hidden /> : null}
          </span>
          <p className={`${styles.tileValue} ${bucket.state === "UNKNOWN" ? styles.tileUnknown : ""}`}>
            {bucket.state === "KNOWN" && bucket.value !== null ? formatMoney(bucket.value) : c.unknown}
          </p>
          {bucket.reasons.length === 0 ? null : (
            <InfoControl align="start" label={c.whyBucketUnknown(bucket.id)}>
              <ul>{bucket.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </InfoControl>
          )}
        </div>
      ))}
    </div>
  );
}

export function RiskCategories({
  categories,
  locale = "en",
}: {
  categories: readonly HomeRiskCategory[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={`${styles.grid} ${styles.gridWide}`}>
      {categories.map((category) => (
        <div key={category.id} className={styles.tile} data-category={category.id} data-status={category.status}>
          <span className={styles.tileHead}>
            {category.id}
            <StateChip tone={statusTone(category.status)} label={category.status} />
          </span>
          {category.metrics.length === 0 && category.constraints.length === 0 ? (
            <p className={styles.tileNote} data-empty-category>
              {c.emptyCategory}
            </p>
          ) : null}
          <ul className={styles.rows}>
            {category.metrics.slice(0, 4).map((metric) => (
              <li key={metric.id} className={styles.row}>
                <span className={styles.rowName}>{metric.id.replace(/_/g, " ")}</span>
                <span className={`${styles.rowValue} ${metric.state === "UNKNOWN" ? styles.tileUnknown : ""}`}>
                  {metric.state === "KNOWN" && metric.value !== null ? formatMoney(metric.value) : c.unknown}
                </span>
              </li>
            ))}
            {category.constraints.map((constraint) => (
              <li key={constraint.id} className={styles.row} data-constraint={constraint.id}>
                <span className={styles.rowName}>{constraint.metric.replace(/_/g, " ")}</span>
                <StateChip
                  tone={constraint.status === "WITHIN" ? "good" : constraint.status === "EXCEEDED" ? "risk" : "unknown"}
                  label={constraint.status}
                />
              </li>
            ))}
          </ul>
          {category.limitations.length === 0 ? null : (
            <InfoControl align="start" label={c.limitsOn(category.id)}>
              <ul>{category.limitations.map((line) => <li key={line}>{line}</li>)}</ul>
            </InfoControl>
          )}
        </div>
      ))}
    </div>
  );
}

function PnlBook({ projection, locale = "en" }: { projection: PnlProjection; locale?: WorkspaceLocale }) {
  const c = COPY[locale];
  return (
    <div className={styles.book} data-book={projection.book}>
      <span className={styles.bookHead}>
        {c.bookHead(projection.book)}
        <StateChip
          tone={projection.net.state === "AVAILABLE" ? "good" : "unknown"}
          label={projection.net.state === "AVAILABLE" ? c.netAvailable : c.netWithheld}
        />
      </span>
      <ul className={styles.rows}>
        {projection.components.map((component) => (
          <li key={component.component} className={styles.row} data-component={component.component} data-state={component.state}>
            <span className={styles.rowName}>
              {component.component}
              {component.reason === null ? null : (
                <InfoControl align="start" label={c.whyComponent(projection.book, component.component, component.state)}>
                  <p>{component.reason}</p>
                  {component.sourceRef === null ? null : <p>{c.sourceWord} <code>{component.sourceRef}</code></p>}
                </InfoControl>
              )}
            </span>
            <span className={`${styles.rowValue} ${component.state === "REPORTED" ? "" : styles.tileUnknown}`}>
              {component.state === "REPORTED" && component.value !== null
                ? formatMoney(component.value)
                : component.state}
            </span>
          </li>
        ))}
        <li className={styles.row} data-component="NET">
          <span className={styles.rowName}>
            NET
            {projection.net.state === "WITHHELD" ? (
              <InfoControl align="start" label={c.whyNetWithheld(projection.book)}>
                <ul>{projection.net.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </InfoControl>
            ) : null}
          </span>
          <span className={`${styles.rowValue} ${projection.net.state === "AVAILABLE" ? "" : styles.tileUnknown}`}>
            {projection.net.state === "AVAILABLE" ? formatMoney(projection.net.value) : c.withheld}
          </span>
        </li>
      </ul>
    </div>
  );
}

export function PnlBooks({
  projection,
  locale = "en",
}: {
  projection: HomePortfolioProjection;
  locale?: WorkspaceLocale;
}) {
  return (
    <div className={styles.books}>
      <PnlBook projection={projection.pnl.live} locale={locale} />
      <PnlBook projection={projection.pnl.paper} locale={locale} />
    </div>
  );
}

/**
 * A labelled snapshot, not a chart.
 *
 * There is no history series behind any current source, so nothing here draws
 * one. This is the distribution of priced positions at one instant, with the
 * count it could not include stated beside it.
 */
export function Distribution({
  projection,
  locale = "en",
}: {
  projection: HomePortfolioProjection;
  locale?: WorkspaceLocale;
}) {
  if (projection.distribution.length === 0) {
    return (
      <p className={styles.tileNote} data-distribution="empty">
        {COPY[locale].distributionEmpty}
      </p>
    );
  }
  return (
    <>
      <span className={styles.tileHead}>{COPY[locale].distributionHead}</span>
      <ul className={styles.spread}>
        {projection.distribution.map((slice) => (
          <li key={slice.key} className={styles.spreadRow} data-slice={slice.key}>
            <span className={styles.spreadKey}>{slice.key}</span>
            <span className={styles.spreadTrack}>
              <span className={styles.spreadFill} style={{ width: `${slice.shareBps / 100}%` }} />
            </span>
            <span className={styles.spreadShare}>{formatBps(slice.shareBps)}</span>
          </li>
        ))}
      </ul>
      {locale === "uk" ? (
        <p className={styles.tileNote}>
          Знімок оцінених позицій станом на {projection.asOf}. Поза знімком: {projection.distributionExcludedCount} позиції(й) —
          вони не мають придатної ціни.
        </p>
      ) : (
        <p className={styles.tileNote}>
          Snapshot of priced positions at {projection.asOf}. {projection.distributionExcludedCount} position(s)
          are outside it because they carry no usable price.
        </p>
      )}
    </>
  );
}

export function Sources({
  sources,
  locale = "en",
}: {
  sources: readonly HomeSourceState[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  if (sources.length === 0) {
    return <p className={styles.tileNote} data-sources="empty">{c.sourcesEmpty}</p>;
  }
  return (
    <ul className={styles.rows}>
      {sources.map((source) => (
        <li key={source.sourceId} className={styles.row} data-source={source.sourceId} data-state={source.state}>
          <span className={styles.rowName}>
            <Database size={15} weight="bold" aria-hidden />
            {source.label}
            {source.reason === null ? null : (
              <InfoControl align="start" label={c.whyDegraded(source.label)}>
                <p>{source.reason}</p>
              </InfoControl>
            )}
          </span>
          <span className={styles.rowValue}>
            {source.recordCount} {c.records}
            <StateChip tone={sourceTone(source.state)} label={source.state} />
            {source.state === "FAILED" ? null : (
              <StateChip tone={source.freshness === "CURRENT" ? "good" : "unknown"} label={source.freshness} />
            )}
            {source.detailHref === null ? null : (
              <Link className={styles.itemAction} href={source.detailHref}>
                {c.manage} <ArrowRight size={13} weight="bold" aria-hidden />
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Books({
  projection,
  locale = "en",
}: {
  projection: HomePortfolioProjection;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={styles.grid}>
      {[projection.books.live, projection.books.paper].map((book) => (
        <div key={book.book} className={styles.tile} data-book-count={book.book}>
          <span className={styles.tileHead}>{c.bookPositions(book.book)}</span>
          <p className={styles.tileValue}>{book.positionCount}</p>
          <p className={styles.tileNote}>
            {book.sourceIds.length === 0 ? c.noSource : book.sourceIds.join(", ")}
          </p>
        </div>
      ))}
    </div>
  );
}

export const SectionIcons = {
  value: <CurrencyDollar size={17} weight="bold" aria-hidden />,
  coverage: <ChartPieSlice size={17} weight="bold" aria-hidden />,
  attention: <WarningCircle size={17} weight="bold" aria-hidden />,
  pnl: <Scales size={17} weight="bold" aria-hidden />,
  cash: <Coins size={17} weight="bold" aria-hidden />,
  risk: <Gauge size={17} weight="bold" aria-hidden />,
  sources: <Database size={17} weight="bold" aria-hidden />,
} as const;
