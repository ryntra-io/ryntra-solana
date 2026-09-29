import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260829180000_ryn_admin_001_control_center_v1.sql", import.meta.url),
  "utf8",
);
const feedbackSql = readFileSync(
  new URL("../../supabase/migrations/20260830120000_ryn_admin_002_feedback_inbox_v1.sql", import.meta.url),
  "utf8",
);
const broadcastSql = readFileSync(
  new URL("../../supabase/migrations/20260830180000_ryn_admin_003_broadcast_center_v1.sql", import.meta.url),
  "utf8",
);
const finishSql = readFileSync(
  new URL("../../supabase/migrations/20260830200000_ryn_admin_005_finish_v1.sql", import.meta.url),
  "utf8",
);

test("the Control Center migration is private, secret-gated and audit-immutable", () => {
  assert.match(sql, /create table private\.admin_operators/);
  assert.match(sql, /create table private\.admin_audit_events/);
  assert.match(sql, /create table private\.access_controls/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /admin audit events are append-only/);
  assert.match(sql, /before update or delete on private\.admin_audit_events/);
  assert.match(sql, /before truncate on private\.admin_audit_events/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /perform private\.beta_check_secret\(p_secret\)/);
  assert.doesNotMatch(sql, /wallet_address/);
  assert.doesNotMatch(sql, /pnl/i);
  assert.doesNotMatch(sql, /portfolio/i);
  assert.doesNotMatch(sql, /app\/admin\/academy/);
});

test("the feedback inbox migration is private, secret-gated and body-bounded", () => {
  assert.match(feedbackSql, /create table private\.feedback_threads/);
  assert.match(feedbackSql, /create table private\.feedback_messages/);
  assert.match(feedbackSql, /force row level security/);
  assert.match(feedbackSql, /perform private\.beta_check_secret\(p_secret\)/);
  assert.match(feedbackSql, /set search_path = ''/);
  assert.match(feedbackSql, /RYN-FB-/);
  assert.doesNotMatch(feedbackSql, /wallet_address/);
  assert.doesNotMatch(feedbackSql, /pnl/i);
  assert.doesNotMatch(feedbackSql, /app\/admin\/academy/);
});

test("the broadcast campaign migration is private, secret-gated and has no read receipt", () => {
  assert.match(broadcastSql, /create table private\.broadcast_campaigns/);
  assert.match(broadcastSql, /create table private\.broadcast_deliveries/);
  assert.match(broadcastSql, /force row level security/);
  assert.match(broadcastSql, /perform private\.beta_check_secret\(p_secret\)/);
  assert.match(broadcastSql, /set search_path = ''/);
  assert.match(broadcastSql, /test_required/);
  assert.match(broadcastSql, /RYN-BC-/);
  assert.doesNotMatch(broadcastSql, /read_count|open_rate|прочитано/i);
  assert.doesNotMatch(broadcastSql, /wallet_address/);
  assert.doesNotMatch(broadcastSql, /pnl/i);
  assert.doesNotMatch(broadcastSql, /app\/admin\/academy/);
});

test("notification prefs are private, secret-gated and grandfather missing rows", () => {
  assert.match(finishSql, /create table private\.notification_preferences/);
  assert.match(finishSql, /force row level security/);
  assert.match(finishSql, /check \(service_security = true\)/);
  assert.match(finishSql, /perform private\.beta_check_secret\(p_secret\)/);
  assert.match(finishSql, /set search_path = ''/);
  assert.match(finishSql, /Missing preference rows stay eligible/);
  assert.match(finishSql, /p\.product_updates is false/);
  assert.doesNotMatch(finishSql, /wallet_address/);
  assert.doesNotMatch(finishSql, /pnl/i);
  assert.doesNotMatch(finishSql, /app\/admin\/academy/);
});

const activitySql = readFileSync(
  new URL("../../supabase/migrations/20260905120000_ryn_admin_006_activity_v1.sql", import.meta.url),
  "utf8",
);

test("the activity migration is private, secret-gated, nonce-deduplicated and refuses forbidden props", () => {
  assert.match(activitySql, /create table private\.account_logins/);
  assert.match(activitySql, /create table private\.product_events/);
  assert.match(activitySql, /nonce text unique/);
  assert.match(activitySql, /on conflict \(nonce\) do nothing/);
  assert.match(activitySql, /force row level security/);
  assert.match(activitySql, /revoke all privileges on table private\.account_logins, private\.product_events/);
  assert.match(activitySql, /perform private\.beta_check_secret\(p_secret\)/);
  assert.match(activitySql, /set search_path = ''/);
  assert.match(activitySql, /not \(props \?\| array\[/, "the database refuses forbidden prop keys itself");
  assert.match(activitySql, /'wallet_address', 'walletAddress', 'wallet', 'address', 'tx_hash'/);
  assert.match(activitySql, /join private\.admin_operators o on o\.telegram_id = u\.telegram_id/, "operators are excluded by the reads");
  assert.match(activitySql, /l\.admin = false/, "admin-panel logins are not product logins");
  assert.match(activitySql, /interval '14 days'/, "activation and week-1 return use a 14-day window");
  assert.match(activitySql, /complete/, "cohorts carry a completeness flag");
  assert.doesNotMatch(activitySql, /(^|[^a-z_])(balance|amount|pnl|portfolio_value|wallet_address)\s+(numeric|text|bigint|integer|jsonb)/im, "no financial or address column");
  assert.doesNotMatch(activitySql, /ip_address|user_agent/);
  assert.match(activitySql, /APPLIED to production project lbphobwqzwdkbmyedlwb/);
  assert.match(activitySql, /zero rows in both stores/);
});

const accountsSql = readFileSync(
  new URL("../../supabase/migrations/20260906120000_ryn_access_002_accounts_v1.sql", import.meta.url),
  "utf8",
);

test("the accounts migration keeps identities apart, sessions revocable and wallets proven", () => {
  assert.match(accountsSql, /add column if not exists auth_user_id uuid/);
  assert.match(accountsSql, /check \(telegram_id is not null or verified_wallet is not null or auth_user_id is not null\)/);
  assert.match(accountsSql, /create table private\.account_wallets/);
  assert.match(accountsSql, /create table private\.sessions/);
  assert.match(accountsSql, /create table private\.wallet_receipts/);
  assert.match(accountsSql, /unique \(chain, address\)/, "one owner per address");
  assert.match(accountsSql, /\^\[1-9A-HJ-NP-Za-km-z\]\{32,44\}\$/, "Solana addresses stay case-sensitive base58");
  assert.match(accountsSql, /revoked_at timestamptz/);
  assert.match(accountsSql, /idle_seconds integer/);
  assert.match(accountsSql, /mfa_verified_at timestamptz/);
  assert.match(accountsSql, /'telegram_claimed'/, "a bound legacy row is a collision, never a merge");
  assert.match(accountsSql, /'wallet_taken'/);
  assert.match(accountsSql, /on conflict \(chain, address, content_hash\) do nothing/, "a signed receipt is never overwritten");
  assert.match(accountsSql, /create function private\.account_actor\(p_telegram_id bigint, p_account_id uuid, p_scope text\)/);
  assert.match(accountsSql, /p_account_id uuid default null/, "the Telegram-keyed RPCs gain an account path");
  assert.match(accountsSql, /'email_password', 'email_recovery', 'google_oidc', 'telegram_oidc', 'solana_siws'/);
  assert.match(accountsSql, /force row level security/);
  assert.match(accountsSql, /revoke all privileges on table private\.account_wallets, private\.sessions, private\.wallet_receipts/);
  assert.match(accountsSql, /perform private\.beta_check_secret\(p_secret\)/);
  assert.match(accountsSql, /set search_path = ''/);
  assert.doesNotMatch(accountsSql, /password_hash|totp_secret|recovery_code|encrypted_password/i, "no credential material lives in the product database");
  assert.doesNotMatch(accountsSql, /\bpnl (numeric|text)|portfolio_value (numeric|text)/i, "no financial column");
  /* The header states where this file stands with production, and it now says
     applied. Every function whose signature changed drops its exact old
     signature first: without that, `create or replace` with an added parameter
     leaves a second candidate behind and PostgREST refuses the call it used to
     serve. */
  assert.match(accountsSql, /APPLIED to production\r?\n-- project lbphobwqzwdkbmyedlwb/);
  for (const changed of [
    "strategy_lab_append_version",
    "strategy_lab_append_proposal",
    "strategy_lab_list",
    "strategy_lab_get",
    "strategy_lab_append_run",
    "paper_open",
    "paper_close",
    "paper_journal",
    "paper_list",
    "live_note_upsert",
    "live_notes_list",
    "beta_set_language",
    "account_login_record",
    "product_event_append",
    "admin_user_activity",
  ]) {
    assert.match(accountsSql, new RegExp(`drop function if exists public\\.${changed}\\(`), `${changed} must drop its old signature`);
  }
});
