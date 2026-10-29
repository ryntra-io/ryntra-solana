import Link from "next/link";
import {
  ArrowUpRight,
  Broadcast,
  ChartPieSlice,
  CheckCircle,
  ListChecks,
  MagnifyingGlass,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { BriefSection, BriefSectionProjection, BriefWindow, DailyBrief } from "@/lib/home/brief/daily-brief";
import styles from "@/app/app/home-surface.module.css";

/**
 * The Daily Brief's display layer.
 *
 * One rule shapes every component here: **a line is a fact plus where to go**.
 * No line explains itself on the page — the section's own sentence is behind
 * its info control, and the line itself is a title, a state, a time and a link
 * to the surface that owns it.
 *
 * The empty sections are rendered, not skipped. A brief that drops its empty
 * sections looks shorter on a calm day and identical on a broken one, and the
 * reader loses the only signal that separates *nothing happened* from *nothing
 * was checked*.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

export const SECTION_ICON: Readonly<Record<BriefSection, ReactNode>> = {
  DECISIONS: <ListChecks size={17} weight="bold" aria-hidden />,
  CHANGES: <MagnifyingGlass size={17} weight="bold" aria-hidden />,
  PORTFOLIO: <ChartPieSlice size={17} weight="bold" aria-hidden />,
  MONITORING: <Broadcast size={17} weight="bold" aria-hidden />,
  QUIET: <CheckCircle size={17} weight="bold" aria-hidden />,
};

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file: release checks regex this source for the exact English strings, so the
 * copy lives beside the components it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Machine tokens (severities, brief states) and
 * lines arriving from `lib/` stay as received in both locales.
 */
type BriefTilesCopy = Readonly<{
  sectionInfo: Readonly<Record<BriefSection, string>>;
  windowSinceLastVisit: string;
  windowDefault: string;
  windowUnreadable: string;
  counts: Readonly<{
    waiting: string;
    changes: string;
    portfolio: string;
    monitoring: string;
    unchanged: string;
    decisions: string;
    research: string;
    portfolioDest: string;
    coverage: string;
  }>;
}>;

const COPY = {
  en: {
    sectionInfo: {
      DECISIONS: "Cases where the product has assembled the evidence and a person still has to decide. They come first because nothing else on this page can move without one of them.",
      CHANGES: "Facts your own monitor rules called material. Each one names the rule that raised it and links to the change itself.",
      PORTFOLIO: "Movements in your own positions, valuations and risk categories — only where they crossed a limit you declared.",
      MONITORING: "The machinery: a source that did not answer, a rule with nothing enrolled to run it. Last, because it never outranks a decision.",
      QUIET: "What was checked in this window and found unchanged. It is here so a short brief cannot be mistaken for a brief that failed to load.",
    },
    windowSinceLastVisit: "Since your last visit",
    windowDefault: "Last 24 hours",
    windowUnreadable: "Window not readable here",
    counts: {
      waiting: "Waiting on you",
      changes: "Material changes",
      portfolio: "Portfolio",
      monitoring: "Monitoring",
      unchanged: "Unchanged",
      decisions: "Decisions",
      research: "Research",
      portfolioDest: "Portfolio",
      coverage: "Coverage",
    },
  },
  uk: {
    sectionInfo: {
      DECISIONS: "Справи, де продукт уже зібрав докази, а рішення досі за людиною. Вони перші, бо без жодної з них ніщо інше на цій сторінці не зрушить.",
      CHANGES: "Факти, які твої власні правила моніторингу назвали суттєвими. Кожен називає правило, що його підняло, і веде до самої зміни.",
      PORTFOLIO: "Рухи у твоїх власних позиціях, оцінках і категоріях ризику — лише там, де вони перетнули задекларовану тобою межу.",
      MONITORING: "Машинерія: джерело, що не відповіло, правило, для якого ніщо не зареєстровано на запуск. Останній розділ, бо він ніколи не важливіший за рішення.",
      QUIET: "Що було перевірено в цьому вікні й лишилося без змін. Розділ тут, щоб короткий бриф не можна було сплутати з брифом, який не завантажився.",
    },
    windowSinceLastVisit: "Від твого останнього візиту",
    windowDefault: "Останні 24 години",
    windowUnreadable: "Вікно тут не зчитується",
    counts: {
      waiting: "Чекає на тебе",
      changes: "Суттєві зміни",
      portfolio: "Портфель",
      monitoring: "Нагляд",
      unchanged: "Без змін",
      decisions: "Рішення",
      research: "Дослідження",
      portfolioDest: "Портфель",
      coverage: "Покриття",
    },
  },
} as const satisfies Record<WorkspaceLocale, BriefTilesCopy>;

/** The per-section info sentences, for the page to place behind each info control. */
export function sectionInfo(locale: WorkspaceLocale): Readonly<Record<BriefSection, string>> {
  return COPY[locale].sectionInfo;
}

export function briefTone(state: DailyBrief["state"]): Tone {
  if (state === "ATTENTION") return "caution";
  if (state === "DEGRADED") return "risk";
  if (state === "CALM") return "good";
  return "unknown";
}

/**
 * Severity is a rank, not a verdict.
 *
 * `HIGH` mapped to the `risk` tone drew a red cross beside every waiting
 * decision — the mark this system uses for *failed*, on something that has not
 * failed and simply matters. And `MEDIUM` drew an amber warning triangle on a
 * routine price move, which is the defect the lifecycle bands were fixed for:
 * a stage is not trouble. Only `CRITICAL` keeps the stop mark; `HIGH` warns;
 * the two below it are quiet and carry no glyph at all.
 */
function severityTone(severity: string): Tone {
  if (severity === "CRITICAL") return "risk";
  if (severity === "HIGH") return "caution";
  return "quiet";
}

/** The window, stated as one short line rather than a paragraph. */
export function WindowChip({
  window: briefWindowValue,
  locale = "en",
}: {
  window: BriefWindow;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  const label = briefWindowValue.state === "SINCE_LAST_VISIT"
    ? c.windowSinceLastVisit
    : briefWindowValue.state === "DEFAULT_WINDOW"
      ? c.windowDefault
      : c.windowUnreadable;
  return <StateChip tone={briefWindowValue.state === "SINCE_LAST_VISIT" ? "good" : "unknown"} label={label} />;
}

export function BriefLines({ section }: { section: BriefSectionProjection }) {
  if (section.lines.length === 0) {
    return <p className={styles.empty}>{section.emptyReason}</p>;
  }
  return (
    <ul className={styles.rows}>
      {section.lines.map((line) => (
        <li key={line.lineId} className={`${styles.row} ${styles.stackedRow}`} data-severity={line.severity}>
          <div className={styles.rowBody}>
            <span className={styles.rowName}>{line.title}</span>
            <span className={styles.rowMeta}>
              {line.severity === "NONE" ? null : <StateChip tone={severityTone(line.severity)} label={line.severity} />}
              {line.observedAt === null ? null : <time dateTime={line.observedAt}>{line.observedAt.slice(0, 16).replace("T", " ")}</time>}
            </span>
            {line.detail === "" ? null : <span className={styles.rowReason}>{line.detail}</span>}
            <Link className={styles.tileOwner} href={line.owner.href}>
              {line.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The five counts, side by side, so the shape of the day is one glance. */
export function BriefCounts({ brief, locale = "en" }: { brief: DailyBrief; locale?: WorkspaceLocale }) {
  const c = COPY[locale].counts;
  /* Four fields per tile, and the fourth is the point: the link label names
     where it goes. Five tiles each linking to a different surface all read
     `Open`, which is five different destinations drawn as the same mark. */
  const entries: readonly (readonly [string, number, string, string])[] = [
    [c.waiting, brief.counts.decisions, "/app/action-cases", c.decisions],
    [c.changes, brief.counts.changes, "/app/research", c.research],
    [c.portfolio, brief.counts.portfolio, "/app/portfolio", c.portfolioDest],
    [c.monitoring, brief.counts.monitoring, "/app/coverage", c.coverage],
    [c.unchanged, brief.counts.quiet, "/app/coverage", c.coverage],
  ];
  return (
    <div className={styles.tiles}>
      {entries.map(([label, count, href, destination]) => (
        <article key={label} className={styles.tile} data-count={count}>
          <header className={styles.tileHead}>
            <span>{label}</span>
          </header>
          <p className={styles.tileValue}>{count}</p>
          <Link className={styles.tileOwner} href={href}>
            {destination} <ArrowUpRight size={12} weight="bold" aria-hidden />
          </Link>
        </article>
      ))}
    </div>
  );
}
