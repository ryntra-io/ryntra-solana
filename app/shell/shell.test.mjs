// Run from repo root: node --test app/shell/shell.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LAYOUT_SCHEMA_VERSION,
  LAYOUT_STORAGE_KEY,
  RENAMED_WORKSPACES,
  defaultPrefs,
  parseLayout,
  parsePrefs,
} from "./layout-store.ts";
import {
  WORKSPACES,
  WORKSPACE_GROUPS,
  workspaceGroup,
  navigationFor,
  workspaceById,
  workspaceForPath,
} from "./workspaces.ts";
import { orderedWidgets, widgetVisible } from "./widget-order.ts";
import { SHELL_CHROME_COPY } from "./chrome-copy.ts";
import { ECOSYSTEMS, ecosystemById } from "../../lib/product/ecosystems.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
/** Comments explain what was removed and name it; only shipped code is scanned. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const SHELL = read("app/shell/app-shell.tsx");
const CABINET_LAYOUT = read("app/app/layout.tsx");

test("the shell decides nothing about access", () => {
  /*
   * The load-bearing safety property of this migration.
   *
   * An ecosystem hub is deliberately reachable without an account — it is the
   * surface a reviewer opens with no Telegram, on a deployment that carries no
   * cabinet secrets. The cabinet also opens to guests. Both use the same shell,
   * which is only safe as long as the shell itself never reads a session: the
   * moment it does, one of those two facts silently becomes false. (A hub that
   * mounts it asserts its own side beside its layout.)
   */
  for (const marker of [/getSession/, /next\/headers/, /cookies\(/, /lib\/session/]) {
    assert.doesNotMatch(SHELL, marker, `the shell must not reach for a session: ${marker}`);
  }
  assert.doesNotMatch(read("app/shell/workspaces.ts"), /getSession|cookies\(/);
  assert.doesNotMatch(read("app/shell/shell-state.tsx"), /getSession|cookies\(/);
});

test("opening the cabinet to visitors changed what is shown, never what is allowed", () => {
  /*
   * The layout used to answer "no session" by replacing the entire application
   * with a sign-up form. It now renders the shell either way and each page says
   * what it can honestly show. That is a change to *presentation*, and this
   * test exists to prove it did not quietly become a change to *authorization*.
   *
   * The account boundary lives where it always did — in the routes. Every one
   * of these reads or writes something that belongs to an account, and every
   * one of them still asks who is calling.
   */
  const ACCOUNT_ROUTES = [
    "app/api/paper/route.ts",
    "app/api/live/route.ts",
    "app/api/settings/route.ts",
    "app/api/notify/route.ts",
  ];
  for (const route of ACCOUNT_ROUTES) {
    assert.match(read(route), /getSession/, `${route} must still resolve the session`);
  }

  /* `/api/paper` is the only write path a visitor could plausibly reach, and
     both of its abuse limits are keyed to an account. If the identity ever goes
     away, so do the limits — so the limits are asserted here, beside the change
     that opened the page in front of them. */
  const paper = read("app/api/paper/route.ts");
  assert.match(paper, /const session = await getSession\(\)/);
  assert.match(paper, /rateLimited\(/);
  assert.match(paper, /rateBuckets/);

  // The layout still resolves the session; it just no longer walls on it.
  assert.match(CABINET_LAYOUT, /getSession\(\)/);
  assert.doesNotMatch(CABINET_LAYOUT, /\bredirect\(|if\s*\(\s*!session/);
  /* RYN-ACCESS-002: signed in means an account that can keep personal data;
     the channel join is no longer the definition. */
  assert.match(CABINET_LAYOUT, /const signedIn = Boolean\(session && canKeepPersonalData\(session\)\);/);
  assert.match(CABINET_LAYOUT, /<ProductShell\s+signedIn=\{signedIn\}/);
  /* Both account states share the same Solana wallet provider and chrome.
     Session presence changes the account label, never the wallet's authority. */
  assert.equal((CABINET_LAYOUT.match(/<SolanaConnectionProvider>/g) ?? []).length, 1);
  const productShell = code("app/app/product-shell.tsx");
  /* RYN-CABINET-HEADER-001 (Owner, 2026-09-12): one control in the header for
     the person — the wallet — with the account inside its panel; the separate
     *Sign in* is gone. Since canon v5.4 (В31) the panel is the person's menu
     too: Налаштування, Мова, Тема, Від'єднати — Settings is one of its rows,
     not a second link in the identity block. */
  assert.equal((productShell.match(/<SolanaConnectionControl\s+identity=\{<WalletAccountIdentity \/>\}/g) ?? []).length, 1);
  assert.match(productShell, /preferences=\{\(close\) => \(\s*<MenuPreferences/);
  assert.doesNotMatch(productShell, /<AccountControl\s*\/>/);
  assert.doesNotMatch(code("app/app/account/account-control.tsx"), /href="\/app\/settings#account"/);
  assert.match(code("app/shell/menu-preferences.tsx"), /href=\{settingsHref\}/);
  assert.doesNotMatch(productShell, /signedIn\s*\?\s*<SolanaConnectionControl/);
  assert.doesNotMatch(CABINET_LAYOUT, /VisitorAccount|CabinetAccount/);

  /* Home wave 1 splits the page-level account gate from the exact credential
     gate. An authenticated wallet-only account may keep browser-local read
     connections and InvestorContext; Arcus mutation still gets the existing
     verified-session fact as its own prop and remains server-gated too. */
  const connect = read("app/app/connect/page.tsx");
  assert.match(connect, /if \(!session\) \{/);
  assert.match(connect, /<ConnectionCenter/);
  assert.match(connect, /canManageVenue=\{session\.verified\}/);
  assert.doesNotMatch(connect, /if \(!session\?\.verified\) \{/);

  /* And a visitor's terminal never calls the paper route at all — there is no
     request to reject, because there is no request. */
  const terminal = read("app/demo/terminal.tsx");
  assert.match(terminal, /if \(visitor\) return;/);
  assert.match(terminal, /visitor \? \(\s*<Link className=\{`dm-place/);

  /* Opening the surface put the primary call to action of every visitor page on
     `.btn-sm`, which computes to 41px, and on the attention row's link, which
     computed to 21px. Both went unnoticed while nobody could reach these pages
     on a phone without an account. Measured at 375px before these rules
     existed: four sub-44px controls across Home and the visitor notices. */
  const globals = read("app/globals.css");
  assert.match(globals, /@media \(max-width: 640px\) \{\s*\.btn \{ min-height: 44px; \}/);
  assert.match(globals, /@media \(max-width: 640px\) \{\s*\.attn-row a \{[^}]*min-height: 44px;/);
});

test("there is one application shell, and the second one is gone", () => {
  /*
   * A hub once drew its own application: its own brand block, its own rail,
   * its own context bar and no route back. Two shells on one domain read as two
   * companies. Each hub asserts beside its own shell that it contributes to the
   * one shell rather than drawing a second; this test holds the shell's side.
   */

  /* Every workspace fills the account slot with a connection control, and none
     of them fills it with something that stands in for one. `NO WALLET` was a
     flat span in Agent Control's top bar, printed above `/agents/workspace/
     authorize` — a route that connects an EVM wallet and signs EIP-712. The
     chrome was asserting the product could not do a thing it does one click
     away, which `connection.ts` calls out by name. */
  const AGENT_SHELL = code("app/agents/workspace/agent-control-shell.tsx");
  /* Agent Control always mounts the same control. Hiding it on read routes
     printed a global absence while authorize could still sign. Disconnected
     read surfaces stay usable; the control reports that honestly. */
  assert.match(AGENT_SHELL, /<RyntraConnectionControl/);
  assert.equal(AGENT_SHELL.match(/<RyntraConnectionControl/g)?.length, 1);
  assert.doesNotMatch(AGENT_SHELL, /walletBelongsOn/);
  assert.doesNotMatch(AGENT_SHELL, /NO WALLET/);
  /* And it reports a real session rather than a hardcoded absence: the layout
     resolves one and hands the proved address down. A visitor still reaches
     Agent Control — `null` is a supported state, not a wall. */
  assert.match(code("app/agents/workspace/layout.tsx"), /const session = await getSession\(\)/);
  assert.match(
    code("app/agents/workspace/layout.tsx"),
    /identityWallet=\{session\?\.identityWallet \?\? null\}/,
  );

  // The cabinet no longer draws a sidebar of its own either.
  const nav = code("app/app/nav.tsx");
  assert.doesNotMatch(nav, /export function CabinetChrome/);
  assert.doesNotMatch(nav, /cbs-side|cbs-mbar/);
  assert.match(nav, /export function CabinetNavFooter/);

  // The surfaces name the same component.
  assert.match(code("app/app/home-shell.tsx"), /from "@\/app\/shell\/app-shell"/);
  assert.match(code("app/stellar/workspace/hub/shell.tsx"), /from "@\/app\/shell\/app-shell"/);
});

test("every registered workspace can actually be entered", () => {
  /*
   * The rule that replaced "list everything and grey out what does not work".
   *
   * A switcher is a set of choices, so a row that cannot be chosen makes every
   * other row harder to trust — and the previous registry had five of them
   * against four real ones, at three different levels of abstraction. Accepted
   * directions did not disappear: they live in `lib/product/ecosystems.ts` and
   * render on the Workspace Map, which has room for a state and a gate.
   */
  for (const workspace of WORKSPACES) {
    assert.equal(typeof workspace.href, "string", `${workspace.id} must have a route`);
    assert.ok(workspace.href.startsWith("/"), `${workspace.id} must own a real route`);
    assert.ok(workspace.match.length > 0, `${workspace.id} must own at least one route`);
    assert.ok(workspace.subtitle.length > 10, `${workspace.id} needs a factual subtitle`);
    assert.ok(workspace.short.length > 0, `${workspace.id} needs a short name for the phone bar`);
  }

  /* And the registry has no way back: no gate, no state word, no unreachable
     row. Scanned over the array itself rather than the file, because `NavEntry`
     legitimately keeps `href: string | null` — a *navigation* entry may be
     disabled with its reason attached, a workspace may not. */
  const source = code("app/shell/workspaces.ts");
  const array = source.slice(
    source.indexOf("const REGISTERED: Workspace[] = ["),
    source.indexOf("export const WORKSPACES"),
  );
  assert.ok(array.length > 200, "the registry array must be findable");
  assert.doesNotMatch(array, /href: null/);
  assert.doesNotMatch(array, /"research"|session_required|gate:/);
});

test("the switcher answers one question and delegates the rest", () => {
  /* Four facts used to share one control. Each now has its own place, and each
     assertion below is one of them staying there. */

  // The workspace name, on one line. The 12px uppercase eyebrow above it is
  // gone: it named the control rather than the thing, in the one size the
  // frozen ramp does not permit.
  assert.doesNotMatch(SHELL, /rs-switch-eyebrow/);
  assert.doesNotMatch(SHELL, /rs-switch-kind/);
  assert.doesNotMatch(SHELL, /ecosystem_pack" \? "Pack"/);

  // The environment, as its own chip, from the registry — with a route-level
  // override. `undefined` keeps the workspace default; `null` says this route
  // has no environment, which Agent Control's verifier needs: it recomputes
  // hashes over pasted JSON and a chip there would be decoration reading as a
  // fact. The workspace-wide `BNB Testnet` that used to sit above the
  // Agentverse Passport is what this replaced.
  assert.match(SHELL, /<EnvironmentChip workspace=\{workspace\} scope=\{scope\} \/>/);
  assert.match(SHELL, /scope === undefined \? workspace\.environment : scope/);
  assert.match(SHELL, /const label = scope === undefined \? workspace\.environment : scope;/);
  assert.match(SHELL, /if \(!label\) return null;/);

  const switcherAt = SHELL.indexOf("function WorkspaceSwitcher");
  const switcherEnd = SHELL.indexOf("function EnvironmentChip");
  const switcher = SHELL.slice(switcherAt, switcherEnd);
  assert.ok(switcherAt > 0 && switcherEnd > switcherAt);

  // No account state per row: sign-in is global, in the top bar, once.
  assert.doesNotMatch(switcher, /Sign-in|Research|>Open</);

  /* And no environment, maturity or status per row either. `PAPER ·
     WALLET-SIGNED ROUTES` in a switcher row is a sentence, and a person
     scanning six rows for somewhere to go reads none of them. The row is an
     icon, a name, one muted line and a tick. */
  assert.doesNotMatch(switcher, /workspace\.environment/);
  assert.doesNotMatch(switcher, /rs-switch-item-env/);

  // Four headings, from the registry rather than written out here.
  assert.match(switcher, /WORKSPACE_GROUPS\.map/);
  assert.match(switcher, /workspaceGroup\(workspace\) === group/);
  assert.deepEqual([...WORKSPACE_GROUPS], ["RYNTRA", "PRODUCTS", "ECOSYSTEMS"]);
  /* The heading is derived, so the assertion worth making is that the
     derivation follows the registry's own distinction rather than a second
     field that could disagree with it. A domain product filed under
     ECOSYSTEMS used to be writable, compile and look deliberate. */
  for (const workspace of WORKSPACES) {
    const group = workspaceGroup(workspace);
    assert.ok(WORKSPACE_GROUPS.includes(group), `${workspace.id} sits under no switcher heading`);
    assert.equal(
      group,
      workspace.kind === "home" ? "RYNTRA" : workspace.kind === "ecosystem_pack" ? "ECOSYSTEMS" : "PRODUCTS",
      `${workspace.id} is grouped against its own kind`,
    );
    assert.ok(workspace.icon, `${workspace.id} has no switcher glyph`);
  }

  /* Agent Control is ours: a domain product with an adapter, not a pack for
     someone else's network. Robinhood Chain sat beside it under PRODUCTS until
     RYN-RHC-002, on the argument that a desk settling on a chain is not the
     chain — which was true of the desk and is not true of what replaced it. */
  assert.equal(workspaceGroup(workspaceById("agent-control")), "PRODUCTS");
  for (const id of ["robinhood-chain", "stellar", "solana"]) {
    assert.equal(workspaceGroup(workspaceById(id)), "ECOSYSTEMS", id);
  }

  /* And the roadmap has a door rather than a heading. The footer opens the
     capability register — `/workspaces` is a permanent redirect there since
     the public-surface consolidation — and its label comes from the shell
     catalog so it can name that destination in both languages. For one
     release it kept the old `All workspaces` label over the new href: a door
     that promised workspaces and delivered capabilities, locked in by this
     very test. The label is asserted against the catalog below. */
  assert.match(switcher, /href="\/docs\/current-capabilities"/);
  assert.match(switcher, /sw\.all/);
  assert.doesNotMatch(switcher, /All workspaces/);
  assert.equal(SHELL_CHROME_COPY.en.switcher?.all, "Current capabilities");
  assert.equal(SHELL_CHROME_COPY.uk.switcher?.all, "Поточні можливості");
  assert.doesNotMatch(switcher, /roadmap/i);
});

test("the workspace is decided by the route, not by the layout that mounted it", () => {
  /*
   * The cabinet layout mounts one shell for every `/app` route. With a
   * hardcoded id the top bar named the same workspace on the overview, the
   * terminal and the journal — the switcher's single job, answered wrong on two
   * pages out of three.
   */
  assert.match(SHELL, /workspaceForPath\(pathname \?\? ""\) \?\? declared/);
  /* The scope may now be the product's own — one product cannot remember two
     Simple/Pro settings for itself — but it is still the ROUTE that decides,
     never the mounting layout, which is what this test exists to hold. */
  assert.match(SHELL, /<ShellStateProvider\s+workspaceId=\{product \? "ryntra" : workspace\.id\}/);
  /* Canon v5.3 (В28): the product is one version — no depth to paint first,
     none to mirror into a cookie; its scope reads the one layout whatever
     an older visit stored. */
  assert.match(SHELL, /oneVersion=\{Boolean\(product\)\}/);
  assert.doesNotMatch(SHELL, /initialMode=|mirrorsDepth=/);
  assert.ok(
    !/<ShellStateProvider workspaceId=\{declared/.test(SHELL),
    "the preference scope is taken from the mounting layout again",
  );
  assert.match(code("app/app/home-shell.tsx"), /workspaceId="home"/);

  /* Longest match wins. Account-level routes deliberately claim no prefix of
     their own, so Journal, Connections and Settings resolve to Home — which is
     where Review and Connections actually live now that neither is a workspace
     of its own. */
  assert.equal(workspaceForPath("/app")?.id, "home");
  assert.equal(workspaceForPath("/app/journal")?.id, "home");
  assert.equal(workspaceForPath("/app/connect")?.id, "home");
  /* The id changed and every route that resolved to it still resolves to it.
     A rename that quietly narrowed `match` would send `/robinhood/workspace` to Home,
     where the top bar names a workspace the reader is not in. */
  for (const path of ["/robinhood/workspace/terminal", "/robinhood/workspace/swap", "/robinhood/workspace", "/robinhood/workspace/AAPL"]) {
    assert.equal(
      workspaceForPath(path)?.id,
      "robinhood-chain",
      `${path} resolved to another workspace after the rename`,
    );
  }
  assert.equal(workspaceForPath("/agents/workspace")?.id, "agent-control");
  assert.equal(workspaceForPath("/agents/workspace/lab")?.id, "agent-control");
  // A prefix must not match a sibling that merely starts the same way.
  assert.equal(workspaceForPath("/agents"), undefined);
  assert.equal(workspaceForPath("/appointments"), undefined);
});

test("the Workspace Map carries the directions the switcher stopped carrying", async () => {
  /*
   * Removing rows from a menu is only honest if they land somewhere. The map
   * renders from the ecosystem manifest rather than from a list written on the
   * page, so a direction cannot be invented in prose and cannot advertise more
   * than the manifest states.
   */
  const map = read("app/workspaces/page.tsx");
  assert.match(map, /from "@\/lib\/product\/ecosystems"/);
  assert.match(map, /from "@\/app\/shell\/workspaces"/);
  assert.match(map, /entry\.gate/, "each direction must render its own stated limit");
  // A research row gets no action control; `isSelectable` decides that in code.
  assert.match(map, /workspace && isSelectable\(entry\)/);
  /* `RYN-SITE-003` rewrote this heading to survive one pass of the eye. The
     claim is identical; only the sentence changed, and the test followed it
     three weeks late. */
  assert.match(map, /Registered, not supported/);
  /* `read_only` collapses into the `live` pill because it is a mode, not a
     release stage — so the qualifier has to render beside it. Arcus Perps
     reading `LIVE` alone would claim a venue that never submits an order. */
  assert.match(map, /entry\.state === "read_only" \? \(/);
  assert.match(map, /Read-only/);
  // And the register is reachable from the switcher and from search engines.
  assert.match(SHELL, /href="\/docs\/current-capabilities"/);
  assert.doesNotMatch(SHELL, /All workspaces &amp; roadmap/);
  /* `/docs/current-capabilities` has redirected into the documentation since
     2026-09-05 (to the cabinet page since 2026-09-14), and the sitemap
     advertises only addresses that answer — so the register's public home is
     the documentation's cabinet page, which the sitemap does carry. */
  const { CUSTOMER_REDIRECTS } = await import("../../lib/product/customer-routing.ts");
  const register = CUSTOMER_REDIRECTS.find((row) => row.source === "/docs/current-capabilities");
  assert.ok(register, "the register's old address must still redirect");
  assert.doesNotMatch(read("app/sitemap.ts"), /path: "\/docs\/current-capabilities"/);
  const sitemap = (await import("../sitemap.ts")).sitemapEntries([]);
  assert.ok(sitemap.some((entry) => entry.url === `https://ryntra.io${register.destination}`), "the register's page is advertised");

  /* The one control the map renders inline is a link inside a line of text, and
     a line of text is 17px tall. Measured on the deployed page at 375px before
     this rule existed: five sub-44px tap targets.

     The map migrated onto the frozen system and dropped its own stylesheet, so
     the rule moved with it — `.rx-wsmap-open` in `app/workspaces/workspaces.css`
     became `.rx-dir-open` in the shared module sheet. The guarantee is the one
     that was measured, not the selector that carried it. */
  const frozenModules = read("app/site/frozen/module.css");
  assert.match(frozenModules, /\.rx-dir-open \{/);
  /* The breakpoint moved with the rule — 640px to 860px — because that is where
     the direction row now stacks and the link becomes the row's action. The
     number is read from the rule rather than pinned, so a future re-breakpoint
     cannot pass by leaving a 44px rule at a width the row no longer stacks at:
     the assertion below requires the rule to sit inside a max-width query. */
  assert.match(
    frozenModules,
    /@media \(max-width: \d+px\) \{[\s\S]{0,240}?\.rx-dir-open \{[\s\S]{0,160}?min-height: 44px;/,
  );
});

test("a disabled navigation entry carries its reason", () => {
  for (const workspace of WORKSPACES) {
    for (const group of navigationFor(workspace.id)) {
      for (const entry of group.entries) {
        if (entry.href === null) {
          assert.ok(
            entry.gate && entry.gate.length > 30,
            `${workspace.id}/${entry.id} is disabled and must explain why`,
          );
        }
      }
    }
  }
});

test("no rail repeats the workspace list", () => {
  /*
   * The top bar's switcher is the one answer to "where am I". A sidebar that
   * offers the same jumps turns one question into two controls that can
   * disagree — and the cabinet rail did exactly that, carrying an `Ecosystems`
   * group whose only entry was the workspace beside it in the switcher.
   *
   * The single permitted exception is an explicitly titled cross-workspace
   * group, where the title itself says the destination lives somewhere else.
   */
  for (const id of ["home", "robinhood-chain"]) {
    const others = WORKSPACES.filter((workspace) => workspace.id !== id);
    for (const group of navigationFor(id)) {
      const crossing = group.entries.filter((entry) =>
        others.some((other) => entry.href === other.href || entry.href?.startsWith(`${other.href}/`)),
      );
      assert.deepEqual(crossing, [], `${id} must not link into another workspace from its rail`);
    }
  }

  /* Home and Agent Control supply navGroupsFor from a Shell v2 manifest. */
  assert.equal(navigationFor("home").length, 0, "Home supplies its own navigation from home-shell");
  assert.equal(navigationFor("agent-control").length, 0,
    "Agent Control supplies its own navigation from agent-control-shell");
  const homeManifest = code("app/app/home-manifest.ts");
  assert.match(homeManifest, /href: "\/app\/journal"/);
  assert.match(homeManifest, /href: "\/app\/connect"/);
  assert.match(homeManifest, /href: "\/app\/portfolio"/);

  /* Robinhood Chain no longer routes through this registry at all, and its rail
     no longer carries Home's destinations.
     It used to end with a group titled `Ryntra Home` — `Portfolio & Markets`,
     `Journal`, `Connections` — three links belonging to a different workspace,
     inside a chain's rail. No other ecosystem did that: every other hub
     supplies its own `navGroupsFor`. This asserts the shape rather than
     the absence, so a future edit cannot reintroduce it under another title. */
  assert.equal(navigationFor("robinhood-chain").length, 0,
    "Robinhood Chain supplies its own navigation from its workspace shell");
  const rhShell = code("app/robinhood/workspace/shell.tsx");
  /* Matched on `href:` rather than on the path alone — the loose form caught
     the import of `@/app/app/connection`, which is the shared control every
     workspace mounts and not a destination at all. */
  assert.doesNotMatch(rhShell, /href: "\/app\/(journal|connect|beta)"|href: "\/app"/,
    "a chain's rail carries no destination that belongs to Home");
  assert.doesNotMatch(rhShell, /title: "Ryntra Home"/);
  /* Radar first, because a trade opens from Radar — and its three modes are
     modes, marked `sub`, not four sibling products. */
  assert.match(rhShell, /id: "radar", label: "Radar", href: "\/robinhood\/workspace"/);
  for (const mode of ["screener", "scanner", "watchlist"]) {
    assert.match(rhShell, new RegExp(`id: "${mode}"[^\\n]*sub: true`), `${mode} must be a Radar mode`);
  }
  assert.match(rhShell, /navSettings=\{SETTINGS\}/, "Settings is pinned, not an entry in a group");
  /* Solana joins the visible top-bar Simple/Pro placement by direct founder
     instruction on 2026-09-01 so the complete final menu can be inspected now. */
  for (const file of [
    "app/app/home-shell.tsx",
    "app/agents/workspace/agent-control-shell.tsx",
  ]) {
    assert.match(code(file), /modeInContext/, `${file} must use the top-bar depth placement`);
    assert.match(code(file), /<DepthSwitch/, `${file} must mount the shared DepthSwitch`);
  }
  const solanaShell = code("app/solana/workspace/hub/shell.tsx");
  assert.match(solanaShell, /<DepthSwitch/, "Solana must expose Simple/Pro in the desktop top bar");
  assert.doesNotMatch(solanaShell, /modeInContext/,
    "Solana keeps the Layout copy as the mobile fallback when the top-bar switch is hidden");
  for (const file of [
    "app/stellar/workspace/hub/shell.tsx",
    "app/robinhood/workspace/shell.tsx",
  ]) {
    assert.doesNotMatch(code(file), /context=\{<(DepthSwitch|HubModeSwitch) \/>\}/,
      `${file} must not put the depth control in the top bar`);
    assert.doesNotMatch(code(file), /modeInContext/,
      `${file} must not suppress the layout menu's depth control — it is the only one left`);
  }

  /* And there is exactly one implementation of it. Five workspaces rendered
     five copies against one stored preference — three class names, three
     heights and two vocabularies. A count here rather than a sentence, because
     the sentence is what drifted last time. */
  const depthCopies = ["app/agents/workspace/agent-control-shell.tsx",
    "app/solana/workspace/hub/shell.tsx", "app/stellar/workspace/hub/shell.tsx",
    "app/robinhood/workspace/shell.tsx"];
  for (const file of depthCopies) {
    assert.doesNotMatch(code(file), /aria-pressed=\{(active|mode|prefs)/,
      `${file} must render the shared DepthSwitch, not its own`);
  }
  assert.match(code("app/shell/depth-switch.tsx"), /className="sh-mode"/);
});

test("layout preferences survive anything that is put in front of them", () => {
  const base = defaultPrefs();
  assert.equal(base.inspectorOpen, false, "the inspector earns its width by being asked for");

  // Garbage in, defaults out — never a throw.
  for (const garbage of [null, undefined, 0, "", "not json", [], { mode: "wizard" }, { hidden: "x" }]) {
    const prefs = parsePrefs(garbage);
    assert.ok(["guided", "standard", "pro"].includes(prefs.mode));
    assert.ok(Array.isArray(prefs.hidden));
    assert.ok(Array.isArray(prefs.order));
  }

  // A store from another schema version is discarded, not half-read.
  assert.deepEqual(parseLayout({ version: 99, byWorkspace: { global: { mode: "pro" } } }).byWorkspace, {});
  assert.equal(parseLayout(null).version, LAYOUT_SCHEMA_VERSION);

  // Only slug-shaped workspace ids are accepted back out of the browser.
  const parsed = parseLayout({
    version: LAYOUT_SCHEMA_VERSION,
    byWorkspace: {
      "stellar": { mode: "pro", navCollapsed: true },
      "../../etc": { mode: "pro" },
      "<script>": { mode: "pro" },
    },
  });
  assert.deepEqual(Object.keys(parsed.byWorkspace), ["stellar"]);
  assert.equal(parsed.byWorkspace["stellar"].mode, "pro");
});

test("the layout key is versioned and holds nothing worth stealing", () => {
  assert.match(LAYOUT_STORAGE_KEY, /\.v\d+$/);
  const source = read("app/shell/layout-store.ts");
  /* A browser key is not a place to duplicate product state. If any of these
     ever appears in the stored shape, a layout preference has quietly become a
     copy of something that belongs on the server. */
  for (const forbidden of [/address/i, /balance/i, /privateKey/i, /seed/i, /receipt/i, /telegram/i]) {
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), forbidden);
  }
});

test("every workspace resolves and every navigation icon exists", () => {
  for (const workspace of WORKSPACES) {
    assert.ok(workspaceById(workspace.id), `${workspace.id} must resolve by id`);
    assert.ok(workspace.subtitle.length > 10, `${workspace.id} needs a factual subtitle`);
  }
  assert.equal(workspaceById("agent-control")?.kind, "domain");
  /* Agent Control declares no workspace-level environment on purpose. One
     global `BNB Testnet` put a chain badge above the provider-global
     Agentverse Passport and above a verifier that touches no network, so the
     label moved to the route through `scopeForPath`. The registry entry's own
     comment had predicted exactly this. */
  assert.equal(workspaceById("agent-control")?.environment, undefined);
  assert.equal(workspaceById("agent-control")?.href, "/agents/workspace");
  assert.equal(workspaceById("home")?.environment, undefined, "Home is venue-neutral by construction");
  /* An entry may name its own icon; otherwise the id resolves one, and an
     unknown id falls back rather than rendering an empty cell. */
  assert.match(SHELL, /ICONS\[entry\.icon \?\? entry\.id\] \?\?\s*\(?\s*</);
});

test("the shell is operable without a pointer", () => {
  assert.match(SHELL, /className="rs-skip" href="#workspace"/);
  assert.match(SHELL, /<main className="rs-canvas" id="workspace" tabIndex=\{-1\}>/);
  /* The switcher and the drawer both close on Escape. The shell-state half of
     this assertion belonged to focus mode, which was removed with its control —
     an Escape handler for a mode nothing can enter is a listener guarding
     nothing, and asserting its presence would have kept the mode's last
     fragment alive after the mode itself was gone. */
  assert.match(SHELL, /event\.key === "Escape"/);
  // The drawer closes on navigation, so it cannot hide the page just requested.
  assert.match(SHELL, /setDrawer\(false\);\s*\}, \[pathname\]\)/);
  /* The rail's second control was focus mode, then a theme switch, and is now
     nothing: appearance has one home. What a keyboard needs from the slot that
     remains is that the layout menu names its own radiogroups, which it does —
     `Workspace mode`, `Workspace density`. A control with a `title` and no
     accessible name is a control a screen reader cannot announce. */
  const customize = read("app/shell/customize.tsx");
  /* `Workspace depth`, not `Workspace mode`: the menu became the only depth
     control on 2026-08-24 and had to stop being the only surface still saying
     `Guided | Standard | Pro` at it. Two values, in the product's words. */
  /* The two names are catalog sentences now, so what is pinned is that each
     radiogroup still *has* an accessible name rather than what that name says
     in English. A control a screen reader cannot announce is the defect this
     assertion was written for, and it still catches it. */
  assert.match(customize, /role="radiogroup" aria-label=\{copy\.depthGroup\}/);
  assert.match(customize, /DEPTH_CHOICES = \["guided", "pro"\]/);
  assert.doesNotMatch(customize, /\{WORKSPACE_MODES\.map/,
    "the layout menu must not offer `standard` as a choice — nothing else can render it");
  assert.match(customize, /role="radiogroup" aria-label=\{copy\.densityGroup\}/);
  /* And the English those two keys fall back to is still the English they had,
     for every workspace that has no catalog. */
  const shellCopy = read("app/shell/shell-copy.tsx");
  assert.match(shellCopy, /depthGroup: "Workspace depth"/);
  assert.match(shellCopy, /densityGroup: "Workspace density"/);
  assert.match(
    read("app/app/settings/appearance.tsx"),
    /role="radiogroup" aria-label=\{themeLabel\}/,
    "the one theme control must be an announceable radiogroup",
  );
});

test("the mobile navigation is inert when closed and traps then restores focus when open", () => {
  assert.match(SHELL, /aria-hidden=\{hidden \|\| undefined\}/);
  assert.match(SHELL, /inert=\{hidden\}/);
  assert.match(SHELL, /hidden=\{mobile && !drawer\}/);
  assert.match(SHELL, /aria-controls=\{mobile \? "workspace-navigation" : undefined\}/);
  assert.match(SHELL, /navigation\.querySelectorAll<HTMLElement>/);
  assert.match(SHELL, /event\.key !== "Tab"/);
  assert.match(SHELL, /event\.shiftKey && document\.activeElement === first/);
  assert.match(SHELL, /document\.activeElement === last/);
  assert.match(SHELL, /const trigger = navToggleRef\.current/);
  assert.match(SHELL, /trigger\?\.focus\(\)/);
});

test("mobile shell controls retain 44px targets and a readable workspace name without overflowing", () => {
  const css = read("app/shell/shell.css");
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.rs-navtoggle,[\s\S]*?\.rs-tool \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(css, /\.rs-brand \{[\s\S]*?flex: 0 0 44px;[\s\S]*?height: 44px;/);
  assert.match(css, /\.rs-brand \.ryntra-brand-lockup \{[^}]*object-fit: cover/, "the collapsed rail crops the lockup to its mark");
  assert.match(css, /\.rs-top \{ gap: 2px; padding-inline: 4px; \}/);
  assert.match(css, /\.rs-tools \{ flex: none; gap: 0; \}/);
  assert.match(css, /\.rs-switchbox \{ flex: 0 0 62px; min-width: 62px; \}/);
  assert.match(css, /\.rs-menu-trigger\.rs-switch \{[\s\S]*?width: 100%;[\s\S]*?min-width: 62px;[\s\S]*?height: 44px;/);
  /* The connection control is the one the thumb reaches for and the one that
     spends money. It keeps the full target even where the tool icons shrink. */
  assert.match(css, /\.rs-menu-trigger\.rs-conn \{ height: 44px; \}/);
  assert.match(SHELL, /rs-switch-name-full/);
  assert.match(SHELL, /rs-switch-name-mobile/);
  assert.match(css, /\.rs-switch-name-full \{ display: none; \}/);
  assert.match(css, /\.rs-switch-name-mobile \{ display: inline; \}/);
  assert.match(css, /\.rs-menu-trigger\.rs-switch > svg:last-child \{ display: none; \}/);
  for (const id of ["solana", "stellar"]) {
    const workspace = workspaceById(id);
    assert.equal(workspace?.short, workspace?.name, `${id} must stay unambiguous in the phone bar`);
  }
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.rs-link \{ min-height: 44px; \}/);

  /* The environment chip leaves the bar below 520px rather than shrinking it:
     at 375px the bar is already three 44px targets and a 62px name. It is
     stated at the top of the page and again at the moment of signature, which
     is where it has to be read — the switcher rows no longer carry it at all. */
  assert.match(css, /\.rs-env \{ display: none; \}/);
  // The footer link and every panel action are targets, not lines of text.
  assert.match(css, /\.rs-switch-item,\s*\.rs-switch-more,\s*\.rs-menu-action,/);

  /* Every top-bar panel becomes a full-width sheet, keyed on the shared menu
     class rather than on one control's own. The switcher used to be the only
     panel this rule reached, so the connection panel would have clipped at
     375px the day it shipped. */
  assert.match(css, /\.rs-top \.rs-menu-panel \{[\s\S]*?position: fixed;[\s\S]*?inset-inline: 10px;/);
});

test("the switcher panel does not scroll, because it cannot need to", () => {
  /*
   * The old panel had `max-height` and `overflow-y` because it held nine rows
   * under two headings. Six rows, four short headings and a footer cannot need
   * a scrollbar on a desktop, and leaving the escape hatch in is how the list
   * grew to nine the first time: a menu that can always be made taller never
   * has to be made shorter.
   *
   * The mobile sheet below 520px is the deliberate exception and scopes its own
   * `overflow-y`, which is why this reads the desktop rule only.
   */
  const css = read("app/shell/shell.css").replace(/\/\*[\s\S]*?\*\//g, " ");
  const panel = css.slice(css.indexOf(".rs-menu-panel {"), css.indexOf(".rs-menu-section {"));
  assert.doesNotMatch(panel, /overflow-y/);
  assert.doesNotMatch(panel, /max-height/);
  assert.match(panel, /width: min\(380px, calc\(100vw - var\(--ry-s6\)\)\)/);
  /* Six since RYN-SOL-A4 shipped the Solana Hub — a real, enterable
     workspace, not a row invented to fill a menu. The bound stays tight on
     purpose: the next workspace must argue its case here, not inherit a
     taller box. */
  assert.ok(WORKSPACES.length <= 6, "more than six workspaces needs a different control, not a taller box");
});

test("a mode decides what is shown, and essential panels survive every mode", () => {
  const readiness = { id: "hub-readiness", title: "Readiness", essential: true };
  const session = { id: "hub-session", title: "Session strip" };
  const health = { id: "hub-health", title: "Operational health", advanced: true };

  // Essential cannot be switched off, whatever the user or the mode says.
  assert.equal(widgetVisible(readiness, "standard", ["hub-readiness"]), true);
  assert.equal(widgetVisible(readiness, "guided", ["hub-readiness"]), true);
  assert.equal(widgetVisible(readiness, "pro", ["hub-readiness"]), true);

  // Standard and Pro honour what the user hid.
  assert.equal(widgetVisible(session, "standard", []), true);
  assert.equal(widgetVisible(session, "standard", ["hub-session"]), false);
  assert.equal(widgetVisible(session, "pro", ["hub-session"]), false);

  /* Guided is curated rather than personalised: it drops the advanced panels
     and deliberately ignores the hidden set, so switching into it always
     produces the same explainable screen. */
  assert.equal(widgetVisible(health, "standard", []), true);
  assert.equal(widgetVisible(health, "guided", []), false);
  assert.equal(widgetVisible(session, "guided", ["hub-session"]), true);
});

test("a saved order never rearranges panels it has never heard of", () => {
  const widgets = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
  ];

  // No order at all leaves the registered arrangement untouched.
  assert.deepEqual(orderedWidgets(widgets, []).map((w) => w.id), ["a", "b", "c"]);

  assert.deepEqual(orderedWidgets(widgets, ["c", "a", "b"]).map((w) => w.id), ["c", "a", "b"]);

  /* A panel added after the user customised their layout goes to the end
     rather than to the front — adding one must not reshuffle the rest. */
  const withNew = [...widgets, { id: "d", title: "D" }];
  assert.deepEqual(orderedWidgets(withNew, ["c", "a", "b"]).map((w) => w.id), ["c", "a", "b", "d"]);

  // An order naming panels that no longer exist is simply ignored.
  assert.deepEqual(orderedWidgets(widgets, ["gone", "c", "a", "b"]).map((w) => w.id), ["c", "a", "b"]);
});

test("the layout preferences have controls, not just a storage key", () => {
  /*
   * The first version of this shell shipped `setMode`, `toggleWidget` and
   * `reset` with nothing calling any of them: state and persistence with no way
   * to reach either. A preference layer without controls is dead code with a
   * storage key.
   */
  const customize = read("app/shell/customize.tsx");
  for (const control of ["setMode", "toggleWidget", "moveWidget", "reset"]) {
    /* `\b` inside a template literal is a backspace character, not a word
       boundary — the escape has to survive into the RegExp source. */
    assert.match(customize, new RegExp(`\\b${control}\\b`), `${control} has no control`);
  }
  /* Matches with or without props. The shell now passes `showMode`, because a
     workspace that shows `Guided | Pro` in the top bar owns the mode and this
     menu must not offer a second, three-valued answer to the same preference.
     What the assertion is for is unchanged: the shell mounts the menu. */
  assert.match(SHELL, /<CustomizeMenu[\s/]/);
  assert.match(SHELL, /<WidgetRegistryProvider>/);

  // Reordering is buttons, not a drag handle: no drag library is installed, and
  // a mouse-only gesture would be worse than a pair of keyboard-operable steps.
  //
  // The two names used to be English template literals here. They are catalog
  // sentences now — the whole menu was English on a Ukrainian workspace — so
  // what is asserted is the part that was ever load-bearing: each button has an
  // accessible name, and that name says which panel it moves.
  assert.match(customize, /aria-label=\{fill\(copy\.moveUp, \{ panel: widget\.title \}\)\}/);
  assert.match(customize, /aria-label=\{fill\(copy\.moveDown, \{ panel: widget\.title \}\)\}/);
  assert.doesNotMatch(customize, /onDragStart|draggable/);

  // Destructive actions confirm first.
  assert.match(customize, /confirmReset/);
  assert.match(customize, /\{copy\.resetAsk\}/);
  assert.match(
    read("app/shell/shell-copy.tsx"),
    /resetAsk: "Reset this workspace to its default layout\?"/,
  );

  // Guided offers no customization at all.
  assert.match(customize, /disabled=\{Boolean\(widget\.essential\) \|\| guided\}/);
});

test("the cabinet's theme control is one the shell actually answers", () => {
  /*
   * The cabinet offers System/Dark/Light and writes `<html data-theme>`. The
   * shell was authored dark and hardcoded: choosing Light left navy chrome
   * around white content. A chrome that half-flips — pale labels on a pale
   * sidebar — is worse than one that never offered light at all.
   *
   * Shell v2 answers it at the token layer instead of the selector layer. The
   * top bar, the rail, the switcher and the connection control draw from
   * `--ry-*`, and `app/design/tokens.css` names `[data-theme="light"]` in the
   * same rule that already defines the light palette for the public site. One
   * palette, two attributes, no copy — which is why most of the old override
   * block below is gone rather than translated.
   */
  const tokens = read("app/design/tokens.css");
  const lightAt = tokens.indexOf('[data-ry-theme="light"],');
  const lightEnd = tokens.indexOf("}", lightAt);
  assert.ok(lightAt > 0);
  assert.ok(
    tokens.slice(lightAt, lightEnd).includes('[data-theme="light"]'),
    "the frozen light palette must answer the shell's own theme attribute",
  );

  /* And the shell must not restate it. A second light palette written beside
     the chrome is a copy, and a copy drifts. */
  const css = read("app/shell/shell.css");
  const shellLight = css.slice(css.indexOf('[data-theme="light"]'));
  for (const token of ["--ry-bg", "--ry-card", "--ry-text", "--ry-muted", "--ry-border", "--ry-sidebar"]) {
    assert.doesNotMatch(
      shellLight,
      new RegExp(`${token}:`),
      `${token} must not be redefined in the shell — the frozen tokens own the palette`,
    );
  }

  /* The surfaces still on legacy aliases keep their explicit light colours,
     because those do inherit and a missing one is invisible until someone
     switches theme. */
  assert.match(css, /\[data-theme="light"\] \.rs \{/);
  for (const selector of [".rs-chip-v", ".rs-tag", ".rs-skip"]) {
    assert.ok(
      css.includes(`[data-theme="light"] ${selector}`),
      `${selector} has no light-theme colour and would inherit a dark one`,
    );
  }

  /* Semantic colour keeps its meaning in light and only changes its darkness.
     Since the token unification (RYN-UI-SYSTEM-001, spec §4) that darkening
     comes from the root `-strong` tokens: the shell aliases into them instead
     of restating hex literals, so the chrome and the canvas can never disagree
     about what light-cyan is. A literal here would fork the palette again. */
  const light = css.slice(css.indexOf('[data-theme="light"] .rs {'));
  assert.match(light, /--cyan: var\(--accent-strong\)/, "--cyan must alias the AA-safe root token");
  assert.match(light, /--mint: var\(--success-strong\)/, "--mint must alias the AA-safe root token");
  assert.match(light, /--amber: var\(--warning-strong\)/, "--amber must alias the AA-safe root token");
  for (const token of ["--cyan", "--mint", "--violet", "--amber", "--red", "--fg", "--ink"]) {
    assert.doesNotMatch(
      light,
      new RegExp(`${token}: #`),
      `${token} must not restate a literal in the shell — the root tokens own the palette`,
    );
  }

  /* The shared status chip also crosses this theme boundary. Risk foregrounds
     use the semantic roles whose light branch carries measured AA-safe inks;
     descriptor chips use the existing theme-aware neutral pair. This prevents
     a dark descriptor fill or a pale amber verdict surviving on Mist without
     introducing a second palette inside the component. */
  /* These rules moved out of `hub.css` into `status-chip.css`, which the chip
     component imports, so they now reach a surface that renders the chip
     without loading a hub stylesheet. The theme contract they carry is
     unchanged; only their address is, and this test follows the rule rather
     than the file. */
  const chip = read("app/shell/status-chip.css");
  assert.match(
    chip,
    /\.rs-status\[data-family="risk"\]\[data-tone="verified"\][\s\S]*?color: var\(--rt-reconciled-green-fg\)/,
  );
  assert.match(
    chip,
    /\.rs-status\[data-family="risk"\]\[data-tone="caution"\][\s\S]*?color: var\(--rt-review-amber-fg\)/,
  );
  assert.match(
    chip,
    /\.rs-status\[data-family="risk"\]\[data-tone="high"\][\s\S]*?color: var\(--rt-blocked-red-fg\)/,
  );
  assert.match(
    chip,
    /\.rs-status\[data-family="descriptor"\][\s\S]*?background: var\(--ry-st-paper-bg\)[\s\S]*?color: var\(--ry-st-paper-tx\)/,
  );
  assert.ok(
    read("app/shell/status-chip.tsx").includes('import "./status-chip.css"'),
    "the chip must import its own rules, or a surface outside a hub renders it as bare text",
  );
});

test("cabinet content keeps a readable column in a wide canvas", () => {
  /*
   * `.cb-grid` was written for a centred two-column page. In a 1600px canvas a
   * 320px minimum produced five columns, and the settings form — four cards,
   * none of them spanning — was squeezed into a 300px strip with a thousand
   * pixels of nothing beside it.
   */
  const css = read("app/shell/shell.css");
  assert.match(css, /\.rs-canvas \.cb-grid \{[\s\S]*?minmax\(min\(420px, 100%\), 1fr\)/);

  // And the terminals still stretch, which is what the removed wrapper did.
  assert.match(css, /\.rs-canvas > \.dm-root/);
  assert.match(css, /flex: 1; min-height: 0;/);
});

test("a workspace's own tools are added to the shared cluster, never a replacement for it", () => {
  /*
   * The drift the founder saw with both workspaces open side by side.
   *
   * `tools` was applied as `tools ?? (…default…)`, so any workspace supplying
   * its own controls silently lost every shared one. One hub supplied Search and
   * Attention and therefore had no Layout menu, no theme control and no focus
   * mode anywhere in its chrome; the Stellar Hub supplied none and had all
   * three. Two workspaces on one shell with different capabilities, and neither
   * had chosen that.
   *
   * Shell v2 resolves it in the other direction for two of the three: the theme
   * icon, the layout menu and the focus toggle are not top-bar controls at all
   * any more, so there is nothing left to inherit unevenly.
   */
  const shell = code("app/shell/app-shell.tsx");

  assert.doesNotMatch(
    shell,
    /\{\s*tools\s*\?\?/,
    "`tools` must be additive. A workspace that supplies its own controls must not lose the shared ones.",
  );
  assert.match(shell, /\{tools\}/, "the workspace tools must render inside the cluster");

  /* The frozen UX System names three controls the primary top bar does not
     carry. None of them may come back to it. */
  const barAt = shell.indexOf('<div className="rs-tools">');
  const barEnd = shell.indexOf("</header>", barAt);
  assert.ok(barAt > 0 && barEnd > barAt);
  const bar = shell.slice(barAt, barEnd);
  for (const banned of [/ThemeToggle/, /CustomizeMenu/]) {
    assert.doesNotMatch(bar, banned, `the primary top bar must not carry ${banned}`);
  }

  /* The connection control is last in the cluster, on every workspace, because
     the shell renders it after `tools` rather than letting a workspace place
     it. */
  assert.ok(
    bar.indexOf("{tools}") < bar.indexOf("{account}"),
    "the connection control must render after the workspace tools",
  );

  /* And the customization did not vanish — it moved to the rail, beside the
     layout it changes. */
  assert.match(shell, /function ViewMenu\(\{\s*modeInContext,\s*extras,/);
  assert.match(shell, /<ViewMenu modeInContext=\{modeInContext\} extras=\{viewExtras\} \/>/);
  assert.match(shell, /<CustomizeMenu showMode=\{!modeInContext\} \/>/);

  /* Focus mode was the rail's second control and is gone. Appearance left with
     it on 2026-08-19 — one global theme, one home in `Settings → Appearance` —
     and the founder put a control back in this slot on 2026-08-24, beside the
     language button at the foot of the rail. `PRODUCT.md` had said so all
     along: dark/light and the language are compact one-click controls in the
     lower rail beside a hub's Map.

     The rule that emptied the slot is not weakened, because the rule was never
     "one control" — it was **one writer**. `app/app/theme.ts` still is that
     writer; `ThemeToggle` reads it and watches `<html data-theme>`, so it holds
     no second copy of the value and cannot drift from the settings page. The
     assertions below are what keep the difference honest: the toggle writes
     through the shared helper, the layout menu still writes no appearance, the
     cabinet footer still holds none of its own, and Appearance stays reachable
     without an account. */
  assert.match(shell, /<ThemeToggle \/>/, "the rail carries the one theme control");
  assert.match(
    read("app/shell/theme-toggle.tsx"),
    /from "@\/app\/app\/theme"/,
    "the rail control must write through the shared theme helper, never its own key",
  );
  assert.doesNotMatch(
    read("app/shell/theme-toggle.tsx"),
    /localStorage/,
    "the rail control reads and writes the preference only through `app/app/theme.ts`",
  );
  assert.match(
    read("app/shell/theme-toggle.tsx"),
    /const ORDER: readonly ThemePref\[\] = \["dark", "light"\]/,
    "the theme control is Dark and Light, never System",
  );
  assert.doesNotMatch(
    read("app/app/settings/appearance.tsx"),
    /pref: "system"/,
    "Appearance offers Dark and Light, never System",
  );
  /* Matched on code shapes, not on the word: the prose in `customize.tsx`
     explains why appearance left, and a bare /Appearance/ matched that
     explanation. A regex over source matches comments — this repository has
     been caught by that before. */
  assert.doesNotMatch(read("app/shell/customize.tsx"), /applyThemePref|aria-label="Appearance"/,
    "the layout menu writes layout, never appearance");
  assert.doesNotMatch(read("app/app/nav.tsx"), /ThemeSwitch|applyThemePref/,
    "the cabinet rail footer writes no theme");

  /* Settings has one persistent destination in the product rail: the menu's
     foot (canon v5.4 В30), from the registry — and the wallet's menu opens the
     same address. */
  assert.match(read("app/shell/domains.ts"), /settings: \{ label: SECONDARY_LABELS\.settings, href: "\/app\/settings"/);
  assert.match(code("app/shell/app-shell.tsx"), /const settingsEntry: NavEntry \| null \| undefined = menu/);
  assert.match(read("app/app/product-shell.tsx"), /settingsHref="\/app\/settings"/);
  const settingsPage = read("app/app/settings/page.tsx");
  assert.equal((settingsPage.match(/<ProductSettings\b/g) ?? []).length, 1);
  assert.doesNotMatch(settingsPage, /\bredirect\(|if\s*\(\s*!session/);
  const settings = code("app/app/settings/product-settings.tsx");
  assert.match(settings, /aria-labelledby="appearance-title"/);
  assert.match(settings, /applyThemePref\(value\)/);
  assert.match(settings, /\["dark",\s*"light"\]/);
  assert.doesNotMatch(settings, /localStorage/);

  assert.doesNotMatch(shell, /Focus mode/);
  assert.doesNotMatch(shell, /rs-view-focus/);
  assert.doesNotMatch(read("app/shell/shell-state.tsx"), /setFocus/);
  assert.doesNotMatch(read("app/shell/shell.css"), /data-focus="true"\]\s*\{/);
});

test("hub workspaces render the same navigation footer, from the same rules", () => {
  /*
   * The Stellar Hub's footer was a bare text link while another hub's was a
   * 44px button with a border, a radius and an arrow — two implementations of
   * one piece of chrome, and the second one quietly worse. The rules live in the
   * shared stylesheet now, so a change to one is a change to both; each hub
   * asserts its own footer beside it.
   */
  const shared = read("app/shell/shell.css");
  /* `.hub-nav-mode-mobile` was in this list and is retired: it positioned a
     phone-only copy of the depth switch, and the depth switch now has one home
     on every width — the layout menu at the foot of the rail. */
  for (const rule of [".hub-nav-footer", ".hub-nav-map"]) {
    assert.ok(shared.includes(rule), `${rule} must live in the shared shell stylesheet`);
  }

  const stellar = code("app/stellar/workspace/hub/shell.tsx");
  assert.match(stellar, /className="hub-nav-footer"/, "Stellar's footer is not the shared one");
  /* Stellar keeps the single shared Map button until it has technical
     surfaces to group. */
  assert.match(stellar, /className="hub-nav-map"/, "Stellar's Hub Map is not the shared button");

  /* The workspace stylesheet must not redefine what the shell now owns —
     that is how two copies come back. */
  const stellarCss = read("app/stellar/workspace/hub/hub.css");
  assert.doesNotMatch(stellarCss, /^\.hub-nav-map \{/m, "Stellar redefines .hub-nav-map locally");
  assert.doesNotMatch(stellarCss, /^\.hub-nav-footer[ ,{]/m, "Stellar redefines .hub-nav-footer locally");
});

test("only a workspace with a catalog renders a language control", () => {
  /* A toggle with one option is a control that lies about what it does. The
     Stellar Hub is English-only by decision, so it renders none — and the theme
     control it does render is the shared one, not a second copy. */
  const stellar = code("app/stellar/workspace/hub/shell.tsx");
  assert.doesNotMatch(stellar, /hub-quick-toggle/, "Stellar must not render a quick preference toggle");
  assert.doesNotMatch(stellar, /setLocale|Translate/, "Stellar has no locale catalog and must not imply one");
});

test("a workspace and the direction it opens are one record, not two", () => {
  /*
   * The defect `RYN-RHC-002` closed. `robinhood-chain` existed twice — as a
   * chain in `lib/product/ecosystems.ts` and as a desk called
   * `tokenized-markets` in the switcher — with a third record, a hand-written
   * `Record` on the Workspace Map, deciding which one had a door. Three places
   * could disagree and nothing failed when they did.
   *
   * The relationship is declared once now, by the workspace, in that direction
   * on purpose: a listed direction must never be able to give itself a door.
   */
  const registered = new Set(ECOSYSTEMS.map((entry) => entry.id));
  const claimedBy = new Map();
  for (const workspace of WORKSPACES) {
    for (const direction of workspace.opens ?? []) {
      assert.ok(
        registered.has(direction),
        `${workspace.id} opens "${direction}", which no manifest row registers`,
      );
      assert.ok(
        !claimedBy.has(direction),
        `${direction} is opened by both ${claimedBy.get(direction)} and ${workspace.id}`,
      );
      claimedBy.set(direction, workspace.id);
    }
  }

  /* An ecosystem pack is the workspace *for* a network, so it names one, and
     it names a chain rather than a venue: a workspace whose first direction is
     a venue adapter is a desk that has been filed under ECOSYSTEMS, which is
     the exact move this registry refused before and still refuses. */
  for (const workspace of WORKSPACES.filter((entry) => entry.kind === "ecosystem_pack")) {
    const [settles] = workspace.opens ?? [];
    assert.ok(settles, `${workspace.id} is an ecosystem pack that opens no direction`);
    assert.equal(
      ecosystemById(settles)?.kind,
      "chain_pack",
      `${workspace.id} must open a chain before any venue on it`,
    );
  }

  // The fact this packet established, stated as itself.
  const chain = workspaceById("robinhood-chain");
  assert.equal(chain.kind, "ecosystem_pack");
  assert.equal(chain.name, "Robinhood Chain");
  assert.equal(chain.subtitle, "Stocks, crypto, RWAs & onchain markets");
  assert.equal(chain.opens[0], "robinhood-chain", "the workspace and the manifest row share one id");
  assert.equal(ecosystemById("robinhood-chain").kind, "chain_pack");
  assert.equal(
    workspaceById("tokenized-markets"),
    undefined,
    "the old id must not survive as a second row beside the new one",
  );

  /* And the map takes its doors from the registry rather than keeping a third
     copy. The literal that used to sit there is what this forbids. */
  const map = code("app/workspaces/page.tsx");
  assert.match(map, /const OPENS_IN[\s\S]{0,400}workspace\.opens/, "the map must derive its doors");
  /* And nothing may sit beside the derivation topping it up by hand, which is
     how a derived map grows a second half nobody notices. */
  assert.doesNotMatch(map, /"arcus-spot":/, "the door map must not be written out by hand again");
});

test("a workspace's name is registry data and cabinet copy never spells it out", () => {
  /*
   * The same defect one file over, and it had already shipped twice: Home's
   * workspace cards kept a hub's old name after the switcher renamed it, and
   * `Tokenized Markets` after the desk became Robinhood Chain.
   * Nothing failed either time, because a name repeated in three locales is
   * copy as far as every check is concerned.
   */
  const cabinet = code("app/app/copy.ts");
  for (const workspace of WORKSPACES) {
    assert.ok(
      !cabinet.includes(`"${workspace.name}"`),
      `cabinet copy spells out the workspace name "${workspace.name}"; read it from the registry`,
    );
  }

  // Both surfaces that name a workspace resolve it, and resolve its href with it.
  for (const path of ["app/app/overview/panels.tsx"]) {
    const source = code(path);
    assert.match(source, /requireWorkspace\("/, `${path} must resolve the workspace it names`);
    for (const workspace of WORKSPACES) {
      assert.ok(!source.includes(`href="${workspace.href}"`), `${path} must take the destination from the registry too`);
    }
  }
  /* The product root has no page of its own since canon 9.1 folded Home into
     Portfolio; the overview it opens on is checked instead. */
  for (const workspace of WORKSPACES) {
    assert.ok(!code("app/solana/workspace/holdings/holdings-card.tsx").includes(`href="${workspace.href}"`));
  }
});

test("renaming a workspace id migrates its layout preferences instead of resetting them", () => {
  /*
   * The rule is stated in as many words — *a display name is copy; an id is a
   * migration* — and a hub's row keeps a stale id rather than risk this. `RYN-RHC-002` changed one id, so the migration had
   * to be real: the store is keyed by workspace id, the schema shape did not
   * change so the version cannot move, and without a rename map every Pro
   * mode, panel order and hidden widget set on that desk silently reverts.
   */
  const migrated = parseLayout({
    version: LAYOUT_SCHEMA_VERSION,
    byWorkspace: {
      "tokenized-markets": { mode: "pro", hidden: ["pulse"], navCollapsed: true },
    },
  }).byWorkspace;
  assert.equal(migrated["tokenized-markets"], undefined, "the old id must not survive the read");
  assert.ok(
    migrated["robinhood-chain"],
    "the rename must carry the preferences to the new id rather than dropping them",
  );
  assert.equal(migrated["robinhood-chain"].mode, "pro");
  assert.deepEqual(migrated["robinhood-chain"].hidden, ["pulse"]);
  assert.equal(migrated["robinhood-chain"].navCollapsed, true);

  /* A record already stored under the new id wins, and the old one is dropped
     rather than merged: it is the older of the two by construction, and
     merging two preference sets invents a third nobody chose. */
  const both = parseLayout({
    version: LAYOUT_SCHEMA_VERSION,
    byWorkspace: { "tokenized-markets": { mode: "pro" }, "robinhood-chain": { mode: "guided" } },
  }).byWorkspace;
  assert.equal(both["robinhood-chain"].mode, "guided");
  assert.equal(both["tokenized-markets"], undefined);

  /* Every rename names a workspace that is gone and one that is registered.
     A map entry pointing at nothing would migrate preferences into a key no
     shell ever reads, which is a reset wearing a migration's clothes. */
  for (const [from, to] of Object.entries(RENAMED_WORKSPACES)) {
    assert.equal(workspaceById(from), undefined, `${from} is listed as renamed and is still registered`);
    assert.ok(workspaceById(to), `${from} renames to ${to}, which is not a registered workspace`);
  }
});

test("«Простий» opens first for every person and guest; only a press chooses «Профі» (canon v5.0 §0.0 rule 9)", () => {
  /* The Owner's decision of 2026-09-23, recorded by RYN-SURFACE-CLEAN-001:
     Simple by default everywhere. Until then the product shell (`ryntra`)
     flipped an un-chosen Simple into Pro and the switch promoted `standard`
     to a *chosen* Pro, so a first visit landed in «Профі». */
  const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const state = code("./shell-state.tsx");
  assert.doesNotMatch(state, /mode: "pro"/, "the shell writes Pro for somebody who never chose it");
  assert.doesNotMatch(state, /GUIDED_FIRST_WORKSPACES/, "Simple-first is for every workspace, not a list of some");
  assert.match(state, /if \(!oneVersion && !stored\.depthChosen && stored\.mode !== "guided"\)/, "an un-chosen depth opens Simple");
  /* And the product has no depth at all since canon v5.3 (В28): it reads its
     one version whatever is stored, choosing a mode does nothing there, and
     nothing writes a depth cookie any more. */
  assert.match(state, /prefs: oneVersion \? \{ \.\.\.prefs, mode: ONE_VERSION \} : prefs/);
  assert.match(state, /if \(oneVersion\) return;/);
  assert.doesNotMatch(state, /document\.cookie|DEPTH_COOKIE|router\.refresh/);
  const depth = code("./depth-switch.tsx");
  assert.doesNotMatch(depth, /useEffect|setMode\("pro"\)/, "the switch presses itself");
  const first = defaultPrefs();
  assert.equal(first.mode, "guided");
  assert.equal(first.depthChosen, false);
});
