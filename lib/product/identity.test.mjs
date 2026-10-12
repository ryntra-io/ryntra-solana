// Run from repo root: node --test lib/product/identity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_LIFECYCLE,
  DECISION_DISPOSITIONS,
  INDEPENDENT_STATE_AXES,
  MINIMUM_PRODUCT_LOOP,
  PRODUCT_IDENTITY,
} from "./identity.ts";

test("company, Workspace, and developer identities stay distinct", () => {
  // The product positions by audience. The regression this guards is the one the
  // provisional Guard-only projection actually shipped: the company category
  // being replaced by the developer-surface category on consumer surfaces.
  assert.equal(PRODUCT_IDENTITY.category, "Risk, Strategy & Evidence OS");
  assert.equal(PRODUCT_IDENTITY.guardCategory, "Decision & Settlement Evidence Layer");
  assert.notEqual(PRODUCT_IDENTITY.category, PRODUCT_IDENTITY.guardCategory);
  assert.equal(
    PRODUCT_IDENTITY.companyIdentity,
    "Ryntra is a venue-neutral Risk, Strategy & Evidence OS for programmable assets.",
  );
  assert.equal(PRODUCT_IDENTITY.kernel, "Ryntra Evidence Kernel");
  assert.match(PRODUCT_IDENTITY.workspaceRole, /human-facing product and reference implementation/i);
  assert.match(PRODUCT_IDENTITY.workspaceRole, /same Evidence Kernel/i);
});

test("the public identity is venue-neutral and preserves the exact trust contract", () => {
  assert.equal(PRODUCT_IDENTITY.hero, "Know whether this action is ready — and preserve the evidence.");
  assert.equal(PRODUCT_IDENTITY.motto, "Plan. Prove. Improve.");
  assert.equal(
    PRODUCT_IDENTITY.trustLine,
    "Non-custodial. Paper-first. Human-authorized. No profit promises.",
  );
  assert.match(PRODUCT_IDENTITY.modeRelationship, /Observe, Guard, and Evidence/);
  assert.match(PRODUCT_IDENTITY.modeRelationship, /Workspace Simple and Pro/);
  assert.match(PRODUCT_IDENTITY.arcusBoundary, /first shipped adapter/i);
  assert.match(PRODUCT_IDENTITY.arcusBoundary, /not the Ryntra brand boundary/i);
  assert.match(PRODUCT_IDENTITY.publicMaturityLine, /not deployed or live-transaction verified/i);
  /* The projection carries exactly these constants; the identity, network
     boundary, description and audience line of the earlier product left it. */
  assert.deepEqual(Object.keys(PRODUCT_IDENTITY), [
    "category",
    "companyIdentity",
    "kernel",
    "workspaceRole",
    "guardCategory",
    "hero",
    "motto",
    "modeRelationship",
    "trustLine",
    "arcusBoundary",
    "publicMaturityLine",
    "northStar",
  ]);
});

test("canonical lifecycle and the four independent axes are exact", () => {
  assert.deepEqual(CANONICAL_LIFECYCLE, [
    "Observe",
    "Verify Evidence",
    "Plan",
    "Decide",
    "Authorize",
    "Execute",
    "Reconcile",
    "Journal",
    "Improve",
  ]);
  assert.deepEqual(INDEPENDENT_STATE_AXES, [
    "evidenceStatus",
    "policyDecision",
    "executionStatus",
    "reconciliationStatus",
  ]);
});

test("minimum loop and WRRD meaning are exact", () => {
  assert.deepEqual(DECISION_DISPOSITIONS, ["no_trade", "paper", "manual", "live"]);
  assert.deepEqual(MINIMUM_PRODUCT_LOOP, [
    "StrategySpec",
    "deterministic readiness",
    "no_trade | paper | manual | live",
    "DecisionReceipt",
    "ReviewRecord",
    "human-approved next StrategySpec",
  ]);
  assert.equal(PRODUCT_IDENTITY.northStar.label, "Workspace Weekly Risk-Reviewed Decisions");
  assert.match(PRODUCT_IDENTITY.northStar.definition, /not trade count, volume, profit, referrals, or AI calls/i);
});
