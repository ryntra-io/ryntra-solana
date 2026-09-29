import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DOCUMENTED_TOOL_EFFECTS,
  MISSING_CAPABILITIES,
  documentedTools,
  effectOf,
  toolsWithEffect,
} from "./tool-inventory.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/documented-tools.json", import.meta.url), "utf8"),
);

test("the inventory is the documented one and every tool is classified", function () {
  const tools = documentedTools();
  const fixtureNames = FIXTURE.families.flatMap(function (family) {
    return family.tools.map(function (tool) { return tool.name; });
  });
  assert.equal(tools.length, fixtureNames.length);
  assert.equal(new Set(fixtureNames).size, fixtureNames.length, "no duplicate tool names");
  for (const name of fixtureNames) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(DOCUMENTED_TOOL_EFFECTS, name),
      name + " is documented but unclassified",
    );
  }
  /* And the reverse: a classification with no documented tool behind it is a
     claim about a surface nobody read. */
  for (const name of Object.keys(DOCUMENTED_TOOL_EFFECTS)) {
    assert.ok(fixtureNames.includes(name), name + " is classified but not documented");
  }
});

test("classification is per tool, never derived from the name", function () {
  /* RYN-BIN-AOS-002 built a guardrail from a naming convention twice and it
     failed open twice. These four are exactly the cases a prefix rule gets
     wrong: two writes whose names do not start with a write verb, and two reads
     whose names do. */
  assert.equal(effectOf("place_equity_order"), "WRITE_ORDER");
  assert.equal(effectOf("cancel_crypto_order"), "WRITE_ORDER");
  assert.equal(effectOf("review_equity_order"), "READ");
  assert.equal(effectOf("preview_crypto_order"), "READ");
  assert.equal(effectOf("create_watchlist"), "WRITE_NO_ASSET");
  assert.equal(effectOf("update_scan_filters"), "WRITE_NO_ASSET");
  assert.equal(effectOf("get_portfolio"), "READ");

  const source = readFileSync(new URL("./tool-inventory.ts", import.meta.url), "utf8");
  for (const prefixRule of [/startsWith\(\s*["']place_/, /startsWith\(\s*["']create_/, /\/\^\(place\|create/]) {
    assert.ok(!prefixRule.test(source), "effects must not be derived from a name prefix");
  }
});

test("an unknown tool is a write until somebody classifies it", function () {
  /* Fail-closed on the exact axis that matters. A tool Robinhood adds next
     release is unknown here, and treating an unknown as a read is how an
     order-placing tool passes a read-only gate. */
  assert.equal(effectOf("place_futures_order"), "WRITE_ORDER");
  assert.equal(effectOf("something_nobody_has_seen"), "WRITE_ORDER");
});

test("no documented tool moves an asset off the account", function () {
  const moves = new Set(["withdraw", "withdrawal", "transfer", "deposit", "send", "stake", "lend", "borrow"]);
  for (const tool of documentedTools()) {
    /* Matched on whole snake_case segments, not as substrings. A substring scan
       reads `get_earnings_calendar` as a lending tool — ca-LEND-ar — which is the
       same class of mistake as classifying an effect by its name prefix, one
       layer down. */
    for (const segment of tool.name.split("_")) {
      assert.ok(
        !moves.has(segment.toLowerCase()),
        tool.name + " looks like a fund movement and none is documented",
      );
    }
  }
  /* The provider states the same boundary in words for crypto: the agent can
     trade it and cannot transfer, stake or lend it. The register records that
     as an absence with a reason rather than as silence. */
  assert.ok(MISSING_CAPABILITIES.length >= 4);
  for (const missing of MISSING_CAPABILITIES) {
    assert.ok(missing.reason.length > 20, missing.id + " must say why it is absent");
    assert.ok(missing.evidence.length >= 1, missing.id + " must carry evidence");
  }
  const missingIds = MISSING_CAPABILITIES.map(function (m) { return m.id; });
  for (const id of ["withdrawal", "external-transfer", "crypto-staking", "account-opening"]) {
    assert.ok(missingIds.includes(id), id + " must be recorded as absent");
  }
});

test("the write surface is small and it is named", function () {
  const orders = toolsWithEffect("WRITE_ORDER").map(function (tool) { return tool.name; });
  assert.deepEqual([...orders].sort(), [
    "cancel_crypto_order",
    "cancel_equity_order",
    "cancel_option_order",
    "place_crypto_order",
    "place_equity_order",
    "place_option_order",
  ]);
  const benign = toolsWithEffect("WRITE_NO_ASSET").map(function (tool) { return tool.name; });
  assert.ok(benign.length >= 10, "watchlists and scans are writes too");
  for (const name of benign) {
    assert.ok(/watchlist|scan/.test(name), name + " is not a watchlist or scan write");
  }
});

test("nothing here claims the inventory was seen over MCP", function () {
  assert.match(FIXTURE.boundary, /never reached|refuses this egress/);
  for (const tool of documentedTools()) {
    assert.equal(tool.source, "official-docs", tool.name + " was never live-probed");
    assert.equal(tool.reachedOverMcp, false, tool.name);
  }
});
