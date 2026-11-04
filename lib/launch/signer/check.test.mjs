/**
 * CITY-163 — the deployment's proof of its way into KMS: public keys read, compared, and never a signature.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { launchSignerCheck } from "./check.server.ts";
import { forgetKmsAddresses } from "./gcp-kms.server.ts";
import { STUB_TOKEN, startKmsStub, versionName } from "./kms-stub.fixture.mjs";

const OTHER = "7KUPNJRr6hmUDZXCL6AxJiHy4VYEVnEqwNkyJsbhbdKh";

async function withStub(run) {
  forgetKmsAddresses();
  const stub = await startKmsStub();
  try {
    await run(stub);
  } finally {
    await stub.close();
  }
}

function kmsEnv(stub, extra = {}) {
  const payer = versionName("pool-payer");
  const executor = versionName("executor");
  return {
    RYNTRA_LAUNCH_SIGNER: "kms",
    RYNTRA_LAUNCH_POOL_PAYER_KMS_KEY: payer,
    RYNTRA_LAUNCH_POOL_PAYER_ADDRESS: stub.addressOf(payer),
    RYNTRA_LAUNCH_EXECUTOR_KMS_KEY: executor,
    RYNTRA_LAUNCH_EXECUTOR_ADDRESS: stub.addressOf(executor),
    RYNTRA_LAUNCH_KMS_ENDPOINT: stub.endpoint,
    RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: STUB_TOKEN,
    ...extra,
  };
}

test("both keys read and equal to what the deployment names and the registry publishes: ready, and nothing was signed", async () => {
  await withStub(async (stub) => {
    const env = kmsEnv(stub);
    const registry = (role) => (role === "executor" ? env.RYNTRA_LAUNCH_EXECUTOR_ADDRESS : env.RYNTRA_LAUNCH_POOL_PAYER_ADDRESS);
    const check = await launchSignerCheck(env, registry);
    assert.equal(check.mode, "kms");
    assert.equal(check.ready, true);
    assert.deepEqual(check.roles.map((role) => [role.role, role.ready, role.error]), [["pool-payer", true, null], ["executor", true, null]]);
    assert.equal(stub.calls.length, 2);
    assert.ok(stub.calls.every((call) => call.method === "GET" && call.url.endsWith("/publicKey")), "only the public keys are asked for");
    assert.ok(!stub.calls.some((call) => call.url.includes("asymmetricSign")), "never a signature");
  });
});

test("a key that is not the one the registry publishes is not ready: the registry would refuse it on mainnet", async () => {
  await withStub(async (stub) => {
    const check = await launchSignerCheck(kmsEnv(stub), () => OTHER);
    assert.equal(check.ready, false);
    assert.ok(check.roles.every((role) => !role.ready && role.read !== null && role.error === null));
  });
});

test("a refused way in is said by its status, with no token and no body", async () => {
  await withStub(async (stub) => {
    const check = await launchSignerCheck(kmsEnv(stub, { RYNTRA_LAUNCH_KMS_ACCESS_TOKEN: "another-token" }), () => null);
    assert.equal(check.ready, false);
    for (const role of check.roles) {
      assert.equal(role.read, null);
      assert.match(role.error, /^KMS public key: 401 UNAUTHENTICATED$/);
    }
    assert.doesNotMatch(JSON.stringify(check), /another-token/);
  });
});

test("in `env` mode there is no way in to prove, and KMS is not asked", async () => {
  await withStub(async (stub) => {
    assert.deepEqual(await launchSignerCheck({ RYNTRA_LAUNCH_SIGNER: "env" }, () => null), { mode: "env", ready: false, roles: [] });
    assert.equal(stub.calls.length, 0);
  });
});

test("the route exists only with its token, and its code cannot sign", () => {
  const route = readFileSync(new URL("../../../app/api/launch/signer-check/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!expected\) return new NextResponse\(null, \{ status: 404/);
  assert.match(route, /timingSafeEqual/);
  const check = readFileSync(new URL("./check.server.ts", import.meta.url), "utf8");
  for (const source of [route, check]) assert.doesNotMatch(source, /signMessage|signTransaction|kmsKeySigner|launchKey\(|launchPoolPayer\(|launchExecutor\(/);
});
