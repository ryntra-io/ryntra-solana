import assert from "node:assert/strict";
import test from "node:test";

process.env.BETA_TOKEN_SECRET = process.env.BETA_TOKEN_SECRET || "round-trip-test-secret-0123456789";

const { issueRoundTrip, readRoundTrip } = await import("./round-trip.ts");

test("a round trip is signed, bound to a nonce and expires on its own", () => {
  const now = Date.parse("2026-09-06T12:00:00.000Z");
  const issued = issueRoundTrip({ method: "google", purpose: "signin", next: "/app/plans" }, now);
  assert.ok(issued);
  assert.match(issued.trip.nonce, /^[A-Za-z0-9_-]{24}$/);
  const back = readRoundTrip(issued.value, now + 5 * 60_000);
  assert.deepEqual(back, issued.trip);
  assert.equal(readRoundTrip(issued.value, now + 11 * 60_000), null, "ten minutes is the limit");
  assert.equal(readRoundTrip(issued.value, now - 2 * 60_000), null, "a value from the future is refused");
});

test("a forged or altered cookie reads as nothing", () => {
  const now = Date.now();
  const issued = issueRoundTrip({ method: "telegram", purpose: "link", next: "/app/settings" }, now);
  assert.ok(issued);
  const [payload, mac] = issued.value.split(".");
  const altered = Buffer.from(JSON.stringify({ ...issued.trip, next: "/admin" })).toString("base64url");
  assert.equal(readRoundTrip(`${altered}.${mac}`, now), null);
  /*
   * A forgery that is guaranteed to be one.
   *
   * This wrote `${mac.slice(0, -2)}AA`, which is a forgery only when the
   * genuine MAC does not already end in `AA` — and it does, on measurement,
   * once in about 976 runs, because the nonce is random and the last
   * base64url character of a 32-byte MAC is constrained. On those runs the
   * "altered" cookie was byte-identical to the real one, `readRoundTrip`
   * correctly returned the trip, and a green suite went red for a product
   * that had done nothing wrong.
   *
   * Flipping the last *character* does not fix it either, and that is the
   * subtler half: 32 bytes take 43 base64url characters, 43 x 6 = 258 bits,
   * so the final character carries four significant bits and two the
   * decoder ignores. `...A` and `...B` decode to the same 32 bytes. The
   * tamper is therefore done on the bytes and then proven, so this test
   * can only pass by actually rejecting a forgery.
   */
  const bytes = Buffer.from(mac, "base64url");
  bytes[0] ^= 0xff;
  const tampered = bytes.toString("base64url");
  /* Proven to be a forgery, not assumed to be one. */
  assert.notDeepEqual(Buffer.from(tampered, "base64url"), Buffer.from(mac, "base64url"));
  assert.equal(readRoundTrip(`${payload}.${tampered}`, now), null);
  assert.equal(readRoundTrip("", now), null);
  assert.equal(readRoundTrip(null, now), null);
  assert.equal(readRoundTrip("x".repeat(3000), now), null);
});
