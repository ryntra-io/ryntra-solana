// Run from repo root: node --test lib/domain/registry.test.mjs
// The product capability registry, route capability registry, and feature flags
// must tell one story. This suite fails when shipped maturity, route state, or
// exposure flags drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLAGS } from "../../app/config/features.ts";
import {
  CAPABILITY_MATURITIES,
  PUBLIC_CAPABILITIES,
  productCapabilityById,
} from "../product/capabilities.ts";
import { ROUTE_CAPABILITIES, APP_CAPABILITY_VERIFIED_AT } from "./registry.ts";
import { ROUTES } from "./ids.ts";
import { capabilityTone } from "./capability.ts";

test("every route has a capability entry with a well-formed verification date", () => {
  for (const id of Object.keys(ROUTES)) {
    const cap = ROUTE_CAPABILITIES[id];
    assert.ok(cap, `route ${id} missing from ROUTE_CAPABILITIES`);
    assert.match(cap.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.match(APP_CAPABILITY_VERIFIED_AT, /^\d{4}-\d{2}-\d{2}$/);
});

test("DRIFT: Arcus spot product maturity matches the live route registry", () => {
  const product = productCapabilityById("arcus-spot-rfq");
  const route = ROUTE_CAPABILITIES["arcus-spot-rfq"];
  assert.equal(product.maturity, "live");
  assert.equal(product.mode, "supported_live");
  assert.equal(route.ryntra, "live");
});

test("DRIFT: guarded automation is not shipped, so no bots flag may be true", () => {
  const product = productCapabilityById("guarded-automation");
  const anyBotsOn = Object.values(FLAGS.bots).some(Boolean);
  assert.equal(product.maturity, "after_gate");
  assert.equal(anyBotsOn, false,
    `guarded automation is ${product.maturity} but FLAGS.bots has a true flag: ${JSON.stringify(FLAGS.bots)}`);
});

test("DRIFT: SmartTrade paper maturity matches paper-on and live-off flags", () => {
  const product = productCapabilityById("smarttrade-plan");
  assert.equal(product.maturity, "paper");
  assert.equal(product.mode, "paper_only");
  assert.equal(FLAGS.smarttrade.paper, true);
  assert.equal(FLAGS.smarttrade.live, false);
});

test("DRIFT: no DOM/orderflow claims while terminal.dom is off", () => {
  assert.equal(FLAGS.terminal.dom, false, "DOM flag must stay off until a real CLOB feed ships");
  assert.equal(FLAGS.terminal.clusters, false);
  assert.equal(FLAGS.terminal.volumeProfile, false);
});

test("HONESTY: an unverified source can never carry a live claim or green tone", () => {
  for (const [id, cap] of Object.entries(ROUTE_CAPABILITIES)) {
    if (cap.source === "unverified") {
      assert.notEqual(cap.ryntra, "live", `${id}: unverified source cannot back a live claim`);
      assert.notEqual(capabilityTone(cap), "ok", `${id}: unverified source cannot tone green`);
    }
    if (cap.ryntra !== "live" || cap.protocol !== "live" || cap.user !== "available") {
      assert.notEqual(capabilityTone(cap), "ok", `${id} must not render green`);
    }
  }
});

test("HONESTY: every gated or planned route states its reason", () => {
  for (const [id, cap] of Object.entries(ROUTE_CAPABILITIES)) {
    if (cap.ryntra !== "live") {
      assert.ok((cap.reason ?? "").length >= 10, `${id} needs a real reason for not being live`);
    }
  }
});

test("canonical product registry uses only the approved maturity vocabulary", () => {
  for (const capability of PUBLIC_CAPABILITIES) {
    assert.ok(CAPABILITY_MATURITIES.includes(capability.maturity), capability.id);
  }
});
