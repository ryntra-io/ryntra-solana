import {
  HOME_CONNECTION_SCHEMA_VERSION,
  HOME_READ_SCOPES,
  emptyHomeConnectionState,
  parseHomeConnectionState,
  type HomeConnectionState,
  type HomeReadScope,
} from "./connections.ts";
import {
  missingInvestorContextFields,
  parseInvestorContextHistory,
  type InvestorContextVersion,
} from "./investor-context.ts";

export const HOME_LOCAL_SCHEMA_VERSION = 1 as const;
export const HOME_LOCAL_MAX_BYTES = 64 * 1024;
export const HOME_LOCAL_EVENT = "ryntra:home-local-state";

export type HomeLocalEnvelope = Readonly<{
  schemaVersion: typeof HOME_LOCAL_SCHEMA_VERSION;
  ownerRef: string;
  connections: HomeConnectionState;
  investorContexts: readonly InvestorContextVersion[];
  updatedAt: string;
}>;

type IdentityInput = Readonly<{
  authenticated: boolean;
  subjectKind: "TELEGRAM" | "WALLET" | "ACCOUNT" | "NONE";
  identityWallet: string | null;
  telegramVerified: boolean;
}>;

type VenueCredential = Readonly<{
  provider: string;
  state: "ACTIVE" | "REVOKED" | "UNKNOWN";
  scopes: readonly string[];
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function emptyHomeLocalEnvelope(ownerRef: string, now: string): HomeLocalEnvelope {
  if (!isIsoTime(now)) throw new Error("invalid Home local timestamp");
  return {
    schemaVersion: HOME_LOCAL_SCHEMA_VERSION,
    ownerRef,
    connections: emptyHomeConnectionState(ownerRef),
    investorContexts: [],
    updatedAt: now,
  };
}

export function encodeHomeLocalEnvelope(envelope: HomeLocalEnvelope): string {
  const parsed = parseHomeLocalEnvelope(JSON.stringify(envelope), envelope.ownerRef);
  if (!parsed.ok) throw new Error(`invalid Home local envelope: ${parsed.error}`);
  const encoded = JSON.stringify(parsed.envelope);
  if (new TextEncoder().encode(encoded).byteLength > HOME_LOCAL_MAX_BYTES) {
    throw new Error("Home local envelope exceeds its byte budget");
  }
  return encoded;
}

export type ParseHomeLocalResult =
  | Readonly<{ ok: true; envelope: HomeLocalEnvelope }>
  | Readonly<{
      ok: false;
      error: "INVALID_JSON" | "TOO_LARGE" | "FUTURE_SCHEMA" | "FOREIGN_OWNER" | "INVALID_STATE";
    }>;

export function parseHomeLocalEnvelope(encoded: string, expectedOwnerRef: string): ParseHomeLocalResult {
  if (new TextEncoder().encode(encoded).byteLength > HOME_LOCAL_MAX_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  if (!isObject(value)) return { ok: false, error: "INVALID_STATE" };
  if (typeof value.schemaVersion === "number" && value.schemaVersion > HOME_LOCAL_SCHEMA_VERSION) {
    return { ok: false, error: "FUTURE_SCHEMA" };
  }
  if (!hasExactKeys(value, ["schemaVersion", "ownerRef", "connections", "investorContexts", "updatedAt"])) {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (value.schemaVersion !== HOME_LOCAL_SCHEMA_VERSION || typeof value.ownerRef !== "string") {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (value.ownerRef !== expectedOwnerRef) return { ok: false, error: "FOREIGN_OWNER" };
  const connections = parseHomeConnectionState(value.connections, expectedOwnerRef);
  const investorContexts = parseInvestorContextHistory(value.investorContexts);
  if (!connections.ok || investorContexts === null || !isIsoTime(value.updatedAt)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  return {
    ok: true,
    envelope: {
      schemaVersion: HOME_LOCAL_SCHEMA_VERSION,
      ownerRef: expectedOwnerRef,
      connections: connections.state,
      investorContexts,
      updatedAt: value.updatedAt,
    },
  };
}

export function projectFinancialTwin(input: Readonly<{
  identity: IdentityInput;
  envelope: HomeLocalEnvelope;
  venueCredentials: readonly VenueCredential[];
}>) {
  const activeConnections = input.envelope.connections.records.filter((record) => record.state === "ACTIVE");
  const revokedConnections = input.envelope.connections.records.length - activeConnections.length;
  const scopeSet = new Set<HomeReadScope>();
  for (const record of activeConnections) for (const scope of record.scopes) scopeSet.add(scope);
  const scopes = HOME_READ_SCOPES.filter((scope) => scopeSet.has(scope));

  const activeCredentials = input.venueCredentials.filter((credential) => credential.state === "ACTIVE");
  const providers = [...new Set(activeCredentials.map((credential) => credential.provider))].sort();
  const current = input.envelope.investorContexts.at(-1) ?? null;
  const missingFields = current ? missingInvestorContextFields(current) : [];

  return {
    identity: {
      authenticated: input.identity.authenticated,
      subjectKind: input.identity.subjectKind,
      walletOwnership: input.identity.identityWallet ? "PROVEN_BY_SIWE" : "NOT_PROVEN_IN_THIS_SESSION",
      identityWallet: input.identity.identityWallet,
    },
    data: { active: activeConnections.length, revoked: revokedConnections, scopes },
    venues: { active: activeCredentials.length, providers },
    context: {
      state: current === null ? "MISSING" : missingFields.length ? "PARTIAL" : "COMPLETE",
      version: current?.version ?? null,
      missingFields,
    },
    authority: {
      state: "EXACT_ACTION_ONLY" as const,
      granted: false as const,
      owner: "ACTION_CASE_AGENT_CONTROL" as const,
    },
    storage: {
      state: "THIS_BROWSER" as const,
      schemaVersion: HOME_LOCAL_SCHEMA_VERSION,
      connectionSchemaVersion: HOME_CONNECTION_SCHEMA_VERSION,
    },
  };
}
