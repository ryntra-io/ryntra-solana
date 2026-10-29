// Run from repo root: node --test app/agents/workspace/procurement/procurement-surface.test.mjs
//
// What the procurement surface is allowed to be.
//
// The one defect this file exists to prevent is a page that looks finished. A
// hub with no registered provider, no price and no facilitator is honest only
// while it says so in its own words — so the blocker is checked for the actual
// missing things, the registry is checked for being genuinely empty, and every
// panel holding a disclosure is checked for being able to scroll, which is the
// defect the commerce surface found by looking rather than by measuring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WORKSPACE_SURFACES, workspaceSurface } from "../surfaces.ts";
import { buildProcurementSurface, mandateRows, usdc } from "../../../../lib/agent-control/procurement/current.ts";
import { fixtureSellerEnv } from "../../../../lib/agent-control/procurement/fixtures.ts";

const src = (path) => readFileSync(path, "utf8").split("\r\n").join("\n");

const PAGE = src("app/agents/workspace/procurement/page.tsx");
const SHELL = src("app/agents/workspace/agent-manifest.ts");
const CATALOG = src("app/agents/workspace/i18n/catalog.ts");
const CSS = src("app/agents/workspace/procurement/procurement.module.css");

const NOW_MS = Date.parse("2026-10-26T12:00:00.000Z");

test("the surface is in the manifest and the rail, in both languages", () => {
  const surface = workspaceSurface("procurement");
  assert.equal(surface.href, "/agents/workspace/procurement");
  assert.equal(surface.state, "READ ONLY");
  assert.ok(surface.works.length >= 3, "a READ ONLY surface must say what it actually does");
  assert.ok(SHELL.includes('href: "/agents/workspace/procurement"'), "the Pro rail does not list the route");
  assert.match(CATALOG, /"nav\.procurement": "Agents & payments"/);
  assert.match(CATALOG, /"nav\.procurement": "Агенти й платежі"/);
  const uk = workspaceSurface("procurement", "uk");
  assert.equal(uk.heading, "Агенти й платежі");
  assert.ok(uk.works.length >= 3);
  assert.ok(uk.blocker.length > 40);
});

test("its heading is unique across the workspace and matches the page", () => {
  const headings = WORKSPACE_SURFACES.map((surface) => surface.heading);
  assert.equal(new Set(headings).size, headings.length);
  assert.ok(PAGE.includes("<h1>Agents and payments</h1>"));
});

test("the blocker names the missing things rather than a date", () => {
  const surface = workspaceSurface("procurement");
  for (const expected of [/no facilitator credential/i, /AGH-1/, /price/i, /mandate/i]) {
    assert.match(surface.blocker, expected);
  }
  assert.equal(/soon|coming|planned for/i.test(surface.blocker), false, "the blocker promises a date");
});

test("every panel carrying a disclosure can scroll, so nothing expands out of reach", () => {
  /* The same gate the commerce surface proved by looking: a panel body is
     `overflow-y: hidden` unless `scroll` is set, so an opened `<Explain>` was
     clipped and the end of the explanation was simply gone. */
  const panels = PAGE.split("<Panel").slice(1);
  assert.ok(panels.length >= 6, "panels disappeared from the page");
  for (const panel of panels) {
    const id = /id="([^"]+)"/.exec(panel)?.[1] ?? "unknown";
    if (!panel.includes("<Explain")) continue;
    assert.ok(panel.includes("scroll"), `${id} holds a disclosure and cannot scroll`);
  }
});

test("the surface reads the live registry, which is empty with nothing configured", () => {
  const surface = buildProcurementSurface({ env: {}, origin: null, nowMs: NOW_MS });
  assert.equal(surface.registry.services.length, 0);
  assert.equal(surface.sale.sellable, false);
  assert.ok(surface.sale.blockers.length > 0);
  // And the environment names the page prints are the owner's four, none of
  // them a credential.
  assert.equal(surface.sale.envNames.length, 4);
  assert.equal(surface.sale.envNames.some((name) => /KEY|SECRET|TOKEN/.test(name)), false);
});

test("once the owner's values are set the one service shows, still not sellable", () => {
  const surface = buildProcurementSurface({
    env: fixtureSellerEnv(),
    origin: "https://ryntra.io",
    nowMs: NOW_MS,
  });
  assert.equal(surface.registry.services.length, 1);
  const [entry] = surface.registry.services;
  assert.equal(entry.provider, "Ryntra");
  assert.equal(entry.assetSymbol, "USDC");
  assert.equal(entry.priceBaseUnits, "50000");
  assert.equal(surface.sale.sellable, false);
});

test("the mandate table is six rows, two of which let an agent act alone", () => {
  const rows = mandateRows(NOW_MS);
  assert.equal(rows.length, 6);
  const alone = rows.filter((row) => row.authorization === "AGENT_ALONE");
  assert.deepEqual(
    alone.map((row) => row.kind),
    ["SQUADS_SMART_ACCOUNT_SPENDING_LIMIT", "SUBSCRIPTIONS_MERCHANT_PLAN"],
  );
  // Each row that does not says which fact the program is missing.
  for (const row of rows.filter((entry) => entry.authorization !== "AGENT_ALONE")) {
    assert.ok(row.reasonCode, `${row.kind} refuses without a reason`);
    assert.ok(row.detail && row.detail.length > 20, `${row.kind} refuses without an explanation`);
  }
  // And the two facts are reported from the read's own shape rather than from a
  // table beside it: a kind with no `destinations` field cannot claim one.
  const v4 = rows.find((row) => row.kind === "SQUADS_V4_SPENDING_LIMIT");
  assert.equal(v4.holdsRecipient, true);
  assert.equal(v4.holdsExpiry, false);
  const fixed = rows.find((row) => row.kind === "SUBSCRIPTIONS_FIXED_DELEGATION");
  assert.equal(fixed.holdsRecipient, false);
  assert.equal(fixed.holdsExpiry, true);
});

test("the page states the two verdicts differently, in both themes", () => {
  // An agent acting alone and a person confirming are different answers, so
  // they are different tones. A shared colour would erase the distinction the
  // gate exists to make — the same rule the commerce surface keeps for provider
  // refusals against policy refusals.
  assert.match(CSS, /\[data-who="AGENT_ALONE"\]/);
  assert.match(CSS, /\[data-who="HUMAN_CONFIRMATION"\]/);
  assert.match(CSS, /\[data-who="HUMAN_SIGNATURE"\]/);
  // Tokens only: no colour literal may appear in this module.
  assert.equal(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(CSS), false, "a colour literal is in the module");
});

test("USDC base units are printed as an amount a person reads", () => {
  assert.equal(usdc("1000000"), "1");
  assert.equal(usdc("500000"), "0.5");
  assert.equal(usdc("50000"), "0.05");
  assert.equal(usdc("10000000"), "10");
  assert.equal(usdc("1"), "0.000001");
  assert.equal(usdc("0"), "0");
});

test("no internal task id or planning reference reaches the page body", () => {
  // AGENT_CONTROL is an operator surface, and the registry's own rule still
  // holds: a reader sees what is true of the product, not how it was planned.
  // `AGH-1` is the one exception and it is deliberate — it is the name of the
  // missing deliverable, and naming it is how the blocker stays checkable.
  const body = PAGE.split("const COPY")[1] ?? "";
  for (const id of ["SOL-5", "AGT-1", "G0 ", "G4 "]) {
    assert.equal(body.includes(id), false, id);
  }
});
