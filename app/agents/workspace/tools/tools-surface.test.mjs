// Run from repo root:
// node --test --test-isolation=none app/agents/workspace/tools/tools-surface.test.mjs
//
// What the agent-tools surface is allowed to be. The disclosure-scroll check
// exists because looking at the commerce page found what no measurement did: an
// explanation that expanded past a fixed-height panel and was clipped with no
// way to reach the rest of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WORKSPACE_SURFACES, workspaceSurface } from "../surfaces.ts";
import { buildAgentToolsSurface } from "../../../../lib/agent-control/mcp/current.ts";

/*
 * Line endings normalized, for the reason `agent-control-surface.test.mjs`
 * records: these read the working tree, and `core.autocrlf` rewrites it on
 * checkout. A check whose answer depends on how a file arrived on disk is not
 * checking the file.
 */
const src = (path) => readFileSync(path, "utf8").split("\r\n").join("\n");

const PAGE = src("app/agents/workspace/tools/page.tsx");
const CLIENT = src("app/agents/workspace/tools/tool-inventory.tsx");
const SHELL = src("app/agents/workspace/agent-manifest.ts");
const CSS = src("app/agents/workspace/tools/tools.module.css");

test("the surface is in the manifest, in the Pro rail, and states a blocker", () => {
  const surface = workspaceSurface("tools");
  assert.equal(surface.href, "/agents/workspace/tools");
  assert.equal(surface.state, "READ ONLY");
  assert.ok(surface.works.length >= 2, "a READ ONLY surface must say what it actually does");
  assert.ok(surface.blocker && surface.blocker.length > 40, "the blocker must be the exact missing thing");
  assert.ok(
    /server process|durable queue|cannot authorize/i.test(surface.blocker),
    "the blocker must name what is missing rather than a date",
  );
  assert.ok(SHELL.includes('href: "/agents/workspace/tools"'), "the Pro rail does not list the route");
});

test("its heading is unique across the workspace", () => {
  const headings = WORKSPACE_SURFACES.map((surface) => surface.heading);
  assert.equal(new Set(headings).size, headings.length);
  assert.ok(PAGE.includes("<h1>Agent tools</h1>"));
});

test("every panel carrying a disclosure can scroll, so nothing expands out of reach", () => {
  const panels = PAGE.split(/<Panel\b/).slice(1);
  assert.equal(panels.length, 6, "the page is expected to render six panels");
  let withDisclosure = 0;
  for (const panel of panels) {
    const body = panel.split("</Panel>")[0];
    if (!body.includes("<Explain")) continue;
    withDisclosure += 1;
    assert.ok(body.includes("scroll"), "a panel holding a disclosure must be able to scroll");
  }
  assert.equal(withDisclosure, 5, "five panels are expected to carry an explanation");
});

test("no verdict on the page is hand-written", () => {
  /* Every status, count and refusal code comes from the projection, which runs
     the real gate and the real A2A mirror. A literal reason code in the JSX
     would be a second source of truth that drifts on the first engine change. */
  assert.ok(PAGE.includes("buildAgentToolsSurface()"));
  assert.doesNotMatch(PAGE, /OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER|CALLER_SUPPLIED_ENDPOINT/);
  assert.doesNotMatch(PAGE, /PROPOSAL_ONLY/);
  assert.doesNotMatch(CLIENT, /PROPOSAL_ONLY|AGENT_CONTROL_PROPOSAL/);

  /* And the page performs no request of its own: the projection is computed on
     the server because the gate reaches the hash-pinned registry. */
  assert.doesNotMatch(PAGE, /\bfetch\s*\(|useEffect|WebSocket|EventSource/);
  assert.doesNotMatch(CLIENT, /\bfetch\s*\(|useEffect|WebSocket|EventSource/);
});

test("the projection states the same six refusals the gate actually makes", () => {
  const surface = buildAgentToolsSurface();
  assert.equal(surface.probes.length, 6);
  for (const probe of surface.probes) {
    assert.notEqual(probe.reasonCode, "ADMITTED", `${probe.id} was admitted and the page would say so`);
    assert.ok(probe.because.length > 30, `${probe.id} must say why this reason and not another`);
  }

  /* The two orderings the page draws as an ordered list. */
  assert.equal(surface.probes[0].reasonCode, "OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER");
  assert.equal(surface.probes[1].reasonCode, "CALLER_SUPPLIED_ENDPOINT");
  assert.equal(
    surface.probes.find((probe) => probe.id === "unknown-action").reasonCode,
    "REGISTRY_REF_UNKNOWN",
    "the registry answers before the tool allowlist does",
  );
});

test("the inventory separates read from write and keeps one write effect", () => {
  const surface = buildAgentToolsSurface();
  assert.equal(surface.tools.length, 12);
  assert.equal(surface.readCount, 7);
  assert.equal(surface.writeCount, 5);
  assert.deepEqual([...surface.effects], ["PROPOSAL_ONLY"]);
  for (const tool of surface.tools.filter((entry) => entry.kind === "WRITE")) {
    assert.equal(tool.produces, "AGENT_CONTROL_PROPOSAL", `${tool.name} produces something else`);
  }
});

test("the authorization ladder is drawn in full and the top rung is unreachable", () => {
  const surface = buildAgentToolsSurface();
  assert.deepEqual([...surface.authorizationLadder], ["NOT_REQUESTED", "REQUESTED", "GRANTED_BY_OWNER"]);
  assert.deepEqual([...surface.reachableAuthorization], ["NOT_REQUESTED", "REQUESTED"]);
  assert.ok(
    !surface.reachableAuthorization.includes("GRANTED_BY_OWNER"),
    "no input to this surface may reach owner authority",
  );

  /* Drawn rather than omitted: a ladder that stopped at REQUESTED would read as
     a product where nobody ever authorizes anything. */
  assert.ok(PAGE.includes("authorizationLadder"));
  assert.ok(CSS.includes('[data-reachable="false"]'), "the unreachable rung needs its own treatment");
});

test("every A2A state on the page promotes nothing", () => {
  const surface = buildAgentToolsSurface();
  assert.equal(surface.outcomes.length, 9);
  for (const outcome of surface.outcomes) {
    assert.equal(outcome.promotes, "nothing", `${outcome.state} promotes something`);
    assert.notEqual(outcome.ownerAuthorization, "GRANTED_BY_OWNER");
  }
  const completed = surface.outcomes.find((outcome) => outcome.state === "TASK_STATE_COMPLETED");
  assert.equal(completed.class, "TERMINAL");
  assert.equal(completed.ownerAuthorization, "NOT_REQUESTED");
  assert.equal(completed.event, null);
});

test("the two-axis grid moves in one direction only", () => {
  const surface = buildAgentToolsSurface();
  const byState = new Map();
  for (const cell of surface.grid) {
    const seen = byState.get(cell.state) ?? new Set();
    seen.add(cell.authorization);
    byState.set(cell.state, seen);
  }
  /* One value per column, three columns: what the caller proved never changes
     what the owner decided. */
  for (const [state, values] of byState) {
    assert.equal(values.size, 1, `${state} produced more than one authorization across authentication levels`);
  }
  assert.equal([...byState.get("TASK_STATE_AUTH_REQUIRED")][0], "REQUESTED");
  assert.equal([...byState.get("TASK_STATE_SUBMITTED")][0], "NOT_REQUESTED");
});
