// Run from repo root: node --test lib/product/canon.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_LIFECYCLE,
  DECISION_DISPOSITIONS,
  INDEPENDENT_STATE_AXES,
  MINIMUM_PRODUCT_LOOP,
  PRODUCT_CANON,
} from "./canon.ts";

test("company, Workspace, and developer identities stay distinct", () => {
  // The product positions by audience. The regression this guards is the one the
  // provisional Guard-only projection actually shipped: the company category
  // being replaced by the developer-surface category on consumer surfaces.
  assert.equal(PRODUCT_CANON.category, "Risk, Strategy & Evidence OS");
  assert.equal(PRODUCT_CANON.guardCategory, "Decision & Settlement Evidence Layer");
  assert.notEqual(PRODUCT_CANON.category, PRODUCT_CANON.guardCategory);
  assert.equal(
    PRODUCT_CANON.companyIdentity,
    "Ryntra is a venue-neutral Risk, Strategy & Evidence OS for programmable assets.",
  );
  assert.equal(PRODUCT_CANON.kernel, "Ryntra Evidence Kernel");
  assert.match(PRODUCT_CANON.workspaceRole, /human-facing product and reference implementation/i);
  assert.match(PRODUCT_CANON.workspaceRole, /same Evidence Kernel/i);
});

test("the public identity is venue-neutral and preserves the exact trust contract", () => {
  assert.equal(PRODUCT_CANON.hero, "Know whether this action is ready — and preserve the evidence.");
  assert.equal(PRODUCT_CANON.motto, "Plan. Prove. Improve.");
  assert.equal(
    PRODUCT_CANON.trustLine,
    "Non-custodial. Paper-first. Human-authorized. No profit promises.",
  );
  assert.match(PRODUCT_CANON.modeRelationship, /Observe, Guard, and Evidence/);
  assert.match(PRODUCT_CANON.modeRelationship, /Workspace Simple and Pro/);
  assert.match(PRODUCT_CANON.arcusBoundary, /first shipped adapter/i);
  assert.match(PRODUCT_CANON.arcusBoundary, /not the Ryntra brand boundary/i);
  assert.match(PRODUCT_CANON.publicMaturityLine, /not deployed or live-transaction verified/i);
  /* The projection carries exactly these constants; the identity, network
     boundary, description and audience line of the earlier product left it. */
  assert.deepEqual(Object.keys(PRODUCT_CANON), [
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
  assert.equal(PRODUCT_CANON.northStar.label, "Workspace Weekly Risk-Reviewed Decisions");
  assert.match(PRODUCT_CANON.northStar.definition, /not trade count, volume, profit, referrals, or AI calls/i);
});
