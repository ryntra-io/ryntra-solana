/* Provenance and freshness for one Binance observation (RYN-BIN-AOS-001, read-only discovery).

   Every value this packet records has to answer three questions before anything may be built on
   it: where did it come from, was the caller authenticated, and how old is it. The third one has
   a trap — the age that matters is the age of the VENUE's timestamp, not the age of our request.
   A book fetched a millisecond ago carrying a five-minute-old `lastUpdateId` is five minutes old.

   The transport field exists for a reason specific to this packet. The Binance MCP endpoint
   refuses `tools/list` without OAuth, so no market data here was obtained over MCP; it came from
   the public REST endpoints the server's own instructions say its tools wrap. Recording "MCP"
   over a REST read would be a fabricated integration claim, so `assertProvenanceHonest` makes
   that a thrown error rather than a matter of care. */

import type { DataState } from "../domain/capability.ts";
import { freshnessOf } from "../domain/capability.ts";

export const MCP_TRANSPORT = "mcp";
export const REST_TRANSPORT = "rest";

export type BinanceTransport = typeof MCP_TRANSPORT | typeof REST_TRANSPORT;

export type BinanceProvenance = {
  transport: BinanceTransport;
  /** The exact call: "GET https://api.binance.com/api/v3/depth?…" or "tools/call <name>". */
  endpoint: string;
  /** Whether the call carried an authorization. Public reads are false. */
  authenticated: boolean;
};

export type BinanceObservation<T> = {
  value: T;
  provenance: BinanceProvenance;
  /** Unix ms at which WE received the value. Null when it was never measured. */
  observedAt: number | null;
  /** Unix ms the VENUE stamped on the value itself, when it supplies one. */
  venueTimestamp: number | null;
};

export type ObserveInput<T> = {
  value: T;
  transport: BinanceTransport;
  endpoint: string;
  authenticated: boolean;
  observedAt: number | null;
  venueTimestamp: number | null;
};

export function observe<T>(input: ObserveInput<T>): BinanceObservation<T> {
  return {
    value: input.value,
    provenance: {
      transport: input.transport,
      endpoint: input.endpoint,
      authenticated: input.authenticated,
    },
    observedAt: input.observedAt,
    venueTimestamp: input.venueTimestamp,
  };
}

/**
 * Freshness of an observation. The venue's own timestamp wins when it exists; our receipt time
 * is the fallback; an observation with neither is `unknown` and — by the `dataTone` invariant —
 * can never render as safe.
 */
export function observationFreshness(
  observation: BinanceObservation<unknown>,
  nowMs: number,
  staleAfterMs: number,
): DataState {
  const basis = observation.venueTimestamp ?? observation.observedAt;
  return freshnessOf(basis, nowMs, staleAfterMs);
}

/** Short human label naming the transport first, because that is the part that gets misread. */
export function provenanceLabel(observation: BinanceObservation<unknown>): string {
  const transport = observation.provenance.transport === MCP_TRANSPORT ? "MCP" : "REST";
  const auth = observation.provenance.authenticated ? "authenticated" : "public";
  return `${transport} · ${auth} · ${observation.provenance.endpoint}`;
}

export type ProvenanceAudit = {
  /** How many MCP tool calls actually succeeded in the run that produced this observation. */
  mcpToolCallsPerformed: number;
};

/**
 * Refuses an observation that claims an MCP origin in a run where no MCP tool call succeeded.
 * This is the gate that stops "the agent read it from Binance's MCP server" from being written
 * about a value that came from a public REST endpoint.
 */
export function assertProvenanceHonest(
  observation: BinanceObservation<unknown>,
  audit: ProvenanceAudit,
): void {
  if (observation.provenance.transport === MCP_TRANSPORT && audit.mcpToolCallsPerformed === 0) {
    throw new Error(
      `Observation claims MCP provenance (${observation.provenance.endpoint}) but no MCP tool call was performed in this run.`,
    );
  }
}
