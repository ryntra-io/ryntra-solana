// Run from repo root: node --test app/health/route.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

/* The Solana product's health answer, tested on its own. It answers through the
   kernel's envelope — a correlation id on a private, uncached body — and
   carries no marker of another product. */

test("health discloses the Solana service and the persistence actually configured", async () => {
  const { GET: health } = await import("./route.ts");
  const response = await health(
    new Request("https://ryntra.test/health", { headers: { "x-correlation-id": "corr_health_001" } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-correlation-id"), "corr_health_001");
  assert.equal(response.headers.get("x-ryntra-prototype"), null);
  /* Under `node --test` no store is configured, so the honest answer is the
     ephemeral one — and a reviewer must be able to read that from /health
     rather than infer it. */
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "ryntra",
    network: "SOLANA_MAINNET",
    persistence: "EPHEMERAL_SINGLE_INSTANCE",
    persistenceDetail: "in-process memory (demo only; lost on cold start)",
    deployment: "SINGLE_INSTANCE",
    stateChangesAccepted: true,
  });
});

test("behind several instances without a multi-writer store, health says state changes are refused", async () => {
  /* The runtime is cached per process, so the deployment shape is swapped and
     the cache cleared around this test. */
  const previousDeployment = process.env.RYNTRA_GUARD_DEPLOYMENT;
  const previousRuntime = globalThis.__ryntraGuardPrototypeRuntime;
  process.env.RYNTRA_GUARD_DEPLOYMENT = "multi-instance";
  delete globalThis.__ryntraGuardPrototypeRuntime;
  try {
    const { GET: health } = await import("./route.ts");
    const body = await (await health(new Request("https://ryntra.test/health"))).json();
    assert.equal(body.deployment, "MULTI_INSTANCE");
    assert.equal(body.stateChangesAccepted, false);
  } finally {
    if (previousDeployment === undefined) delete process.env.RYNTRA_GUARD_DEPLOYMENT;
    else process.env.RYNTRA_GUARD_DEPLOYMENT = previousDeployment;
    if (previousRuntime === undefined) delete globalThis.__ryntraGuardPrototypeRuntime;
    else globalThis.__ryntraGuardPrototypeRuntime = previousRuntime;
  }
});
