import { compareDecimal, parseDecimalText, rescale, type DecimalValue } from "../decimal.ts";
import type { PositionRecord } from "../position.ts";

export type AdapterErrorCode =
  | "SOURCE_IDENTITY_UNAVAILABLE"
  | "SOURCE_CONTRACT_INSUFFICIENT"
  | "UNSUPPORTED_SOURCE_STATE"
  | "INVALID_RECORD";

export type AdapterResult =
  | Readonly<{ ok: true; records: readonly PositionRecord[] }>
  | Readonly<{
      ok: false;
      code: AdapterErrorCode;
      reason: string;
      evidenceRefs: readonly string[];
    }>;

export function adapterSuccess(records: readonly PositionRecord[]): AdapterResult {
  return { ok: true, records };
}

export function adapterFailure(
  code: AdapterErrorCode,
  reason: string,
  evidenceRefs: readonly string[],
): AdapterResult {
  return { ok: false, code, reason, evidenceRefs: [...new Set(evidenceRefs)].sort() };
}

export function exactDecimalAtScale(value: string, scale: number): DecimalValue {
  const parsed = parseDecimalText(value);
  const scaled = rescale(parsed, scale, "TOWARD_ZERO");
  if (compareDecimal(parsed, scaled) !== 0) {
    throw new TypeError("source decimal exceeds declared precision");
  }
  return scaled;
}

export function safeAdapter(
  evidenceRefs: readonly string[],
  build: () => readonly PositionRecord[],
): AdapterResult {
  try {
    return adapterSuccess(build());
  } catch {
    return adapterFailure("INVALID_RECORD", "source record does not satisfy the canonical adapter contract", evidenceRefs);
  }
}
