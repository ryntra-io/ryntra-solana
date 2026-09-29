// Run from repo root:
// node --test app/agents/workspace/adoption/adoption-surface.test.mjs
//
// What the external-adoption surface is allowed to be. Two of these checks
// exist because of defects `013` found by looking rather than by measuring: a
// disclosure clipped by a fixed-height panel, and a CSS custom property that
// does not exist and therefore silently drops every declaration beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildAdoptionSurface } from "../../../../lib/agent-control/adoption-current.ts";
import { admitHostedToolCall } from "../../../../lib/agent-control/mcp/hosted.ts";
import { AGENT_CONTROL_SCOPES } from "../../../../lib/agent-control/tenancy.ts";
import { WORKSPACE_SURFACES, workspaceSurface } from "../surfaces.ts";

/*
 * Line endings normalized, for the reason `agent-control-surface.test.mjs`
 * records: these read the working tree, and `core.autocrlf` rewrites it on
 * checkout. A check whose answer depends on how a file arrived on disk is not
 * checking the file.
 */
const src = (path) => readFileSync(path, "utf8").split("\r\n").join("\n");

const PAGE = src("app/agents/workspace/adoption/page.tsx");
const CSS = src("app/agents/workspace/adoption/adoption.module.css");
const CONNECT = src("app/agents/connect/page.tsx");
const CONNECT_CSS = src("app/agents/connect/connect.module.css");
/*
 * The two files that actually declare the workspace token layer. Both, not one:
 * the first draft read only the bridge and reported five real tokens as
 * missing, because sizes and the mono family are declared in globals. A gate
 * that names the wrong source is a gate somebody switches off.
 */
const BRIDGE = [src("app/shell/rt-bridge.css"), src("app/globals.css")].join("\n");
const SHELL = src("app/agents/workspace/agent-manifest.ts");

test("the surface is in the manifest, in the Pro rail, and states a blocker", () => {
  const surface = workspaceSurface("adoption");
  assert.equal(surface.href, "/agents/workspace/adoption");
  assert.equal(surface.state, "READ ONLY");
  assert.ok(surface.works.length >= 2);
  assert.ok(surface.blocker && surface.blocker.length > 40);
  assert.ok(
    /no self-service|deliberate act|per warm instance/i.test(surface.blocker),
    "the blocker must name the exact missing thing rather than a date",
  );
  assert.ok(SHELL.includes('href: "/agents/workspace/adoption"'), "the Pro rail does not list it");
});

test("its heading is unique across the workspace", () => {
  const headings = WORKSPACE_SURFACES.map((surface) => surface.heading);
  assert.equal(new Set(headings).size, headings.length);
  assert.ok(PAGE.includes("<h1>External adoption</h1>"));
});

test("every panel carrying a disclosure can scroll, so nothing expands out of reach", () => {
  /*
   * A panel body is `overflow-y: hidden` unless `scroll` is set, and `scroll`
   * is also what gives the region a keyboard tab stop. `012` shipped a clipped
   * explanation that every measurement passed.
   */
  const panels = PAGE.split(/<Panel\b/).slice(1);
  assert.ok(panels.length >= 6, `expected at least six panels, found ${panels.length}`);
  let withDisclosure = 0;
  for (const panel of panels) {
    const body = panel.split("</Panel>")[0];
    if (!body.includes("<Explain")) continue;
    withDisclosure += 1;
    assert.ok(body.includes("scroll"), "a panel holding a disclosure must be able to scroll");
  }
  assert.ok(withDisclosure >= 5, `expected at least five explanations, found ${withDisclosure}`);
});

test("every CSS custom property these two surfaces use is one the bridge declares", () => {
  /*
   * The gate `013` earned. An undefined custom property is not an error a
   * browser reports — the declaration is dropped and everything around it
   * silently changes. `--warn` cost ten declarations there, and nothing on the
   * rendered page said so.
   */
  const declared = new Set([...BRIDGE.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
  /* Locally scoped variables a surface may define for itself. */
  for (const css of [CSS, CONNECT_CSS]) {
    for (const own of [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)]) declared.add(own[1]);
  }
  const used = new Set(
    [...CSS.matchAll(/var\((--[a-z0-9-]+)/g), ...CONNECT_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map(
      (match) => match[1],
    ),
  );
  const missing = [...used].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(missing, [], `undefined custom properties: ${missing.join(", ")}`);
  assert.ok(used.size >= 10, "the check is only meaningful if the surfaces actually use tokens");
});

test("no verdict on the page is hand-written", () => {
  /*
   * The matrix must come from the gate. A page that restated the answer in its
   * own words would be a second copy that has to be kept true.
   */
  assert.ok(PAGE.includes("buildAdoptionSurface"), "the page must read the projection");
  assert.ok(
    !/\badmitted\b\s*:\s*(true|false)/.test(PAGE),
    "the page must not assert an admission decision of its own",
  );
  const surface = buildAdoptionSurface();
  for (const cell of surface.matrix) {
    const live = admitHostedToolCall(cell.tool, [cell.scope]);
    assert.equal(
      cell.verdict,
      live.admitted ? "ADMITTED" : "SCOPE_NOT_GRANTED",
      `${cell.tool} × ${cell.scope} disagrees with the gate`,
    );
  }
});

test("the matrix covers every hosted tool against every scope", () => {
  const surface = buildAdoptionSurface();
  assert.equal(surface.matrix.length, surface.hostedNames.length * AGENT_CONTROL_SCOPES.length);
  assert.ok(surface.hostedNames.length < surface.localNames.length, "hosted must be a subset");
  assert.equal(
    surface.hostedNames.length + surface.withheld.length,
    surface.localNames.length,
    "every local tool must be either hosted or withheld with a reason",
  );
});

test("the page reports the hosted count against the local total, never as a percentage", () => {
  /*
   * The coverage dashboard's rule, applied again: a percentage reads as a
   * measurement and hides the denominator that makes it mean anything.
   */
  assert.ok(!/%\s*(hosted|coverage|of tools)/i.test(PAGE));
  assert.ok(PAGE.includes("surface.hostedNames.length} of ${surface.localNames.length"));
});

test("the quota panel states the durable number, not the process-local one", () => {
  const surface = buildAdoptionSurface();
  const anonymous = surface.quotas.find((row) => row.principal === "Anonymous");
  const tenant = surface.quotas.find((row) => row.principal === "Identified tenant");
  assert.ok(anonymous.durable && tenant.durable);
  assert.ok(tenant.limit > anonymous.limit, "identity has to be worth something");
  assert.equal(anonymous.limit, 12, "the anonymous allowance must match the edge firewall rule");
});

/* ── the approval screen ───────────────────────────────────────────────── */

test("the approval screen refuses an unregistered client before rendering a form", () => {
  /*
   * A consent screen that renders before checking the client is a phishing
   * surface: the attacker supplies the name, the redirect and the scope text,
   * and Ryntra's chrome makes it look official.
   */
  const clientCheck = CONNECT.indexOf("readClient");
  const formStart = CONNECT.indexOf("<form");
  assert.ok(clientCheck > -1 && formStart > -1);
  assert.ok(clientCheck < formStart, "the client must be resolved before any form is rendered");
  assert.ok(CONNECT.includes("client.redirectUris.includes(redirectUri)"));
  assert.ok(
    CONNECT.includes('codeChallengeMethod !== "S256"'),
    "a request without an S256 challenge must be refused rather than approved",
  );
});

test("the approval screen never redirects on a refusal", () => {
  /* Bouncing a browser to an address Ryntra has not vouched for is how an open
     redirector is built, so the two client-shaped failures answer here. */
  assert.ok(!/redirect\(/.test(CONNECT), "the page must not redirect");
  assert.ok(CONNECT.includes("Nothing was approved"), "a refusal must say nothing happened");
});

test("the approval screen states what the connection still cannot do", () => {
  for (const phrase of ["sign anything", "authorize, approve or grant a mandate", "move funds"]) {
    assert.ok(CONNECT.includes(phrase), `the screen must state it cannot ${phrase}`);
  }
  assert.ok(
    CONNECT.includes('type="password"'),
    "the key field must not echo the credential on screen",
  );
  assert.ok(CONNECT.includes('autoComplete="off"'));
});

test("the approval screen's one primary control uses the accessible accent", () => {
  /*
   * A contrast measurement, pinned. White on `--accent` is 3.33:1 — below AA
   * for 14px text — and it shipped on the single button this whole screen
   * exists to present. Looking at it did not reveal that; sweeping it did. The
   * assertion is on the token rather than on a colour so it survives a palette
   * change, and `--accent` remains correct as the hover.
   */
  const approve = CONNECT_CSS.split(".approve {")[1].split("}")[0];
  assert.match(approve, /background:\s*var\(--accent-strong\)/);
  assert.ok(
    !/background:\s*var\(--accent\)\s*;/.test(approve),
    "the primary control is back on the accent that measures 3.33:1",
  );
});

test("every panel on the adoption surface declares a grid height", () => {
  /*
   * Also a defect only looking found. A `Panel` takes its height from the grid,
   * so every panel without an `h` collapsed to a single clipped line of text
   * and the whole page rendered as seven slivers. Every measurement passed.
   */
  const panels = PAGE.split(/<Panel\b/).slice(1);
  for (const panel of panels) {
    const head = panel.split(">")[0];
    assert.match(head, /h=\{[2468]\}/, `a panel declares no height: ${head.slice(0, 60)}`);
  }
});

test("neither surface prints its explanation on the page", () => {
  /*
   * Journal rule 6. An explanation lives behind an icon; a workspace that reads
   * as documentation with controls attached is a failed workspace.
   */
  for (const [name, source] of [["adoption", PAGE], ["connect", CONNECT]]) {
    const disclosures = (source.match(/<Explain\b/g) ?? []).length;
    assert.ok(disclosures >= 1, `${name} must carry at least one disclosure`);
    const paragraphs = (source.match(/<p\b/g) ?? []).length;
    assert.ok(
      paragraphs <= disclosures + 4,
      `${name} prints ${paragraphs} paragraphs against ${disclosures} disclosures — that is a wall`,
    );
  }
});
