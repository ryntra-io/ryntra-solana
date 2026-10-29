// EXE-2 on a real Postgres: the races decided by the database, and the migration's refusals.
//
// Skipped without a database. With DATABASE_URL (or POSTGRES_URL) naming a throwaway database whose guard_objects
// table exists, the race tests run through two separate stores — two pools, as two instances would be. The migration's
// tests also need RYNTRA_ACTION_LEDGER_PG_TEST=apply-migration: they apply
// supabase/prepared/20261025_exe_2_action_ledger_v1.sql to that database, so never point them at production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import pg from "pg";

import { createPostgresGuardStore } from "../../guard/store-postgres.ts";
import { defineBudget, openAction, readAction, readBudget, reserveBudget } from "./ledger.ts";
import { ACTION_COLLECTIONS, eventKey } from "./model.ts";

const connectionString = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
const live = Boolean(connectionString);
const migrate = live && process.env.RYNTRA_ACTION_LEDGER_PG_TEST === "apply-migration";
const SKIP_LIVE = live ? false : "set DATABASE_URL to run the live Postgres tests";
const SKIP_MIGRATION = migrate ? false : "set DATABASE_URL and RYNTRA_ACTION_LEDGER_PG_TEST=apply-migration (a throwaway database)";

const NOW = "2026-10-25T10:00:00.000Z";
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAYER = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5";
const RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const run = Date.now().toString(36);
const org = `org_pg_${run}`;

const send = (idempotencyKey) => ({
  cluster: "devnet", authorityId: "solana.send", mode: "ASSISTED", orgId: org, actor: { kind: "TEAM_MEMBER", id: PAYER },
  venue: "solana", programIds: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], spend: { mint: USDC, decimals: 6, amountRaw: "25000000" }, recipient: RECIPIENT, idempotencyKey, now: NOW,
});

async function withStores(count, body) {
  const stores = Array.from({ length: count }, () => createPostgresGuardStore({ connectionString }));
  try {
    return await body(stores);
  } finally {
    await Promise.all(stores.map((store) => store.close?.()));
  }
}

test("two instances opening one key: one action in the database, both told its id", { skip: SKIP_LIVE }, async () => {
  await withStores(2, async ([left, right]) => {
    const [a, b] = await Promise.all([openAction(left, send(`pg-open-${run}`)), openAction(right, send(`pg-open-${run}`))]);
    assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
    assert.equal(a.action.actionId, b.action.actionId);
    assert.equal((await readAction(left, a.action.actionId)).events.length, 1);
  });
});

test("eight instances reserving a budget that fits three: three hold it, the database never passes the limit", { skip: SKIP_LIVE }, async () => {
  await withStores(8, async (stores) => {
    const budgetId = `${org}:race`;
    assert.equal((await defineBudget(stores[0], { budgetId, orgId: org, ownerId: org, limit: { mint: USDC, decimals: 6, amountRaw: "75000000" }, now: NOW })).ok, true);
    const ids = [];
    for (let index = 0; index < 8; index += 1) ids.push((await openAction(stores[index], send(`pg-res-${run}-${index}`))).action.actionId);
    const reserve = async (store, actionId) => {
      for (let round = 0; round < 10; round += 1) {
        const result = await reserveBudget(store, { actionId, budgetId, now: NOW });
        if (result.ok || result.code !== "LEDGER_CONTENDED") return result;
      }
      throw new Error("still contended");
    };
    const results = await Promise.all(ids.map((actionId, index) => reserve(stores[index], actionId)));
    assert.equal(results.filter((result) => result.ok).length, 3);
    assert.equal(results.filter((result) => result.code === "BUDGET_REFUSED").length, 5);
    assert.equal((await readBudget(stores[0], budgetId)).reservedRaw, "75000000");
  });
});

test("the migration: the database refuses to rewrite or delete an event, and to pass a budget's limit", { skip: SKIP_MIGRATION }, async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(readFileSync(new URL("../../../supabase/prepared/20261025_exe_2_action_ledger_v1.sql", import.meta.url), "utf8"));
    /* Twice: the file is safe to run again. */
    await client.query(readFileSync(new URL("../../../supabase/prepared/20261025_exe_2_action_ledger_v1.sql", import.meta.url), "utf8"));
    await withStores(1, async ([store]) => {
      const opened = await openAction(store, send(`pg-mig-${run}`));
      assert.equal(opened.ok, true);
      const key = eventKey(opened.action.actionId, 1);
      await assert.rejects(client.query("UPDATE guard_objects SET value = value || '{\"type\":\"CANCELLED\"}' WHERE collection = $1 AND key = $2", [ACTION_COLLECTIONS.events, key]), /written once/);
      await assert.rejects(client.query("DELETE FROM guard_objects WHERE collection = $1 AND key = $2", [ACTION_COLLECTIONS.events, key]), /written once/);
      await assert.rejects(store.collection(ACTION_COLLECTIONS.events).set(key, { forged: true }), /written once/, "the store's own upsert is refused too");
      await assert.rejects(client.query("UPDATE guard_objects SET collection = $1 WHERE collection = $2 AND key = $3", [ACTION_COLLECTIONS.events, ACTION_COLLECTIONS.intents, opened.action.actionId]), /written once/);
      await assert.rejects(client.query("DELETE FROM guard_objects WHERE collection = $1 AND key LIKE $2", [ACTION_COLLECTIONS.idempotency, `org:${org}:%`]), /written once/);
      assert.equal((await readAction(store, opened.action.actionId)).chain, "INTACT");

      const budgetId = `${org}:check`;
      await defineBudget(store, { budgetId, orgId: org, ownerId: org, limit: { mint: USDC, decimals: 6, amountRaw: "100" }, now: NOW });
      await assert.rejects(
        client.query("UPDATE guard_objects SET value = jsonb_set(value, '{reservedRaw}', '\"101\"') WHERE collection = $1 AND key = $2", [ACTION_COLLECTIONS.budgets, budgetId]),
        /guard_objects_action_budget_within_limit/,
      );
      await assert.rejects(
        client.query("UPDATE guard_objects SET value = jsonb_set(value, '{spentRaw}', '\"1.5\"') WHERE collection = $1 AND key = $2", [ACTION_COLLECTIONS.budgets, budgetId]),
        /guard_objects_action_budget_within_limit/,
      );
      /* Other collections are untouched by the trigger: an ordinary Guard row still updates. */
      await store.collection("intents").set(`pg-${run}:probe`, { ok: 1 });
      await store.collection("intents").set(`pg-${run}:probe`, { ok: 2 });
      await store.collection("intents").delete(`pg-${run}:probe`);
    });
  } finally {
    await client.end();
  }
});
