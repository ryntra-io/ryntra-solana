import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ADMIN_METRICS, METRIC_IDS, isMetricId } from "./metrics.ts";
import { OVERVIEW_METRIC_IDS } from "./overview.ts";

const repo = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");

test("every metric has a name, unit, source, rule, window, timezone, dedup, denominator, coverage and freshness", () => {
  for (const id of METRIC_IDS) {
    const d = ADMIN_METRICS[id];
    assert.equal(d.id, id);
    for (const field of ["label", "unit", "source", "rule", "window", "dedup", "denominator", "coverage", "freshness"]) {
      assert.ok(typeof d[field] === "string" && d[field].trim().length > 0, `${id}.${field}`);
    }
    assert.equal(d.timezone, "UTC", id);
  }
  assert.equal(new Set(METRIC_IDS).size, METRIC_IDS.length);
  assert.equal(isMetricId("accounts_total"), true);
  assert.equal(isMetricId("visitors_total"), false);
});

test("every metric the Overview projects and every tile the panels draw has a definition", () => {
  for (const id of Object.values(OVERVIEW_METRIC_IDS)) assert.ok(isMetricId(id), id);
  for (const file of ["app/admin/overview-panel.tsx", "app/admin/feedback/feedback-panel.tsx", "app/admin/analytics/analytics-panel.tsx"]) {
    const source = read(file);
    for (const match of source.matchAll(/metric="([a-z0-9_]+)"/g)) assert.ok(isMetricId(match[1]), `${file}: ${match[1]}`);
    for (const match of source.matchAll(/ids=\{\[([^\]]+)\]\}/g)) {
      for (const raw of match[1].split(",")) {
        const id = raw.trim().replace(/^"|"$/g, "");
        if (id) assert.ok(isMetricId(id), `${file}: ${id}`);
      }
    }
  }
});

test("units keep people, rows, events and clicks apart", () => {
  assert.equal(ADMIN_METRICS.journal_note_rows.unit, "rows");
  assert.equal(ADMIN_METRICS.paper_actions_24h.unit, "rows");
  assert.equal(ADMIN_METRICS.site_cta_14d.unit, "clicks");
  assert.equal(ADMIN_METRICS.errors_7d.unit, "events");
  assert.equal(ADMIN_METRICS.signed_in_7d.unit, "accounts");
  assert.equal(ADMIN_METRICS.retention_w1.unit, "rate");
  assert.match(ADMIN_METRICS.signed_in_7d.rule, /cookie/i, "a cookie check is named as not a login");
  assert.match(ADMIN_METRICS.acted_7d.rule, /перегляд сторінки не є дією/);
  assert.match(ADMIN_METRICS.accounts_new_7d.rule, /не перший вхід/);
  assert.match(ADMIN_METRICS.retention_w1.denominator, /неповні когорти не показуються/);
});
