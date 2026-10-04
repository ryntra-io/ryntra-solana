/** Browser-local read-connection contract. */

export const HOME_CONNECTION_SCHEMA_VERSION = 1 as const;
export const HOME_MAX_CONNECTIONS = 25;

export const HOME_CONNECTION_NETWORKS = ["EVM", "SOLANA", "STELLAR"] as const;
export type HomeConnectionNetwork = (typeof HOME_CONNECTION_NETWORKS)[number];

export const HOME_READ_SCOPES = ["BALANCES", "POSITIONS", "ACTIVITY", "ASSET_EVIDENCE"] as const;
export type HomeReadScope = (typeof HOME_READ_SCOPES)[number];

export type WatchConnectionDraft = Readonly<{
  network: HomeConnectionNetwork;
  address: string;
  label: string;
  scopes: readonly HomeReadScope[];
}>;

export type HomeConnectionRecord = Readonly<{
  id: string;
  kind: "WATCH_ONLY";
  state: "ACTIVE" | "REVOKED";
  network: HomeConnectionNetwork;
  address: string;
  label: string;
  scopes: readonly HomeReadScope[];
  source: "USER_DECLARED";
  ownership: "UNPROVEN";
  authority: "NONE";
  storage: "THIS_BROWSER";
  createdAt: string;
  revokedAt: string | null;
}>;

export type HomeConnectionState = Readonly<{
  schemaVersion: typeof HOME_CONNECTION_SCHEMA_VERSION;
  ownerRef: string;
  records: readonly HomeConnectionRecord[];
}>;

export type ConnectionTransitionError =
  | "INVALID_DRAFT"
  | "DUPLICATE_ACTIVE_CONNECTION"
  | "CONNECTION_LIMIT_REACHED"
  | "CONNECTION_NOT_FOUND"
  | "ALREADY_REVOKED";

type TransitionOptions = Readonly<{ id: string; now: string }>;

const CONTROL = /[\u0000-\u001f\u007f]/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;
const CONNECTION_ID = /^conn_[A-Za-z0-9_-]{1,64}$/;

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

function validOwnerRef(value: unknown): value is string {
  return typeof value === "string" && /^owner_[A-Za-z0-9_-]{4,80}$/.test(value);
}

export function normalizeWatchAddress(
  network: HomeConnectionNetwork,
  address: string,
): string | null {
  const value = address.trim();
  if (network === "EVM") return EVM_ADDRESS.test(value) ? value.toLowerCase() : null;
  if (network === "SOLANA") return SOLANA_ADDRESS.test(value) ? value : null;
  if (network === "STELLAR") return STELLAR_ADDRESS.test(value) ? value : null;
  return null;
}

function normalizeDraft(value: unknown): WatchConnectionDraft | null {
  if (!isObject(value) || !hasExactKeys(value, ["network", "address", "label", "scopes"])) return null;
  if (!HOME_CONNECTION_NETWORKS.includes(value.network as HomeConnectionNetwork)) return null;
  if (typeof value.address !== "string" || typeof value.label !== "string") return null;
  const network = value.network as HomeConnectionNetwork;
  const address = normalizeWatchAddress(network, value.address);
  const label = value.label.trim();
  if (!address || !label || label.length > 64 || CONTROL.test(label)) return null;
  if (!Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > HOME_READ_SCOPES.length) {
    return null;
  }
  const scopes: HomeReadScope[] = [];
  for (const scope of value.scopes) {
    if (!HOME_READ_SCOPES.includes(scope as HomeReadScope)) return null;
    if (!scopes.includes(scope as HomeReadScope)) scopes.push(scope as HomeReadScope);
  }
  if (!scopes.length) return null;
  return { network, address, label, scopes };
}

function parseRecord(value: unknown): HomeConnectionRecord | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "id",
      "kind",
      "state",
      "network",
      "address",
      "label",
      "scopes",
      "source",
      "ownership",
      "authority",
      "storage",
      "createdAt",
      "revokedAt",
    ])
  ) return null;
  if (typeof value.id !== "string" || !CONNECTION_ID.test(value.id)) return null;
  if (value.kind !== "WATCH_ONLY" || (value.state !== "ACTIVE" && value.state !== "REVOKED")) return null;
  if (value.source !== "USER_DECLARED" || value.ownership !== "UNPROVEN") return null;
  if (value.authority !== "NONE" || value.storage !== "THIS_BROWSER") return null;
  const draft = normalizeDraft({
    network: value.network,
    address: value.address,
    label: value.label,
    scopes: value.scopes,
  });
  if (!draft || !isIsoTime(value.createdAt)) return null;
  if (value.state === "ACTIVE" && value.revokedAt !== null) return null;
  if (value.state === "REVOKED" && !isIsoTime(value.revokedAt)) return null;
  return {
    id: value.id,
    kind: "WATCH_ONLY",
    state: value.state,
    ...draft,
    source: "USER_DECLARED",
    ownership: "UNPROVEN",
    authority: "NONE",
    storage: "THIS_BROWSER",
    createdAt: value.createdAt,
    revokedAt: value.revokedAt as string | null,
  };
}

export function emptyHomeConnectionState(ownerRef: string): HomeConnectionState {
  if (!validOwnerRef(ownerRef)) throw new Error("invalid Home connection owner");
  return { schemaVersion: HOME_CONNECTION_SCHEMA_VERSION, ownerRef, records: [] };
}

export function addWatchConnection(
  state: HomeConnectionState,
  draftValue: unknown,
  options: TransitionOptions,
):
  | Readonly<{ ok: true; state: HomeConnectionState; record: HomeConnectionRecord }>
  | Readonly<{ ok: false; error: ConnectionTransitionError }> {
  const parsed = parseHomeConnectionState(state, state.ownerRef);
  if (!parsed.ok) return { ok: false, error: "INVALID_DRAFT" };
  const draft = normalizeDraft(draftValue);
  if (!draft || !CONNECTION_ID.test(options.id) || !isIsoTime(options.now)) {
    return { ok: false, error: "INVALID_DRAFT" };
  }
  if (state.records.length >= HOME_MAX_CONNECTIONS) {
    return { ok: false, error: "CONNECTION_LIMIT_REACHED" };
  }
  const duplicate = state.records.some(
    (record) =>
      record.state === "ACTIVE" &&
      record.network === draft.network &&
      record.address === draft.address,
  );
  if (duplicate) return { ok: false, error: "DUPLICATE_ACTIVE_CONNECTION" };

  const record: HomeConnectionRecord = {
    id: options.id,
    kind: "WATCH_ONLY",
    state: "ACTIVE",
    ...draft,
    source: "USER_DECLARED",
    ownership: "UNPROVEN",
    authority: "NONE",
    storage: "THIS_BROWSER",
    createdAt: options.now,
    revokedAt: null,
  };
  return { ok: true, state: { ...state, records: [...state.records, record] }, record };
}

export function revokeConnection(
  state: HomeConnectionState,
  connectionId: string,
  now: string,
):
  | Readonly<{ ok: true; state: HomeConnectionState; record: HomeConnectionRecord }>
  | Readonly<{ ok: false; error: ConnectionTransitionError }> {
  if (!CONNECTION_ID.test(connectionId) || !isIsoTime(now)) {
    return { ok: false, error: "CONNECTION_NOT_FOUND" };
  }
  const index = state.records.findIndex((record) => record.id === connectionId);
  if (index < 0) return { ok: false, error: "CONNECTION_NOT_FOUND" };
  if (state.records[index].state === "REVOKED") return { ok: false, error: "ALREADY_REVOKED" };
  const record: HomeConnectionRecord = { ...state.records[index], state: "REVOKED", revokedAt: now };
  const records = [...state.records];
  records[index] = record;
  return { ok: true, state: { ...state, records }, record };
}

export type ParseConnectionStateResult =
  | Readonly<{ ok: true; state: HomeConnectionState }>
  | Readonly<{ ok: false; error: "FOREIGN_OWNER" | "FUTURE_SCHEMA" | "INVALID_STATE" }>;

export function parseHomeConnectionState(value: unknown, expectedOwnerRef: string): ParseConnectionStateResult {
  if (!isObject(value)) return { ok: false, error: "INVALID_STATE" };
  if (typeof value.schemaVersion === "number" && value.schemaVersion > HOME_CONNECTION_SCHEMA_VERSION) {
    return { ok: false, error: "FUTURE_SCHEMA" };
  }
  if (!hasExactKeys(value, ["schemaVersion", "ownerRef", "records"])) {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (value.schemaVersion !== HOME_CONNECTION_SCHEMA_VERSION || !validOwnerRef(value.ownerRef)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (value.ownerRef !== expectedOwnerRef) return { ok: false, error: "FOREIGN_OWNER" };
  if (!Array.isArray(value.records) || value.records.length > HOME_MAX_CONNECTIONS) {
    return { ok: false, error: "INVALID_STATE" };
  }
  const records: HomeConnectionRecord[] = [];
  const ids = new Set<string>();
  const activeKeys = new Set<string>();
  for (const raw of value.records) {
    const record = parseRecord(raw);
    if (!record || ids.has(record.id)) return { ok: false, error: "INVALID_STATE" };
    const activeKey = `${record.network}:${record.address}`;
    if (record.state === "ACTIVE" && activeKeys.has(activeKey)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    ids.add(record.id);
    if (record.state === "ACTIVE") activeKeys.add(activeKey);
    records.push(record);
  }
  return {
    ok: true,
    state: { schemaVersion: HOME_CONNECTION_SCHEMA_VERSION, ownerRef: value.ownerRef, records },
  };
}
