import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";
import { createPositionRecord, type PositionRecord } from "./position.ts";

export type MergeIssue = Readonly<{
  code: "IDENTITY_CONFLICT" | "POTENTIAL_DUPLICATE";
  activePositionKey: string;
  positionIds: readonly string[];
  observationKeys: readonly string[];
  fields: readonly string[];
}>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

export function observationKey(record: PositionRecord): string {
  return canonicalJson({
    sourceId: record.source.sourceId,
    sourcePositionKey: record.source.sourcePositionKey,
    sourceVersion: record.source.sourceVersion,
    observedAt: record.source.observedAt,
  });
}

export function activePositionKey(record: PositionRecord): string {
  return canonicalJson({
    ownerRef: record.ownerRef,
    accountRef: record.accountRef,
    networkRef: record.networkRef,
    instrumentKey: record.instrumentKey,
    representationKey: record.representationKey,
    positionType: record.positionType,
    positionSlotKey: record.positionSlotKey,
  });
}

function lineageKey(record: PositionRecord): string {
  return canonicalJson({
    sourceId: record.source.sourceId,
    sourcePositionKey: record.source.sourcePositionKey,
  });
}

function economicLotWithoutEvidence(record: PositionRecord): unknown {
  if (record.economicLot.state === "VERIFIED") {
    return { state: record.economicLot.state, lotId: record.economicLot.lotId };
  }
  if (record.economicLot.state === "SOURCE_SCOPED") {
    return {
      state: record.economicLot.state,
      sourceId: record.economicLot.sourceId,
      lotKey: record.economicLot.lotKey,
    };
  }
  return { state: record.economicLot.state, reason: record.economicLot.reason };
}

function semanticValue(record: PositionRecord): string {
  const { positionId: _positionId, source: _source, economicLot: _economicLot, ...rest } = record;
  return canonicalJson({ ...rest, economicLot: economicLotWithoutEvidence(record) });
}

function sortRecords(records: readonly PositionRecord[]): PositionRecord[] {
  return [...records].sort((left, right) => compareCanonicalStrings(
    `${activePositionKey(left)}\u0000${observationKey(left)}\u0000${semanticValue(left)}`,
    `${activePositionKey(right)}\u0000${observationKey(right)}\u0000${semanticValue(right)}`,
  ));
}

function issue(
  code: MergeIssue["code"],
  key: string,
  records: readonly PositionRecord[],
  fields: readonly string[],
): MergeIssue {
  return {
    code,
    activePositionKey: key,
    positionIds: uniqueSorted(records.map((record) => record.positionId)),
    observationKeys: uniqueSorted(records.map(observationKey)),
    fields: uniqueSorted(fields),
  };
}

function newestInLineage(
  key: string,
  records: readonly PositionRecord[],
): { record: PositionRecord | null; issue: MergeIssue | null } {
  const newestTime = Math.max(...records.map((record) => Date.parse(record.source.observedAt)));
  const candidates = records.filter((record) => Date.parse(record.source.observedAt) === newestTime);
  const semantics = uniqueSorted(candidates.map(semanticValue));
  if (semantics.length > 1) {
    return { record: null, issue: issue("IDENTITY_CONFLICT", key, candidates, ["semanticValue"]) };
  }
  return { record: sortRecords(candidates)[0], issue: null };
}

function verifiedLotId(record: PositionRecord): string | null {
  return record.economicLot.state === "VERIFIED" ? record.economicLot.lotId : null;
}

function corroborated(records: readonly PositionRecord[]): PositionRecord {
  const chosen = sortRecords(records)[0];
  const { positionId: _positionId, ...draft } = chosen;
  const sourceEvidence = uniqueSorted(records.flatMap((record) => record.source.evidenceRefs));
  const lotEvidence = uniqueSorted(records.flatMap((record) => record.economicLot.evidenceRefs));
  return createPositionRecord({
    ...draft,
    source: { ...draft.source, evidenceRefs: sourceEvidence },
    economicLot: { ...draft.economicLot, evidenceRefs: lotEvidence },
  });
}

function contributes(record: PositionRecord): boolean {
  return record.accountingRole === "PRIMARY" || record.accountingRole === "RESERVATION";
}

export function mergePositionRecords(records: readonly PositionRecord[]): Readonly<{
  records: readonly PositionRecord[];
  issues: readonly MergeIssue[];
}> {
  const byActive = new Map<string, PositionRecord[]>();
  for (const record of sortRecords(records)) {
    const key = activePositionKey(record);
    byActive.set(key, [...(byActive.get(key) ?? []), record]);
  }

  const merged: PositionRecord[] = [];
  const issues: MergeIssue[] = [];
  for (const key of [...byActive.keys()].sort(compareCanonicalStrings)) {
    const activeRecords = byActive.get(key) ?? [];
    const byLineage = new Map<string, PositionRecord[]>();
    for (const record of activeRecords) {
      const lineage = lineageKey(record);
      byLineage.set(lineage, [...(byLineage.get(lineage) ?? []), record]);
    }

    const selected: PositionRecord[] = [];
    let lineageConflict = false;
    for (const lineage of [...byLineage.keys()].sort(compareCanonicalStrings)) {
      const newest = newestInLineage(key, byLineage.get(lineage) ?? []);
      if (newest.issue) {
        issues.push(newest.issue);
        lineageConflict = true;
      } else if (newest.record) {
        selected.push(newest.record);
      }
    }
    if (lineageConflict) continue;
    if (selected.length === 1) {
      merged.push(selected[0]);
      continue;
    }

    const lotIds = uniqueSorted(selected.map(verifiedLotId).filter((value): value is string => value !== null));
    const allVerified = selected.every((record) => verifiedLotId(record) !== null);
    const semantics = uniqueSorted(selected.map(semanticValue));
    if (allVerified && lotIds.length === 1 && semantics.length === 1) {
      merged.push(corroborated(selected));
      continue;
    }
    if (allVerified) {
      issues.push(issue("IDENTITY_CONFLICT", key, selected, [lotIds.length > 1 ? "economicLot" : "semanticValue"]));
      continue;
    }
    if (selected.filter(contributes).length > 1) {
      issues.push(issue("POTENTIAL_DUPLICATE", key, selected, ["economicLot"]));
    }
    merged.push(...sortRecords(selected));
  }

  return {
    records: sortRecords(merged),
    issues: [...issues].sort((left, right) => compareCanonicalStrings(
      `${left.code}\u0000${left.activePositionKey}\u0000${left.observationKeys.join("\u0000")}`,
      `${right.code}\u0000${right.activePositionKey}\u0000${right.observationKeys.join("\u0000")}`,
    )),
  };
}
