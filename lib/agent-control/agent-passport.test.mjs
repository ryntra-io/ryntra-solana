// Run from repo root: node --test lib/agent-control/agent-passport.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

const {
  AGENT_PASSPORT_FACT_FIELDS,
  AgentPassportRequestSchema,
  AgentPassportSchema,
  AgentPassportSourceSchema,
  createAgentPassport,
  isAgentverseAddress,
  verifyAgentPassport,
} = await import("./agent-passport.ts");

const ADDRESS = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9";
const CHECKSUM_MUTATION = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyywq";
const ALPHABET_ONLY_ADDRESS = `agent1${"q".repeat(59)}`;
const CREATED_AT = new Date("2026-08-14T10:00:00.000Z");
const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;
const HASH_C = `0x${"cc".repeat(32)}`;

function member(id, url, payloadDigest) {
  return {
    id,
    url,
    observedAt: CREATED_AT.toISOString(),
    availability: "AVAILABLE",
    httpStatus: 200,
    payloadDigest,
    reasonCode: null,
    schemaDrift: [],
  };
}

function source(id, kind, payloadDigest, members) {
  return {
    id,
    provider: "AGENTVERSE",
    kind,
    providerScope: "PROVIDER_GLOBAL",
    observedAt: CREATED_AT.toISOString(),
    availability: "AVAILABLE",
    members,
    payloadDigest,
    reasonCode: null,
    schemaDrift: [],
  };
}

function fixture(overrides = {}) {
  const sources = [
    source("agentverse-registry", "REGISTRY", HASH_A, [
      member(
        "registry",
        `https://agentverse.ai/v2/almanac/resolve/${ADDRESS}`,
        HASH_A,
      ),
    ]),
    source("agentverse-search", "SEARCH", HASH_B, [
      member(
        "search",
        `https://agentverse.ai/v1/search/agents/${ADDRESS}`,
        HASH_B,
      ),
    ]),
    source("agentverse-manifests", "MANIFESTS", HASH_C, [
      member(
        "manifest-cccccccccccccccc",
        `https://agentverse.ai/v2/almanac/manifest/${"cc".repeat(32)}`,
        HASH_C,
      ),
    ]),
  ];
  return createAgentPassport({
    request: { schemaVersion: "1.0.0", provider: "AGENTVERSE", address: ADDRESS },
    sources,
    providerClaims: [
      {
        id: "claim_status_offline",
        field: "status",
        value: "offline",
        sourceIds: ["agentverse-registry"],
        declaration: "PROVIDER_DECLARED",
        limitation: "Provider-declared only; Ryntra did not verify functional liveness.",
      },
      {
        id: "claim_rating_provider",
        field: "rating",
        value: 4.2,
        sourceIds: ["agentverse-search"],
        declaration: "PROVIDER_REPORTED_METRIC",
        limitation: "Provider metric only; not a Ryntra score or recommendation.",
      },
    ],
    ryntraObservations: [
      {
        id: "observation_liveness",
        kind: "LIVENESS",
        sourceIds: ["agentverse-registry"],
        value: "NOT_TESTED",
        detail: "Ryntra did not fetch the declared endpoint.",
      },
    ],
    conflicts: [],
    unknowns: [],
    createdAt: CREATED_AT,
    ...overrides,
  });
}

test("AgentPassport 1.0.0 is strict at request, source and fact boundaries", () => {
  assert.throws(() => fixture({
    request: {
      schemaVersion: "1.0.0",
      provider: "AGENTVERSE",
      address: ADDRESS,
      network: "mainnet",
    },
  }));

  const invalidSource = fixture().sources.map((value) => ({ ...value }));
  invalidSource[0] = { ...invalidSource[0], authorization: "secret" };
  assert.throws(() => fixture({ sources: invalidSource }));

  const wrongProvenance = fixture().sources.map((value) => ({
    ...value,
    members: value.members.map((entry) => ({ ...entry })),
  }));
  wrongProvenance[0].members[0].url = wrongProvenance[0].members[0].url.slice(0, -1) + "q";
  assert.throws(() => fixture({ sources: wrongProvenance }));

  const invalidFact = fixture().providerClaims.map((value) => ({ ...value }));
  invalidFact[0] = { ...invalidFact[0], recommendation: "approve" };
  assert.throws(() => fixture({ providerClaims: invalidFact }));
});

test("exact Agentverse addresses require a valid Bech32 checksum", () => {
  assert.equal(isAgentverseAddress(ADDRESS), true);
  assert.equal(AgentPassportRequestSchema.safeParse({
    schemaVersion: "1.0.0",
    provider: "AGENTVERSE",
    address: ADDRESS,
  }).success, true);

  for (const value of [null, 7, {}, ""]) assert.equal(isAgentverseAddress(value), false);
  for (const address of [CHECKSUM_MUTATION, ALPHABET_ONLY_ADDRESS]) {
    assert.equal(isAgentverseAddress(address), false);
    assert.equal(AgentPassportRequestSchema.safeParse({
      schemaVersion: "1.0.0",
      provider: "AGENTVERSE",
      address,
    }).success, false);
  }
});

test("malformed provenance URLs return an invalid verification instead of throwing", () => {
  const malformed = structuredClone(fixture());
  malformed.sources[0].members[0].url = "not a URL";

  const verification = verifyAgentPassport(malformed);
  assert.equal(verification.valid, false);
  assert.equal(verification.verdict, "INVALID");
});

test("official provenance URLs reject embedded credentials", () => {
  const sourceWithCredentials = structuredClone(fixture().sources[0]);
  sourceWithCredentials.members[0].url = sourceWithCredentials.members[0].url.replace(
    "https://",
    "https://user:password@",
  );

  assert.equal(AgentPassportSourceSchema.safeParse(sourceWithCredentials).success, false);
});

test("canonical creation fixes source, member, evidence and source-reference order", () => {
  const baseline = fixture();
  const reorderedSources = [...baseline.sources].reverse().map((value) => ({
    ...value,
    members: [...value.members].reverse(),
    schemaDrift: [...value.schemaDrift].reverse(),
  }));
  const reordered = fixture({
    sources: reorderedSources,
    providerClaims: [...baseline.providerClaims].reverse().map((claim) => ({
      ...claim,
      sourceIds: [...claim.sourceIds].reverse(),
    })),
    ryntraObservations: [...baseline.ryntraObservations].reverse(),
  });

  assert.deepEqual(reordered, baseline);
  assert.deepEqual(baseline.sources.map(({ kind }) => kind), ["REGISTRY", "SEARCH", "MANIFESTS"]);
});

test("duplicate evidence ids are rejected in either permutation", () => {
  const baseline = fixture();
  const statusClaim = baseline.providerClaims.find((claim) => claim.field === "status");
  assert.ok(statusClaim);
  const conflict = {
    id: "conflict_duplicate",
    field: "status",
    sourceIds: ["agentverse-registry", "agentverse-search"],
    values: ["registry:offline", "search:active"],
    reason: "Provider records disagree.",
  };
  const unknown = {
    id: "unknown_duplicate",
    field: "name",
    sourceIds: ["agentverse-search"],
    reasonCode: "FIELD_NOT_DECLARED",
    detail: "The field was not declared.",
  };
  const collections = [
    ["providerClaims", statusClaim, { ...statusClaim, value: "active" }],
    ["ryntraObservations", baseline.ryntraObservations[0], {
      ...baseline.ryntraObservations[0],
      detail: "A second observation with the same id.",
    }],
    ["conflicts", conflict, { ...conflict, reason: "A second conflict with the same id." }],
    ["unknowns", unknown, { ...unknown, detail: "A second unknown with the same id." }],
  ];

  for (const [field, first, second] of collections) {
    for (const duplicateOrder of [[first, second], [second, first]]) {
      assert.throws(
        () => fixture({ [field]: duplicateOrder }),
        undefined,
        `${field} must reject duplicate ids regardless of input order`,
      );
    }
  }
});

test("canonical Agent Passport has a literal domain-separated golden vector", () => {
  const passport = fixture();
  assert.equal(passport.id, "agent-passport_4a146eb2699f3056");
  assert.equal(
    passport.passportHash,
    "0x88c02cd39b4c2956424b96895ccb039e007fdccc69274b77ca71faec14fa2920",
  );
  assert.equal(
    passport.integrity.hash,
    "0xdc7b12eda61b6bff9329d2bba7a3c901acc3f7ead65f408667f5a5683a638125",
  );
  assert.deepEqual(verifyAgentPassport(passport), {
    valid: true,
    verdict: "AGENT_PASSPORT_INTEGRITY_VALID",
    issues: [],
  });
});

test("material mutation and identity forgery invalidate integrity", () => {
  const tampered = structuredClone(fixture());
  tampered.providerClaims.find((claim) => claim.field === "status").value = "active";
  const mutation = verifyAgentPassport(tampered);
  assert.equal(mutation.valid, false);
  assert.ok(mutation.issues.includes("PASSPORT_HASH_MISMATCH"));
  assert.ok(mutation.issues.includes("INTEGRITY_HASH_MISMATCH"));

  const forgedIdentity = structuredClone(fixture());
  forgedIdentity.id = "agent-passport_0000000000000000";
  assert.ok(verifyAgentPassport(forgedIdentity).issues.includes("PASSPORT_ID_MISMATCH"));
});

test("a failed source must remain visible as an unknown and cannot back a fact", () => {
  const baseline = fixture();
  const unavailableSearch = {
    ...baseline.sources[1],
    availability: "UNAVAILABLE",
    members: [{
      ...baseline.sources[1].members[0],
      availability: "UNAVAILABLE",
      httpStatus: null,
      payloadDigest: null,
      reasonCode: "TIMEOUT",
    }],
    payloadDigest: null,
    reasonCode: "TIMEOUT",
  };
  const sources = [baseline.sources[0], unavailableSearch, baseline.sources[2]];
  assert.throws(() => fixture({ sources, providerClaims: [], unknowns: [] }));

  const partial = fixture({
    sources,
    providerClaims: baseline.providerClaims.filter((claim) => !claim.sourceIds.includes("agentverse-search")),
    unknowns: [{
      id: "unknown_source_search",
      field: "search_source",
      sourceIds: ["agentverse-search"],
      reasonCode: "SOURCE_UNAVAILABLE",
      detail: "The bounded search source timed out.",
    }],
  });
  assert.equal(AgentPassportSchema.safeParse(partial).success, true);
  assert.equal(partial.sources[1].availability, "UNAVAILABLE");
});

test("the fact vocabulary contains no Ryntra trust score or recommendation field", () => {
  assert.equal(AGENT_PASSPORT_FACT_FIELDS.some((field) => /trust|safety|reputation|recommend/i.test(field)), false);
  assert.equal(AGENT_PASSPORT_FACT_FIELDS.includes("rating"), true, "provider rating remains source-labelled");
});
