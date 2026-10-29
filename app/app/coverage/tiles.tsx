import Link from "next/link";
import { ArrowUpRight, Coins, Database, Stack } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import {
  COVERAGE_GROUPS,
  type CoverageGroup,
  type CoverageProjection,
  type CoverageSource,
  type CoverageTile,
} from "@/lib/home/coverage/coverage";
import styles from "@/app/app/home-surface.module.css";

/**
 * The coverage display layer.
 *
 * Every number here reads *twelve of eighteen*, never *67%*. The percentage is
 * the more compact rendering and the one that hides the thing a reader needs:
 * two of three and twelve of eighteen are the same figure and not the same
 * situation. So the denominator is always on the screen, and the gap is always
 * named beneath it.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file. English is byte-identical to what shipped; `uk` is its twin. Tile
 * labels, values, reasons and owner surfaces arrive from `lib/home/coverage`
 * and are rendered as received — the counted-of-total truth lives there.
 */
type CoverageCopy = Readonly<{
  groupLabel: Readonly<Record<CoverageGroup, string>>;
  groupInfo: Readonly<Record<CoverageGroup, string>>;
  tileState: Readonly<Record<CoverageTile["state"], string>>;
  sourceState: Readonly<Record<CoverageSource["state"], string>>;
  entitlementWord: string;
}>;

const COPY = {
  en: {
    groupLabel: {
      SOURCES: "Sources",
      DATA: "Your data",
      AI_BUDGET: "Budgets",
    },
    groupInfo: {
      SOURCES: "Which declared sources answered on their last read. A source nobody has ever connected is never shown as broken — those need different actions.",
      DATA: "How much of your own holding reached the calculation, and the named reason for everything that did not. Never a percentage: the denominator is the point.",
      AI_BUDGET: "The ceilings your research mandate declares. Nothing records a spend against them yet, so they read Unrecorded rather than zero — no record is not the same as none spent.",
    },
    tileState: {
      COMPLETE: "Complete",
      PARTIAL: "Partial",
      NOTHING_IN_SCOPE: "Nothing in scope",
      WITHIN: "Within",
      EXHAUSTED: "Exhausted",
      UNRECORDED: "Unrecorded",
      NOT_DECLARED: "Not declared",
      DEGRADED: "Degraded",
    },
    sourceState: {
      OK: "Answered",
      STALE: "Stale",
      FAILED: "Refused",
      NEVER_OBSERVED: "Never observed",
    },
    entitlementWord: "entitlement",
  },
  uk: {
    groupLabel: {
      SOURCES: "Джерела",
      DATA: "Твої дані",
      AI_BUDGET: "Бюджети",
    },
    groupInfo: {
      SOURCES: "Які заявлені джерела відповіли під час останнього читання. Джерело, яке ніхто ніколи не підключав, не показується як зламане — там потрібні інші дії.",
      DATA: "Яка частина твоїх власних активів дійшла до розрахунку і названа причина для всього, що не дійшло. Ніколи не відсоток: знаменник — це і є суть.",
      AI_BUDGET: "Стелі, які заявляє твій дослідницький мандат. Ніщо ще не фіксує витрат проти них, тож вони читаються як «Не зафіксовано», а не як нуль — відсутність запису не те саме, що відсутність витрат.",
    },
    tileState: {
      COMPLETE: "Повно",
      PARTIAL: "Частково",
      NOTHING_IN_SCOPE: "Нічого в обсязі",
      WITHIN: "У межах",
      EXHAUSTED: "Вичерпано",
      UNRECORDED: "Не зафіксовано",
      NOT_DECLARED: "Не заявлено",
      DEGRADED: "Деградовано",
    },
    sourceState: {
      OK: "Відповіло",
      STALE: "Застаріле",
      FAILED: "Відмовило",
      NEVER_OBSERVED: "Ніколи не спостерігалося",
    },
    entitlementWord: "право",
  },
} as const satisfies Record<WorkspaceLocale, CoverageCopy>;

export const GROUP_LABEL: Readonly<Record<CoverageGroup, string>> = COPY.en.groupLabel;

export const GROUP_ICON: Readonly<Record<CoverageGroup, ReactNode>> = {
  SOURCES: <Database size={17} weight="bold" aria-hidden />,
  DATA: <Stack size={17} weight="bold" aria-hidden />,
  AI_BUDGET: <Coins size={17} weight="bold" aria-hidden />,
};

export const GROUP_INFO: Readonly<Record<CoverageGroup, string>> = COPY.en.groupInfo;

/** The group prose for one locale — the page passes the shared cookie's language. */
export function groupInfoOf(locale: WorkspaceLocale): Readonly<Record<CoverageGroup, string>> {
  return COPY[locale].groupInfo;
}

export function coverageTone(state: CoverageProjection["state"]): Tone {
  if (state === "CALM") return "good";
  if (state === "PARTIAL") return "caution";
  if (state === "DEGRADED") return "risk";
  return "unknown";
}

function tileTone(state: CoverageTile["state"]): Tone {
  if (state === "COMPLETE" || state === "WITHIN") return "good";
  if (state === "PARTIAL") return "caution";
  if (state === "EXHAUSTED" || state === "DEGRADED") return "risk";
  return "unknown";
}

export function groupsOf(projection: CoverageProjection, locale: WorkspaceLocale = "en") {
  return COVERAGE_GROUPS.map((group) => ({
    group,
    label: COPY[locale].groupLabel[group],
    tiles: projection.tiles.filter((tile) => tile.group === group),
  })).filter((entry) => entry.tiles.length > 0);
}

export function Tiles({ tiles, locale = "en" }: { tiles: readonly CoverageTile[]; locale?: WorkspaceLocale }) {
  return (
    <div className={styles.tiles}>
      {tiles.map((tile) => (
        <article key={tile.tileId} className={styles.tile} data-state={tile.state}>
          <header className={styles.tileHead}>
            <span>{tile.label}</span>
            <StateChip tone={tileTone(tile.state)} label={COPY[locale].tileState[tile.state]} />
          </header>
          <p className={styles.tileValue}>{tile.value}</p>
          <p className={styles.tileNote}>{tile.reason}</p>
          <Link className={styles.tileOwner} href={tile.owner.href}>
            {tile.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
          </Link>
        </article>
      ))}
    </div>
  );
}

function sourceTone(state: CoverageSource["state"]): Tone {
  if (state === "OK") return "good";
  if (state === "STALE") return "caution";
  if (state === "FAILED") return "risk";
  return "unknown";
}

export function Sources({ sources, locale = "en" }: { sources: readonly CoverageSource[]; locale?: WorkspaceLocale }) {
  const c = COPY[locale];
  return (
    <ul className={styles.rows}>
      {sources.map((source) => (
        <li key={source.sourceId} className={`${styles.row} ${styles.stackedRow}`} data-state={source.state}>
          <div className={styles.rowBody}>
            <span className={styles.rowName}>{source.label}</span>
            <span className={styles.rowMeta}>
              <StateChip tone={sourceTone(source.state)} label={c.sourceState[source.state]} />
              <span>{c.entitlementWord} <b>{source.entitlement}</b></span>
              {source.observedAt === null ? null : (
                <time dateTime={source.observedAt}>{source.observedAt.slice(0, 16).replace("T", " ")}</time>
              )}
            </span>
            {source.reason === null ? null : <span className={styles.rowReason}>{source.reason}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
