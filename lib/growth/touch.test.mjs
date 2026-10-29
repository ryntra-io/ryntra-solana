import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { refParamRedirect } from "./ref-param.ts";
import { decideVisit, decodeTouch, encodeTouch, sourceFromKey, sourceKey, touchKeyFrom } from "./touch.ts";
import { normalizePostCode, touchLanding, utmKey, utmTagOf } from "./touch-param.ts";
import {
  bindTouchWallet,
  issuePostCode,
  listPostCodes,
  listTouchWallets,
  readPostCode,
  readVisits,
  recordVisit,
  UTM_OVERFLOW_KEY,
  UTM_SOURCES_PER_DAY,
  VISITS_PER_SOURCE_PER_DAY,
} from "./touch-store.ts";

const KEY = touchKeyFrom({ BETA_TOKEN_SECRET: "a-local-secret-of-length" });
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
const WALLET = "7BxQeV1WQx5Kf9L7jAGZLZmN2nRy3P6d8Qx4RhT9y1Pk";
const OTHER = "G6vA2mF8kQ1sLZ9pVbT4wJ7rN3xC5yH8dE2uK6nM3PcD";

test("a touch is signed: read back as written, refused when changed, too old, from the future or without a key", () => {
  assert.equal(touchKeyFrom({}), null, "no secret, no touch");
  assert.equal(touchKeyFrom({ BETA_TOKEN_SECRET: "short" }), null);
  const touch = { channel: "post", source: "7KD2F9X", at: NOW - 3_600_000, last: "post:7KD2F9X@2026-10-24", nonce: "AbCdEfGh12345678" };
  const value = encodeTouch(touch, KEY);
  assert.deepEqual(decodeTouch(value, KEY, NOW), touch);
  assert.equal(decodeTouch(value, null, NOW), null);
  assert.equal(decodeTouch(value, touchKeyFrom({ BETA_TOKEN_SECRET: "another-secret-of-length" }), NOW), null, "another deployment's key");
  const [payload, sig] = value.split(".");
  const backdated = Buffer.from(JSON.stringify({ v: 1, c: "post", s: "7KD2F9X", at: NOW - 20 * 86_400_000, l: "", n: "AbCdEfGh12345678" })).toString("base64url");
  assert.equal(decodeTouch(`${backdated}.${sig}`, KEY, NOW), null, "a moment rewritten without the key");
  assert.equal(decodeTouch(`${payload}.${sig}x`, KEY, NOW), null);
  assert.equal(decodeTouch(value, KEY, NOW + 31 * 86_400_000), null, "thirty days, then gone");
  assert.equal(decodeTouch(encodeTouch({ ...touch, at: NOW + 3_600_000 }, KEY), KEY, NOW), null, "not from the future");
  assert.equal(decodeTouch(encodeTouch({ ...touch, source: "not a code" }, KEY), KEY, NOW), null, "a source that is not one");
});

test("the first touch stays; every source counts once a day in a browser", () => {
  const post = { channel: "post", source: "7KD2F9X" };
  const utm = { channel: "utm", source: "x|social|weekly" };
  const first = decideVisit(null, post, NOW, () => "AbCdEfGh12345678");
  assert.equal(first.count, true);
  assert.equal(first.first, true);
  assert.deepEqual(first.touch, { channel: "post", source: "7KD2F9X", at: NOW, last: "post:7KD2F9X@2026-10-24", nonce: "AbCdEfGh12345678" });
  assert.match(decideVisit(null, post, NOW).touch.nonce, /^[A-Za-z0-9_-]{16}$/, "every first touch gets its own random name");
  const reload = decideVisit(first.touch, post, NOW + 60_000);
  assert.equal(reload.count, false, "a reload is not a second visit");
  assert.equal(reload.first, false);
  const other = decideVisit(reload.touch, utm, NOW + 120_000);
  assert.equal(other.count, true, "another source's link is a visit of that source");
  assert.equal(other.touch.channel, "post", "…but the first touch keeps the wallet");
  assert.equal(other.touch.at, NOW);
  const back = decideVisit(other.touch, post, NOW + 180_000);
  assert.equal(back.count, true, "only the last counted source is remembered — coming back to the first counts again");
  const tomorrow = decideVisit(decideVisit(back.touch, post, NOW + 200_000).touch, post, NOW + 86_400_000);
  assert.equal(tomorrow.count, true, "the next day is a new visit");
});

test("source keys and tags have one shape each", () => {
  assert.equal(sourceKey({ channel: "friend", source: "anything" }), "friend");
  assert.equal(sourceKey({ channel: "contest", source: "7KD2F9X" }), "contest:7KD2F9X");
  assert.deepEqual(sourceFromKey("utm:x|social|weekly"), { channel: "utm", source: "x|social|weekly" });
  assert.deepEqual(sourceFromKey("friend"), { channel: "friend", source: "friend" });
  for (const bad of ["post:short", "utm:X|a|b", "utm:x|a|b|c", "ref:ABC", "", "post:"]) assert.equal(sourceFromKey(bad), null, bad);
  assert.equal(normalizePostCode(" 7kd-2f9x "), "7KD2F9X");
  assert.equal(normalizePostCode("7KD2F9XBCDFG"), null, "twelve symbols is a friend's code, never a post's");
  assert.equal(normalizePostCode("AEIOUAE"), null, "vowels are not in the alphabet");
  const tag = utmTagOf(new URLSearchParams("utm_source=X&utm_medium=Social Media&utm_campaign=<script>Week 1"));
  assert.deepEqual(tag, { source: "x", medium: "social-media", campaign: "scriptweek-1" });
  assert.equal(utmKey(tag), "x|social-media|scriptweek-1");
  assert.equal(utmTagOf(new URLSearchParams("utm_medium=social")), null, "a medium alone names no source");
  assert.equal(utmKey({ source: "x", medium: null, campaign: null }), "x|-|-");
});

test("a tagged link lands only on the Solana product and its site, on this host", () => {
  for (const ok of ["/", "/uk", "/uk/docs", "/app", "/app/swap?mint=So1", "/stats", "/promo/partners/terms", "/docs/invest/buy"]) {
    assert.equal(touchLanding(ok), ok, ok);
  }
  for (const bad of ["", "app", "//evil.example", "/\\evil", "https://evil.example/", "/api/rewards", "/admin", "/r/ABC", "/stats/x", "/app\u0000", `/${"a".repeat(400)}`]) {
    assert.equal(touchLanding(bad), null, bad);
  }
  assert.equal(touchLanding("/app/../admin"), null, "a path that climbs out is not a page of the product");
});

test("UTM on a page of the product goes through /r/t and back to the same page; a friend's ref still wins", () => {
  const landing = refParamRedirect(new URL("https://ryntra.io/?utm_source=x&utm_medium=social&utm_campaign=weekly"));
  assert.equal(landing.pathname, "/r/t");
  assert.equal(landing.searchParams.get("utm_source"), "x");
  assert.equal(landing.searchParams.get("utm_campaign"), "weekly");
  assert.equal(landing.searchParams.get("to"), "/");
  const page = refParamRedirect(new URL("https://app.ryntra.io/solana/workspace/swap?mint=So1&utm_source=tg"));
  assert.equal(page.searchParams.get("to"), "/app/swap?mint=So1", "the product page, without the tag");
  const friend = refParamRedirect(new URL("https://ryntra.io/app/swap?ref=7KD2F9XBCDFG&utm_source=x"));
  assert.equal(friend.pathname, "/r/7KD2F9XBCDFG");
  const foreignRef = refParamRedirect(new URL("https://ryntra.io/?ref=producthunt&utm_source=x"));
  assert.equal(foreignRef.pathname, "/r/t", "somebody else's `ref` does not hide the UTM source");
  assert.equal(foreignRef.searchParams.get("to"), "/?ref=producthunt", "…and the page keeps its own `ref`");
  assert.equal(refParamRedirect(new URL("https://ryntra.io/?ref=producthunt")), null);
  assert.equal(refParamRedirect(new URL("https://ryntra.io/api/x?utm_source=x")), null, "not a page of the product");
  assert.equal(refParamRedirect(new URL("https://predict.ryntra.io/?utm_source=x")), null, "another product's host");
  assert.equal(refParamRedirect(new URL("https://ryntra.io/app/swap?utm_medium=x")), null, "no source, no tag");
  assert.equal(refParamRedirect(new URL("https://ryntra.io/app/swap")), null);
});

test("visits are numbers by source and day, capped; new UTM sources past the day's limit share one row", async () => {
  const store = createMemoryGuardStore();
  const at = "2026-10-24T09:00:00.000Z";
  await recordVisit(store, { channel: "post", source: "7KD2F9X" }, at);
  await recordVisit(store, { channel: "post", source: "7KD2F9X" }, at);
  await recordVisit(store, { channel: "friend", source: "friend" }, "2026-10-25T00:00:01.000Z");
  for (let index = 0; index < UTM_SOURCES_PER_DAY + 3; index += 1) await recordVisit(store, { channel: "utm", source: `s${index}|-|-` }, at);
  const visits = await readVisits(store);
  assert.deepEqual(visits.find((row) => row.source === "post:7KD2F9X"), { day: "2026-10-24", source: "post:7KD2F9X", visits: 2 });
  assert.equal(visits.find((row) => row.source === "friend").day, "2026-10-25");
  assert.equal(visits.filter((row) => row.source.startsWith("utm:s")).length, UTM_SOURCES_PER_DAY);
  assert.equal(visits.find((row) => row.source === UTM_OVERFLOW_KEY).visits, 3);
  assert.ok(visits.every((row) => typeof row.visits === "number"), "the day's list of UTM sources is not a row of visits");

  const capped = createMemoryGuardStore();
  await capped.versioned("growthVisits").set("2026-10-24:friend", { version: 1, day: "2026-10-24", source: "friend", visits: VISITS_PER_SOURCE_PER_DAY });
  await recordVisit(capped, { channel: "friend", source: "friend" }, at);
  assert.equal((await readVisits(capped))[0].visits, VISITS_PER_SOURCE_PER_DAY);
});

test("a post code is issued once, with a title and a landing of the product; a taken code is never overwritten", async () => {
  const store = createMemoryGuardStore();
  const base = { kind: "post", network: "x", title: "  Thread:  why Solana  ", landing: "/app/swap", createdBy: "admin:9001", now: "2026-10-24T10:00:00.000Z" };
  assert.deepEqual(await issuePostCode(store, { ...base, title: " " }), { ok: false, reason: "title" });
  assert.deepEqual(await issuePostCode(store, { ...base, landing: "https://evil.example" }), { ok: false, reason: "landing" });
  const codes = ["7KD2F9X", "7KD2F9X", "8KD2F9X"];
  const first = await issuePostCode(store, base, () => codes.shift());
  assert.equal(first.ok, true);
  assert.equal(first.post.code, "7KD2F9X");
  assert.equal(first.post.title, "Thread: why Solana");
  const second = await issuePostCode(store, { ...base, kind: "contest", title: "Contest" }, () => codes.shift());
  assert.equal(second.post.code, "8KD2F9X", "a code already issued is skipped");
  assert.equal((await readPostCode(store, "7KD2F9X")).title, "Thread: why Solana");
  assert.deepEqual((await listPostCodes(store)).map((post) => post.code).sort(), ["7KD2F9X", "8KD2F9X"]);
  assert.deepEqual(await issuePostCode(store, base, () => "7KD2F9X"), { ok: false, reason: "busy" });
  const random = await issuePostCode(store, base);
  assert.match(random.post.code, /^[0-9BCDFGHJKLMNPQRSTVWXZ]{7}$/);
});

test("a wallet meets one source, once; a later touch never rewrites it; one touch binds one wallet", async () => {
  const store = createMemoryGuardStore();
  const touch = { channel: "post", source: "7KD2F9X", at: NOW - 600_000, last: "", nonce: "AbCdEfGh12345678" };
  assert.equal(await bindTouchWallet(store, { wallet: WALLET, touch, now: new Date(NOW).toISOString(), proven: false }), "bound");
  assert.equal(await bindTouchWallet(store, { wallet: WALLET, touch: { ...touch, channel: "utm", source: "x|-|-", nonce: "ZZZZEfGh12345678" }, now: new Date(NOW).toISOString(), proven: true }), "already");
  assert.equal(await bindTouchWallet(store, { wallet: OTHER, touch, now: new Date(NOW).toISOString(), proven: false }), "already", "the same touch cannot name a second wallet");
  assert.equal(await bindTouchWallet(store, { wallet: "not-a-wallet", touch, now: new Date(NOW).toISOString(), proven: false }), "refused");
  assert.equal(await bindTouchWallet(store, { wallet: OTHER, touch: { ...touch, nonce: "short" }, now: new Date(NOW).toISOString(), proven: false }), "refused");
  assert.equal(await bindTouchWallet(store, { wallet: OTHER, touch: { ...touch, channel: "friend", source: "friend", nonce: "YYYYEfGh12345678" }, now: new Date(NOW).toISOString(), proven: true }), "bound");
  const rows = await listTouchWallets(store);
  assert.deepEqual(rows.map((row) => [row.wallet, row.channel, row.source, row.touchAt, row.proven]).sort(), [
    [OTHER, "friend", "friend", new Date(NOW - 600_000).toISOString(), true],
    [WALLET, "post", "7KD2F9X", new Date(NOW - 600_000).toISOString(), false],
  ].sort());
});
