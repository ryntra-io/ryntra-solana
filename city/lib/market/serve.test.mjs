import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cityAnswer, LAST_GOOD_MS } from "./serve.ts";

/* CITY-200: on ryntra.io the top bar read «Delayed 15:55» for minutes — a failed Jupiter read stored the bundle as the answer. */
const NOW = Date.parse("2026-11-05T00:30:00.000Z");
const city = (at, source = "live") => ({ towers: [{ id: "x" }], fetchedAt: new Date(at).toISOString(), source });
const BUNDLE = city(Date.parse("2026-11-04T13:55:00.000Z"), "snapshot");

test("a live read is the answer and the one kept", () => {
  const live = city(NOW);
  assert.deepEqual(cityAnswer(live, null, BUNDLE, NOW, false), { body: live, keep: live });
});

test("a failed read answers with the last live city while it is recent, never with the bundle", () => {
  const kept = city(NOW - 3 * 60_000);
  assert.equal(cityAnswer(null, kept, BUNDLE, NOW, false).body, kept);
  const old = city(NOW - LAST_GOOD_MS - 1);
  const refused = cityAnswer(null, old, BUNDLE, NOW, false);
  assert.equal(refused.body, null, "nothing recent: the route refuses, so the edge keeps its last live city");
  assert.equal(refused.keep, old);
  assert.equal(cityAnswer(null, null, BUNDLE, NOW, false).body, null);
});

test("only the build, with nothing before it, answers with the bundle", () => {
  assert.equal(cityAnswer(null, null, BUNDLE, NOW, true).body, BUNDLE);
});

test("the route throws on a failed read instead of storing the bundle", () => {
  const route = readFileSync(new URL("../../../app/api/city/route.ts", import.meta.url), "utf8");
  assert.match(route, /cityAnswer\(live, kept, BUNDLED_CITY, Date\.now\(\), process\.env\.NEXT_PHASE === 'phase-production-build'\)/);
  assert.match(route, /if \(!answer\.body\) throw new Error/);
  assert.doesNotMatch(route, /live \?\? BUNDLED_CITY/);
});
