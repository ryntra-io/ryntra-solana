const AGENT_LAUNCH_MAX_RESPONSE_BYTES = 1_048_576;
const AGENT_LAUNCH_MAX_JSON_DEPTH = 32;
const AGENT_LAUNCH_MAX_JSON_NODES = 20_000;
const AGENT_LAUNCH_MAX_STRING_LENGTH = 4_096;
const AGENT_LAUNCH_DEFAULT_TIMEOUT_MS = 8_000;
const AGENT_LAUNCH_MAX_TIMEOUT_MS = 15_000;

export const AGENT_LAUNCH_BASE_URL = "https://agent-launch.ai" as const;
export const AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID = 97 as const;

export const AGENT_LAUNCH_PUBLIC_ENDPOINTS = {
  tokens: "/api/agents/tokens",
  token: "/api/agents/token/{address}",
} as const;

export type AgentLaunchJsonValue =
  | null
  | boolean
  | number
  | string
  | AgentLaunchJsonValue[]
  | { [key: string]: AgentLaunchJsonValue };

type AgentLaunchJsonObject = { [key: string]: AgentLaunchJsonValue };

export type AgentLaunchFieldConflict = {
  field: "symbol" | "agentId";
  aliases: string[];
  values: string[];
};

export type NormalizedAgentLaunchToken = {
  address: string;
  name: string | null;
  symbol: string | null;
  agentId: string | null;
  payloadChainId: 97 | null;
  decimals: number | null;
  listed: boolean | null;
  status: boolean | string | null;
  schemaDrift: string[];
  conflicts: AgentLaunchFieldConflict[];
  raw: AgentLaunchJsonObject;
};

export type AgentLaunchTokenListNormalization = {
  controllerVariant:
    | "SUCCESS_DATA_ARRAY"
    | "SUCCESS_DATA_TOKENS"
    | "LEGACY_TOKENS_ROOT"
    | "RAW_ARRAY";
  state: "AVAILABLE" | "ZERO_STATE";
  tokens: NormalizedAgentLaunchToken[];
  schemaDrift: string[];
  raw: AgentLaunchJsonValue;
};

export type AgentLaunchTokenDetailNormalization = {
  controllerVariant: "SUCCESS_DATA_RECORD" | "LEGACY_DATA_RECORD" | "RAW_RECORD";
  state: "AVAILABLE" | "NOT_FOUND";
  token: NormalizedAgentLaunchToken | null;
  schemaDrift: string[];
  raw: AgentLaunchJsonValue;
};

export type AgentLaunchTokenListObservation = AgentLaunchTokenListNormalization & {
  provider: "AGENT_LAUNCH";
  access: "PUBLIC_READ_ONLY_GET";
  endpoint: "TOKENS";
  chainId: 97;
  providerUrl: string;
  observedAt: string;
};

export type AgentLaunchTokenDetailObservation = AgentLaunchTokenDetailNormalization & {
  provider: "AGENT_LAUNCH";
  access: "PUBLIC_READ_ONLY_GET";
  endpoint: "TOKEN_DETAIL";
  chainId: 97;
  providerUrl: string;
  observedAt: string;
};

export type AgentLaunchReadDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

export class AgentLaunchAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentLaunchAdapterError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AgentLaunchAdapterError(code, message);
}

function hasOwn(record: AgentLaunchJsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertJsonValue(value: unknown): asserts value is AgentLaunchJsonValue {
  let nodes = 0;

  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > AGENT_LAUNCH_MAX_JSON_NODES) {
      fail("AGENT_LAUNCH_JSON_TOO_LARGE", "Agent Launch JSON exceeds the node limit.");
    }
    if (depth > AGENT_LAUNCH_MAX_JSON_DEPTH) {
      fail("AGENT_LAUNCH_JSON_TOO_DEEP", "Agent Launch JSON exceeds the depth limit.");
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      if (
        typeof candidate === "string" &&
        candidate.length > AGENT_LAUNCH_MAX_RESPONSE_BYTES
      ) {
        fail("AGENT_LAUNCH_STRING_TOO_LONG", "Agent Launch JSON contains an oversized string.");
      }
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        fail("AGENT_LAUNCH_JSON_INVALID", "Agent Launch JSON contains a non-finite number.");
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (typeof candidate === "object") {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        fail("AGENT_LAUNCH_JSON_INVALID", "Agent Launch payload must contain plain JSON objects.");
      }
      for (const [key, item] of Object.entries(candidate)) {
        if (key.length > 256) {
          fail("AGENT_LAUNCH_JSON_INVALID", "Agent Launch JSON contains an oversized key.");
        }
        visit(item, depth + 1);
      }
      return;
    }
    fail("AGENT_LAUNCH_JSON_INVALID", "Agent Launch response is not JSON-compatible.");
  };

  visit(value, 0);
}

function asObject(value: AgentLaunchJsonValue, context: string): AgentLaunchJsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return fail("AGENT_LAUNCH_SCHEMA_INVALID", `${context} must be a JSON object.`);
  }
  return value;
}

function readRequiredSuccess(record: AgentLaunchJsonObject): void {
  if (typeof record.success !== "boolean") {
    fail("AGENT_LAUNCH_SCHEMA_INVALID", "Agent Launch success must be a boolean.");
  }
  if (!record.success) {
    fail("AGENT_LAUNCH_PROVIDER_REJECTED", "Agent Launch returned success=false.");
  }
  if (hasOwn(record, "error") && record.error !== null) {
    fail(
      "AGENT_LAUNCH_PROVIDER_CONTRADICTION",
      "Agent Launch returned success=true with a non-null error.",
    );
  }
}

function collectStrings(
  record: AgentLaunchJsonObject,
  aliases: readonly string[],
  field: string,
): Array<{ alias: string; value: string }> {
  const values: Array<{ alias: string; value: string }> = [];
  for (const alias of aliases) {
    if (!hasOwn(record, alias) || record[alias] === null) continue;
    const value = record[alias];
    if (typeof value !== "string") {
      fail("AGENT_LAUNCH_SCHEMA_INVALID", `${field}.${alias} must be a string or null.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > AGENT_LAUNCH_MAX_STRING_LENGTH) {
      fail("AGENT_LAUNCH_SCHEMA_INVALID", `${field}.${alias} has an invalid length.`);
    }
    values.push({ alias, value: trimmed });
  }
  return values;
}

function readOptionalAliasedString(
  record: AgentLaunchJsonObject,
  aliases: readonly string[],
  field: "symbol" | "agentId" | "name",
  schemaDrift: string[],
  conflicts: AgentLaunchFieldConflict[],
): string | null {
  const values = collectStrings(record, aliases, field);
  if (values.length === 0) return null;

  const distinct = [...new Set(values.map(({ value }) => value))];
  if (distinct.length > 1) {
    if (field === "name") {
      fail("AGENT_LAUNCH_ALIAS_CONFLICT", "Agent Launch name aliases disagree.");
    }
    conflicts.push({
      field,
      aliases: values.map(({ alias }) => alias),
      values: distinct,
    });
    schemaDrift.push(`${field.toUpperCase()}_ALIAS_CONFLICT`);
    return null;
  }

  if (values[0].alias !== aliases[0]) {
    schemaDrift.push(`${field.toUpperCase()}_FROM_${values[0].alias.toUpperCase()}`);
  }
  return values[0].value;
}

function normalizeEvmAddress(value: string, context: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("AGENT_LAUNCH_ADDRESS_INVALID", `${context} must be a 20-byte EVM address.`);
  }
  return value.toLowerCase();
}

function readAddress(record: AgentLaunchJsonObject, schemaDrift: string[]): string {
  const aliases = ["address", "tokenAddress", "token_address", "contractAddress"] as const;
  const values = collectStrings(record, aliases, "token.address");
  if (values.length === 0) {
    return fail("AGENT_LAUNCH_ADDRESS_MISSING", "Agent Launch token address is missing.");
  }
  const normalized = values.map(({ alias, value }) => ({
    alias,
    value: normalizeEvmAddress(value, `token.address.${alias}`),
  }));
  if (new Set(normalized.map(({ value }) => value)).size !== 1) {
    fail("AGENT_LAUNCH_ADDRESS_CONFLICT", "Agent Launch token address aliases disagree.");
  }
  if (normalized[0].alias !== aliases[0]) {
    schemaDrift.push(`ADDRESS_FROM_${normalized[0].alias.toUpperCase()}`);
  }
  return normalized[0].value;
}

function parseChainId(value: AgentLaunchJsonValue, context: string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail("AGENT_LAUNCH_CHAIN_INVALID", `${context} must be a positive integer.`);
    }
    return value;
  }
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fail("AGENT_LAUNCH_CHAIN_INVALID", `${context} must be an integer or decimal string.`);
}

function readPayloadChainId(
  record: AgentLaunchJsonObject,
  schemaDrift: string[],
): 97 | null {
  const aliases = ["chainId", "chain_id"] as const;
  const values: Array<{ alias: string; value: number; fromString: boolean }> = [];
  for (const alias of aliases) {
    if (!hasOwn(record, alias) || record[alias] === null) continue;
    const raw = record[alias];
    values.push({
      alias,
      value: parseChainId(raw, `token.${alias}`),
      fromString: typeof raw === "string",
    });
  }
  if (values.length === 0) return null;
  if (new Set(values.map(({ value }) => value)).size !== 1) {
    fail("AGENT_LAUNCH_CHAIN_CONFLICT", "Agent Launch token chain aliases disagree.");
  }
  if (values[0].value !== AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID) {
    fail(
      "AGENT_LAUNCH_CHAIN_MISMATCH",
      `Agent Launch token is not on required chainId ${AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID}.`,
    );
  }
  if (values[0].alias !== aliases[0]) schemaDrift.push("CHAIN_ID_FROM_CHAIN_ID_SNAKE_CASE");
  if (values[0].fromString) schemaDrift.push("CHAIN_ID_FROM_DECIMAL_STRING");
  return AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID;
}

function readDecimals(record: AgentLaunchJsonObject, schemaDrift: string[]): number | null {
  if (!hasOwn(record, "decimals") || record.decimals === null) return null;
  const value = record.decimals;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    parsed = Number(value);
    schemaDrift.push("DECIMALS_FROM_DECIMAL_STRING");
  } else {
    return fail(
      "AGENT_LAUNCH_SCHEMA_INVALID",
      "Agent Launch token.decimals must be an integer or decimal string.",
    );
  }
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    fail("AGENT_LAUNCH_SCHEMA_INVALID", "Agent Launch token.decimals is out of range.");
  }
  return parsed;
}

function readOptionalBoolean(
  record: AgentLaunchJsonObject,
  key: string,
): boolean | null {
  if (!hasOwn(record, key) || record[key] === null) return null;
  if (typeof record[key] !== "boolean") {
    fail("AGENT_LAUNCH_SCHEMA_INVALID", `Agent Launch token.${key} must be boolean or null.`);
  }
  return record[key];
}

function readStatus(record: AgentLaunchJsonObject): boolean | string | null {
  if (!hasOwn(record, "status") || record.status === null) return null;
  if (typeof record.status === "boolean") return record.status;
  if (typeof record.status === "string") {
    const status = record.status.trim();
    if (status.length > 0 && status.length <= 128) return status;
  }
  return fail(
    "AGENT_LAUNCH_SCHEMA_INVALID",
    "Agent Launch token.status must be a bounded string, boolean, or null.",
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function normalizeAgentLaunchToken(value: unknown): NormalizedAgentLaunchToken {
  assertJsonValue(value);
  const record = asObject(value, "Agent Launch token");
  const schemaDrift: string[] = [];
  const conflicts: AgentLaunchFieldConflict[] = [];
  const address = readAddress(record, schemaDrift);
  const name = readOptionalAliasedString(
    record,
    ["name", "tokenName"],
    "name",
    schemaDrift,
    conflicts,
  );
  const symbol = readOptionalAliasedString(
    record,
    ["symbol", "ticker"],
    "symbol",
    schemaDrift,
    conflicts,
  );
  const agentId = readOptionalAliasedString(
    record,
    ["agentId", "agent_address", "agentAddress", "agent_id"],
    "agentId",
    schemaDrift,
    conflicts,
  );

  return {
    address,
    name,
    symbol,
    agentId,
    payloadChainId: readPayloadChainId(record, schemaDrift),
    decimals: readDecimals(record, schemaDrift),
    listed: readOptionalBoolean(record, "listed"),
    status: readStatus(record),
    schemaDrift: unique(schemaDrift),
    conflicts,
    raw: record,
  };
}

function normalizeTokenArray(value: AgentLaunchJsonValue): NormalizedAgentLaunchToken[] {
  if (!Array.isArray(value)) {
    return fail("AGENT_LAUNCH_SCHEMA_INVALID", "Agent Launch tokens must be an array.");
  }
  const tokens = value.map((token) => normalizeAgentLaunchToken(token));
  if (new Set(tokens.map(({ address }) => address)).size !== tokens.length) {
    fail("AGENT_LAUNCH_DUPLICATE_TOKEN", "Agent Launch returned duplicate token addresses.");
  }
  return tokens;
}

export function normalizeAgentLaunchTokenListPayload(
  payload: unknown,
): AgentLaunchTokenListNormalization {
  assertJsonValue(payload);
  let controllerVariant: AgentLaunchTokenListNormalization["controllerVariant"];
  let rawTokens: AgentLaunchJsonValue;
  const controllerDrift: string[] = [];

  if (Array.isArray(payload)) {
    controllerVariant = "RAW_ARRAY";
    rawTokens = payload;
    controllerDrift.push("CONTROLLER_RAW_ARRAY");
  } else {
    const record = asObject(payload, "Agent Launch token list response");
    if (hasOwn(record, "success")) {
      readRequiredSuccess(record);
      if (Array.isArray(record.data)) {
        controllerVariant = "SUCCESS_DATA_ARRAY";
        rawTokens = record.data;
      } else {
        const data = asObject(record.data, "Agent Launch token list data");
        if (!Array.isArray(data.tokens)) {
          fail("AGENT_LAUNCH_SCHEMA_INVALID", "Agent Launch data.tokens must be an array.");
        }
        controllerVariant = "SUCCESS_DATA_TOKENS";
        rawTokens = data.tokens;
        controllerDrift.push("CONTROLLER_DATA_TOKENS_WRAPPER");
      }
    } else {
      if (!Array.isArray(record.tokens)) {
        fail("AGENT_LAUNCH_SCHEMA_INVALID", "Agent Launch legacy tokens must be an array.");
      }
      controllerVariant = "LEGACY_TOKENS_ROOT";
      rawTokens = record.tokens;
      controllerDrift.push("CONTROLLER_LEGACY_TOKENS_ROOT");
    }
  }

  const tokens = normalizeTokenArray(rawTokens);
  return {
    controllerVariant,
    state: tokens.length === 0 ? "ZERO_STATE" : "AVAILABLE",
    tokens,
    schemaDrift: unique([
      ...controllerDrift,
      ...tokens.flatMap(({ schemaDrift }) => schemaDrift),
    ]),
    raw: payload,
  };
}

export function normalizeAgentLaunchTokenDetailPayload(
  payload: unknown,
  requestedAddress: string,
): AgentLaunchTokenDetailNormalization {
  assertJsonValue(payload);
  const normalizedRequestedAddress = normalizeEvmAddress(
    requestedAddress,
    "requested Agent Launch token address",
  );
  const record = asObject(payload, "Agent Launch token detail response");
  let controllerVariant: AgentLaunchTokenDetailNormalization["controllerVariant"];
  let rawToken: AgentLaunchJsonValue;
  const controllerDrift: string[] = [];

  if (hasOwn(record, "success")) {
    readRequiredSuccess(record);
    controllerVariant = "SUCCESS_DATA_RECORD";
    rawToken = record.data;
  } else if (hasOwn(record, "data")) {
    controllerVariant = "LEGACY_DATA_RECORD";
    rawToken = record.data;
    controllerDrift.push("CONTROLLER_LEGACY_DATA_RECORD");
  } else {
    controllerVariant = "RAW_RECORD";
    rawToken = record;
    controllerDrift.push("CONTROLLER_RAW_RECORD");
  }

  if (rawToken === null) {
    return {
      controllerVariant,
      state: "NOT_FOUND",
      token: null,
      schemaDrift: controllerDrift,
      raw: payload,
    };
  }

  const token = normalizeAgentLaunchToken(rawToken);
  if (token.address !== normalizedRequestedAddress) {
    fail(
      "AGENT_LAUNCH_ADDRESS_MISMATCH",
      "Agent Launch token detail address does not match the requested address.",
    );
  }
  return {
    controllerVariant,
    state: "AVAILABLE",
    token,
    schemaDrift: unique([...controllerDrift, ...token.schemaDrift]),
    raw: payload,
  };
}

function readTimeoutMs(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? AGENT_LAUNCH_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > AGENT_LAUNCH_MAX_TIMEOUT_MS) {
    fail(
      "AGENT_LAUNCH_TIMEOUT_INVALID",
      `Agent Launch timeout must be between 1 and ${AGENT_LAUNCH_MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return value;
}

function observedAt(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    fail("AGENT_LAUNCH_CLOCK_INVALID", "Agent Launch observation clock returned an invalid date.");
  }
  return date.toISOString();
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null || response.body.locked) return;
  try {
    await response.body.cancel();
  } catch {
    // Cancellation is best-effort; the bounded adapter error remains authoritative.
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      await cancelResponseBody(response);
      fail("AGENT_LAUNCH_HTTP_INVALID", "Agent Launch returned an invalid Content-Length.");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      await cancelResponseBody(response);
      fail("AGENT_LAUNCH_HTTP_INVALID", "Agent Launch returned an invalid Content-Length.");
    }
    if (declaredBytes > AGENT_LAUNCH_MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      fail("AGENT_LAUNCH_RESPONSE_TOO_LARGE", "Agent Launch response exceeds the byte limit.");
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
      // Cancellation is best-effort; the bounded adapter error remains authoritative.
    }
  };

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > AGENT_LAUNCH_MAX_RESPONSE_BYTES) {
        await cancelReader();
        fail("AGENT_LAUNCH_RESPONSE_TOO_LARGE", "Agent Launch response exceeds the byte limit.");
      }
      result += decoder.decode(next.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } catch (error) {
    await cancelReader();
    if (error instanceof AgentLaunchAdapterError) throw error;
    throw new AgentLaunchAdapterError(
      "AGENT_LAUNCH_JSON_INVALID",
      "Agent Launch response is not valid JSON.",
      { cause: error },
    );
  } finally {
    reader.releaseLock();
  }
}

async function readPublicJson(
  providerUrl: string,
  dependencies: AgentLaunchReadDependencies,
): Promise<AgentLaunchJsonValue> {
  const url = new URL(providerUrl);
  if (url.origin !== AGENT_LAUNCH_BASE_URL) {
    fail("AGENT_LAUNCH_URL_REJECTED", "Agent Launch URL must use the official provider origin.");
  }
  const controller = new AbortController();
  const timeoutMs = readTimeoutMs(dependencies.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AgentLaunchAdapterError(
          "AGENT_LAUNCH_TIMEOUT",
          "Agent Launch public read exceeded its bounded timeout.",
        ),
      );
    }, timeoutMs);
  });

  const operation = async (): Promise<AgentLaunchJsonValue> => {
    const response = await (dependencies.fetchImpl ?? fetch)(providerUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      fail("AGENT_LAUNCH_HTTP_ERROR", `Agent Launch returned HTTP ${response.status}.`);
    }
    const body = await readBoundedResponseText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new AgentLaunchAdapterError(
        "AGENT_LAUNCH_JSON_INVALID",
        "Agent Launch response is not valid JSON.",
        { cause: error },
      );
    }
    assertJsonValue(payload);
    return payload;
  };

  try {
    return await Promise.race([operation(), timeout]);
  } catch (error) {
    if (error instanceof AgentLaunchAdapterError) throw error;
    throw new AgentLaunchAdapterError(
      "AGENT_LAUNCH_NETWORK_ERROR",
      "Agent Launch public read failed.",
      { cause: error },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function fetchAgentLaunchTestnetTokens(
  dependencies: AgentLaunchReadDependencies = {},
): Promise<AgentLaunchTokenListObservation> {
  const url = new URL(AGENT_LAUNCH_PUBLIC_ENDPOINTS.tokens, AGENT_LAUNCH_BASE_URL);
  url.searchParams.set("chainId", String(AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID));
  const providerUrl = url.toString();
  const normalized = normalizeAgentLaunchTokenListPayload(
    await readPublicJson(providerUrl, dependencies),
  );
  return {
    provider: "AGENT_LAUNCH",
    access: "PUBLIC_READ_ONLY_GET",
    endpoint: "TOKENS",
    chainId: AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID,
    providerUrl,
    observedAt: observedAt(dependencies.now),
    ...normalized,
  };
}

export async function fetchAgentLaunchTestnetToken(
  address: string,
  dependencies: AgentLaunchReadDependencies = {},
): Promise<AgentLaunchTokenDetailObservation> {
  const normalizedAddress = normalizeEvmAddress(address, "Agent Launch token address");
  const path = AGENT_LAUNCH_PUBLIC_ENDPOINTS.token.replace("{address}", normalizedAddress);
  const url = new URL(path, AGENT_LAUNCH_BASE_URL);
  url.searchParams.set("chainId", String(AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID));
  const providerUrl = url.toString();
  const normalized = normalizeAgentLaunchTokenDetailPayload(
    await readPublicJson(providerUrl, dependencies),
    normalizedAddress,
  );
  return {
    provider: "AGENT_LAUNCH",
    access: "PUBLIC_READ_ONLY_GET",
    endpoint: "TOKEN_DETAIL",
    chainId: AGENT_LAUNCH_BSC_TESTNET_CHAIN_ID,
    providerUrl,
    observedAt: observedAt(dependencies.now),
    ...normalized,
  };
}
