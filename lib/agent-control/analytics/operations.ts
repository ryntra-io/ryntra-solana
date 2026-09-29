/**
 * Statistics and operations analytics for Agent Control.
 *
 * The hard part of an analytics surface is not gathering numbers. It is
 * refusing to mix them.
 *
 * This module handles two kinds. A **measured** count comes from the warm
 * instance's own request counters — real events that happened, bounded to one
 * process, starting from the moment that process woke up. A **declared** count
 * is a catalogue size — how many adapters are registered, how many tools exist,
 * how many scopes a key can hold. Both are integers. Neither means anything
 * like the other, and a figure that adds them is authoritative-looking and
 * describes nothing.
 *
 * So the kinds are carried in the type, `sumCounts` throws when they are mixed,
 * and the surface reads them from two separately labelled groups. The rule is
 * cheap to state and was expensive to learn: `/agents/workspace/adoption`
 * already names "counters are per warm instance and no fleet total is computed"
 * as a blocker, and the way that blocker gets quietly violated is by somebody
 * needing one headline number.
 *
 * The module issues no verdict. There is no health word, no availability
 * figure, no uptime and no maturity: it reports what was counted and where the
 * counting stops. Whether that is good is a judgement, and a judgement computed
 * from four counters on one instance would be a guess wearing a badge.
 */

import { AGENT_CONTROL_REGISTRY } from "../registry.ts";
import { HOSTED_MCP_TOOLS, localMcpToolNames } from "../mcp/hosted.ts";
import { MCP_WRITE_TOOL_NAMES } from "../mcp/write-tools.ts";
import { AGENT_CONTROL_SCOPES } from "../tenancy.ts";
import { AGENT_QUOTA_POLICIES } from "../quota.ts";
import {
  type AgentControlMetricsSnapshot,
  type AgentControlObserver,
  agentControlMetricsSnapshot,
} from "../observability.ts";

export const COUNTING_BOUNDARIES = Object.freeze([
  /** Counted by this process since it woke. Lost on a cold start; never a fleet total. */
  "PER_WARM_INSTANCE",
  /** The size of a catalogue this build ships. Nothing happened to produce it. */
  "DECLARED_CATALOGUE",
] as const);

export type CountingBoundary = (typeof COUNTING_BOUNDARIES)[number];

export type CountKind = "MEASURED" | "DECLARED";

export type Count = Readonly<{
  kind: CountKind;
  boundary: CountingBoundary;
  value: number;
  /** What this counts, in words, so a figure never travels without its meaning. */
  what: string;
  /** Where the number came from — a module, or the counter that produced it. */
  source: string;
}>;

export class MixedCountKindsError extends Error {
  constructor(kinds: readonly CountKind[]) {
    super(
      `Refusing to total counts of different kinds: ${[...new Set(kinds)].join(" + ")}. `
        + "A measured count and a catalogue size are not the same quantity.",
    );
    this.name = "MixedCountKindsError";
  }
}

/**
 * Add counts that are actually addable.
 *
 * This exists to be *called* rather than to be admired: any future surface that
 * wants a headline figure has one obvious way to build it, and that way refuses
 * the wrong sum at the point of use instead of after it is published.
 */
export function sumCounts(counts: readonly Count[]): Count {
  if (counts.length === 0) throw new MixedCountKindsError([]);
  const kinds = counts.map((count) => count.kind);
  if (new Set(kinds).size > 1) throw new MixedCountKindsError(kinds);
  const boundaries = counts.map((count) => count.boundary);
  if (new Set(boundaries).size > 1) throw new MixedCountKindsError(kinds);
  return Object.freeze({
    kind: counts[0].kind,
    boundary: counts[0].boundary,
    value: counts.reduce((total, count) => total + count.value, 0),
    what: counts.map((count) => count.what).join(" + "),
    source: counts[0].source,
  });
}

function measured(value: number, what: string, source: string): Count {
  return Object.freeze({ kind: "MEASURED" as const, boundary: "PER_WARM_INSTANCE" as const, value, what, source });
}

function declared(value: number, what: string, source: string): Count {
  return Object.freeze({ kind: "DECLARED" as const, boundary: "DECLARED_CATALOGUE" as const, value, what, source });
}

export type RouteRow = Readonly<{
  route: string;
  requests: Count;
  refused: Count;
  meanDurationMs: number;
  byStatusClass: Readonly<Record<string, number>>;
}>;

export type RefusalRow = Readonly<{ code: string; count: Count }>;

export type MeasuredGroup = Readonly<{
  boundary: "PER_WARM_INSTANCE";
  caveat: string;
  observedFromMs: number;
  truncated: boolean;
  hasTraffic: boolean;
  requests: Count;
  refused: Count;
  /** A percentage string, or `null` when nothing was observed. Never `0%` for silence. */
  refusalRate: string | null;
}>;

export type DeclaredGroup = Readonly<{
  boundary: "DECLARED_CATALOGUE";
  counts: Readonly<{
    adapters: Count;
    actions: Count;
    localTools: Count;
    hostedTools: Count;
    writeTools: Count;
    scopes: Count;
  }>;
  quotas: readonly Readonly<{ principal: string; limit: number; windowSeconds: number }>[];
}>;

export type OperationsAnalytics = Readonly<{
  asOf: string;
  measured: MeasuredGroup;
  declared: DeclaredGroup;
  refusals: readonly RefusalRow[];
  routes: readonly RouteRow[];
}>;

const CAVEAT_BASE =
  "Counted by this instance since it woke. A cold start restarts the count and two warm instances keep two "
  + "separate ones, so nothing here is a fleet total and none is computed.";

const CAVEAT_TRUNCATED =
  " The counter maps hit their cap and this snapshot is truncated: some routes or outcomes were dropped rather "
  + "than growing without bound.";

function refusalRate(requests: number, refused: number): string | null {
  /* Zero over zero is not zero percent. An instance that has answered nothing
     has no rate, and printing `0%` would read as "nothing is being refused",
     which is a claim about traffic that never arrived. */
  if (requests === 0) return null;
  return `${Math.round((refused / requests) * 100)}%`;
}

/** Requests on this route whose outcome was anything other than `OK`. */
function refusedOn(row: AgentControlMetricsSnapshot["routes"][number]): number {
  return Object.entries(row.byOutcome).reduce(
    (total, [outcome, count]) => (outcome === "OK" ? total : total + count),
    0,
  );
}

export function operationsAnalytics(input: {
  observer: AgentControlObserver;
  asOf: string;
}): OperationsAnalytics {
  const snapshot = agentControlMetricsSnapshot(input.observer);

  const byCode = new Map<string, number>();
  for (const row of snapshot.routes) {
    for (const [outcome, count] of Object.entries(row.byOutcome)) {
      if (outcome === "OK") continue;
      byCode.set(outcome, (byCode.get(outcome) ?? 0) + count);
    }
  }

  const refusals: readonly RefusalRow[] = Object.freeze(
    [...byCode.entries()]
      /* Frequency first, then the code itself. The second key is what keeps the
         list stable when two codes tie, so a reader is not shown a different
         order every render for the same facts. */
      .sort(([leftCode, leftCount], [rightCode, rightCount]) =>
        leftCount === rightCount ? leftCode.localeCompare(rightCode) : rightCount - leftCount,
      )
      .map(([code, count]) =>
        Object.freeze({
          code,
          count: measured(count, `requests refused with ${code}`, "lib/agent-control/observability.ts"),
        }),
      ),
  );

  const routes: readonly RouteRow[] = Object.freeze(
    snapshot.routes.map((row) =>
      Object.freeze({
        route: row.route,
        requests: measured(row.requests, `requests to ${row.route}`, "lib/agent-control/observability.ts"),
        refused: measured(refusedOn(row), `refusals on ${row.route}`, "lib/agent-control/observability.ts"),
        meanDurationMs: row.meanDurationMs,
        byStatusClass: row.byStatusClass,
      }),
    ),
  );

  const adapters = AGENT_CONTROL_REGISTRY.entries.filter((entry) => entry.kind === "ADAPTER").length;
  const actions = AGENT_CONTROL_REGISTRY.entries.filter((entry) => entry.kind === "ACTION_SCHEMA").length;

  return Object.freeze({
    asOf: input.asOf,
    measured: Object.freeze({
      boundary: "PER_WARM_INSTANCE" as const,
      caveat: snapshot.truncated ? CAVEAT_BASE + CAVEAT_TRUNCATED : CAVEAT_BASE,
      observedFromMs: snapshot.observedFromMs,
      truncated: snapshot.truncated,
      hasTraffic: snapshot.totals.requests > 0,
      requests: measured(
        snapshot.totals.requests,
        "requests answered by this instance",
        "lib/agent-control/observability.ts",
      ),
      refused: measured(
        snapshot.totals.refused,
        "requests answered with a refusal code",
        "lib/agent-control/observability.ts",
      ),
      refusalRate: refusalRate(snapshot.totals.requests, snapshot.totals.refused),
    }),
    declared: Object.freeze({
      boundary: "DECLARED_CATALOGUE" as const,
      counts: Object.freeze({
        adapters: declared(adapters, "registered adapters", "lib/agent-control/adapters/index.ts"),
        actions: declared(actions, "registered action schemas", "lib/agent-control/registry.ts"),
        localTools: declared(localMcpToolNames().length, "local MCP tools", "lib/agent-control/mcp/hosted.ts"),
        hostedTools: declared(
          HOSTED_MCP_TOOLS.length,
          "tools the hosted endpoint serves",
          "lib/agent-control/mcp/hosted.ts",
        ),
        writeTools: declared(
          MCP_WRITE_TOOL_NAMES.length,
          "write tools, all sharing one effect value",
          "lib/agent-control/mcp/write-tools.ts",
        ),
        scopes: declared(AGENT_CONTROL_SCOPES.length, "scopes a key can hold", "lib/agent-control/tenancy.ts"),
      }),
      quotas: Object.freeze(
        Object.entries(AGENT_QUOTA_POLICIES).map(([principal, policy]) =>
          Object.freeze({ principal, limit: policy.limit, windowSeconds: policy.windowSeconds }),
        ),
      ),
    }),
    refusals,
    routes,
  });
}
