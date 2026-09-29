import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

/**
 * The scans below run against code with comments removed.
 *
 * Scanning the whole file was the first version and it failed on its own
 * documentation: the paragraph explaining that nothing is read from *the
 * request* matched `/request\./`, and the paragraph naming the host that refuses
 * us matched the host. A gate that a correct explanation cannot survive teaches
 * the next author to write a worse explanation, so the gate reads the code and
 * the prose is asserted separately, below.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the route takes no input from its caller", function () {
  /* The handler's signature is the gate. A route that accepts a request object
     can grow a `?url=` parameter later; one that takes none cannot, and the
     absence is asserted rather than reviewed. */
  assert.match(CODE, /export async function GET\(\)/);
  for (const forbidden of [/NextRequest/, /searchParams/, /req\./, /request\./, /await req\b/]) {
    assert.ok(!forbidden.test(CODE), "the route must not read " + forbidden);
  }
});

test("only GET exists, so nothing here can be written to", function () {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(
      !new RegExp("export (async )?function " + method + "\\b").test(CODE),
      method + " must not be exported",
    );
  }
});

test("the route holds no credential and no endpoint of its own", function () {
  for (const forbidden of [/process\.env/, /authorization/i, /\bbearer\b/i, /agent\.robinhood\.com/]) {
    assert.ok(!forbidden.test(CODE), "the route must not contain " + forbidden);
  }
  /* The endpoint it reports is imported, not written here, so the route and the
     probe can never disagree about which door was tried. */
  assert.match(CODE, /ROBINHOOD_MCP_URL/);
});

test("the response is cached, so caller volume cannot become upstream volume", function () {
  assert.match(CODE, /publicCacheHeaders\(\s*60\s*,\s*300\s*\)/);
});

test("the response states the boundary it would otherwise imply", function () {
  /* A public endpoint named after a venue reads as an integration with it. The
     payload says in words that it is not one. */
  assert.match(SOURCE, /Ryntra ships no Robinhood brokerage adapter/);
  assert.match(SOURCE, /no control on this surface is enforced through/);
});
