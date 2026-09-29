import type { ResearchProjection } from "@/lib/home/research/read-model";
import {
  projectAlertChannels,
  projectAlerts,
  type AlertChannelsProjection,
  type AlertRecord,
  type AlertRuleSummary,
  type AlertsProjection,
} from "@/lib/home/alerts/channels";
import { notificationDecision } from "@/lib/home/research/monitor-rule";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { HomeReads } from "@/app/app/home-reads";

/**
 * Where alerts come from — and they come from the rules the Radar already
 * compiled.
 *
 * The mapping is the point of this file being thin. Suppression is **not**
 * decided here: `notificationDecision` in wave 4 owns quiet hours, cooldown,
 * budget, alerting right and expiry, and this layer calls it with what a
 * material change actually observed. A second suppression rule written for a
 * display surface would be a second definition of when a person gets told
 * something, which is precisely the class of duplicate this product refuses.
 *
 * The counts fed to that decision are the honest ones available today: this
 * deployment records no per-rule alert log, so `alertsSentToday` is `0` and
 * `lastAlertAt` is `null` — the two inputs that could only be filled by a store
 * that does not exist. That means a budget or cooldown block shown here is
 * always a *rule* block, never a phantom one, and the surface says which limits
 * are declared rather than claiming a spend against them.
 */

/** What a delivery channel could be observed to have done. */
export type ChannelReads = Readonly<{
  telegramLinked: boolean;
  telegramChatRef: string | null;
  telegramLastDeliveredAt: string | null;
  telegramLastFailureAt: string | null;
}>;

/**
 * The one reader-facing literal this mapping layer authors — the owning
 * surface's name on an alert line — per locale, in this file. English is
 * byte-identical to what shipped; `uk` is its twin.
 */
const COPY = {
  en: { researchSurface: "Research" },
  uk: { researchSurface: "Дослідження" },
} as const satisfies Record<WorkspaceLocale, Readonly<{ researchSurface: string }>>;

function ruleSummaries(research: ResearchProjection | null): readonly AlertRuleSummary[] {
  if (research === null) return [];
  return research.rules.map<AlertRuleSummary>((rule) => ({
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    label: rule.label,
    quietHours: rule.quietHours,
    cooldownSeconds: rule.cooldownSeconds,
    dedupeKey: rule.ruleId,
    maxAlerts: rule.maxAlerts,
    budgets: research.mandate.budgets,
    expiresAt: research.mandate.expiresAt,
  }));
}

function alertRecords(research: ResearchProjection | null, asOf: string, locale: WorkspaceLocale): readonly AlertRecord[] {
  if (research === null) return [];
  const known = new Set(research.rules.map((rule) => rule.ruleId));

  return research.changes
    .filter((change) => change.state === "MATERIAL" && known.has(change.ruleId))
    .map<AlertRecord>((change) => {
      const rule = research.rules.find((entry) => entry.ruleId === change.ruleId)!;
      const decision = notificationDecision({
        /* Reconstituted from the Radar's own projection of the compiled rule.
           The scope item and owner are not carried on that projection and the
           suppression decision does not read them, so they are supplied as the
           projection's own identifiers rather than invented. */
        rule: {
          ruleId: rule.ruleId,
          version: rule.version,
          mandateId: research.mandate.mandateId,
          mandateVersion: research.mandate.version,
          ownerRef: change.subjectRef,
          scope: { kind: rule.scopeKind, ref: change.subjectRef, label: rule.label },
          mode: rule.mode,
          schedule: rule.schedule,
          severity: rule.severity,
          triggers: rule.triggers,
          quietHours: rule.quietHours,
          cooldownSeconds: rule.cooldownSeconds,
          dedupeKey: rule.ruleId,
          maxAlerts: rule.maxAlerts,
          budgets: research.mandate.budgets,
          maxSourceAgeSeconds: rule.maxSourceAgeSeconds,
          requiredSources: rule.requiredSources,
          alertCapableSources: rule.requiredSources,
          expiresAt: research.mandate.expiresAt,
          executionAuthority: "NONE",
        },
        asOf,
        alertsSentToday: 0,
        lastAlertAt: null,
        alertingSources: change.sources,
      });
      return {
        alertId: change.id,
        ruleId: change.ruleId,
        title: change.subjectLabel + " · " + change.factKey,
        observedAt: change.observedAt,
        severity: change.severity,
        href: "/app/research/" + change.id,
        surface: COPY[locale].researchSurface,
        decision,
        channel: "IN_APP",
      };
    });
}

export function projectAlertsSurface(input: Readonly<{
  reads: HomeReads;
  channels: ChannelReads;
  asOf: string;
  locale?: WorkspaceLocale;
}>): Readonly<{ alerts: AlertsProjection; channels: AlertChannelsProjection }> {
  const research = input.reads.research;
  return {
    alerts: projectAlerts({
      asOf: input.asOf,
      rules: ruleSummaries(research),
      alerts: alertRecords(research, input.asOf, input.locale ?? "en"),
    }),
    channels: projectAlertChannels({
      asOf: input.asOf,
      telegram: {
        linked: input.channels.telegramLinked,
        chatRef: input.channels.telegramChatRef,
        lastDeliveredAt: input.channels.telegramLastDeliveredAt,
        lastFailureAt: input.channels.telegramLastFailureAt,
      },
      declaredChannels: research?.mandate.notificationChannels ?? [],
    }),
  };
}
