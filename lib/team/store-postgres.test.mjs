// Run from repo root: node --test lib/team/store-postgres.test.mjs
//
// The team suite against a real Postgres: set RYNTRA_TEAM_TEST_DATABASE_URL to a
// throwaway database the TEAM-1 migration ran on
// (db/migrations/20261025120000_team_1_roles.sql), as a role that may create
// databases. Each test gets its own copy of it (CREATE DATABASE … TEMPLATE),
// dropped at the end. Skipped without one. Never DATABASE_URL: these tests make
// and drop databases.
//
// They are not mocked: what they prove is the database's own guarantees — the
// version's compare-and-set inside one transaction, the deferred Owner trigger
// and the append-only journal.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import pg from "pg";

import { createPostgresTeamStore } from "./store-postgres.server.ts";
import { TeamStoreUnavailable } from "./store.ts";
import { OWNER, depsOf, teamSuite } from "./suite.fixture.mjs";
import { createTeam } from "./service.server.ts";

const connectionString = process.env.RYNTRA_TEAM_TEST_DATABASE_URL?.trim();
const skip = connectionString ? false : "set RYNTRA_TEAM_TEST_DATABASE_URL to a throwaway database with the TEAM-1 migration";

const made = [];

/** A fresh copy of the migrated template: every test starts from no team. */
async function freshUrl() {
  const template = new URL(connectionString);
  const name = `team_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: template.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${pg.escapeIdentifier(template.pathname.slice(1))}`);
  } finally {
    await admin.end();
  }
  made.push(name);
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

after(async () => {
  if (!connectionString || made.length === 0) return;
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  try {
    for (const name of made) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

if (connectionString) teamSuite("postgres", async () => createPostgresTeamStore({ connectionString: await freshUrl() }));

test("postgres: the journal is append-only and a team never stands without an active Owner", { skip }, async () => {
  const url = await freshUrl();
  const deps = depsOf(createPostgresTeamStore({ connectionString: url }));
  const team = await createTeam(deps, { wallet: OWNER, name: "Journal", kind: "SOLO_CREATOR" });
  assert.equal(team.ok, true);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await assert.rejects(client.query("UPDATE team_journal SET actor = actor WHERE team_id = $1", [team.state.team.id]), /append-only/);
    await assert.rejects(client.query("DELETE FROM team_journal WHERE team_id = $1", [team.state.team.id]), /append-only/);
    await assert.rejects(client.query("UPDATE team_members SET role = 'ADMIN' WHERE team_id = $1", [team.state.team.id]), /without an active Owner/);
    await assert.rejects(client.query("INSERT INTO team_orgs (id, network, name, kind, created_by) VALUES ($1, 'solana:mainnet', 'Empty', 'SOLO_CREATOR', $2)", ["f".repeat(24), OWNER]), /without an active Owner/);
  } finally {
    await client.end();
  }
});

test("postgres: a database without the migration is NOT_PROVISIONED, never an empty list", { skip }, async () => {
  /* The same server, a schema search path where the tables are not. */
  const url = new URL(await freshUrl());
  url.searchParams.set("options", "-c search_path=pg_catalog");
  const store = createPostgresTeamStore({ connectionString: url.toString() });
  await assert.rejects(store.memberships("solana:mainnet", OWNER), (error) => error instanceof TeamStoreUnavailable && error.reason === "NOT_PROVISIONED");
});
