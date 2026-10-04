import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type {
  AlertChannelsProjection,
  AlertProjectionEntry,
  AlertRuleProjection,
  ChannelProjection,
} from "@/lib/home/alerts/channels";
import styles from "@/app/app/home-surface.module.css";

/**
 * The alerts display layer.
 *
 * The one thing this file must never do is merge a channel's two states into a
 * single tick. Configuration and delivery are rendered as two chips side by
 * side, always both, because *linked* and *has ever delivered* are different
 * facts and a reader deciding whether to rely on Telegram needs the second one.
 *
 * A suppressed alert is rendered at the same weight as a delivered one, with
 * the limit that held it back on the line. It is not greyed out and not moved
 * to the bottom: the whole reason the row exists is that the reader would
 * otherwise never learn the message was written.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

function configurationTone(state: ChannelProjection["configuration"]): Tone {
  if (state === "CONFIGURED") return "good";
  if (state === "DEGRADED") return "risk";
  if (state === "NOT_CONFIGURED") return "quiet";
  return "unknown";
}

function deliveryTone(state: ChannelProjection["delivery"]): Tone {
  if (state === "DELIVERED") return "good";
  if (state === "FAILED") return "risk";
  if (state === "NO_DELIVERY_OBSERVED") return "caution";
  return "quiet";
}

/**
 * Every reader-facing literal this display layer owns, per locale, in this
 * file: release checks regex this source for the exact English strings, so the
 * copy lives beside the components it feeds. English is byte-identical to what
 * shipped; `uk` is its twin. Channel reasons, rule limit values and the empty
 * reason arrive from `lib/` and are rendered as received.
 */
type AlertsTilesCopy = Readonly<{
  configuration: Readonly<Record<ChannelProjection["configuration"], string>>;
  delivery: Readonly<Record<ChannelProjection["delivery"], string>>;
  /** The channel names a reader sees, keyed by the union's own vocabulary. */
  channelName: Readonly<Record<ChannelProjection["channel"], string>>;
  lastDelivery: string;
  quietHours: string;
  cooldown: string;
  cap: string;
  dedupe: string;
  delivered: string;
  heldBack: string;
  via: string;
  ruleWord: string;
}>;

const COPY = {
  en: {
    configuration: {
      CONFIGURED: "Configured",
      NOT_CONFIGURED: "Not configured",
      DEGRADED: "Degraded",
      UNKNOWN: "Unknown",
    },
    delivery: {
      DELIVERED: "Delivered",
      NO_DELIVERY_OBSERVED: "No delivery observed",
      FAILED: "Last attempt failed",
      NOT_APPLICABLE: "Nothing to deliver through",
    },
    channelName: {
      IN_APP: "Home",
      TELEGRAM: "Telegram",
      EMAIL: "Email",
      WEBHOOK: "Webhook",
      PUSH: "Push",
    },
    lastDelivery: "Last delivery",
    quietHours: "Quiet hours",
    cooldown: "Cooldown",
    cap: "Cap",
    dedupe: "Dedupe",
    delivered: "Delivered",
    heldBack: "Held back",
    via: "via",
    ruleWord: "rule",
  },
  uk: {
    configuration: {
      CONFIGURED: "Налаштовано",
      NOT_CONFIGURED: "Не налаштовано",
      DEGRADED: "Деградовано",
      UNKNOWN: "Невідомо",
    },
    delivery: {
      DELIVERED: "Доставлено",
      NO_DELIVERY_OBSERVED: "Доставки не спостережено",
      FAILED: "Остання спроба не вдалася",
      NOT_APPLICABLE: "Немає через що доставляти",
    },
    channelName: {
      IN_APP: "Home",
      TELEGRAM: "Telegram",
      EMAIL: "Ел. пошта",
      WEBHOOK: "Webhook",
      PUSH: "Push",
    },
    lastDelivery: "Остання доставка",
    quietHours: "Тихі години",
    cooldown: "Пауза",
    cap: "Ліміт",
    dedupe: "Дедуплікація",
    delivered: "Доставлено",
    heldBack: "Утримано",
    via: "через",
    ruleWord: "правило",
  },
} as const satisfies Record<WorkspaceLocale, AlertsTilesCopy>;

export function channelsTone(state: AlertChannelsProjection["state"]): Tone {
  return state === "CALM" ? "good" : state === "DEGRADED" ? "risk" : "unknown";
}

export function Channels({
  projection,
  locale = "en",
}: {
  projection: AlertChannelsProjection;
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <div className={styles.tiles}>
      {projection.channels.map((channel) => (
        <article key={channel.channel} className={styles.tile} data-channel={channel.channel} data-state={channel.configuration}>
          <header className={styles.tileHead}>
            <span>{channel.label}</span>
            <StateChip tone={configurationTone(channel.configuration)} label={c.configuration[channel.configuration]} />
          </header>
          {/* Two chips, never one — configured and delivered are different
              facts. Except when there is nothing to deliver through: an
              unconfigured channel rendered `Not configured` beside `Nothing to
              deliver through`, which is the same sentence twice. The field is
              still there and still separate; the tile stops repeating it. */}
          {channel.delivery === "NOT_APPLICABLE" ? null : (
            <p className={styles.tileValue}>
              <StateChip tone={deliveryTone(channel.delivery)} label={c.delivery[channel.delivery]} />
            </p>
          )}
          <p className={styles.tileNote}>{channel.reason}</p>
          {channel.lastDeliveredAt === null ? null : (
            <p className={styles.tileNote}>
              {c.lastDelivery} <time dateTime={channel.lastDeliveredAt}>{channel.lastDeliveredAt.slice(0, 16).replace("T", " ")}</time>
            </p>
          )}
          <Link className={styles.tileOwner} href={channel.owner.href}>
            {channel.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
          </Link>
        </article>
      ))}
    </div>
  );
}

export function Rules({
  rules,
  locale = "en",
}: {
  rules: readonly AlertRuleProjection[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <ul className={styles.rows}>
      {rules.map((rule) => (
        <li key={rule.ruleId} className={`${styles.row} ${styles.stackedRow}`}>
          <div className={styles.rowBody}>
            <span className={styles.rowName}>{rule.label}</span>
            {/* Four labelled values, separated. At the meta row's own 4px gap
                they ran together into one string nobody could parse — the same
                defect the action-class labels once had. */}
            <span className={`${styles.rowMeta} ${styles.rowMetaSeparated}`}>
              <span>{c.quietHours} <b>{rule.quietHoursLabel}</b></span>
              <span>{c.cooldown} <b>{rule.cooldownLabel}</b></span>
              <span>{c.cap} <b>{rule.maxAlertsLabel}</b></span>
              <span>{c.dedupe} <b>{rule.dedupeKey}</b></span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Alerts({
  alerts,
  locale = "en",
}: {
  alerts: readonly AlertProjectionEntry[];
  locale?: WorkspaceLocale;
}) {
  const c = COPY[locale];
  return (
    <ul className={styles.rows}>
      {alerts.map((alert) => (
        <li
          key={alert.alertId}
          className={`${styles.row} ${styles.stackedRow}`}
          data-delivered={alert.delivered ? "true" : "false"}
        >
          <div className={styles.rowBody}>
            <span className={styles.rowName}>{alert.title}</span>
            <span className={styles.rowMeta}>
              <StateChip
                tone={alert.delivered ? "good" : "caution"}
                label={alert.delivered ? c.delivered : c.heldBack}
              />
              {/* The channel's name, not its enum. `IN_APP` is the union's
                  vocabulary and a word a reader has to decode. */}
              <span>{c.via} <b>{c.channelName[alert.channel]}</b></span>
              <span>{c.ruleWord} <b>{alert.rule.label}</b></span>
              {alert.observedAt === null ? null : (
                <time dateTime={alert.observedAt}>{alert.observedAt.slice(0, 16).replace("T", " ")}</time>
              )}
            </span>
            <span className={styles.rowReason}>{alert.suppressionReason}</span>
            <Link className={styles.tileOwner} href={alert.owner.href}>
              {alert.owner.surface} <ArrowUpRight size={12} weight="bold" aria-hidden />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
