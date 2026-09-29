import assert from "node:assert/strict";
import test from "node:test";

import { attentionItems, fillDaily30d, projectOverview } from "./overview.ts";
import { parseActivitySummary } from "./activity.ts";

const now = new Date("2026-09-05T12:00:00.000Z");

const metrics = {
  users_total: 5,
  tasks: { telegram_verified: 3 },
  cta_events_14d: { telegram_cta_click: 4, workspace_cta_click: 2 },
};
const extra = {
  paper: { traders: 1, trades_24h: 0 },
  live: { journal_notes: 2, watched_addresses: 1 },
};

const summaryRaw = {
  ok: true,
  now: now.toISOString(),
  coverage: { logins_since: "2026-08-03T09:00:00Z", events_since: "2026-08-05T10:00:00Z", login_rows: 7, event_rows: 5 },
  operators: { accounts: 1, logins_30d: 2 },
  accounts: { total: 4, new_7d: 1, new_30d: 3, ever_signed_in: 3, signed_in_7d: 2, signed_in_30d: 3, acted_7d: 1, acted_30d: 1, activated: 1, with_errors_7d: 1 },
  logins: { count_7d: 2, count_30d: 4, by_kind_30d: { telegram_link: 4 } },
  events: { ok_7d: 2, error_7d: 1, refused_7d: 0, ok_30d: 3, error_30d: 1, anonymous_ok_30d: 1, by_name_30d: { paper_plan_opened: 1, journal_note_saved: 1, feedback_sent: 1 }, error_classes_7d: { store_unavailable: 1 } },
  daily_30d: [{ day: "2026-09-04", signed_in: 1, acted: 1, errors: 0 }],
  activation_14d: { n: 2, activated: 1 },
  cohorts: [
    { week: "2026-08-03", n: 1, returned_w1: 1, complete: true },
    { week: "2026-08-10", n: 1, returned_w1: 0, complete: true },
    { week: "2026-08-31", n: 1, returned_w1: 0, complete: false },
  ],
};

const measuredActivity = { status: "measured", summary: parseActivitySummary(summaryRaw) };

test("an unapplied activity store is not collected, and never a zero", () => {
  const model = projectOverview({ metrics, extra, feedback: { rows: [] }, broadcasts: [], activity: { status: "not_collected" }, now });
  assert.equal(model.accounts.signedIn7d.status, "not_collected");
  assert.equal(model.accounts.signedIn7d.value, undefined);
  assert.equal(model.accounts.acted7d.status, "not_collected");
  assert.equal(model.accounts.activation14d.status, "not_collected");
  assert.equal(model.funnel.firstLogin.status, "not_collected");
  assert.equal(model.problems.errors7d.status, "not_collected");
  assert.equal(model.daily30d.length, 0);
  /* Beta metrics still answer for what they own. */
  assert.deepEqual(model.accounts.total, { value: 5, status: "measured" });
  assert.deepEqual(model.funnel.accessConfirmed, { value: 3, status: "measured" });
  assert.deepEqual(model.demand.siteWorkspaceCta14d, { value: 2, status: "measured" });
  assert.ok(model.attention.some((item) => item.id === "coverage" && item.tone === "muted"));
  assert.equal(JSON.stringify(model).includes("wallet"), false);
  assert.equal(JSON.stringify(model).includes("pnl"), false);
});

test("a measured store projects accounts, rates with denominators, and the latest complete cohort", () => {
  const model = projectOverview({ metrics, extra, feedback: { rows: [] }, broadcasts: [], activity: measuredActivity, now });
  assert.deepEqual(model.accounts.total, { value: 4, status: "measured" }, "operator excluded by the store, not by beta_metrics");
  assert.deepEqual(model.accounts.signedIn7d, { value: 2, status: "measured" });
  assert.deepEqual(model.accounts.acted7d, { value: 1, status: "measured" });
  assert.deepEqual(model.accounts.activation14d, { value: 0.5, status: "measured", n: 2, period: undefined });
  assert.deepEqual(model.accounts.retentionW1, { value: 0, status: "measured", n: 1, period: "2026-08-10" }, "the incomplete 08-31 cohort is skipped");
  assert.deepEqual(model.funnel.returnedW1, { value: 0, status: "measured", n: 1, period: "2026-08-10" });
  assert.deepEqual(model.problems.errorClasses, [{ name: "store_unavailable", count: 1 }]);
  assert.equal(model.coverage.activity, "measured");
  assert.equal(model.coverage.loginsSince, "2026-08-03T09:00:00Z");
  assert.equal(model.daily30d.length, 30);
  assert.deepEqual(model.daily30d[29], { day: "2026-09-05", signedIn: 0, acted: 0, errors: 0 }, "a day the store measured nothing is a measured zero");
  assert.deepEqual(model.daily30d[28], { day: "2026-09-04", signedIn: 1, acted: 1, errors: 0 });
});

test("a zero denominator or an incomplete cohort is insufficient, not zero percent", () => {
  const raw = { ...summaryRaw, activation_14d: { n: 0, activated: 0 }, cohorts: [{ week: "2026-08-31", n: 1, returned_w1: 0, complete: false }] };
  const model = projectOverview({ metrics, extra, feedback: { rows: [] }, broadcasts: [], activity: { status: "measured", summary: parseActivitySummary(raw) }, now });
  assert.equal(model.accounts.activation14d.status, "insufficient");
  assert.equal(model.accounts.activation14d.value, undefined);
  assert.equal(model.accounts.retentionW1.status, "insufficient");
  assert.equal(model.funnel.returnedW1.status, "insufficient");
});

test("one failing source hides nothing else and becomes an attention line", () => {
  const model = projectOverview({ metrics: null, extra: null, feedback: { rows: null }, broadcasts: null, activity: { status: "unavailable" }, now });
  assert.equal(model.accounts.total.status, "unavailable");
  assert.equal(model.support.open.status, "unavailable");
  assert.equal(model.problems.broadcastFailures.status, "unavailable");
  assert.equal(model.demand.paperActive.status, "unavailable");
  assert.equal(model.coverage.activity, "unavailable");
  const ids = model.attention.map((item) => item.id);
  assert.ok(ids.includes("coverage_unavailable"));
  assert.ok(ids.includes("feedback_unavailable"));
  assert.ok(ids.includes("broadcasts_unavailable"));
});

test("support and broadcast facts are measured from their rows, with an honest empty state", () => {
  const rows = [
    { id: "1", public_ref: "RYN-FB-00000001", source: "app", category: "bug", status: "OPEN", priority: "NORMAL", telegram_id: 1, locale: "uk", created_at: "2026-09-03T12:00:00.000Z", updated_at: "2026-09-03T12:00:00.000Z", preview: "x" },
    { id: "2", public_ref: "RYN-FB-00000002", source: "app", category: "security", status: "WAITING", priority: "SECURITY", telegram_id: 2, locale: "uk", created_at: "2026-09-04T12:00:00.000Z", updated_at: "2026-09-04T13:00:00.000Z", preview: "y" },
    { id: "3", public_ref: "RYN-FB-00000003", source: "site", category: "idea", status: "CLOSED", priority: "NORMAL", telegram_id: null, locale: "en", created_at: "2026-09-01T12:00:00.000Z", updated_at: "2026-09-02T12:00:00.000Z", preview: "z" },
  ];
  const broadcasts = [
    { id: "b", public_ref: "RYN-BC-00000001", name: "n", audience: "all", state: "PARTIAL", queued_count: 0, sent_count: 3, failed_count: 2, blocked_count: 1, test_sent_at: null, scheduled_at: null, created_at: "2026-09-01T00:00:00.000Z" },
    { id: "c", public_ref: "RYN-BC-00000002", name: "m", audience: "all", state: "COMPLETED", queued_count: 0, sent_count: 3, failed_count: 0, blocked_count: 0, test_sent_at: null, scheduled_at: null, created_at: "2026-09-01T00:00:00.000Z" },
  ];
  const model = projectOverview({ metrics, extra, feedback: { rows }, broadcasts, activity: measuredActivity, now });
  assert.deepEqual(model.support.open, { value: 1, status: "measured" });
  assert.deepEqual(model.support.waiting, { value: 1, status: "measured" });
  assert.deepEqual(model.support.securityOpen, { value: 1, status: "measured" });
  assert.deepEqual(model.support.oldestOpenHours, { value: 48, status: "measured" });
  assert.deepEqual(model.problems.broadcastFailures, { value: 3, status: "measured" });
  const ids = model.attention.map((item) => item.id);
  assert.deepEqual(ids.slice(0, 4), ["security", "feedback_open", "errors", "broadcast"]);
  assert.ok(model.attention.every((item) => item.href.startsWith("/admin/")));

  const quiet = projectOverview({ metrics, extra, feedback: { rows: [] }, broadcasts: [], activity: { status: "measured", summary: parseActivitySummary({ ...summaryRaw, events: { ...summaryRaw.events, error_7d: 0, error_classes_7d: {} }, accounts: { ...summaryRaw.accounts, with_errors_7d: 0 } }) }, now });
  assert.deepEqual(quiet.attention, [], "nothing urgent is an empty list, and the surface composes the all-clear line");
  assert.deepEqual(quiet.support.oldestOpenHours, { value: undefined, status: "none" }, "no open thread has an age: an absence, not zero hours");
});

test("services that are not healthy raise one attention line with the worst tone", () => {
  const model = projectOverview({
    metrics, extra, feedback: { rows: [] }, broadcasts: [], activity: measuredActivity, now,
    services: [
      { id: "database", label: "База", state: "HEALTHY" },
      { id: "telegram_bot", label: "Бот", state: "DEGRADED" },
      { id: "activity_store", label: "Сховище", state: "UNAVAILABLE" },
    ],
  });
  const services = attentionItems(model).find((item) => item.id === "services");
  assert.deepEqual(services, { id: "services", label: "Провайдери недоступні", value: 2, tone: "risk", href: "/admin/operations" });
});

test("fillDaily30d ends today, starts 29 days earlier and keeps measured rows", () => {
  const days = fillDaily30d([{ day: "2026-08-07", signedIn: 3, acted: 2, errors: 1 }], now);
  assert.equal(days.length, 30);
  assert.equal(days[0].day, "2026-08-07");
  assert.deepEqual(days[0], { day: "2026-08-07", signedIn: 3, acted: 2, errors: 1 });
  assert.equal(days[29].day, "2026-09-05");
});
