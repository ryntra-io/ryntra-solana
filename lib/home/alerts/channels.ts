import { parseExplicitInstant } from "../portfolio/freshness.ts";
import type { AttentionSeverity } from "../portfolio/attention.ts";
import type { MandateBudgets, QuietHours } from "../research/mandate.ts";
import type { NotificationBlock, NotificationDecision } from "../research/monitor-rule.ts";

/**
 * Alerts and channels — where a monitor rule's answer actually goes.
 *
 * Two separations carry this module, and both exist because merging them is
 * the natural thing to do and the thing that makes the surface lie.
 *
 * **Configured is not delivered.** A channel can be linked, correct, and have
 * never carried a single message. One green tick for both would tell a reader
 * their alerts work when nothing has ever proved it. So `configuration` and
 * `delivery` are separate fields with separate unions, and there is no combined
 * boolean anywhere on the object for a display layer to reach for.
 *
 * **A suppressed alert is not a missing alert.** Quiet hours, a cooldown, a
 * dedupe key and a daily budget all exist to reduce noise, and every one of
 * them can silently drop the message that mattered. The monitor-rule engine
 * already decides suppression and already marks it `visible: true`; this module
 * carries that decision to a surface with the rule that caused it attached, so
 * a reader can see *what* was held back and *which limit* held it.
 *
 * Nothing here enables, disables or tests a channel. Those are writes, and this
 * module adds none: `authority` is the constant `READ_ONLY` and an unconfigured
 * channel carries a `null` enable target rather than a control that would 404.
 *
 * Pure: no clock, no fetch, no randomness. `asOf` arrives from the caller.
 */

export const ALERT_CHANNELS = ["IN_APP", "TELEGRAM", "EMAIL", "WEBHOOK", "PUSH"] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const CHANNEL_CONFIGURATION_STATES = ["CONFIGURED", "NOT_CONFIGURED", "DEGRADED", "UNKNOWN"] as const;

export type ChannelConfigurationState = (typeof CHANNEL_CONFIGURATION_STATES)[number];

export const CHANNEL_DELIVERY_STATES = ["DELIVERED", "NO_DELIVERY_OBSERVED", "FAILED", "NOT_APPLICABLE"] as const;

export type ChannelDeliveryState = (typeof CHANNEL_DELIVERY_STATES)[number];

export type ChannelProjection = Readonly<{
  channel: AlertChannel;
  label: string;
  configuration: ChannelConfigurationState;
  delivery: ChannelDeliveryState;
  reason: string;
  /** What it would take to configure this channel. Never a control. */
  wouldTake: string;
  /** Always `null` here: enabling a channel is a write. */
  enableHref: null;
  lastDeliveredAt: string | null;
  lastFailureAt: string | null;
  owner: Readonly<{ surface: string; href: string }>;
}>;

export type AlertChannelsProjection = Readonly<{
  asOf: string;
  authority: "READ_ONLY";
  channels: readonly ChannelProjection[];
  state: "CALM" | "DEGRADED" | "UNKNOWN";
}>;

export type TelegramChannelReads = Readonly<{
  linked: boolean;
  chatRef: string | null;
  lastDeliveredAt: string | null;
  lastFailureAt: string | null;
}>;

const CHANNEL_LABEL: Readonly<Record<AlertChannel, string>> = {
  IN_APP: "In Home",
  TELEGRAM: "Telegram",
  EMAIL: "Email",
  WEBHOOK: "Webhook",
  PUSH: "Push",
};

const WOULD_TAKE: Readonly<Record<AlertChannel, string>> = {
  IN_APP: "Nothing. The surface is the channel; an alert appears here whether or not anything else is linked.",
  TELEGRAM: "Start the Ryntra bot from the navigation footer and confirm your account there.",
  EMAIL: "An address, a verified sender and a delivery provider. None of the three exists yet.",
  WEBHOOK: "An endpoint, a shared secret and a signed-payload contract. None of the three exists yet.",
  PUSH: "A registered device token and a push provider. Neither exists yet.",
};

const OWNER: Readonly<Record<AlertChannel, Readonly<{ surface: string; href: string }>>> = {
  IN_APP: { surface: "Home", href: "/app" },
  TELEGRAM: { surface: "Settings", href: "/app/settings" },
  EMAIL: { surface: "Settings", href: "/app/settings" },
  WEBHOOK: { surface: "Settings", href: "/app/settings" },
  PUSH: { surface: "Settings", href: "/app/settings" },
};

function telegramProjection(reads: TelegramChannelReads): ChannelProjection {
  const base = {
    channel: "TELEGRAM" as const,
    label: CHANNEL_LABEL.TELEGRAM,
    wouldTake: WOULD_TAKE.TELEGRAM,
    enableHref: null as null,
    lastDeliveredAt: reads.lastDeliveredAt,
    lastFailureAt: reads.lastFailureAt,
    owner: OWNER.TELEGRAM,
  };

  if (!reads.linked || reads.chatRef === null) {
    return {
      ...base,
      configuration: "NOT_CONFIGURED",
      delivery: "NOT_APPLICABLE",
      reason: "No Telegram chat is linked to this account.",
    };
  }
  if (reads.lastFailureAt !== null) {
    return {
      ...base,
      configuration: "DEGRADED",
      delivery: "FAILED",
      reason: "The chat is linked and the last delivery attempt failed.",
    };
  }
  if (reads.lastDeliveredAt === null) {
    return {
      ...base,
      configuration: "CONFIGURED",
      delivery: "NO_DELIVERY_OBSERVED",
      reason: "The chat is linked. Nothing has been delivered through it yet, so delivery is unproven.",
    };
  }
  return {
    ...base,
    configuration: "CONFIGURED",
    delivery: "DELIVERED",
    reason: "The chat is linked and a delivery has been observed.",
  };
}

export function projectAlertChannels(input: Readonly<{
  asOf: string;
  telegram: TelegramChannelReads;
  declaredChannels: readonly string[];
}>): AlertChannelsProjection {
  const channels: ChannelProjection[] = ALERT_CHANNELS.map((channel) => {
    if (channel === "TELEGRAM") return telegramProjection(input.telegram);
    if (channel === "IN_APP") {
      return {
        channel,
        label: CHANNEL_LABEL.IN_APP,
        configuration: "CONFIGURED",
        delivery: "DELIVERED",
        reason: "Home itself is the channel. Every alert is readable here regardless of what else is linked.",
        wouldTake: WOULD_TAKE.IN_APP,
        enableHref: null,
        lastDeliveredAt: null,
        lastFailureAt: null,
        owner: OWNER.IN_APP,
      };
    }
    return {
      channel,
      label: CHANNEL_LABEL[channel],
      configuration: "NOT_CONFIGURED",
      delivery: "NOT_APPLICABLE",
      reason: input.declaredChannels.includes(channel)
        ? "Declared in the mandate and not built. A declared channel with no transport delivers nothing."
        : "Not built. No transport exists for this channel.",
      wouldTake: WOULD_TAKE[channel],
      enableHref: null,
      lastDeliveredAt: null,
      lastFailureAt: null,
      owner: OWNER[channel],
    };
  });

  const degraded = channels.some((entry) => entry.configuration === "DEGRADED");
  const unknown = channels.some((entry) => entry.configuration === "UNKNOWN");

  return {
    asOf: input.asOf,
    authority: "READ_ONLY",
    channels,
    state: degraded ? "DEGRADED" : unknown ? "UNKNOWN" : "CALM",
  };
}

/* ------------------------------------------------------------------ alerts */

export type AlertRuleSummary = Readonly<{
  ruleId: string;
  ruleVersion: string;
  label: string;
  quietHours: QuietHours | null;
  cooldownSeconds: number;
  dedupeKey: string;
  maxAlerts: number | null;
  budgets: MandateBudgets;
  expiresAt: string | null;
}>;

export type AlertRuleProjection = AlertRuleSummary & Readonly<{
  quietHoursLabel: string;
  maxAlertsLabel: string;
  cooldownLabel: string;
}>;

export type AlertRecord = Readonly<{
  alertId: string;
  ruleId: string;
  title: string;
  observedAt: string | null;
  severity: AttentionSeverity;
  href: string;
  surface: string;
  decision: NotificationDecision;
  channel: AlertChannel;
}>;

export type AlertProjectionEntry = Readonly<{
  alertId: string;
  title: string;
  observedAt: string | null;
  severity: AttentionSeverity;
  channel: AlertChannel;
  delivered: boolean;
  suppressedBy: NotificationBlock | null;
  suppressionReason: string;
  rule: AlertRuleProjection;
  owner: Readonly<{ surface: string; href: string }>;
}>;

export type AlertsProjection = Readonly<{
  asOf: string;
  authority: "READ_ONLY";
  state: "EMPTY" | "CALM" | "ATTENTION";
  emptyReason: string;
  rules: readonly AlertRuleProjection[];
  alerts: readonly AlertProjectionEntry[];
  counts: Readonly<{ rules: number; alerts: number; delivered: number; suppressed: number }>;
}>;

/**
 * One sentence per suppression reason.
 *
 * The enum is the engine's vocabulary and it is exactly right there. On a
 * surface it is a word a reader has to decode, so each one is written out — and
 * a test asserts the sentence is not simply the enum spelled again.
 */
const SUPPRESSION_SENTENCE: Readonly<Record<NotificationBlock, string>> = {
  QUIET_HOURS: "Held back by your declared quiet hours. It is here because a quiet hour is not a deleted alert.",
  COOLDOWN: "Held back by the rule's cooldown — another alert on this rule arrived too recently.",
  BUDGET_EXHAUSTED: "Held back by the daily alert budget on this rule. The budget stopped the message, not the change.",
  NO_ALERTING_RIGHT: "Held back because no source behind this change carries the right to alert on it.",
  EXPIRED: "Held back because the rule that raised it had already expired.",
  UNKNOWN_CLOCK: "Held back because a time on the rule or the last alert could not be read, so no limit could be applied safely.",
};

function ruleProjection(rule: AlertRuleSummary): AlertRuleProjection {
  return {
    ...rule,
    quietHoursLabel: rule.quietHours === null
      ? "None declared"
      : String(rule.quietHours.fromHourUtc).padStart(2, "0") + ":00–"
        + String(rule.quietHours.toHourUtc).padStart(2, "0") + ":00 UTC",
    maxAlertsLabel: rule.maxAlerts === null ? "Unrecorded" : String(rule.maxAlerts) + " per day",
    cooldownLabel: rule.cooldownSeconds === 0
      ? "None"
      : rule.cooldownSeconds % 3600 === 0
        ? String(rule.cooldownSeconds / 3600) + "h"
        : String(Math.round(rule.cooldownSeconds / 60)) + "m",
  };
}

export function projectAlerts(input: Readonly<{
  asOf: string;
  rules: readonly AlertRuleSummary[];
  alerts: readonly AlertRecord[];
}>): AlertsProjection {
  const rules = [...input.rules]
    .sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0))
    .map(ruleProjection);
  const byId = new Map(rules.map((rule) => [rule.ruleId, rule]));

  const alerts = [...input.alerts]
    .sort((a, b) => {
      const at = a.observedAt === null ? -1 : (parseExplicitInstant(a.observedAt) ?? -1);
      const bt = b.observedAt === null ? -1 : (parseExplicitInstant(b.observedAt) ?? -1);
      if (at !== bt) return bt - at;
      return a.alertId < b.alertId ? -1 : a.alertId > b.alertId ? 1 : 0;
    })
    .map<AlertProjectionEntry>((alert) => {
      const rule = byId.get(alert.ruleId);
      if (!rule) {
        throw new TypeError(
          "Alert " + alert.alertId + " names rule " + alert.ruleId
          + ", which is not in this projection. An alert is never shown without the rule that governs it.",
        );
      }
      const suppressedBy = alert.decision.notify ? null : alert.decision.reason;
      return {
        alertId: alert.alertId,
        title: alert.title,
        observedAt: alert.observedAt,
        severity: alert.severity,
        channel: alert.channel,
        delivered: alert.decision.notify,
        suppressedBy,
        suppressionReason: suppressedBy === null
          ? "Delivered."
          : SUPPRESSION_SENTENCE[suppressedBy],
        rule,
        owner: { surface: alert.surface, href: alert.href },
      };
    });

  const suppressed = alerts.filter((entry) => !entry.delivered).length;

  return {
    asOf: input.asOf,
    authority: "READ_ONLY",
    state: rules.length === 0 && alerts.length === 0
      ? "EMPTY"
      : suppressed > 0
        ? "ATTENTION"
        : "CALM",
    emptyReason: "Alert rules are compiled from your research mandate. Declare a scope in Research and rules appear here.",
    rules,
    alerts,
    counts: {
      rules: rules.length,
      alerts: alerts.length,
      delivered: alerts.length - suppressed,
      suppressed,
    },
  };
}
