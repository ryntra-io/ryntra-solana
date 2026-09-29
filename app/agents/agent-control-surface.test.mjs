// Run from repo root: node --test "app/agents/agent-control-surface.test.mjs"
//
// The regression net for the Agent Control workspace rebuild.
//
// The kernel already has 104 tests. What nothing guarded was the *surface*:
// which routes exist, which of them are public, and whether a page is allowed
// to say something the kernel cannot support. A rebuild that moves every screen
// is exactly the change that breaks those quietly, so they are pinned here
// before the first screen moves.
//
// Each test states the product boundary it protects, because a route list with
// no reason attached is a list somebody will "tidy".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

/*
 * Line endings are normalized because these assertions read the working tree,
 * not the committed blob, and on Windows `core.autocrlf` rewrites it on
 * checkout. The manifest split below looks for `\n  {\n`, which a CRLF working
 * copy does not contain — so the gate went green for the author who wrote the
 * file with LF and red for the next checkout of the identical content. A check
 * whose answer depends on how a file arrived on disk is not checking the file.
 */
const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const has = (relative) => existsSync(new URL(relative, import.meta.url));

/** Every page.tsx under app/agents, as a route path. */
function agentRoutes(dir = ".", prefix = "/agents") {
  const out = [];
  for (const entry of readdirSync(new URL(dir + "/", import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...agentRoutes(`${dir}/${entry.name}`, `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      out.push(prefix);
    }
  }
  return out.sort();
}

test("the public and workspace route families both exist and stay distinct", () => {
  const routes = agentRoutes();
  // Public, shareable, and safe to send to somebody outside the product.
  for (const route of ["/agents", "/agents/passport", "/agents/verify"]) {
    assert.ok(routes.includes(route), `public route ${route} disappeared`);
  }
  // Operator surfaces. A workspace task must be completable without leaving.
  for (const route of ["/agents/workspace", "/agents/workspace/lab", "/agents/workspace/verify"]) {
    assert.ok(routes.includes(route), `workspace route ${route} disappeared`);
  }
});

test("no workspace page sends the operator to a public route without saying so", () => {
  // The shell fixed this for navigation; the page bodies were never checked.
  // A bare <Link href="/agents/passport"> inside the workspace ejects an
  // operator into website chrome mid-task, which is the defect the shell's own
  // comment describes.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir + "/", import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${dir}/${entry.name}`);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      const source = read(`${dir}/${entry.name}`);
      for (const match of source.matchAll(/href="(\/agents\/(?:passport|verify))"/g)) {
        // Allowed only when the link is explicitly marked as leaving.
        const around = source.slice(Math.max(0, match.index - 400), match.index + 400);
        const marked = /Open public version|↗|target="_blank"|public version/i.test(around);
        if (!marked) offenders.push(`${dir}/${entry.name} → ${match[1]}`);
      }
    }
  };
  walk("./workspace");
  assert.deepEqual(
    offenders,
    [],
    "workspace pages link into the public surface without marking it as leaving:\n  " +
      offenders.join("\n  "),
  );
});

test("the verifier reports three proof axes and never merges them", () => {
  const source = read("./verify/verifier.tsx");
  for (const axis of ["Issuer signature", "Human authorization", "Observed outcome"]) {
    assert.ok(source.includes(axis), `the verifier stopped reporting "${axis}"`);
  }
  assert.match(
    source,
    /never merged/i,
    "the verifier no longer states that the axes are reported separately",
  );
  // A single combined verdict is the thing this surface exists to refuse.
  assert.ok(
    !/trust ?score/i.test(source),
    "the verifier introduced a trust score",
  );
});

test("an integrity result never implies authorization, execution or outcome", () => {
  // The vocabulary belongs to the kernel, not to the component that prints it —
  // which is where the first version of this test looked and wrongly failed. A
  // surface can be rewritten; these three words may not quietly disappear from
  // the layer that decides them.
  const kernel =
    read("../../lib/agent-control/verify.ts") +
    read("../../lib/agent-control/core.ts") +
    read("./types.ts");
  assert.ok(kernel.includes("INTEGRITY_VALID"), "the integrity verdict disappeared");
  for (const limit of ["UNSIGNED", "NOT_AUTHORIZED", "NOT_OBSERVED"]) {
    assert.ok(kernel.includes(limit), `the kernel stopped stating ${limit}`);
  }
  // And the surface must still render all three rather than the headline alone.
  const surface = read("./verify/verifier.tsx");
  assert.match(surface, /Issuer signature[\s\S]{0,600}Observed outcome/, "the axes stopped rendering together");
});

test("no Agent Control surface calls a preview a receipt", () => {
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(new URL(dir + "/", import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, out);
      else if (entry.name.endsWith(".tsx")) out.push([`${dir}/${entry.name}`, read(`${dir}/${entry.name}`)]);
    }
    return out;
  };
  for (const [path, source] of walk(".")) {
    // "Outcome Receipt" may be named — as something that does not exist yet.
    const claims = [...source.matchAll(/(?:your|the|this)\s+Outcome Receipt\s+(?:is|shows|proves)/gi)];
    assert.deepEqual(claims.map((m) => m[0]), [], `${path} states a finalized Outcome Receipt`);
  }
});

test("Mission Control keeps synthetic facts separate from external results", () => {
  const page = read("./workspace/page.tsx");
  const workspace = read("./workspace/golden-rwa-workspace.tsx");
  const demo = read("../../lib/agent-control/golden-rwa-demo.ts");

  assert.match(page, /createGoldenRwaDemo/);
  assert.match(demo, /NO FUNDS MOVE/);
  assert.match(workspace, /Expected Receipt · not created/);
  assert.match(workspace, /no signature exists/i);
  assert.match(workspace, /No issuer, venue, wallet, chain or rail is called/);
});

test("the workspace declares observe-only and no execution", () => {
  const shell = read("./workspace/agent-control-shell.tsx");
  assert.match(
    shell,
    /footer\.boundary/,
    "the workspace boundary line changed; enforcement is still not a kernel field",
  );
  const catalog = read("./workspace/i18n/catalog.ts");
  assert.match(catalog, /"footer.boundary": "No execution"/);
  assert.match(catalog, /"footer.boundary": "Без виконання"/);
});

test("the kernel modules the surface depends on are all present", () => {
  // Named individually so a delete is a failing test rather than a 500.
  for (const kernelModule of [
    "contracts.ts", "core.ts", "canonical.ts", "verify.ts", "issuer.ts",
    "authorization.ts", "artifacts.ts", "reconcile.ts", "registry.ts", "redaction.ts",
  ]) {
    assert.ok(has(`../../lib/agent-control/${kernelModule}`), `lib/agent-control/${kernelModule} is gone`);
  }
});

test("the bounded API surface keeps every route the Developer Kit contracts", () => {
  for (const route of [
    "passport", "preflight", "verify", "authorize", "demo", "issuer-key",
    "bnb-apex/observe", "receipt/[jobId]",
  ]) {
    assert.ok(has(`../api/agents/${route}/route.ts`), `/api/agents/${route} disappeared`);
  }
});

test("the Agentverse read stays exact-address and origin-pinned", () => {
  const adapter = read("../../lib/agent-control/adapters/agentverse.ts");
  // The first version of this test banned the word "search" and failed on
  // Agentverse's own endpoint name — `/v1/search/agents/{address}`, which is
  // the exact-address read, not a lookup. The real invariant is the template:
  // one address in, one record out, no caller-supplied query string.
  assert.match(adapter, /\{address\}/, "the exact-address template is gone");
  // Comment-stripping is deliberately NOT done here. The first attempt removed
  // `// …` to end of line and ate the `//` in `https://agentverse.ai`, then
  // reported the pinned origin as missing — a test failing on its own regex.
  assert.ok(
    !/[?&](q|query|search)=/i.test(adapter),
    "the Agentverse adapter gained a caller-supplied query string",
  );
  // The origin is fixed in source, not taken from a caller.
  assert.match(adapter, /https:\/\/[a-z0-9.-]*agentverse/i, "the pinned Agentverse origin is gone");
});

/* ── Phase 2A ─────────────────────────────────────────────────────────────
   The twelve routes, their headings and their scope. Written with the routes
   rather than after them, because "every page has a unique h1" is the kind of
   claim that is true on the day it is made and false two pages later. */

test("all twelve workspace routes exist", () => {
  const routes = agentRoutes();
  for (const leaf of [
    "", "/actions", "/actions/[actionId]", "/reviews", "/agents", "/policies",
    "/evidence", "/integrations", "/settings", "/passport", "/verify", "/authorize",
  ]) {
    const route = `/agents/workspace${leaf}`;
    assert.ok(routes.includes(route), `${route} is missing`);
  }
});

test("every workspace surface has a heading, and no two are the same", () => {
  const source = read("./workspace/surfaces.ts");
  const headings = [...source.matchAll(/heading: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(headings.length >= 7, "surfaces disappeared from the manifest");
  assert.equal(new Set(headings).size, headings.length, `duplicate heading: ${headings.join(", ")}`);
  // And the two hand-written ones do not collide with them.
  assert.ok(!headings.includes("Mission Control"));
  assert.ok(!headings.includes("Action not found"));
});

test("a surface with no working capability names its blocker", () => {
  const source = read("./workspace/surfaces.ts");
  // Every PLANNED entry must carry a blocker: a route that answers with
  // nothing and explains nothing is the "coming soon" this manifest replaces.
  // Split on the object opener rather than on a newline pattern — the first
  // version of this used an escaped newline that survived one layer of quoting
  // too few and became a literal line break inside the regex, so the file did
  // not parse at all.
  const entries = source.split("\n  {\n").slice(1);
  assert.ok(entries.length >= 7, "the manifest entries stopped being splittable");
  for (const entry of entries) {
    if (!entry.includes('state: "PLANNED"')) continue;
    assert.match(entry, /blocker:/, `a PLANNED surface has no blocker: ${entry.slice(0, 120)}`);
  }
});

test("scope is route-aware and the workspace no longer carries a global chain", () => {
  const registry = read("../shell/workspaces.ts");
  const agentEntry = registry.slice(registry.indexOf('name: "Agent Control"'), registry.indexOf('name: "Agent Control"') + 900);
  assert.ok(
    !/environment:\s*"/.test(agentEntry),
    "Agent Control declares a workspace-level environment again; scope belongs to the route",
  );
  const surfaces = read("./workspace/surfaces.ts");
  assert.match(surfaces, /export function scopeForPath/, "scopeForPath is gone");
  // The verifier touches no network, so its answer must stay `null`.
  assert.match(
    surfaces,
    /verify[\s\S]{0,200}return null/,
    "the verifier route gained an environment chip",
  );
});

test("the wallet control is always in the shell account slot", () => {
  const shell = read("./workspace/agent-control-shell.tsx");
  assert.doesNotMatch(shell, /walletBelongsOn/, "the wallet gate must not hide the connection control");
  assert.match(shell, /account=\{/, "the connection control belongs in the account slot");
  assert.match(shell, /RyntraConnectionControl/);
});

test("Simple and Pro carry different destinations", () => {
  const manifest = read("./workspace/agent-manifest.ts");
  assert.match(manifest, /id: "overview"/);
  assert.match(manifest, /id: "radar"/);
  assert.match(manifest, /id: "portfolio"/);
  assert.match(manifest, /entries:/, "Pro children exist on the modules");
  assert.match(manifest, /href: "\/agents\/workspace\/attention"/);
  assert.match(manifest, /href: "\/agents\/workspace\/actions"/);
});

test("the public surfaces state that they are public and point back", () => {
  for (const page of ["./passport/page.tsx", "./verify/page.tsx"]) {
    const source = read(page);
    assert.match(source, /PublicSurfaceRole/, `${page} does not declare its public role`);
    assert.match(source, /workspaceHref="\/agents\/workspace\//, `${page} does not link back into the workspace`);
  }
});

test("the public headline is the canon's, not the superseded one", () => {
  const source = read("./page.tsx");
  assert.match(source, /Verify the intent\./, "/agents lost the v5.2 headline");
  assert.ok(!source.includes("Understand the agent."), "the v5.1 headline is back on /agents");
});

test("the authorize route has a page heading and calls itself an experiment", () => {
  const source = read("./workspace/authorize/page.tsx");
  assert.match(source, /<h1>/, "the authorize page has no h1 again");
  assert.match(source, /NOT PRODUCT AUTHORIZATION/, "the authorize page stopped stating its limit");
});

/* ── Phase 2B ─────────────────────────────────────────────────────────────
   The Action Case is the one object every surface reads. These guard the
   wiring; `lib/agent-control/action-case.test.mjs` guards the projection. */

test("the Action Case store is mounted where it survives navigation", () => {
  const shell = read("./workspace/agent-control-shell.tsx");
  // In the shell, not in a page: the shell does not remount when a child route
  // changes, which is what keeps a selected action across the depth switch.
  assert.match(shell, /<ActionCaseProvider>\{children\}<\/ActionCaseProvider>/);
});

test("Phase 3 renders Simple and Pro as different projections of the same selected case", () => {
  const page = read("./workspace/page.tsx");
  const workspace = read("./workspace/golden-rwa-workspace.tsx");
  const demo = read("../../lib/agent-control/golden-rwa-demo.ts");

  assert.match(page, /createGoldenRwaDemo/);
  assert.match(page, /<GoldenRwaWorkspace/);
  assert.match(workspace, /useShell\(\)/, "the canvas stopped following the shell depth switch");
  assert.match(workspace, /useActionCases\(\)/, "the depth projections stopped sharing the Action Case store");
  assert.match(workspace, /prefs\.mode === "pro"/);
  assert.match(workspace, /<SimpleActionCase/);
  assert.match(workspace, /<ProActionCase/);
  assert.match(demo, /INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE/);
  assert.match(workspace, /<b>\{banner\}<\/b>/);
  assert.match(workspace, /External wallet/);
  assert.doesNotMatch(workspace, /sendTransaction|writeContract|walletSignature|transactionHash\s*:/);
});

test("the Lab hands what it produces to the shared store", () => {
  const workbench = read("./workspace/workbench.tsx");
  assert.match(workbench, /useActionCases/, "the Lab stopped publishing its artifact");
  assert.match(workbench, /remember\(active\.passport\)/, "the Lab publishes something other than the artifact");
});

test("the tab-local scope is stated wherever cases are shown", () => {
  // "Your place is kept" and "the action is recorded" are different promises.
  // Until Phase 2C only the first is true, and every surface that lists cases
  // has to say so rather than let a list imply a ledger.
  for (const page of ["./workspace/actions/page.tsx", "./workspace/actions/[actionId]/page.tsx"]) {
    assert.match(read(page), /TAB LOCAL · NO SERVER RECORD/, `${page} does not state its scope`);
  }
  const views = read("./workspace/action-case-views.tsx");
  assert.match(views, /nothing here reached a server/i);
});

test("the store is tab-local by construction, not by promise", () => {
  const store = read("./workspace/action-case-store.tsx");
  assert.match(store, /sessionStorage/, "the store changed where it keeps cases");
  assert.ok(!/localStorage/.test(store), "localStorage outlives the tab and would make the scope claim false");
  assert.ok(!/fetch\(/.test(store), "the store started talking to a server");
});

test("no surface renders a stage the artifact cannot support", () => {
  const views = read("./workspace/action-case-views.tsx");
  // The views print whatever the projection gives them; the projection is what
  // refuses to invent execution. A view that hard-codes a stage state would
  // route around that, so none may.
  assert.ok(!/state:\s*"done"/.test(views), "a view hard-codes a stage state");
  assert.ok(!/OUTCOME_OBSERVED|RECEIPT_FINAL/.test(views), "a view invented an outcome vocabulary");
});

/* ── RYN-AGENT-CONTROL-009 ────────────────────────────────────────────────
   Radar is a projection of canonical Passports, never discovery or a second
   actor model. Passport capability states keep claim and observation apart. */

test("the Passport directory is mounted across workspace navigation and is tab-local by construction", () => {
  const shell = read("./workspace/agent-control-shell.tsx");
  const store = read("./workspace/passport-directory-store.tsx");
  const projection = read("../../lib/agent-control/passport-directory.ts");
  const integrity = read("../../lib/agent-control/agent-passport-browser.ts");

  assert.match(shell, /<PassportDirectoryProvider>/);
  assert.match(shell, /<ActionCaseProvider>\{children\}<\/ActionCaseProvider>/);
  assert.match(store, /sessionStorage/);
  assert.doesNotMatch(store, /localStorage/);
  assert.doesNotMatch(store, /\bfetch\(/);
  assert.match(projection, /verifyBrowserAgentPassport/);
  assert.match(integrity, /isSdkAgentPassport/);
  assert.match(integrity, /crypto\?\.subtle/);
  assert.match(integrity, /canonicalJson/);
  assert.match(projection, /AGENT_PASSPORT_DIRECTORY_LIMIT = 12/);
});

test("Radar is an evidence ledger over inspected Passports, not an agent discovery surface", () => {
  const page = read("./workspace/agents/page.tsx");
  const radar = read("./workspace/agents/agent-radar.tsx");
  const surface = read("./workspace/surfaces.ts");

  assert.match(page, /<AgentRadar \/>/);
  assert.doesNotMatch(page, /WorkspaceSurfacePage/);
  assert.match(radar, /<h1>Agent Radar<\/h1>/);
  assert.match(radar, /THIS TAB/);
  assert.match(radar, /No server record exists/);
  assert.match(radar, /Conflicts present/);
  assert.match(radar, /Unknowns present/);
  assert.match(radar, /Source gaps/);
  assert.match(radar, /All sources available/);
  assert.match(radar, /\/agents\/workspace\/passport\?address=/);
  assert.doesNotMatch(radar, /loadAgentPassport|\bfetch\(|localStorage/);
  assert.match(surface, /heading: "Agent Radar"/);
  assert.doesNotMatch(
    surface.match(/id: "agents"[\s\S]*?\n  \},/)?.[0] ?? "",
    /agentverse-discovery/,
    "a tab-local directory must not advertise the unbuilt discovery capability",
  );
  assert.match(read("./workspace/i18n/catalog.ts"), /"nav.radar": "Agents"/);
  assert.match(read("./workspace/agent-manifest.ts"), /href: "\/agents\/workspace\/agents"/);
});

test("Passport and Radar derive the same per-capability states without an aggregate", () => {
  const model = read("../../lib/agent-control/agent-capability.ts");
  const passportView = read("./passport/capability-validation.tsx");
  const radar = read("./workspace/agents/agent-radar.tsx");
  const explorer = read("./passport/passport-explorer.tsx");
  const workspaceExplorer = read("./workspace/passport/workspace-passport-explorer.tsx");

  for (const state of ["DECLARED", "DISCOVERED", "OBSERVED", "PROVEN", "UNAVAILABLE", "CONFLICTING", "UNKNOWN"]) {
    assert.match(model, new RegExp(`"${state}"`), `AgentCapability lost ${state}`);
  }
  assert.match(model, /export function deriveAgentCapabilities/);
  assert.match(passportView, /deriveAgentCapabilities\(passport\)/);
  assert.match(radar, /deriveAgentCapabilities\(passport\)/);
  assert.doesNotMatch(model, /\b(?:score|rank|weight):/i);
  assert.match(passportView, /There is no aggregate score/);
  assert.match(passportView, /No current capability is PROVEN/);
  assert.match(explorer, /onPassportLoaded\?\.\(next\)/);
  assert.match(workspaceExplorer, /remember\(passport\)/);
  assert.match(workspaceExplorer, /No server record was created/);
});

/* ── RYN-AGENT-CONTROL-010 ────────────────────────────────────────────────
   Owner policy and the queue are two projections of one Action Case plus one
   typed owner-control context. The UI may explain authority; it may not create
   it by toggling a mode. */

test("Mandates and policies is a working sample studio over the owner-control kernel", () => {
  const page = read("./workspace/policies/page.tsx");
  const view = read("./workspace/policies/owner-control-view.tsx");
  const kernel = read("../../lib/agent-control/owner-control.ts");

  assert.match(page, /createGoldenRwaDemo/);
  assert.match(page, /<OwnerControlView/);
  assert.doesNotMatch(page, /WorkspaceSurfacePage/);
  assert.match(view, /useActionCases/);
  assert.match(view, /buildGoldenRwaOwnerControl/);
  assert.match(view, /INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE/);
  assert.match(view, /PER_ACTION/);
  assert.match(view, /BOUNDED_MANDATE/);
  assert.match(view, /RESERVED/);
  assert.match(view, /COMMITTED/);
  assert.match(kernel, /defaultAuthorizationMode: z\.literal\("PER_ACTION"\)/);
  assert.match(kernel, /Observe-only evidence is not delegated technical authority/);
});

test("Actions renders owner decision, evidence profile and budget impact from the selected case", () => {
  const actions = read("./workspace/actions/actions-view.tsx");
  const surfaces = read("./workspace/surfaces.ts");

  assert.match(actions, /buildGoldenRwaOwnerControl/);
  assert.match(actions, /Owner decision/);
  assert.match(actions, /Required evidence/);
  assert.match(actions, /Budget impact/);
  assert.match(actions, /PENDING_REVIEW/);
  assert.doesNotMatch(actions, /sendTransaction|writeContract|walletSignature/);
  assert.match(read("./workspace/i18n/catalog.ts"), /"nav.portfolio": "Actions"/);
  assert.match(read("./workspace/i18n/catalog.ts"), /"nav.strategy": "Strategy"/);
  assert.match(read("./workspace/agent-manifest.ts"), /href: "\/agents\/workspace\/actions"/);
  assert.match(read("./workspace/agent-manifest.ts"), /href: "\/agents\/workspace\/policies"/);
  assert.match(
    surfaces.match(/id: "actions"[\s\S]*?\n  \},/)?.[0] ?? "",
    /owner policy and budget exposure/i,
  );
});
