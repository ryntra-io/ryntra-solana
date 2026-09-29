/**
 * Keep funnel telemetry descriptive even if an older RPC still emits canceled
 * validation thresholds. Invalid or missing payloads stay unavailable.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
export function toDescriptiveMetrics(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "thresholds"));
}
