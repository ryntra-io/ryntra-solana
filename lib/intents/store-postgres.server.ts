/**
 * Prepared actions on Postgres (CITY-161): the one table of `db/migrations/20261031120000_city_161_intents.sql`, in
 * the database `DATABASE_URL` names — the same one `guard_objects`, the team and the developer tables live in, over
 * the same verified-TLS pool settings (`postgresGuardPoolConfig`). Requests never run DDL: the shape is checked once
 * per process with a `LIMIT 0` read, and until the migration has run every call throws
 * `IntentStoreUnavailable("NOT_PROVISIONED")` — never «not found».
 *
 * A change is one statement: it applies only while the version is still the one it was decided on. The table's own
 * trigger refuses any change to the frozen fields or to a receipted row, and a unique index refuses a signature that
 * already answers another intent.
 *
 * Server only.
 */

import { Pool } from "pg";

import { postgresGuardPoolConfig } from "../guard/store-postgres.ts";
import type { IntentBody, IntentRecord, ReceiptChain } from "./model.ts";
import { IntentStoreUnavailable, type IntentChange, type IntentStore, type UpdateResult } from "./store.ts";

const COLUMNS = "id, body, digest, creator_key_hash, version, claim_wallet, claim_until, claim_signature, receipt_wallet, receipt_signature, receipt_at, receipt_chain, cancelled_at";

type Row = {
  id: string;
  body: IntentBody;
  digest: string;
  creator_key_hash: string;
  version: string | number;
  claim_wallet: string | null;
  claim_until: Date | null;
  claim_signature: string | null;
  receipt_wallet: string | null;
  receipt_signature: string | null;
  receipt_at: Date | null;
  receipt_chain: ReceiptChain | null;
  cancelled_at: Date | null;
};

const recordOf = (row: Row): IntentRecord => ({
  body: row.body,
  digest: row.digest,
  creatorKeyHash: row.creator_key_hash,
  version: Number(row.version),
  claim: row.claim_wallet && row.claim_until ? { wallet: row.claim_wallet, until: row.claim_until.toISOString(), signature: row.claim_signature } : null,
  receipt:
    row.receipt_wallet && row.receipt_signature && row.receipt_at && row.receipt_chain
      ? { wallet: row.receipt_wallet, signature: row.receipt_signature, at: row.receipt_at.toISOString(), chain: row.receipt_chain }
      : null,
  cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
});

const codeOf = (error: unknown): string | null => (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null);
const constraintOf = (error: unknown): string | null =>
  typeof error === "object" && error !== null && typeof (error as { constraint?: unknown }).constraint === "string" ? (error as { constraint: string }).constraint : null;

export function createPostgresIntentStore(options: Readonly<{ connectionString: string }>): IntentStore {
  const pool = new Pool(postgresGuardPoolConfig({ connectionString: options.connectionString }));
  /* An idle connection the server closed is dropped by the pool and reopened on the next query; unheard, it would
     end the process. */
  pool.on("error", () => undefined);
  let ready: Promise<void> | null = null;

  function ensureReady(): Promise<void> {
    ready ??= (async () => {
      await pool.query(`SELECT ${COLUMNS} FROM action_intents LIMIT 0`);
    })().catch((error: unknown) => {
      ready = null;
      /* 42P01 undefined_table, 42703 undefined_column: the migration has not run (or not this one). */
      const code = codeOf(error);
      if (code === "42P01" || code === "42703") throw new IntentStoreUnavailable("NOT_PROVISIONED", "The intents table is not provisioned; apply the CITY-161 migration first.");
      throw new IntentStoreUnavailable("UNREACHABLE", "The intents store did not answer.");
    });
    return ready;
  }

  async function query<T extends Record<string, unknown>>(text: string, values: readonly unknown[]): Promise<T[]> {
    await ensureReady();
    try {
      const result = await pool.query<T>(text, [...values]);
      return result.rows;
    } catch (error) {
      if (error instanceof IntentStoreUnavailable) throw error;
      throw Object.assign(new IntentStoreUnavailable("UNREACHABLE", "The intents store did not answer."), { cause: error, pgCode: codeOf(error), pgConstraint: constraintOf(error) });
    }
  }

  return {
    durability: "DURABLE_MULTI_WRITER",

    async insert(record) {
      const { body } = record;
      const rows = await query<{ id: string }>(
        `INSERT INTO action_intents (id, network, body, digest, for_wallet, creator_key_hash, created_at, expires_at, version)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 0)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [body.id, body.network, JSON.stringify(body), record.digest, body.for, record.creatorKeyHash, body.createdAt, body.expiresAt],
      );
      return rows.length === 1;
    },

    async read(id) {
      const rows = await query<Row>(`SELECT ${COLUMNS} FROM action_intents WHERE id = $1`, [id]);
      return rows[0] ? recordOf(rows[0]) : null;
    },

    async update(id: string, expected: number, change: IntentChange): Promise<UpdateResult> {
      try {
        const rows = await query<Row>(
          `UPDATE action_intents
              SET version = version + 1,
                  claim_wallet = $3, claim_until = $4, claim_signature = $10,
                  receipt_wallet = $5, receipt_signature = $6, receipt_at = $7, receipt_chain = $8,
                  cancelled_at = $9
            WHERE id = $1 AND version = $2
          RETURNING ${COLUMNS}`,
          [
            id,
            expected,
            change.claim?.wallet ?? null,
            change.claim?.until ?? null,
            change.receipt?.wallet ?? null,
            change.receipt?.signature ?? null,
            change.receipt?.at ?? null,
            change.receipt?.chain ?? null,
            change.cancelledAt,
            change.claim?.signature ?? null,
          ],
        );
        return rows[0] ? { ok: true, record: recordOf(rows[0]) } : { ok: false, reason: "VERSION" };
      } catch (error) {
        /* 23505 unique_violation on the signature index: the signature already answers another intent. */
        const details = error as { pgCode?: string | null; pgConstraint?: string | null };
        if (details.pgCode === "23505" && details.pgConstraint === "action_intents_signature_idx") return { ok: false, reason: "SIGNATURE_TAKEN" };
        throw error;
      }
    },

    async openFor(wallet: string, now: Date): Promise<number> {
      const rows = await query<{ n: string | number }>(
        `SELECT count(*) AS n FROM action_intents
          WHERE for_wallet = $1 AND receipt_signature IS NULL AND cancelled_at IS NULL
            AND (claim_until > $2 OR ((claim_until IS NULL OR claim_signature IS NULL) AND expires_at > $2))`,
        [wallet, now.toISOString()],
      );
      return Number(rows[0]?.n ?? 0);
    },
  };
}
