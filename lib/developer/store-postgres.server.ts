/**
 * The developer console's store on Postgres (DEV-2): the six tables of
 * `db/migrations/20261026120000_dev_2_console.sql`, in the database `DATABASE_URL` names — the same one
 * `guard_objects` and the team tables live in, over the same verified-TLS pool settings (`postgresGuardPoolConfig`).
 * Requests never run DDL: the shape is checked once per process with `LIMIT 0` reads, and until the migration has
 * run every call throws `DevStoreUnavailable("NOT_PROVISIONED")` — never an empty list.
 *
 * A commit is one transaction: the project's version moves from the one the change was decided on, or nothing is
 * written. A quota count is one statement, so two instances counting the same second never lose a call. A delivery
 * id is recorded by a primary key, so a replay loses the race rather than being judged by a read.
 *
 * Server only.
 */

import { Pool, type PoolClient } from "pg";

import type { DevEnvironment, DevQuotaWindow } from "../core/developer/console.ts";
import { postgresGuardPoolConfig } from "../guard/store-postgres.ts";
import {
  DevStoreUnavailable,
  type DevDeliveryRecord,
  type DevEndpointRecord,
  type DevKeyRecord,
  type DevNetwork,
  type DevProjectRecord,
  type DevStore,
  type DevWrite,
} from "./store.ts";

const PROJECT_COLUMNS = "id, team_id, network, name, created_by, created_at, version";
const KEY_COLUMNS = "id, project_id, environment, kind, name, secret_hash, scopes, origins, state, created_by, created_at, last_used_at, expires_at, revoked_at, rotated_to";
const ENDPOINT_COLUMNS = "id, project_id, environment, url, events, enabled, secret, previous_secret, previous_until, created_by, created_at";
const DELIVERY_COLUMNS = "id, project_id, endpoint_id, event, at, state, attempts, status, error";

type ProjectRow = { id: string; team_id: string; network: DevNetwork; name: string; created_by: string; created_at: Date; version: string | number };
type KeyRow = {
  id: string;
  project_id: string;
  environment: DevKeyRecord["environment"];
  kind: DevKeyRecord["kind"];
  name: string;
  secret_hash: string | null;
  scopes: string[];
  origins: string[];
  state: DevKeyRecord["state"];
  created_by: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  rotated_to: string | null;
};
type EndpointRow = {
  id: string;
  project_id: string;
  environment: DevEndpointRecord["environment"];
  url: string;
  events: string[];
  enabled: boolean;
  secret: string;
  previous_secret: string | null;
  previous_until: Date | null;
  created_by: string;
  created_at: Date;
};
type DeliveryRow = { id: string; project_id: string; endpoint_id: string; event: DevDeliveryRecord["event"]; at: Date; state: DevDeliveryRecord["state"]; attempts: number; status: number | null; error: string | null };

const project = (row: ProjectRow): DevProjectRecord => ({
  id: row.id,
  teamId: row.team_id,
  network: row.network,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  version: Number(row.version),
});

const key = (row: KeyRow): DevKeyRecord => ({
  id: row.id,
  projectId: row.project_id,
  environment: row.environment,
  kind: row.kind,
  name: row.name,
  secretHash: row.secret_hash,
  scopes: row.scopes as DevKeyRecord["scopes"],
  origins: row.origins,
  state: row.state,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
  expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  rotatedTo: row.rotated_to,
});

const endpoint = (row: EndpointRow): DevEndpointRecord => ({
  id: row.id,
  projectId: row.project_id,
  environment: row.environment,
  url: row.url,
  events: row.events as DevEndpointRecord["events"],
  enabled: row.enabled,
  secret: row.secret,
  previousSecret: row.previous_secret,
  previousUntil: row.previous_until ? row.previous_until.toISOString() : null,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const delivery = (row: DeliveryRow): DevDeliveryRecord => ({
  id: row.id,
  projectId: row.project_id,
  endpointId: row.endpoint_id,
  event: row.event,
  at: row.at.toISOString(),
  state: row.state,
  attempts: row.attempts,
  status: row.status,
  error: row.error,
});

const codeOf = (error: unknown): string | null => (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null);

/** Any failure after start-up is the store not answering — never a crash, never «no project». */
async function reach<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DevStoreUnavailable) throw error;
    throw new DevStoreUnavailable("UNREACHABLE", "The console store did not answer.", { cause: error });
  }
}

async function writeKey(client: PoolClient, row: DevKeyRecord): Promise<void> {
  await client.query(
    `INSERT INTO dev_keys (${KEY_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, scopes = EXCLUDED.scopes, origins = EXCLUDED.origins, state = EXCLUDED.state,
       last_used_at = EXCLUDED.last_used_at, expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at, rotated_to = EXCLUDED.rotated_to`,
    [row.id, row.projectId, row.environment, row.kind, row.name, row.secretHash, [...row.scopes], [...row.origins], row.state, row.createdBy, row.createdAt, row.lastUsedAt, row.expiresAt, row.revokedAt, row.rotatedTo],
  );
}

async function writeEndpoint(client: PoolClient, row: DevEndpointRecord): Promise<void> {
  await client.query(
    `INSERT INTO dev_endpoints (${ENDPOINT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, events = EXCLUDED.events, enabled = EXCLUDED.enabled, secret = EXCLUDED.secret,
       previous_secret = EXCLUDED.previous_secret, previous_until = EXCLUDED.previous_until`,
    [row.id, row.projectId, row.environment, row.url, [...row.events], row.enabled, row.secret, row.previousSecret, row.previousUntil, row.createdBy, row.createdAt],
  );
}

export function createPostgresDevStore(options: { connectionString: string }): DevStore {
  const pool = new Pool(postgresGuardPoolConfig({ connectionString: options.connectionString }));
  /* An idle connection the server closed is dropped by the pool and reopened on the next query; unheard, it would
     end the process. */
  pool.on("error", () => undefined);
  let ready: Promise<void> | null = null;
  function ensureReady(): Promise<void> {
    ready ??= (async () => {
      await pool.query(`SELECT ${PROJECT_COLUMNS} FROM dev_projects LIMIT 0`);
      await pool.query(`SELECT ${KEY_COLUMNS} FROM dev_keys LIMIT 0`);
      await pool.query(`SELECT ${ENDPOINT_COLUMNS} FROM dev_endpoints LIMIT 0`);
      await pool.query(`SELECT ${DELIVERY_COLUMNS} FROM dev_deliveries LIMIT 0`);
      await pool.query("SELECT project_id, environment, window_key, calls FROM dev_usage LIMIT 0");
      await pool.query("SELECT endpoint_id, delivery_id, at FROM dev_seen LIMIT 0");
    })().catch((error: unknown) => {
      ready = null;
      /* 42P01 undefined_table, 42703 undefined_column: the migration has not run (or not this one). */
      const code = codeOf(error);
      if (code === "42P01" || code === "42703") throw new DevStoreUnavailable("NOT_PROVISIONED", "The developer console tables are not provisioned; apply the DEV-2 migration first.", { cause: error });
      throw new DevStoreUnavailable("UNREACHABLE", "The console store did not answer.", { cause: error });
    });
    return ready;
  }

  async function transaction(work: (client: PoolClient) => Promise<boolean>): Promise<boolean> {
    await ensureReady();
    const client = await reach(() => pool.connect());
    try {
      await client.query("BEGIN");
      const done = await work(client);
      await client.query(done ? "COMMIT" : "ROLLBACK");
      return done;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof DevStoreUnavailable) throw error;
      throw new DevStoreUnavailable("UNREACHABLE", "The console store did not answer.", { cause: error });
    } finally {
      client.release();
    }
  }

  return {
    durability: "DURABLE_MULTI_WRITER",
    async create(record) {
      return transaction(async (client) => {
        const inserted = await client.query(`INSERT INTO dev_projects (${PROJECT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`, [
          record.id,
          record.teamId,
          record.network,
          record.name,
          record.createdBy,
          record.createdAt,
          record.version,
        ]);
        return inserted.rowCount === 1;
      });
    },
    async read(id) {
      return reach(async () => {
        await ensureReady();
        const projects = await pool.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM dev_projects WHERE id = $1`, [id]);
        if (projects.rowCount !== 1) return null;
        const keys = await pool.query<KeyRow>(`SELECT ${KEY_COLUMNS} FROM dev_keys WHERE project_id = $1 ORDER BY created_at, id`, [id]);
        const endpoints = await pool.query<EndpointRow>(`SELECT ${ENDPOINT_COLUMNS} FROM dev_endpoints WHERE project_id = $1 ORDER BY created_at, id`, [id]);
        return { project: project(projects.rows[0]), keys: keys.rows.map(key), endpoints: endpoints.rows.map(endpoint) };
      });
    },
    async byTeam(network, teamId) {
      return reach(async () => {
        await ensureReady();
        const rows = await pool.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM dev_projects WHERE network = $1 AND team_id = $2 ORDER BY created_at, id`, [network, teamId]);
        return rows.rows.map(project);
      });
    },
    async commit(id, expectedVersion, writes) {
      return transaction(async (client) => {
        const moved = await client.query("UPDATE dev_projects SET version = version + 1 WHERE id = $1 AND version = $2", [id, expectedVersion]);
        if (moved.rowCount !== 1) return false;
        for (const write of writes) await applyWrite(client, id, write);
        return true;
      });
    },
    async key(id) {
      return reach(async () => {
        await ensureReady();
        const rows = await pool.query<KeyRow>(`SELECT ${KEY_COLUMNS} FROM dev_keys WHERE id = $1`, [id]);
        return rows.rowCount === 1 ? key(rows.rows[0]) : null;
      });
    },
    async touchKey(id, at) {
      /* A read that answered is not undone by a failure to note that it answered. */
      try {
        await ensureReady();
        await pool.query("UPDATE dev_keys SET last_used_at = $2 WHERE id = $1", [id, at]);
      } catch {
        /* left unrecorded on purpose */
      }
    },
    async consume(projectId, environment, windows) {
      return reach(async () => {
        await ensureReady();
        const counts = { minute: 0, day: 0, month: 0 } as Record<DevQuotaWindow, number>;
        for (const [window, value] of Object.entries(windows) as [DevQuotaWindow, string][]) {
          const row = await pool.query<{ calls: string }>(
            `INSERT INTO dev_usage (project_id, environment, window_key, calls) VALUES ($1, $2, $3, 1)
             ON CONFLICT (project_id, environment, window_key) DO UPDATE SET calls = dev_usage.calls + 1 RETURNING calls::text AS calls`,
            [projectId, environment as DevEnvironment, value],
          );
          counts[window] = Number(row.rows[0]?.calls ?? 0);
        }
        return counts;
      });
    },
    async usage(projectId, environment, windows) {
      return reach(async () => {
        await ensureReady();
        const counts = { minute: 0, day: 0, month: 0 } as Record<DevQuotaWindow, number>;
        const rows = await pool.query<{ window_key: string; calls: string }>("SELECT window_key, calls::text AS calls FROM dev_usage WHERE project_id = $1 AND environment = $2 AND window_key = ANY($3)", [
          projectId,
          environment as DevEnvironment,
          Object.values(windows),
        ]);
        for (const [window, value] of Object.entries(windows) as [DevQuotaWindow, string][]) counts[window] = Number(rows.rows.find((row) => row.window_key === value)?.calls ?? 0);
        return counts;
      });
    },
    async recordDelivery(row, keep) {
      await reach(async () => {
        await ensureReady();
        await pool.query(`INSERT INTO dev_deliveries (${DELIVERY_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`, [
          row.id,
          row.projectId,
          row.endpointId,
          row.event,
          row.at,
          row.state,
          row.attempts,
          row.status,
          row.error,
        ]);
        await pool.query("DELETE FROM dev_deliveries WHERE project_id = $1 AND id NOT IN (SELECT id FROM dev_deliveries WHERE project_id = $1 ORDER BY at DESC, id DESC LIMIT $2)", [row.projectId, keep]);
      });
    },
    async deliveries(projectId, limit) {
      return reach(async () => {
        await ensureReady();
        const rows = await pool.query<DeliveryRow>(`SELECT ${DELIVERY_COLUMNS} FROM dev_deliveries WHERE project_id = $1 ORDER BY at DESC, id DESC LIMIT $2`, [projectId, limit]);
        return rows.rows.map(delivery);
      });
    },
    async markSeen(endpointId, deliveryId, at, keepSeconds) {
      return reach(async () => {
        await ensureReady();
        await pool.query("DELETE FROM dev_seen WHERE at < $1::timestamptz - make_interval(secs => $2)", [at, keepSeconds]);
        /* The primary key decides, not a read before a write: two copies of one delivery race and one loses. */
        const inserted = await pool.query("INSERT INTO dev_seen (endpoint_id, delivery_id, at) VALUES ($1, $2, $3) ON CONFLICT (endpoint_id, delivery_id) DO NOTHING", [endpointId, deliveryId, at]);
        return inserted.rowCount === 1;
      });
    },
  };
}

async function applyWrite(client: PoolClient, id: string, write: DevWrite): Promise<void> {
  if (write.kind === "key") return writeKey(client, write.key);
  if (write.kind === "endpoint") return writeEndpoint(client, write.endpoint);
  if (write.kind === "endpointRemove") {
    await client.query("DELETE FROM dev_endpoints WHERE project_id = $1 AND id = $2", [id, write.endpointId]);
    return;
  }
  await client.query("UPDATE dev_projects SET name = $2 WHERE id = $1", [id, write.name]);
}
