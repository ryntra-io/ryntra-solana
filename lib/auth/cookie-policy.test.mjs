import assert from "node:assert/strict";
import test from "node:test";

import { secureCookies, supabaseAuthCookieNames } from "./cookie-policy.ts";

test("session cookies are Secure everywhere except the local dev server", () => {
  assert.equal(secureCookies("production"), true);
  assert.equal(secureCookies(undefined), true, "an unset NODE_ENV must not silently drop Secure");
  assert.equal(secureCookies("development"), false);
  assert.equal(secureCookies("test"), false);
});

test("clearing the identity session takes every chunk with it", () => {
  /* A chunked token cleared by its base name alone leaves `.0`/`.1` behind,
     and the next read reassembles a fragment: neither signed in nor out. */
  const jar = [
    "sb-lbphobwqzwdkbmyedlwb-auth-token",
    "sb-lbphobwqzwdkbmyedlwb-auth-token.0",
    "sb-lbphobwqzwdkbmyedlwb-auth-token.1",
    "sb-lbphobwqzwdkbmyedlwb-auth-token-code-verifier",
    "rt",
    "rta",
    "rw",
    "ry_auth_rt",
    "sb-other-project-auth-token",
  ];
  assert.deepEqual(supabaseAuthCookieNames(jar), [
    "sb-lbphobwqzwdkbmyedlwb-auth-token",
    "sb-lbphobwqzwdkbmyedlwb-auth-token.0",
    "sb-lbphobwqzwdkbmyedlwb-auth-token.1",
    "sb-lbphobwqzwdkbmyedlwb-auth-token-code-verifier",
    "sb-other-project-auth-token",
  ]);
});

test("the product's own cookies are not swept up by the identity cleanup", () => {
  assert.deepEqual(supabaseAuthCookieNames(["rt", "rta", "rw", "ry_auth_rt", "sb-auth-token", "not-sb-x-auth-token"]), []);
});
