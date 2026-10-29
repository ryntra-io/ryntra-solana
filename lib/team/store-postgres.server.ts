/**
 * The team store on Postgres (TEAM-1): the three tables of `db/migrations/20261025120000_team_1_roles.sql`, in the
 * database `DATABASE_URL` names — the same one `guard_objects` lives in, over the same verified-TLS pool settings
 * (`postgresGuardPoolConfig`). Requests never run DDL: the shape is checked once per process with `LIMIT 0` reads, and
 * until the migration has run every call throws `TeamStoreUnavailable("NOT_PROVISIONED")` — never an empty list.
 *
 * A commit is one transaction: the team's version moves from the one the change was decided on (or nothing is
 * written), then the members, then the journal rows. The database's own deferred trigger refuses a team left
 * without an active Owner, whatever the caller did.
 *
 * Server only.
 */

import { Pool, type PoolClient } from "pg";

import { postgresGuardPoolConfig } from "../guard/store-postgres.ts";
import type { TeamJournalRecord, TeamMemberRecord, TeamNetwork, TeamRecord, TeamStore, TeamWrite } from "./store.ts";
import { TeamStoreUnavailable } from "./store.ts";

type OrgRow = { id: string; network: TeamNetwork; name: string; kind: TeamRecord["kind"]; treasury: string | null; created_by: string; created_at: Date; version: string | number };
type MemberRow = { team_id: string; wallet: string; role: TeamMemberRecord["role"]; status: TeamMemberRecord["status"]; label: string | null; invited_by: string; invited_at: Date; joined_at: Date | null };
type JournalRow = { team_id: string; at: Date; actor: string; action: TeamJournalRecord["action"]; subject: string | null; role: TeamJournalRecord["role"]; previous_role: TeamJournalRecord["previousRole"] };

const ORG_COLUMNS = "id, network, name, kind, treasury, created_by, created_at, version";
const MEMBER_COLUMNS = "team_id, wallet, role, status, label, invited_by, invited_at, joined_at";

const team = (row: OrgRow): TeamRecord => ({
  id: row.id,
  network: row.network,
  name: row.name,
  kind: row.kind,
  treasury: row.treasury,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  version: Number(row.version),
});

const member = (row: MemberRow): TeamMemberRecord => ({
  teamId: row.team_id,
  wallet: row.wallet,
  role: row.role,
  status: row.status,
  label: row.label,
  invitedBy: row.invited_by,
  invitedAt: row.invited_at.toISOString(),
  joinedAt: row.joined_at ? row.joined_at.toISOString() : null,
});

const journalRow = (row: JournalRow): TeamJournalRecord => ({
  teamId: row.team_id,
  at: row.at.toISOString(),
  actor: row.actor,
  action: row.action,
  subject: row.subject,
  role: row.role,
  previousRole: row.previous_role,
});

async function insertMember(client: PoolClient, row: TeamMemberRecord): Promise<void> {
  await client.query(
    `INSERT INTO team_members (${MEMBER_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (team_id, wallet) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, label = EXCLUDED.label, invited_by = EXCLUDED.invited_by, invited_at = EXCLUDED.invited_at, joined_at = EXCLUDED.joined_at`,
    [row.teamId, row.wallet, row.role, row.status, row.label, row.invitedBy, row.invitedAt, row.joinedAt],
  );
}

async function insertJournal(client: PoolClient, rows: readonly TeamJournalRecord[]): Promise<void> {
  for (const row of rows) {
    await client.query("INSERT INTO team_journal (team_id, at, actor, action, subject, role, previous_role) VALUES ($1, $2, $3, $4, $5, $6, $7)", [row.teamId, row.at, row.actor, row.action, row.subject, row.role, row.previousRole]);
  }
}

/** A Postgres error code, when the driver gave one. */
const codeOf = (error: unknown): string | null => (typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null);

/** The migration's own refusal of a team left without an active Owner — named, so no other CHECK reads as it. */
const OWNER_RULE = "team_keeps_an_owner";
const isOwnerRule = (error: unknown) => codeOf(error) === "23514" && (error as { constraint?: unknown }).constraint === OWNER_RULE;

/** Any other failure after start-up is the store not answering — never a crash, never «no team». */
async function reach<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TeamStoreUnavailable || isOwnerRule(error)) throw error;
    throw new TeamStoreUnavailable("UNREACHABLE", "The team store did not answer.", { cause: error });
  }
}

export function createPostgresTeamStore(options: { connectionString: string }): TeamStore {
  const pool = new Pool(postgresGuardPoolConfig({ connectionString: options.connectionString }));
  /* An idle connection the server closed is dropped by the pool and reopened on the next query; unheard, it would
     end the process. */
  pool.on("error", () => undefined);
  let ready: Promise<void> | null = null;
  function ensureReady(): Promise<void> {
    ready ??= (async () => {
      await pool.query(`SELECT ${ORG_COLUMNS} FROM team_orgs LIMIT 0`);
      await pool.query(`SELECT ${MEMBER_COLUMNS} FROM team_members LIMIT 0`);
      await pool.query("SELECT team_id, at, actor, action, subject, role, previous_role FROM team_journal LIMIT 0");
    })().catch((error: unknown) => {
      ready = null;
      /* 42P01 undefined_table, 42703 undefined_column: the migration has not run (or not this one). */
      const code = codeOf(error);
      if (code === "42P01" || code === "42703") throw new TeamStoreUnavailable("NOT_PROVISIONED", "The team tables are not provisioned; apply the TEAM-1 migration first.", { cause: error });
      throw new TeamStoreUnavailable("UNREACHABLE", "The team store did not answer.", { cause: error });
    });
    return ready;
  }

  /** One transaction: committed when the work answers true, rolled back when it answers false or throws. */
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
      if (error instanceof TeamStoreUnavailable || isOwnerRule(error)) throw error;
      throw new TeamStoreUnavailable("UNREACHABLE", "The team store did not answer.", { cause: error });
    } finally {
      client.release();
    }
  }

  async function readTeam(id: string) {
    await ensureReady();
    const orgs = await pool.query<OrgRow>(`SELECT ${ORG_COLUMNS} FROM team_orgs WHERE id = $1`, [id]);
    if (orgs.rowCount !== 1) return null;
    const members = await pool.query<MemberRow>(`SELECT ${MEMBER_COLUMNS} FROM team_members WHERE team_id = $1 ORDER BY invited_at, wallet`, [id]);
    return { team: team(orgs.rows[0]), members: members.rows.map(member) };
  }

  async function readMemberships(network: TeamNetwork, wallet: string) {
    await ensureReady();
    const rows = await pool.query<OrgRow & { m_role: MemberRow["role"]; m_status: MemberRow["status"]; m_label: string | null; m_invited_by: string; m_invited_at: Date; m_joined_at: Date | null }>(
      `SELECT o.id, o.network, o.name, o.kind, o.treasury, o.created_by, o.created_at, o.version,
              m.role AS m_role, m.status AS m_status, m.label AS m_label, m.invited_by AS m_invited_by, m.invited_at AS m_invited_at, m.joined_at AS m_joined_at
         FROM team_members m JOIN team_orgs o ON o.id = m.team_id
        WHERE m.wallet = $1 AND o.network = $2
        ORDER BY o.created_at, o.id`,
      [wallet, network],
    );
    return rows.rows.map((row) => ({
      team: team(row),
      member: member({ team_id: row.id, wallet, role: row.m_role, status: row.m_status, label: row.m_label, invited_by: row.m_invited_by, invited_at: row.m_invited_at, joined_at: row.m_joined_at }),
    }));
  }

  return {
    durability: "DURABLE_MULTI_WRITER",
    async create(record, owner, journal) {
      return transaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO team_orgs (${ORG_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
          [record.id, record.network, record.name, record.kind, record.treasury, record.createdBy, record.createdAt, record.version],
        );
        if (inserted.rowCount !== 1) return false;
        await insertMember(client, owner);
        await insertJournal(client, [journal]);
        return true;
      });
    },
    async read(id) {
      return reach(() => readTeam(id));
    },
    async memberships(network, wallet) {
      return reach(() => readMemberships(network, wallet));
    },
    async createdBy(network, wallet) {
      return reach(async () => {
        await ensureReady();
        const rows = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM team_orgs WHERE network = $1 AND created_by = $2", [network, wallet]);
        return Number(rows.rows[0]?.count ?? 0);
      });
    },
    async journal(id, limit) {
      return reach(async () => {
        await ensureReady();
        const rows = await pool.query<JournalRow>("SELECT team_id, at, actor, action, subject, role, previous_role FROM team_journal WHERE team_id = $1 ORDER BY id DESC LIMIT $2", [id, limit]);
        return rows.rows.map(journalRow);
      });
    },
    async commit(id, expectedVersion, writes, journal) {
      try {
        return await transaction(async (client) => {
          const moved = await client.query("UPDATE team_orgs SET version = version + 1 WHERE id = $1 AND version = $2", [id, expectedVersion]);
          if (moved.rowCount !== 1) return false;
          for (const write of writes) await applyWrite(client, id, write);
          await insertJournal(client, journal);
          /* The deferred Owner trigger runs here; a refusal is a change this team cannot take. */
          await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          return true;
        });
      } catch (error) {
        if (isOwnerRule(error)) return false;
        throw error;
      }
    },
  };
}

async function applyWrite(client: PoolClient, id: string, write: TeamWrite): Promise<void> {
  if (write.kind === "member") return insertMember(client, write.member);
  if (write.kind === "remove") {
    await client.query("DELETE FROM team_members WHERE team_id = $1 AND wallet = $2", [id, write.wallet]);
    return;
  }
  if (write.name !== undefined) await client.query("UPDATE team_orgs SET name = $2 WHERE id = $1", [id, write.name]);
  if (write.treasury !== undefined) await client.query("UPDATE team_orgs SET treasury = $2 WHERE id = $1", [id, write.treasury]);
}
