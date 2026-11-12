// Run from repo root: node --test city/lib/arena/hack/store/ready.test.mjs
/*
 * CITY-226: when Hack answers people. Closed by default; open only when the switch says `open`; in production only on
 * the shared database, never on one instance's memory; the stand's wallet only on a developer's machine. CITY-238:
 * production opens only with the machine that plays the runs set up — the image's snapshot, the project, the stamp key.
 */
import "../../../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { HACK_ENV, HACK_FLAG, hackReady, hackStoreKind, machineSetup, standMode, standWallet } = await import("./ready.ts");

const DB = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", BETA_APP_SECRET: "secret" };
const memory = { durable: false };
const database = { durable: true };

test("the switch is the city's own name, and it is closed unless it says open", () => {
  assert.equal(HACK_FLAG, "NEXT_PUBLIC_RYNTRA_CITY_HACK");
  for (const flag of [undefined, "", "1", "true", "on", "OPEN", "closed"]) {
    assert.equal(hackReady(database, flag, "production", true), false, String(flag));
    assert.equal(hackReady(memory, flag, "development"), false, String(flag));
  }
  assert.equal(hackReady(database, " open ", "production", true), true);
});

test("production never opens on one instance's memory; a developer's machine may", () => {
  assert.equal(hackReady(memory, "open", "production", true), false);
  assert.equal(hackReady(database, "open", "production", true), true);
  assert.equal(hackReady(memory, "open", "development"), true);
  assert.equal(hackReady(memory, "open", undefined), true);
});

test("the store: the database wherever a deployment runs with its settings; memory otherwise", () => {
  assert.equal(hackStoreKind({ ...DB, NODE_ENV: "production" }), "database");
  assert.equal(hackStoreKind({ NODE_ENV: "production" }), "memory", "no settings — memory, and production stays closed");
  assert.equal(hackStoreKind({ ...DB, NODE_ENV: "development" }), "memory");
  assert.equal(hackStoreKind({ ...DB, NODE_ENV: "development", RYNTRA_HACK_STORE: "database" }), "database");
  assert.equal(hackStoreKind({ SUPABASE_URL: "x", NODE_ENV: "production" }), "memory");
});

test("the stand plays as its cookie's wallet on a developer's machine only", () => {
  const w = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  assert.equal(standWallet({ RYNTRA_HACK_STAND: "1", NODE_ENV: "development" }, w), w);
  assert.equal(standWallet({ RYNTRA_HACK_STAND: "1", NODE_ENV: "production" }, w), null);
  assert.equal(standWallet({ NODE_ENV: "development" }, w), null);
  assert.equal(standWallet({ RYNTRA_HACK_STAND: "1", NODE_ENV: "development" }, "not a wallet"), null);
  assert.equal(standWallet({ RYNTRA_HACK_STAND: "1", NODE_ENV: "development" }, undefined), null);
  // The stand itself — its wallet, its brain without a model, its machine as a process — is never production's.
  assert.equal(standMode({ RYNTRA_HACK_STAND: "1", NODE_ENV: "development" }), true);
  assert.equal(standMode({ RYNTRA_HACK_STAND: "1" }), true);
  assert.equal(standMode({ RYNTRA_HACK_STAND: "1", NODE_ENV: "production" }), false);
  assert.equal(standMode({ RYNTRA_HACK_STAND: "true", NODE_ENV: "development" }), false);
  assert.equal(standMode({ NODE_ENV: "development" }), false);
});

test("production opens only with the machine that plays the runs: a sandbox with no network, and the stamp key", () => {
  assert.equal(hackReady(database, "open", "production"), false, "no word on the machine — closed");
  assert.equal(hackReady(database, "open", "production", false), false);
  assert.equal(hackReady(database, "open", "production", true), true);
  assert.equal(hackReady(memory, "open", "development", false), true, "a developer's stand plays on its own machine");

  const full = { [HACK_ENV.snapshot]: "snap_CF21o8TSsjpa3KUV8l9kFE83Dcuw", [HACK_ENV.project]: "prj_abc123", [HACK_ENV.team]: "team_abc123", [HACK_ENV.stamp]: "the harness key, as PEM" };
  assert.deepEqual(machineSetup(full), { ready: true, missing: [], snapshotId: "snap_CF21o8TSsjpa3KUV8l9kFE83Dcuw", projectId: "prj_abc123", teamId: "team_abc123" });
  assert.deepEqual(machineSetup({}).missing, [HACK_ENV.snapshot, HACK_ENV.project, HACK_ENV.stamp]);
  assert.equal(machineSetup({}).ready, false);
  // The deployment's own project stands in for a named one; a snapshot that does not read as one is none.
  const own = machineSetup({ ...full, [HACK_ENV.project]: undefined, VERCEL_PROJECT_ID: "prj_own" });
  assert.equal(own.ready, true);
  assert.equal(own.projectId, "prj_own");
  assert.deepEqual(machineSetup({ ...full, [HACK_ENV.snapshot]: "latest" }).missing, [HACK_ENV.snapshot]);
  assert.deepEqual(machineSetup({ ...full, [HACK_ENV.stamp]: "  " }).missing, [HACK_ENV.stamp]);
});
