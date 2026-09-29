// Run from repo root: node --test lib/agent-control/passport-directory.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

const { createAgentPassport } = await import("./agent-passport.ts");
const {
  AGENT_PASSPORT_DIRECTORY_LIMIT,
  parseAgentPassportDirectory,
  rememberAgentPassport,
} = await import("./passport-directory.ts");

const ADDRESS = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9";
const CREATED_AT = new Date("2026-08-21T10:00:00.000Z");
const HASH = `0x${"ab".repeat(32)}`;

function member(id, url) {
  return {
    id,
    url,
    observedAt: CREATED_AT.toISOString(),
    availability: "AVAILABLE",
    httpStatus: 200,
    payloadDigest: HASH,
    reasonCode: null,
    schemaDrift: [],
  };
}

function source(id, kind, members) {
  return {
    id,
    provider: "AGENTVERSE",
    kind,
    providerScope: "PROVIDER_GLOBAL",
    observedAt: CREATED_AT.toISOString(),
    availability: "AVAILABLE",
    members,
    payloadDigest: HASH,
    reasonCode: null,
    schemaDrift: [],
  };
}

function fixture() {
  return createAgentPassport({
    request: { schemaVersion: "1.0.0", provider: "AGENTVERSE", address: ADDRESS },
    sources: [
      source("agentverse-registry", "REGISTRY", [
        member("registry", `https://agentverse.ai/v2/almanac/resolve/${ADDRESS}`),
      ]),
      source("agentverse-search", "SEARCH", [
        member("search", `https://agentverse.ai/v1/search/agents/${ADDRESS}`),
      ]),
      source("agentverse-manifests", "MANIFESTS", [
        member(
          "manifest-abababababababab",
          `https://agentverse.ai/v2/almanac/manifest/${"ab".repeat(32)}`,
        ),
      ]),
    ],
    providerClaims: [],
    ryntraObservations: [{
      id: "observation_liveness",
      kind: "LIVENESS",
      sourceIds: ["agentverse-registry"],
      value: "NOT_TESTED",
      detail: "No declared endpoint was fetched.",
    }],
    conflicts: [],
    unknowns: [],
    createdAt: CREATED_AT,
  });
}

test("tab directory restores only bounded, canonical, integrity-valid documents", async () => {
  const valid = fixture();
  const invalid = { ...valid, kind: "AGENT_PROFILE" };
  const tampered = {
    ...valid,
    integrity: { ...valid.integrity, hash: `0x${"00".repeat(32)}` },
  };
  const parsed = await parseAgentPassportDirectory(JSON.stringify([tampered, valid, invalid, valid]));

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].request.address, ADDRESS);
  assert.deepEqual(await parseAgentPassportDirectory(null), []);
  assert.deepEqual(await parseAgentPassportDirectory("not-json"), []);
  assert.deepEqual(await parseAgentPassportDirectory(JSON.stringify({ records: [valid] })), []);
  assert.deepEqual(
    await parseAgentPassportDirectory(JSON.stringify(Array(AGENT_PASSPORT_DIRECTORY_LIMIT + 1).fill(valid))),
    [],
  );
});

test("remember replaces one address and keeps a transparent bounded history", () => {
  const baseline = fixture();
  const records = Array.from({ length: AGENT_PASSPORT_DIRECTORY_LIMIT }, (_, index) => ({
    ...baseline,
    id: `agent-passport_${String(index).padStart(16, "0")}`,
    request: { ...baseline.request, address: `address-${index}` },
  }));
  const replacement = { ...baseline, createdAt: "2026-08-21T11:00:00.000Z" };
  const remembered = rememberAgentPassport(records, replacement);

  assert.equal(remembered.length, AGENT_PASSPORT_DIRECTORY_LIMIT);
  assert.equal(remembered[0], replacement);
  assert.equal(remembered.filter((entry) => entry.request.address === ADDRESS).length, 1);
  assert.equal(remembered.some((entry) => entry.request.address === "address-11"), false);
});
