/**
 * The one effectful layer: three GETs, no key, no account, no write.
 *
 * **The refusal is a first-class result, not an error path.** Probed on
 * 2026-08-23, all three endpoints answered `403` from this environment with the
 * provider's own sentence about a sanctions-restricted jurisdiction, while
 * `docs.robinhood.com` and `rpc.mainnet.chain.robinhood.com` both answered
 * `200` in the same session — so the block is the venue deciding about this
 * one host, not a network fault and not the chain being unreachable.
 *
 * The founder's recorded decision of 2026-08-19 says what to do with that:
 * Ryntra implements no geographic restriction of its own, a venue answers for
 * itself, and Ryntra shows that answer **as it comes back** rather than
 * predicting, simulating or routing around it. So a `403` becomes a
 * `JURISDICTION_BLOCKED` source state carrying the provider's literal sentence,
 * every downstream surface renders that instead of a price, and nothing
 * anywhere suggests a VPN — both Robinhood and Arcus prohibit masking, and this
 * code has no proxy option to reach for.
 *
 * Where the adapter runs decides what it gets. Nothing here assumes either
 * answer; both are parsed, both are tested, and the deployment's own answer is
 * recorded as evidence rather than asserted in advance.
 */

import {
  RHJ_RATE_LIMIT_PER_SECOND,
  RHJ_SURFACES,
  type DataRightsState,
  type RhjSurfaceId,
} from "./identity.ts";
import {
  parseAssets,
  parseCorporateActions,
  parsePrices,
  type ParseResult,
  type RhjAsset,
  type RhjCorporateAction,
  type RhjQuote,
} from "./parse.ts";

export const RHJ_BASE_URL = "https://api.robinhood.com/rhj";

/** Documented on the provider's own page, and recorded so a caller can respect it. */
export const RHJ_RATE_LIMIT = RHJ_RATE_LIMIT_PER_SECOND;

const DEFAULT_TIMEOUT_MS = 8_000;

export type SourceOutcome = Readonly<{
  surfaceId: RhjSurfaceId;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  dataRightsState: DataRightsState;
  /** The provider's own words when it refused. Never paraphrased. */
  providerMessage: string | null;
  /** What this process can say about the failure, when the provider said nothing. */
  reason: string | null;
  receivedAt: string;
}>;

export type SourceRead<T> = Readonly<{
  outcome: SourceOutcome;
  rows: readonly T[];
  dropped: readonly string[];
}>;

export type Fetcher = (url: string, init: Readonly<{ signal: AbortSignal }>) => Promise<Response>;

export type ClientOptions = Readonly<{
  now: () => string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  baseUrl?: string;
  maxAgeSeconds?: number;
}>;

/**
 * Map a status onto what the provider actually permitted.
 *
 * `403` is the jurisdiction block; it is kept distinct from a generic failure
 * because a reader who is told "unavailable" will retry, and a reader who is
 * told the venue refused this jurisdiction will not.
 */
function rightsFor(status: number): DataRightsState {
  if (status === 200) return "PUBLIC_READ";
  if (status === 403 || status === 451) return "JURISDICTION_BLOCKED";
  if (status === 429) return "RATE_LIMITED";
  return "UNAVAILABLE";
}

/** Keep the provider's sentence, bounded, and never let a body become a surface. */
function trimMessage(body: string): string | null {
  const text = body.trim();
  if (text.length === 0) return null;
  return text.length > 400 ? text.slice(0, 400) + "…" : text;
}

async function readOne<T>(
  surfaceId: RhjSurfaceId,
  path: string,
  parse: (payload: unknown, context: { receivedAt: string; dataRightsState: DataRightsState; maxAgeSeconds: number }) => ParseResult<T>,
  options: ClientOptions,
): Promise<SourceRead<T>> {
  const base = options.baseUrl ?? RHJ_BASE_URL;
  const url = base + path;
  const receivedAt = options.now();
  const maxAgeSeconds = options.maxAgeSeconds ?? 120;
  const fetcher = options.fetcher ?? ((target, init) => fetch(target, { ...init, headers: { accept: "application/json" } }));

  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch (error) {
    return {
      outcome: {
        surfaceId,
        url,
        ok: false,
        httpStatus: null,
        dataRightsState: "UNAVAILABLE",
        providerMessage: null,
        reason: error instanceof Error ? error.message : "the request did not complete",
        receivedAt,
      },
      rows: [],
      dropped: [],
    };
  }

  const status = response.status;
  const dataRightsState = rightsFor(status);

  if (status !== 200) {
    let providerMessage: string | null = null;
    try {
      providerMessage = trimMessage(await response.text());
    } catch {
      providerMessage = null;
    }
    return {
      outcome: {
        surfaceId,
        url,
        ok: false,
        httpStatus: status,
        dataRightsState,
        providerMessage,
        /* When the provider says nothing, this process says what it saw — and
           never fills the gap with a guess about why. */
        reason: providerMessage === null ? "the provider returned HTTP " + status + " with no message" : null,
        receivedAt,
      },
      rows: [],
      dropped: [],
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      outcome: {
        surfaceId,
        url,
        ok: false,
        httpStatus: status,
        dataRightsState: "UNAVAILABLE",
        providerMessage: null,
        reason: "the response was not JSON",
        receivedAt,
      },
      rows: [],
      dropped: [],
    };
  }

  const parsed = parse(payload, { receivedAt, dataRightsState, maxAgeSeconds });
  return {
    outcome: {
      surfaceId,
      url,
      ok: true,
      httpStatus: status,
      dataRightsState,
      providerMessage: null,
      reason: null,
      receivedAt,
    },
    rows: parsed.rows,
    dropped: parsed.dropped,
  };
}

export function fetchRhjAssets(options: ClientOptions): Promise<SourceRead<RhjAsset>> {
  return readOne(RHJ_SURFACES.assets, "/assets", parseAssets, options);
}

/**
 * The provider asks for the per-symbol form: *"Please use /{symbol} whenever
 * applicable to prevent additional latency."* A symbol is path-encoded, because
 * it reaches this function from data rather than from a literal.
 */
export function fetchRhjPrices(symbol: string | null, options: ClientOptions): Promise<SourceRead<RhjQuote>> {
  const path = symbol === null ? "/prices" : "/prices/" + encodeURIComponent(symbol);
  return readOne(RHJ_SURFACES.prices, path, parsePrices, options);
}

export function fetchRhjCorporateActions(options: ClientOptions): Promise<SourceRead<RhjCorporateAction>> {
  return readOne(RHJ_SURFACES.corporateActions, "/corporate-actions", parseCorporateActions, options);
}

/** How a blocked or failed source reads on a surface. One sentence, the venue's own where it gave one. */
export function outcomeSentence(outcome: SourceOutcome): string {
  if (outcome.ok) return "Answered.";
  if (outcome.dataRightsState === "JURISDICTION_BLOCKED") {
    return outcome.providerMessage ?? "The provider refused this jurisdiction.";
  }
  if (outcome.dataRightsState === "RATE_LIMITED") {
    return outcome.providerMessage ?? "The provider rate-limited this read.";
  }
  return outcome.providerMessage ?? outcome.reason ?? "The source did not answer.";
}
