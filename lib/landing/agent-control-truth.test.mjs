// Run from repo root: node --test lib/landing/agent-control-truth.test.mjs
//
// The gate that was missing.
//
// Before this file, `app/(home)/data.ts` held a hand-written capability map
// that printed `LIVE` beside two Agent Control rows while every Agent Control
// entry in the registry said `preview`. Both facts were in the repository at
// the same time and nothing compared them, so the stronger one shipped.
//
// Each test here fails on a specific way that can happen again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  capabilityAxes,
  getPublicCapabilitiesForSurface,
  CAPABILITY_ENFORCEMENTS,
} from "../product/capabilities.ts";
import { AGENT_CONTROL_DOD_CHECKS } from "../product/agent-control-truth.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const kernelSource = () =>
  readdirSync(new URL("../agent-control/", import.meta.url))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => read(`../agent-control/${name}`))
    .join("\n");

/**
 * Does the kernel carry an enforcement grade?
 *
 * The first version of this asked whether the word "enforcement" appeared, and
 * it came back true — from a comment in `store.ts` about immutability needing
 * no separate enforcement. A grade in the kernel does not look like prose; it
 * looks like one of the canonical values being written down. So the question is
 * asked in the only form that can answer it.
 */
const kernelHasEnforcementGrade = (source) =>
  CAPABILITY_ENFORCEMENTS.some((grade) => new RegExp(`["'\`]${grade}["'\`]`).test(source));

test("every Agent Control capability declares its axes rather than deriving them", () => {
  const capabilities = getPublicCapabilitiesForSurface("agent_control");
  assert.ok(capabilities.length >= 8, "the surface lost capabilities");
  for (const capability of capabilities) {
    assert.ok(capability.axes, `${capability.id} has no explicit axes`);
    const axes = capabilityAxes(capability);
    assert.ok(
      axes.knownBypass.length > 0,
      `${capability.id} claims no bypass route exists; silence is not that claim`,
    );
  }
});

test("no Agent Control capability claims enforcement while the kernel has no enforcement field", () => {
  // The claim and the code that would justify it, checked together. When
  // enforcement becomes a policy-engine field this test is what tells you the
  // registry may now say so.
  const kernelEnforces = kernelHasEnforcementGrade(kernelSource());

  for (const capability of getPublicCapabilitiesForSurface("agent_control")) {
    const { enforcement } = capabilityAxes(capability);
    if (kernelEnforces) continue;
    assert.equal(
      enforcement,
      "OBSERVE_ONLY",
      `${capability.id} claims ${enforcement} but the kernel has no enforcement field`,
    );
  }
});

test("the landing holds capability ids, not status words, for Agent Control", () => {
  const data = read("../../app/(home)/data.ts");
  const section = data.slice(data.indexOf("── 03 — Agent Control"), data.indexOf("── 04"));
  assert.ok(section.length > 0, "the Agent Control section moved; update this gate");

  // The hand-written map is gone. If it ever returns, it may hold ids and
  // labels — never a maturity word, because that answer lives in the registry.
  for (const word of ["|LIVE", "|BUILDING", "|PLANNED", "|GATED"]) {
    assert.ok(
      !section.includes(word),
      `the Agent Control data still hard-codes ${word}; status belongs to the registry`,
    );
  }
  assert.ok(
    !data.includes("export const AGENT_GROUPS"),
    "AGENT_GROUPS is back; the capability map reads from the registry now",
  );
});

test("Agent Control networks are not decorative badges", () => {
  const data = read("../../app/(home)/data.ts");
  assert.ok(
    !/AGENT_NETS\s*=\s*\[\s*"BASE"/.test(data),
    "AGENT_NETS is a bare string list again; every network needs environment and enforcement",
  );
});

test("the forbidden short-form enforcement grades stay out of the codebase", () => {
  // Canon v5.2 keeps the long names because the short ones read as stronger
  // than they are. The vocabulary is the only place that can hold this line.
  for (const grade of CAPABILITY_ENFORCEMENTS) {
    assert.ok(grade.length > 0);
  }
  const registry = read("../product/capabilities.ts");
  for (const short of ["PROVIDER_ENFORCED", "WALLET_ENFORCED", "CONTRACT_ENFORCED"]) {
    const pattern = new RegExp(`"${short}"`);
    assert.ok(!pattern.test(registry), `${short} is not a canonical grade`);
  }
});

test("Definition-of-Done checks match what the repository actually contains", () => {
  const byId = Object.fromEntries(AGENT_CONTROL_DOD_CHECKS.map((check) => [check.id, check]));

  const canonical = read("../agent-control/canonical.ts");
  assert.equal(
    byId["frozen-serialization"].passed,
    /frozen/i.test(canonical),
    "frozen-serialization disagrees with lib/agent-control/canonical.ts",
  );

  const kernelNames = readdirSync(new URL("../agent-control/", import.meta.url));
  assert.equal(
    byId["independent-verifier"].passed,
    kernelNames.includes("verify.ts"),
    "independent-verifier disagrees with the presence of lib/agent-control/verify.ts",
  );
  assert.equal(
    byId["exact-action-auth"].passed,
    kernelNames.includes("authorization.ts"),
    "exact-action-auth disagrees with the presence of lib/agent-control/authorization.ts",
  );

  // The two failing checks are the honest part: they must stay false until the
  // code that would justify them exists.
  assert.equal(
    byId["recovery-case"].passed,
    kernelNames.includes("recovery.ts"),
    "recovery-case passed without a recovery module",
  );

  assert.equal(
    byId["enforcement-in-kernel"].passed,
    kernelHasEnforcementGrade(kernelSource()),
    "enforcement-in-kernel disagrees with the kernel source",
  );
});

test("verification coverage is a ratio over blocking checks, never a product percentage", () => {
  const passed = AGENT_CONTROL_DOD_CHECKS.filter((check) => check.passed).length;
  assert.ok(passed < AGENT_CONTROL_DOD_CHECKS.length, "no blocker left; re-read the DoD before promoting");
  const failing = AGENT_CONTROL_DOD_CHECKS.filter((check) => !check.passed);
  for (const check of failing) {
    assert.ok(check.blocker, `${check.id} fails without naming why`);
  }
});
