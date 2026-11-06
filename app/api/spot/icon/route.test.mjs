import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* CITY-200: a search on ryntra.io logged «Failed to load resource: 404» for each coin whose logo could not be read. */
test("a coin without a readable logo answers 204, the city's «no logo», never an error status", () => {
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(route, /function notFound\(\): Response \{\s*return new Response\(null, \{ status: 204,/);
  assert.doesNotMatch(route, /status: 404/);
});
