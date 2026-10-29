// Run from repo root: node --test lib/developer/store-postgres.test.mjs
//
// The console suite against a real Postgres: set RYNTRA_DEV_TEST_DATABASE_URL to a
// throwaway database both migrations ran on — TEAM-1
// (db/migrations/20261025120000_team_1_roles.sql, because a project belongs to a
// team) and DEV-2 (db/migrations/20261026120000_dev_2_console.sql) — as a role
// that may create databases. Each test gets its own copy of it
// (CREATE DATABASE … TEMPLATE), dropped at the end. Skipped without one. Never
// DATABASE_URL: these tests make and drop databases.
//
// They are not mocked: what they prove is the database's own guarantees — the
// version's compare-and-set inside one transaction, the counter that two
// instances may add to at once, the primary key that refuses a replayed
// delivery, and the CHECK that holds a credential's shape whatever wrote the row.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import pg from "pg";

import { createPostgresDevStore } from "./store-postgres.server.ts";
import { DevStoreUnavailable } from "./store.ts";
import { OWNER, TEAM, depsOf, devSuite, seed } from "./suite.fixture.mjs";
import { authenticateKey } from "./service.server.ts";

const connectionString = process.env.RYNTRA_DEV_TEST_DATABASE_URL?.trim();
const skip = connectionString ? false : "set RYNTRA_DEV_TEST_DATABASE_URL to a throwaway database with the TEAM-1 and DEV-2 migrations";

const made = [];

/** A fresh copy of the migrated template, with the one team the suite's projects belong to. */
async function freshUrl() {
  const template = new URL(connectionString);
  const name = `dev_test_${randomBytes(6).toString("hex")}`;
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
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO team_orgs (id, network, name, kind, created_by, created_at) VALUES ($1, 'solana:mainnet', 'Суїта', 'PROJECT_TEAM', $2, now())", [TEAM, OWNER]);
    await client.query("INSERT INTO team_members (team_id, wallet, role, status, invited_by, invited_at, joined_at) VALUES ($1, $2, 'OWNER', 'ACTIVE', $2, now(), now())", [TEAM, OWNER]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
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

if (connectionString) devSuite("postgres", async () => createPostgresDevStore({ connectionString: await freshUrl() }));

test("postgres: the database holds a credential's shape, whatever wrote the row", { skip }, async () => {
  const url = await freshUrl();
  const deps = depsOf(createPostgresDevStore({ connectionString: url }));
  const { projectId } = await seed(deps);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const insert = (id, kind, hash, origins) =>
      client.query("INSERT INTO dev_keys (id, project_id, environment, kind, name, secret_hash, scopes, origins, state, created_by, created_at) VALUES ($1, $2, 'live', $3, 'x', $4, '{read:key}', $5, 'ACTIVE', $6, now())", [
        id,
        projectId,
        kind,
        hash,
        origins,
        OWNER,
      ]);
    /* A secret key with an origin, a public key with a secret, and a public key with no origin: each refused. */
    await assert.rejects(insert(`rsk_live_${"a".repeat(43)}`, "SECRET", "a".repeat(64), ["https://a.example.com"]), /dev_keys_credential_shape/);
    await assert.rejects(insert(`rpk_live_${"b".repeat(43)}`, "PUBLIC", "b".repeat(64), ["https://a.example.com"]), /dev_keys_credential_shape/);
    await assert.rejects(insert(`rpk_live_${"c".repeat(43)}`, "PUBLIC", null, []), /dev_keys_credential_shape/);
    /* And an id whose prefix disagrees with the row it is in. */
    await assert.rejects(insert(`rpk_live_${"d".repeat(43)}`, "SECRET", "d".repeat(64), []), /dev_keys_id_matches_row/);
    /* A project of a team that is not there has nowhere to belong. */
    await assert.rejects(client.query("INSERT INTO dev_projects (id, team_id, network, name, created_by, created_at) VALUES ($1, $2, 'solana:mainnet', 'Orphan', $3, now())", ["f".repeat(24), "e".repeat(24), OWNER]), /dev_projects_team_id_fkey/);
  } finally {
    await client.end();
  }
});

test("postgres: a delivery id is taken once, by the primary key rather than by a read", { skip }, async () => {
  const url = await freshUrl();
  const store = createPostgresDevStore({ connectionString: url });
  const deps = depsOf(store);
  const { endpoint } = await seed(deps);
  const id = "a1b2".repeat(8);
  const at = new Date().toISOString();
  /* Two copies arriving at once: both ask, and exactly one is told it is new. */
  const answers = await Promise.all([store.markSeen(endpoint.endpoint.id, id, at, 1_200), store.markSeen(endpoint.endpoint.id, id, at, 1_200)]);
  assert.deepEqual(answers.slice().sort(), [false, true]);
  assert.equal(await store.markSeen(endpoint.endpoint.id, id, at, 1_200), false);
});

test("postgres: a quota counter adds one per call, whoever adds it", { skip }, async () => {
  const url = await freshUrl();
  const store = createPostgresDevStore({ connectionString: url });
  const deps = depsOf(store, { quota: { minute: null, day: null, month: null } });
  const { secret } = await seed(deps);
  await Promise.all(Array.from({ length: 12 }, () => authenticateKey(deps, { token: secret.issued.secret, scope: "read:key", origin: null })));
  const answer = await authenticateKey(deps, { token: secret.issued.secret, scope: "read:key", origin: null });
  assert.equal(answer.ok, true);
  assert.equal(answer.principal.quota.find((row) => row.window === "day").used, 13, "no call is lost to another instance's write");
});

test("postgres: a database without the migration is NOT_PROVISIONED, never an empty list", { skip }, async () => {
  /* The same server, a schema search path where the tables are not. */
  const url = new URL(await freshUrl());
  url.searchParams.set("options", "-c search_path=pg_catalog");
  const store = createPostgresDevStore({ connectionString: url.toString() });
  await assert.rejects(store.read("0".repeat(24)), (error) => error instanceof DevStoreUnavailable && error.reason === "NOT_PROVISIONED");
  await assert.rejects(store.key(`rsk_live_${"a".repeat(43)}`), (error) => error instanceof DevStoreUnavailable && error.reason === "NOT_PROVISIONED");
});
