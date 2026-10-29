// Run from repo root: node --test lib/core/developer/console.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEV_ACTIONS,
  DEV_ACTION_PERMISSION,
  DEV_CREDENTIAL_KINDS,
  DEV_ENVIRONMENTS,
  DEV_LIMITS,
  DEV_PLAN_FIELDS,
  DEV_QUOTA_WINDOWS,
  DEV_SCOPES,
  cleanName,
  cleanOrigin,
  cleanScopes,
  cleanWebhookUrl,
  isKeyId,
  originAllowed,
  quotaExceeded,
  quotaState,
  readKeyId,
  windowKey,
  windowResetsAt,
} from "./console.ts";

test("a key id says its kind and its environment before anything is looked up", () => {
  const secret = `rsk_live_${"a".repeat(43)}`;
  const open = `rpk_test_${"b".repeat(43)}`;
  assert.deepEqual(readKeyId(secret), { kind: "SECRET", environment: "live" });
  assert.deepEqual(readKeyId(open), { kind: "PUBLIC", environment: "test" });
  for (const bad of ["rsk_live_short", `rsk_prod_${"a".repeat(43)}`, `sk_live_${"a".repeat(43)}`, `rsk_live_${"a".repeat(44)}`, "", `rsk_live_${"a".repeat(42)}!`]) {
    assert.equal(readKeyId(bad), null, bad);
    assert.equal(isKeyId(bad), false, bad);
  }
  assert.equal(isKeyId(secret), true);
});

test("an origin is what a browser sends, or it is nothing", () => {
  assert.equal(cleanOrigin("https://app.example.com"), "https://app.example.com");
  assert.equal(cleanOrigin("  https://app.example.com  "), "https://app.example.com");
  assert.equal(cleanOrigin("https://app.example.com:8443"), "https://app.example.com:8443");
  assert.equal(cleanOrigin("http://localhost:3000"), "http://localhost:3000");
  /* A port the scheme already implies is dropped: it is not part of what a browser sends. */
  assert.equal(cleanOrigin("https://app.example.com:443"), "https://app.example.com");
  for (const bad of ["http://app.example.com", "https://app.example.com/path", "https://app.example.com?x=1", "https://user:pw@app.example.com", "app.example.com", "*", "https://*.example.com", "ftp://a.example.com", ""]) {
    assert.equal(cleanOrigin(bad), null, bad);
  }
});

test("an empty origin list allows nothing: a key with no origin is no browser's", () => {
  assert.equal(originAllowed([], "https://app.example.com"), false);
  assert.equal(originAllowed([], null), false);
  assert.equal(originAllowed(["https://app.example.com"], null), false);
  assert.equal(originAllowed(["https://app.example.com"], "https://app.example.com"), true);
  assert.equal(originAllowed(["https://app.example.com"], "https://app.example.com/"), true, "a trailing slash is the same origin");
  assert.equal(originAllowed(["https://app.example.com"], "https://evil.example.com"), false);
  assert.equal(originAllowed(["https://app.example.com"], "https://app.example.com.evil.com"), false);
});

test("a webhook address is https on a public host, and never a way back inside", () => {
  assert.equal(cleanWebhookUrl("https://hooks.example.com/ryntra"), "https://hooks.example.com/ryntra");
  assert.equal(cleanWebhookUrl("https://hooks.example.com/r?v=2"), "https://hooks.example.com/r?v=2");
  for (const bad of ["http://hooks.example.com/r", "https://localhost/r", "https://api.localhost/r", "https://10.0.0.1/r", "https://169.254.169.254/latest", "https://box/r", "https://thing.internal/r", "https://x.local/r", "https://[::1]/r", "https://hooks.example.com/r#f", "not a url", ""]) {
    assert.equal(cleanWebhookUrl(bad), null, bad);
  }
  assert.equal(cleanWebhookUrl(`https://hooks.example.com/${"x".repeat(DEV_LIMITS.urlMax)}`), null, "longer than the column holds");
});

test("a window is named by the moment it holds, and says when it starts again", () => {
  const at = new Date("2026-10-26T12:34:56.789Z");
  assert.equal(windowKey("minute", at), "minute:2026-10-26T12:34");
  assert.equal(windowKey("day", at), "day:2026-10-26");
  assert.equal(windowKey("month", at), "month:2026-10");
  assert.equal(windowResetsAt("minute", at), "2026-10-26T12:35:00.000Z");
  assert.equal(windowResetsAt("day", at), "2026-10-27T00:00:00.000Z");
  assert.equal(windowResetsAt("month", at), "2026-11-01T00:00:00.000Z");
  /* The end of a month and of a year roll over without arithmetic of their own. */
  assert.equal(windowResetsAt("month", new Date("2026-12-31T23:59:59.000Z")), "2027-01-01T00:00:00.000Z");
  assert.equal(windowResetsAt("day", new Date("2026-12-31T23:59:59.000Z")), "2027-01-01T00:00:00.000Z");
});

test("a window with no stated number is counted and never spent", () => {
  const at = new Date("2026-10-26T12:00:00.000Z");
  const rows = quotaState({ minute: null, day: 100, month: null }, { minute: 9_000, day: 100, month: 9_000 }, at);
  const minute = rows.find((row) => row.window === "minute");
  assert.equal(minute.limit, null);
  assert.equal(minute.left, null, "what is left of a number nobody set is neither zero nor infinity");
  assert.equal(minute.used, 9_000, "and the calls are counted all the same");
  assert.equal(quotaExceeded(rows), null, "the day is exactly at its number, which is served");
  const over = quotaState({ minute: null, day: 100, month: null }, { minute: 0, day: 101, month: 0 }, at);
  assert.equal(quotaExceeded(over).window, "day");
  assert.equal(over.find((row) => row.window === "day").left, 0);
});

test("scopes are known, without repeats, in the catalogue's order", () => {
  assert.deepEqual(cleanScopes(["read:events", "read:key", "read:key"]), ["read:key", "read:events"]);
  assert.equal(cleanScopes([]), null);
  assert.equal(cleanScopes(["read:everything"]), null);
  assert.deepEqual(cleanScopes([...DEV_SCOPES]), [...DEV_SCOPES]);
});

test("a name is cleaned rather than stored as typed, and markup is refused", () => {
  assert.equal(cleanName("  Мій   проєкт "), "Мій проєкт");
  assert.equal(cleanName(""), null);
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName("<script>"), null);
  assert.equal(cleanName("a".repeat(DEV_LIMITS.nameMax + 1)), null);
});

test("the catalogues are what the rest of the console is written against", () => {
  assert.deepEqual([...DEV_ENVIRONMENTS], ["test", "live"]);
  assert.deepEqual([...DEV_CREDENTIAL_KINDS], ["SECRET", "PUBLIC"]);
  assert.deepEqual([...DEV_QUOTA_WINDOWS], ["minute", "day", "month"]);
  for (const action of DEV_ACTIONS) assert.ok(DEV_ACTION_PERMISSION[action], `${action} names no right`);
  assert.equal(Object.keys(DEV_ACTION_PERMISSION).length, DEV_ACTIONS.length);
  /* A tariff has a shape here and no numbers anywhere: the figures are set outside this repository. */
  assert.ok(DEV_PLAN_FIELDS.includes("priceUsdPerMonth"));
  assert.equal(new Set(DEV_PLAN_FIELDS).size, DEV_PLAN_FIELDS.length);
});
