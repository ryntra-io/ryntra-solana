import { redactAgentControlLog } from "./redaction.ts";
import type { AgentPrincipal } from "./tenancy.ts";

/**
 * One structured record per Agent Control request, and the counters behind it.
 *
 * Two things were missing and are supplied here rather than described. A route
 * that refuses a caller left no trace an operator could read, so "the gate
 * fired" and "the gate was never reached" looked identical from outside. And
 * `redactAgentControlLog` had been built, tested and used by nothing: a
 * redaction pass that no log path calls is a function, not a control.
 *
 * **Redaction is not the last line of defence here, it is the first.** The pass
 * works by field name, which is exactly right for headers and query strings and
 * exactly useless for a credential somebody puts in a field called `debugNote`.
 * So the serialized bytes are scanned once more for the three credential shapes
 * this product mints, and a match throws instead of printing. A log line is
 * worth losing; a credential in a log aggregator is not.
 *
 * **The principal is a tenant id.** Never the key, never the secret, never the
 * token. The key id is included because "which of this tenant's four keys" is
 * the question an operator actually asks, and a key id is a public handle — the
 * secret it belongs to is not stored anywhere, let alone logged.
 *
 * The counters are deliberately minimal: requests, outcomes, status classes and
 * a duration total per route. Anything richer is a metrics product, and this
 * packet needs the four numbers that answer *is it up, is it refusing, what is
 * it refusing, and is it slow*.
 */

export const AGENT_CONTROL_LOG_KIND = "ryntra.agent-control.request" as const;

/**
 * Every credential shape this product mints. The observer refuses to emit a
 * line containing one, whatever field it arrived in.
 */
const CREDENTIAL_SHAPES = [/ryn_(?:ac|at|rt)_[0-9a-f]{24}_[A-Za-z0-9_-]{20,}/];

export class CredentialInLogError extends Error {
  constructor() {
    super("A record matched a Ryntra credential shape and was not emitted.");
    this.name = "CredentialInLogError";
  }
}

/** Caps that keep a hostile caller from growing the counter maps without bound. */
const MAX_TRACKED_ROUTES = 64;
const MAX_TRACKED_OUTCOMES = 24;

export type AgentControlLogInput = Readonly<{
  route: string;
  method: string;
  status: number;
  /** `OK`, or the exact refusal code the route answered with. */
  outcome: string;
  principal: AgentPrincipal | null;
  durationMs: number;
  requestUrl?: string;
  headers?: Readonly<Record<string, string>>;
  quota?: Readonly<{ limit: number; remaining: number }>;
  detail?: unknown;
}>;

type RouteCounters = {
  requests: number;
  durationMsTotal: number;
  byOutcome: Map<string, number>;
  byStatusClass: Map<string, number>;
};

export type AgentControlMetricsSnapshot = Readonly<{
  observedFromMs: number;
  truncated: boolean;
  totals: Readonly<{ requests: number; refused: number; durationMsTotal: number }>;
  routes: readonly Readonly<{
    route: string;
    requests: number;
    meanDurationMs: number;
    byOutcome: Readonly<Record<string, number>>;
    byStatusClass: Readonly<Record<string, number>>;
  }>[];
}>;

export type AgentControlObserver = Readonly<{
  record(input: AgentControlLogInput): void;
  snapshot(): AgentControlMetricsSnapshot;
}>;

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

/** Path and redacted query only. A fragment never reaches a server anyway. */
function safeUrl(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined;
  try {
    const url = new URL(requestUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function bump(map: Map<string, number>, key: string, cap: number): void {
  if (!map.has(key) && map.size >= cap) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function createAgentControlObserver(
  options: Readonly<{ sink?: (line: string) => void; nowMs?: () => number }> = {},
): AgentControlObserver {
  /*
   * One line per request on stdout, which is what the platform collects.
   *
   * Under `node --test` the runner sets `NODE_TEST_CONTEXT` in every test
   * child, and a few thousand request records interleaved with assertions makes
   * a failing suite unreadable. The default sink is therefore quiet there — and
   * only the *default* one: every test with an opinion about what gets emitted
   * passes its own sink and exercises the identical path.
   */
  const sink =
    options.sink
    ?? (process.env.NODE_TEST_CONTEXT
      ? () => {}
      : (line: string) => process.stdout.write(`${line}\n`));
  const now = options.nowMs ?? (() => Date.now());
  const observedFromMs = now();
  const routes = new Map<string, RouteCounters>();
  let totalRequests = 0;
  let totalRefused = 0;
  let totalDuration = 0;
  let truncated = false;

  return {
    record(input) {
      const entry = {
        kind: AGENT_CONTROL_LOG_KIND,
        at: new Date(now()).toISOString(),
        route: input.route,
        method: input.method,
        status: input.status,
        outcome: input.outcome,
        principal: input.principal ? input.principal.tenantId : "anonymous",
        keyId: input.principal ? input.principal.keyId : null,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        url: safeUrl(input.requestUrl),
        headers: input.headers,
        quota: input.quota,
        detail: input.detail,
      };

      const line = JSON.stringify(redactAgentControlLog(entry));
      for (const shape of CREDENTIAL_SHAPES) {
        if (shape.test(line)) throw new CredentialInLogError();
      }

      totalRequests += 1;
      totalDuration += entry.durationMs;
      if (input.outcome !== "OK") totalRefused += 1;

      let counters = routes.get(input.route);
      if (!counters) {
        if (routes.size >= MAX_TRACKED_ROUTES) {
          truncated = true;
        } else {
          counters = {
            requests: 0,
            durationMsTotal: 0,
            byOutcome: new Map(),
            byStatusClass: new Map(),
          };
          routes.set(input.route, counters);
        }
      }
      if (counters) {
        counters.requests += 1;
        counters.durationMsTotal += entry.durationMs;
        if (!counters.byOutcome.has(input.outcome) && counters.byOutcome.size >= MAX_TRACKED_OUTCOMES) {
          truncated = true;
        }
        bump(counters.byOutcome, input.outcome, MAX_TRACKED_OUTCOMES);
        bump(counters.byStatusClass, statusClass(input.status), 8);
      }

      sink(line);
    },

    snapshot() {
      return {
        observedFromMs,
        truncated,
        totals: {
          requests: totalRequests,
          refused: totalRefused,
          durationMsTotal: totalDuration,
        },
        routes: [...routes.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([route, counters]) => ({
            route,
            requests: counters.requests,
            meanDurationMs:
              counters.requests === 0 ? 0 : Math.round(counters.durationMsTotal / counters.requests),
            byOutcome: Object.fromEntries(counters.byOutcome),
            byStatusClass: Object.fromEntries(counters.byStatusClass),
          })),
      };
    },
  };
}

export function agentControlMetricsSnapshot(
  observer: AgentControlObserver,
): AgentControlMetricsSnapshot {
  return observer.snapshot();
}

/**
 * The warm-instance observer every route shares.
 *
 * A counter is per instance and says so: the snapshot carries `observedFromMs`,
 * so a reader can tell "zero requests" from "this instance is one second old".
 * Aggregating across instances is a provider concern, and inventing a total
 * here would be the fourth time this repository shipped a number nobody
 * measured.
 */
const globalObserver = globalThis as typeof globalThis & {
  __ryntraAgentControlObserver?: AgentControlObserver;
};

export function getAgentControlObserver(): AgentControlObserver {
  globalObserver.__ryntraAgentControlObserver ??= createAgentControlObserver();
  return globalObserver.__ryntraAgentControlObserver;
}
