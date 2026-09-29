import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { FixedWindowLimiter } from "../http-control.ts";
import {
  AGENT_QUOTA_POLICIES,
  QuotaUnavailableError,
  consumeAgentQuota,
  createAgentQuotaMeter,
  quotaPolicyFor,
} from "./quota.ts";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

test("a quota consumed on one instance is already spent on another", async () => {
  /*
   * This is the whole reason the counter moved. `consumeAgentControlRequest`
   * is a module-level `FixedWindowLimiter`: two warm instances each hold their
   * own, so a caller gets the limit twice and a cold start hands it back. The
   * durable meter is two independent objects over one store, which is exactly
   * what two Vercel instances are.
   */
  const store = createMemoryGuardStore();
  const instanceA = createAgentQuotaMeter(store);
  const instanceB = createAgentQuotaMeter(store);
  const policy = { limit: 3, windowSeconds: 60 };

  const first = await instanceA.consume({ principal: "tenant:t1", policy, nowMs: NOW });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 2);

  const second = await instanceB.consume({ principal: "tenant:t1", policy, nowMs: NOW + 10 });
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 1, "the second instance did not see the first instance's use");

  const third = await instanceA.consume({ principal: "tenant:t1", policy, nowMs: NOW + 20 });
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const fourth = await instanceB.consume({ principal: "tenant:t1", policy, nowMs: NOW + 30 });
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.remaining, 0);
  assert.equal(fourth.limit, 3);
});

test("the in-process limiter fails the same check, which is why it was replaced", () => {
  /* The claim above is only interesting if the thing it replaced really does
     hand out the limit twice. Two limiters, same key, same window. */
  const a = new FixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 10 });
  const b = new FixedWindowLimiter({ limit: 3, windowMs: 60_000, maxKeys: 10 });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(a.consume("tenant:t1").allowed, true);
    assert.equal(b.consume("tenant:t1").allowed, true);
  }
  assert.equal(a.consume("tenant:t1").allowed, false);
  /* Six requests served against a limit of three. */
});

test("a new window resets the count and reports when it does", async () => {
  const meter = createAgentQuotaMeter(createMemoryGuardStore());
  const policy = { limit: 1, windowSeconds: 60 };
  const first = await meter.consume({ principal: "tenant:t2", policy, nowMs: NOW });
  assert.equal(first.allowed, true);
  assert.equal(first.resetAtMs, Math.floor(NOW / 60_000) * 60_000 + 60_000);

  const blocked = await meter.consume({ principal: "tenant:t2", policy, nowMs: NOW + 1_000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, Math.ceil((first.resetAtMs - (NOW + 1_000)) / 1_000));

  const nextWindow = await meter.consume({ principal: "tenant:t2", policy, nowMs: first.resetAtMs });
  assert.equal(nextWindow.allowed, true);
  assert.equal(nextWindow.remaining, 0);
});

test("two principals do not share a window", async () => {
  const meter = createAgentQuotaMeter(createMemoryGuardStore());
  const policy = { limit: 1, windowSeconds: 60 };
  assert.equal((await meter.consume({ principal: "tenant:a", policy, nowMs: NOW })).allowed, true);
  assert.equal((await meter.consume({ principal: "tenant:b", policy, nowMs: NOW })).allowed, true);
  assert.equal((await meter.consume({ principal: "tenant:a", policy, nowMs: NOW })).allowed, false);
});

test("a store that cannot be read refuses rather than allowing", async () => {
  /*
   * A quota that degrades to "allow" when its backend is down is not a quota:
   * the one moment it matters most is the moment infrastructure is unhealthy.
   * The refusal is a distinct code so an operator can tell it apart from a
   * caller who really did run out.
   */
  const broken = {
    durability: "DURABLE_MULTI_WRITER",
    description: "broken",
    collection() {
      throw new Error("store unavailable");
    },
    versioned() {
      return {
        async get() {
          throw new Error("store unavailable");
        },
        async insertIfAbsent() {
          throw new Error("store unavailable");
        },
        async compareAndSet() {
          throw new Error("store unavailable");
        },
        async set() {},
        async insertAllIfAbsent() {
          return false;
        },
        async delete() {},
        async has() {
          return false;
        },
        async valuesWithPrefix() {
          return [];
        },
      };
    },
    async compareAndSetMany() {
      return false;
    },
  };
  const meter = createAgentQuotaMeter(broken);
  await assert.rejects(
    () => meter.consume({ principal: "tenant:x", policy: { limit: 5, windowSeconds: 60 }, nowMs: NOW }),
    (error) => error instanceof QuotaUnavailableError,
  );
});

test("sustained contention gives up honestly instead of retrying forever", async () => {
  const store = createMemoryGuardStore();
  const versioned = store.versioned;
  let calls = 0;
  const contended = {
    ...store,
    versioned(name) {
      const inner = versioned.call(store, name);
      return {
        ...inner,
        async compareAndSet() {
          calls += 1;
          return false;
        },
      };
    },
  };
  const meter = createAgentQuotaMeter(contended);
  const policy = { limit: 5, windowSeconds: 60 };
  await meter.consume({ principal: "tenant:c", policy, nowMs: NOW });
  await assert.rejects(
    () => meter.consume({ principal: "tenant:c", policy, nowMs: NOW }),
    (error) => error instanceof QuotaUnavailableError && error.reasonCode === "QUOTA_CONTENDED",
  );
  assert.ok(calls >= 2 && calls <= 8, `bounded retry, got ${calls} attempts`);
});

test("policies are declared, and an anonymous caller gets the strictest one", () => {
  const anonymous = quotaPolicyFor(null);
  const tenant = quotaPolicyFor({ tenantId: "ten_x", keyId: "k", displayName: "x", scopes: ["evidence:read"] });
  assert.ok(anonymous.limit < tenant.limit, "an identified caller must be worth more than an anonymous one");
  assert.deepEqual(anonymous, AGENT_QUOTA_POLICIES.ANONYMOUS);
  assert.deepEqual(tenant, AGENT_QUOTA_POLICIES.TENANT);
});

test("the exported one-call helper reports the same decision", async () => {
  const store = createMemoryGuardStore();
  const decision = await consumeAgentQuota(store, {
    principal: "anon:198.51.100.7",
    policy: { limit: 2, windowSeconds: 60 },
    nowMs: NOW,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.limit, 2);
  assert.equal(decision.remaining, 1);
  assert.equal(decision.principal, "anon:198.51.100.7");
});
