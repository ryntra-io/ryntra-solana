import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OBSERVED_EXTERNALLY_CAPABILITIES,
  RYNTRA_ROBINHOOD_MCP_TOPOLOGY,
  assertEnforcementClaim,
  capabilitiesFor,
  enforcementModeFor,
} from "./enforcement.ts";

test("only a path that physically runs through a Ryntra adapter is ENFORCED_THROUGH_RYNTRA", function () {
  assert.equal(enforcementModeFor("AGENT_THROUGH_RYNTRA_ADAPTER"), "ENFORCED_THROUGH_RYNTRA");
  assert.equal(enforcementModeFor("AGENT_DIRECT_TO_PROVIDER"), "OBSERVED_EXTERNALLY");
  assert.equal(enforcementModeFor("NO_PATH"), "OBSERVED_EXTERNALLY");
});

test("the user's own provider MCP client is observed, never enforced", function () {
  /* The provider says so itself, and it is the sentence that decides this whole
     module: "Robinhood does not control, supervise, monitor, recommend, or audit
     these AI agents." Neither does Ryntra, when the agent talks to Robinhood
     directly. */
  const mode = enforcementModeFor("AGENT_DIRECT_TO_PROVIDER");
  assert.equal(mode, "OBSERVED_EXTERNALLY");
  assert.deepEqual(capabilitiesFor(mode), ["observe", "import", "reconcile", "alert"]);
  assert.deepEqual([...OBSERVED_EXTERNALLY_CAPABILITIES], ["observe", "import", "reconcile", "alert"]);
});

test("an enforced path may do more than observe, and the two lists are different", function () {
  const enforced = capabilitiesFor("ENFORCED_THROUGH_RYNTRA");
  assert.ok(enforced.includes("preflight"));
  assert.ok(enforced.includes("refuse"));
  assert.notDeepEqual(enforced, capabilitiesFor("OBSERVED_EXTERNALLY"));
});

test("claiming enforcement on a path that does not run through Ryntra throws", function () {
  assert.throws(
    function () { assertEnforcementClaim("ENFORCED_THROUGH_RYNTRA", "AGENT_DIRECT_TO_PROVIDER"); },
    /ENFORCED_THROUGH_RYNTRA/,
  );
  assert.throws(
    function () { assertEnforcementClaim("ENFORCED_THROUGH_RYNTRA", "NO_PATH"); },
    /ENFORCED_THROUGH_RYNTRA/,
  );
  /* The honest direction never throws: observing a path you could have enforced
     understates the control and is safe. */
  assert.doesNotThrow(function () {
    assertEnforcementClaim("OBSERVED_EXTERNALLY", "AGENT_THROUGH_RYNTRA_ADAPTER");
  });
  assert.doesNotThrow(function () {
    assertEnforcementClaim("ENFORCED_THROUGH_RYNTRA", "AGENT_THROUGH_RYNTRA_ADAPTER");
  });
});

test("Ryntra's own topology on this surface is NO_PATH, so nothing here may claim enforcement", function () {
  assert.equal(RYNTRA_ROBINHOOD_MCP_TOPOLOGY, "NO_PATH");
  assert.equal(enforcementModeFor(RYNTRA_ROBINHOOD_MCP_TOPOLOGY), "OBSERVED_EXTERNALLY");
  assert.throws(function () {
    assertEnforcementClaim("ENFORCED_THROUGH_RYNTRA", RYNTRA_ROBINHOOD_MCP_TOPOLOGY);
  });
});

test("no module in this package builds a Robinhood adapter path", function () {
  /* The topology constant above is only true while no code reaches the venue.
     A `fetch` to agent.robinhood.com anywhere in the register would make it a
     lie, so the absence is asserted rather than assumed. The one permitted
     outbound is the reachability probe, which asks whether the door is shut and
     carries no caller input and no credential. */
  for (const file of ["enforcement.ts", "capability.ts", "custody.ts", "preflight.ts", "tool-inventory.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/\bfetch\s*\(/.test(source), file + " must not reach the network");
  }
});
