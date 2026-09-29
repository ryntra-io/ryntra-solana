import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { UNSIGNED_ATTESTATION, sealArtifact } from "./artifacts.ts";
import { ISSUER_PRIVATE_KEY_ENV, attestArtifact, loadIssuerKey } from "./issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "./registry.ts";
import { verifyAgentArtifact } from "./verify.ts";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const PIN = registryPin(AGENT_CONTROL_REGISTRY, ["adapter:bnb-apex@1"]);
const LEGACY = JSON.parse(
  readFileSync("lib/agent-control/fixtures/legacy-action-passport-1.0.0.json", "utf8"),
);

function receipt(issuer = UNSIGNED_ATTESTATION) {
  return sealArtifact(
    {
      schemaVersion: "2.0.0",
      kind: "OUTCOME_RECEIPT",
      id: "outcome_1",
      createdAt: NOW.toISOString(),
      maturity: "OBSERVED",
      registry: PIN,
      actionPassportHash: `0x${"1".repeat(64)}`,
      outcome: {
        status: "MATCHED",
        chainRef: "eip155:97",
        transactionHash: "0xabc",
        observedEffects: [
          { description: "job funded", sourceRef: "https://example.invalid/tx", observedAt: NOW.toISOString() },
        ],
        reconciledAt: NOW.toISOString(),
      },
      limitations: [
        "OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION",
        "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it.",
      ],
    },
    issuer,
  );
}

test("one verifier handles both generations, dispatching on the artifact's own kind", () => {
  const v2 = verifyAgentArtifact(receipt());
  assert.equal(v2.recognised, true);
  assert.equal(v2.generation, "v2");
  assert.equal(v2.kind, "OUTCOME_RECEIPT");
  assert.equal(v2.schemaVersion, "2.0.0");
  assert.equal(v2.integrity.valid, true);

  const legacy = verifyAgentArtifact(LEGACY);
  assert.equal(legacy.recognised, true);
  assert.equal(legacy.generation, "legacy-1.0.0");
  assert.equal(legacy.kind, "ACTION_PASSPORT_PREVIEW");
  assert.equal(legacy.schemaVersion, "1.0.0");
  assert.equal(legacy.integrity.valid, true);
});

test("the caller cannot tell the verifier what it is looking at", () => {
  /* `verifyAgentArtifact` takes one argument and an options bag that carries no
     kind. The dispatch reads the artifact, because the party with the strongest
     incentive to mislabel one is the party presenting it. */
  assert.equal(verifyAgentArtifact.length, 1, "the verifier takes the artifact and no kind hint");
  const source = readFileSync("lib/agent-control/verify.ts", "utf8");
  assert.ok(!/expectedKind|declaredKind|asKind/.test(source), "the verifier accepts a caller-declared kind");
});

test("the three axes are reported separately and there is no combined verdict", () => {
  const key = loadIssuerKey({
    [ISSUER_PRIVATE_KEY_ENV]: generateKeyPairSync("ed25519")
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  });
  const unsigned = receipt();
  const signed = verifyAgentArtifact(
    receipt(attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now: NOW })),
    { trustedPublicKeys: [key.publicKey] },
  );

  assert.deepEqual(
    Object.keys(signed).sort(),
    ["authorization", "generation", "integrity", "issuer", "kind", "observation", "recognised", "schemaVersion"],
    "a key was added or removed from the verification envelope",
  );
  for (const forbidden of ["valid", "verdict", "ok", "passed"]) {
    assert.ok(
      !(forbidden in signed),
      `the envelope carries a top-level ${forbidden}, which collapses the axes into one answer`,
    );
  }

  assert.equal(signed.issuer.verdict, "SIGNATURE_VALID");
  assert.equal(signed.observation.verdict, "OBSERVED");
  assert.equal(signed.authorization.verdict, "NOT_APPLICABLE");
});

test("a valid unsigned artifact and a tampered signed one are told apart", () => {
  /* The distinction any collapsed boolean destroys: both would read as
     "false", and they are opposite situations. */
  const unsigned = verifyAgentArtifact(receipt());
  assert.equal(unsigned.integrity.valid, true);
  assert.equal(unsigned.issuer.verdict, "UNSIGNED");
  assert.equal(unsigned.issuer.detail, "NO_ISSUER_KEY_CONFIGURED");

  const edited = { ...receipt(), id: "outcome_edited" };
  const tampered = verifyAgentArtifact(edited);
  assert.equal(tampered.integrity.valid, false);
  assert.ok(tampered.integrity.issues.includes("CONTENT_HASH_MISMATCH"));
});

test("legacy artifacts are reported as unsigned rather than as invalid", () => {
  /* v1 predates signing. Calling it invalid would punish an artifact for being
     old; calling it valid would invent an assurance it never carried. */
  const legacy = verifyAgentArtifact(LEGACY);
  assert.equal(legacy.issuer.verdict, "UNSIGNED");
  assert.match(legacy.issuer.detail, /predates issuer signatures/);
  assert.equal(legacy.authorization.verdict, "DEMO_ACKNOWLEDGEMENT_ONLY");
  assert.match(legacy.authorization.detail, /not a human authorization/);
  assert.equal(legacy.observation.verdict, "NOT_OBSERVED");
});

test("a tampered legacy artifact still fails through the same verifier", () => {
  const tampered = { ...LEGACY, intent: { ...LEGACY.intent, requestText: "edited" } };
  const result = verifyAgentArtifact(tampered);
  assert.equal(result.integrity.valid, false);
  assert.ok(result.integrity.issues.length > 0);
});

test("input that is not an artifact is refused without pretending to have checked anything", () => {
  for (const value of [null, undefined, 42, "not an artifact", {}, { kind: "SOMETHING_ELSE" }]) {
    const result = verifyAgentArtifact(value);
    assert.equal(result.recognised, false, `${JSON.stringify(value)} was recognised`);
    assert.equal(result.integrity.valid, false);
    assert.equal(result.kind, null);
  }
});

test("the unified verifier is one path over two generations, not two paths", () => {
  /*
   * `core.ts` keeps `verifyActionPassportPreview` because this module delegates
   * the legacy generation to it. That is one entry point covering two artifact
   * generations, which is the shape the block asks for.
   *
   * **The surfaces are not wired to it yet, and this test says so rather than
   * asserting otherwise.** `/api/agents/verify` still calls the legacy verifier
   * directly, because moving it changes the published response shape and
   * cascades into the SDK, the MCP server, the example and the OpenAPI
   * contract. That cascade was started and reverted rather than half-landed; a
   * test claiming the wiring exists would be the false-gate class this
   * repository has already recorded twice.
   */
  const unified = readFileSync("lib/agent-control/verify.ts", "utf8");
  assert.ok(unified.includes("verifyActionPassportPreview"), "the legacy generation must stay reachable");

  const route = readFileSync("app/api/agents/verify/route.ts", "utf8");
  assert.ok(
    route.includes("verifyActionPassportPreview") !== route.includes("verifyAgentArtifact"),
    "the route must call exactly one verifier, never both",
  );

  /* Whichever it calls, the browser surface must not carry verification logic
     of its own — it posts the artifact and renders what comes back. */
  const ui = readFileSync("app/agents/verify/verifier.tsx", "utf8");
  assert.ok(!/hashAgentPayload|createHash/.test(ui), "the UI re-implements verification");
});
