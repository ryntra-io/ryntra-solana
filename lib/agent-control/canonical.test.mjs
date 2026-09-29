// Run from repo root: node --test lib/agent-control/canonical.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { AGENT_HASH_DOMAINS, hashAgentPayload } = await import("./canonical.ts");

const GOLDEN_PAYLOAD = {
  z: 2,
  a: "agent-control",
  nested: { ready: false, count: 3 },
  empty: null,
};

const GOLDEN_HASHES = {
  intent: "0xd001fb2ee7bcf64a2a7cd24352073cf9a3012f52758778f31442f9cc6bc0ed03",
  evidence: "0xcd3e4aa50bea1b5aefae40a7cde5add087fc69f5321e30b754ff5939c58288fd",
  policy: "0x69a339f139fb8757cea243097ca183adc42db7331b56a8006e0e9e52c93060b9",
  policyResult: "0x9b732e761c9c831961f746f974ed08a739c7940e788a8aec4636cb97011c1182",
  passport: "0x4b8dec8e60b929458bbe1ef378936a6b3ea295af46cb01a03c718216460e2658",
  integrity: "0x55f7375383bc26efc5d90ca0f21ebbedea03b916757f814df78c1de85e365cc9",
};

test("Agent Control hash domains have literal golden vectors", () => {
  for (const [name, expected] of Object.entries(GOLDEN_HASHES)) {
    assert.equal(
      hashAgentPayload(AGENT_HASH_DOMAINS[name], GOLDEN_PAYLOAD),
      expected,
      `${name} bytes changed`,
    );
  }
});

test("one canonical payload is separated across every Agent Control domain", () => {
  const hashes = Object.values(AGENT_HASH_DOMAINS).map((domain) =>
    hashAgentPayload(domain, GOLDEN_PAYLOAD),
  );
  assert.equal(new Set(hashes).size, hashes.length);
  for (const hash of hashes) assert.match(hash, /^0x[0-9a-f]{64}$/);

  assert.equal(
    hashAgentPayload(AGENT_HASH_DOMAINS.intent, {
      empty: null,
      nested: { count: 3, ready: false },
      a: "agent-control",
      z: 2,
    }),
    GOLDEN_HASHES.intent,
    "object insertion order must not move canonical bytes",
  );
});
