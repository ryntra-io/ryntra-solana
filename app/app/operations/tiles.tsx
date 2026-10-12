import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type {
  Incident,
  KillSwitch,
  OperationsProjection,
  ProviderHealth,
  RecoveryStatement,
} from "@/lib/home/operations/operations";
import type { RegulatoryCapabilityState, RegulatoryPerimeter } from "@/lib/home/regulatory/capability-state";
import styles from "@/app/app/home-surface.module.css";

/**
 * The operations display layer.
 *
 * Every state on this page is rendered as a chip plus one short reason, and the
 * long sentence lives behind the section's info control. That is the whole rule,
 * restated after four surfaces shipped as walls of text: a reader
 * has two seconds to see what is down, what it affects and where to go.
 *
 * **A kill switch is drawn as a state, never as a control.** There is no
 * button, no toggle and no confirm dialog anywhere in this file. The switch's
 * `authority` names who may actually throw it and the owner link goes there.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file: release checks regex this source for the exact English strings, so the
 * copy lives beside the components it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Provider labels, reasons, recovery details, the
 * perimeter's reasons and disclaimer arrive from the projections and render as
 * received.
 */
type OperationsTilesCopy = Readonly<{
  provider: Readonly<Record<ProviderHealth["state"], string>>;
  providerAnswering: string;
  incidentOpen: string;
  incidentRecovering: string;
  startWord: string;
  notRecorded: string;
  sinceWord: string;
  recovery: Readonly<Record<RecoveryStatement["behaviour"], string>>;
  observedWord: string;
  switchState: Readonly<Record<KillSwitch["state"], string>>;
  thrownByPrefix: string;
  thrownBySuffix: string;
  operation: Readonly<Record<RegulatoryCapabilityState["operation"], string>>;
  recorded: string;
  blocked: string;
  providerRole: string;
  instrumentClass: string;
}>;

const COPY = {
  en: {
    provider: {
      UP: "Up",
      DEGRADED: "Degraded",
      DOWN: "Down",
      UNKNOWN: "Never observed",
    },
    providerAnswering: "Answering on its last read.",
    incidentOpen: "Open",
    incidentRecovering: "Recovering",
    startWord: "start",
    notRecorded: "not recorded",
    sinceWord: "since",
    recovery: {
      REFUSED: "Refused",
      SERVED_STALE: "Served stale",
      UNAVAILABLE: "Unavailable",
      UNAFFECTED: "Unaffected",
    },
    observedWord: "observed",
    switchState: {
      ARMED: "Live",
      TRIPPED: "Off",
      UNKNOWN: "Not server-readable",
    },
    thrownByPrefix: "Thrown by ",
    thrownBySuffix: ", never from this page.",
    operation: {
      PERSONALIZED_ADVICE: "Personalized advice",
      ORDER_TRANSMISSION: "Order transmission",
      DISCRETIONARY_MANAGEMENT: "Discretionary management",
    },
    recorded: "Recorded",
    blocked: "Blocked",
    providerRole: "Provider role",
    instrumentClass: "instrument class",
  },
  uk: {
    provider: {
      UP: "Працює",
      DEGRADED: "Деградовано",
      DOWN: "Не працює",
      UNKNOWN: "Ніколи не спостерігалося",
    },
    providerAnswering: "Відповідає на останньому читанні.",
    incidentOpen: "Відкритий",
    incidentRecovering: "Відновлюється",
    startWord: "початок",
    notRecorded: "не зафіксовано",
    sinceWord: "від",
    recovery: {
      REFUSED: "Відмовлено",
      SERVED_STALE: "Подано застаріле",
      UNAVAILABLE: "Недоступно",
      UNAFFECTED: "Не зачеплено",
    },
    observedWord: "спостережено",
    switchState: {
      ARMED: "Активний",
      TRIPPED: "Вимкнено",
      UNKNOWN: "Сервер не може зчитати",
    },
    thrownByPrefix: "Право перемкнути має ",
    thrownBySuffix: ", ніколи — ця сторінка.",
    operation: {
      PERSONALIZED_ADVICE: "Персональні поради",
      ORDER_TRANSMISSION: "Передача ордерів",
      DISCRETIONARY_MANAGEMENT: "Дискреційне управління",
    },
    recorded: "Зафіксовано",
    blocked: "Заблоковано",
    providerRole: "Роль провайдера",
    instrumentClass: "клас інструмента",
  },
} as const satisfies Record<WorkspaceLocale, OperationsTilesCopy>;

function providerTone(state: ProviderHealth["state"]): Tone {
  if (state === "UP") return "good";
  if (state === "DEGRADED") return "caution";
  if (state === "DOWN") return "risk";
  return "unknown";
}

export function surfaceTone(state: OperationsProjection["state"]): Tone {
  if (state === "CALM") return "good";
  if (state === "DEGRADED") return "caution";
  if (state === "DOWN") return "risk";
  return "unknown";
}

export function Providers({
  providers,
  locale = "en",
}: {
  providers: readonly ProviderHealth[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={styles.tiles}>
      {providers.map((provider) => (
        <article key={provider.providerId} className={styles.tile} data-state={provider.state}>
          <header className={styles.tileHead}>
            <span>{provider.label}</span>
            <StateChip tone={providerTone(provider.state)} label={c.provider[provider.state]} />
          </header>
          <p className={styles.tileNote}>{provider.reason ?? c.providerAnswering}</p>
          <ul className={styles.vocab}>
            {provider.affects.map((capability) => <li key={capability} className={styles.vocabItem}>{capability}</li>)}
          </ul>
          <Link className={styles.tileOwner} href={provider.owner.href}>
            {provider.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
          </Link>
        </article>
      ))}
    </div>
  );
}

export function Incidents({
  incidents,
  locale = "en",
}: {
  incidents: readonly Incident[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <ul className={styles.rows}>
      {incidents.map((incident) => (
        <li key={incident.incidentId} className={`${styles.row} ${styles.stackedRow}`} data-state={incident.state}>
          <div className={styles.rowBody}>
            <span className={styles.rowName}>{incident.label}</span>
            <span className={styles.rowMeta}>
              <StateChip tone={incident.state === "OPEN" ? "risk" : "caution"} label={incident.state === "OPEN" ? c.incidentOpen : c.incidentRecovering} />
              {incident.firstObservedAt === null
                ? <span>{c.startWord} <b>{c.notRecorded}</b></span>
                : <span>{c.sinceWord} <time dateTime={incident.firstObservedAt}>{incident.firstObservedAt.slice(0, 16).replace("T", " ")}</time></span>}
            </span>
            <span className={styles.rowReason}>{incident.reason}</span>
            <Link className={styles.tileOwner} href={incident.owner.href}>
              {incident.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function recoveryTone(behaviour: RecoveryStatement["behaviour"]): Tone {
  if (behaviour === "UNAFFECTED") return "good";
  if (behaviour === "SERVED_STALE") return "caution";
  if (behaviour === "UNAVAILABLE") return "risk";
  return "unknown";
}

export function Recovery({
  recovery,
  locale = "en",
}: {
  recovery: readonly RecoveryStatement[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <ul className={styles.rows}>
      {recovery.map((entry) => (
        <li key={entry.providerId + "-" + entry.capability} className={`${styles.row} ${styles.stackedRow}`} data-behaviour={entry.behaviour}>
          <div className={styles.rowBody}>
            <span className={styles.rowName}>{entry.capability}</span>
            <span className={styles.rowMeta}>
              <StateChip tone={recoveryTone(entry.behaviour)} label={c.recovery[entry.behaviour]} />
              {/* The observation's age, as a time element rather than a machine
                  instant dropped into the middle of a sentence. */}
              {entry.behaviour !== "SERVED_STALE" || entry.observedAt === null ? null : (
                <span>{c.observedWord} <time dateTime={entry.observedAt}>{entry.observedAt.slice(0, 16).replace("T", " ")}</time></span>
              )}
            </span>
            <span className={styles.rowReason}>{entry.detail}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function KillSwitches({
  switches,
  locale = "en",
}: {
  switches: readonly KillSwitch[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={styles.tiles}>
      {switches.map((entry) => (
        <article key={entry.switchId} className={styles.tile} data-state={entry.state}>
          <header className={styles.tileHead}>
            <span>{entry.label}</span>
            <StateChip
              tone={entry.state === "TRIPPED" ? "quiet" : entry.state === "ARMED" ? "good" : "unknown"}
              label={c.switchState[entry.state]}
            />
          </header>
          <p className={styles.tileNote}>{entry.reason}</p>
          <p className={styles.tileNote}>{c.thrownByPrefix}<b>{entry.authority}</b>{c.thrownBySuffix}</p>
          <Link className={styles.tileOwner} href={entry.owner.href}>
            {entry.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
          </Link>
        </article>
      ))}
    </div>
  );
}

export function Perimeter({
  perimeter,
  locale = "en",
}: {
  perimeter: RegulatoryPerimeter;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <>
      <div className={styles.tiles}>
        {perimeter.operations.map((entry) => (
          <article key={entry.operation} className={styles.tile} data-state={entry.state}>
            <header className={styles.tileHead}>
              <span>{c.operation[entry.operation]}</span>
              <StateChip tone={entry.state === "ALLOWED" ? "good" : "quiet"} label={entry.state === "ALLOWED" ? c.recorded : c.blocked} />
            </header>
            <p className={styles.tileNote}>{entry.reason}</p>
            <p className={styles.tileNote}>
              {c.providerRole} <b>{entry.providerRole}</b> · {c.instrumentClass} <b>{entry.instrumentClass}</b>
            </p>
          </article>
        ))}
      </div>
      <p className={styles.note}>{perimeter.disclaimer}</p>
    </>
  );
}
