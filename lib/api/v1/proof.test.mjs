import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * `proof.ts` reads the real session store through modules node cannot load
 * outside Next, so its order is held by its source, as `swap-carrier.test.mjs`
 * holds the carrier's: a bearer is resolved first; any other Authorization
 * header is refused as a native request (401) before the browser's origin
 * check or its cookie are ever consulted (1.22.0).
 */
test("1.22.0: an Authorization header that is no bearer is refused as a native request, before the origin check and the cookie", () => {
  const source = readFileSync(new URL("./proof.ts", import.meta.url), "utf8");
  const bearer = source.indexOf("if (bearerToken(request.headers))");
  const malformed = source.indexOf('if (request.headers.get("authorization") !== null)');
  const origin = source.indexOf('if (intent === "mutation" && !mutationOriginAllowed(');
  const cookie = source.indexOf("await getWalletProof()");
  assert.ok(bearer > 0 && malformed > bearer && origin > malformed && cookie > origin, "bearer → malformed header → origin → cookie");
  assert.match(source.slice(malformed, origin), /apiFailure\("UNAUTHORIZED", /);
});
