// Run from repo root:
// node --test --test-isolation=none lib/agent-control/adapter-projection.test.mjs
//
// An adapter projection is a read, never a second lifecycle. These tests pin
// the identity and non-promotion boundaries that make that statement true.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTER_PROJECTION_DECLARATIONS,
  AdapterProjectionError,
  projectAdapterAction,
} from "./adapter-projection.ts";
import {
  CURRENT_ADAPTER_PROJECTIONS,
  SOLANA_ADAPTER_PROJECTION,
  STELLAR_ADAPTER_PROJECTION,
} from "./adapter-projection-current.ts";
import { SOLANA_CAIP2 } from "./adapters/solana-token-2022.ts";
import { STELLAR_MAINNET, STELLAR_TESTNET } from "../stellar/network.ts";

const h = (pair) => `0x${pair.repeat(32)}`;

function completeInput(adapter) {
  const chainRef = adapter.chainRefs[0];
  const identity = {
    actionId: `action-${adapter.id}-001`,
    actionDigest: h("11"),
    policyVersion: 7,
    chainRef,
    receipt: {
      ref: { id: `receipt-${adapter.id}-001`, hash: h("22") },
      actionId: `action-${adapter.id}-001`,
      actionDigest: h("11"),
      policyVersion: 7,
      chainRef,
    },
  };
  const claim = {
    actionId: identity.actionId,
    actionDigest: identity.actionDigest,
    policyVersion: identity.policyVersion,
    receiptRef: identity.receipt.ref,
    chainRef,
  };

  return {
    adapter,
    identity,
    agentControl: {
      sourceClaim: claim,
      agentRef: `agent:${adapter.id}:fixture`,
      authority: { mode: "BOUNDED_MANDATE", ref: `mandate:${adapter.id}:fixture` },
      policyRef: { id: `policy:${adapter.id}:fixture`, version: 7 },
      authorization: { state: "AUTHORIZED", basis: "Synthetic contract fixture." },
      sourceRefs: [`fixture:${adapter.id}:agent-control`],
    },
    ecosystem: {
      sourceClaim: claim,
      assetRef: `${chainRef}/fixture:asset`,
      execution: { state: "CONFIRMED", basis: "Synthetic contract fixture." },
      settlement: { state: "CONFIRMED", basis: "Synthetic contract fixture." },
      reconciliation: { state: "MATCHED", basis: "Synthetic contract fixture." },
      sourceRefs: [`fixture:${adapter.id}:ecosystem`],
    },
    axes: {
      providerCapability: { state: "AVAILABLE", basis: "Synthetic provider contract." },
      ryntraMaturity: { state: "TESTNET", basis: "Synthetic Ryntra fixture." },
      routeCapability: { state: "AVAILABLE", basis: "Synthetic route fixture." },
      userEligibility: { state: "ELIGIBLE", basis: "Synthetic eligibility fixture." },
    },
    limitations: ["Synthetic contract fixture; not product evidence."],
    nextGate: "None inside this synthetic contract fixture.",
  };
}

function reason(reasonCode) {
  return (error) =>
    error instanceof AdapterProjectionError && error.reasonCode === reasonCode;
}

test("Solana and Stellar complete fixtures project through one contract", () => {
  assert.deepEqual(
    ADAPTER_PROJECTION_DECLARATIONS.map(({ id }) => id),
    ["solana", "stellar"],
  );

  for (const adapter of ADAPTER_PROJECTION_DECLARATIONS) {
    const projection = projectAdapterAction(completeInput(adapter));
    assert.equal(projection.status, "COMPLETE", adapter.id);
    assert.equal(projection.identity.actionId, `action-${adapter.id}-001`);
    assert.equal(projection.identity.policyVersion, 7);
    assert.equal(projection.identity.receipt?.id, `receipt-${adapter.id}-001`);
  }
});

test("an adapter a caller declares projects through the same contract, and only with its declaration", () => {
  /* A separate package declares its own adapter and passes the declaration in;
     the product's own list does not carry it, so without it the same input is
     refused as undeclared. */
  const declared = Object.freeze({
    id: "fixture-chain",
    label: "Fixture chain",
    networkLabel: "Fixture network",
    chainRefs: Object.freeze(["eip155:1"]),
    agentControlPath: "/agents/workspace/integrations",
    ecosystemPath: "/fixture/workspace/agents",
  });
  const projection = projectAdapterAction(completeInput(declared), [declared]);
  assert.equal(projection.status, "COMPLETE");
  assert.equal(projection.adapter.id, "fixture-chain");
  assert.throws(() => projectAdapterAction(completeInput(declared)), reason("ADAPTER_UNKNOWN"));
});

test("both read models receive the exact same deeply frozen identity object", () => {
  const projection = projectAdapterAction(completeInput(ADAPTER_PROJECTION_DECLARATIONS[0]));

  assert.strictEqual(projection.agentControl.identity, projection.identity);
  assert.strictEqual(projection.ecosystem.identity, projection.identity);
  assert.strictEqual(projection.agentControl.identity, projection.ecosystem.identity);
  assert.ok(Object.isFrozen(projection));
  assert.ok(Object.isFrozen(projection.identity));
  assert.ok(Object.isFrozen(projection.identity.receipt));
  assert.throws(() => {
    projection.identity.actionId = "action-rebound";
  }, TypeError);
});

test("each read model keeps only its own ownership responsibilities", () => {
  const projection = projectAdapterAction(completeInput(ADAPTER_PROJECTION_DECLARATIONS[0]));

  assert.deepEqual(projection.agentControl.responsibilities, [
    "agent attribution",
    "owner authority or mandate",
    "policy binding",
    "authorization state",
  ]);
  assert.deepEqual(projection.ecosystem.responsibilities, [
    "chain and asset identity",
    "execution",
    "settlement",
    "reconciliation",
  ]);
});

test("an ecosystem claim cannot diverge from the canonical action identity", () => {
  const input = completeInput(ADAPTER_PROJECTION_DECLARATIONS[0]);
  input.ecosystem.sourceClaim = {
    ...input.ecosystem.sourceClaim,
    actionId: "action-other-001",
  };

  assert.throws(() => projectAdapterAction(input), reason("ACTION_ID_MISMATCH"));
});

test("a Receipt cannot be rebound to another action", () => {
  const input = completeInput(ADAPTER_PROJECTION_DECLARATIONS[1]);
  input.identity.receipt = {
    ...input.identity.receipt,
    actionDigest: h("33"),
  };

  assert.throws(() => projectAdapterAction(input), reason("RECEIPT_ACTION_DIGEST_MISMATCH"));
});

test("a surface cannot substitute another Receipt reference", () => {
  const input = completeInput(ADAPTER_PROJECTION_DECLARATIONS[1]);
  input.agentControl.sourceClaim = {
    ...input.agentControl.sourceClaim,
    receiptRef: { ...input.agentControl.sourceClaim.receiptRef, hash: h("44") },
  };

  assert.throws(() => projectAdapterAction(input), reason("RECEIPT_REFERENCE_MISMATCH"));
});

test("policy and chain mismatches fail with their own reasons", () => {
  const policy = completeInput(ADAPTER_PROJECTION_DECLARATIONS[0]);
  policy.agentControl.policyRef = { ...policy.agentControl.policyRef, version: 8 };
  assert.throws(() => projectAdapterAction(policy), reason("POLICY_VERSION_MISMATCH"));

  const chain = completeInput(ADAPTER_PROJECTION_DECLARATIONS[0]);
  chain.ecosystem.sourceClaim = {
    ...chain.ecosystem.sourceClaim,
    chainRef: "eip155:1",
  };
  assert.throws(() => projectAdapterAction(chain), reason("CHAIN_REF_MISMATCH"));
});

test("the four capability axes remain independent and cannot promote one another", () => {
  const input = completeInput(ADAPTER_PROJECTION_DECLARATIONS[1]);
  input.axes = {
    providerCapability: { state: "AVAILABLE", basis: "The provider supports a read." },
    ryntraMaturity: { state: "PREVIEW", basis: "Ryntra has no executed lifecycle." },
    routeCapability: { state: "UNAVAILABLE", basis: "No execution route is mounted." },
    userEligibility: { state: "NOT_EVALUATED", basis: "No eligibility decision was made." },
  };

  const projection = projectAdapterAction(input);
  assert.deepEqual(projection.axes, input.axes);
  assert.equal(projection.axes.providerCapability.state, "AVAILABLE");
  assert.equal(projection.axes.ryntraMaturity.state, "PREVIEW");
  assert.equal(projection.axes.routeCapability.state, "UNAVAILABLE");
  assert.equal(projection.axes.userEligibility.state, "NOT_EVALUATED");
  assert.equal(projection.status, "COMPLETE", "capability axes must not rewrite binding completeness");
});

test("adapter declarations stay pinned to the canonical network registries", () => {
  const byId = Object.fromEntries(ADAPTER_PROJECTION_DECLARATIONS.map((row) => [row.id, row]));
  assert.deepEqual(byId.solana.chainRefs, [SOLANA_CAIP2.devnet, SOLANA_CAIP2.mainnet]);
  assert.deepEqual(byId.stellar.chainRefs, [STELLAR_TESTNET.id, STELLAR_MAINNET.id]);
});

test("current Solana evidence projects the bounded lifecycle without agent authority", () => {
  assert.equal(SOLANA_ADAPTER_PROJECTION.status, "PARTIAL");
  assert.equal(SOLANA_ADAPTER_PROJECTION.identity.actionId, "action:solana-token-2022/spl-transfer@1");
  assert.equal(
    SOLANA_ADAPTER_PROJECTION.identity.actionDigest,
    "0x5a562e9c0671688678e079802d2e4108a577042402099da066b6d1ed17819d80",
  );
  assert.equal(SOLANA_ADAPTER_PROJECTION.identity.policyVersion, null);
  assert.equal(SOLANA_ADAPTER_PROJECTION.identity.receipt, null);
  assert.equal(SOLANA_ADAPTER_PROJECTION.agentControl.authorization.state, "UNAVAILABLE");
  assert.equal(SOLANA_ADAPTER_PROJECTION.ecosystem.execution.state, "CONFIRMED");
  assert.equal(SOLANA_ADAPTER_PROJECTION.ecosystem.settlement.state, "CONFIRMED");
  assert.equal(SOLANA_ADAPTER_PROJECTION.ecosystem.reconciliation.state, "DEVIATION_RECORDED");
  assert.equal(SOLANA_ADAPTER_PROJECTION.axes.ryntraMaturity.state, "PREVIEW");
});

test("current Stellar lifecycle stays partial because it lacks Agent Control bindings", () => {
  assert.equal(STELLAR_ADAPTER_PROJECTION.status, "PARTIAL");
  assert.equal(STELLAR_ADAPTER_PROJECTION.identity.actionId, null);
  assert.equal(STELLAR_ADAPTER_PROJECTION.identity.actionDigest, null);
  assert.equal(STELLAR_ADAPTER_PROJECTION.identity.policyVersion, null);
  assert.equal(STELLAR_ADAPTER_PROJECTION.identity.receipt, null);
  assert.equal(STELLAR_ADAPTER_PROJECTION.ecosystem.execution.state, "CONFIRMED");
  assert.equal(STELLAR_ADAPTER_PROJECTION.ecosystem.reconciliation.state, "MATCHED");
});

test("current evidence never defaults route availability or user eligibility positive", () => {
  assert.deepEqual(
    CURRENT_ADAPTER_PROJECTIONS.map(({ adapter }) => adapter.id),
    ["solana", "stellar"],
  );
  for (const projection of CURRENT_ADAPTER_PROJECTIONS) {
    assert.notEqual(projection.axes.routeCapability.state, "AVAILABLE", projection.adapter.id);
    assert.notEqual(projection.axes.userEligibility.state, "ELIGIBLE", projection.adapter.id);
    assert.strictEqual(projection.agentControl.identity, projection.ecosystem.identity);
    assert.ok(Object.isFrozen(projection));
  }
});
