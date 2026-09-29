// Run from repo root:
// node --test --test-isolation=none app/agents/adapter-projection-surface.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const integrations = read("./workspace/integrations/page.tsx");
const workspaceCss = read("./workspace/agent-workspace.css");
const summary = read("./components/adapter-projection-summary.tsx");
const summaryCss = read("./components/adapter-projection-summary.module.css");
const current = read("../../lib/agent-control/adapter-projection-current.ts");

test("Integrations is the canonical projection map, not the old registry placeholder", () => {
  assert.match(integrations, /CURRENT_ADAPTER_PROJECTIONS\.map/);
  assert.match(integrations, /One identity, two responsibilities/);
  assert.match(integrations, /four separate facts/i);
  assert.doesNotMatch(integrations, /WorkspaceSurfacePage/);
  assert.doesNotMatch(integrations, /publicCapabilityRow/);
  assert.doesNotMatch(integrations, /fetch\(|onClick=|<button|<form/);
});

test("all ecosystem surfaces consume the same current projection module", () => {
  /* A hub that declares its own adapter asserts its page beside it. */
  const solana = read("../solana/workspace/receipts/page.tsx");
  const stellar = read("../stellar/workspace/receipts/page.tsx");

  assert.match(stellar, /STELLAR_ADAPTER_PROJECTION/);
  /* Solana's customer Receipts page no longer carries the projection. It is an
     integration-architecture panel — action digest, policy version, maturity
     preview, eligibility — and it sat above the receipt a person opened the
     page to read. The projection still exists and is still shared; it belongs
     on an operator surface, not on the page where somebody checks whether
     their own transfer arrived. */
  assert.doesNotMatch(solana, /SOLANA_ADAPTER_PROJECTION|AdapterProjectionSummary/);
  for (const source of [stellar]) {
    assert.match(source, /AdapterProjectionSummary/);
    assert.doesNotMatch(source, /^\s+compact\s*$/m);
    assert.match(source, /h=\{8\}/);
  }
});

test("projection status is stated with text and an authored icon", () => {
  assert.match(summary, /<StatusMark status=\{projection\.status\}/);
  assert.match(summary, /<b>\{projection\.status\}<\/b>/);
  assert.match(summary, /CheckMark/);
  assert.match(summary, /AttentionMark/);
  assert.match(summary, /CrossMark/);
  assert.doesNotMatch(summary, /✓|⚠|✕|✗/);
});

test("identity, four axes, responsibilities, limitations and next gate remain visible", () => {
  for (const token of [
    "actionId",
    "actionDigest",
    "policyVersion",
    "receipt",
    "agentControl.responsibilities",
    "ecosystem.responsibilities",
    "providerCapability",
    "ryntraMaturity",
    "routeCapability",
    "userEligibility",
    "projection.limitations",
    "projection.nextGate",
  ]) {
    assert.match(summary, new RegExp(token.replace(".", "\\.")), token);
  }
  assert.doesNotMatch(summary, /!compact|compact \?/);
  assert.match(summary, /limitationLines\.map/);
});

test("the shared renderer wraps identifiers and keeps its one control at least 44px", () => {
  assert.match(summaryCss, /overflow-wrap:\s*anywhere/);
  assert.match(summaryCss, /min-height:\s*44px/);
  assert.match(summaryCss, /@media \(max-width:\s*760px\)/);
  assert.match(summaryCss, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(summaryCss, /white-space:\s*nowrap/);
  assert.doesNotMatch(summaryCss, /var\(--fs-(?:12|13)\)/);
  assert.doesNotMatch(
    workspaceCss,
    /\.acw-projection-contract span\s*\{[^}]*var\(--fs-(?:12|13)\)/s,
  );
});

test("current projections are pure constants and create no external state", () => {
  assert.match(current, /projectAdapterAction\(/);
  assert.match(current, /CURRENT_ADAPTER_PROJECTIONS/);
  assert.doesNotMatch(current, /\bfetch\(|localStorage|sessionStorage|Math\.random|new Date\(/);
  assert.doesNotMatch(current, /sendTransaction|writeContract|walletSignature|submitTransaction/);
});

test("ownership headings render only their matching responsibility list", () => {
  assert.match(
    summary,
    /const agentResponsibilities = copy\.agentResponsibilities \?\? projection\.agentControl\.responsibilities;/,
  );
  assert.match(
    summary,
    /const ecosystemResponsibilities = copy\.ecosystemResponsibilities \?\? projection\.ecosystem\.responsibilities;/,
  );

  const agentHeadingAt = summary.indexOf("<h3>{copy.agentControlOwns}</h3>");
  const ecosystemHeadingAt = summary.indexOf("<h3>{copy.ecosystemOwns}</h3>");
  const axesAt = summary.indexOf("<h3>{copy.axes}</h3>");
  assert.ok(agentHeadingAt >= 0 && ecosystemHeadingAt > agentHeadingAt && axesAt > ecosystemHeadingAt);

  const agentSection = summary.slice(agentHeadingAt, ecosystemHeadingAt);
  const ecosystemSection = summary.slice(ecosystemHeadingAt, axesAt);
  assert.match(agentSection, /agentResponsibilities\.map/);
  assert.doesNotMatch(agentSection, /ecosystemResponsibilities\.map/);
  assert.match(ecosystemSection, /ecosystemResponsibilities\.map/);
  assert.doesNotMatch(ecosystemSection, /agentResponsibilities\.map/);
});
