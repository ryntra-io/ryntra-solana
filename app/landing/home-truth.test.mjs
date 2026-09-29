import assert from "node:assert/strict";
import test from "node:test";

import { HOME_CARD_RULES, isHomeCardConfirmed } from "./home-truth.ts";

const base = {
  id: "x",
  label: "x",
  maturity: "live",
  mode: "supported_live",
  scopeLabel: "x",
  lastVerifiedAt: "2026-08-04",
  freshness: "fresh",
  truthTone: "positive",
  limitation: "x",
};

test("home cards accept their honest steady registry states", () => {
  // Arcus spot legitimately carries caution (per-user eligibility varies).
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", { ...base, truthTone: "caution" }), true);
  assert.equal(isHomeCardConfirmed("rwa-risk-pack", { ...base, mode: "read_only", truthTone: "positive" }), true);
  // Paper capabilities are neutral by nature and stay confirmed in paper mode.
  assert.equal(
    isHomeCardConfirmed("smarttrade-plan", { ...base, maturity: "paper", mode: "paper_only", truthTone: "neutral" }),
    true,
  );
  assert.equal(
    isHomeCardConfirmed("decision-journal", { ...base, maturity: "paper", mode: "paper_only", truthTone: "neutral" }),
    true,
  );
});

test("home cards fail closed on stale, unknown, conflicting, danger, wrong maturity, or missing", () => {
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", { ...base, freshness: "stale" }), false);
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", { ...base, freshness: "unknown" }), false);
  assert.equal(isHomeCardConfirmed("rwa-risk-pack", { ...base, freshness: "conflicting" }), false);
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", { ...base, truthTone: "danger" }), false);
  assert.equal(isHomeCardConfirmed("smarttrade-plan", { ...base, maturity: "planned", truthTone: "neutral" }), false);
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", { ...base, maturity: "paper" }), false);
  // Mode is mandatory: a capability whose execution mode collapsed to "none"
  // can never present as working, whatever its other fields say.
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", { ...base, mode: "none" }), false);
  assert.equal(isHomeCardConfirmed("smarttrade-plan", { ...base, maturity: "paper", mode: "none", truthTone: "neutral" }), false);
  assert.equal(isHomeCardConfirmed("rwa-risk-pack", { ...base, mode: "paper_only" }), false);
  assert.equal(isHomeCardConfirmed("arcus-spot-rfq", undefined), false);
  assert.equal(isHomeCardConfirmed("unknown-card", base), false);
});

test("every rule keeps freshness mandatory and never accepts danger", () => {
  for (const [id, rule] of Object.entries(HOME_CARD_RULES)) {
    assert.ok(!rule.tones.includes("danger"), id + " must never accept danger");
    assert.equal(isHomeCardConfirmed(id, { ...base, maturity: rule.maturity[0], truthTone: rule.tones[0], freshness: "stale" }), false);
  }
});

test("public maturity is read from the registry and can never overstate", async () => {
  const { publicMaturity } = await import("./home-truth.ts");

  // Each id resolves to the maturity the registry holds, whatever the caller says.
  const live = "arcus-spot-rfq";     // registry: live
  const paper = "decision-journal";  // registry: paper
  const planned = "risk-readiness-scanner"; // registry: planned

  assert.equal(publicMaturity(live, { ...base, id: live, maturity: "live" }), "live");
  assert.equal(publicMaturity(paper, { ...base, id: paper, maturity: "paper" }), "paper");
  assert.equal(publicMaturity(planned, { ...base, id: planned, maturity: "planned" }), "planned");

  // Fail closed: no entry, a mismatched id, an unregistered id, or stale
  // evidence yields null so the caller renders "unverified" rather than guess.
  assert.equal(publicMaturity(live, undefined), null);
  assert.equal(publicMaturity("other-id", { ...base, id: live, maturity: "live" }), null);
  assert.equal(publicMaturity("x", { ...base, id: "x", maturity: "live" }), null);
  assert.equal(publicMaturity(live, { ...base, id: live, freshness: "stale" }), null);
  assert.equal(publicMaturity(live, { ...base, id: live, freshness: "missing" }), null);
});

test("every home card id exists in the registry, not merely as a well-formed slug", async () => {
  const { PUBLIC_CAPABILITIES } = await import("../../lib/product/capabilities.ts");
  const registryIds = new Set(PUBLIC_CAPABILITIES.map((capability) => capability.id));
  for (const id of Object.keys(HOME_CARD_RULES)) {
    assert.ok(registryIds.has(id), `home card rule points at an unregistered capability: ${id}`);
  }
});

test("a caller cannot promote a capability by supplying a better maturity", async () => {
  const { publicMaturity } = await import("./home-truth.ts");

  // The exact attack this gate exists to stop: the unreleased scanner arriving
  // with maturity "live". The registry says planned, so the claim must not stand
  // — and because the two disagree, the honest answer is null, not a downgrade.
  const promoted = { ...base, id: "risk-readiness-scanner", maturity: "live" };
  assert.equal(publicMaturity("risk-readiness-scanner", promoted), null);

  // Same for a paper capability dressed up as live.
  assert.equal(publicMaturity("decision-journal", { ...base, id: "decision-journal", maturity: "live" }), null);

  // A capability that exists nowhere in the registry is never believed.
  const forged = { ...base, id: "totally-made-up", maturity: "live" };
  assert.equal(publicMaturity("totally-made-up", forged), null);

  // A maturity value outside the registry vocabulary is rejected too.
  assert.equal(publicMaturity("arcus-spot-rfq", { ...base, id: "arcus-spot-rfq", maturity: "shipped" }), null);
});

test("the rendered badge value is the registry's, not the argument's", async () => {
  const { publicMaturity } = await import("./home-truth.ts");
  const { PUBLIC_CAPABILITIES } = await import("../../lib/product/capabilities.ts");

  // Every registered capability must round-trip to its own registry maturity.
  for (const capability of PUBLIC_CAPABILITIES) {
    const resolved = publicMaturity(capability.id, {
      ...base,
      id: capability.id,
      maturity: capability.maturity,
    });
    assert.equal(resolved, capability.maturity, `${capability.id} must resolve to its registry maturity`);
  }
});
