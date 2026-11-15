// Run from repo root: node --test lib/admin/funnel.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FUNNEL_ORDER, funnelDays, funnelRows, funnelTable, isFunnelScope } from "./funnel.ts";

/**
 * The admin's «Воронка»: the city's moments by day and device, robots left out by the store, the web and the
 * Ryntra app apart. Visits, never people; nothing but a moment, a device, a day and a count reaches the page.
 */

test("the days are the last N up to today, oldest first, in UTC", () => {
  assert.deepEqual(funnelDays("2026-11-12", 3), ["2026-11-10", "2026-11-11", "2026-11-12"]);
  assert.deepEqual(funnelDays("2026-03-01", 2), ["2026-02-28", "2026-03-01"]);
  assert.deepEqual(funnelDays("not a day", 3), []);
});

test("the store's rows are held to their shape: an unknown moment, device, day or count is dropped", () => {
  const rows = funnelRows([
    { day: "2026-11-12", name: "agent_home", device: "desk", n: 3 },
    { day: "2026-11-12", name: "agent_home", device: "bot", n: 9 },
    { day: "2026-11-12", name: "telegram_cta_click", device: "desk", n: 1 },
    { day: "12.11.2026", name: "agent_home", device: "desk", n: 1 },
    { day: "2026-11-12", name: "agent_card", device: "phone", n: -1 },
    { day: "2026-11-12", name: "agent_card", device: "phone", n: 1.5 },
    { day: "2026-11-12", name: "agent_card", device: "phone", n: 2, wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
    null,
    "x",
  ]);
  assert.deepEqual(rows, [
    { day: "2026-11-12", name: "agent_home", device: "desk", n: 3 },
    { day: "2026-11-12", name: "agent_card", device: "phone", n: 2 },
  ]);
  assert.deepEqual(funnelRows({ rows: [] }), []);
});

test("a table per scope: the web is a desk and a phone's browser, the app apart; shares are of the first screen", () => {
  const days = funnelDays("2026-11-12", 2);
  const rows = [
    { day: "2026-11-11", name: "agent_home", device: "desk", n: 10 },
    { day: "2026-11-12", name: "agent_home", device: "phone", n: 6 },
    { day: "2026-11-12", name: "agent_home", device: "app", n: 4 },
    { day: "2026-11-12", name: "agent_card", device: "desk", n: 2 },
    { day: "2026-11-12", name: "agent_traded", device: "app", n: 1 },
    { day: "2026-10-01", name: "agent_home", device: "desk", n: 99 },
  ];
  const web = funnelTable(rows, days, "web");
  const home = web.rows.find((r) => r.name === "agent_home");
  assert.deepEqual(home.counts, [10, 6]);
  assert.equal(home.total, 16, "a day outside the table is not counted");
  assert.equal(web.rows.find((r) => r.name === "agent_card").ofHome, 2 / 16);
  assert.equal(web.rows.find((r) => r.name === "agent_traded").total, 0);
  const app = funnelTable(rows, days, "app");
  assert.equal(app.rows.find((r) => r.name === "agent_home").total, 4);
  assert.equal(app.rows.find((r) => r.name === "agent_traded").ofHome, 1 / 4);
  const all = funnelTable(rows, days, "all");
  assert.equal(all.rows.find((r) => r.name === "agent_home").total, 20);
  assert.deepEqual(all.rows.map((r) => r.name), [...FUNNEL_ORDER]);
  const none = funnelTable([], days, "desk");
  assert.equal(none.rows[0].ofHome, null, "no first screen, no share — never a 0 %");
  assert.equal(isFunnelScope("web"), true);
  assert.equal(isFunnelScope("bot"), false);
});

test("the store's read is one function behind the secret: no table, no grant on `events` changes; robots apart", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261112180000_admin_agent_funnel.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.admin_agent_funnel\(p_secret text, p_days integer default 14\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /perform private\.beta_check_secret\(p_secret\);/);
  assert.match(sql, /<> 'bot'/);
  assert.match(sql, /revoke all on function public\.admin_agent_funnel\(text, integer\) from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.admin_agent_funnel\(text, integer\) to anon;/);
  const code = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(code, /create table|alter table|insert into|update public|delete from|drop /i);
  assert.doesNotMatch(code, /'ref',|'path',|'locale',/, "only a moment, a device, a day and a count leave the store");
});

test("the page is the admin's alone: behind the session, out of the index, in the insights menu", () => {
  const page = readFileSync(new URL("../../app/admin/funnel/page.tsx", import.meta.url), "utf8");
  assert.match(page, /getAdminSession\(\)/);
  assert.match(page, /AdminUnauthorized/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  const nav = readFileSync(new URL("../../app/admin/shell/nav.ts", import.meta.url), "utf8");
  assert.match(nav, /\{ id: "funnel", label: "Воронка", href: "\/admin\/funnel", group: "insights" \}/);
});
