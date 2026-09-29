/*
 * The Telegram ID token as the product reads it after Supabase verified it.
 *
 * Supabase keeps the standard claims and drops Telegram's `id`; the product
 * reads that claim from the same token string. These cases pin the decoder's
 * shape, the nonce arithmetic both layers rely on, and the ways a token that
 * Supabase would never accept still gets no numeric id out of this module.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TELEGRAM_ISSUER, readTelegramIdToken, telegramNonceFor, telegramTokenMatches } from "./telegram-token.ts";

function token(payload, header = { alg: "RS256", kid: "k1" }) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc(header)}.${enc(payload)}.c2lnbmF0dXJl`;
}

const RAW_NONCE = "round-trip-nonce-0123456789";
const CLAIMS = {
  iss: TELEGRAM_ISSUER,
  aud: "8110775576",
  sub: "1234123412341234123",
  iat: 1_757_196_400,
  exp: 1_757_200_000,
  id: 987654321,
  name: "John Doe",
  given_name: "John",
  preferred_username: "johndoe",
  picture: "https://cdn4.telesco.pe/file/x.jpg",
  nonce: createHash("sha256").update(RAW_NONCE).digest("hex"),
};

test("the documented token shape yields the numeric id and the profile", () => {
  const claims = readTelegramIdToken(token(CLAIMS));
  assert.ok(claims);
  assert.equal(claims.telegramId, 987654321);
  assert.equal(claims.subject, "1234123412341234123");
  assert.equal(claims.name, "John Doe");
  assert.equal(claims.username, "johndoe");
  assert.equal(claims.issuer, TELEGRAM_ISSUER);
  assert.equal(claims.expiresAt, 1_757_200_000);
});

test("the nonce Telegram writes is the hash Supabase will compute from the raw nonce", () => {
  assert.equal(telegramNonceFor(RAW_NONCE), CLAIMS.nonce);
  assert.match(telegramNonceFor("x"), /^[0-9a-f]{64}$/);
  const claims = readTelegramIdToken(token(CLAIMS));
  assert.equal(telegramTokenMatches(claims, RAW_NONCE), true);
  assert.equal(telegramTokenMatches(claims, `${RAW_NONCE}x`), false, "another browser's nonce");
});

test("a token without the id claim reads as id-less, never as sub", () => {
  const { id: _id, ...withoutId } = CLAIMS;
  const claims = readTelegramIdToken(token(withoutId));
  assert.ok(claims);
  assert.equal(claims.telegramId, null);
  assert.equal(claims.subject, "1234123412341234123");
});

test("a token from another issuer or without a nonce does not match the round trip", () => {
  const foreign = readTelegramIdToken(token({ ...CLAIMS, iss: "https://accounts.google.com" }));
  assert.equal(telegramTokenMatches(foreign, RAW_NONCE), false);
  const { nonce: _nonce, ...silent } = CLAIMS;
  assert.equal(telegramTokenMatches(readTelegramIdToken(token(silent)), RAW_NONCE), false);
});

test("malformed input is refused without throwing", () => {
  assert.equal(readTelegramIdToken(null), null);
  assert.equal(readTelegramIdToken(""), null);
  assert.equal(readTelegramIdToken("a.b"), null);
  assert.equal(readTelegramIdToken("aaaaaaaaaaaaaaaaaaaaaa.!!!.ccc"), null);
  assert.equal(readTelegramIdToken(`${"a".repeat(30)}.${Buffer.from("[1]").toString("base64url")}.c`), null);
  assert.equal(readTelegramIdToken(`${"a".repeat(30)}.${Buffer.from("not json").toString("base64url")}.c`), null);
  assert.equal(readTelegramIdToken("x".repeat(9000)), null);
});

test("an id that cannot be a Telegram user id is not one", () => {
  for (const id of [0, -1, "12ab", "1".repeat(16), 1.5, null]) {
    assert.equal(readTelegramIdToken(token({ ...CLAIMS, id })).telegramId, null, String(id));
  }
  assert.equal(readTelegramIdToken(token({ ...CLAIMS, id: "987654321" })).telegramId, 987654321);
});
