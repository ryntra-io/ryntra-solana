import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_HASH_DOMAINS,
  AGENT_HASH_DOMAINS_V2,
  agentCanonicalPreimage,
  hashAgentPayload,
  hashAgentPayloadV2,
} from "./canonical.ts";

/*
 * Golden vectors for the frozen Agent Control serialization.
 *
 * Every value below is a literal. Nothing here recomputes an expectation from
 * the code under test, because a test that derives its own expected value
 * proves only that a function is deterministic — it cannot notice that the
 * function changed. These digests were produced once, from the implementation
 * as it stood when the serialization was declared frozen, and pasted in.
 *
 * One sample value is hashed under every domain on purpose. It pins two
 * properties in one table: the byte format (same input, same digest, forever)
 * and domain separation (same input, different domain, different digest).
 *
 * The sample deliberately carries unsorted keys, a nested object, a mixed
 * array and a null, so a change to key ordering, to `undefined` handling or to
 * number formatting inside the shared canonicalizer lands here first.
 */
const SAMPLE = { b: 1, a: "x", nested: { z: true, y: [3, "2", null] } };

const V1_VECTORS = {
  intent: "0x1299deb759d5936e813bf7269c6ad099b84f7690785ab2d6ed51eba13f0c5545",
  evidence: "0xa151d280f5946061a55d13d6fa2f7383c3ee43393d1b83abeb05b558b47a8816",
  policy: "0xb59532c6c220a936178a8059d71c2fae553c1fcb3a254a697e329dae886fbfd0",
  policyResult: "0xde5b8012be3f662e7923c47d28491d2ddf5ca37ad0fd46d5ec906fb5929b697c",
  passport: "0x6bb26216449b01ce0cc1500ded2ab275925917200f4556177ce5d7e1ce6b4020",
  integrity: "0x6aaac50b93c01b5517fd0242f08063faadacbf5b619af397c278339026f57ff4",
};

const V2_VECTORS = {
  intent: "0xa97fdffd8f792cf353a5bcd3fe6adc9bcffe29697908c4f33546dcf19010676d",
  evidence: "0x43b50e2302aad90bea24e69d967d1755a3747c933a5c030f5fbdeb28306c277e",
  policy: "0x1928223f7d28cc1ef46893078141ad730f6f1c69b97b04005b6d5f41038a8ee3",
  policyResult: "0xb10fedfbbb3eb00a18834358771a1a9c7c062b4821f3c7889c886e70c1a37f4a",
  registry: "0x71724458da99c18139836dc4389692a0a7d790774953b8fd747c7ff2ff0847de",
  agentPassport: "0x2a40fdf79a2bf1df0f90c23ef6738c34a3e40a2ecda320a0980efadf86f72d1c",
  actionPassport: "0x9548fcda7c652d158742486424c60ad8ac6610cf8d60e36eb07a28527ac2b4a8",
  outcomeReceipt: "0xbbc0bd5ccc148478a7b8c12cf3fa0799eb5de78299fb5156cfdde077ec60d11e",
  commerceReceipt: "0x8229013466353ab1e2a0ea188f55d14b48e632000095b3d123571b6032644ec4",
  a2aAgentCard: "0xe7d91a57d107f2386446526ec60d8c870c490fe1279ec9fe5fd87000e63dd097",
  solanaReceiptCorrection: "0xd1f36dbc1878b9049a488286a506725f3d90431d5bc283682573b5c8ad497ba0",
  authorizationProof: "0x0080a1f9d875abe5d25705daa479c7f737aa30b260113e3303b7ddea2c915eec",
  issuerSignature: "0x69cdabc964df4eb2f5d5ef50ca561b832fcd8c93de3daddf5d921957f13042a4",
  integrity: "0x1e9c466d006fce747547dce0aa33817b5fd8f3a726a499e75cca721a4db99735",
};

test("the frozen preimage is the domain line, one newline, then canonical JSON", () => {
  /* Pinned as a string rather than as a digest. A digest comparison cannot
     distinguish a changed separator from a changed canonicalizer; this can,
     and it is the assertion that actually describes the format. */
  assert.equal(
    agentCanonicalPreimage(AGENT_HASH_DOMAINS_V2.intent, SAMPLE),
    'ryntra.agent-control.intent.v2\n{"a":"x","b":1,"nested":{"y":[3,"2",null],"z":true}}',
  );
  assert.equal(
    agentCanonicalPreimage(AGENT_HASH_DOMAINS.intent, SAMPLE),
    'ryntra.agent-control.intent.v1\n{"a":"x","b":1,"nested":{"y":[3,"2",null],"z":true}}',
  );
});

test("every v2 domain digests the sample to its pinned vector", () => {
  const domains = Object.keys(AGENT_HASH_DOMAINS_V2);
  assert.deepEqual(
    domains.slice().sort(),
    Object.keys(V2_VECTORS).slice().sort(),
    "a v2 domain was added or removed without a golden vector",
  );
  for (const key of domains) {
    assert.equal(
      hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2[key], SAMPLE),
      V2_VECTORS[key],
      `the frozen v2 ${key} digest moved`,
    );
  }
});

test("the v1 domains still digest to what artifacts written before the freeze carry", () => {
  /* Legacy 1.0.0 verification depends on these bytes not moving. If a refactor
     ever routes v1 through a different preimage, every artifact produced before
     Release B stops verifying — silently, because nothing else reads them. */
  const domains = Object.keys(AGENT_HASH_DOMAINS);
  assert.deepEqual(
    domains.slice().sort(),
    Object.keys(V1_VECTORS).slice().sort(),
    "a v1 domain was added or removed; the legacy set is closed",
  );
  for (const key of domains) {
    assert.equal(
      hashAgentPayload(AGENT_HASH_DOMAINS[key], SAMPLE),
      V1_VECTORS[key],
      `the legacy v1 ${key} digest moved`,
    );
  }
});

test("domain separation holds: one value never digests the same under two domains", () => {
  const all = [
    ...Object.values(AGENT_HASH_DOMAINS),
    ...Object.values(AGENT_HASH_DOMAINS_V2),
  ];
  assert.equal(new Set(all).size, all.length, "two domains share a string");

  const digests = all.map((domain) => agentCanonicalPreimage(domain, SAMPLE));
  assert.equal(new Set(digests).size, digests.length, "two domains produce one preimage");

  const v1 = Object.values(V1_VECTORS);
  const v2 = Object.values(V2_VECTORS);
  assert.equal(
    new Set([...v1, ...v2]).size,
    v1.length + v2.length,
    "a v1 and a v2 digest collide, so a generation could be replayed as the other",
  );
});

test("the v2 domain names carry their generation, so a reader can tell them apart", () => {
  for (const domain of Object.values(AGENT_HASH_DOMAINS_V2)) {
    assert.ok(domain.startsWith("ryntra.agent-control."), `${domain} is outside the namespace`);
    assert.ok(domain.endsWith(".v2"), `${domain} does not declare its generation`);
  }
  for (const domain of Object.values(AGENT_HASH_DOMAINS)) {
    assert.ok(domain.endsWith(".v1"), `${domain} does not declare its generation`);
  }
});
