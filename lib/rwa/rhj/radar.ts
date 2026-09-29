/**
 * How a Robinhood event becomes a row on the Radar that already exists.
 *
 * The temptation here was to build a second change engine. `lib/home/research/
 * change.ts` already decides what a change is, what a conflict is, what an
 * unknown is, how a dedupe key is formed and how a threshold is measured — with
 * a test file longer than itself. A parallel producer would be a second opinion
 * about the same question, and two surfaces disagreeing about one change is
 * exactly what that engine's own header says it exists to prevent.
 *
 * So nothing here detects anything. Each `RhjEvent` is expressed as the two
 * things the engine already consumes — an **observation** and the **baseline**
 * it is measured against — plus the materiality threshold that makes it
 * material. The engine does the rest, and the event's kind travels as the
 * `factKey`, so the row a reader sees names the condition that raised it.
 *
 * **A conflict is not translated, it is reproduced.** The engine raises
 * `EVIDENCE_CONFLICT` when two sources report different values for one fact, so
 * a `SOURCE_CONFLICT` event is emitted as exactly that: two observations, one
 * fact key, two source ids, two values, no reconciliation. It arrives at the
 * Conflicts view through the same path as every other conflict rather than
 * through a special case.
 */

import type { MaterialityThreshold, MandateScopeKind } from "../../home/research/mandate.ts";
import type { FactBaseline, FactObservation } from "../../home/research/change.ts";
import { RHJ_EVENT_CATALOGUE, eventDefinition, type RhjEvent } from "./events.ts";

/** The issuer speaks about its own instruments, so its scope kind is `ISSUER`. */
export const RHJ_SCOPE_KIND: MandateScopeKind = "ISSUER";

export const RHJ_SOURCE_ID = "rhj-direct";
export const RHJ_SOURCE_LABEL = "Robinhood Stock Token API";

export type RhjFacts = Readonly<{
  observations: readonly FactObservation[];
  baselines: readonly FactBaseline[];
}>;

/**
 * One threshold per event kind, all `STATE_CHANGE`.
 *
 * Even the two numeric kinds arrive already measured: the divergence engine
 * applied the multiplier and compared on one basis before deciding the gap was
 * material, and re-measuring the resulting strings against a basis-points
 * threshold here would be a second, weaker judgement of a question already
 * answered correctly. What reaches the Radar is *this changed*, with the
 * measured figure carried in the row's own text.
 */
export function rhjMateriality(): readonly MaterialityThreshold[] {
  return RHJ_EVENT_CATALOGUE.map(function (definition) {
    return {
      factKey: definition.kind,
      comparison: "STATE_CHANGE" as const,
      value: null,
      severity: definition.severity,
      scopeKinds: [RHJ_SCOPE_KIND],
    };
  });
}

/**
 * A stable, human-readable subject label. The engine sorts and groups by
 * `subjectRef`, so every event about one token has to agree on it.
 */
export function rhjSubjectRef(tokenSymbol: string): string {
  return "rhj:" + tokenSymbol;
}

export function rhjFacts(events: readonly RhjEvent[], asOf: string): RhjFacts {
  const observations: FactObservation[] = [];
  const baselines: FactBaseline[] = [];
  const seenBaseline = new Set<string>();

  for (const event of events) {
    const definition = eventDefinition(event.kind);
    const evidenceRefs = event.identities.map(function (identity) {
      return "evidence:" + identity.surfaceId + ":" + (identity.instrumentId ?? event.subjectLabel);
    });

    if (event.conflict.length > 0) {
      /* Two sources, one fact, both values carried. The engine recognises this
         shape as a conflict on its own; nothing here decides which is right. */
      for (const entry of event.conflict) {
        observations.push({
          factKey: event.kind,
          subjectRef: event.subjectRef,
          subjectLabel: event.subjectLabel,
          sourceId: entry.sourceId,
          observedAt: asOf,
          effectiveAt: null,
          value: entry.value,
          unit: null,
          evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : ["evidence:" + entry.sourceId],
          entitlement: "PROVIDER_PUBLIC",
        });
      }
      continue;
    }

    observations.push({
      factKey: event.kind,
      subjectRef: event.subjectRef,
      subjectLabel: event.subjectLabel,
      sourceId: RHJ_SOURCE_ID,
      observedAt: asOf,
      effectiveAt: null,
      /* `current` is null only where the source genuinely stated nothing; it
         reaches the engine as an unknown rather than as an empty string. */
      value: event.current,
      unit: null,
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : ["evidence:" + RHJ_SOURCE_ID],
      entitlement: "PROVIDER_PUBLIC",
    });

    /* One baseline per subject and fact. A second would be a second answer to
       "what was it before", and the engine is right to have only one. */
    const key = event.subjectRef + "|" + event.kind;
    if (event.previous !== null && !seenBaseline.has(key)) {
      seenBaseline.add(key);
      baselines.push({
        subjectRef: event.subjectRef,
        factKey: event.kind,
        value: event.previous,
        observedAt: null,
        /* Named so the row can say where "before" came from — the issuer's own
           declaration, not a reading this product remembered. */
        source: definition.label + " · stated by " + RHJ_SOURCE_LABEL,
      });
    }
  }

  return { observations: Object.freeze(observations), baselines: Object.freeze(baselines) };
}
