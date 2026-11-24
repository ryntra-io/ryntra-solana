/**
 * The contract's date-time rule, held to what it has always been.
 *
 * The figures below were read from zod 4.4.3, the version every schema here
 * was written against: its own `datetime()` and `datetime({ offset: true })`
 * over the same generated corpus, its patterns, its JSON Schema and its
 * issue. The rule now lives in `iso-datetime.ts` and has to give all of them
 * back unchanged on whatever zod is installed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";

import { ISO_DATETIME_OFFSET, ISO_DATETIME_UTC, isoDateTime, isoDateTimeParams } from "./iso-datetime.ts";

const UTC_SOURCE =
  "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$";
const OFFSET_SOURCE =
  "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$";

/* zod 4.4.3 over `corpus()`: two verdict digits per string (Z only, then with an offset). */
const ZOD_4_4_3 = Object.freeze({ cases: 20_008, accepted: 1_623, sha256: "d969cb9dad7ee08a2f15920aaf5b18b691a6accc29f1a9182f0a154196ea1cfa" });

/* Seeds that cover each branch, then twenty thousand deterministic edits of them. */
function corpus() {
  const base = ["2026-08-14T12:00Z", "2026-08-14T12:00:00Z", "2026-08-14T12:00:00.123Z", "2026-08-14T12:00+03:00", "2024-02-29T23:59:59-23:59", "2026-11-12T10:15:30.123456+00:00", "2000-02-29T00:00Z", "1900-02-29T00:00Z"];
  const alphabet = "0123456789-:T.Z+ zt";
  let seed = 20261112;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const out = [...base];
  for (let i = 0; i < 20000; i++) {
    const chars = base[Math.floor(next() * base.length)].split("");
    const edits = 1 + Math.floor(next() * 3);
    for (let j = 0; j < edits; j++) {
      const at = Math.floor(next() * (chars.length + 1));
      const op = next();
      const ch = alphabet[Math.floor(next() * alphabet.length)];
      if (op < 1 / 3) chars.splice(at, 1);
      else if (op < 2 / 3) chars.splice(at, 0, ch);
      else chars[at] = ch;
    }
    out.push(chars.join(""));
  }
  return out;
}

const verdicts = (utc, offset, cases) => cases.map((s) => `${utc(s) ? 1 : 0}${offset(s) ? 1 : 0}`).join("");
const summary = (digits) => ({
  cases: digits.length / 2,
  accepted: [...digits].filter((c) => c === "1").length,
  sha256: createHash("sha256").update(digits).digest("hex"),
});

test("the patterns are the contract's — seconds optional after Z or an offset", () => {
  assert.equal(ISO_DATETIME_UTC.source, UTC_SOURCE);
  assert.equal(ISO_DATETIME_OFFSET.source, OFFSET_SOURCE);
  assert.equal(ISO_DATETIME_UTC.flags, "");
  assert.equal(ISO_DATETIME_OFFSET.flags, "");
});

test("every schema built by the rule gives zod 4.4.3's verdicts on twenty thousand generated times", () => {
  const cases = corpus();
  const utc = isoDateTime();
  const offset = isoDateTime({ offset: true });
  assert.deepEqual(summary(verdicts((s) => utc.safeParse(s).success, (s) => offset.safeParse(s).success, cases)), ZOD_4_4_3);
  /* The same verdicts inside an object, the path every request body takes. */
  const body = z.object({ at: isoDateTime(), when: isoDateTime({ offset: true }) }).strict();
  const inObject = verdicts((s) => body.safeParse({ at: s, when: "2026-08-14T12:00Z" }).success, (s) => body.safeParse({ at: "2026-08-14T12:00Z", when: s }).success, cases);
  assert.deepEqual(summary(inObject), ZOD_4_4_3);
  /* `z.compile()` (zod 4.5 and later) validates with the format's own pattern too. */
  if (typeof z.compile === "function") {
    const compiled = z.compile(body);
    const fast = verdicts((s) => compiled.safeParse({ at: s, when: "2026-08-14T12:00Z" }).success, (s) => compiled.safeParse({ at: "2026-08-14T12:00Z", when: s }).success, cases);
    assert.deepEqual(summary(fast), ZOD_4_4_3);
  }
  /* The plain patterns agree with the schemas, so a hand-written check can lean on them. */
  assert.deepEqual(summary(verdicts((s) => ISO_DATETIME_UTC.test(s), (s) => ISO_DATETIME_OFFSET.test(s), cases)), ZOD_4_4_3);
});

test("the named times are read as before: minutes alone still count, a missing zone never does", () => {
  const offset = isoDateTime({ offset: true });
  const utc = isoDateTime();
  const cases = [
    ["2026-08-14T12:00Z", true, true],
    ["2026-08-14T12:00+03:00", false, true],
    ["2026-08-14T12:00:00Z", true, true],
    ["2026-08-14T12:00:00.1Z", true, true],
    [`2026-08-14T12:00:00.${"1".repeat(100)}Z`, true, true],
    ["2026-11-12T10:15:30.123456+00:00", false, true],
    ["2024-02-29T23:59:59-23:59", false, true],
    ["0000-02-29T00:00Z", true, true],
    ["2026-08-14T12:00", false, false],
    ["2026-08-14", false, false],
    ["2026-02-29T12:00Z", false, false],
    ["2026-04-31T12:00Z", false, false],
    ["2026-08-14T24:00Z", false, false],
    ["2026-08-14T12:60Z", false, false],
    ["2026-08-14T12:00:60Z", false, false],
    ["2026-08-14T12:00:00.Z", false, false],
    ["2026-08-14T12:00+24:00", false, false],
    ["2026-08-14T12:00+0300", false, false],
    ["2026-08-14T12:00z", false, false],
    ["2026-08-14 12:00:00Z", false, false],
  ];
  for (const [value, plain, withOffset] of cases) {
    assert.equal(utc.safeParse(value).success, plain, value);
    assert.equal(offset.safeParse(value).success, withOffset, value);
  }
  /* Real clocks always write seconds, and those are untouched. */
  const now = new Date().toISOString();
  assert.equal(utc.safeParse(now).success, true);
  assert.equal(offset.safeParse(now).success, true);
});

test("a refused time reports the same issue zod 4.4.3 reported", () => {
  const issue = (schema) => JSON.parse(JSON.stringify(schema.safeParse("x").error.issues));
  assert.deepEqual(issue(isoDateTime()), [{ origin: "string", code: "invalid_format", format: "datetime", pattern: `/${UTC_SOURCE}/`, path: [], message: "Invalid ISO datetime" }]);
  assert.deepEqual(issue(isoDateTime({ offset: true })), [{ origin: "string", code: "invalid_format", format: "datetime", pattern: `/${OFFSET_SOURCE}/`, path: [], message: "Invalid ISO datetime" }]);
});

test("JSON Schema states the same format and pattern, so the documents keep their bytes", () => {
  const json = (schema) => z.toJSONSchema(schema, { target: "draft-2020-12" });
  assert.deepEqual(json(isoDateTime()), { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string", format: "date-time", pattern: UTC_SOURCE });
  assert.deepEqual(json(isoDateTime({ offset: true })), { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string", format: "date-time", pattern: OFFSET_SOURCE });
  /* A check chained before the time keeps its place: the bound first, then the format. */
  assert.deepEqual(Object.keys(json(z.string().max(40).datetime(isoDateTimeParams({ offset: true })))), ["$schema", "type", "maxLength", "format", "pattern"]);
});

test("every date-time in the repository is written with this rule", () => {
  const files = execFileSync("git", ["grep", "-l", "-E", "\\.datetime\\(|z\\.iso\\.datetime\\(", "--", "*.ts", "*.tsx", "*.mjs", "*.js", ":!lib/zod/**", ":!apps/video/**", ":!**/node_modules/**"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const stray = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!/\.datetime\(/.test(line)) continue;
      if (/\.datetime\(isoDateTimeParams\(/.test(line)) continue;
      /* Prose about the method, not a call: comments and strings that name it. */
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
      stray.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
  assert.deepEqual(stray, [], "write isoDateTime() from lib/zod/iso-datetime.ts instead of zod's own datetime()");
});
