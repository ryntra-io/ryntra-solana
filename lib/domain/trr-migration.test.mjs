// Run from repo root: node --test lib/domain/trr-migration.test.mjs
// Static guard on the PREPARED TRR migration — it must never regress to the insecure shape a
// reviewer flagged (bare `search_path = public`, undefined gate fn, missing privilege lockdown,
// unclamped limit, unbounded jsonb). This test is what stops a future edit from re-opening them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../supabase/prepared/20260712_trade_readiness_v1.sql", import.meta.url), "utf8");

test("PREPARED not applied: lives in prepared/, carries the NOT APPLIED banner", () => {
  assert.ok(sql.includes("PREPARED, NOT APPLIED"), "must state PREPARED, NOT APPLIED");
});

test("SECURITY: SECURITY DEFINER functions use an empty search_path", () => {
  // Supabase's recommended shape is an empty path plus fully-qualified relations/functions.
  const defs = sql.match(/security definer\s+set search_path = [^\n]+/gi) ?? [];
  assert.ok(defs.length >= 2, "both RPCs declare a search_path");
  for (const d of defs) assert.match(d, /search_path = ''/i, `unexpected search_path: ${d}`);
  assert.ok(!/search_path = public/i.test(sql), "public must never be trusted by a definer function");
});

test("GATE: uses the real private.beta_check_secret, not the nonexistent app_secret_ok", () => {
  assert.ok(sql.includes("private.beta_check_secret(p_secret)"), "must call private.beta_check_secret");
  assert.ok(!sql.includes("app_secret_ok"), "app_secret_ok does not exist — must not be referenced");
});

test("PRIVILEGES: table and functions are denied to public API roles; RPCs grant anon only", () => {
  assert.match(
    sql,
    /revoke all on table private\.decision_receipts\s+from public, anon, authenticated, service_role/i,
    "raw receipt rows must not be reachable by any Data API role"
  );
  for (const fn of ["trr_append", "trr_list"]) {
    const revoke = new RegExp(
      `revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated, service_role`,
      "i"
    );
    const grant = new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon`, "i");
    assert.match(sql, revoke, `${fn} must be revoked from every role before the anon-only grant`);
    assert.match(sql, grant, `${fn} must be granted to anon only`);
  }
  assert.ok(!/grant execute[^\n]*to (authenticated|service_role)/i.test(sql));
});

test("RLS: private receipt table has RLS enabled with no policies", () => {
  assert.ok(/alter table private\.decision_receipts enable row level security/i.test(sql));
  assert.ok(!/create policy/i.test(sql), "no permissive policies");
});

test("INPUT HARDENING: DecisionReceipt v1 shape, payload, keys and list limit are bounded", () => {
  assert.ok(
    /greatest\(least\(coalesce\(p_limit, 50\), 200\), 1\)/.test(sql),
    "p_limit must preserve the documented NULL default and clamp both bounds"
  );
  assert.ok(/pg_column_size\(receipt\) <= 65536/.test(sql), "receipt jsonb must be size-bounded");
  assert.ok(
    /jsonb_typeof\(receipt\) is not distinct from 'object'/.test(sql),
    "receipt must be a JSON object and SQL NULL must fail closed"
  );
  assert.ok(
    /jsonb_typeof\(receipt->'signals'\) is not distinct from 'array'/.test(sql),
    "signals must be an array"
  );
  assert.ok(
    /jsonb_typeof\(receipt->'plan'\) is not distinct from 'object'/.test(sql),
    "plan must be an object"
  );
  assert.ok(
    /jsonb_typeof\(receipt->'verdict'\) is not distinct from 'object'/.test(sql),
    "verdict must be an object"
  );
  assert.ok(/jsonb_array_length\(receipt->'signals'\) <= 32/.test(sql), "signals count must be bounded");
  assert.ok(/jsonb_array_length\(receipt#>'\{verdict,reasons\}'\) <= 64/.test(sql), "reason count must be bounded");
  assert.ok(/jsonb_array_length\(receipt#>'\{plan,targets\}'\) <= 16/.test(sql), "target count must be bounded");
  assert.ok(/receipt_version smallint not null check \(receipt_version = 1\)/i.test(sql));
  assert.ok(/receipt_kind text not null check \(receipt_kind = 'trade-readiness'\)/i.test(sql));
  assert.ok(/receipt_key uuid not null/i.test(sql), "receipt key must be a UUID");
  assert.ok(/char_length\(trim\(route\)\) between 1 and 64/.test(sql), "route must be non-empty and bounded");
  assert.ok(/char_length\(trim\(instrument\)\) between 1 and 128/.test(sql), "instrument must be non-empty and bounded");
});

test("FAIL-CLOSED CONTRACT: missing nested evidence and NULL type predicates cannot pass", () => {
  for (const objectName of [
    "evaluator",
    "policy",
    "instrument",
    "capability",
    "plan",
    "compliance",
    "verdict",
  ]) {
    assert.match(
      sql,
      new RegExp(`p_receipt->'${objectName}' \\?& array\\[`, "i"),
      `${objectName} must declare its required nested keys`
    );
  }
  assert.match(sql, /e\.value \?& array\[/i, "every risk signal must declare its required keys");
  assert.match(sql, /p_receipt->'intent' \?& array\[/i, "every non-null intent must declare its required keys");
  assert.ok(
    !/jsonb_typeof\([^\n]+\) <>/i.test(sql),
    "jsonb_typeof comparisons must use IS DISTINCT FROM so SQL NULL fails closed"
  );
});

test("USER BINDING: append and list resolve only a Telegram-verified beta user", () => {
  const lookups = sql.match(/select u\.id into v_user[\s\S]*?status = 'verified'/gi) ?? [];
  assert.equal(lookups.length, 2, "both RPCs must require the verified Telegram task");
  assert.ok(!/if v_user is null then return '\[\]'::jsonb/i.test(sql), "unknown callers must fail, not look empty");
});

test("ATOMICITY + QUALIFICATION: one-shot migration fails closed on drift and uses private storage", () => {
  assert.ok(/^begin;/m.test(sql), "must open a transaction");
  assert.ok(/^commit;/m.test(sql), "must commit the transaction");
  assert.match(sql, /create table private\.decision_receipts/i, "receipt table must live in private");
  assert.ok(!/create table if not exists private\.decision_receipts/i.test(sql), "existing drift must fail the apply");
  assert.ok(sql.includes("private.decision_receipts"), "table must be schema-qualified");
  assert.ok(sql.includes("references public.beta_users(id)"), "FK must be schema-qualified");
  assert.ok(sql.includes("create or replace function public.trr_append"), "functions must be schema-qualified");
  assert.ok(/on delete restrict/i.test(sql), "a parent delete must be rejected");
  assert.ok(!/on delete cascade/i.test(sql), "a parent delete must never erase immutable receipts");
});

test("APPEND-ONLY: exact retry returns the original row; conflicting replay fails closed", () => {
  assert.match(
    sql,
    /on conflict \(user_id, receipt_key\) do nothing[\s\S]*?returning \* into v_row/i,
    "first writer inserts; retry must never update"
  );
  assert.ok(!/on conflict[\s\S]{0,200}do update/i.test(sql), "receipt conflicts must never rewrite history");
  assert.match(sql, /v_row\.receipt is distinct from p_receipt/i, "exact retry must compare the immutable payload");
  assert.match(sql, /raise exception 'decision receipt idempotency conflict'/i, "different payload under one key must fail");
  assert.ok(!/update private\.decision_receipts\s+set/i.test(sql), "no receipt update statement is allowed");
  assert.ok(!/delete from private\.decision_receipts/i.test(sql), "no receipt delete statement is allowed");
});

test("APPEND-ONLY: table trigger rejects direct UPDATE and DELETE attempts", () => {
  assert.match(
    sql,
    /create trigger decision_receipts_immutable[\s\S]*before update or delete[\s\S]*on private\.decision_receipts/i
  );
  assert.match(sql, /raise exception 'decision receipts are append-only'/i);
});

test("CONTRACT: receipt captures and binds every DecisionReceipt v1 decision input and output", () => {
  for (const token of [
    "schemaVersion",
    "evaluatedAt",
    "evaluator",
    "policy",
    "instrument",
    "capability",
    "signals",
    "plan",
    "compliance",
    "intent",
    "verdict",
  ]) {
    assert.ok(sql.includes(token), `DecisionReceipt v1 must validate/store ${token}`);
  }
  assert.match(sql, /receipt#>>'\{capability,route\}'/i, "route must be derived from the capability claim");
  assert.match(sql, /receipt#>'\{intent,instrument\}' is distinct from p_receipt->'instrument'/i);
  assert.match(sql, /receipt#>>'\{intent,route\}' is distinct from v_route/i);
});

test("LIST: ordering is deterministic and backed by a matching composite index", () => {
  assert.match(
    sql,
    /on private\.decision_receipts \(user_id, recorded_at desc, id desc\)/i,
    "index must match the list filter and order"
  );
  assert.match(sql, /order by r\.recorded_at desc, r\.id desc/i, "aggregate order needs a stable tie-breaker");
});
