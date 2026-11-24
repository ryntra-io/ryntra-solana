// Run from repo root: node --test lib/guard/store-postgres.test.mjs
//
// The behavioural tests here need a real Postgres and are skipped without one.
// Set DATABASE_URL (or POSTGRES_URL) to a throwaway database and they run:
//
//   Set the database URL in the process environment, then run this file with
//   `node --test lib/guard/store-postgres.test.mjs`.
//
// They are skipped rather than mocked on purpose. The whole value of this
// adapter is a guarantee the database makes — ON CONFLICT DO NOTHING deciding a
// race — and a mock would assert that the code calls the query it was written
// to call, which proves nothing about whether the guarantee holds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPostgresGuardStore, postgresGuardPoolConfig } from "./store-postgres.ts";
import { storeSupportsConcurrentInstances, storeSurvivesColdStart } from "./store.ts";
import { needsDevelopmentRepository } from "../development-repository.mjs";

const connectionString = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
const live = Boolean(connectionString);

function syntheticPostgresUrl(authorityAndPath) {
  return ["postgresql", "://", authorityAndPath].join("");
}

test("the adapter refuses an empty connection string instead of degrading", () => {
  assert.throws(() => createPostgresGuardStore({ connectionString: "   " }), /connection string/i);
});

test("ordinary Postgres requests validate a pre-provisioned schema and never execute DDL", { skip: needsDevelopmentRepository("the environment example .env.example") }, () => {
  const source = readFileSync(new URL("./store-postgres.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CREATE\s+TABLE/i);
  assert.match(source, /SELECT collection, key, value FROM/);
  const environmentGuide = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  assert.match(environmentGuide, /guard_objects table must be provisioned/i);
  assert.doesNotMatch(environmentGuide, /creates its own table|needs no migration/i);
});

test("the Node-only pg driver is traceable while instrumentation stays runtime-pure", () => {
  const source = readFileSync(new URL("./store-postgres.ts", import.meta.url), "utf8");
  assert.match(source, /import\s+\{\s*Pool,\s*type PoolConfig\s*\}\s+from\s+["']pg["']/);
  assert.doesNotMatch(source, /process\.getBuiltinModule\("node:module"\)/);

  const instrumentation = readFileSync(new URL("../../instrumentation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(instrumentation, /guard\/runtime|store-postgres|from\s+["']pg["']/);
});

test("remote Postgres TLS cannot be weakened by URL or pool overrides", () => {
  for (const sslmode of ["disable", "no-verify", "require"]) {
    const config = postgresGuardPoolConfig({
      connectionString: syntheticPostgresUrl(
        `user:secret@db.example/guard?application_name=ryntra&sslmode=${sslmode}`,
      ),
      // Untyped JavaScript can bypass the TypeScript omission; runtime order
      // must still keep these security-owned values authoritative.
      poolConfig: {
        max: 9,
        ssl: false,
        connectionString: syntheticPostgresUrl("attacker.invalid/other"),
      },
    });
    assert.equal(config.max, 9);
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
    assert.match(config.connectionString, /^postgresql:\/\/user:secret@db\.example\/guard/);
    assert.match(config.connectionString, /application_name=ryntra/);
    assert.doesNotMatch(config.connectionString, /sslmode|attacker\.invalid/);
  }
  const local = postgresGuardPoolConfig({
    connectionString: syntheticPostgresUrl("user@localhost/guard?sslmode=disable"),
  });
  assert.equal(local.ssl, undefined);
  assert.match(local.connectionString, /sslmode=disable/);
  assert.throws(
    () => postgresGuardPoolConfig({ connectionString: "https://localhost/guard" }),
    /postgres:\/\/ or postgresql:\/\//i,
  );
});

test("the adapter declares the only durability that satisfies a multi-instance deployment", () => {
  /* Constructing a pool performs no I/O, so this holds without a database.
     The declaration is what the write gate reads, so it is worth pinning. */
  const store = createPostgresGuardStore({
    connectionString: syntheticPostgresUrl("user@localhost/none"),
  });
  assert.equal(store.durability, "DURABLE_MULTI_WRITER");
  assert.equal(storeSurvivesColdStart(store), true);
  assert.equal(storeSupportsConcurrentInstances(store), true);
  return store.close?.();
});

test(
  "a live database round-trips every collection operation",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    const store = createPostgresGuardStore({ connectionString });
    const tenant = `tenant_${Date.now().toString(36)}`;
    try {
      const intents = store.collection("intents");
      await intents.set(`${tenant}:int_1`, { id: "int_1", revision: 1 });

      assert.deepEqual(await intents.get(`${tenant}:int_1`), { id: "int_1", revision: 1 });
      assert.equal(await intents.has(`${tenant}:int_1`), true);
      assert.equal(await intents.has(`${tenant}:missing`), false);
      assert.equal(await intents.get(`${tenant}:missing`), undefined);

      // set is an upsert; the second write wins.
      await intents.set(`${tenant}:int_1`, { id: "int_1", revision: 2 });
      assert.deepEqual(await intents.get(`${tenant}:int_1`), { id: "int_1", revision: 2 });

      await intents.delete(`${tenant}:int_1`);
      assert.equal(await intents.has(`${tenant}:int_1`), false);
    } finally {
      await store.close?.();
    }
  },
);

test(
  "concurrent claims of one key resolve to exactly one winner",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    /* This is the guarantee the adapter exists for. Twenty simultaneous claims
       of one transaction hash must produce one true and nineteen false, and the
       stored value must be the winner's — not the last writer's. Read-then-write
       would produce twenty trues here, which is how one authorized broadcast
       becomes twenty recorded executions. */
    const store = createPostgresGuardStore({ connectionString });
    const tenant = `tenant_${Date.now().toString(36)}_race`;
    const key = `${tenant}:eip155:8453:0xabc`;
    try {
      const index = store.collection("transactionIndex");
      const claims = await Promise.all(
        Array.from({ length: 20 }, (_, i) => index.insertIfAbsent(key, `int_${i}`)),
      );
      assert.equal(claims.filter(Boolean).length, 1);

      const winnerIndex = claims.indexOf(true);
      assert.equal(await index.get(key), `int_${winnerIndex}`);
    } finally {
      await store.close?.();
    }
  },
);

test(
  "overlapping live Postgres batch claims are atomic with no loser residue",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    const store = createPostgresGuardStore({ connectionString });
    const stamp = Date.now().toString(36);
    const txKey = `eip155:8453:0xbatch${stamp}`;
    const batches = [
      [
        { key: txKey, value: `${stamp}:int_a` },
        { key: `intent:${stamp}:int_a`, value: txKey },
      ],
      [
        { key: txKey, value: `${stamp}:int_b` },
        { key: `intent:${stamp}:int_b`, value: txKey },
      ],
    ];
    try {
      const index = store.collection("transactionIndex");
      const results = await Promise.all(batches.map((batch) => index.insertAllIfAbsent(batch)));
      assert.equal(results.filter(Boolean).length, 1);

      const winner = results.indexOf(true);
      const loser = winner === 0 ? 1 : 0;
      assert.equal(await index.get(txKey), batches[winner][0].value);
      assert.equal(await index.get(batches[winner][1].key), txKey);
      assert.equal(await index.get(batches[loser][1].key), undefined);
    } finally {
      await store.close?.();
    }
  },
);

test(
  "two independent store instances share state, which is what multi-writer means",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    /* Two instances with no shared process memory — the same situation as two
       serverless functions serving consecutive requests from one caller. */
    const first = createPostgresGuardStore({ connectionString });
    const second = createPostgresGuardStore({ connectionString });
    const tenant = `tenant_${Date.now().toString(36)}_shared`;
    try {
      await first.collection("intents").set(`${tenant}:int_1`, { id: "int_1" });
      assert.deepEqual(await second.collection("intents").get(`${tenant}:int_1`), { id: "int_1" });

      // And a claim made on one instance is honoured on the other.
      assert.equal(
        await second.collection("intents").insertIfAbsent(`${tenant}:int_1`, { id: "other" }),
        false,
      );
    } finally {
      await first.close?.();
      await second.close?.();
    }
  },
);

test(
  "a prefix scan never crosses a tenant boundary, even with SQL wildcards in the id",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    /* `%` and `_` are wildcards in LIKE. An unescaped tenant id containing one
       would silently widen the scan into other tenants' rows — a tenancy
       breach that reads as a working query. */
    const store = createPostgresGuardStore({ connectionString });
    const stamp = Date.now().toString(36);
    try {
      const intents = store.collection("intents");
      await intents.set(`t${stamp}a:int_1`, { id: "int_1" });
      await intents.set(`t${stamp}b:int_2`, { id: "int_2" });

      // `_` matches any single character, so this prefix would match both rows
      // if the adapter did not escape it.
      assert.deepEqual(await intents.valuesWithPrefix(`t${stamp}_:`), []);
      assert.deepEqual(await intents.valuesWithPrefix(`t${stamp}a:`), [{ id: "int_1" }]);
    } finally {
      await store.close?.();
    }
  },
);

test(
  "a prefix delete never crosses its prefix or its collection, and takes %, _ and \\ literally",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    /* The relay removes a minute's rate counts in one DELETE … LIKE. A wildcard or a backslash in the prefix must stay a
       character, the minute `60000` must not take the minute `600000`, and no
       other collection may be reached — the method refuses every collection
       but the rate counts. */
    const store = createPostgresGuardStore({ connectionString });
    const p = `d${Date.now().toString(36)}:`;
    try {
      const counts = store.collection("privacyRelayQuotas");
      const intents = store.collection("intents");
      for (const key of [`${p}60000:a`, `${p}60000:b`, `${p}600000:x`, `${p}60000%:b`, `${p}60000_:c`, `${p}60000\\:d`, `${p}60000\\\\:e`]) {
        await counts.set(key, { key });
      }
      await intents.set(`${p}60000:z`, { z: true });

      assert.equal(await counts.deleteWithPrefix(`${p}60000:`), 2, "the minute's two rows");
      assert.deepEqual(await counts.get(`${p}600000:x`), { key: `${p}600000:x` }, "the prefix ends where it ends");
      assert.equal(await counts.deleteWithPrefix(`${p}60000%`), 1, "% is a character");
      assert.equal(await counts.deleteWithPrefix(`${p}60000_`), 1, "_ is a character");
      assert.equal(await counts.deleteWithPrefix(`${p}60000\\\\`), 1, "two backslashes are two characters");
      assert.equal(await counts.deleteWithPrefix(`${p}60000\\`), 1, "one backslash is one character");
      assert.deepEqual((await counts.valuesWithPrefix(p)).map((row) => row.key), [`${p}600000:x`]);
      await assert.rejects(counts.deleteWithPrefix(""), TypeError, "never the whole collection");
      await assert.rejects(intents.deleteWithPrefix(p), TypeError, "never another collection");
      assert.deepEqual(await intents.get(`${p}60000:z`), { z: true });
      assert.equal(await counts.deleteWithPrefix(p), 1);
    } finally {
      await store.close?.();
    }
  },
);

test(
  "a rate count steps in one statement: parallel steps from two pools are each counted once and never pass the limit",
  { skip: live ? false : "set DATABASE_URL to run the live Postgres tests" },
  async () => {
    /* The relay's limit counts a person's parallel calls: with a
       read and a compare-and-set, eight at once lost rounds and were refused.
       One INSERT … ON CONFLICT DO UPDATE … WHERE used < limit decides each step
       under the row's lock. */
    const one = createPostgresGuardStore({ connectionString });
    const two = createPostgresGuardStore({ connectionString });
    const p = `c${Date.now().toString(36)}:`;
    const counts = [one, two].map((store) => store.versioned("privacyRelayQuotas"));
    try {
      // Eight at once, thirty times, each time in a new window: every step counted, none refused or retried.
      for (let window = 0; window < 30; window += 1) {
        const steps = await Promise.all(Array.from({ length: 8 }, (_, i) => counts[i % 2].countStep(`${p}k`, { by: 1, windowStartMs: window, limit: 300 })));
        assert.deepEqual([...steps].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], `window ${window}`);
      }
      // Fifty at once against a limit of thirty: exactly thirty pass, the rest find it full and write nothing.
      const steps = await Promise.all(Array.from({ length: 50 }, (_, i) => counts[i % 2].countStep(`${p}full`, { by: 1, windowStartMs: 60_000, limit: 30 })));
      assert.equal(steps.filter((used) => used !== null).length, 30);
      assert.equal((await counts[0].get(`${p}full`)).used, 30);
      // Down: one less in its window, never in another, never below zero.
      assert.equal(await counts[0].countStep(`${p}full`, { by: -1, windowStartMs: 60_000 }), 29);
      assert.equal(await counts[0].countStep(`${p}full`, { by: -1, windowStartMs: 120_000 }), null);
      assert.equal(await counts[0].countStep(`${p}none`, { by: -1, windowStartMs: 60_000 }), null);
      // Another window starts over at one.
      assert.equal(await counts[1].countStep(`${p}full`, { by: 1, windowStartMs: 120_000, limit: 30 }), 1);
      assert.deepEqual(await counts[0].get(`${p}full`), { version: 31, windowStartMs: 120_000, used: 1, key: `${p}full` });
      // A value that is no count throws; another collection refuses.
      await counts[0].set(`${p}bad`, { version: 0, windowStartMs: 60_000, used: "x" });
      await assert.rejects(counts[0].countStep(`${p}bad`, { by: 1, windowStartMs: 60_000, limit: 5 }));
      await assert.rejects(one.versioned("intents").countStep(`${p}k`, { by: 1, windowStartMs: 0, limit: 5 }), TypeError);
    } finally {
      await counts[0].deleteWithPrefix(p).catch(() => undefined);
      await one.close?.();
      await two.close?.();
    }
  },
);
