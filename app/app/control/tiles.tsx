import Link from "next/link";
import {
  ArrowUpRight,
  Broadcast,
  Database,
  Gauge,
  ListChecks,
  ShieldCheck,
  Wallet,
} from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import {
  CONTROL_GROUPS,
  type ControlGroup,
  type ControlProjection,
  type ControlTile,
} from "@/lib/home/control/projection";
import styles from "@/app/app/home-surface.module.css";

/**
 * The control surface's display layer.
 *
 * Every tile renders three things and no fourth: a state, a value, and the
 * surface that owns the fact. The owner link is on the tile itself rather than
 * behind an info control, because it is what makes the tile a projection —
 * hiding it would leave a page of numbers with no way to check any of them,
 * which is exactly the second source of truth the projection rule refuses.
 *
 * **There is no control here that acts.** No pause, no resume, no revoke, no
 * authorize, no kill switch. Those live in Agent Control, where the
 * authorization record they write lives with them.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file: release checks regex this source for the exact English strings, so the
 * copy lives beside the components it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Tile labels, state labels, reasons and the
 * vocabulary's machine tokens arrive from `lib/home/control` — Agent Control's
 * own words — and render as received.
 */
type ControlTilesCopy = Readonly<{
  groupLabel: Readonly<Record<ControlGroup, string>>;
  actionClasses: string;
  authorizationModes: string;
  enforcementGrades: string;
  mandateStates: string;
}>;

const COPY = {
  en: {
    groupLabel: {
      AUTHORITY: "Authority model",
      COMMITMENTS: "Commitments",
      MONITORING: "Monitoring",
      SOURCES: "Sources",
      RISK: "Risk constraints",
      WAITING: "Waiting on you",
    },
    actionClasses: "Action classes",
    authorizationModes: "Authorization modes",
    enforcementGrades: "Enforcement grades",
    mandateStates: "Mandate states",
  },
  uk: {
    groupLabel: {
      AUTHORITY: "Модель повноважень",
      COMMITMENTS: "Зобовʼязання",
      MONITORING: "Нагляд",
      SOURCES: "Джерела",
      RISK: "Обмеження ризику",
      WAITING: "Чекає на вас",
    },
    actionClasses: "Класи дій",
    authorizationModes: "Режими авторизації",
    enforcementGrades: "Рівні забезпечення",
    mandateStates: "Стани мандата",
  },
} as const satisfies Record<WorkspaceLocale, ControlTilesCopy>;

export const GroupIcons: Readonly<Record<ControlGroup, React.ReactNode>> = {
  AUTHORITY: <ShieldCheck size={17} weight="bold" aria-hidden />,
  COMMITMENTS: <Wallet size={17} weight="bold" aria-hidden />,
  MONITORING: <Broadcast size={17} weight="bold" aria-hidden />,
  SOURCES: <Database size={17} weight="bold" aria-hidden />,
  RISK: <Gauge size={17} weight="bold" aria-hidden />,
  WAITING: <ListChecks size={17} weight="bold" aria-hidden />,
};

export function surfaceTone(state: ControlProjection["state"]): Tone {
  return state === "CALM" ? "good" : "caution";
}

export function tileTone(state: ControlTile["state"]): Tone {
  if (state === "OK") return "good";
  if (state === "ATTENTION") return "caution";
  if (state === "DEGRADED") return "risk";
  return "unknown";
}

export function groupsOf(projection: ControlProjection, locale: WorkspaceLocale = "en") {
  return CONTROL_GROUPS.map((group) => ({
    group,
    label: COPY[locale].groupLabel[group],
    tiles: projection.tiles.filter((tile) => tile.group === group),
  })).filter((entry) => entry.tiles.length > 0);
}

export function Tiles({ tiles }: { tiles: readonly ControlTile[] }) {
  return (
    <div className={styles.tiles}>
      {tiles.map((tile) => (
        <article key={tile.tileId} className={styles.tile} data-state={tile.state}>
          <header className={styles.tileHead}>
            <span>{tile.label}</span>
            <StateChip tone={tileTone(tile.state)} label={tile.stateLabel} />
          </header>
          {tile.value === null ? null : <p className={styles.tileValue}>{tile.value}</p>}
          {tile.reason === null ? null : <p className={styles.tileNote}>{tile.reason}</p>}
          <Link className={styles.tileOwner} href={tile.owner.href}>
            {tile.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
          </Link>
        </article>
      ))}
    </div>
  );
}

/** The Agent Control vocabulary, listed so the reader can see it is one list. */
export function Vocabulary({
  vocabulary,
  locale = "en",
}: {
  vocabulary: Readonly<{
    actionClasses: readonly string[];
    authorizationModes: readonly string[];
    enforcementGrades: readonly string[];
    mandateStates: readonly string[];
    owner: Readonly<{ surface: string; href: string }>;
  }>;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  const rows: readonly (readonly [string, readonly string[]])[] = [
    [c.actionClasses, vocabulary.actionClasses],
    [c.authorizationModes, vocabulary.authorizationModes],
    [c.enforcementGrades, vocabulary.enforcementGrades],
    [c.mandateStates, vocabulary.mandateStates],
  ];
  return (
    <>
      <ul className={styles.rows}>
        {rows.map(([label, values]) => (
          <li key={label} className={`${styles.row} ${styles.stackedRow}`}>
            {/* A div, not a span: it holds a list, and a span may not. */}
            <div className={styles.rowBody}>
              <span className={styles.rowName}>{label}</span>
              <ul className={styles.vocab}>
                {values.map((value) => <li key={value} className={styles.vocabItem}>{value}</li>)}
              </ul>
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Link className={styles.link} href={vocabulary.owner.href}>
          {vocabulary.owner.surface} <ArrowUpRight size={13} weight="bold" aria-hidden />
        </Link>
      </div>
    </>
  );
}
