import assert from "node:assert/strict";

import { createPositionRecord, parsePositionRecord } from "../position.ts";

/**
 * What every Portfolio adapter owes the core record: a successful result whose
 * records survive a parse and a rebuild unchanged, with no field of its source
 * leaking into them. Shared by Portfolio's own conformance test and by the
 * adapters that live with their source (`lib/guard/payout-portfolio.test.mjs`).
 */
export function expectConformant(result) {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  if (!result.ok) return [];
  for (const record of result.records) {
    assert.deepEqual(parsePositionRecord(record), record);
    assert.deepEqual(createPositionRecord(record), record);
  }
  const encoded = JSON.stringify(result.records);
  for (const field of [
    "marketDisplayName",
    "entry_price",
    "tokenProgram",
    "trustlineExists",
    "reservedMaxTotalDebitBaseUnits",
    "actionId",
  ]) {
    assert.equal(encoded.includes(`\"${field}\":`), false, `${field} leaked into the core record`);
  }
  return result.records;
}
