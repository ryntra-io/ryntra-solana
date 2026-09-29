// Run from repo root: node --test lib/landing/truth.test.mjs
// Public runtime boundaries are guarded here; product truth lives only in
// lib/product/capabilities.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLIC_CAPABILITIES,
  productCapabilityById,
} from "../product/capabilities.ts";

test("public claims read directly from the canonical capability registry", () => {
  assert.ok(PUBLIC_CAPABILITIES.length >= 15);
  assert.equal(productCapabilityById("arcus-spot-rfq").mode, "supported_live");
  assert.equal(productCapabilityById("rwa-risk-pack").mode, "read_only");
  assert.equal(productCapabilityById("smarttrade-plan").mode, "paper_only");
  assert.equal(productCapabilityById("decision-journal").maturity, "paper");
  assert.equal(productCapabilityById("telegram-daily-recap").mode, "read_only");
  assert.equal(productCapabilityById("guarded-automation").maturity, "after_gate");
  assert.equal(productCapabilityById("sequencer-monitoring").maturity, "after_gate");
  for (const capability of PUBLIC_CAPABILITIES) {
    assert.match(capability.lastVerifiedAt, /^\d{4}-\d{2}-\d{2}$/, capability.id);
  }
});

test("direct demo route is a public read-only tour that stays noindex", () => {
  const source = readFileSync(new URL("../../app/demo/page.tsx", import.meta.url), "utf8");
  assert.match(source, /PublicDemoTour/);
  assert.doesNotMatch(source, /!sp\.t[^\n]+401/);
  assert.match(source, /robots:\s*\{ index: false, follow: false \}/);
  assert.doesNotMatch(source, /index:\s*true/);
});

test("Vercel Analytics is mounted only in a Vercel runtime", () => {
  const source = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /process\.env\.VERCEL\s*\?/);
  assert.doesNotMatch(source, /^\s*<Analytics\s*\/>\s*$/m);
});
