import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  AGENT_CONTROL_SCOPES,
  AGENT_KEY_REFUSALS,
  AgentTenancyError,
  authenticateAgentKey,
  createAgentTenancy,
  parseAgentKey,
} from "./tenancy.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

function tenancy() {
  return createAgentTenancy(createMemoryGuardStore());
}

async function seeded(overrides = {}) {
  const store = createAgentTenancy(createMemoryGuardStore());
  const tenant = await store.createTenant({ displayName: "Grok", createdAtMs: NOW });
  const issued = await store.issueKey({
    tenantId: tenant.tenantId,
    label: "first",
    scopes: ["evidence:read", "proposal:write"],
    createdAtMs: NOW,
    expiresAtMs: NOW + 86_400_000,
    ...overrides,
  });
  return { store, tenant, issued };
}

/* ── the scope vocabulary, which is the whole boundary ─────────────────── */

test("no scope in the closed vocabulary can authorize, sign, execute or move value", () => {
  /*
   * The same shape the MCP write gate used for write effects, one layer out. A scope
   * that could carry authority would need a member to name it, and there is
   * none — so `scopes: ["action:execute"]` is a type error and a runtime
   * refusal, not a policy somebody has to remember to apply.
   *
   * The forbidden segments are matched per segment rather than as substrings,
   * because the MCP write gate already paid for the other version: a whole-key comparison
   * refused `authority` and let `ownerAuthority` through.
   */
  const FORBIDDEN = [
    "sign",
    "signature",
    "execute",
    "authorize",
    "authorization",
    "authority",
    "mandate",
    "approve",
    "approval",
    "transfer",
    "withdraw",
    "settle",
    "custody",
    "key",
    "wallet",
  ];
  for (const scope of AGENT_CONTROL_SCOPES) {
    for (const segment of scope.split(/[:._-]/)) {
      assert.ok(
        !FORBIDDEN.includes(segment.toLowerCase()),
        `scope ${scope} carries the segment ${segment}, which names an authority this layer must not be able to grant`,
      );
    }
  }
  assert.ok(AGENT_CONTROL_SCOPES.length >= 2);
});

test("an unknown scope is refused at issue time rather than stored and ignored", async () => {
  const store = tenancy();
  const tenant = await store.createTenant({ displayName: "Grok", createdAtMs: NOW });
  await assert.rejects(
    () =>
      store.issueKey({
        tenantId: tenant.tenantId,
        label: "bad",
        scopes: ["action:execute"],
        createdAtMs: NOW,
      }),
    (error) => error instanceof AgentTenancyError && error.reasonCode === "SCOPE_NOT_DECLARED",
  );
});

/* ── the secret, which is never stored ─────────────────────────────────── */

test("the plaintext secret appears in no stored record", async () => {
  const { store, issued } = await seeded();
  const record = await store.readKey(issued.keyId);
  const serialized = JSON.stringify(record);
  assert.ok(issued.secret.length >= 32);
  assert.ok(
    !serialized.includes(issued.secret),
    "the stored key record contains the plaintext secret",
  );
  assert.ok(!serialized.includes(issued.key), "the stored key record contains the presentable key");
  assert.match(record.secretHash, /^[0-9a-f]{64}$/);
});

test("the module never writes the secret to a log or returns it twice", () => {
  /*
   * `issueKey` is the one moment the plaintext exists. A convenience getter
   * that returned it later would make the hash decorative, so the source is
   * read from disk and checked for one.
   */
  const source = readFileSync("lib/agent-control/tenancy.ts", "utf8");
  assert.ok(!/console\.(log|info|warn|error)/.test(source), "tenancy must not log");
  assert.ok(
    !/secret\s*:\s*record\.secret\b/.test(source),
    "no read path may return a stored secret",
  );
});

/* ── verification, and each refusal by its exact reason ────────────────── */

test("a well-formed key authenticates and reports its tenant and scopes", async () => {
  const { store, tenant, issued } = await seeded();
  const decision = await authenticateAgentKey(store, issued.key, {
    nowMs: NOW + 1_000,
    requiredScopes: ["evidence:read"],
  });
  assert.equal(decision.accepted, true);
  assert.equal(decision.principal.tenantId, tenant.tenantId);
  assert.equal(decision.principal.keyId, issued.keyId);
  assert.deepEqual([...decision.principal.scopes], ["evidence:read", "proposal:write"]);
});

test("every refusal names exactly one declared reason", async () => {
  const { store, tenant, issued } = await seeded();

  const cases = [
    ["MALFORMED_KEY", "not-a-key", {}],
    ["MALFORMED_KEY", "", {}],
    ["UNKNOWN_KEY", `ryn_ac_${"0".repeat(24)}_${"a".repeat(43)}`, {}],
    ["SECRET_MISMATCH", `ryn_ac_${issued.keyId}_${"a".repeat(43)}`, {}],
    ["KEY_EXPIRED", issued.key, { nowMs: NOW + 86_400_001 }],
    ["SCOPE_NOT_GRANTED", issued.key, { requiredScopes: ["metrics:read"] }],
  ];

  for (const [expected, presented, options] of cases) {
    const decision = await authenticateAgentKey(store, presented, { nowMs: NOW, ...options });
    assert.equal(decision.accepted, false, `${expected} unexpectedly accepted`);
    assert.equal(decision.reasonCode, expected);
    assert.ok(AGENT_KEY_REFUSALS.includes(decision.reasonCode));
  }

  await store.revokeKey(issued.keyId, { revokedAtMs: NOW + 10 });
  const revoked = await authenticateAgentKey(store, issued.key, { nowMs: NOW + 20 });
  assert.equal(revoked.accepted, false);
  assert.equal(revoked.reasonCode, "KEY_REVOKED");

  const second = await seeded();
  await second.store.suspendTenant(second.tenant.tenantId, { atMs: NOW });
  const suspended = await authenticateAgentKey(second.store, second.issued.key, { nowMs: NOW + 1 });
  assert.equal(suspended.accepted, false);
  assert.equal(suspended.reasonCode, "TENANT_SUSPENDED");

  void tenant;
});

test("revocation is durable and stops the very next call", async () => {
  const { store, issued } = await seeded();
  assert.equal(
    (await authenticateAgentKey(store, issued.key, { nowMs: NOW })).accepted,
    true,
  );
  await store.revokeKey(issued.keyId, { revokedAtMs: NOW });
  const after = await authenticateAgentKey(store, issued.key, { nowMs: NOW });
  assert.equal(after.accepted, false);
  assert.equal(after.reasonCode, "KEY_REVOKED");

  /* Revoking twice is not an error and does not move the recorded moment: the
     first revocation is the one that happened. */
  await store.revokeKey(issued.keyId, { revokedAtMs: NOW + 5_000 });
  assert.equal((await store.readKey(issued.keyId)).revokedAt, new Date(NOW).toISOString());
});

/* ── parsing, which refuses before any store round trip ────────────────── */

test("a malformed key is refused without reaching the store", () => {
  for (const bad of [
    "",
    "ryn_ac_",
    "ryn_ac_short_secret",
    `ryn_xx_${"0".repeat(24)}_${"a".repeat(43)}`,
    `ryn_ac_${"0".repeat(24)}_${"a".repeat(10)}`,
    `ryn_ac_${"Z".repeat(24)}_${"a".repeat(43)}`,
  ]) {
    assert.equal(parseAgentKey(bad), null, `${bad} parsed as a key`);
  }
  const good = `ryn_ac_${"0123456789abcdef01234567"}_${"a".repeat(43)}`;
  assert.deepEqual(parseAgentKey(good), {
    keyId: "0123456789abcdef01234567",
    secret: "a".repeat(43),
  });
});

test("two keys of the same tenant are independent", async () => {
  const { store, tenant, issued } = await seeded();
  const other = await store.issueKey({
    tenantId: tenant.tenantId,
    label: "second",
    scopes: ["evidence:read"],
    createdAtMs: NOW,
  });
  assert.notEqual(other.keyId, issued.keyId);
  await store.revokeKey(issued.keyId, { revokedAtMs: NOW });
  assert.equal((await authenticateAgentKey(store, other.key, { nowMs: NOW })).accepted, true);
});

test("a key cannot be issued for a tenant that does not exist", async () => {
  const store = tenancy();
  await assert.rejects(
    () => store.issueKey({ tenantId: "ten_missing", label: "x", scopes: ["evidence:read"], createdAtMs: NOW }),
    (error) => error instanceof AgentTenancyError && error.reasonCode === "TENANT_UNKNOWN",
  );
});
