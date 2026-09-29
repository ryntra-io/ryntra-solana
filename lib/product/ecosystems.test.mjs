// Run from repo root: node --test lib/product/ecosystems.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ECOSYSTEMS, ecosystemById, isSelectable } from "./ecosystems.ts";
import { PUBLIC_CAPABILITIES } from "./capabilities.ts";
import { inDevelopmentRepository, needsDevelopmentRepository } from "../development-repository.mjs";

const REGISTERED = new Set(PUBLIC_CAPABILITIES.map((capability) => capability.id));

const REGISTRY = inDevelopmentRepository ? readFileSync(new URL("../../docs/tasks/INDEX.md", import.meta.url), "utf8") : "";

test("the task that would advance a direction is a task that exists", { skip: needsDevelopmentRepository("the task registry docs/tasks/INDEX.md") }, () => {
  /*
   * Written after `ethereum-evm` was found pointing at `RYN-CORE-001` — the
   * module kernel packet, which defines Module, Asset, DataSource, Scanner and
   * Route interfaces and cannot advance an EVM pack at all. The row that does
   * is `RYN-EVM-001`, and the product canon had registered it.
   *
   * Nothing caught that, because `advancedBy` was only ever required to be a
   * string. A pointer at the wrong task is not a typo — a reader takes it as
   * "this direction is sequenced behind that work", which is the one thing a
   * research row is supposed to say honestly.
   *
   * This checks existence in the registry, not correctness of the choice. The
   * second is a judgement; the first is the half a test can hold.
   */
  const rows = new Map(
    [...REGISTRY.matchAll(/^\| \d+ \| `(RYN-[A-Z0-9-]+)` \| ([A-Z_]+) \|/gm)].map((m) => [m[1], m[2]]),
  );
  assert.ok(rows.size > 200, "the registry sweep found suspiciously few rows");

  for (const entry of ECOSYSTEMS) {
    if (entry.advancedBy === null) continue;
    assert.ok(
      rows.has(entry.advancedBy),
      `${entry.id}: advancedBy names ${entry.advancedBy}, which is not a row in the registry`,
    );
  }
});

test("a manifest is a direction, never a capability claim", () => {
  const ids = new Set();
  for (const entry of ECOSYSTEMS) {
    assert.equal(ids.has(entry.id), false, `duplicate manifest id: ${entry.id}`);
    ids.add(entry.id);

    assert.ok(["chain_pack", "venue_adapter"].includes(entry.kind), `${entry.id}: kind`);
    assert.ok(
      ["live", "testnet_verified", "read_only", "research"].includes(entry.state),
      `${entry.id}: state`,
    );
    assert.ok(entry.role.length >= 30, `${entry.id}: role must explain itself`);

    /* Every capability a manifest names has to exist. A manifest that points at
       an unregistered id is the exact thing this file exists to prevent: a
       listed ecosystem implying shipped support. */
    for (const id of entry.capabilities) {
      assert.ok(REGISTERED.has(id), `${entry.id}: unregistered capability ${id}`);
    }
  }
});

test("anything short of live states why, and research states it at length", () => {
  for (const entry of ECOSYSTEMS) {
    if (entry.state === "live" && entry.capabilities.length > 0) {
      // Even a live manifest carries its bound: the routes are three, not all.
      assert.ok(entry.gate, `${entry.id}: a live manifest still states its limit`);
    }
    assert.ok(entry.gate, `${entry.id}: a manifest without a stated limit reads as a promise`);
    assert.ok(entry.gate.length >= 40, `${entry.id}: the reason must be specific`);
  }
});

test("research never becomes an action, and never claims a capability", () => {
  for (const entry of ECOSYSTEMS) {
    if (entry.state !== "research") continue;
    assert.deepEqual(
      [...entry.capabilities],
      [],
      `${entry.id}: research cannot name a shipped capability`,
    );
    assert.equal(isSelectable(entry), false, `${entry.id}: research must not render an action`);
  }
});

test("no manifest borrows another's proof", () => {
  /* Stellar is proven on testnet and Robinhood Chain is live, and neither may
     lend its state to a neighbour. The concrete failure this prevents: an
     "Ecosystems" section where one green row makes the column look green. */
  const stellar = ecosystemById("stellar");
  assert.equal(stellar.state, "testnet_verified");
  assert.equal(stellar.capabilities.length, 4);

  const zeroex = ecosystemById("zeroex");
  assert.equal(zeroex.state, "research");
  assert.equal(zeroex.capabilities.length, 0);

  const hypercore = ecosystemById("hypercore");
  assert.equal(hypercore.state, "research");
  assert.match(hypercore.role, /HyperCore is the venue/);
  assert.doesNotMatch(hypercore.role, /999/);
});

test("chains settle and venues execute, and the file keeps them apart", () => {
  const chains = ECOSYSTEMS.filter((entry) => entry.kind === "chain_pack").map((e) => e.id);
  const venues = ECOSYSTEMS.filter((entry) => entry.kind === "venue_adapter").map((e) => e.id);

  assert.ok(chains.includes("robinhood-chain"), "Robinhood Chain is a chain");
  assert.ok(venues.includes("arcus-spot"), "Arcus is a venue");
  assert.equal(chains.includes("arcus-spot"), false, "a venue never becomes a chain pack");
  assert.equal(venues.includes("robinhood-chain"), false, "a chain never becomes a venue");

  /* Spot and perps are separate adapters with separate risk and lifecycle, and
     the perps one must never inherit the spot one's execution state. */
  assert.equal(ecosystemById("arcus-spot").state, "live");
  assert.equal(ecosystemById("arcus-perps").state, "read_only");
});
