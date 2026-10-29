// Run from repo root: node --test lib/agent-control/external/agent-registry.test.mjs
//
// Everything prepared, nothing registered. The tests are mostly about absence:
// no path that registers, no wallet filled in from configuration, no price
// printed as though somebody had re-checked it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { A2A_CARD_PATHS, A2A_INTERFACE_PATH } from "../a2a/card.ts";
import { AGENT_MCP_PATH } from "../oauth/metadata.ts";
import {
  REGISTERED_CAPABILITIES,
  REGISTRATION_IS_SOMEBODY_ELSES_ACT,
  RYNTRA_BUILDS_NO_AGENT_REGISTRY,
  SOLANA_AGENT_REGISTRY,
  registrationReadiness,
} from "./agent-registry.ts";

const ORIGIN = "https://ryntra.io";

test("we build no registry of our own, and we register nothing either", () => {
  assert.equal(RYNTRA_BUILDS_NO_AGENT_REGISTRY, true);
  assert.equal(REGISTRATION_IS_SOMEBODY_ELSES_ACT, true);
  /* The constants are the statement; the source is the proof. A module that
     could register would have to reach a chain, and nothing here does. */
  const source = readFileSync(new URL("./agent-registry.ts", import.meta.url), "utf8");
  for (const word of ["sendTransaction", "signTransaction", "Keypair", "fetch(", "Connection("]) {
    assert.ok(!source.includes(word), `the module reaches for ${word}`);
  }
});

test("registerable is false and no input makes it true", () => {
  for (const origin of [ORIGIN, null, "http://ryntra.io", "ryntra.io"]) {
    assert.equal(registrationReadiness({ origin }).registerable, false, String(origin));
  }
});

test("the blockers name every step that is not this code's to take", () => {
  const { blockers } = registrationReadiness({ origin: ORIGIN });
  const codes = blockers.map((blocker) => blocker.code);
  for (const code of [
    "OWNER_HAS_NOT_SAID_TO_REGISTER",
    "REGISTRATION_WALLET_NOT_CHOSEN",
    "REGISTRATION_FEE_NOT_CONFIRMED",
    "CARD_NOT_SIGNED",
  ]) {
    assert.ok(codes.includes(code), `${code} is not among the blockers`);
  }
  assert.ok(!codes.includes("ORIGIN_UNKNOWN"), "a known origin is not a blocker");
  for (const blocker of blockers) {
    assert.ok(blocker.detail.length > 40, `${blocker.code} is stated without a reason`);
  }
});

test("without an origin there is no dossier, because an entry needs absolute addresses", () => {
  const readiness = registrationReadiness({ origin: null });
  assert.equal(readiness.dossier, null);
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "ORIGIN_UNKNOWN"));
});

test("the dossier points at addresses this deployment actually serves", () => {
  const { dossier } = registrationReadiness({ origin: ORIGIN });
  const byField = new Map(dossier.entries.map((entry) => [entry.field, entry]));
  assert.equal(byField.get("agentCard").value, `${ORIGIN}${A2A_CARD_PATHS.current}`);
  assert.equal(byField.get("agentCardLegacyPath").value, `${ORIGIN}${A2A_CARD_PATHS.legacy}`);
  assert.equal(byField.get("a2aInterface").value, `${ORIGIN}${A2A_INTERFACE_PATH}`);
  assert.equal(byField.get("mcpEndpoint").value, `${ORIGIN}${AGENT_MCP_PATH}`);
  for (const entry of dossier.entries) {
    assert.ok(entry.from.length > 20, `${entry.field} says nothing about where it came from`);
  }
});

test("the wallet and the signature are empty, with the reason attached", () => {
  const { dossier } = registrationReadiness({ origin: ORIGIN });
  for (const field of ["walletAddress", "cardSignature"]) {
    const entry = dossier.entries.find((candidate) => candidate.field === field);
    assert.equal(entry.value, null, field);
    assert.match(entry.from, /not set here/, field);
  }
});

test("the registry's own facts carry their source and the price carries its doubt", () => {
  assert.deepEqual([...SOLANA_AGENT_REGISTRY.registries], ["identity", "reputation", "validation"]);
  assert.match(SOLANA_AGENT_REGISTRY.source.url, /^https:\/\//);
  assert.match(SOLANA_AGENT_REGISTRY.source.observedAt, /^\d{4}-\d{2}-\d{2}$/);
  /* Two dates, because the figure was recorded once and not found again. A
     number shown without that is how a stale figure becomes a budget line. */
  assert.notEqual(
    SOLANA_AGENT_REGISTRY.priceNotConfirmed.recordedAt,
    SOLANA_AGENT_REGISTRY.priceNotConfirmed.recheckedAt,
  );
  assert.match(SOLANA_AGENT_REGISTRY.priceNotConfirmed.detail, /did not name a price/i);
});

test("a registered entry claims two capabilities and no verdict about anything", () => {
  assert.deepEqual([...REGISTERED_CAPABILITIES], ["READ", "QUOTE"]);
  const { dossier } = registrationReadiness({ origin: ORIGIN });
  assert.ok(dossier.claimsNotMade.some((line) => /trust score/i.test(line)));
  assert.ok(dossier.claimsNotMade.some((line) => /read or a proposal/i.test(line)));
  for (const declaration of dossier.capabilityDeclaration) {
    for (const capability of declaration.capabilities) {
      assert.ok(REGISTERED_CAPABILITIES.includes(capability), `${declaration.id}: ${capability}`);
    }
  }
});

test("the reputation and validation registries are named as somebody else's opinion", () => {
  assert.ok(SOLANA_AGENT_REGISTRY.limitations.some((line) => /reputation/i.test(line)));
  assert.ok(SOLANA_AGENT_REGISTRY.limitations.some((line) => /validation/i.test(line)));
});
