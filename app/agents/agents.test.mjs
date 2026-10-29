import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const layout = read("./layout.tsx");
const frame = read("./agents-frame.tsx");
const nav = read("./agent-subnav.tsx");
const landing = read("./page.tsx");
const landingStatus = read("./landing-status.tsx");
const apiClient = read("./agent-control-client.ts");
const workspacePage = read("./workspace/page.tsx");
const goldenWorkspace = read("./workspace/golden-rwa-workspace.tsx");
const goldenDemo = read("../../lib/agent-control/golden-rwa-demo.ts");
const workspaceLayout = read("./workspace/layout.tsx");
const workspaceShell = read("./workspace/agent-control-shell.tsx");
const workspaceCss = read("./workspace/agent-workspace.css");
const labPage = read("./workspace/lab/page.tsx");
const workbench = read("./workspace/workbench.tsx");
const passportPage = read("./passport/page.tsx");
const passportExplorer = read("./passport/passport-explorer.tsx");
const passportDocument = read("./passport/passport-document.tsx");
const passportRails = read("./passport/passport-rails.tsx");
const capabilityValidation = read("./passport/capability-validation.tsx");
const workspaceRadar = read("./workspace/agents/agent-radar.tsx");
const passportDirectoryStore = read("./workspace/passport-directory-store.tsx");
const verifyPage = read("./verify/page.tsx");
const verifier = read("./verify/verifier.tsx");
const css = read("./agents.css");
const uiSource = [
  layout,
  frame,
  nav,
  landing,
  landingStatus,
  workspacePage,
  goldenWorkspace,
  goldenDemo,
  workspaceLayout,
  workspaceShell,
  labPage,
  workbench,
  passportPage,
  passportExplorer,
  passportDocument,
  passportRails,
  capabilityValidation,
  workspaceRadar,
  passportDirectoryStore,
  verifyPage,
  verifier,
].join("\n");
const passportSource = [passportPage, passportExplorer, passportDocument, passportRails, capabilityValidation].join("\n");

test("public Agent Control routes keep site chrome while workspace routes own RyntraAppShell", () => {
  for (const path of ["./page.tsx", "./workspace/page.tsx", "./workspace/lab/page.tsx", "./passport/page.tsx", "./verify/page.tsx"]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), true, `${path} must exist`);
  }

  assert.match(layout, /AgentsFrame/);
  /* Migrated onto the frozen chrome. The guarantee is the same one: public
     Agent Control routes keep website chrome, workspace routes do not. */
  assert.match(frame, /PublicHeader/);
  assert.match(frame, /FrozenFooter/);
  assert.match(frame, /AgentSubnav/);
  assert.match(frame, /pathname === "\/agents\/workspace"/);
  assert.match(frame, /pathname\.startsWith\("\/agents\/workspace\/"\)/);
  assert.match(workspaceLayout, /AgentControlShell/);
  assert.match(workspaceShell, /RyntraAppShell/);
  assert.match(workspaceShell, /workspaceId="agent-control"/);
  assert.doesNotMatch(workspaceShell, /SiteHeader|SiteFooter|PublicHeader|FrozenFooter|AgentSubnav/);

  const marker = frame.indexOf('data-design-comment="c4ecdba5"');
  const chrome = frame.indexOf("<PublicHeader");
  assert.ok(marker >= 0 && marker < chrome, "the emitted seed marker must be the first layout child");
  assert.match(frame, /dangerouslySetInnerHTML=\{\{ __html: "<!-- design-seed:c4ecdba5 -->" \}\}/);

  for (const href of ["/agents", "/agents/workspace", "/agents/passport", "/agents/verify"]) {
    assert.match(nav, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`));
  }
  assert.equal((nav.match(/href: "\/agents/g) ?? []).length, 4);
  assert.match(nav, /PUBLIC READ · AGENTVERSE/);
  assert.match(nav, /ACTION PASSPORT · PREVIEW/);
});

test("metadata and capability maturity stay aligned with public truth", () => {
  assert.match(landing, /path: "\/agents"/);
  assert.doesNotMatch(landing, /robots:\s*\{\s*index:\s*false/);
  assert.match(workspaceLayout, /robots:\s*\{ index: false, follow: false \}/);
  assert.match(passportPage, /path: "\/agents\/passport"/);
  assert.match(passportPage, /robots:\s*\{ index: false, follow: false \}/);
  assert.match(verifyPage, /robots:\s*\{ index: false, follow: false \}/);

  for (const id of [
    "agent-control-intent",
    "agent-control-preflight",
    "agent-decision-passport-preview",
    "agentverse-public-passport",
    "agent-launch-public-read",
    "bnb-apex-read-observer",
  ]) {
    assert.match(landing, new RegExp(`publicCapabilityRow\\("${id}"\\)`));
  }
  assert.equal((landing.match(/publicCapabilityRow\(/g) ?? []).length, 6);

  for (const route of [landing, passportPage, verifyPage]) {
    assert.match(route, /<main id="main"/);
    assert.match(route, /tabIndex=\{-1\}/);
  }
  assert.doesNotMatch(labPage, /<main\b/);
  assert.match(labPage, /<div className="ag ag-workspace ag-workspace--lab">/);
  assert.match(workspacePage, /<GoldenRwaWorkspace/);
  assert.match(workspacePage, /export const dynamic = "force-dynamic"/);
});

test("Mission Control and its Guided and Pro rails expose only implemented, truth-bounded destinations", () => {
  for (const label of [
    "Authorization request",
    "Deterministic decision",
    "External wallet",
    "Expected Receipt · not created",
    "One Action Case through eight stages",
    "Evidence used by this decision",
    "What remains unavailable",
  ]) {
    assert.match(goldenWorkspace, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(goldenDemo, /INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE/);
  assert.match(goldenDemo, /No wallet signature,\s*transaction or outcome is ever constructed/);
  assert.match(goldenWorkspace, /prefs\.mode === "pro"/);
  assert.match(goldenWorkspace, /<ProActionCase actionCase=\{selectedDemo\}/);
  assert.match(goldenWorkspace, /<SimpleActionCase actionCase=\{selectedDemo\}/);
  assert.doesNotMatch(workspacePage, /publicCapabilityRow|createMemoryGuardStore/);
  assert.match(workspaceShell, /agentManifest/);
  assert.match(workspaceShell, /navigationFromManifest/);
  /* The depth switch is the shell's one control, and since 2026-08-24 it is
     rendered in exactly one place: the layout menu at the foot of the rail.
     This asserted a second mount in Agent Control's own navigation footer —
     correct while the shell's control sat in the top bar, and a duplicate the
     moment it moved down beside it. Agent Control's was `.acw-mode` at 28px
     reading **Guided**, another hub's 30px, the shell's 36px: one preference, three
     heights, two words, and this file is where that stopped. */
  assert.match(workspaceShell, /<DepthSwitch/,
    "Agent Control mounts the shared DepthSwitch, not a local copy");
  assert.doesNotMatch(workspaceShell, /Guided|acw-mode/, "the user-facing word is Simple, and the local control is gone");
  assert.doesNotMatch(workspaceCss, /\.acw-mode/);
  /*
   * Every sidebar destination except the docs link renders inside the shell.
   * The previous hrefs pointed at the public passport/verify pages, which
   * ejected the operator into website chrome mid-task — the founder reproduced
   * it live. The docs entry is the one allowed outbound link and must say so.
   */
  const manifest = read("./workspace/agent-manifest.ts");
  for (const href of [
    "/agents/workspace",
    "/agents/workspace/passport",
    "/agents/workspace/lab",
    "/agents/workspace/verify",
    "/agents/workspace/agents",
    "/agents/workspace/actions",
  ]) {
    assert.match(manifest, new RegExp(href.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(manifest, /href: "\/agents\/passport"|href: "\/agents\/verify"/);
  assert.match(workspaceShell, /API & MCP/);
  assert.doesNotMatch(manifest, /href:\s*null/);
  assert.match(workspaceCss, /@media \(max-width: 900px\)/);
  assert.match(workspaceCss, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(workspaceCss, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|(?:linear|radial|conic)-gradient\(/i);
});

test("the product client is the published SDK, same-origin, and hand-rolls nothing", () => {
  /*
   * Rewritten for Release B. The four endpoint literals used to live here
   * because the product hand-rolled its own `fetch` calls; they now live in
   * the SDK, and asserting them here would only test that a client module
   * repeats strings the SDK already owns. What matters is that there is one
   * client, that it is the published one, and that it cannot reach another
   * origin.
   */
  assert.match(apiClient, /RyntraAgentControlClient/);
  assert.match(apiClient, /baseUrl: window\.location\.origin/);
  assert.ok(!/\bfetch\(/.test(apiClient), "the product client hand-rolls fetch again");
  assert.match(apiClient, /signal/);
  assert.match(apiClient, /Promise<AgentPassport>/);
  assert.match(apiClient, /AgentApiError/);
  assert.doesNotMatch(apiClient, /authorization|bearer|credentials:|localStorage/i);
  assert.doesNotMatch(apiClient, /https?:\/\//);
});

test("the Agent Passport inspector is exact-address, request-driven and evidence bounded", () => {
  assert.match(passportExplorer, /Inspect the agent, not a score\./);
  assert.match(passportExplorer, /agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9/);
  assert.match(passportExplorer, /loadAgentPassport\(exactAddress, controller\.signal\)/);
  assert.match(passportExplorer, /requestRef\.current\?\.abort\(\)/);
  assert.match(passportExplorer, /maxLength=\{65\}/);
  assert.match(passportExplorer, /provider-global; there is no network selector/i);
  assert.doesNotMatch(passportExplorer, /useEffect\([\s\S]{0,180}loadAgentPassport/);
  assert.doesNotMatch(passportSource, /\b(?:Mainnet|Testnet)\b/);

  for (const state of [
    "Reading public sources",
    "Address not accepted",
    "Public read unavailable",
    "No Agent Passport loaded",
    "PARTIAL PUBLIC EVIDENCE",
  ]) {
    assert.match(`${passportExplorer}\n${passportDocument}`, new RegExp(state));
  }

  assert.match(passportDocument, /passport\.providerClaims\.filter/);
  /* The table renders from the artifact's own observations, deduplicated for
     humans only — the JSON keeps every row so its hash is untouched. */
  assert.match(passportDocument, /passport\.ryntraObservations\s*\n?\s*\.filter/);
  assert.match(passportDocument, /\.slice\(0, MAX_VISIBLE_OBSERVATIONS\)/);
  assert.match(passportDocument, /passport\.sources\.some/);
  assert.match(passportDocument, /passport\.limitations\.map/);
  assert.match(passportDocument, /passport\.integrity\.hash/);
  assert.match(passportDocument, /<AgentCapabilityValidation passport=\{passport\} \/>/);
  assert.match(passportDocument, /Declarations are non-clicking text/);
  assert.doesNotMatch(passportDocument, /<a\b|href=/);

  for (const boundary of [
    "Source ledger",
    "Three source families",
    "Provider-declared",
    "Ryntra-observed",
    "Conflicts",
    "Unknowns",
    "No trust, safety, reputation or quality score",
    "NOT_TESTED",
    "No account access, registration, chat or external write",
  ]) {
    assert.match(passportRails, new RegExp(boundary));
  }

  for (const action of ["View raw JSON", "Copy document", "Download JSON"]) {
    assert.match(passportExplorer, new RegExp(action));
  }
  assert.match(passportExplorer, /role="alert"/);
  assert.match(passportExplorer, /role="status"/);
  assert.match(passportExplorer, /aria-busy/);
  assert.match(passportDocument, /aria-live="polite"/);

  assert.doesNotMatch(passportSource, /@gift|Gift Protocol|agentverse\.ai\/v1\/hosting\/submit/i);
});

test("full-depth capability validation compares claims with observations and never promotes the read to proof", () => {
  assert.match(capabilityValidation, /Capability validation/);
  assert.match(capabilityValidation, /Claimed/);
  assert.match(capabilityValidation, /Observed/);
  assert.match(capabilityValidation, /Authority/);
  assert.match(capabilityValidation, /Verification method|Method/);
  assert.match(capabilityValidation, /No current capability is PROVEN/);
  assert.match(capabilityValidation, /invokes no agent and proves no control/);
  assert.match(workspaceRadar, /Per capability\. No combined trust state, rank or recommendation/);
  assert.doesNotMatch(workspaceRadar, /loadAgentPassport|\bfetch\(/);
  assert.match(passportDirectoryStore, /sessionStorage/);
  assert.doesNotMatch(passportDirectoryStore, /localStorage/);
});

test("the workbench exposes the required deterministic sample flow and gates demo acknowledgement", () => {
  assert.match(workbench, /eip155:97/);
  assert.match(workbench, /eip155:56/);
  assert.match(workbench, /Run deterministic preflight/);
  assert.match(workbench, /Record demo decision/);
  assert.match(workbench, /View Action Passport JSON/);
  assert.match(workbench, /Copy Action Passport/);
  assert.match(workbench, /Download Action Passport/);
  assert.match(workbench, /Open verifier/);
  assert.match(workbench, /href="\/agents\/workspace\/verify\?handoff=1"/);
  assert.match(workbench, /window\.sessionStorage\.setItem\(ACTION_PASSPORT_HANDOFF_KEY/);

  assert.match(
    workbench,
    /policyResult\.status === "PASS"[\s\S]*policyResult\.decision === "ALLOWED_BY_POLICY"[\s\S]*authorization\.status === "NOT_RECORDED"/,
  );
  assert.match(workbench, /disabled=\{!canRecord\}/);
  assert.match(workbench, /setDirty\(true\)/);
  assert.match(workbench, /setResult\(null\)/);

  /* "NO WALLET" was retired with the hand-rolled header: the boundary chip now
     states the actual limitation — there is no signer — instead of a wallet
     claim the workbench never checks. */
  for (const boundary of ["SAMPLE", "NOT ONCHAIN", "NO SIGNER", "UNAVAILABLE", "NOT_OBSERVED"]) {
    assert.match(workbench, new RegExp(boundary));
  }
  assert.doesNotMatch(workbench, /NO WALLET/);
  assert.match(workbench, /application\/json/);
  assert.match(workbench, /ryntra-action-passport-preview-\$\{active\.passport\.id\}\.json/);
});

test("the verifier aborts stale work, supports fresh sample and exact local handoff, and hides tampered summaries", () => {
  assert.ok((verifier.match(/\.abort\(\)/g) ?? []).length >= 4);
  assert.match(verifier, /params\.get\("sample"\) === "1"/);
  assert.match(verifier, /params\.get\("handoff"\) === "1"/);
  assert.match(verifier, /sessionStorage\.getItem\(ACTION_PASSPORT_HANDOFF_KEY\)/);
  assert.match(verifier, /sessionStorage\.removeItem\(ACTION_PASSPORT_HANDOFF_KEY\)/);
  assert.match(verifier, /loadAgentDemo\(controller\.signal\)/);
  assert.match(verifier, /verifyArtifact\([^)]*controller\.signal\)/);
  /* Release B: the surface reads the integrity precondition and renders the
     three proof axes beside it, rather than one merged verdict. */
  assert.match(verifier, /\? "INTEGRITY_VALID" : "INVALID"/);
  assert.match(verifier, /setAcceptedPassport\(next\.integrity\.valid \? passport as ActionPassportPreview : null\)/);
  assert.match(verifier, /acceptedPassport && verification\?\.integrity\.valid/);
  assert.match(verifier, /Issuer signature/);
  assert.match(verifier, /Human authorization/);
  assert.match(verifier, /Observed outcome/);
  assert.ok(!/PREVIEW_INTEGRITY_VALID/.test(verifier), "the surface still reads the collapsed v1 verdict");
  assert.match(verifier, /TAMPERED OR UNSUPPORTED/);
  assert.match(verifier, /summary is intentionally hidden/);
  assert.match(verifier, /NOT FINALIZED/);
  assert.match(verifier, /observation\.verdict/);
});

test("Agent Control visuals use semantic tokens and reserve violet for the decision control", () => {
  assert.match(css, /font-family: var\(--rt-font\)/);
  assert.match(css, /font-family: var\(--rt-mono\)/);
  assert.match(css, /var\(--rt-evidence-cyan/);
  assert.match(css, /var\(--rt-review-amber/);
  assert.match(css, /var\(--rt-blocked-red/);
  assert.match(css, /var\(--rt-paper-panel\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/i);

  const violetBaseUses = css.match(/var\(--rt-authorization-violet\)/g) ?? [];
  assert.equal(violetBaseUses.length, 1);
  const decisionRule = css.match(/\.ag-btn--decision\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(decisionRule, /var\(--rt-authorization-violet\)/);
  assert.match(decisionRule, /var\(--rt-authorization-violet-ink\)/);
});

test("visible claims remain preview-bounded across all four routes", () => {
  assert.doesNotMatch(uiSource, /\bVERIFIED\b/);
  assert.doesNotMatch(uiSource, /grant(?:-|\s)?(?:proof|facts|submission|readiness)/i);
  assert.doesNotMatch(uiSource, /\b(?:safe|compliant|legal proof|institutional-grade|official partner)\b/i);
  assert.match(landing, /SAMPLE/);
  assert.match(landing, /NOT ONCHAIN/);
  assert.match(workbench, /SAMPLE/);
  assert.match(workbench, /NOT ONCHAIN/);
  assert.match(nav, /PUBLIC READ · AGENTVERSE/);
  assert.match(passportDocument, /PUBLIC PROVIDER DATA/);
  assert.match(passportRails, /not whether an[\s\S]*agent is trustworthy, reachable or endorsed/);
  assert.match(verifier, /SAMPLE/);
  assert.match(verifier, /NOT ONCHAIN/);
  assert.match(verifier, /INTEGRITY_VALID is not evidence of authorization, execution, settlement or outcome/);
});
