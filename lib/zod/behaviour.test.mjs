/**
 * What moving from zod 4.4.3 to 4.6.7 changed for this repository, and what it
 * did not.
 *
 * Every verdict and message pinned here as "unchanged" was read from zod 4.4.3
 * and is given back the same by the installed zod. The three that changed are
 * pinned as they are now, each with what it means for a person: only input that
 * no client of ours sends reaches them. The date-time rule, the one change that
 * would have reached real input, is kept in `iso-datetime.ts` and its own test.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

const verdict = (schema, value) => schema.safeParse(value).success;
const firstMessage = (schema, value) => schema.safeParse(value).error.issues[0].message;

test("unchanged: the messages an API refusal carries", () => {
  /* `readApiBody` answers with the first issue's path and message. */
  assert.equal(firstMessage(z.string(), 1), "Invalid input: expected string, received number");
  assert.equal(firstMessage(z.string().max(2), "abc"), "Too big: expected string to have <=2 characters");
  assert.equal(firstMessage(z.string().min(2), "a"), "Too small: expected string to have >=2 characters");
  assert.equal(firstMessage(z.string().regex(/^a$/), "b"), "Invalid string: must match pattern /^a$/");
  assert.equal(firstMessage(z.enum(["a", "b"]), "c"), 'Invalid option: expected one of "a"|"b"');
  assert.equal(firstMessage(z.string().url(), "x"), "Invalid URL");
  assert.equal(firstMessage(z.object({}).strict(), { a: 1 }), 'Unrecognized key: "a"');
  assert.equal(firstMessage(z.literal("a"), "b"), 'Invalid input: expected "a"');
  assert.equal(firstMessage(z.number().int(), 1.5), "Invalid input: expected int, received number");
  assert.equal(firstMessage(z.union([z.string(), z.number()]), true), "Invalid input");
  assert.equal(firstMessage(z.array(z.number()).max(1), [1, 2]), "Too big: expected array to have <=1 items");
  assert.equal(firstMessage(z.object({ a: z.string() }), {}), "Invalid input: expected string, received undefined");
  /* A strict body with a wrong value and an extra key reports the value first, as before. */
  const strict = z.object({ a: z.number() }).strict();
  assert.deepEqual(strict.safeParse({ a: "x", b: 1 }).error.issues.map((issue) => issue.code), ["invalid_type", "unrecognized_keys"]);
});

test("unchanged: email, URL and UUID read what they read before", () => {
  const email = z.string().email();
  const emails = [["a@b.co", true], ["a.b@c.de", true], [".a@b.co", false], ["a.@b.co", false], ["a..b@c.de", false], ["a'b@c.de", true], ["a'@c.de", false], ["a+b@c.de", true], ["a@b..co", false], ["a@-b.co", false], ["A_B-C@x.io", true], ["a@b.c", false], ["a b@c.de", false], ["'a@b.co", true], ["a.'b@c.de", true], ["a.'@c.de", false], ["-@a.bc", true], ["a@b.co.", false], ["a@1.co", true], ["😀@b.co", false]];
  for (const [value, expected] of emails) assert.equal(verdict(email, value), expected, value);
  const url = z.string().url();
  const urls = [["https://ryntra.io", true], ["http://localhost:3000/x", true], ["solana:abc", true], ["ftp://x", true], ["https://", false], ["//x", false], ["https://a b", false], ["javascript:alert(1)", true], ["mailto:a@b.co", true], ["https://ex.com:99999", false], ["https://xn--e1a.com", true], ["http://[::1]/", true], ["https://a..b", true], ["https://-a.com", true], ["data:text/plain,hi", true], ["https://exa mple.com", false], ["https:example.com", true], ["file:///etc/passwd", true], ["a:b", true]];
  for (const [value, expected] of urls) assert.equal(verdict(url, value), expected, value);
  const uuid = z.string().uuid();
  const uuids = [["00000000-0000-0000-0000-000000000000", true], ["ffffffff-ffff-ffff-ffff-ffffffffffff", true], ["123e4567-e89b-12d3-a456-426614174000", true], ["123e4567-e89b-72d3-a456-426614174000", true], ["123e4567-e89b-82d3-a456-426614174000", true], ["123e4567-e89b-12d3-c456-426614174000", false], ["123E4567-E89B-12D3-A456-426614174000", true]];
  for (const [value, expected] of uuids) assert.equal(verdict(uuid, value), expected, value);
});

test("unchanged: a record's key schema still refuses a key it does not match", () => {
  const byMint = z.record(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]+$/), z.number());
  assert.equal(verdict(byMint, { abc: 2 }), true);
  assert.equal(verdict(byMint, { "0OIl": 1, abc: 2 }), false);
  const bounded = z.record(z.string().min(1).max(4), z.number());
  assert.equal(verdict(bounded, { toolong: 1 }), false);
  assert.equal(verdict(bounded, { "": 1 }), false);
  const byRole = z.record(z.enum(["a", "b"]), z.number());
  assert.equal(verdict(byRole, { a: 1 }), false);
  assert.equal(verdict(byRole, { a: 1, b: 2 }), true);
  assert.equal(verdict(byRole, { a: 1, b: 2, c: 3 }), false);
});

test("unchanged: a string of letters, digits, Latin and Cyrillic is measured as before", () => {
  /* Every character below is one UTF-16 unit and one code point, so 4.4.3 and 4.6 agree. */
  for (const value of ["abcde", "ééééé", "привіт", "So1aN", "日本語です"]) {
    assert.equal(verdict(z.string().max(value.length), value), true, value);
    assert.equal(verdict(z.string().max(value.length - 1), value), false, value);
    assert.equal(verdict(z.string().min(value.length), value), true, value);
    assert.equal(verdict(z.string().length(value.length), value), true, value);
  }
});

test("changed: a character outside the basic plane counts once, not twice", () => {
  /* zod 4.4.3 counted UTF-16 units, so five emoji were ten. 4.6 counts code points, as Postgres does for
     the columns these strings are written to. Byte limits that matter on chain — a token's name, a memo —
     are measured in bytes by their own code, never by a zod bound. */
  const emoji = "😀";
  assert.equal(verdict(z.string().max(5), emoji.repeat(5)), true, "was refused in 4.4.3");
  assert.equal(verdict(z.string().min(5), emoji.repeat(3)), false, "was accepted in 4.4.3");
  assert.equal(verdict(z.string().length(1), emoji), true, "was refused in 4.4.3");
});

test("changed: an array over its bound is refused at the bound, before its elements", () => {
  /* The fix itself (GHSA-mrhx-c7xc-m3w5): no issue per element of an oversized array. The body is refused
     either way; only the first issue now names the bound rather than an element. */
  const issues = z.object({ list: z.array(z.number()).max(2) }).safeParse({ list: [1, "x", "y", "z"] }).error.issues;
  assert.deepEqual(issues.map((issue) => [issue.code, issue.path.join(".")]), [["too_big", "list"]]);
  const many = z.array(z.string()).max(10).safeParse(Array.from({ length: 100_000 }, () => 0));
  assert.equal(many.error.issues.length, 1);
});

test("changed: a strict body that names its own __proto__ is refused instead of passed with the key dropped", () => {
  const strict = z.object({ a: z.number() }).strict();
  const body = JSON.parse('{"a":1,"__proto__":{"x":1}}');
  assert.deepEqual(strict.safeParse(body).error.issues.map((issue) => issue.code), ["unrecognized_keys"]);
  /* A non-strict object drops it, as before. */
  const loose = z.object({ a: z.number() }).safeParse(body);
  assert.equal(loose.success, true);
  assert.deepEqual(Object.keys(loose.data), ["a"]);
});
