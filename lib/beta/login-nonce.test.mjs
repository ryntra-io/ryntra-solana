import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationUrl = new URL("../../supabase/migrations/20260712224258_login_nonce_v1.sql", import.meta.url);
const sql = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "";
const rpcSource = readFileSync(new URL("./rpc.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../../app/api/session/route.ts", import.meta.url), "utf8");

test("login nonce migration is in canonical applied migration history", () => {
  assert.ok(sql, "applied login-nonce migration must exist");
  assert.match(sql, /APPLIED to production project lbphobwqzwdkbmyedlwb as migration 20260712224258/);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
});

test("nonce storage is private, bounded and protected with RLS", () => {
  assert.match(sql, /create table if not exists private\.login_nonce_consumption/i);
  assert.match(sql, /jti text primary key/i);
  assert.match(sql, /expires_at timestamptz not null/i);
  assert.match(sql, /check \(jti ~ '\^\[A-Za-z0-9_-/);
  assert.match(sql, /enable row level security/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /create index if not exists login_nonce_expiry_idx/i);
});

test("consume RPC is fail-closed, secret-gated and search-path hardened", () => {
  assert.match(sql, /create or replace function public\.beta_consume_login_nonce\(/i);
  assert.match(sql, /returns boolean/i);
  assert.match(sql, /security definer set search_path = ''/i);
  assert.match(sql, /perform private\.beta_check_secret\(p_secret\)/i);
  assert.match(sql, /p_expires_at <= v_now/i);
  assert.match(sql, /p_expires_at > v_now \+ interval '8 days'/i);
  assert.match(sql, /p_jti !~ '\^\[A-Za-z0-9_-/i);
});

test("first redemption wins atomically and replay returns false", () => {
  assert.match(sql, /insert into private\.login_nonce_consumption/i);
  assert.match(sql, /on conflict \(jti\) do nothing/i);
  assert.match(sql, /get diagnostics v_inserted = row_count/i);
  assert.match(sql, /return v_inserted = 1/i);
  assert.match(sql, /delete from private\.login_nonce_consumption[\s\S]*expires_at <= v_now/i);
});

test("function privileges expose only the secret-gated RPC to anon", () => {
  assert.match(sql, /revoke all on table private\.login_nonce_consumption from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.beta_consume_login_nonce\(text, text, timestamptz\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.beta_consume_login_nonce\(text, text, timestamptz\) to anon/i);
});

test("server wiring consumes nonce before minting a session and fails closed", () => {
  assert.match(rpcSource, /export async function consumeLoginNonce/);
  assert.match(rpcSource, /beta_consume_login_nonce/);
  const consumeAt = routeSource.indexOf("consumeLoginNonce(login.jti");
  const mintAt = routeSource.indexOf("const sessionToken =");
  assert.ok(consumeAt > 0 && mintAt > consumeAt);
  assert.match(routeSource, /if \(!consumed\)/);
});
