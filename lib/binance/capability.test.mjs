// Run from repo root: node --test lib/binance/capability.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BINANCE_MCP_CAPABILITIES,
  BINANCE_MCP_AGENTIC_ACCOUNT,
  BINANCE_B402_FACILITATOR,
  BINANCE_SURFACE_CUSTODY,
  FORBIDDEN_BINANCE_SURFACE_CLAIMS,
  capabilityById,
  assertClaimAllowed,
} from "./capability.ts";
import { capabilityTone } from "../domain/capability.ts";

/**
 * The custody axes are recorded on the SURFACE, not on the provider. Binance operates both a
 * provider-custodied agentic account and a non-custodial payment facilitator, and a single
 * "Binance is custodial" flag would be wrong about one of them. Four separate fields make the
 * distinction impossible to lose.
 */
test("the Agentic account surface states all four custody axes explicitly", () => {
  assert.equal(BINANCE_MCP_AGENTIC_ACCOUNT.id, "BINANCE_MCP_AGENTIC_ACCOUNT");
  assert.equal(BINANCE_MCP_AGENTIC_ACCOUNT.custodyModel, "PROVIDER_CUSTODY");
  assert.equal(BINANCE_MCP_AGENTIC_ACCOUNT.authorizationSurface, "PROVIDER_CONFIRMATION");
  assert.equal(BINANCE_MCP_AGENTIC_ACCOUNT.providerBoundary, "AGENTIC_SUBACCOUNT");
  assert.equal(BINANCE_MCP_AGENTIC_ACCOUNT.withdrawalCapability, "UNAVAILABLE_TO_AGENT");
});

test("the B402 facilitator surface states the opposite axes, and both surfaces are registered", () => {
  assert.equal(BINANCE_B402_FACILITATOR.id, "BINANCE_B402_FACILITATOR");
  assert.equal(BINANCE_B402_FACILITATOR.custodyModel, "SELF_CUSTODY");
  assert.equal(BINANCE_B402_FACILITATOR.authorizationSurface, "WALLET_SIGNATURE");
  assert.equal(BINANCE_B402_FACILITATOR.providerBoundary, "NONCUSTODIAL_FACILITATOR");
  assert.equal(BINANCE_B402_FACILITATOR.withdrawalCapability, "NOT_APPLICABLE");

  /* Three of the four axes disagree with the Agentic sub-account. That is the
     whole reason custody is recorded per surface, and it is asserted rather
     than described so a later edit cannot quietly align them. */
  const differing = ["custodyModel", "authorizationSurface", "providerBoundary", "withdrawalCapability"].filter(
    (axis) => BINANCE_B402_FACILITATOR[axis] !== BINANCE_MCP_AGENTIC_ACCOUNT[axis],
  );
  assert.equal(differing.length, 4, "the two surfaces must not converge on any custody axis");

  assert.equal(BINANCE_SURFACE_CUSTODY.length, 2);
  assert.equal(new Set(BINANCE_SURFACE_CUSTODY.map((surface) => surface.id)).size, 2);
  for (const surface of BINANCE_SURFACE_CUSTODY) {
    assert.ok(surface.evidence.length > 0, `${surface.id} carries no source`);
    /* An external claim needs a date; a repository fixture is dated by the
       commit that holds it, so only the `docs:` lines are checked here. */
    const external = surface.evidence.filter((line) => line.startsWith("docs:"));
    assert.ok(external.length > 0, `${surface.id} rests on no external source`);
    for (const line of external) {
      assert.match(line, /\(\d{4}-\d{2}-\d{2}\)$/, `${surface.id} evidence is undated: ${line}`);
    }
  }
});

test("the self-custody claim gate applies to the surface it is asked about, not to the provider", () => {
  /* The gate refuses self-custody copy where funds are provider-held and allows
     it where they are not. A gate keyed on the word "Binance" would refuse both,
     which is how a true sentence gets deleted for looking like a false one. */
  assert.throws(() => assertClaimAllowed(BINANCE_MCP_AGENTIC_ACCOUNT, "Self-custody"), /provider custody/i);
  assert.doesNotThrow(() => assertClaimAllowed(BINANCE_B402_FACILITATOR, "Self-custody"));
  assert.doesNotThrow(() =>
    assertClaimAllowed(
      BINANCE_B402_FACILITATOR,
      "The buyer signs from their own wallet and Binance never holds the funds.",
    ),
  );
});

/**
 * A provider-custodied surface may not carry self-custody copy. This is the exact sentence the
 * non-custodial wallet surfaces use, and shipping it here would be a false claim about who
 * holds the funds.
 */
test("self-custody copy is refused on a provider-custody surface", () => {
  assert.ok(FORBIDDEN_BINANCE_SURFACE_CLAIMS.length > 0);
  for (const claim of FORBIDDEN_BINANCE_SURFACE_CLAIMS) {
    assert.throws(
      () => assertClaimAllowed(BINANCE_MCP_AGENTIC_ACCOUNT, claim),
      /provider custody/i,
      `"${claim}" must be refused on a PROVIDER_CUSTODY surface`,
    );
  }
  assert.doesNotThrow(() =>
    assertClaimAllowed(BINANCE_MCP_AGENTIC_ACCOUNT, "Funds stay in a Binance-custodied Agentic sub-account."),
  );
});

test("no capability grants the agent a withdrawal", () => {
  for (const capability of BINANCE_MCP_CAPABILITIES) {
    assert.notEqual(capability.scope, "withdrawal", `${capability.id} must not declare a withdrawal scope`);
    assert.ok(
      !/withdraw/i.test(capability.id),
      `${capability.id} names a withdrawal capability, which this surface does not have`,
    );
  }
});

/**
 * This packet is read-only discovery. Nothing in it has been implemented against, so no record
 * may claim Ryntra ships it — `ryntra: "live"` is the state that lets a capability tone green.
 */
test("discovery registers nothing as shipped by Ryntra", () => {
  for (const capability of BINANCE_MCP_CAPABILITIES) {
    assert.notEqual(capability.state.ryntra, "live", `${capability.id} claims a shipped Ryntra capability`);
    assert.notEqual(capabilityTone(capability.state), "ok", `${capability.id} tones green off discovery alone`);
  }
});

test("every capability carries a dated, named source", () => {
  for (const capability of BINANCE_MCP_CAPABILITIES) {
    assert.match(capability.state.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["live-probe", "official-docs", "derived", "unverified"].includes(capability.state.source));
    assert.ok(capability.evidence.length > 0, `${capability.id} has no evidence reference`);
  }
});

/**
 * The tool inventory is behind OAuth: `tools/list` returned 401. Anything derived from the tool
 * list is therefore documentation-sourced at best, and claiming a live probe of it would be a
 * claim about a call that never succeeded.
 */
test("capabilities that were never reached over MCP do not claim a live probe", () => {
  for (const capability of BINANCE_MCP_CAPABILITIES) {
    if (capability.reachedOverMcp) continue;
    assert.notEqual(
      capability.state.source,
      "live-probe",
      `${capability.id} was not reached over MCP but claims a live probe`,
    );
  }
});

/**
 * Two different facts, and collapsing them would make an owner-gated capability look public.
 * The handshake is open to anyone; the tool inventory needed the founder to authorize an account.
 */
test("only the handshake capabilities were reached without credentials", () => {
  const open = BINANCE_MCP_CAPABILITIES.filter((c) => c.reachedWithoutCredentials).map((c) => c.id).sort();
  assert.deepEqual(open, ["MCP_INITIALIZE", "MCP_SERVER_INSTRUCTIONS"]);

  const reached = BINANCE_MCP_CAPABILITIES.filter((c) => c.reachedOverMcp).map((c) => c.id).sort();
  assert.deepEqual(reached, [
    "MCP_ACCOUNT_READ",
    "MCP_INITIALIZE",
    "MCP_MAIN_ACCOUNT_READONLY_VIEW",
    "MCP_RESOURCE_INVENTORY",
    "MCP_SERVER_INSTRUCTIONS",
    "MCP_TOOL_INVENTORY",
    "MCP_TOOL_SEARCH",
  ]);

  // Every write capability stays unreached. That is the boundary of all three packets.
  for (const capability of BINANCE_MCP_CAPABILITIES) {
    if (capability.scope === "trade" || capability.scope === "transfer") {
      assert.equal(capability.reachedOverMcp, false, `${capability.id} must never have been exercised`);
    }
  }

  // Reaching something without credentials implies reaching it at all.
  for (const capability of BINANCE_MCP_CAPABILITIES) {
    if (capability.reachedWithoutCredentials) {
      assert.equal(capability.reachedOverMcp, true, `${capability.id} is incoherent`);
    }
  }
});

test("capability lookup is exact and fails loudly on an unknown id", () => {
  assert.equal(capabilityById("MCP_INITIALIZE").id, "MCP_INITIALIZE");
  assert.throws(() => capabilityById("MCP_PLACE_ORDER"), /unknown capability/i);
});

/**
 * The four scopes named by Binance's own documentation. Recording them as a closed set is what
 * lets a later packet detect that the provider added one.
 */
test("the documented scope set is closed and contains no withdrawal", () => {
  const scopes = new Set(BINANCE_MCP_CAPABILITIES.map((c) => c.scope));
  for (const scope of scopes) {
    assert.ok(
      ["none", "market-data", "account", "trade", "transfer"].includes(scope),
      `${scope} is not one of the documented Binance MCP scopes`,
    );
  }
});
