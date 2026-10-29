// Run from repo root: node --test app/developers/agent-control/surface.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BNB_OBSERVER_COMMAND,
  CAPABILITY_MATRIX,
  HTTP_OPERATIONS,
  LOCAL_SOURCE_COMMAND,
  MCP_READ_TOOL_COUNT,
  MCP_TOOLS,
  MCP_WRITE_TOOL_COUNT,
  REFERENCE_STEPS,
} from "./surface.ts";
import { publicCapabilityRow } from "../../site/truth-core.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const layout = read("./layout.tsx");
const page = read("./page.tsx");
const copyButton = read("./copy-button.tsx");
const css = read("./agent-control.css");
const visibleSource = `${page}\n${read("./surface.ts")}`;

test("the developer route uses the existing public shell and keeps its design marker ahead of chrome", () => {
  /* Frozen chrome since the design reset; the marker-before-chrome rule below
     is what this test actually exists for and it is untouched. */
  assert.match(layout, /PublicHeader/);
  assert.match(layout, /FrozenFooter/);
  assert.match(layout, /import "\.\/agent-control\.css"/);

  const marker = layout.indexOf('data-design-comment="b7a0c13e"');
  const chrome = layout.indexOf("<PublicHeader");
  assert.ok(marker >= 0 && marker < chrome, "the design marker must be emitted before public chrome");
  assert.match(layout, /<!-- design-seed:b7a0c13e -->/);
});

test("HTTP inventory is the exact seven-operation source contract", () => {
  assert.deepEqual(
    HTTP_OPERATIONS.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /api/agents/demo",
      "GET /api/agents/passport?address=...",
      "POST /api/agents/preflight",
      "POST /api/agents/verify",
      "GET /api/agents/agent-launch/tokens",
      "GET /api/agents/agent-launch/tokens/{address}",
      "POST /api/agents/bnb-apex/observe",
    ],
  );
  assert.deepEqual(
    new Set(HTTP_OPERATIONS.map(({ operationMode }) => operationMode)),
    new Set(["PREVIEW", "READ ONLY"]),
  );
  assert.ok(HTTP_OPERATIONS.every(({ boundary }) => boundary.length > 0));
});

test("MCP inventory is the exact twelve-tool local stdio contract, split seven read and five write", () => {
  assert.deepEqual(
    MCP_TOOLS.map(({ name }) => name),
    [
      "draft_agent_action_intent",
      "inspect_agentverse_agent",
      "list_agent_launch_testnet_tokens",
      "inspect_agent_launch_testnet_token",
      "run_agent_action_preflight",
      "verify_action_passport_preview",
      "observe_bnb_apex_testnet_job",
      "propose_action",
      "attach_proposal_evidence",
      "request_human_review",
      "retract_proposal",
      "ingest_a2a_task",
    ],
  );
  assert.ok(MCP_TOOLS.every(({ boundary }) => boundary.length > 0));

  /* The counts are separate because the published kit is the seven. Adding
     five to seven and printing twelve would say the public repository grew,
     which it did not — the write tools were never published. */
  assert.equal(MCP_READ_TOOL_COUNT + MCP_WRITE_TOOL_COUNT, MCP_TOOLS.length);
  assert.equal(MCP_READ_TOOL_COUNT, 7);

  /* Every write tool states the one thing it produces, and none of them
     promises anything a write here cannot do. */
  for (const tool of MCP_TOOLS.slice(MCP_READ_TOOL_COUNT)) {
    assert.doesNotMatch(tool.name, /sign_|fund_|submit_|settle_|withdraw_|transfer_|execute/i);
    assert.doesNotMatch(tool.purpose, /authoriz|authoris|approve|mandate|sign/i);
  }
});

test("the quickstart and capability matrix preserve the known-reference and source-only boundaries", () => {
  assert.match(LOCAL_SOURCE_COMMAND, /RYNTRA_BASE_URL=http:\/\/localhost:3000/);
  assert.match(LOCAL_SOURCE_COMMAND, /AGENTVERSE_ADDRESS=<EXACT_AGENTVERSE_ADDRESS>/);
  assert.match(LOCAL_SOURCE_COMMAND, /node examples\/agent-control-builder\/example\.ts/);
  assert.match(BNB_OBSERVER_COMMAND, /"jobId":"<KNOWN_JOB_ID>"/);
  assert.match(BNB_OBSERVER_COMMAND, /"txHash":"<KNOWN_TX_HASH>"/);
  assert.equal(REFERENCE_STEPS.length, 4);
  assert.equal(CAPABILITY_MATRIX.length, 6);
  assert.deepEqual(
    CAPABILITY_MATRIX.map(({ registryId }) => registryId),
    [
      "agentverse-public-passport",
      "agent-control-intent",
      "agent-control-preflight",
      "agent-decision-passport-preview",
      "agent-launch-public-read",
      "bnb-apex-read-observer",
    ],
  );
  assert.match(visibleSource, /chainId 97/);
  assert.match(visibleSource, /Exactly jobId \+ txHash/);
  assert.match(visibleSource, /No finalized Outcome Receipt/);
});

test("public capability states are projected from registry truth instead of authored in the page", () => {
  assert.match(page, /publicCapabilityRow\(row\.registryId\)/);
  assert.match(page, /row\.registry\.stateLabel/);
  assert.match(page, /row\.registry\.limitation/);
  assert.doesNotMatch(read("./surface.ts"), /\bmaturity\s*:/);

  const reviewedAtTaskDate = new Date("2026-08-14T12:00:00.000Z");
  for (const row of CAPABILITY_MATRIX) {
    const projection = publicCapabilityRow(row.registryId, reviewedAtTaskDate);
    assert.equal(projection.stateLabel, "Preview", `${row.registryId} registry state drifted at task date`);
    assert.equal(projection.tone, "evidence", `${row.registryId} registry tone drifted at task date`);
    assert.ok(projection.scope.length > 0);
    assert.ok(projection.limitation.length > 0);
  }

  assert.match(page, /Route availability/);
  assert.match(page, /Provider capability/);
  assert.match(page, /Ryntra maturity/);
  assert.match(page, /User eligibility/);
  assert.match(page, /seven HTTP routes are live on this Ryntra deployment/);
  assert.match(page, /Route availability does not promote provider capability or Ryntra maturity/);
});

test("the page is static until the developer explicitly runs a route or stdio tool", () => {
  assert.doesNotMatch(page, /\bfetch\s*\(|axios|useEffect|useSWR|WebSocket|EventSource/);
  assert.doesNotMatch(copyButton, /\bfetch\s*\(|axios|useEffect|WebSocket|EventSource/);
  assert.match(copyButton, /navigator\.clipboard\.writeText/);
  assert.match(page, /This page itself performs\s+no provider request/);
  for (const state of ["ZERO_STATE", "NOT_FOUND", "stale or unavailable", "UPSTREAM_FAILURE"]) {
    assert.match(page, new RegExp(state.replaceAll("_", "[_]")));
  }
});

test("the public copy avoids unsupported distribution, execution and program claims", () => {
  const forbidden = /\b(?:production-ready|mainnet live|live integration|official partner|open source|Domain [ABC])\b/i;
  assert.doesNotMatch(visibleSource, forbidden);
  assert.doesNotMatch(visibleSource, /\$(?:500|1,000|2,500|5,000)/);
  assert.match(visibleSource, /Published Apache-2\.0 source; not on npm/);
  assert.match(
    visibleSource,
    /No npm package and no remote MCP service; the published repository is a source release, not a hosted endpoint/,
  );
  /* The URL stopped being a literal on 2026-08-19: the Developer Platform needs
     all three public repositories, and three literals is the defect
     `lib/site/contacts.ts` exists to prevent. The page still links that exact
     repository — the assertion follows the value to where it now lives. */
  assert.match(page, /href=\{PUBLIC_REPOSITORIES\.agentControl\}/);
  assert.doesNotMatch(visibleSource, /Private workspace source|separately published developer repository/);
});

test("all four existing Agent Control product surfaces are linked", () => {
  for (const href of ["/agents", "/agents/passport", "/agents/workspace", "/agents/verify"]) {
    assert.match(page, new RegExp(`href="${href.replaceAll("/", "\\/")}"`));
  }
  assert.match(page, /path: "\/developers\/agent-control"/);
  assert.match(page, /<main id="main" tabIndex=\{-1\}>/);
  for (const id of ["quickstart-title", "contracts-title", "capabilities-title", "limits-title"]) {
    assert.match(page, new RegExp(`id="${id}"`));
    assert.match(page, new RegExp(`aria-labelledby="${id}"`));
  }
});

test("the scoped visual layer uses semantic tokens and approved breakpoints only", () => {
  assert.match(css, /var\(--rt-page\)/);
  assert.match(css, /var\(--rt-paper-page\)/);
  assert.match(css, /var\(--rt-evidence-cyan/);
  assert.match(css, /var\(--rt-review-amber/);
  assert.match(css, /font-family: var\(--rt-font\)/);
  assert.match(css, /font-family: var\(--rt-mono\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(css, /box-shadow|backdrop-filter|filter:/i);

  const breakpoints = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((match) => Number(match[1]));
  assert.deepEqual(breakpoints, [1200, 900, 640]);
});

test("rendered source keeps UTF-8 punctuation intact", () => {
  const allSource = [layout, page, copyButton, read("./surface.ts"), css].join("\n");
  assert.doesNotMatch(allSource, /(?:Ã.|Â.|â(?:€|€™|€œ|€|€“|€”|€¦)|�)/u);
  assert.match(page, /Live route · source preview/);
  assert.match(page, /BSC Testnet · 97/);
});
