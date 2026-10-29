/**
 * Ryntra's market-data gateway, as the prediction pages read it from the server: which outcomes it records
 * (`/v1/instruments`, the `agg:<outcome id>` rows with their chart facts) and a page of an outcome's bars
 * (`/v1/history`, the core's contract as it is). The gateway has no address a browser on https may call yet, so the
 * market page reads it through Ryntra's own route.
 *
 * `MD_GATEWAY_URL` — the gateway's base address, set by the operator of the deployment; without it the gateway is
 * not read at all and the pages take the aggregator's bars. Nothing here is a secret: the gateway's reads are public.
 *
 * Server only.
 */
import type { HistoryLoad, HistoryPage } from "@ryntra/core/adapters";

import { isHistoryPage } from "./chart-feed.ts";

export type GatewayEnv = Readonly<{ baseUrl: string }> | null;

/** The gateway's base address from the environment; null without one, or with one that is no http(s) address. */
export function readGatewayEnv(env: NodeJS.ProcessEnv = process.env): GatewayEnv {
  const raw = env.MD_GATEWAY_URL?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { baseUrl: url.toString().replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

/** What the gateway says of an outcome it records. */
export type GatewayOutcome = Readonly<{
  /** The gateway's id: `agg:<outcome id>`. */
  instrument: string;
  /** The resolutions it serves now — seconds only while the market is active. */
  resolutions: readonly string[];
  defaultResolution: string;
  /** The words for its volume (printed shares); null where it gives none. */
  volume: Readonly<{ en: string; uk: string }> | null;
}>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** How long one read of the gateway may take before the page goes to the aggregator's bars instead. */
export const GATEWAY_TIMEOUT_MS = 4_000;
/** The gateway reads its market list at its start: once a minute is fresh enough. */
const INSTRUMENTS_TTL_MS = 60_000;
/** A list that could not be read is asked again after this, not on every page: a gateway that hangs costs one wait. */
const FAILED_TTL_MS = 30_000;

let instruments: { at: number; base: string; failed: boolean; rows: Promise<ReadonlyMap<string, GatewayOutcome> | null> } | null = null;

const instrumentOf = (outcomeId: string) => `agg:${outcomeId}`;

async function readJson(fetchImpl: Fetch, url: string): Promise<Readonly<{ status: number; body: unknown }> | null> {
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return null;
  }
}

function rowsOf(body: unknown): ReadonlyMap<string, GatewayOutcome> | null {
  const list = (body as { instruments?: unknown } | null)?.instruments;
  if (!Array.isArray(list)) return null;
  const rows = new Map<string, GatewayOutcome>();
  for (const row of list as { id?: unknown; chart?: { kind?: unknown; resolutions?: unknown; default_resolution?: unknown; volume?: unknown } }[]) {
    if (typeof row?.id !== "string" || !row.id.startsWith("agg:") || row.chart?.kind !== "prediction") continue;
    const resolutions = Array.isArray(row.chart.resolutions) ? row.chart.resolutions.filter((r): r is string => typeof r === "string") : [];
    const volume = row.chart.volume as { en?: unknown; uk?: unknown } | null | undefined;
    rows.set(row.id, {
      instrument: row.id,
      resolutions,
      defaultResolution: typeof row.chart.default_resolution === "string" ? row.chart.default_resolution : "1m",
      volume: volume && typeof volume.en === "string" && typeof volume.uk === "string" ? { en: volume.en, uk: volume.uk } : null,
    });
  }
  return rows;
}

/** The outcome as the gateway records it; null when it does not, or when it did not answer. */
export async function gatewayOutcome(env: GatewayEnv, outcomeId: string, fetchImpl: Fetch = fetch, now: number = Date.now()): Promise<GatewayOutcome | null> {
  if (!env) return null;
  if (!instruments || instruments.base !== env.baseUrl || now - instruments.at > (instruments.failed ? FAILED_TTL_MS : INSTRUMENTS_TTL_MS)) {
    const rows = readJson(fetchImpl, `${env.baseUrl}/v1/instruments`).then((r) => (r && r.status === 200 ? rowsOf(r.body) : null));
    const entry = { at: now, base: env.baseUrl, failed: false, rows };
    instruments = entry;
    void rows.then((value) => {
      entry.failed = value === null;
    });
  }
  return (await instruments.rows)?.get(instrumentOf(outcomeId)) ?? null;
}

/** The answer of a page: the gateway's page, «unknown» (it does not record this outcome), or null (no answer). */
export type GatewayPage = Readonly<{ kind: "page"; page: HistoryPage }> | Readonly<{ kind: "unknown" }> | null;

export async function gatewayHistory(
  env: GatewayEnv,
  outcomeId: string,
  request: Readonly<{ resolution: string; load: HistoryLoad; timestamp: number | null; limit: number }>,
  fetchImpl: Fetch = fetch,
): Promise<GatewayPage> {
  if (!env) return null;
  const q = new URLSearchParams({ instrument: instrumentOf(outcomeId), resolution: request.resolution, load: request.load, limit: String(request.limit) });
  if (request.timestamp != null) q.set("timestamp", String(request.timestamp));
  const answer = await readJson(fetchImpl, `${env.baseUrl}/v1/history?${q}`);
  if (!answer) return null;
  if (answer.status === 404) return { kind: "unknown" };
  if (answer.status !== 200 || !isHistoryPage(answer.body)) return null;
  return { kind: "page", page: answer.body };
}

/** For tests: forget the cached market list. */
export function forgetGatewayInstruments(): void {
  instruments = null;
}
