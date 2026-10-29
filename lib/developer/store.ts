/**
 * Where the developer console's records live (DEV-2): the port and the memory adapter. Production is Postgres
 * (`./store-postgres.server.ts`) — six tables a separately authorized migration provisions
 * (`db/migrations/20261026120000_dev_2_console.sql`); the memory adapter serves the tests and a local stand on one
 * instance, and says so (`durability`).
 *
 * A project and everything under it change under compare-and-set: every change names the project version it was
 * decided on and is applied only while the version is still that one, so two people issuing keys at the same moment
 * never slip past the same limit.
 *
 * Two things are deliberately not alike. A **key's secret** is kept as a SHA-256 hash and nothing can turn it back:
 * the server never needs it again, only to recognise one. An **endpoint's secret** is kept as it is, because the
 * server signs every delivery with it; it is handed to the person once, at the moment it is made, and no read view
 * carries it afterwards.
 */

import type { DevCredentialKind, DevEnvironment, DevKeyState, DevQuotaWindow, DevScope, DevWebhookEvent } from "../core/developer/console.ts";

export type DevNetwork = "solana:mainnet" | "solana:devnet";

export type DevProjectRecord = Readonly<{
  id: string;
  teamId: string;
  network: DevNetwork;
  name: string;
  createdBy: string;
  createdAt: string;
  version: number;
}>;

export type DevKeyRecord = Readonly<{
  id: string;
  projectId: string;
  environment: DevEnvironment;
  kind: DevCredentialKind;
  name: string;
  /** SHA-256 of the secret, hex; null for a public key, which has no secret at all. */
  secretHash: string | null;
  scopes: readonly DevScope[];
  /** The origins a browser may use a public key from; always empty for a secret key. */
  origins: readonly string[];
  state: DevKeyState;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** When a rotating key stops answering; null for one that does not. */
  expiresAt: string | null;
  revokedAt: string | null;
  /** The key this one was rotated into, for the record. */
  rotatedTo: string | null;
}>;

export type DevEndpointRecord = Readonly<{
  id: string;
  projectId: string;
  environment: DevEnvironment;
  url: string;
  events: readonly DevWebhookEvent[];
  enabled: boolean;
  /** The secret every delivery is signed with. Never in a read view. */
  secret: string;
  /** The secret before the last rotation, while it still signs beside the new one; null otherwise. */
  previousSecret: string | null;
  previousUntil: string | null;
  createdBy: string;
  createdAt: string;
}>;

export const DEV_DELIVERY_STATES = ["DELIVERED", "FAILED"] as const;
export type DevDeliveryState = (typeof DEV_DELIVERY_STATES)[number];

export type DevDeliveryRecord = Readonly<{
  id: string;
  projectId: string;
  endpointId: string;
  event: DevWebhookEvent;
  at: string;
  state: DevDeliveryState;
  attempts: number;
  /** The last answer's HTTP status, or null when nothing answered. */
  status: number | null;
  /** Why it failed, in one line; null when it did not. */
  error: string | null;
}>;

export type DevWrite =
  | Readonly<{ kind: "project"; name: string }>
  | Readonly<{ kind: "key"; key: DevKeyRecord }>
  | Readonly<{ kind: "endpoint"; endpoint: DevEndpointRecord }>
  | Readonly<{ kind: "endpointRemove"; endpointId: string }>;

export type DevProjectState = Readonly<{ project: DevProjectRecord; keys: readonly DevKeyRecord[]; endpoints: readonly DevEndpointRecord[] }>;

export type DevStoreDurability = "EPHEMERAL_SINGLE_INSTANCE" | "DURABLE_MULTI_WRITER";

export interface DevStore {
  readonly durability: DevStoreDurability;
  /** A new project. False when the id is taken. */
  create(project: DevProjectRecord): Promise<boolean>;
  read(id: string): Promise<DevProjectState | null>;
  /** The projects of one team on one network, oldest first. */
  byTeam(network: DevNetwork, teamId: string): Promise<readonly DevProjectRecord[]>;
  /** The writes applied together while the project is at `expectedVersion`; false when it moved. */
  commit(id: string, expectedVersion: number, writes: readonly DevWrite[]): Promise<boolean>;
  /** One key by its id, whatever project it belongs to — the lookup every authenticated request makes. */
  key(id: string): Promise<DevKeyRecord | null>;
  /** Records that a key answered a request; never fails a request of its own. */
  touchKey(id: string, at: string): Promise<void>;
  /** Adds one to each named window and answers each count after the addition. */
  consume(projectId: string, environment: DevEnvironment, windows: Readonly<Record<DevQuotaWindow, string>>, at: string): Promise<Readonly<Record<DevQuotaWindow, number>>>;
  /** The counts as they are now, adding nothing. */
  usage(projectId: string, environment: DevEnvironment, windows: Readonly<Record<DevQuotaWindow, string>>): Promise<Readonly<Record<DevQuotaWindow, number>>>;
  recordDelivery(delivery: DevDeliveryRecord, keep: number): Promise<void>;
  deliveries(projectId: string, limit: number): Promise<readonly DevDeliveryRecord[]>;
  /** True when this delivery id is new for this endpoint and has now been recorded; false when it had been seen. */
  markSeen(endpointId: string, deliveryId: string, at: string, keepSeconds: number): Promise<boolean>;
}

/** The store could not answer: not provisioned, or not reachable. Never read as «no project». */
export class DevStoreUnavailable extends Error {
  readonly reason: "NOT_PROVISIONED" | "UNREACHABLE";
  constructor(reason: "NOT_PROVISIONED" | "UNREACHABLE", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.reason = reason;
  }
}

const zeros = (): Record<DevQuotaWindow, number> => ({ minute: 0, day: 0, month: 0 });

/** Per-process memory: tests and a local stand on one instance only. */
export function createMemoryDevStore(): DevStore {
  const projects = new Map<string, DevProjectRecord>();
  const keys = new Map<string, DevKeyRecord>();
  const endpoints = new Map<string, DevEndpointRecord>();
  const counters = new Map<string, number>();
  const deliveries: DevDeliveryRecord[] = [];
  const seen = new Map<string, number>();

  const counterKey = (projectId: string, environment: DevEnvironment, window: string) => `${projectId}:${environment}:${window}`;
  const keysOf = (projectId: string) => [...keys.values()].filter((row) => row.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const endpointsOf = (projectId: string) => [...endpoints.values()].filter((row) => row.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return {
    durability: "EPHEMERAL_SINGLE_INSTANCE",
    async create(project) {
      if (projects.has(project.id)) return false;
      projects.set(project.id, project);
      return true;
    },
    async read(id) {
      const project = projects.get(id);
      return project ? { project, keys: keysOf(id), endpoints: endpointsOf(id) } : null;
    },
    async byTeam(network, teamId) {
      return [...projects.values()].filter((row) => row.network === network && row.teamId === teamId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async commit(id, expectedVersion, writes) {
      const project = projects.get(id);
      if (!project || project.version !== expectedVersion) return false;
      let next: DevProjectRecord = { ...project, version: project.version + 1 };
      for (const write of writes) {
        if (write.kind === "project") next = { ...next, name: write.name };
        else if (write.kind === "key") keys.set(write.key.id, write.key);
        else if (write.kind === "endpoint") endpoints.set(write.endpoint.id, write.endpoint);
        else endpoints.delete(write.endpointId);
      }
      projects.set(id, next);
      return true;
    },
    async key(id) {
      return keys.get(id) ?? null;
    },
    async touchKey(id, at) {
      const key = keys.get(id);
      if (key) keys.set(id, { ...key, lastUsedAt: at });
    },
    async consume(projectId, environment, windows) {
      const counts = zeros();
      for (const [window, value] of Object.entries(windows) as [DevQuotaWindow, string][]) {
        const slot = counterKey(projectId, environment, value);
        const next = (counters.get(slot) ?? 0) + 1;
        counters.set(slot, next);
        counts[window] = next;
      }
      return counts;
    },
    async usage(projectId, environment, windows) {
      const counts = zeros();
      for (const [window, value] of Object.entries(windows) as [DevQuotaWindow, string][]) counts[window] = counters.get(counterKey(projectId, environment, value)) ?? 0;
      return counts;
    },
    async recordDelivery(delivery, keep) {
      deliveries.push(delivery);
      const mine = deliveries.filter((row) => row.projectId === delivery.projectId);
      for (const stale of mine.slice(0, Math.max(0, mine.length - keep))) deliveries.splice(deliveries.indexOf(stale), 1);
    },
    async deliveries(projectId, limit) {
      return deliveries
        .filter((row) => row.projectId === projectId)
        .slice()
        .reverse()
        .slice(0, limit);
    },
    async markSeen(endpointId, deliveryId, at, keepSeconds) {
      const now = Date.parse(at);
      for (const [slot, when] of seen) if (now - when > keepSeconds * 1000) seen.delete(slot);
      const slot = `${endpointId}:${deliveryId}`;
      if (seen.has(slot)) return false;
      seen.set(slot, now);
      return true;
    },
  };
}
