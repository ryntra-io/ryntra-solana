import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AGAIN_MS, EVERY_MS, freshCity, newerCity, nextReadIn, readOnReturn } from "./reread.ts";

/* CITY-221: on ryntra.io the top bar read «Delayed 01:19» — a cold edge answered `/api/city` with the city prerendered at
   the build (07.11 23:19 UTC, 01:19 in Kyiv); the page waited a minute before asking again, longer on a phone that slept. */
const NOW = Date.parse("2026-11-08T16:27:40.000Z");
const city = (at, source = "live") => ({ fetchedAt: new Date(at).toISOString(), source });
const BUILD = city(Date.parse("2026-11-07T23:19:07.519Z"));
const BUNDLE = city(Date.parse("2026-10-26T11:31:11.183Z"), "snapshot");

test("a fresh live city is read again in a minute", () => {
  assert.equal(freshCity(city(NOW - 70_000), NOW), true);
  assert.equal(nextReadIn(city(NOW - 70_000), NOW, 0), EVERY_MS);
});

test("the build's city, the bundle or a failed read is asked again within seconds, then every 20 s until fresh", () => {
  for (const shown of [BUILD, BUNDLE]) {
    assert.equal(freshCity(shown, NOW), false);
    assert.deepEqual([0, 1, 2, 3, 5, 6, 9].map((n) => nextReadIn(shown, NOW, n)), [AGAIN_MS[0], AGAIN_MS[1], AGAIN_MS[2], AGAIN_MS[2], AGAIN_MS[2], EVERY_MS, EVERY_MS]);
  }
  assert.ok(AGAIN_MS.every((ms) => ms < EVERY_MS));
  assert.equal(freshCity(city(NOW + 10 * 60_000), NOW), true, "a clock behind the server's is not «stale»");
  assert.equal(freshCity({ fetchedAt: "not a date", source: "live" }, NOW), false);
});

test("an older live answer never replaces the newer city on screen; a live one always replaces the bundle", () => {
  const today = city(NOW - 30_000);
  assert.equal(newerCity(today, BUILD), false, "a cold edge's build city after today's");
  assert.equal(newerCity(BUILD, today), true);
  assert.equal(newerCity(today, today), true);
  assert.equal(newerCity(BUNDLE, BUILD), true);
  assert.equal(newerCity(today, BUNDLE), false);
  assert.equal(newerCity(BUNDLE, BUNDLE), true);
});

test("a tab coming back reads at once unless its city is under a minute old and live", () => {
  assert.equal(readOnReturn(city(NOW - 20_000), NOW), false);
  assert.equal(readOnReturn(city(NOW - 61_000), NOW), true);
  assert.equal(readOnReturn(BUILD, NOW), true);
  assert.equal(readOnReturn(BUNDLE, NOW), true);
});

test("the city page reads by these rules: on its timer, again on return, and only a newer city", () => {
  const app = readFileSync(new URL("../../components/CityApp.tsx", import.meta.url), "utf8");
  assert.match(app, /nextReadIn\(latest\.current, Date\.now\(\), tries\)/);
  assert.match(app, /if \(!newerCity\(before, next\)\) return;/);
  assert.match(app, /addEventListener\('visibilitychange', back\)/);
  assert.doesNotMatch(app, /setInterval\(read,/);
});
