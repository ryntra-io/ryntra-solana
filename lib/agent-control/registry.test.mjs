import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AGENT_ACTION_CLASSES,
  AGENT_CONTROL_REGISTRY,
  RegistryResolutionError,
  buildRegistry,
  registryPin,
  resolveRegistryRef,
} from "./registry.ts";

const CENTRAL_SCHEMA_SOURCES = [
  "lib/agent-control/contracts.ts",
  "lib/agent-control/registry.ts",
];

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof RegistryResolutionError, `expected a registry refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode);
    return;
  }
  assert.fail(`expected ${reasonCode}, nothing was thrown`);
}

test("the shipped registry carries only allowlisted, read-only entries", () => {
  for (const entry of AGENT_CONTROL_REGISTRY.entries) {
    assert.equal(entry.status, "ALLOWED", `${entry.ref} ships retired`);
    assert.match(entry.contentHash, /^0x[0-9a-f]{64}$/);
    if (entry.kind === "ADAPTER") {
      assert.ok(
        entry.capability === "READ_ONLY" || entry.capability === "OBSERVE_AND_RECONCILE",
        `${entry.ref} claims a capability outside observe-and-reconcile`,
      );
    }
  }
  assert.match(AGENT_CONTROL_REGISTRY.digest, /^0x[0-9a-f]{64}$/);
});

test("entries are stored in one canonical order, so the digest cannot depend on input order", () => {
  const refs = AGENT_CONTROL_REGISTRY.entries.map((entry) => entry.ref);
  assert.deepEqual(refs, refs.slice().sort());

  const definitions = AGENT_CONTROL_REGISTRY.entries.map(({ contentHash: _pin, ...definition }) => definition);
  const reversed = buildRegistry(definitions.slice().reverse());
  assert.equal(reversed.digest, AGENT_CONTROL_REGISTRY.digest);
});

test("the two-layer model keeps the canonical class readable without knowing the provider", () => {
  const actions = AGENT_CONTROL_REGISTRY.entries.filter((entry) => entry.kind === "ACTION_SCHEMA");
  assert.ok(actions.length >= 5);
  for (const action of actions) {
    assert.ok(
      AGENT_ACTION_CLASSES.includes(action.canonicalClass),
      `${action.ref} carries a class outside the closed vocabulary`,
    );
    assert.ok(action.ref.startsWith("action:"));
  }

  /* The five v1 kinds mapped onto classes without changing what any of them
     meant, including the two budget rules `contracts.ts` enforced by branch. */
  const byRef = Object.fromEntries(actions.map((action) => [action.ref, action]));
  assert.equal(byRef["action:bnb-apex/create-job-draft@1"].canonicalClass, "RECORD_ONLY");
  assert.equal(byRef["action:bnb-apex/create-job-draft@1"].budget, "FORBIDDEN");
  assert.equal(byRef["action:bnb-apex/fund-job@1"].canonicalClass, "VALUE_COMMIT");
  assert.equal(byRef["action:bnb-apex/fund-job@1"].budget, "REQUIRED");
  assert.equal(byRef["action:bnb-apex/settle-job@1"].canonicalClass, "VALUE_RELEASE");
  assert.equal(byRef["action:demo/transfer@1"].canonicalClass, "VALUE_TRANSFER");
});

test("resolution fails closed on every way a reference can be wrong", () => {
  throwsWith("REGISTRY_REF_MALFORMED", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, "bnb-apex", "ADAPTER"));
  throwsWith("REGISTRY_REF_MALFORMED", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, "adapter:bnb-apex", "ADAPTER"));
  throwsWith("REGISTRY_REF_UNKNOWN", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, "adapter:not-a-provider@1", "ADAPTER"));
  throwsWith("REGISTRY_REF_UNKNOWN", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, "adapter:bnb-apex@2", "ADAPTER"));
  /* A reference of the wrong shape is refused before it is looked up, which is
     why asking for an adapter reference as a source is MALFORMED and not
     WRONG_KIND: each kind owns its prefix, so the two can never be confused
     through `buildRegistry`. */
  throwsWith("REGISTRY_REF_MALFORMED", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, "adapter:demo@1", "SOURCE"));
});

test("a forged registry cannot smuggle one entry kind in under another's prefix", () => {
  /*
   * `resolveRegistryRef` takes a registry object from its caller, so the
   * kind check is not redundant with the schema — it is the only thing standing
   * between a hand-built registry and a resolver that returns an adapter where
   * an action was required. Reachable only this way, and therefore proven this
   * way rather than left as an unreachable reason code.
   */
  const forged = {
    schemaVersion: "2.0.0",
    digest: "0x" + "0".repeat(64),
    entries: [
      {
        kind: "ADAPTER",
        ref: "source:api@1",
        displayName: "Direct API",
        capability: "READ_ONLY",
        chainRefs: [],
        status: "ALLOWED",
        contentHash: "0x" + "0".repeat(64),
      },
    ],
  };
  throwsWith("REGISTRY_REF_WRONG_KIND", () => resolveRegistryRef(forged, "source:api@1", "SOURCE"));
});

test("a retired reference cannot back a new artifact", () => {
  const retired = buildRegistry([
    {
      kind: "ADAPTER",
      ref: "adapter:legacy@1",
      displayName: "Legacy",
      capability: "READ_ONLY",
      chainRefs: [],
      status: "RETIRED",
    },
  ]);
  throwsWith("REGISTRY_REF_RETIRED", () => resolveRegistryRef(retired, "adapter:legacy@1", "ADAPTER"));
});

test("an entry that does not hash to its own pin is refused", () => {
  const tampered = {
    ...AGENT_CONTROL_REGISTRY,
    entries: AGENT_CONTROL_REGISTRY.entries.map((entry) =>
      entry.ref === "adapter:bnb-apex@1"
        ? { ...entry, displayName: "BNB APEX (edited after pinning)" }
        : entry,
    ),
  };
  throwsWith("REGISTRY_ENTRY_HASH_MISMATCH", () =>
    resolveRegistryRef(tampered, "adapter:bnb-apex@1", "ADAPTER"));
});

test("an action bound to an adapter the registry lacks cannot be built", () => {
  throwsWith("REGISTRY_REF_UNKNOWN", () =>
    buildRegistry([
      {
        kind: "ACTION_SCHEMA",
        ref: "action:ghost/do-thing@1",
        displayName: "Do thing",
        adapterRef: "adapter:ghost@1",
        canonicalClass: "RECORD_ONLY",
        budget: "OPTIONAL",
        status: "ALLOWED",
      },
    ]));
});

test("an action namespaced under one adapter cannot be bound to another", () => {
  throwsWith("REGISTRY_REF_MALFORMED", () =>
    buildRegistry([
      {
        kind: "ADAPTER",
        ref: "adapter:demo@1",
        displayName: "Demo",
        capability: "READ_ONLY",
        chainRefs: [],
        status: "ALLOWED",
      },
      {
        kind: "ADAPTER",
        ref: "adapter:other@1",
        displayName: "Other",
        capability: "READ_ONLY",
        chainRefs: [],
        status: "ALLOWED",
      },
      {
        kind: "ACTION_SCHEMA",
        ref: "action:demo/thing@1",
        displayName: "Thing",
        adapterRef: "adapter:other@1",
        canonicalClass: "RECORD_ONLY",
        budget: "OPTIONAL",
        status: "ALLOWED",
      },
    ]));
});

test("one reference cannot appear twice", () => {
  const duplicate = {
    kind: "SOURCE",
    ref: "source:api@1",
    displayName: "Direct API",
    originTrust: "UNAUTHENTICATED",
    status: "ALLOWED",
  };
  throwsWith("REGISTRY_REF_MALFORMED", () => buildRegistry([duplicate, { ...duplicate }]));
});

test("adding a provider needs no edit to the central artifact schema", () => {
  /*
   * This is the acceptance criterion for the whole registry, so it is proven
   * rather than asserted in prose: a provider the schema has never heard of is
   * added through definitions alone and resolves, and the central sources are
   * then read from disk and checked for its name. If supporting it had required
   * a schema edit, the fixture id would be in one of those files.
   *
   * Release D repeats this with a real second network. The mechanism it will
   * rely on is exactly what runs here.
   */
  const FIXTURE = "fixtureholdings";
  const extended = buildRegistry([
    ...AGENT_CONTROL_REGISTRY.entries.map(({ contentHash: _pin, ...definition }) => definition),
    {
      kind: "ADAPTER",
      ref: `adapter:${FIXTURE}@1`,
      displayName: "Fixture provider",
      capability: "READ_ONLY",
      chainRefs: ["eip155:8453"],
      status: "ALLOWED",
    },
    {
      kind: "ACTION_SCHEMA",
      ref: `action:${FIXTURE}/settle-invoice@1`,
      displayName: "Settle invoice",
      adapterRef: `adapter:${FIXTURE}@1`,
      canonicalClass: "VALUE_RELEASE",
      budget: "REQUIRED",
      status: "ALLOWED",
    },
  ]);

  const action = resolveRegistryRef(extended, `action:${FIXTURE}/settle-invoice@1`, "ACTION_SCHEMA");
  assert.equal(action.canonicalClass, "VALUE_RELEASE");
  assert.equal(action.budget, "REQUIRED");
  assert.notEqual(extended.digest, AGENT_CONTROL_REGISTRY.digest, "a new entry must move the digest");

  for (const path of CENTRAL_SCHEMA_SOURCES) {
    const source = readFileSync(path, "utf8");
    assert.ok(
      !source.includes(FIXTURE),
      `${path} mentions the fixture provider, so extension still costs a central edit`,
    );
  }
});

test("a pin names the registry and the exact entries an artifact resolved", () => {
  const pin = registryPin(AGENT_CONTROL_REGISTRY, [
    "action:bnb-apex/fund-job@1",
    "source:api@1",
    "action:bnb-apex/fund-job@1",
  ]);
  assert.equal(pin.registryDigest, AGENT_CONTROL_REGISTRY.digest);
  assert.deepEqual(
    pin.refs.map((entry) => entry.ref),
    ["action:bnb-apex/fund-job@1", "source:api@1"],
    "a pin deduplicates and orders, so two artifacts over the same refs pin identically",
  );
  for (const entry of pin.refs) {
    const shipped = AGENT_CONTROL_REGISTRY.entries.find((candidate) => candidate.ref === entry.ref);
    assert.equal(entry.contentHash, shipped.contentHash);
  }
  throwsWith("REGISTRY_REF_UNKNOWN", () => registryPin(AGENT_CONTROL_REGISTRY, ["adapter:ghost@1"]));
});
