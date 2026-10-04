import { test } from "node:test";
import assert from "node:assert/strict";

import { OAUTH_METADATA_KEYS, extractOAuthMetadata } from "./oauth-metadata.ts";

test("only the standard's own fields survive", function () {
  const extracted = extractOAuthMetadata({
    issuer: "https://example.test",
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    client_secret: "never",
    access_token: "never",
    something_nobody_specified: { a: 1 },
  });
  assert.deepEqual(Object.keys(extracted).sort(), [
    "code_challenge_methods_supported",
    "grant_types_supported",
    "issuer",
  ]);
  /* An allowlist rather than a denylist, for the reason the Binance work made
     unmissable: a name-based blocklist is defeated by any name nobody thought
     of, and a document served by somebody else is exactly where an unthought-of
     name comes from. */
  assert.ok(!("client_secret" in extracted));
  assert.ok(!("access_token" in extracted));
  assert.ok(!("something_nobody_specified" in extracted));
});

test("the allowlist covers both documents an MCP client fetches", function () {
  for (const key of [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "revocation_endpoint",
    "scopes_supported",
    "grant_types_supported",
    "response_types_supported",
    "code_challenge_methods_supported",
    "token_endpoint_auth_methods_supported",
    "resource",
    "authorization_servers",
    "bearer_methods_supported",
  ]) {
    assert.ok(OAUTH_METADATA_KEYS.includes(key), key + " must be readable");
  }
});

test("values are bounded, so a hostile document cannot become a payload", function () {
  const extracted = extractOAuthMetadata({
    issuer: "x".repeat(5_000),
    scopes_supported: Array.from({ length: 500 }, function (_, i) { return "scope" + i; }),
    grant_types_supported: [{ nested: "object" }, "authorization_code", 42],
  });
  assert.ok(extracted.issuer.length <= 300, "a string value must be capped");
  assert.ok(extracted.scopes_supported.length <= 40, "an array value must be capped");
  /* Non-string array members are dropped rather than stringified: a record that
     turns `{nested:"object"}` into "[object Object]" invents a scope name. */
  assert.deepEqual(extracted.grant_types_supported, ["authorization_code"]);
});

test("a missing, empty or non-object document yields nothing rather than a shape", function () {
  for (const input of [null, undefined, "not json", 42, []]) {
    assert.deepEqual(extractOAuthMetadata(input), {});
  }
  assert.deepEqual(extractOAuthMetadata({}), {});
});

test("a boolean flag the standards define is kept as a boolean", function () {
  const extracted = extractOAuthMetadata({ require_pushed_authorization_requests: true, issuer: "https://x.test" });
  assert.equal(extracted.require_pushed_authorization_requests, true);
});
