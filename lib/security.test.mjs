// Run from repo root: node --test lib/security.test.mjs
// Plain .mjs so tsc ignores it; Node 24 strips types from the .ts import natively.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as security from "./security.ts";

const { safeEqual, bearerToken, authorizedBearer, decideBearerAuth, decideWebhookSecret, LEGACY_KEY_ERROR } = security;

test("safeEqual: equal strings match, anything degenerate does not", () => {
  assert.equal(safeEqual("secret-1", "secret-1"), true);
  assert.equal(safeEqual("secret-1", "secret-2"), false);
  assert.equal(safeEqual("secret-1", "secret-11"), false); // length mismatch
  assert.equal(safeEqual("", ""), false); // empty never authorizes
  assert.equal(safeEqual(null, "x"), false);
  assert.equal(safeEqual("x", undefined), false);
  assert.equal(safeEqual(undefined, undefined), false);
});

test("bearerToken: parses the RFC 6750 shape, rejects everything else", () => {
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("bearer abc123"), "abc123"); // scheme is case-insensitive
  assert.equal(bearerToken("  Bearer   abc123  "), "abc123"); // tolerant of padding
  assert.equal(bearerToken("Basic abc123"), null); // wrong scheme
  assert.equal(bearerToken("Bearer"), null); // no token
  assert.equal(bearerToken("Bearer "), null);
  assert.equal(bearerToken("abc123"), null); // bare token without scheme
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken(undefined), null);
});

test("authorizedBearer: matches any provided secret, skips unset ones, never passes empty", () => {
  assert.equal(authorizedBearer("Bearer s1", "s1"), true);
  assert.equal(authorizedBearer("Bearer s2", "s1", "s2"), true); // fallback secret accepted
  assert.equal(authorizedBearer("Bearer s3", "s1", "s2"), false);
  assert.equal(authorizedBearer("Bearer s1", undefined, "s1"), true); // unset env slot skipped
  assert.equal(authorizedBearer("Bearer s1"), false); // no secrets configured
  assert.equal(authorizedBearer("Bearer s1", undefined), false); // secret unset → locked, not open
  assert.equal(authorizedBearer(null, "s1"), false);
  assert.equal(authorizedBearer("Basic s1", "s1"), false);
});

test("FAIL-LOUD matrix: decideBearerAuth distinguishes public / authorized / unauthorized / legacy", () => {
  const S = "srv-secret";
  // no credentials at all → public (the route decides whether public is allowed)
  assert.equal(decideBearerAuth({ authorization: null, legacyKeyPresent: false }, S), "public");
  // valid Bearer → authorized
  assert.equal(decideBearerAuth({ authorization: `Bearer ${S}`, legacyKeyPresent: false }, S), "authorized");
  // Authorization present but wrong / empty / wrong scheme → unauthorized, NEVER public
  assert.equal(decideBearerAuth({ authorization: "Bearer nope", legacyKeyPresent: false }, S), "unauthorized");
  assert.equal(decideBearerAuth({ authorization: "Bearer ", legacyKeyPresent: false }, S), "unauthorized");
  assert.equal(decideBearerAuth({ authorization: "", legacyKeyPresent: false }, S), "unauthorized");
  assert.equal(decideBearerAuth({ authorization: `Basic ${S}`, legacyKeyPresent: false }, S), "unauthorized");
  // legacy query key present → legacy-rejected, EVEN with a valid Bearer alongside (forces migration)
  assert.equal(decideBearerAuth({ authorization: null, legacyKeyPresent: true }, S), "legacy-rejected");
  assert.equal(decideBearerAuth({ authorization: `Bearer ${S}`, legacyKeyPresent: true }, S), "legacy-rejected");
  // server secret unset → any Authorization is unauthorized (a missing secret locks, never opens)
  assert.equal(decideBearerAuth({ authorization: "Bearer anything", legacyKeyPresent: false }, undefined), "unauthorized");
  assert.equal(decideBearerAuth({ authorization: "Bearer anything", legacyKeyPresent: false }), "unauthorized");
  // no credentials + no secret is still just public (liveness stays possible)
  assert.equal(decideBearerAuth({ authorization: null, legacyKeyPresent: false }, undefined), "public");
  // migration error text never contains a secret placeholder pattern
  assert.ok(!LEGACY_KEY_ERROR.includes("${"));
});

test("FAIL-CLOSED webhook: unset secret → unconfigured (503), never accept an update", () => {
  const S = "wh-secret";
  // secret unset/empty → unconfigured (the old `if (SECRET && …)` fail-open is gone)
  assert.equal(decideWebhookSecret("anything", undefined), "unconfigured");
  assert.equal(decideWebhookSecret("anything", ""), "unconfigured");
  assert.equal(decideWebhookSecret(null, undefined), "unconfigured");
  // secret set + correct header → authorized
  assert.equal(decideWebhookSecret(S, S), "authorized");
  // secret set + missing/empty/wrong header → unauthorized
  assert.equal(decideWebhookSecret(null, S), "unauthorized");
  assert.equal(decideWebhookSecret("", S), "unauthorized");
  assert.equal(decideWebhookSecret("wrong", S), "unauthorized");
});

test("same-origin mutation guard accepts browser same-origin POSTs and rejects cross-site/unknown origins", () => {
  assert.equal(typeof security.mutationOriginAllowed, "function");
  const allowed = security.mutationOriginAllowed;
  const url = "https://ryntra.io/api/paper";
  assert.equal(allowed(url, "https://ryntra.io", "same-origin"), true);
  assert.equal(allowed(url, null, "same-origin"), true);
  assert.equal(allowed(url, "https://evil.example", "cross-site"), false);
  assert.equal(allowed(url, null, "cross-site"), false);
  assert.equal(allowed(url, null, null), false);
  assert.equal(allowed(url, "not a url", "same-origin"), false);
});

test("login navigation guard allows user-clicked documents but blocks previews and subresources", () => {
  assert.equal(typeof security.loginNavigationAllowed, "function");
  const allowed = security.loginNavigationAllowed;
  assert.equal(allowed("none", "navigate", "?1", "document"), true);
  assert.equal(allowed("same-origin", "navigate", "?1", "document"), true);
  assert.equal(allowed("cross-site", "navigate", "?1", "document"), true);
  assert.equal(allowed("same-origin", "navigate", null, "document"), true);
  assert.equal(allowed("cross-site", "navigate", null, "document"), false);
  assert.equal(allowed("cross-site", "no-cors", null, "image"), false);
  assert.equal(allowed("none", "navigate", null, "document"), false);
  assert.equal(allowed("none", "no-cors", null, "empty"), false);
  assert.equal(allowed(null, null, null, null), false);
});

test("logout navigation guard blocks cross-site top-level GET logout", () => {
  assert.equal(typeof security.logoutNavigationAllowed, "function");
  const allowed = security.logoutNavigationAllowed;
  const url = "https://ryntra.io/api/session?logout=1";
  assert.equal(allowed(url, "same-origin", null), true);
  assert.equal(allowed(url, "cross-site", "https://evil.example/page"), false);
  assert.equal(allowed(url, "none", null), false);
  assert.equal(allowed(url, null, "https://ryntra.io/app/settings"), true);
  assert.equal(allowed(url, null, "https://evil.example/page"), false);
});

test("telegram POST is fail-closed and runs auth before side effects (source assertions)", () => {
  const src = readFileSync(new URL("../app/api/telegram/route.ts", import.meta.url), "utf8");
  // POST uses the fail-closed decider, not the old fail-open `if (SECRET && !safeEqual`
  assert.ok(src.includes("decideWebhookSecret"), "POST must use decideWebhookSecret");
  assert.ok(!src.includes("if (SECRET && !safeEqual"), "old fail-open guard must be gone");
  // unconfigured → 503 webhook not configured
  assert.ok(src.includes('status: 503'), "unset secret must 503");
  assert.ok(src.includes("webhook not configured"));
  // ensureWebhookConfig refuses to register without a secret
  assert.ok(/if \(!SECRET\) return;.*fail-open/s.test(src), "ensureWebhookConfig must bail when SECRET unset");
  // POST: auth decision precedes ensureWebhookConfig; GET: decideBearerAuth precedes ensureWebhookConfig
  // compare against the CALL site `ensureWebhookConfig(req.url)`, not the name in comments
  const postBody = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function GET"));
  assert.ok(
    postBody.indexOf("decideWebhookSecret") < postBody.indexOf("ensureWebhookConfig(req.url)"),
    "POST must authorize before ensureWebhookConfig"
  );
  const getBody = src.slice(src.indexOf("export async function GET"));
  assert.ok(
    getBody.indexOf("decideBearerAuth") < getBody.indexOf("ensureWebhookConfig(req.url)"),
    "GET must authorize before ensureWebhookConfig"
  );
});

test("protected routes authorize via the fail-loud decider only — no query-string secrets", () => {
  const routes = [
    ["health", "../app/api/health/route.ts", "./health.ts"],
    ["metrics", "../app/api/metrics/route.ts"],
    ["cron/fills", "../app/api/cron/fills/route.ts"],
    ["cron/recap", "../app/api/cron/recap/route.ts"],
    ["cron/broadcasts", "../app/api/cron/broadcasts/route.ts"],
    ["cron/monitoring", "../app/api/cron/monitoring/route.ts"],
  ];
  for (const [name, rel, authRel] of routes) {
    const routeSrc = readFileSync(new URL(rel, import.meta.url), "utf8");
    const authSrc = authRel ? readFileSync(new URL(authRel, import.meta.url), "utf8") : routeSrc;
    assert.ok(authSrc.includes("decideBearerAuth"), `${name} must use decideBearerAuth`);
    assert.ok(!routeSrc.includes('searchParams.get("key")'), `${name} route must not read a ?key= query secret`);
    assert.ok(!authSrc.includes('searchParams.get("key")'), `${name} auth must not read a ?key= query secret`);
    assert.ok(authSrc.includes("legacy-rejected"), `${name} must fail loudly on legacy keys`);
    if (name === "health") {
      assert.ok(routeSrc.includes("createHealthHandler"), "health route must delegate to the tested auth handler");
    }
  }
  const admin = readFileSync(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
  assert.ok(!admin.includes("?key="), "admin internal fetch must not put the secret in a URL");
  assert.ok(admin.includes("Authorization: `Bearer ${secret}`"), "admin internal fetch must use the Bearer header");
});
