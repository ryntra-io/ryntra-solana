/**
 * How much of Ryntra's Relay rate limit is actually being used.
 *
 * Admin/Observability shows Relay's 429 and rate-limit errors, so the team
 * notices when traffic approaches the limit.
 *
 * This reads **Relay's own accounting** — `GET /metrics/usage`, call counts for
 * the authenticated key grouped by endpoint, status code and minute — rather
 * than a counter of Ryntra's own. A self-kept counter would be wrong in the way
 * that matters: serverless instances do not share memory, so each would see a
 * fraction of the traffic and every one of them would report headroom that is
 * not there. The provider counts the whole key.
 *
 * ## The limits this is measured against
 *
 * Read from the Dashboard for the production key on 2026-09-10 — **`/quote` 50
 * per minute, `/price` 100, everything else 200** — which matches Relay's
 * documented self-serve defaults. They are stated here rather than fetched
 * because no endpoint returns them, and a headroom figure computed against a
 * guessed ceiling is worse than no figure.
 *
 * ## Why the peak, and not the average
 *
 * A rate limit is refused per minute, so an average over an hour hides exactly
 * the event that matters: one busy minute at the ceiling and fifty-nine quiet
 * ones average to nothing while somebody was being told no. `minutely` is asked
 * for and the **peak minute** is reported.
 */

import { RELAY_API_ORIGIN } from "./chains.ts";
import { relayHeaders, type RelayAuth } from "./http.ts";

export const RELAY_USAGE_PATH = "/metrics/usage";

/** Per-minute ceilings for this key, as the Dashboard states them. */
export const RELAY_RATE_LIMITS: Readonly<Record<string, number>> = {
  "/quote": 50,
  "/price": 100,
};
export const RELAY_RATE_LIMIT_DEFAULT = 200;

export function relayLimitFor(endpoint: string): number {
  for (const [path, limit] of Object.entries(RELAY_RATE_LIMITS)) {
    if (endpoint === path || endpoint.startsWith(`${path}/`)) return limit;
  }
  return RELAY_RATE_LIMIT_DEFAULT;
}

export type RelayUsageRow = Readonly<{
  endpoint: string;
  /** Every call in the window, whatever it answered. */
  calls: number;
  /** Calls Relay refused for rate limiting. The number this exists for. */
  rateLimited: number;
  /** The busiest single minute in the window. */
  peakPerMinute: number;
  limitPerMinute: number;
  /** What fraction of the ceiling the peak minute used, 0–1 and clamped. */
  peakLoad: number;
}>;

export type RelayUsageSummary = Readonly<{
  ok: true;
  rows: readonly RelayUsageRow[];
  totalCalls: number;
  totalRateLimited: number;
  /** The highest `peakLoad` across endpoints — the one number worth an alert. */
  worstLoad: number;
}>;

export type RelayUsageFailure = Readonly<{
  ok: false;
  reason: "UNCONFIGURED" | "UNAUTHORIZED" | "HTTP_ERROR" | "TRANSPORT" | "UNREADABLE";
  status: number | null;
  message: string;
}>;

type Metric = Readonly<{ endpoint?: unknown; statusCode?: unknown; count?: unknown; timestamp?: unknown }>;

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Fold Relay's rows into one line per endpoint.
 *
 * Exported and pure so the arithmetic can be tested without a network: the part
 * that can be quietly wrong is the peak, not the fetch.
 */
export function summariseRelayUsage(metrics: readonly Metric[]): RelayUsageSummary {
  const byEndpoint = new Map<string, { calls: number; rateLimited: number; perMinute: Map<string, number> }>();
  for (const metric of metrics) {
    const endpoint = typeof metric.endpoint === "string" && metric.endpoint.length > 0 ? metric.endpoint : "(unnamed)";
    const count = num(metric.count) ?? 0;
    if (count <= 0) continue;
    const status = num(metric.statusCode);
    const bucket = typeof metric.timestamp === "string" ? metric.timestamp : String(metric.timestamp ?? "");
    const row = byEndpoint.get(endpoint) ?? { calls: 0, rateLimited: 0, perMinute: new Map<string, number>() };
    row.calls += count;
    if (status === 429) row.rateLimited += count;
    /* Every status counts toward the minute: a refused call still spent the
       budget, which is the whole reason a minute goes over. */
    row.perMinute.set(bucket, (row.perMinute.get(bucket) ?? 0) + count);
    byEndpoint.set(endpoint, row);
  }

  const rows: RelayUsageRow[] = [...byEndpoint.entries()]
    .map(([endpoint, row]) => {
      const limitPerMinute = relayLimitFor(endpoint);
      const peakPerMinute = row.perMinute.size === 0 ? 0 : Math.max(...row.perMinute.values());
      return {
        endpoint,
        calls: row.calls,
        rateLimited: row.rateLimited,
        peakPerMinute,
        limitPerMinute,
        peakLoad: Math.min(1, limitPerMinute > 0 ? peakPerMinute / limitPerMinute : 0),
      };
    })
    /* Loudest first: an operator opening this wants the endpoint closest to its
       ceiling, not the one that happens to sort first alphabetically. */
    .sort((a, b) => b.peakLoad - a.peakLoad || b.calls - a.calls);

  return {
    ok: true,
    rows,
    totalCalls: rows.reduce((sum, row) => sum + row.calls, 0),
    totalRateLimited: rows.reduce((sum, row) => sum + row.rateLimited, 0),
    worstLoad: rows.reduce((worst, row) => Math.max(worst, row.peakLoad), 0),
  };
}

export type RelayUsageDependencies = RelayAuth &
  Readonly<{
    fetchImpl?: typeof fetch;
    origin?: string;
    timeoutMs?: number;
    granularity?: "minutely" | "hourly" | "daily";
  }>;

/**
 * Ask Relay what this key has been doing. `UNCONFIGURED` when there is no key —
 * a fact about the deployment, not a failure to report as one.
 */
export async function fetchRelayUsage(deps: RelayUsageDependencies = {}): Promise<RelayUsageSummary | RelayUsageFailure> {
  const apiKey = typeof deps.apiKey === "string" ? deps.apiKey.trim() : "";
  if (apiKey.length === 0) {
    return { ok: false, reason: "UNCONFIGURED", status: null, message: "No Relay API key is configured for this deployment." };
  }
  const url = new URL(RELAY_USAGE_PATH, deps.origin ?? RELAY_API_ORIGIN);
  url.searchParams.set("granularity", deps.granularity ?? "minutely");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 6_000);
  try {
    const response = await (deps.fetchImpl ?? fetch)(url.toString(), { method: "GET", headers: relayHeaders({ apiKey }), signal: controller.signal });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "UNAUTHORIZED", status: response.status, message: "Relay refused the configured key." };
    }
    if (!response.ok) return { ok: false, reason: "HTTP_ERROR", status: response.status, message: `Relay answered HTTP ${response.status}.` };
    const payload = (await response.json()) as { metrics?: unknown };
    if (!Array.isArray(payload.metrics)) {
      return { ok: false, reason: "UNREADABLE", status: response.status, message: "Relay's usage answer had no metrics array." };
    }
    return summariseRelayUsage(payload.metrics as readonly Metric[]);
  } catch (error) {
    /* The message is the transport's, never the key's — nothing in this module
       may put a credential into a string that reaches a surface or a log. */
    return { ok: false, reason: "TRANSPORT", status: null, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
