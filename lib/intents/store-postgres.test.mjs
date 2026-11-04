// Run from repo root: node --test lib/intents/store-postgres.test.mjs
//
// Prepared actions against a real Postgres: set RYNTRA_INTENTS_TEST_DATABASE_URL to a throwaway database the CITY-161
// migration (db/migrations/20261031120000_city_161_intents.sql) ran on, as a role that may create databases. Each test
// gets its own copy of it (CREATE DATABASE … TEMPLATE), dropped at the end. Skipped without one. Never DATABASE_URL:
// these tests make and drop databases.
//
// They are not mocked: what they prove is the database's own guarantees — the version's compare-and-set, the unique
// signature, and the trigger that keeps an intent's frozen fields and a receipted row as they were, whatever wrote it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import pg from "pg";

import { PAY_MINTS } from "./model.ts";
import { cancelIntent, claimIntent, createIntent, markIntent, readIntent, receiptIntent, releaseIntent } from "./service.ts";
import { createPostgresIntentStore } from "./store-postgres.server.ts";
import { IntentStoreUnavailable } from "./store.ts";

const connectionString = process.env.RYNTRA_INTENTS_TEST_DATABASE_URL?.trim();
const skip = connectionString ? false : "set RYNTRA_INTENTS_TEST_DATABASE_URL to a throwaway database with the CITY-161 migration";

const PERSON = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const FRIEND = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
const SIG = "3vZ8sRkd2kN9mEJcVJbW7K1yC6p8oQGJ4fH2Lr9aT5XqBnU8wYeD3sP6mZ1cR4tV7hK9jN2gF5xL8bQ3dW6eA1s";
const TRANSFER = { action: "transfer", coin: PAY_MINTS.USDC, amountRaw: "25000000", to: FRIEND };
const AGENT = { kind: "agent", name: "Atlas" };

/** Signed bytes as the test's reader sees them (the real ed25519 reader is tested in `signed.test.mjs`). */
const signedBy = (payer, signature) => `signed:${payer}:${signature}`;
const readSigned = (wire) => {
  const [tag, feePayer, signature] = String(wire).split(":");
  return tag === "signed" && feePayer && signature ? { ok: true, feePayer, signature } : { ok: false, reason: "not signed" };
};
const mark = (deps, record, wallet = PERSON, signature = SIG, replaces = null) =>
  markIntent(deps, record.body.id, { digest: record.digest, wallet, signedWireBase64: signedBy(wallet, signature), replaces });

const made = [];
const pools = [];

async function fresh({ migrated = true } = {}) {
  const template = new URL(connectionString);
  const name = `intents_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: template.toString() });
  await admin.connect();
  try {
    await admin.query(migrated ? `CREATE DATABASE ${name} TEMPLATE ${pg.escapeIdentifier(template.pathname.slice(1))}` : `CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  made.push(name);
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

function depsOn(url, { now = () => new Date(), chain = null } = {}) {
  const store = createPostgresIntentStore({ connectionString: url });
  return { store, now, newId: () => randomBytes(16).toString("base64url"), newKey: () => randomBytes(24).toString("base64url"), chain, transfers: true, readSigned };
}

async function sql(url, text, values = []) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

after(async () => {
  for (const pool of pools) await pool.end().catch(() => undefined);
  if (!connectionString || made.length === 0) return;
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  try {
    for (const name of made) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

test("the whole life on Postgres: made, claimed, released, claimed again, receipted, and never again", { skip }, async () => {
  const url = await fresh();
  const deps = depsOn(url);
  const created = await createIntent(deps, { spec: TRANSFER, origin: AGENT });
  assert.equal(created.ok, true);
  const { id } = created.record.body;
  const step = { digest: created.record.digest, wallet: PERSON };
  assert.deepEqual((await readIntent(deps, id)).record, created.record);
  assert.equal((await claimIntent(deps, id, step)).status, "CLAIMED");
  assert.equal((await releaseIntent(deps, id, step)).status, "OPEN");
  assert.equal((await claimIntent(deps, id, step)).status, "CLAIMED");
  assert.equal((await mark(deps, created.record)).record.claim.signature, SIG);
  assert.equal((await releaseIntent(deps, id, step)).code, "INTENT_SENT");
  assert.equal((await claimIntent(deps, id, step)).record.claim.signature, SIG);
  const done = await receiptIntent(deps, id, { ...step, signature: SIG });
  assert.equal(done.status, "DONE");
  assert.equal(done.record.version, 5);
  assert.equal(done.record.receipt.chain, "UNCHECKED");
  assert.equal((await claimIntent(deps, id, step)).code, "INTENT_USED");
  assert.equal((await claimIntent(deps, id, { ...step, wallet: OTHER })).code, "INTENT_USED");
});

test("two instances pressing at once: the version lets exactly one claim through", { skip }, async () => {
  const url = await fresh();
  const one = depsOn(url);
  const two = depsOn(url);
  const created = await createIntent(one, { spec: TRANSFER, origin: AGENT });
  const { id } = created.record.body;
  const answers = await Promise.all([
    claimIntent(one, id, { digest: created.record.digest, wallet: PERSON }),
    claimIntent(two, id, { digest: created.record.digest, wallet: OTHER }),
  ]);
  assert.equal(answers.filter((a) => a.ok).length, 1);
  assert.equal(answers.find((a) => !a.ok).code, "INTENT_BUSY");
});

test("one signature answers one intent — the database's unique index, not a read", { skip }, async () => {
  const url = await fresh();
  const deps = depsOn(url);
  const first = await createIntent(deps, { spec: TRANSFER, origin: AGENT });
  const second = await createIntent(deps, { spec: TRANSFER, origin: AGENT });
  for (const { record } of [first, second]) {
    await claimIntent(deps, record.body.id, { digest: record.digest, wallet: PERSON });
    await mark(deps, record);
  }
  assert.equal((await receiptIntent(deps, first.record.body.id, { digest: first.record.digest, wallet: PERSON, signature: SIG })).status, "DONE");
  assert.equal((await receiptIntent(deps, second.record.body.id, { digest: second.record.digest, wallet: PERSON, signature: SIG })).code, "INTENT_RECEIPT_MISMATCH");
});

test("the trigger keeps the frozen fields and a receipted row as they were, whatever writes to the table", { skip }, async () => {
  const url = await fresh();
  const deps = depsOn(url);
  const created = await createIntent(deps, { spec: TRANSFER, origin: AGENT });
  const { id } = created.record.body;
  const body = { ...created.record.body, spec: { ...created.record.body.spec, to: OTHER } };
  await assert.rejects(sql(url, "UPDATE action_intents SET body = $2::jsonb, version = version + 1 WHERE id = $1", [id, JSON.stringify(body)]), /frozen fields/);
  await assert.rejects(sql(url, "UPDATE action_intents SET creator_key_hash = $2, version = version + 1 WHERE id = $1", [id, "0".repeat(64)]), /frozen fields/);
  await assert.rejects(sql(url, "UPDATE action_intents SET expires_at = expires_at + interval '1 hour', version = version + 1 WHERE id = $1", [id]), /frozen fields/);
  await assert.rejects(sql(url, "UPDATE action_intents SET digest = $2, version = version + 1 WHERE id = $1", [id, "0".repeat(64)]), /frozen fields/);
  await assert.rejects(sql(url, "UPDATE action_intents SET claim_wallet = $2, claim_until = now() WHERE id = $1", [id, PERSON]), /version by one/);
  // A receipt of a wallet that does not hold the claim does not fit the row's shape.
  await assert.rejects(
    sql(url, "UPDATE action_intents SET version = version + 1, receipt_wallet = $2, receipt_signature = $3, receipt_at = now(), receipt_chain = 'UNCHECKED' WHERE id = $1", [id, PERSON, SIG]),
    /action_intents_receipt_shape/,
  );
  await claimIntent(deps, id, { digest: created.record.digest, wallet: PERSON });
  // A receipt of another signature than the claim's mark does not fit the row either.
  await mark(deps, created.record, PERSON, SIG.replace(/^3/, "4"));
  await assert.rejects(
    sql(url, "UPDATE action_intents SET version = version + 1, receipt_wallet = $2, receipt_signature = $3, receipt_at = now(), receipt_chain = 'UNCHECKED' WHERE id = $1", [id, PERSON, SIG]),
    /action_intents_receipt_shape/,
  );
  await mark(deps, created.record, PERSON, SIG, SIG.replace(/^3/, "4"));
  await receiptIntent(deps, id, { digest: created.record.digest, wallet: PERSON, signature: SIG });
  await assert.rejects(sql(url, "UPDATE action_intents SET claim_wallet = NULL, claim_until = NULL, receipt_wallet = NULL, receipt_signature = NULL, receipt_at = NULL, receipt_chain = NULL, version = version + 1 WHERE id = $1", [id]), /final/);
  await assert.rejects(sql(url, "UPDATE action_intents SET cancelled_at = now(), version = version + 1 WHERE id = $1", [id]), /final/);
  // The application, reading what is there, still sees the intent it made.
  assert.equal((await readIntent(deps, id)).status, "DONE");
});

test("a deadline outside one minute to one day, or a body that names another id, does not fit the table", { skip }, async () => {
  const url = await fresh();
  const deps = depsOn(url);
  const created = await createIntent(deps, { spec: TRANSFER, origin: AGENT });
  const { body, digest } = created.record;
  const insert = ([rid, network, json, d, createdAt, expiresAt]) =>
    sql(url, "INSERT INTO action_intents (id, network, body, digest, creator_key_hash, created_at, expires_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)", [rid, network, json, d, "0".repeat(64), createdAt, expiresAt]);
  const id = randomBytes(16).toString("base64url");
  const twoDays = new Date(Date.parse(body.createdAt) + 2 * 86_400_000).toISOString();
  await assert.rejects(insert([id, body.network, JSON.stringify({ ...body, id, expiresAt: twoDays }), digest, body.createdAt, twoDays]), /action_intents_window/);
  await assert.rejects(insert([id, body.network, JSON.stringify(body), digest, body.createdAt, body.expiresAt]), /action_intents_check/);
  // A body with its keys missing does not pass as NULL; a body whose times are not the row's does not fit.
  await assert.rejects(insert([id, body.network, JSON.stringify({}), digest, body.createdAt, body.expiresAt]), /action_intents_check/);
  const { schema: _schema, ...noSchema } = { ...body, id };
  await assert.rejects(insert([id, body.network, JSON.stringify(noSchema), digest, body.createdAt, body.expiresAt]), /action_intents_check/);
  await assert.rejects(insert([id, body.network, JSON.stringify({ ...body, id }), digest, body.createdAt, new Date(Date.parse(body.expiresAt) + 60_000).toISOString()]), /action_intents_times/);
});

test("before the migration the store says NOT_PROVISIONED — never «not found»", { skip }, async () => {
  const url = await fresh({ migrated: false });
  const deps = depsOn(url);
  await assert.rejects(deps.store.read("A".repeat(22)), (error) => error instanceof IntentStoreUnavailable && error.reason === "NOT_PROVISIONED");
  assert.equal((await readIntent(deps, "A".repeat(22))).code, "CAPABILITY_UNAVAILABLE");
});

test("withdrawn by its creator, bound to its wallet and counted: the same on Postgres", { skip }, async () => {
  const url = await fresh();
  const deps = depsOn(url);
  const bound = await createIntent(deps, { spec: TRANSFER, origin: AGENT, for: PERSON });
  const { id } = bound.record.body;
  assert.equal((await readIntent(deps, id)).record.body.for, PERSON);
  assert.equal(await deps.store.openFor(PERSON, new Date()), 1);
  assert.equal((await claimIntent(deps, id, { digest: bound.record.digest, wallet: OTHER })).code, "INTENT_WRONG_WALLET");
  assert.equal((await cancelIntent(deps, id, "z".repeat(32))).code, "INTENT_KEY_INVALID");
  assert.equal((await cancelIntent(deps, id, bound.creatorKey)).status, "CANCELLED");
  assert.equal(await deps.store.openFor(PERSON, new Date()), 0);
  assert.equal((await claimIntent(deps, id, { digest: bound.record.digest, wallet: PERSON })).code, "INTENT_CANCELLED");
  // A withdrawn row is final too: nothing writes a claim or a receipt into it.
  await assert.rejects(sql(url, "UPDATE action_intents SET claim_wallet = $2, claim_until = now(), version = version + 1 WHERE id = $1", [id, PERSON]), /final/);
  // The body's own `for` and the row's must agree.
  const other = randomBytes(16).toString("base64url");
  await assert.rejects(
    sql(url, "INSERT INTO action_intents (id, network, body, digest, for_wallet, creator_key_hash, created_at, expires_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)", [
      other, "solana:mainnet", JSON.stringify({ ...bound.record.body, id: other }), bound.record.digest, OTHER, "0".repeat(64), bound.record.body.createdAt, bound.record.body.expiresAt,
    ]),
    /action_intents_check/,
  );
});
