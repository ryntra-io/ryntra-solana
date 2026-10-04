import { createHash } from "node:crypto";

import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";
import { ATTENTION_SEVERITIES, type AttentionSeverity } from "../portfolio/attention.ts";
import { parseExplicitInstant } from "../portfolio/freshness.ts";
import type {
  MandateBudgets,
  MandateScopeItem,
  MaterialityThreshold,
  QuietHours,
  ResearchMandate,
} from "./mandate.ts";

/**
 * MonitorRule — a mandate made executable, one scope item at a time.
 *
 * Compilation is total and deterministic: the same mandate always yields the
 * same rules in the same order with the same versions. That matters more than
 * it sounds. A rule id is what a change points at when it says *this is why you
 * are seeing me*, and an id that moved between two reads would break the one
 * link that makes a Radar auditable.
 *
 * **A rule that watches nothing is not compiled.** A scope item with no
 * applicable threshold produces no rule rather than an empty one, because an
 * empty rule renders as a monitor that is running and finding nothing — which
 * is the opposite of the truth that nothing is being measured.
 *
 * **Severity is the strongest trigger, never an average.** Averaging a HIGH and
 * a LOW into a MEDIUM is exactly the collapse that must never happen: it hides
 * the one thing that mattered behind the one that did not.
 *
 * **Notification and visibility are separate decisions.** Quiet hours, the
 * cooldown, the daily alert budget and a source's alerting right can each stop
 * a *notification*. None of them may hide a change from the surface. That is
 * why `notificationDecision()` returns `visible: true` in every branch — a
 * reader who opens Research at 3am sees everything that happened; what they are
 * spared is being woken up for it.
 */

export type MonitorTrigger = MaterialityThreshold;

export type MonitorRule = Readonly<{
  ruleId: string;
  version: string;
  mandateId: string;
  mandateVersion: string;
  ownerRef: string;
  scope: MandateScopeItem;
  triggers: readonly MonitorTrigger[];
  requiredSources: readonly string[];
  /** The subset of `requiredSources` whose rights permit raising an alert. */
  alertCapableSources: readonly string[];
  maxSourceAgeSeconds: number | null;
  mode: "SCHEDULE" | "EVENT";
  schedule: string | null;
  severity: AttentionSeverity;
  quietHours: QuietHours | null;
  cooldownSeconds: number;
  dedupeKey: string;
  maxAlerts: number | null;
  budgets: MandateBudgets;
  expiresAt: string | null;
  executionAuthority: "NONE";
}>;

function strongest(triggers: readonly MonitorTrigger[]): AttentionSeverity {
  let index = ATTENTION_SEVERITIES.length - 1;
  for (const trigger of triggers) {
    const position = ATTENTION_SEVERITIES.indexOf(trigger.severity);
    if (position >= 0 && position < index) index = position;
  }
  return ATTENTION_SEVERITIES[index];
}

function applies(threshold: MaterialityThreshold, scope: MandateScopeItem): boolean {
  return threshold.scopeKinds === null || threshold.scopeKinds.includes(scope.kind);
}

function ruleVersion(material: unknown): string {
  const digest = createHash("sha256")
    .update(`ryntra.home.research.rule.v1\n${canonicalJson(material)}`, "utf8")
    .digest("hex");
  return `v1-${digest.slice(0, 12)}`;
}

export function compileMonitorRules(mandate: ResearchMandate): readonly MonitorRule[] {
  const requiredSources = mandate.sources.map((source) => source.sourceId);
  const alertCapableSources = mandate.sources
    .filter((source) => source.rights.alerting)
    .map((source) => source.sourceId);

  const rules: MonitorRule[] = [];
  for (const scope of mandate.scope) {
    const triggers = mandate.materiality.filter((threshold) => applies(threshold, scope));
    if (triggers.length === 0) continue;

    const ruleId = `${mandate.mandateId}:${scope.kind}:${scope.ref}`;
    const material = {
      mandateVersion: mandate.version,
      scope,
      triggers,
      requiredSources,
      alertCapableSources,
      maxSourceAgeSeconds: mandate.freshness.maxAgeSeconds,
      mode: mandate.cadence.mode,
      schedule: mandate.cadence.cron,
      quietHours: mandate.cadence.quietHours,
      cooldownSeconds: mandate.cadence.cooldownSeconds,
      maxAlerts: mandate.budgets.maxAlertsPerDay,
      budgets: mandate.budgets,
      expiresAt: mandate.expiresAt,
    };

    rules.push({
      ruleId,
      version: ruleVersion(material),
      mandateId: mandate.mandateId,
      mandateVersion: mandate.version,
      ownerRef: mandate.ownerRef,
      scope,
      triggers,
      requiredSources,
      alertCapableSources,
      maxSourceAgeSeconds: mandate.freshness.maxAgeSeconds,
      mode: mandate.cadence.mode,
      schedule: mandate.cadence.cron,
      severity: strongest(triggers),
      quietHours: mandate.cadence.quietHours,
      cooldownSeconds: mandate.cadence.cooldownSeconds,
      dedupeKey: ruleId,
      maxAlerts: mandate.budgets.maxAlertsPerDay,
      budgets: mandate.budgets,
      expiresAt: mandate.expiresAt,
      executionAuthority: "NONE",
    });
  }

  return rules.sort((left, right) => compareCanonicalStrings(left.ruleId, right.ruleId));
}

/** Quiet hours are whole UTC hours and may wrap midnight. */
export function inQuietHours(quietHours: QuietHours | null, asOf: string): boolean {
  if (quietHours === null) return false;
  const parsed = parseExplicitInstant(asOf);
  if (parsed === null) return false;
  const hour = new Date(parsed).getUTCHours();
  const { fromHourUtc, toHourUtc } = quietHours;
  if (fromHourUtc === toHourUtc) return false;
  return fromHourUtc < toHourUtc
    ? hour >= fromHourUtc && hour < toHourUtc
    : hour >= fromHourUtc || hour < toHourUtc;
}

export type NotificationBlock =
  | "QUIET_HOURS"
  | "COOLDOWN"
  | "BUDGET_EXHAUSTED"
  | "NO_ALERTING_RIGHT"
  | "EXPIRED"
  | "UNKNOWN_CLOCK";

export type NotificationDecision = Readonly<{
  notify: boolean;
  reason: NotificationBlock | null;
  /** Always true. A suppressed notification is never a hidden change. */
  visible: true;
}>;

export function notificationDecision(input: Readonly<{
  rule: MonitorRule;
  asOf: string;
  alertsSentToday: number;
  lastAlertAt: string | null;
  /** The sources the change was actually built from. */
  alertingSources: readonly string[];
}>): NotificationDecision {
  const blocked = (reason: NotificationBlock): NotificationDecision => ({ notify: false, reason, visible: true });

  const now = parseExplicitInstant(input.asOf);
  if (now === null) return blocked("UNKNOWN_CLOCK");

  const expires = input.rule.expiresAt === null ? null : parseExplicitInstant(input.rule.expiresAt);
  if (expires !== null && now >= expires) return blocked("EXPIRED");

  const entitled = input.alertingSources.some((sourceId) => input.rule.alertCapableSources.includes(sourceId));
  if (!entitled) return blocked("NO_ALERTING_RIGHT");

  if (inQuietHours(input.rule.quietHours, input.asOf)) return blocked("QUIET_HOURS");

  if (input.rule.maxAlerts !== null && input.alertsSentToday >= input.rule.maxAlerts) {
    return blocked("BUDGET_EXHAUSTED");
  }

  if (input.lastAlertAt !== null) {
    const last = parseExplicitInstant(input.lastAlertAt);
    if (last === null) return blocked("UNKNOWN_CLOCK");
    if (now - last < input.rule.cooldownSeconds * 1000) return blocked("COOLDOWN");
  }

  return { notify: true, reason: null, visible: true };
}
