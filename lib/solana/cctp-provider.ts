import { solanaCctpLane, type SolanaCctpDirection } from "./cctp-registry.ts";

export const CCTP_IRIS_MAINNET_ORIGIN = "https://iris-api.circle.com" as const;
const MAX_CCTP_RESPONSE_BYTES = 256 * 1024;

export type CctpProviderHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
export type CctpProviderReason =
  | "UNREACHABLE_FROM_ENVIRONMENT"
  | "REFUSED"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE";

type EndpointUnavailable = Readonly<{
  state: "UNAVAILABLE";
  code: CctpProviderReason;
  status: number | null;
}>;

export type CctpAllowance = Readonly<{
  allowanceUsdc: string;
  allowanceRaw: string;
  lastUpdated: string;
}>;

export type CctpFeeTier = Readonly<{
  mode: "FAST" | "STANDARD";
  finalityThreshold: 1000 | 2000;
  minimumFeeBps: string;
}>;

type PublicKeysResult = Readonly<{
  state: "AVAILABLE";
  observedAt: string;
}> | EndpointUnavailable;

type AllowanceResult = Readonly<{
  state: "AVAILABLE";
  observedAt: string;
  allowance: CctpAllowance;
}> | EndpointUnavailable;

type FeesResult = Readonly<{
  state: "AVAILABLE";
  observedAt: string;
  tiers: readonly CctpFeeTier[];
}> | EndpointUnavailable;

export type CctpProviderSnapshot = Readonly<{
  schema: "ryntra.solana.cctp-provider-snapshot";
  schemaVersion: "1.0.0";
  provider: "CIRCLE_IRIS_V2";
  environment: "MAINNET";
  direction: SolanaCctpDirection;
  /** Circle's domains for the two ends: Ethereum 0, Solana 5, Base 6. */
  sourceDomain: 0 | 5 | 6;
  destinationDomain: 0 | 5 | 6;
  health: CctpProviderHealth;
  reason: CctpProviderReason | null;
  publicKeys: PublicKeysResult;
  allowance: AllowanceResult;
  fees: FeesResult;
  observedAt: string;
  source: Readonly<{ host: "iris-api.circle.com"; ref: string }>;
}>;

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function decimal(value: unknown, field: string, maximumDecimals: number): string {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !new RegExp(`^(0|[1-9][0-9]*)(?:\\.[0-9]{1,${maximumDecimals}})?$`).test(text)) {
    throw new Error(`${field} must be a bounded non-negative decimal without exponent notation.`);
  }
  const [whole, fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function decimalToRaw(value: string, decimals: number): string {
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals))).toString();
}

export function normalizeCctpAllowance(value: unknown): CctpAllowance {
  const raw = object(value, "allowance");
  const allowanceUsdc = decimal(raw.allowance, "allowance.allowance", 6);
  if (typeof raw.lastUpdated !== "string" || !Number.isFinite(Date.parse(raw.lastUpdated))) {
    throw new Error("allowance.lastUpdated must be an offset-qualified timestamp.");
  }
  return {
    allowanceUsdc,
    allowanceRaw: decimalToRaw(allowanceUsdc, 6),
    lastUpdated: new Date(raw.lastUpdated).toISOString(),
  };
}

export function normalizeCctpFees(value: unknown): readonly CctpFeeTier[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error("CCTP fees must be a bounded non-empty array.");
  }
  const byThreshold = new Map<number, CctpFeeTier>();
  for (const [index, candidate] of value.entries()) {
    const raw = object(candidate, `fees[${index}]`);
    if (raw.finalityThreshold !== 1000 && raw.finalityThreshold !== 2000) continue;
    if (byThreshold.has(raw.finalityThreshold)) throw new Error("CCTP fees contain a duplicate finality threshold.");
    byThreshold.set(raw.finalityThreshold, {
      mode: raw.finalityThreshold === 1000 ? "FAST" : "STANDARD",
      finalityThreshold: raw.finalityThreshold,
      minimumFeeBps: decimal(raw.minimumFee, `fees[${index}].minimumFee`, 6),
    });
  }
  const fast = byThreshold.get(1000);
  const standard = byThreshold.get(2000);
  if (!fast || !standard) throw new Error("CCTP fees require both Fast and Standard tiers.");
  return [fast, standard];
}

class CctpReadError extends Error {}

async function readBoundedText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_CCTP_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new CctpReadError("CCTP response exceeded the byte ceiling.");
    }
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_CCTP_RESPONSE_BYTES) {
      throw new CctpReadError("CCTP response exceeded the byte ceiling.");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > MAX_CCTP_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CctpReadError("CCTP response exceeded the byte ceiling.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function failureCode(response: Response, text: string): CctpProviderReason {
  if (response.status === 403 && /(?:error\s*code\s*[: ]\s*1009|cloudflare[^0-9]{0,20}1009)/i.test(text)) {
    return "UNREACHABLE_FROM_ENVIRONMENT";
  }
  if (response.status === 429) return "RATE_LIMITED";
  if (response.status >= 500) return "PROVIDER_ERROR";
  return "REFUSED";
}

export type IrisReadResult =
  | Readonly<{ ok: true; value: unknown; status: number }>
  | Readonly<{ ok: false; code: CctpProviderReason; status: number | null }>;

/**
 * One bounded GET against mainnet Iris.
 *
 * Exported because the attestation client needs the same discipline —
 * pinned origin, byte ceiling, Cloudflare-edge classification, no reflected
 * provider text — and a second copy of it would drift from this one the first
 * time either was fixed. The `search` argument is passed separately rather
 * than baked into `path` so the origin-and-path assertion below still means
 * something: a caller cannot smuggle a different endpoint through a query.
 */
export async function readIrisJson(
  path: string,
  dependencies: Readonly<{ fetchImpl: typeof fetch; timeoutMs: number }>,
  search: Readonly<Record<string, string>> = {},
): Promise<IrisReadResult> {
  return requestJson(path, dependencies, search);
}

async function requestJson(
  path: string,
  dependencies: Readonly<{ fetchImpl: typeof fetch; timeoutMs: number }>,
  search: Readonly<Record<string, string>> = {},
): Promise<IrisReadResult> {
  const url = new URL(path, CCTP_IRIS_MAINNET_ORIGIN);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  if (url.origin !== CCTP_IRIS_MAINNET_ORIGIN || url.pathname !== path) {
    return { ok: false, code: "MALFORMED_RESPONSE", status: null };
  }
  let response: Response;
  try {
    response = await dependencies.fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(dependencies.timeoutMs),
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "UNREACHABLE_FROM_ENVIRONMENT", status: null };
  }

  /* Circle's network-edge denial is a large HTML document (about 900 KiB in
     the implementing environment), so waiting to read it would correctly hit
     the byte ceiling but incorrectly call the answer malformed. A JSON 403 is
     the provider refusing an API request; an HTML 403 from this fixed API
     origin is the edge refusing the environment. Classify before reading and
     cancel the body — no provider text is reflected. */
  const responseType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (response.status === 403 && responseType.includes("text/html")) {
    await response.body?.cancel();
    return { ok: false, code: "UNREACHABLE_FROM_ENVIRONMENT", status: response.status };
  }

  let text: string;
  try {
    text = await readBoundedText(response);
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", status: response.status };
  }
  if (!response.ok) return { ok: false, code: failureCode(response, text), status: response.status };

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return { ok: false, code: "MALFORMED_RESPONSE", status: response.status };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown, status: response.status };
  } catch {
    return { ok: false, code: "MALFORMED_RESPONSE", status: response.status };
  }
}

function endpointFailure(result: { ok: false; code: CctpProviderReason; status: number | null }): EndpointUnavailable {
  return { state: "UNAVAILABLE", code: result.code, status: result.status };
}

function healthOf(results: readonly (PublicKeysResult | AllowanceResult | FeesResult)[]): {
  health: CctpProviderHealth;
  reason: CctpProviderReason | null;
} {
  const failures = results.filter((entry): entry is EndpointUnavailable => entry.state === "UNAVAILABLE");
  if (failures.length === 0) return { health: "HEALTHY", reason: null };
  const available = results.length - failures.length;
  const priority: readonly CctpProviderReason[] = [
    "MALFORMED_RESPONSE",
    "REFUSED",
    "UNREACHABLE_FROM_ENVIRONMENT",
    "RATE_LIMITED",
    "PROVIDER_ERROR",
  ];
  const reason = priority.find((candidate) => failures.some((failure) => failure.code === candidate)) ?? "PROVIDER_ERROR";
  if (available > 0) return { health: "DEGRADED", reason };
  if (reason === "MALFORMED_RESPONSE") return { health: "UNKNOWN", reason };
  if (reason === "RATE_LIMITED") return { health: "DEGRADED", reason };
  return { health: "UNAVAILABLE", reason };
}

export async function fetchCctpProviderSnapshot(
  input: Readonly<{ direction: SolanaCctpDirection }>,
  dependencies: Readonly<{
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
  }> = {},
): Promise<CctpProviderSnapshot> {
  const lane = solanaCctpLane(input.direction);
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const deps = {
    fetchImpl: dependencies.fetchImpl ?? fetch,
    timeoutMs: dependencies.timeoutMs ?? 8_000,
  };
  const [publicKeysRaw, allowanceRaw, feesRaw] = await Promise.all([
    requestJson("/v2/publicKeys", deps),
    requestJson("/v2/fastBurn/USDC/allowance", deps),
    requestJson(`/v2/burn/USDC/fees/${lane.source.domain}/${lane.destination.domain}`, deps),
  ]);

  let publicKeys: PublicKeysResult;
  if (!publicKeysRaw.ok) {
    publicKeys = endpointFailure(publicKeysRaw);
  } else {
    try {
      const keys = object(publicKeysRaw.value, "publicKeys");
      if (Object.keys(keys).length === 0) throw new Error("publicKeys is empty.");
      publicKeys = { state: "AVAILABLE", observedAt };
    } catch {
      publicKeys = { state: "UNAVAILABLE", code: "MALFORMED_RESPONSE", status: 200 };
    }
  }

  let allowance: AllowanceResult;
  if (!allowanceRaw.ok) {
    allowance = endpointFailure(allowanceRaw);
  } else {
    try {
      allowance = { state: "AVAILABLE", observedAt, allowance: normalizeCctpAllowance(allowanceRaw.value) };
    } catch {
      allowance = { state: "UNAVAILABLE", code: "MALFORMED_RESPONSE", status: 200 };
    }
  }

  let fees: FeesResult;
  if (!feesRaw.ok) {
    fees = endpointFailure(feesRaw);
  } else {
    try {
      fees = { state: "AVAILABLE", observedAt, tiers: normalizeCctpFees(feesRaw.value) };
    } catch {
      fees = { state: "UNAVAILABLE", code: "MALFORMED_RESPONSE", status: 200 };
    }
  }

  const summary = healthOf([publicKeys, allowance, fees]);
  return {
    schema: "ryntra.solana.cctp-provider-snapshot",
    schemaVersion: "1.0.0",
    provider: "CIRCLE_IRIS_V2",
    environment: "MAINNET",
    direction: input.direction,
    sourceDomain: lane.source.domain,
    destinationDomain: lane.destination.domain,
    health: summary.health,
    reason: summary.reason,
    publicKeys,
    allowance,
    fees,
    observedAt,
    source: {
      host: "iris-api.circle.com",
      ref: `circle:cctp-v2:mainnet:${lane.source.domain}->${lane.destination.domain}`,
    },
  };
}
