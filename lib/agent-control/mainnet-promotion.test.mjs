// Run from repo root:
// node --test lib/agent-control/mainnet-promotion.test.mjs
//
// Finish condition 2: *mainnet, not testnet — and every capability earned its
// own canary. No maturity is inherited because the chain opened.*
//
// The whole point of this module is that the sentence above is enforced rather
// than believed, so most of what follows is an attempt to get a promotion out
// of it by the wrong route: with somebody else's canary, with a testnet one,
// with one nobody observed, with one that has gone stale, and with volume.
// Gates the task card marks "proved red" are labelled GATE-PROVED where they
// appear; each was broken deliberately, seen fail, and reverted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AGENT_CONTROL_CANARIES,
  CANARY_VALIDITY_DAYS,
  MAINNET_PROMOTION_REFUSALS,
  PROMOTABLE_CAPABILITIES,
  mainnetPerimeter,
  mainnetPromotion,
  promotableCapability,
} from "./mainnet-promotion.ts";

const source = readFileSync(new URL("./mainnet-promotion.ts", import.meta.url), "utf8");

const NOW = "2026-08-24T12:00:00.000Z";
const RECENT = "2026-08-20T12:00:00.000Z";

/** A canary that satisfies every requirement, for whichever capability is named. */
function perfect(id, overrides = {}) {
  const capability = promotableCapability(id);
  return {
    capability: id,
    network: capability.mainnetChainRef,
    submittedAt: RECENT,
    observedAt: RECENT,
    independentObservation: {
      source: "an explorer read that is not the submitting path",
      reference: "0x" + "a".repeat(64),
    },
    reconciliation: "MATCHED",
    ownerDecision: { decision: "PROMOTE", decidedBy: "owner:founder", policyVersion: "1.0.0" },
    ...overrides,
  };
}

/* ════════════════════════════════════════════ the shape of the thing itself */

test("the promotable set names, for each capability, the module and the mainnet it would need", () => {
  assert.ok(PROMOTABLE_CAPABILITIES.length >= 6, "a finish line covering fewer than six capabilities is not covering this product");
  assert.equal(Object.isFrozen(PROMOTABLE_CAPABILITIES), true);
  for (const capability of PROMOTABLE_CAPABILITIES) {
    assert.match(capability.id, /^[a-z][a-z0-9-]+$/, capability.id);
    assert.match(capability.mainnetChainRef, /^[a-z0-9-]+:[A-Za-z0-9-]+$/, capability.id + " needs a CAIP-2 mainnet reference");
    assert.ok(capability.module.length > 0, capability.id + " must name the module that owns it");
    assert.ok(
      capability.opensWith.length > 40,
      capability.id + " must name the exact record that would open it, not a slogan",
    );
  }
});

test("no promotable capability points at a testnet chain reference", () => {
  /* `eip155:84532` is Base Sepolia, `eip155:97` is BNB testnet, and
     `solana:EtWTRAB…` is Solana devnet. A mainnet gate whose target is a
     testnet id would pass its own check and mean nothing. */
  const testnets = ["eip155:84532", "eip155:97", "eip155:11155111"];
  for (const capability of PROMOTABLE_CAPABILITIES) {
    assert.equal(
      testnets.includes(capability.mainnetChainRef),
      false,
      capability.id + " names a testnet as its mainnet target",
    );
  }
});

/* ═══════════════════════════════════════════ nothing is promoted right now */

test("with no canary evidence at all, every capability is BLOCKED and says why", () => {
  const perimeter = mainnetPerimeter({ canaries: [], asOf: NOW });
  assert.equal(perimeter.state, "BLOCKED");
  assert.equal(perimeter.promotable, 0);
  assert.equal(perimeter.capabilities.length, PROMOTABLE_CAPABILITIES.length);
  for (const verdict of perimeter.capabilities) {
    assert.equal(verdict.state, "BLOCKED", verdict.capability);
    assert.deepEqual(verdict.refusals, ["NO_CANARY"], verdict.capability);
  }
});

test("the shipped canary set is empty, so the live answer is the one above", () => {
  /* FD-02 (2026-08-21) makes Base Sepolia the default execution rail, testnet
     only, no mainnet execution this phase. This constant is where that decision
     becomes a number rather than a paragraph: it is empty, and every surface
     that reads it says the same thing. */
  assert.deepEqual(AGENT_CONTROL_CANARIES, []);
  assert.equal(Object.isFrozen(AGENT_CONTROL_CANARIES), true);
  const live = mainnetPerimeter({ asOf: NOW });
  assert.equal(live.promotable, 0);
  assert.equal(live.blocked, PROMOTABLE_CAPABILITIES.length);
});

/* ═════════════════════════════════════ the gate is not a constant `BLOCKED` */

test("a canary that satisfies every requirement does promote its capability", () => {
  /* Without this the suite would pass with `state: BLOCKED` hardcoded, and a
     gate that can never open is not a gate — it is a wall with a test. */
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const verdict = mainnetPromotion({ capability: id, canaries: [perfect(id)], asOf: NOW });
  assert.equal(verdict.state, "PROMOTABLE");
  assert.deepEqual(verdict.refusals, []);
  assert.equal(verdict.evidence?.reconciliation, "MATCHED");
});

/* ══════════════════════════════════════════════ maturity is not inherited */

test("GATE-PROVED — one capability's canary never promotes another", () => {
  const [first, second] = PROMOTABLE_CAPABILITIES;
  const verdict = mainnetPromotion({
    capability: second.id,
    canaries: [perfect(first.id)],
    asOf: NOW,
  });
  assert.equal(verdict.state, "BLOCKED");
  assert.deepEqual(verdict.refusals, ["NO_CANARY"]);
});

test("GATE-PROVED — ten canaries for one capability do not promote an eleventh", () => {
  /* Volume is the shape this failure actually takes: a chain gets busy, a
     dashboard fills up, and somebody reads the total as coverage. */
  const [first, second] = PROMOTABLE_CAPABILITIES;
  const many = Array.from({ length: 10 }, () => perfect(first.id));
  const verdict = mainnetPromotion({ capability: second.id, canaries: many, asOf: NOW });
  assert.equal(verdict.state, "BLOCKED");
  assert.deepEqual(verdict.refusals, ["NO_CANARY"]);

  const perimeter = mainnetPerimeter({ canaries: many, asOf: NOW });
  assert.equal(perimeter.promotable, 1, "exactly the capability that earned it");
  assert.equal(perimeter.state, "BLOCKED", "the perimeter is open only when every capability is");
});

test("GATE-PROVED — a testnet canary never satisfies a mainnet promotion", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const verdict = mainnetPromotion({
    capability: id,
    canaries: [perfect(id, { network: "eip155:84532" })],
    asOf: NOW,
  });
  assert.equal(verdict.state, "BLOCKED");
  assert.ok(verdict.refusals.includes("CANARY_NETWORK_MISMATCH"), verdict.refusals.join(", "));
});

test("a canary on a different mainnet does not satisfy this capability's mainnet", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const other = PROMOTABLE_CAPABILITIES.find(
    (entry) => entry.mainnetChainRef !== PROMOTABLE_CAPABILITIES[0].mainnetChainRef,
  );
  assert.ok(other, "the promotable set must span more than one chain for this to mean anything");
  const verdict = mainnetPromotion({
    capability: id,
    canaries: [perfect(id, { network: other.mainnetChainRef })],
    asOf: NOW,
  });
  assert.equal(verdict.state, "BLOCKED");
  assert.ok(verdict.refusals.includes("CANARY_NETWORK_MISMATCH"));
});

/* ═══════════════════════════════════════ what a canary has to actually carry */

test("GATE-PROVED — a canary nobody observed independently satisfies nothing", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const verdict = mainnetPromotion({
    capability: id,
    canaries: [perfect(id, { independentObservation: null })],
    asOf: NOW,
  });
  assert.equal(verdict.state, "BLOCKED");
  assert.ok(verdict.refusals.includes("CANARY_NOT_INDEPENDENTLY_OBSERVED"));
});

test("an observation with no reference is not an observation", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const verdict = mainnetPromotion({
    capability: id,
    canaries: [perfect(id, { independentObservation: { source: "someone said so", reference: "" } })],
    asOf: NOW,
  });
  assert.ok(verdict.refusals.includes("CANARY_NOT_INDEPENDENTLY_OBSERVED"));
});

test("an unreconciled canary satisfies nothing, and a mismatched one is not silence", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  for (const reconciliation of ["PENDING", "MISMATCHED"]) {
    const verdict = mainnetPromotion({
      capability: id,
      canaries: [perfect(id, { reconciliation })],
      asOf: NOW,
    });
    assert.equal(verdict.state, "BLOCKED", reconciliation);
    assert.ok(verdict.refusals.includes("CANARY_NOT_RECONCILED"), reconciliation);
  }
});

test("GATE-PROVED — a stale canary expires rather than counting forever", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const stale = perfect(id, { observedAt: "2026-01-01T00:00:00.000Z", submittedAt: "2026-01-01T00:00:00.000Z" });
  const verdict = mainnetPromotion({ capability: id, canaries: [stale], asOf: NOW });
  assert.equal(verdict.state, "BLOCKED");
  assert.ok(verdict.refusals.includes("CANARY_EXPIRED"));
  assert.ok(CANARY_VALIDITY_DAYS > 0 && CANARY_VALIDITY_DAYS <= 90);
});

test("a canary observed in the future is refused rather than treated as fresh", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const verdict = mainnetPromotion({
    capability: id,
    canaries: [perfect(id, { observedAt: "2027-01-01T00:00:00.000Z" })],
    asOf: NOW,
  });
  assert.equal(verdict.state, "BLOCKED");
  assert.ok(verdict.refusals.includes("CANARY_EXPIRED"));
});

test("an owner who has not decided is not an owner who said yes", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  for (const ownerDecision of [null, { decision: "HOLD", decidedBy: "owner:founder", policyVersion: "1.0.0" }]) {
    const verdict = mainnetPromotion({ capability: id, canaries: [perfect(id, { ownerDecision })], asOf: NOW });
    assert.equal(verdict.state, "BLOCKED");
    assert.ok(verdict.refusals.includes("OWNER_DECISION_MISSING"));
  }
});

test("an owner decision with no decider and no policy version is not a decision", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const verdict = mainnetPromotion({
    capability: id,
    canaries: [perfect(id, { ownerDecision: { decision: "PROMOTE", decidedBy: "", policyVersion: "" } })],
    asOf: NOW,
  });
  assert.ok(verdict.refusals.includes("OWNER_DECISION_MISSING"));
});

/* ═══════════════════════════════════════════════════ refusals and fail-closed */

test("every refusal the module can answer with is in the declared vocabulary", () => {
  assert.equal(Object.isFrozen(MAINNET_PROMOTION_REFUSALS), true);
  const id = PROMOTABLE_CAPABILITIES[0].id;
  const broken = perfect(id, {
    network: "eip155:84532",
    independentObservation: null,
    reconciliation: "PENDING",
    observedAt: "2026-01-01T00:00:00.000Z",
    ownerDecision: null,
  });
  const verdict = mainnetPromotion({ capability: id, canaries: [broken], asOf: NOW });
  assert.equal(verdict.state, "BLOCKED");
  assert.ok(verdict.refusals.length >= 4, "a canary wrong in five ways reports more than one reason");
  for (const refusal of verdict.refusals) {
    assert.ok(MAINNET_PROMOTION_REFUSALS.includes(refusal), refusal + " is not in the vocabulary");
  }
});

test("garbage is refused rather than coerced into a promotion", () => {
  const id = PROMOTABLE_CAPABILITIES[0].id;
  for (const canary of [null, undefined, 7, "canary", {}, { capability: id }]) {
    const verdict = mainnetPromotion({ capability: id, canaries: [canary], asOf: NOW });
    assert.equal(verdict.state, "BLOCKED", JSON.stringify(canary ?? null));
  }
});

test("an unknown capability throws rather than answering about nothing", () => {
  assert.throws(() => mainnetPromotion({ capability: "not-a-capability", canaries: [], asOf: NOW }));
  assert.throws(() => promotableCapability("not-a-capability"));
});

/* ═════════════════════════════════════ the module states no maturity itself */

test("the module carries no maturity word of its own", () => {
  /* Only the capability registry may say `live`. A promotion gate that also
     carried the word would be a second place for it to live, which is how the
     two start disagreeing. */
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const word of ['"live"', '"production"', '"ga"', '"stable"']) {
    assert.equal(stripped.toLowerCase().includes(word), false, "the gate must not carry " + word);
  }
});
