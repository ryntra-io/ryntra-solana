// Run from repo root: node --test --test-isolation=none lib/admin-ux.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../app/admin/panel.tsx", import.meta.url), "utf8");
const users = readFileSync(new URL("../app/admin/users/users-panel.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../app/admin/overview-panel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/* The dashboard moved from global `.cb-*` classes and English fallback copy to a
   scoped CSS module and Ukrainian copy. These tests keep asserting the same
   invariants — explicit loading, an announced status region, errors that never
   read as success, bounded transport failures, accessible control names — but
   against the current implementation rather than the literals it used to ship. */

test("admin panel exposes honest loading and accessible status feedback", () => {
  assert.ok(panel.includes("const [loading, setLoading]"), "dashboard needs explicit loading state");
  assert.ok(panel.includes("setLoading(true)"));
  assert.ok(panel.includes("setLoading(false)"));
  // The unavailable case still has to say so, in the surface's own language.
  assert.ok(panel.includes("Дані адмінки недоступні"), "unavailable data needs an explicit state");
  assert.ok(panel.includes('role="status"'));
  assert.ok(panel.includes('aria-live="polite"'));
  assert.ok(panel.includes('role="alert"'), "load failures need an assertive announcement");
  // Errors must not render as green success: tone is explicit, not incidental.
  assert.match(panel, /msgTone === "error" \? styles\.bannerError : styles\.bannerOk/);
  assert.ok(panel.includes('lang="uk"'), "Ukrainian admin surface needs a matching language boundary");
});

test("admin network failures settle and controls have programmatic labels", () => {
  assert.ok(panel.includes('error: "Запит не дійшов до сервера"'), "POST transport errors need a bounded result");
  assert.ok(panel.includes('error: "Некоректна відповідь сервера"'), "invalid JSON must not leave busy controls stuck");
  assert.match(users, /aria-label="Пошук користувачів"/);
  assert.match(users, /aria-label="Пряме повідомлення"/);
  assert.match(panel, /<span className=\{styles\.fieldLabel\}>Текст повідомлення<\/span>/);
});

test("admin funnel reports descriptive counts without a canceled calendar or target gate", () => {
  assert.ok(overview.includes("Воронка") || overview.includes("Огляд"));
  assert.ok(!panel.includes("Валідаційний гейт"));
  assert.ok(!panel.includes("дедлайн 21.07"));
  assert.ok(!panel.includes("const TARGETS"));
  assert.doesNotMatch(panel, /telegram_verified:\s*50|arcus_submitted:\s*20/);
  assert.doesNotMatch(overview, /telegram_verified:\s*50|arcus_submitted:\s*20/);
});

test("admin and recovery focus plus light small-text colors use strong accessible tokens", () => {
  assert.match(css, /\.cb-root :where\([^}]+:focus-visible/s);
  assert.match(css, /\.bg-wrap :where\([^}]+:focus-visible/s);
  /* The caution ink on the light ground: #A8650A, 4.6:1 on white (brand palette v1.0). */
  /* The light rules answer the core's Porcelain too (B1): one selector for both names. */
  const LIGHT = String.raw`(?:\[data-theme="light"\]|:is\(\[data-theme="light"\], \[data-theme="porcelain"\]\))`;
  assert.match(css, new RegExp(String.raw`${LIGHT} \.bg-auth-notice\s*\{\s*color:\s*#A8650A`, "s"));
  assert.match(css, new RegExp(String.raw`${LIGHT} \.bg-eyebrow[^{]*\{\s*color:\s*var\(--accent-strong\)`, "s"));
  assert.match(css, new RegExp(String.raw`${LIGHT} \.cb-badge:not\(\.cb-badge-dim\)[^{]*\{\s*color:\s*var\(--accent-strong\)`, "s"));
});
