import { z } from "zod";

import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";
import {
  AGENT_PASSPORT_HASH_DOMAINS,
  AGENTVERSE_SOURCE_IDS,
  createAgentPassport,
  hashAgentPassportPayload,
  isAgentverseAddress,
  type AgentPassport,
  type AgentPassportConflict,
  type AgentPassportFact,
  type AgentPassportObservation,
  type AgentPassportSource,
  type AgentPassportUnknown,
} from "../agent-passport.ts";

const MAX_RESPONSE_BYTES = 524_288;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 20_000;
const MAX_JSON_STRING_LENGTH = 80_000;
const MAX_SCHEMA_DRIFT_ISSUE_LENGTH = 512;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_MANIFESTS = 6;
const PROTOCOL_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export const AGENTVERSE_BASE_URL = "https://agentverse.ai" as const;
export const AGENTVERSE_MAX_RESPONSE_BYTES = MAX_RESPONSE_BYTES;
export const AGENTVERSE_MAX_MANIFESTS = MAX_MANIFESTS;

export const AGENTVERSE_PUBLIC_ENDPOINTS = {
  registry: "/v2/almanac/resolve/{address}",
  search: "/v1/search/agents/{address}",
  manifest: "/v2/almanac/manifest/{digest}",
} as const;

export const AgentverseLookupSchema = z
  .object({
    address: z.string().refine(isAgentverseAddress, {
      message: "Agentverse address must have the exact shape and a valid Bech32 checksum.",
    }),
  })
  .strict();

export type AgentverseLookup = z.output<typeof AgentverseLookupSchema>;
export type AgentverseAdapterErrorCode = "INVALID_ADDRESS" | "ABORTED";

export class AgentverseAdapterError extends Error {
  readonly code: AgentverseAdapterErrorCode;

  constructor(code: AgentverseAdapterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentverseAdapterError";
    this.code = code;
  }
}

export type AgentverseReadDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
type SourceFailureReason =
  | "NOT_FOUND"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON";

type RawRead =
  | {
      ok: true;
      url: string;
      httpStatus: 200;
      payload: unknown;
      payloadDigest: string;
    }
  | {
      ok: false;
      url: string;
      availability: "NOT_FOUND" | "UNAVAILABLE";
      httpStatus: number | null;
      payloadDigest: string | null;
      reasonCode: SourceFailureReason;
    };

type EndpointDeclaration = { url: string; weight: number };
type RegistryRecord = {
  status: "active" | "offline" | "local";
  type: string;
  address: string;
  endpoints: EndpointDeclaration[];
  protocols: string[];
  expiry: string | null;
  domainName: string | null;
  metadata: string | null;
};

type SearchProtocol = { name: string; version: string; digest: string };
type SearchRecord = {
  status: "active" | "inactive" | "offline" | "local";
  type: string;
  address: string;
  protocols: SearchProtocol[];
  metadata: string | null;
  prefix: string | null;
  name: string | null;
  description: string | null;
  readme: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  totalInteractions: number | null;
  recentInteractions: number | null;
  rating: number | null;
  unresponsive: boolean | null;
  featured: boolean | null;
  category: string | null;
  systemWideTags: string[] | null;
  geoLocation: string | null;
  handle: string | null;
  domain: string | null;
  lastUpdated: string | null;
  createdAt: string | null;
  recentSuccessRate: number | null;
  recentEvalSuccessRate: number | null;
  owner: string | null;
  starterPrompts: string | null;
  recentVerifiedInteractions: number | null;
  recentSuccessVerifiedInteractions: number | null;
};

type ManifestRecord = {
  requestedDigest: string;
  version: string;
  name: string;
  manifestVersion: string;
  declaredDigest: string;
  description: string | null;
  modelDigests: string[];
  interactionCount: number;
};

type NormalizedRead<T> = {
  member: AgentPassportSource["members"][number];
  value: T | null;
};

class SchemaDriftError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("Agentverse response does not match the bounded public schema.");
    this.name = "SchemaDriftError";
    this.issues = [...new Set(issues.map(boundedSchemaDriftIssue))].slice(0, 16);
  }
}

class PublicReadError extends Error {
  readonly reasonCode: SourceFailureReason;
  readonly payloadDigest: string | null;

  constructor(reasonCode: SourceFailureReason, payloadDigest: string | null = null) {
    super("Agentverse public read failed within its bounded source boundary.");
    this.name = "PublicReadError";
    this.reasonCode = reasonCode;
    this.payloadDigest = payloadDigest;
  }
}

function schemaDrift(issue: string): never {
  throw new SchemaDriftError([issue]);
}

function boundedSchemaDriftIssue(issue: string): string {
  if (issue.length <= MAX_SCHEMA_DRIFT_ISSUE_LENGTH) return issue;
  const digest = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.sourcePayload, {
    kind: "AGENTVERSE_SCHEMA_DRIFT_ISSUE",
    issue,
  }).slice(2);
  const suffix = `...[sha256:${digest}]`;
  return `${issue.slice(0, MAX_SCHEMA_DRIFT_ISSUE_LENGTH - suffix.length)}${suffix}`;
}

function hasOwn(record: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertBoundedJson(value: unknown): asserts value is JsonValue {
  let nodes = 0;

  const visit = (candidate: unknown, depth: number, path: string): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) schemaDrift("JSON_NODE_LIMIT_EXCEEDED");
    if (depth > MAX_JSON_DEPTH) schemaDrift("JSON_DEPTH_LIMIT_EXCEEDED");
    if (candidate === null || typeof candidate === "boolean") return;
    if (typeof candidate === "string") {
      if (candidate.length > MAX_JSON_STRING_LENGTH) schemaDrift(`${path}: STRING_TOO_LONG`);
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) schemaDrift(`${path}: NON_FINITE_NUMBER`);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const [index, item] of candidate.entries()) visit(item, depth + 1, `${path}[${index}]`);
      return;
    }
    if (typeof candidate === "object") {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) schemaDrift(`${path}: NON_JSON_OBJECT`);
      for (const [key, item] of Object.entries(candidate)) {
        if (key.length > 128) schemaDrift(`${path}: KEY_TOO_LONG`);
        visit(item, depth + 1, `${path}.${key}`);
      }
      return;
    }
    schemaDrift(`${path}: NON_JSON_VALUE`);
  };

  visit(value, 0, "root");
}

function objectAt(value: JsonValue, path: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return schemaDrift(`${path}: EXPECTED_OBJECT`);
  }
  return value;
}

function exactObject(value: JsonValue, path: string, allowedKeys: readonly string[]): JsonObject {
  const record = objectAt(value, path);
  const unknown = Object.keys(record)
    .filter((key) => !allowedKeys.includes(key))
    .sort(compareCanonicalStrings);
  if (unknown.length > 0) schemaDrift(`${path}: UNKNOWN_FIELDS_${unknown.join("_")}`);
  return record;
}

function requiredString(
  record: JsonObject,
  key: string,
  path: string,
  maxLength = 4_096,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return schemaDrift(`${path}.${key}: EXPECTED_BOUNDED_STRING`);
  }
  return value;
}

function optionalString(
  record: JsonObject,
  key: string,
  path: string,
  maxLength = 4_096,
): string | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  return requiredString(record, key, path, maxLength);
}

function requiredNumber(record: JsonObject, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15) {
    return schemaDrift(`${path}.${key}: EXPECTED_BOUNDED_NUMBER`);
  }
  return value;
}

function optionalNumber(record: JsonObject, key: string, path: string): number | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  return requiredNumber(record, key, path);
}

function optionalBoolean(record: JsonObject, key: string, path: string): boolean | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  if (typeof record[key] !== "boolean") return schemaDrift(`${path}.${key}: EXPECTED_BOOLEAN`);
  return record[key];
}

function optionalJsonObject(record: JsonObject, key: string, path: string): JsonObject | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  return objectAt(record[key], `${path}.${key}`);
}

function optionalStringArray(
  record: JsonObject,
  key: string,
  path: string,
  maximum = 64,
): string[] | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  const value = record[key];
  if (!Array.isArray(value) || value.length > maximum) {
    return schemaDrift(`${path}.${key}: EXPECTED_BOUNDED_ARRAY`);
  }
  const strings = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 4_096) {
      return schemaDrift(`${path}.${key}[${index}]: EXPECTED_BOUNDED_STRING`);
    }
    return entry;
  });
  return [...new Set(strings)].sort(compareCanonicalStrings);
}

function boundedCanonicalValue(value: JsonValue, path: string): string {
  const result = canonicalJson(value);
  if (result.length > MAX_JSON_STRING_LENGTH) schemaDrift(`${path}: CANONICAL_VALUE_TOO_LONG`);
  return result;
}

function statusOf<const T extends readonly string[]>(
  record: JsonObject,
  key: string,
  path: string,
  allowed: T,
): T[number] {
  const value = requiredString(record, key, path, 64);
  if (!allowed.includes(value)) return schemaDrift(`${path}.${key}: UNKNOWN_ENUM`);
  return value as T[number];
}

export function normalizeAgentverseRegistryPayload(payload: unknown): RegistryRecord {
  assertBoundedJson(payload);
  const record = exactObject(payload, "registry", [
    "status",
    "type",
    "address",
    "endpoints",
    "protocols",
    "expiry",
    "domain_name",
    "metadata",
  ]);
  const address = requiredString(record, "address", "registry", 128);
  if (!isAgentverseAddress(address)) schemaDrift("registry.address: INVALID_ADDRESS");

  const rawEndpoints = record.endpoints;
  if (!Array.isArray(rawEndpoints) || rawEndpoints.length > 32) {
    schemaDrift("registry.endpoints: EXPECTED_BOUNDED_ARRAY");
  }
  const endpoints = rawEndpoints.map((entry, index) => {
    const endpoint = exactObject(entry, `registry.endpoints[${index}]`, ["url", "weight"]);
    const url = requiredString(endpoint, "url", `registry.endpoints[${index}]`, 3_800);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return schemaDrift(`registry.endpoints[${index}].url: INVALID_URL`);
    }
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) {
      schemaDrift(`registry.endpoints[${index}].url: UNSUPPORTED_URL`);
    }
    return {
      url,
      weight: requiredNumber(endpoint, "weight", `registry.endpoints[${index}]`),
    };
  }).sort((left, right) => compareCanonicalStrings(canonicalJson(left), canonicalJson(right)));

  if (!hasOwn(record, "protocols") || record.protocols === null) {
    schemaDrift("registry.protocols: REQUIRED");
  }
  const protocols = optionalStringArray(record, "protocols", "registry") ?? [];
  if (protocols.some((digest) => !PROTOCOL_DIGEST_PATTERN.test(digest))) {
    schemaDrift("registry.protocols: INVALID_PROTOCOL_DIGEST");
  }

  let expiry: string | null = null;
  if (hasOwn(record, "expiry") && record.expiry !== null) {
    if (typeof record.expiry === "string" && record.expiry.length > 0 && record.expiry.length <= 128) {
      expiry = record.expiry;
    } else if (typeof record.expiry === "number" && Number.isSafeInteger(record.expiry)) {
      expiry = String(record.expiry);
    } else {
      schemaDrift("registry.expiry: EXPECTED_BOUNDED_STRING_OR_INTEGER");
    }
  }

  return {
    status: statusOf(record, "status", "registry", ["active", "offline", "local"] as const),
    type: requiredString(record, "type", "registry", 128),
    address,
    endpoints,
    protocols,
    expiry,
    domainName: optionalString(record, "domain_name", "registry", 512),
    metadata: (() => {
      const value = optionalJsonObject(record, "metadata", "registry");
      return value === null ? null : boundedCanonicalValue(value, "registry.metadata");
    })(),
  };
}

function searchProtocols(record: JsonObject): SearchProtocol[] {
  if (!hasOwn(record, "protocols") || record.protocols === null) {
    return schemaDrift("search.protocols: REQUIRED");
  }
  if (!Array.isArray(record.protocols) || record.protocols.length > 64) {
    return schemaDrift("search.protocols: EXPECTED_BOUNDED_ARRAY");
  }
  return record.protocols.map((entry, index) => {
    const protocol = exactObject(entry, `search.protocols[${index}]`, ["name", "version", "digest"]);
    const digestValue = requiredString(protocol, "digest", `search.protocols[${index}]`, 70);
    const digestMatch = /^(?:proto:)?([0-9a-f]{64})$/.exec(digestValue);
    if (!digestMatch) {
      schemaDrift(`search.protocols[${index}].digest: INVALID_PROTOCOL_DIGEST`);
    }
    const digest = digestMatch[1];
    return {
      name: requiredString(protocol, "name", `search.protocols[${index}]`, 256),
      version: requiredString(protocol, "version", `search.protocols[${index}]`, 128),
      digest,
    };
  }).sort((left, right) => compareCanonicalStrings(left.digest, right.digest));
}

export function normalizeAgentverseSearchPayload(payload: unknown): SearchRecord {
  assertBoundedJson(payload);
  const record = exactObject(payload, "search", [
    "status",
    "type",
    "address",
    "protocols",
    "metadata",
    "prefix",
    "name",
    "description",
    "readme",
    "avatar_href",
    "banner_href",
    "total_interactions",
    "recent_interactions",
    "rating",
    "unresponsive",
    "featured",
    "category",
    "system_wide_tags",
    "geo_location",
    "handle",
    "domain",
    "last_updated",
    "created_at",
    "recent_success_rate",
    "recent_eval_success_rate",
    "owner",
    "starter_prompts",
    "recent_verified_interactions",
    "recent_success_verified_interactions",
  ]);
  const address = requiredString(record, "address", "search", 128);
  if (!isAgentverseAddress(address)) schemaDrift("search.address: INVALID_ADDRESS");

  return {
    status: statusOf(record, "status", "search", ["active", "inactive", "offline", "local"] as const),
    type: requiredString(record, "type", "search", 128),
    address,
    protocols: searchProtocols(record),
    metadata: (() => {
      const value = optionalJsonObject(record, "metadata", "search");
      return value === null ? null : boundedCanonicalValue(value, "search.metadata");
    })(),
    prefix: optionalString(record, "prefix", "search", 128),
    name: optionalString(record, "name", "search", 256),
    description: optionalString(record, "description", "search", MAX_JSON_STRING_LENGTH),
    readme: optionalString(record, "readme", "search", MAX_JSON_STRING_LENGTH),
    avatarUrl: optionalString(record, "avatar_href", "search", 4_096),
    bannerUrl: optionalString(record, "banner_href", "search", 4_096),
    totalInteractions: optionalNumber(record, "total_interactions", "search"),
    recentInteractions: optionalNumber(record, "recent_interactions", "search"),
    rating: optionalNumber(record, "rating", "search"),
    unresponsive: optionalBoolean(record, "unresponsive", "search"),
    featured: optionalBoolean(record, "featured", "search"),
    category: optionalString(record, "category", "search", 256),
    systemWideTags: optionalStringArray(record, "system_wide_tags", "search"),
    geoLocation: hasOwn(record, "geo_location") && record.geo_location !== null
      ? boundedCanonicalValue(record.geo_location, "search.geo_location")
      : null,
    handle: optionalString(record, "handle", "search", 256),
    domain: optionalString(record, "domain", "search", 512),
    lastUpdated: optionalString(record, "last_updated", "search", 128),
    createdAt: optionalString(record, "created_at", "search", 128),
    recentSuccessRate: optionalNumber(record, "recent_success_rate", "search"),
    recentEvalSuccessRate: optionalNumber(record, "recent_eval_success_rate", "search"),
    owner: optionalString(record, "owner", "search", 256),
    starterPrompts: (() => {
      if (!hasOwn(record, "starter_prompts") || record.starter_prompts === null) return null;
      if (!Array.isArray(record.starter_prompts) || record.starter_prompts.length > 32) {
        return schemaDrift("search.starter_prompts: EXPECTED_BOUNDED_ARRAY_OR_NULL");
      }
      return boundedCanonicalValue(record.starter_prompts, "search.starter_prompts");
    })(),
    recentVerifiedInteractions: optionalNumber(record, "recent_verified_interactions", "search"),
    recentSuccessVerifiedInteractions: optionalNumber(
      record,
      "recent_success_verified_interactions",
      "search",
    ),
  };
}

export function normalizeAgentverseManifestPayload(
  payload: unknown,
  requestedDigest: string,
): ManifestRecord {
  if (!PROTOCOL_DIGEST_PATTERN.test(requestedDigest)) schemaDrift("manifest.requestedDigest: INVALID_DIGEST");
  assertBoundedJson(payload);
  const record = exactObject(payload, "manifest", [
    "version",
    "metadata",
    "models",
    "interactions",
    "nodes",
    "edges",
  ]);
  const metadata = exactObject(record.metadata, "manifest.metadata", [
    "name",
    "version",
    "digest",
    "description",
  ]);
  const declaredDigestValue = requiredString(metadata, "digest", "manifest.metadata", 70);
  const declaredDigestMatch = /^(?:proto:)?([0-9a-f]{64})$/.exec(declaredDigestValue);
  if (!declaredDigestMatch) {
    schemaDrift("manifest.metadata.digest: INVALID_PROTOCOL_DIGEST");
  }
  const declaredDigest = declaredDigestMatch[1];

  if (!Array.isArray(record.models) || record.models.length > 64) {
    schemaDrift("manifest.models: EXPECTED_BOUNDED_ARRAY");
  }
  const modelDigests = record.models.map((entry, index) => {
    const model = exactObject(entry, `manifest.models[${index}]`, ["digest", "schema"]);
    const digest = requiredString(model, "digest", `manifest.models[${index}]`, 128);
    return digest;
  }).sort(compareCanonicalStrings);

  if (!Array.isArray(record.interactions) || record.interactions.length > 128) {
    schemaDrift("manifest.interactions: EXPECTED_BOUNDED_ARRAY");
  }
  for (const [index, entry] of record.interactions.entries()) {
    const interaction = exactObject(entry, `manifest.interactions[${index}]`, [
      "type",
      "request",
      "responses",
    ]);
    requiredString(interaction, "type", `manifest.interactions[${index}]`, 128);
    if (!hasOwn(interaction, "request") || !Array.isArray(interaction.responses)) {
      schemaDrift(`manifest.interactions[${index}]: INVALID_INTERACTION`);
    }
  }
  if (hasOwn(record, "nodes") && !Array.isArray(record.nodes)) schemaDrift("manifest.nodes: EXPECTED_ARRAY");
  if (hasOwn(record, "edges") && !Array.isArray(record.edges)) schemaDrift("manifest.edges: EXPECTED_ARRAY");

  return {
    requestedDigest,
    version: requiredString(record, "version", "manifest", 128),
    name: requiredString(metadata, "name", "manifest.metadata", 256),
    manifestVersion: requiredString(metadata, "version", "manifest.metadata", 128),
    declaredDigest,
    description: optionalString(
      metadata,
      "description",
      "manifest.metadata",
      MAX_JSON_STRING_LENGTH - 65,
    ),
    modelDigests,
    interactionCount: record.interactions.length,
  };
}

function validatedTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new TypeError(`Agentverse timeout must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function observationTime(now: (() => Date) | undefined): Date {
  const value = (now ?? (() => new Date()))();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Agentverse observation clock must return a valid Date.");
  }
  return value;
}

function officialUrl(kind: "registry" | "search" | "manifest", identifier: string): string {
  const path = kind === "registry"
    ? `/v2/almanac/resolve/${encodeURIComponent(identifier)}`
    : kind === "search"
      ? `/v1/search/agents/${encodeURIComponent(identifier)}`
      : `/v2/almanac/manifest/${encodeURIComponent(identifier)}`;
  const url = new URL(path, AGENTVERSE_BASE_URL);
  const validPath = kind === "manifest"
    ? /^\/v2\/almanac\/manifest\/[0-9a-f]{64}$/.test(url.pathname)
    : kind === "registry"
      ? /^\/v2\/almanac\/resolve\/agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/.test(url.pathname)
      : /^\/v1\/search\/agents\/agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/.test(url.pathname);
  if (
    url.origin !== AGENTVERSE_BASE_URL
    || url.username
    || url.password
    || url.search
    || url.hash
    || !validPath
  ) {
    throw new TypeError("Agentverse public read URL escaped the fixed official contract.");
  }
  return url.toString();
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null || response.body.locked) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort cleanup; the bounded source failure remains authoritative.
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      await cancelResponseBody(response);
      throw new PublicReadError("INVALID_JSON");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new PublicReadError("RESPONSE_TOO_LARGE");
    }
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let result = "";
  let cancelled = false;
  const cancelReader = async (): Promise<void> => {
    if (cancelled) return;
    cancelled = true;
    try {
      await reader.cancel();
    } catch {
      // Cancellation is best-effort cleanup; the bounded source failure remains authoritative.
    }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await cancelReader();
        throw new PublicReadError("RESPONSE_TOO_LARGE");
      }
      result += decoder.decode(next.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } catch (error) {
    await cancelReader();
    if (error instanceof PublicReadError) throw error;
    throw new PublicReadError("INVALID_JSON");
  } finally {
    reader.releaseLock();
  }
}

async function readPublicJson(
  url: string,
  dependencies: AgentverseReadDependencies,
): Promise<RawRead> {
  const timeoutMs = validatedTimeout(dependencies.timeoutMs);
  if (dependencies.signal?.aborted) {
    throw new AgentverseAdapterError("ABORTED", "Agentverse request was cancelled by the caller.");
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let externalAbort: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new PublicReadError("TIMEOUT"));
    }, timeoutMs);
  });
  const callerAbort = new Promise<never>((_, reject) => {
    if (!dependencies.signal) return;
    externalAbort = () => {
      controller.abort();
      reject(new AgentverseAdapterError("ABORTED", "Agentverse request was cancelled by the caller."));
    };
    dependencies.signal.addEventListener("abort", externalAbort, { once: true });
  });

  const operation = async (): Promise<RawRead> => {
    const response = await (dependencies.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await cancelResponseBody(response);
      return {
        ok: false,
        url,
        availability: response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE",
        httpStatus: response.status,
        payloadDigest: null,
        reasonCode: response.status === 404 ? "NOT_FOUND" : "HTTP_ERROR",
      };
    }
    const body = await boundedResponseText(response);
    const payloadDigest = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.sourcePayload, {
      url,
      body,
    });
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new PublicReadError("INVALID_JSON", payloadDigest);
    }
    return { ok: true, url, httpStatus: 200, payload, payloadDigest };
  };

  try {
    return await Promise.race([operation(), timeout, callerAbort]);
  } catch (error) {
    if (dependencies.signal?.aborted) {
      throw new AgentverseAdapterError("ABORTED", "Agentverse request was cancelled by the caller.", { cause: error });
    }
    if (timedOut || (error instanceof PublicReadError && error.reasonCode === "TIMEOUT")) {
      return { ok: false, url, availability: "UNAVAILABLE", httpStatus: null, payloadDigest: null, reasonCode: "TIMEOUT" };
    }
    if (error instanceof PublicReadError) {
      return {
        ok: false,
        url,
        availability: "UNAVAILABLE",
        httpStatus: error.reasonCode === "INVALID_JSON" ? 200 : null,
        payloadDigest: error.payloadDigest,
        reasonCode: error.reasonCode,
      };
    }
    return { ok: false, url, availability: "UNAVAILABLE", httpStatus: null, payloadDigest: null, reasonCode: "NETWORK_ERROR" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (dependencies.signal && externalAbort) {
      dependencies.signal.removeEventListener("abort", externalAbort);
    }
  }
}

function memberId(kind: "registry" | "search" | "manifest", identifier: string): string {
  return kind === "manifest" ? `manifest-${identifier.slice(0, 16)}` : kind;
}

function normalizeRead<T>(
  read: RawRead,
  kind: "registry" | "search" | "manifest",
  identifier: string,
  observedAt: string,
  normalizer: (payload: unknown) => T,
): NormalizedRead<T> {
  if (!read.ok) {
    return {
      member: {
        id: memberId(kind, identifier),
        url: read.url,
        observedAt,
        availability: read.availability,
        httpStatus: read.httpStatus,
        payloadDigest: read.payloadDigest,
        reasonCode: read.reasonCode,
        schemaDrift: [],
      },
      value: null,
    };
  }
  try {
    return {
      member: {
        id: memberId(kind, identifier),
        url: read.url,
        observedAt,
        availability: "AVAILABLE",
        httpStatus: 200,
        payloadDigest: read.payloadDigest,
        reasonCode: null,
        schemaDrift: [],
      },
      value: normalizer(read.payload),
    };
  } catch (error) {
    if (!(error instanceof SchemaDriftError)) throw error;
    return {
      member: {
        id: memberId(kind, identifier),
        url: read.url,
        observedAt,
        availability: "SCHEMA_DRIFT",
        httpStatus: 200,
        payloadDigest: read.payloadDigest,
        reasonCode: "SCHEMA_DRIFT",
        schemaDrift: error.issues,
      },
      value: null,
    };
  }
}

function aggregateDigest(members: AgentPassportSource["members"]): string {
  return hashAgentPassportPayload(
    AGENT_PASSPORT_HASH_DOMAINS.sourcePayload,
    members.map(({ id, availability, payloadDigest }) => ({ id, availability, payloadDigest })),
  );
}

function singleSource(
  kind: "REGISTRY" | "SEARCH",
  observedAt: string,
  member: AgentPassportSource["members"][number],
): AgentPassportSource {
  const availability = member.availability;
  return {
    id: AGENTVERSE_SOURCE_IDS[kind],
    provider: "AGENTVERSE",
    kind,
    providerScope: "PROVIDER_GLOBAL",
    observedAt,
    availability,
    members: [member],
    payloadDigest: availability === "AVAILABLE" || availability === "SCHEMA_DRIFT"
      ? aggregateDigest([member])
      : member.payloadDigest,
    reasonCode: member.reasonCode,
    schemaDrift: member.schemaDrift,
  };
}

function manifestSource(
  observedAt: string,
  members: AgentPassportSource["members"],
): AgentPassportSource {
  if (members.length === 0) {
    return {
      id: AGENTVERSE_SOURCE_IDS.MANIFESTS,
      provider: "AGENTVERSE",
      kind: "MANIFESTS",
      providerScope: "PROVIDER_GLOBAL",
      observedAt,
      availability: "NOT_REQUESTED",
      members: [],
      payloadDigest: null,
      reasonCode: "NO_PROTOCOL_DIGESTS",
      schemaDrift: [],
    };
  }
  const available = members.filter((member) => member.availability === "AVAILABLE").length;
  const schemaIssues = members.flatMap((member) => member.schemaDrift).sort(compareCanonicalStrings);
  if (available === members.length) {
    return {
      id: AGENTVERSE_SOURCE_IDS.MANIFESTS,
      provider: "AGENTVERSE",
      kind: "MANIFESTS",
      providerScope: "PROVIDER_GLOBAL",
      observedAt,
      availability: "AVAILABLE",
      members,
      payloadDigest: aggregateDigest(members),
      reasonCode: null,
      schemaDrift: [],
    };
  }
  if (available > 0) {
    return {
      id: AGENTVERSE_SOURCE_IDS.MANIFESTS,
      provider: "AGENTVERSE",
      kind: "MANIFESTS",
      providerScope: "PROVIDER_GLOBAL",
      observedAt,
      availability: "PARTIAL",
      members,
      payloadDigest: aggregateDigest(members),
      reasonCode: "PARTIAL_FAILURE",
      schemaDrift: schemaIssues,
    };
  }
  if (members.every((member) => member.availability === "NOT_FOUND")) {
    return {
      id: AGENTVERSE_SOURCE_IDS.MANIFESTS,
      provider: "AGENTVERSE",
      kind: "MANIFESTS",
      providerScope: "PROVIDER_GLOBAL",
      observedAt,
      availability: "NOT_FOUND",
      members,
      payloadDigest: null,
      reasonCode: "NOT_FOUND",
      schemaDrift: [],
    };
  }
  if (members.every((member) => member.availability === "SCHEMA_DRIFT")) {
    return {
      id: AGENTVERSE_SOURCE_IDS.MANIFESTS,
      provider: "AGENTVERSE",
      kind: "MANIFESTS",
      providerScope: "PROVIDER_GLOBAL",
      observedAt,
      availability: "SCHEMA_DRIFT",
      members,
      payloadDigest: aggregateDigest(members),
      reasonCode: "SCHEMA_DRIFT",
      schemaDrift: schemaIssues,
    };
  }
  return {
    id: AGENTVERSE_SOURCE_IDS.MANIFESTS,
    provider: "AGENTVERSE",
    kind: "MANIFESTS",
    providerScope: "PROVIDER_GLOBAL",
    observedAt,
    availability: "UNAVAILABLE",
    members,
    payloadDigest: members.some((member) => member.payloadDigest !== null) ? aggregateDigest(members) : null,
    reasonCode: "PARTIAL_FAILURE",
    schemaDrift: schemaIssues,
  };
}

function addFact(
  facts: Map<string, AgentPassportFact>,
  field: AgentPassportFact["field"],
  value: AgentPassportFact["value"] | null,
  sourceId: AgentPassportFact["sourceIds"][number],
): void {
  if (value === null) return;
  const key = `${field}\n${canonicalJson(value)}`;
  const existing = facts.get(key);
  if (existing) {
    if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId);
    return;
  }
  const metric = [
    "total_interactions",
    "recent_interactions",
    "rating",
    "recent_success_rate",
    "recent_eval_success_rate",
    "recent_verified_interactions",
    "recent_success_verified_interactions",
  ].includes(field);
  const digest = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.sourcePayload, { field, value });
  facts.set(key, {
    id: `claim_${field}_${digest.slice(2, 14)}`,
    field,
    value,
    sourceIds: [sourceId],
    declaration: metric ? "PROVIDER_REPORTED_METRIC" : "PROVIDER_DECLARED",
    limitation: metric
      ? "Provider-reported Agentverse metric only; not a Ryntra score, verification or recommendation."
      : "Provider-declared value from a public Agentverse source; Ryntra did not independently verify it.",
  });
}

function registryFacts(facts: Map<string, AgentPassportFact>, record: RegistryRecord | null): void {
  if (!record) return;
  const source = AGENTVERSE_SOURCE_IDS.REGISTRY;
  addFact(facts, "address", record.address, source);
  addFact(facts, "status", record.status, source);
  addFact(facts, "agent_type", record.type, source);
  addFact(facts, "endpoints", record.endpoints.map((endpoint) => canonicalJson(endpoint)), source);
  addFact(facts, "protocols", record.protocols, source);
  addFact(facts, "expiry", record.expiry, source);
  addFact(facts, "domain_name", record.domainName, source);
  addFact(facts, "metadata", record.metadata, source);
}

function searchFacts(facts: Map<string, AgentPassportFact>, record: SearchRecord | null): void {
  if (!record) return;
  const source = AGENTVERSE_SOURCE_IDS.SEARCH;
  addFact(facts, "address", record.address, source);
  addFact(facts, "status", record.status, source);
  addFact(facts, "agent_type", record.type, source);
  addFact(facts, "protocols", record.protocols.map((protocol) => canonicalJson(protocol)), source);
  addFact(facts, "metadata", record.metadata, source);
  addFact(facts, "prefix", record.prefix, source);
  addFact(facts, "name", record.name, source);
  addFact(facts, "description", record.description, source);
  addFact(facts, "readme", record.readme, source);
  addFact(facts, "avatar_url", record.avatarUrl, source);
  addFact(facts, "banner_url", record.bannerUrl, source);
  addFact(facts, "total_interactions", record.totalInteractions, source);
  addFact(facts, "recent_interactions", record.recentInteractions, source);
  addFact(facts, "rating", record.rating, source);
  addFact(facts, "unresponsive", record.unresponsive, source);
  addFact(facts, "featured", record.featured, source);
  addFact(facts, "category", record.category, source);
  addFact(facts, "system_wide_tags", record.systemWideTags, source);
  addFact(facts, "geo_location", record.geoLocation, source);
  addFact(facts, "handle", record.handle, source);
  addFact(facts, "domain", record.domain, source);
  addFact(facts, "last_updated", record.lastUpdated, source);
  addFact(facts, "created_at", record.createdAt, source);
  addFact(facts, "recent_success_rate", record.recentSuccessRate, source);
  addFact(facts, "recent_eval_success_rate", record.recentEvalSuccessRate, source);
  addFact(facts, "owner", record.owner, source);
  addFact(facts, "starter_prompts", record.starterPrompts, source);
  addFact(facts, "recent_verified_interactions", record.recentVerifiedInteractions, source);
  addFact(facts, "recent_success_verified_interactions", record.recentSuccessVerifiedInteractions, source);
}

function manifestFacts(facts: Map<string, AgentPassportFact>, manifests: readonly ManifestRecord[]): void {
  const source = AGENTVERSE_SOURCE_IDS.MANIFESTS;
  for (const manifest of manifests) {
    addFact(facts, "protocol_manifest_name", `${manifest.declaredDigest}:${manifest.name}`, source);
    addFact(facts, "protocol_manifest_version", `${manifest.declaredDigest}:${manifest.manifestVersion}`, source);
    addFact(facts, "protocol_manifest_digest", manifest.declaredDigest, source);
    addFact(
      facts,
      "protocol_manifest_description",
      manifest.description === null ? null : `${manifest.declaredDigest}:${manifest.description}`,
      source,
    );
    addFact(
      facts,
      "protocol_manifest_models",
      manifest.modelDigests.map((digest) => `${manifest.declaredDigest}:${digest}`),
      source,
    );
  }
}

function conflictValue(source: string, value: string): string {
  if (value.length <= 520) return `${source}:${value}`;
  const digest = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.sourcePayload, value);
  return `${source}:sha256:${digest.slice(2)}`;
}

function deriveConflicts(
  requestAddress: string,
  registry: RegistryRecord | null,
  search: SearchRecord | null,
  manifests: readonly ManifestRecord[],
): AgentPassportConflict[] {
  const conflicts: AgentPassportConflict[] = [];
  for (const [sourceId, record] of [
    [AGENTVERSE_SOURCE_IDS.REGISTRY, registry],
    [AGENTVERSE_SOURCE_IDS.SEARCH, search],
  ] as const) {
    if (record && record.address !== requestAddress) {
      conflicts.push({
        id: `conflict_request_address_${sourceId}`,
        field: "request_address",
        sourceIds: [sourceId],
        values: [conflictValue("request", requestAddress), conflictValue(sourceId, record.address)],
        reason: "The provider-returned address does not match the exact requested address.",
      });
    }
  }
  if (registry && search) {
    for (const [field, left, right] of [
      ["address", registry.address, search.address],
      ["status", registry.status, search.status],
      ["agent_type", registry.type, search.type],
    ] as const) {
      if (left !== right) {
        conflicts.push({
          id: `conflict_registry_search_${field}`,
          field,
          sourceIds: [AGENTVERSE_SOURCE_IDS.REGISTRY, AGENTVERSE_SOURCE_IDS.SEARCH],
          values: [conflictValue("registry", left), conflictValue("search", right)],
          reason: `Independent Agentverse registry and search claims disagree on ${field}.`,
        });
      }
    }
  }
  for (const manifest of manifests) {
    if (manifest.requestedDigest !== manifest.declaredDigest) {
      conflicts.push({
        id: `conflict_manifest_digest_${manifest.requestedDigest.slice(0, 16)}`,
        field: "protocol_manifest_digest",
        sourceIds: [AGENTVERSE_SOURCE_IDS.MANIFESTS],
        values: [
          conflictValue("requested", manifest.requestedDigest),
          conflictValue("declared", manifest.declaredDigest),
        ],
        reason: "The manifest metadata digest differs from the digest used in its official read path.",
      });
    }
  }
  return conflicts;
}

function sourceUnknown(source: AgentPassportSource): AgentPassportUnknown | null {
  if (source.availability === "AVAILABLE") return null;
  const reasonCode = source.availability === "NOT_FOUND"
    ? "SOURCE_NOT_FOUND"
    : source.availability === "SCHEMA_DRIFT"
      ? "SOURCE_SCHEMA_DRIFT"
      : source.availability === "NOT_REQUESTED"
        ? "PROVIDER_SCOPE_UNAVAILABLE"
        : "SOURCE_UNAVAILABLE";
  return {
    id: `unknown_source_${source.kind.toLowerCase()}`,
    field: `${source.kind.toLowerCase()}_source`,
    sourceIds: [source.id],
    reasonCode,
    detail: `Agentverse ${source.kind.toLowerCase()} source is ${source.availability}; no failed-source payload became a positive fact.`,
  };
}

function deriveUnknowns(
  sources: readonly AgentPassportSource[],
  facts: readonly AgentPassportFact[],
  conflicts: readonly AgentPassportConflict[],
  protocolCount: number,
): AgentPassportUnknown[] {
  const unknowns = sources.map(sourceUnknown).filter((value): value is AgentPassportUnknown => value !== null);
  for (const field of ["name", "description", "status", "agent_type", "endpoints", "protocols"] as const) {
    if (!facts.some((fact) => fact.field === field)) {
      unknowns.push({
        id: `unknown_field_${field}`,
        field,
        sourceIds: [AGENTVERSE_SOURCE_IDS.REGISTRY, AGENTVERSE_SOURCE_IDS.SEARCH],
        reasonCode: "FIELD_NOT_DECLARED",
        detail: `No successfully normalized public Agentverse source declared ${field}.`,
      });
    }
  }
  for (const conflict of conflicts) {
    unknowns.push({
      id: `unknown_${conflict.id}`,
      field: conflict.field,
      sourceIds: [...conflict.sourceIds],
      reasonCode: "CONFLICTING_CLAIMS",
      detail: `Ryntra leaves ${conflict.field} unknown because the provider claims conflict.`,
    });
  }
  if (protocolCount > MAX_MANIFESTS) {
    unknowns.push({
      id: "unknown_manifest_bound",
      field: "protocol_manifests_beyond_bound",
      sourceIds: [AGENTVERSE_SOURCE_IDS.REGISTRY, AGENTVERSE_SOURCE_IDS.MANIFESTS],
      reasonCode: "PROVIDER_SCOPE_UNAVAILABLE",
      detail: `Only the first ${MAX_MANIFESTS} canonical unique registry protocol digests were read; additional manifests were not requested.`,
    });
  }
  return unknowns;
}

function observations(
  sources: readonly AgentPassportSource[],
  requestAddress: string,
  registry: RegistryRecord | null,
  search: SearchRecord | null,
): AgentPassportObservation[] {
  const values: AgentPassportObservation[] = sources.map((source) => ({
    id: `observation_source_${source.kind.toLowerCase()}`,
    kind: "SOURCE_AVAILABILITY",
    sourceIds: [source.id],
    value: source.availability,
    detail: `Ryntra recorded the bounded ${source.kind.toLowerCase()} public-read result without promoting failed data.`,
  }));
  for (const [sourceId, record] of [
    [AGENTVERSE_SOURCE_IDS.REGISTRY, registry],
    [AGENTVERSE_SOURCE_IDS.SEARCH, search],
  ] as const) {
    if (record) {
      values.push({
        id: `observation_address_${sourceId}`,
        kind: "ADDRESS_MATCH",
        sourceIds: [sourceId],
        value: record.address === requestAddress,
        detail: "Ryntra compared the returned exact address with the requested address; this does not authenticate ownership.",
      });
    }
  }
  values.push(
    {
      id: "observation_provider_scope",
      kind: "PROVIDER_SCOPE",
      sourceIds: sources.map((source) => source.id),
      value: "PROVIDER_GLOBAL",
      detail: "The public Agentverse reads expose no caller-selectable network, so Ryntra invents no mainnet or testnet scope.",
    },
    {
      id: "observation_declared_endpoint_fetch",
      kind: "DECLARED_ENDPOINT_FETCH",
      sourceIds: [AGENTVERSE_SOURCE_IDS.REGISTRY],
      value: false,
      detail: "Agent-declared endpoints were preserved as provider metadata and never fetched by this adapter.",
    },
    {
      id: "observation_provider_metric_authority",
      kind: "PROVIDER_METRIC_AUTHORITY",
      sourceIds: [AGENTVERSE_SOURCE_IDS.SEARCH],
      value: "PROVIDER_REPORTED_ONLY",
      detail: "Interaction and success fields remain provider-reported and are not a Ryntra score or recommendation.",
    },
    {
      id: "observation_liveness",
      kind: "LIVENESS",
      sourceIds: [AGENTVERSE_SOURCE_IDS.REGISTRY],
      value: "NOT_TESTED",
      detail: "Ryntra did not call any agent-declared endpoint, so functional liveness was not tested.",
    },
  );
  return values;
}

export async function fetchAgentverseAgentPassport(
  input: unknown,
  dependencies: AgentverseReadDependencies = {},
): Promise<AgentPassport> {
  const parsed = AgentverseLookupSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentverseAdapterError("INVALID_ADDRESS", "Provide exactly one valid Agentverse address.");
  }
  if (dependencies.signal?.aborted) {
    throw new AgentverseAdapterError("ABORTED", "Agentverse request was cancelled by the caller.");
  }
  const createdAt = observationTime(dependencies.now);
  const observedAt = createdAt.toISOString();
  const address = parsed.data.address;

  const [registryRaw, searchRaw] = await Promise.all([
    readPublicJson(officialUrl("registry", address), dependencies),
    readPublicJson(officialUrl("search", address), dependencies),
  ]);
  const registryRead = normalizeRead(
    registryRaw,
    "registry",
    address,
    observedAt,
    normalizeAgentverseRegistryPayload,
  );
  const searchRead = normalizeRead(
    searchRaw,
    "search",
    address,
    observedAt,
    normalizeAgentverseSearchPayload,
  );

  const allProtocolDigests = [...new Set(registryRead.value?.protocols ?? [])].sort(compareCanonicalStrings);
  const requestedDigests = allProtocolDigests.slice(0, MAX_MANIFESTS);
  const manifestReads = await Promise.all(
    requestedDigests.map(async (digest) => {
      const raw = await readPublicJson(officialUrl("manifest", digest), dependencies);
      return normalizeRead(
        raw,
        "manifest",
        digest,
        observedAt,
        (payload) => normalizeAgentverseManifestPayload(payload, digest),
      );
    }),
  );

  const sources = [
    singleSource("REGISTRY", observedAt, registryRead.member),
    singleSource("SEARCH", observedAt, searchRead.member),
    manifestSource(observedAt, manifestReads.map((read) => read.member)),
  ];
  const facts = new Map<string, AgentPassportFact>();
  registryFacts(facts, registryRead.value);
  searchFacts(facts, searchRead.value);
  const normalizedManifests = manifestReads
    .map((read) => read.value)
    .filter((value): value is ManifestRecord => value !== null);
  manifestFacts(facts, normalizedManifests);
  const providerClaims = [...facts.values()];
  const conflicts = deriveConflicts(address, registryRead.value, searchRead.value, normalizedManifests);
  const unknowns = deriveUnknowns(sources, providerClaims, conflicts, allProtocolDigests.length);

  return createAgentPassport({
    request: { schemaVersion: "1.0.0", provider: "AGENTVERSE", address },
    sources,
    providerClaims,
    ryntraObservations: observations(sources, address, registryRead.value, searchRead.value),
    conflicts,
    unknowns,
    createdAt,
  });
}
