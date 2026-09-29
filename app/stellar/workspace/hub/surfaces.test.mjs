import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { navigationFromManifest, settingsEntry, RAIL_MODULE_IDS } from "../../../shell/modules.ts";
import { STELLAR_MANIFEST as MANIFEST } from "./manifest.ts";
import { STELLAR_MODULES as REGISTRY } from "./modules.ts";
const BASE_ROUTE = "/stellar/workspace";

/**
 * The enforcement matrix of `docs/archive/design-pre-reset-2026-08-18/stellar-DESIGN.md` §8, as tests.
 *
 * The contract listed twelve gates and shipped none of them, which is how a
 * document that says "a design regression is a release blocker" ends up
 * blocking nothing. Each test below names the row it enforces.
 *
 * Rows 8, 9 and 11 — rendered geometry, contrast and screenshot evidence — are
 * deliberately absent. They need a browser, and a test that pretends to measure
 * a rendered box from source would be worse than an honest gap: it would report
 * green on exactly the class of defect that reached the founder. They stay
 * live-measurement obligations on the task card.
 */

const WORKSPACE = join("app", "stellar", "workspace");

function walk(dir, match, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, found);
    else if (match(entry)) found.push(path);
  }
  return found;
}

/* Every surface component, not only `page.tsx`: the Overview's panels live in
   `overview.tsx` because the page is a server component doing the reads, and a
   sweep that only looked at page files would miss the largest one. */
const COMPONENTS = walk(WORKSPACE, (name) => name.endsWith(".tsx"));

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** Comments are prose about the code, never the code. Every check strips them. */
const stripJs = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const stripCss = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

// ---------------------------------------------------------------- row 1 --

test("§8.1 every railed module has a page that exists", async () => {
  const registry = read(join(WORKSPACE, "hub", "modules.ts"));

  /* The registry throws at construction for a railed module with no route.
     That covers the null case; what it cannot see is a route string pointing at
     a directory nobody created, which renders as a 404 from the navigation
     rail — the single most expensive mistake this file can make. */
  const routes = [...registry.matchAll(/route:\s*(?:`\$\{BASE\}([^`]*)`|BASE\b)/g)].map(
    ([, suffix]) => suffix ?? "",
  );
  assert.ok(routes.length >= 4, `Expected several railed routes, parsed ${routes.length}.`);

  for (const suffix of routes) {
    const expected = suffix === "" ? join(WORKSPACE, "page.tsx") : join(WORKSPACE, ...suffix.split("/").filter(Boolean), "page.tsx");
    assert.ok(existsSync(expected), `A railed module points at /stellar/workspace${suffix}, but ${expected} does not exist.`);
  }
});

test("the rail is the manifest, and every entry it renders is a real route", () => {
  /*
   * Two facts that can disagree silently. Before Shell v2 they were the
   * registry's `guided` flag and a separate ordered list in the shell, and the
   * Stellar Hub proved they drift — a Guided-marked module that never reached
   * the rail produced no error and no entry.
   *
   * The manifest removes the second list: `navigationFromManifest` projects
   * one declaration, ordered by `MODULE_IDS` rather than by how the manifest
   * happens to be written, so a workspace cannot reorder the skeleton or
   * invent a place in it. What is still worth asserting is the other half of
   * the old drift — that nothing in the rail points at a route that does not
   * exist.
   */
  const simple = navigationFromManifest(MANIFEST, "simple");
  const pro = navigationFromManifest(MANIFEST, "pro");

  const railIds = simple.flatMap((group) => group.entries.map((entry) => entry.id));
  assert.deepEqual(
    railIds,
    RAIL_MODULE_IDS.filter((id) => MANIFEST.modules.some((module) => module.id === id)),
    "Simple renders the manifest's rail modules, in the skeleton's fixed order.",
  );

  /* Settings is pinned bottom-left by the shell and must never appear inline —
     the one position the frozen UX System fixes by name. */
  assert.ok(!railIds.includes("settings"), "Settings must not render inside the rail groups.");
  assert.ok(settingsEntry(MANIFEST), "The workspace must declare a Settings destination.");

  /* Pro reveals the surfaces inside each module and reveals nothing else. */
  const proIds = pro.flatMap((group) => group.entries.map((entry) => entry.id));
  for (const id of railIds) assert.ok(proIds.includes(id), `Pro dropped the ${id} module.`);

  /* Every href the rail offers is a route the registry actually declares, and
     every entry without one carries the exact condition that unblocks it. */
  /* Read from the registry module itself rather than from its source text: a
     parser sees the template literal, and the thing worth asserting is the
     resolved route the rail will actually link to. */
  const routes = new Set(REGISTRY.map((entry) => entry.route).filter(Boolean));
  for (const group of pro) {
    for (const entry of group.entries) {
      if (entry.href === null) {
        assert.ok(entry.gate, `${entry.id} is disabled and states no gate.`);
        continue;
      }
      assert.ok(
        routes.has(entry.href) || entry.href === BASE_ROUTE,
        `${entry.id} points at ${entry.href}, which the registry does not declare.`,
      );
    }
  }

  assert.ok(railIds.length <= 5, `The skeleton is at most five modules; the rail has ${railIds.length}.`);
});

/**
 * The registry, parsed once.
 *
 * These tests read the source rather than importing it, because the suite runs
 * under `node --test` with no TypeScript step. The shape is stable — every entry
 * is a `railed({…})` or `mapped({…})` call at one indent — and a parse that
 * stops matching fails loudly below rather than silently checking nothing.
 */
function parseRegistry() {
  const source = read(join(WORKSPACE, "hub", "modules.ts"));
  const body = source.slice(source.indexOf("export const STELLAR_MODULES"));
  const entries = [];
  for (const [, kind, fields] of body.matchAll(/\n {2}(railed|mapped)\(\{\n([\s\S]*?)\n {2}\}\),/g)) {
    const field = (name) => {
      const match = fields.match(
        new RegExp(`(?:^|\\n)\\s*${name}:\\s*(?:"([^"]*)"|\`([^\`]*)\`|(BASE)\\b|([A-Z_]+)|(null))`),
      );
      if (!match) return null;
      const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? null;
      /* `route: BASE` is the Overview and `route: ${BASE}/x` is everything else.
         Both are normalised to the suffix the §8.1 route check already uses. */
      return value === "BASE" ? "" : value === null ? null : value.replace("${BASE}", "");
    };
    entries.push({
      kind,
      id: field("id"),
      group: field("group"),
      route: field("route"),
      environment: field("environment"),
      mode: field("mode"),
      maturity: field("maturity"),
      lastVerifiedAt: field("lastVerifiedAt"),
      guided: /\n\s+guided:\s*true/.test(fields),
    });
  }
  return entries;
}

test("the registry parses, and every module carries all four independent facts", () => {
  const modules = parseRegistry();
  assert.ok(modules.length >= 40, `Expected the full Hub Map, parsed ${modules.length} modules.`);

  const ids = modules.map((entry) => entry.id);
  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
    "Two modules share an id.",
  );

  for (const entry of modules) {
    for (const field of ["group", "environment", "mode", "maturity"]) {
      assert.ok(entry[field], `Module "${entry.id}" declares no ${field}.`);
    }
  }
});

test("one capability is registered once, and the lifecycle is called Send", () => {
  /*
   * The registry described the payment lifecycle **twice**: a built `authorize`
   * marked AVAILABLE, and a future `send` marked GATED — one capability, two
   * records, two contradictory states, and a rail entry named after a stage of
   * the lifecycle rather than the job somebody came to do.
   *
   * A second record for something that exists is worse than a missing one: it
   * reads as a promise beside the delivery.
   */
  const modules = parseRegistry();
  const byId = new Map(modules.map((entry) => [entry.id, entry]));

  assert.equal(byId.has("authorize"), false, "`authorize` is back in the registry. The module is `send`.");

  const send = byId.get("send");
  assert.ok(send, "The Send module is missing from the registry.");
  assert.equal(send.kind, "railed", "Send is mapped rather than railed, but its page exists.");
  assert.equal(send.route, "/send", "Send no longer points at /stellar/workspace/send.");
});

test("a railed module states when it was last true, and only a proven one is TESTNET VERIFIED", () => {
  const modules = parseRegistry();

  for (const entry of modules.filter((module) => module.kind === "railed")) {
    assert.ok(
      entry.lastVerifiedAt && entry.lastVerifiedAt !== "null",
      `"${entry.id}" is in the rail with no lastVerifiedAt — a page nobody checked, described as though somebody had.`,
    );
  }

  for (const entry of modules.filter((module) => module.maturity === "TESTNET_VERIFIED")) {
    assert.equal(
      entry.environment,
      "TESTNET_ACTION",
      `"${entry.id}" claims TESTNET VERIFIED outside the testnet environment.`,
    );
    assert.ok(
      entry.lastVerifiedAt && entry.lastVerifiedAt !== "null",
      `"${entry.id}" claims TESTNET VERIFIED and names no date it was verified.`,
    );
  }
});

test("no surface labels the whole workspace mainnet read-only", () => {
  /*
   * It did, for two releases after it stopped being true: the Overview's chip
   * said `Mainnet · read-only` and its info control said *"nothing here moves
   * value — there are no keys and no signing"*, on a product whose Send page had
   * already put an owner-signed transaction on a ledger and reconciled it.
   *
   * The claim is not deleted — it is correct per page, resolved from that page's
   * own module record. What must never come back is one label for two
   * environments.
   */
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    assert.doesNotMatch(
      source,
      /Mainnet\s*·\s*read-only/i,
      `${path} labels a surface "Mainnet · read-only". This workspace reads mainnet AND signs on testnet;\n` +
        `the environment belongs to a page, resolved from its module record, never to the workspace.`,
    );
    assert.doesNotMatch(
      source,
      /there are no keys and no signing/i,
      `${path} claims this workspace cannot sign. The Send surface signs on Stellar Testnet, in your own wallet.`,
    );
  }
});

test("every internal Stellar destination in the markup resolves to a mounted route", () => {
  /*
   * The rename is the reason this exists. A registry `route` is checked by
   * §8.1; a hand-written `href` in a panel footer is not, and one of those is
   * how `/stellar/asset/{CODE:ISSUER}` reached four documents and a form
   * without ever being served.
   */
  const dead = [];
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    for (const [, href] of source.matchAll(/href="(\/stellar\/workspace[^"{}]*)"/g)) {
      const suffix = href.replace("/stellar/workspace", "");
      const expected =
        suffix === ""
          ? join(WORKSPACE, "page.tsx")
          : join(WORKSPACE, ...suffix.split("/").filter(Boolean), "page.tsx");
      if (!existsSync(expected)) dead.push(`${href} — linked from ${path}`);
    }
  }
  assert.deepEqual(dead, [], `These destinations are linked and not mounted:\n${dead.join("\n")}`);
});

// ---------------------------------------------------------------- row 3 --

test("§8.3 five evidence states, and no composite score anywhere", () => {
  /* The vocabulary moved to the chain-neutral envelope on 2026-09-14 (the
     public projection); `lib/stellar/evidence.ts` re-exports it. */
  const evidence = stripJs(read(join("lib", "evidence", "envelope.ts")));

  const declared = [...evidence.matchAll(/"([A-Z]+)"/g)].map(([, value]) => value);
  for (const state of ["FRESH", "STALE", "CONFLICTING", "UNKNOWN", "UNAVAILABLE"]) {
    assert.ok(declared.includes(state), `${state} is missing from the evidence vocabulary.`);
  }

  /* The union is derived from the array, so the array is the vocabulary. Five,
     and the type cannot disagree with it. */
  const list = evidence.match(/EVIDENCE_STATES\s*=\s*\[([^\]]+)\]/);
  assert.ok(list, "EVIDENCE_STATES is not an array literal, so the type can no longer be derived from it.");
  assert.equal(list[1].split(",").filter((entry) => entry.trim()).length, 5);

  /* No composite score. Five states across many fields is the honest shape; one
     number is a lie with a progress bar. The comment strip matters here — the
     sentence explaining why there is no score contains the word. */
  for (const path of [...COMPONENTS, join("lib", "stellar", "passport.ts")]) {
    const source = stripJs(read(path));
    assert.doesNotMatch(
      source,
      /\b(safetyScore|riskScore|trustScore|score\s*[:=]\s*\d)/,
      `${path} computes a score. There is no composite score on this product.`,
    );
  }
});

// ---------------------------------------------------------------- row 4 --

test("§8.4 no surface prints its explanation permanently", () => {
  /*
   * The rule, stated exactly: a paragraph on a workspace page is either the
   * explanation — in which case it belongs inside the info control — or it is
   * evidence speaking for itself: the reason a read failed, an empty state, or
   * a caveat that qualifies a value on screen.
   *
   * Measured on the live pages before this test existed, the Stellar routes
   * carried 9,366 characters of permanent prose, 1,338 per route, against an
   * earlier hub's post-sweep 130. The budget is not a character count here but
   * the shape that produced it: a `<p>` outside the control, with no evidence to
   * point at.
   */
  const ALLOWED = ["styles.absent", "styles.declared", "rw-lead", "rw-note", "st-note"];

  /* `PageHead` puts its `lead` inside the control — asserted below — so a
     paragraph written there is already behind the icon. Cutting it needs
     balanced braces rather than a regex: the value is JSX and contains both
     `{` and `/>`, either of which ends a naive match in the wrong place. */
  function withoutLeadProp(source) {
    let out = "";
    let index = 0;
    for (;;) {
      const start = source.indexOf("lead={", index);
      if (start === -1) return out + source.slice(index);
      out += source.slice(index, start);
      let depth = 0;
      let cursor = start + "lead=".length;
      for (; cursor < source.length; cursor += 1) {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      index = cursor + 1;
    }
  }

  for (const path of COMPONENTS) {
    const source = stripJs(read(path));

    /* Everything inside an info control is exempt — that is where explanation
       is supposed to live. */
    const outside = withoutLeadProp(source.replace(/<InfoControl[\s\S]*?<\/InfoControl>/g, ""));

    const paragraphs = [...outside.matchAll(/<p\b([^>]*)>/g)].map(([, attrs]) => attrs);
    for (const attrs of paragraphs) {
      const permitted = ALLOWED.some((marker) => attrs.includes(marker));
      assert.ok(
        permitted,
        `${path} renders a permanent <p${attrs}> outside an InfoControl.\n` +
          `An explanation written for the first visit and rendered on every visit forever is what makes a\n` +
          `workspace read as documentation with controls attached. Move it into the info control, or give it\n` +
          `one of the evidence classes: ${ALLOWED.join(", ")}.`,
      );
    }
  }
});

test("§8.4 PageHead really does put its lead behind the control", () => {
  /* The test above exempts `lead={…}` on the grounds that PageHead hides it.
     If that ever stopped being true, the exemption would turn into a hole big
     enough to drive every paragraph on the workspace through. */
  const parts = stripJs(read(join(WORKSPACE, "hub", "parts.tsx")));
  assert.match(
    parts,
    /lead \?\s*\(\s*<InfoControl[\s\S]*?\{[\s\S]*?lead[\s\S]*?\}[\s\S]*?<\/InfoControl>/,
    "PageHead no longer renders `lead` inside an InfoControl, so the prose gate's exemption is unsound.",
  );
  /* Inside the control, `<p>{lead}</p>` is exactly right — it is a paragraph in
     a popover. What must never exist is a render of `lead` outside it, so the
     check is on the remainder rather than on the shape. */
  const outsideControl = parts.replace(/<InfoControl[\s\S]*?<\/InfoControl>/g, "");
  assert.doesNotMatch(
    outsideControl,
    /\{\s*lead\s*\}/,
    "PageHead renders `lead` outside the info control. That is the permanent-explanation shape this gate exists to stop.",
  );
});

// ---------------------------------------------------------------- row 5 --

test("§8.5 a read that fails renders its reason, never a blank", () => {
  /*
   * The honest half of row 5.
   *
   * `isResolved(x) && <Thing/>` renders **nothing** when the read fails: no
   * value, no reason, no gap a reader would notice — the surface simply looks
   * as though that fact does not exist. It is the single most dangerous
   * shorthand on an evidence product, and it is one character away from the
   * ternary that does the right thing.
   *
   * So every evidence guard must be a ternary, and every surface that reads
   * evidence must render a reason somewhere. What this does **not** prove is
   * that a loading or stale state was designed — those need a route-level
   * fixture harness, which row 5 still owes.
   */
  const evidenceSurfaces = COMPONENTS.filter((path) => stripJs(read(path)).includes("isResolved"));
  assert.ok(evidenceSurfaces.length >= 3, `Expected several evidence surfaces, found ${evidenceSurfaces.length}.`);

  for (const path of evidenceSurfaces) {
    const source = stripJs(read(path));

    /*
     * Both forms, because the first version of this test only caught one.
     *
     * Inline — `{isResolved(x) && <Thing/>}` — is the obvious shape. The common
     * one is a named boolean: `const pulseOk = isResolved(pulse)` and then
     * `{pulseOk && (…)}`. Probing this gate by rewriting exactly that ternary
     * into a short-circuit produced no failure at all, which is how a gate ends
     * up decorative.
     *
     * `pulseOk && pulse.state === "FRESH" ? … : …` in a prop is fine — that is
     * boolean logic, not a render. Only a JSX render position is flagged, which
     * is why the pattern requires `{name && ` followed by `(` or `<`.
     */
    const shortCircuits = [...source.matchAll(/isResolved\([^)]*\)\s*&&/g)].map(() => "inline isResolved(…) &&");

    for (const [, name] of source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*isResolved\(/g)) {
      const rendered = new RegExp(`\\{\\s*${name}\\s*&&\\s*[(<]`, "g");
      for (const _ of source.matchAll(rendered)) shortCircuits.push(`{${name} && …}`);
    }

    assert.deepEqual(
      shortCircuits,
      [],
      `${path} guards a render with \`&&\`: ${shortCircuits.join(", ")}\n` +
        `When the read fails that renders nothing at all — no value and no reason, just a surface that\n` +
        `looks as though the fact does not exist. Use a ternary whose other branch says why.`,
    );

    assert.match(
      source,
      /\.reason|EmptyState|AlertStrip/,
      `${path} reads evidence and never renders a failure reason, so a failed read has nowhere to appear.`,
    );
  }
});

test("§8.5 the negative scenario is on the surface, not only in the fixtures", () => {
  /*
   * On Stellar the negative case *is* the product. A destination without a
   * trustline, a revoked authorization, a clawback-enabled asset: these are the
   * screens that justify the workspace, and they are the ones a demo skips.
   *
   * The Overview and the Passport must both be able to say a power is held —
   * not merely have a column for it.
   */
  const overview = stripJs(read(join(WORKSPACE, "overview.tsx")));
  assert.match(overview, /clawbackEnabled/, "The Overview cannot report clawback.");
  assert.match(overview, /authRevocable/, "The Overview cannot report a freezable holding.");
  assert.match(
    overview,
    /data-held=\{?[^}]*yes/,
    "The Overview has no rendered state for a power the issuer actually holds.",
  );

  const passport = stripJs(read(join(WORKSPACE, "assets", "[asset]", "page.tsx")));
  for (const power of ["authRequired", "authRevocable", "clawbackEnabled"]) {
    assert.match(passport, new RegExp(power), `The Passport does not read ${power}.`);
  }
  assert.match(
    passport,
    /clawback can remove the asset/,
    "The Passport states no consequence for clawback, only its flag.",
  );
});

// ---------------------------------------------------------------- row 6 --

test("§8.6 every class used in markup resolves to a rule", () => {
  /*
   * `.tally` fell back to `display: block` on an earlier hub and produced a 173px
   * column inside a 224px sticky toolbar. A class with no rule is invisible to
   * every source-level check and obvious on screen.
   */
  const sheets = [
    join(WORKSPACE, "hub", "hub.css"),
    /* The hub-generic chrome — `sh-mode`, `sh-map-*`, `sh-state` — lives in
       the shared sheet since the Solana Hub became its second consumer, and
       it loads on every workspace through the app shell's own import. */
    join("app", "shell", "hub.css"),
    join("app", "shell", "panel.css"),
    join("app", "shell", "shell.css"),
    join("app", "globals.css"),
  ];
  const defined = new Set();
  for (const sheet of sheets) {
    for (const [, name] of stripCss(read(sheet)).matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) defined.add(name);
  }

  const missing = [];
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    /* Only plain string classNames. `styles.x` is a CSS module, checked by the
       compiler-adjacent test below rather than by name here. */
    for (const [, value] of source.matchAll(/className="([^"{}]+)"/g)) {
      for (const name of value.split(/\s+/).filter(Boolean)) {
        if (!defined.has(name)) missing.push(`${name} — used in ${path}`);
      }
    }
  }

  assert.deepEqual(missing, [], `These classes are in the markup and in no stylesheet:\n${missing.join("\n")}`);
});

test("§8.6 every CSS-module class used resolves in its own module", () => {
  for (const path of COMPONENTS) {
    const source = stripJs(read(path));
    if (!source.includes("styles.")) continue;

    const importMatch = source.match(/import\s+styles\s+from\s+"([^"]+)"/);
    assert.ok(importMatch, `${path} uses styles.* without importing a stylesheet.`);

    const modulePath = join(path, "..", importMatch[1]);
    const sheet = stripCss(read(modulePath));
    const declared = new Set([...sheet.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(([, name]) => name));

    for (const [, name] of source.matchAll(/styles\.([a-zA-Z][a-zA-Z0-9_]*)/g)) {
      assert.ok(declared.has(name), `${path} uses styles.${name}, which ${importMatch[1]} does not define.`);
    }
  }
});

// ---------------------------------------------------------------- row 7 --

test("§8.7 no landing element rule reaches a workspace surface", () => {
  /*
   * `globals.css` gives a bare `<section>` 78px of vertical padding for landing
   * rhythm. It has bitten three surfaces: every `<Panel>` at once, the swap
   * statement, and the Stellar Hub, where it measured 3,588px of dead space
   * across seven routes. Patching each new victim is how a trap keeps them.
   */
  const globals = stripCss(read(join("app", "globals.css")));
  assert.match(globals, /(^|\})\s*section\s*\{[^}]*padding/m, "The landing section rule moved; this gate must follow it.");

  const shell = stripCss(read(join("app", "shell", "shell.css")));
  assert.match(
    shell,
    /:where\(\.rs-canvas\)\s+section:not\(:where\(\[data-panel\]\)\)\s*\{[^}]*padding-block:\s*0/,
    "The canvas no longer neutralises the landing section rhythm. Any bare <section> on a workspace page\n" +
      "will silently gain 156px of dead space, which no source-level test can see.",
  );

  const panel = stripCss(read(join("app", "shell", "panel.css")));
  assert.match(panel, /\.rw\s*\{[^}]*padding:\s*0/, "The panel's own reset is gone; its header will be pushed onto its body.");
});

// --------------------------------------------------------------- row 10 --

test("§8.10 a page's primary content cannot be hidden", () => {
  /*
   * `essential` is inverted from an earlier hub's reading: there, the flag let
   * customization empty the only panel on a page. Here the primary panel of
   * every surface carries it, so a layout preference cannot remove the thing
   * the page exists to show.
   */
  const withPanels = COMPONENTS.filter((path) => stripJs(read(path)).includes("<Panel"));
  assert.ok(withPanels.length >= 5, `Expected most surfaces to use panels, found ${withPanels.length}.`);

  for (const path of withPanels) {
    const source = stripJs(read(path));
    assert.match(
      source,
      /<Panel[^>]*\n?[\s\S]{0,600}?essential/,
      `${path} renders panels and marks none essential, so customization can empty the page.`,
    );
  }
});

test("§8.10 the unknowns rail is essential, because it is the honesty", () => {
  const passport = stripJs(read(join(WORKSPACE, "assets", "[asset]", "page.tsx")));
  const rail = passport.match(/id="passport-unknowns"[\s\S]{0,400}/);
  assert.ok(rail, "The unknowns rail panel is gone from the Passport.");
  assert.match(
    rail[0],
    /essential/,
    "The unknowns rail is hideable. It is the visible proof that the page does not fill gaps, and a proof\n" +
      "a preference can switch off is not one.",
  );
});
