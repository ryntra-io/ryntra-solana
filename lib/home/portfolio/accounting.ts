import { compareCanonicalStrings } from "../../guard/canonical-json.ts";
import type { MergeIssue } from "./identity.ts";
import { observationKey } from "./identity.ts";
import type { PositionRecord } from "./position.ts";

export type AccountingIssue = Readonly<{
  code: "ACCOUNTING_CONFLICT" | "POTENTIAL_DUPLICATE";
  lotKey: string;
  positionIds: readonly string[];
}>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function sortRecords(records: readonly PositionRecord[]): PositionRecord[] {
  return [...records].sort((left, right) => compareCanonicalStrings(
    `${left.positionId}\u0000${observationKey(left)}`,
    `${right.positionId}\u0000${observationKey(right)}`,
  ));
}

function lotKey(record: PositionRecord): string {
  if (record.economicLot.state === "VERIFIED") return `VERIFIED:${record.economicLot.lotId}`;
  if (record.economicLot.state === "SOURCE_SCOPED") {
    return `SOURCE_SCOPED:${record.economicLot.sourceId}:${record.economicLot.lotKey}`;
  }
  return `UNKNOWN:${record.positionId}`;
}

export function validateAccounting(
  records: readonly PositionRecord[],
  mergeIssues: readonly MergeIssue[] = [],
): Readonly<{
  validRecords: readonly PositionRecord[];
  issues: readonly AccountingIssue[];
  uncertainPositionIds: readonly string[];
}> {
  const issues: AccountingIssue[] = mergeIssues
    .filter((item) => item.code === "POTENTIAL_DUPLICATE")
    .map((item) => ({
      code: "POTENTIAL_DUPLICATE",
      lotKey: item.activePositionKey,
      positionIds: uniqueSorted(item.positionIds),
    }));
  const invalid = new Set(issues.flatMap((item) => item.positionIds));
  const byLot = new Map<string, PositionRecord[]>();
  for (const record of sortRecords(records)) {
    if (invalid.has(record.positionId)) continue;
    const key = lotKey(record);
    byLot.set(key, [...(byLot.get(key) ?? []), record]);
  }

  for (const key of [...byLot.keys()].sort(compareCanonicalStrings)) {
    const lotRecords = byLot.get(key) ?? [];
    const primaries = lotRecords.filter((record) => record.book === "LIVE" && record.accountingRole === "PRIMARY");
    const reservations = lotRecords.filter((record) => record.book === "LIVE" && record.accountingRole === "RESERVATION");
    if (primaries.length <= 1 && reservations.length <= 1) continue;
    const affected = uniqueSorted([
      ...primaries.map((record) => record.positionId),
      ...reservations.map((record) => record.positionId),
    ]);
    affected.forEach((positionId) => invalid.add(positionId));
    issues.push({ code: "ACCOUNTING_CONFLICT", lotKey: key, positionIds: affected });
  }

  const orderedIssues = issues.sort((left, right) => compareCanonicalStrings(
    `${left.code}\u0000${left.lotKey}\u0000${left.positionIds.join("\u0000")}`,
    `${right.code}\u0000${right.lotKey}\u0000${right.positionIds.join("\u0000")}`,
  ));
  const uncertainPositionIds = uniqueSorted([...invalid]);
  return {
    validRecords: sortRecords(records.filter((record) => !invalid.has(record.positionId))),
    issues: orderedIssues,
    uncertainPositionIds,
  };
}
