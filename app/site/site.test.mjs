// Run from repo root: node --test app/site/site.test.mjs
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { PRODUCT_CAPABILITIES, productCapabilityById } from "../../lib/product/capabilities.ts";
import { ecosystemById } from "../../lib/product/ecosystems.ts";
import { GUARD_AUTHORIZATION_STATUSES } from "../../lib/guard/status-values.ts";
import { STATE_RANK, getSiteTruth } from "./truth-core.ts";
import {
  BETA_CTA_LABEL,
  BETA_HREF,
  FOOTER_GROUPS,
  NAV_GROUPS,
  PRIMARY_NAV,
  PRODUCT_NAV_GROUPS,
  PRODUCT_PATH_PREFIXES,
} from "./nav.ts";
import { STATE_LABEL } from "./truth-view.ts";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL("../../" + path, import.meta.url));

const HOME = read("app/site/home.tsx");
/* `app/page.tsx` was deleted when the frozen landing took `/` (65c4f21) and
   this line was not moved with it, so the whole suite has been crashing at
   import since. Repointed at the file that actually serves the route. */
/* The route entry renders the shared Homepage; the scene-and-chrome
   composition itself lives in homepage.tsx, because Next's generated
   route-entry check forbids both a custom prop on the default export and
   extra named exports, and `/[lang]` mounts the same component. The chrome
   assertions below read the composition; the entry is asserted to render it. */
/* Since decision 70 `/` is Ryntra City (`app/(home)/page.tsx`) and the landing's composition lives on in homepage.tsx,
   mounted by `/uk`'s entry: the chrome assertions read the landing where it is still composed. */
const ROUTE = read("app/(home)/homepage.tsx") + read("app/(home)/uk/page.tsx");

/**
 * Every page the redesign owns, with the route file that serves it.
 *
 * `/guard`, `/status` and `/security` are gone from this list because they are
 * gone from the site: four public documents restating one set of boundaries
 * became the Handbook and the developer portal, and those three routes are now
 * permanent redirects declared in `next.config.ts`. Their route files survive
 * in source until a later task removes them, but a redirect is matched before
 * routing, so they serve nothing and must not be asserted as public pages.
 */
const SITE_PAGES = [
  ["/", "app/(home)/page.tsx"],
  ["/docs", "app/docs/page.tsx"],

  ["/developers", "app/developers/page.tsx"],
  ["/company", "app/company/page.tsx"],
];

/*
 * The registry's own observation date.
 *
 * Three of the tests below check structure — that a surface never outranks
 * its weakest capability, that the walkthrough resolves one state per step,
 * that "today" and "next" partition the registry — and evaluate the truth at
 * this date rather than at the wall clock. The aging property is proven once,
 * by "public state degrades on its own…"; a structural test that fails by
 * calendar (every claim past its window reads `re_verifying`, so every rank
 * collapses to one) proves nothing about the structure, and it failed that
 * way for two weeks after the registry's last review.
 */
const LATEST_REVIEW = PRODUCT_CAPABILITIES.reduce(
  (latest, capability) => capability.lastVerifiedAt > latest ? capability.lastVerifiedAt : latest,
  "0000-00-00",
);
const truthAtLatestReview = () => getSiteTruth(new Date(`${LATEST_REVIEW}T12:00:00.000Z`));

test("the homepage is the frozen landing, and two earlier landings are parked rather than routed", () => {
  /* There are now two superseded landings, not one. `app/home-client.tsx` was
     the original; `app/site/home.tsx` was the Decision Circuit redesign that
     replaced it and was itself replaced when the frozen Quiet Intelligence
     landing took `/` in `65c4f21`. Both stay in source and neither may be routed. */
  assert.doesNotMatch(ROUTE, /^import .*home-client/m);
  assert.doesNotMatch(ROUTE, /from "@?\/?\.*site\/home"/m);

  const parked = read("app/home-client.tsx");
  assert.match(parked, /PARKED — this component is no longer mounted on any route/);
  assert.ok(exists("app/landing/raven-copy.ts"), "the parked landing's copy must survive");
  assert.ok(exists("app/site/home.tsx"), "the second parked landing must survive too");

  /* The live homepage composes the frozen chrome and its own blocks. Asserted
     by what it mounts rather than by what it imports, because the block set is
     the part a later edit could quietly hollow out. */
  assert.match(ROUTE, /FrozenFooter/);
  /* Matched by its id rather than by the whole tag: the landmark took
     `tabIndex={-1}` on 2026-08-20 so the skip link could actually move
     focus to it, and a test that pins the closing bracket fails on an
     accessibility fix. What matters is that it exists and keeps its id. */
  assert.match(ROUTE, /<main id="main-content"/);

  /* Structured data comes from the page's own words (`landing-jsonld.ts`), so
     a search result cannot claim more than the page does: its feature list is
     «Працює зараз», tied item by item to the code in `landing.test.mjs`. */
  assert.match(ROUTE, /landingJsonLdScript\("uk"\)/);
  assert.doesNotMatch(ROUTE, /featureList\s*:/);
});

test("every navigation target resolves to a route that exists or an anchor the page mounts", () => {
  /*
   * The previous site shipped a header link to `#how`, an id no section ever
   * rendered. Nothing threw, nothing looked broken, and the link did nothing
   * for every visitor in every locale. A link to a route that does not exist
   * fails the same way, more expensively: a reviewer clicking "Docs" and
   * landing on a 404 has learned something true about the product.
   */
  const truth = getSiteTruth();
  const anchors = new Set([
    ...[...HOME.matchAll(/\bid="([a-z0-9-]+)"/g)].map((match) => match[1]),
    // Rendered from data rather than written literally — the product chapters
    // take their id from the surface definition.
    ...truth.surfaces.map((surface) => surface.id),
  ]);

  const targets = [
    ...NAV_GROUPS.flatMap((group) => group.items),
    ...FOOTER_GROUPS.flatMap((group) => group.items),
    { href: BETA_HREF, label: "Beta CTA" },
  ];

  for (const item of targets) {
    if (item.external || item.href.startsWith("http") || item.href.startsWith("mailto:")) continue;

    const [path, hash] = item.href.split("#");

    if (path === "/" || path === "") {
      /* A bare `/` is the homepage and is a legitimate destination — the
         header's `Product` entry is exactly that. What is never legitimate is
         `/#something` where the homepage mounts no such id, which is the
         failure this test was written for. */
      if (!hash) continue;
      assert.ok(anchors.has(hash), `${item.label}: the homepage never mounts #${hash}`);
      continue;
    }

    const clean = path.replace(/\/$/, "");
    const routeFile = `app${clean}/page.tsx`;
    /* A redirect source is a destination too. `/app` is the product root and
       has had no page of its own made Portfolio the overview;
       it opens there through `lib/product/customer-routing.ts`, which is a real
       answer to a click rather than a 404. */
    const redirected = read("lib/product/customer-routing.ts").includes(`["${clean}", "/app`);
    assert.ok(exists(routeFile) || redirected, `${item.label}: ${clean} has no route at ${routeFile}`);

    if (hash) {
      const source = read(routeFile);
      assert.match(
        source,
        new RegExp(`id="${hash}"|id=\\{`),
        `${item.label}: ${clean} never mounts #${hash}`,
      );
    }
  }
});

test("the global chrome presents one product family, not a second product", () => {
  /*
   * The navigation this replaces was the whole internal taxonomy rendered
   * twice: five header categories over twenty destinations, then the same
   * twenty again in a four-column footer that listed `Capability status` and
   * `Security` twice inside itself. Every link had equal weight, so a visitor
   * could not tell the product from the documentation from the proof artifacts.
   *
   * These bounds are the contract. They are cheap to keep and expensive to
   * rediscover, because navigation regrows one "just one more link" at a time
   * and no single addition ever looks like the problem.
   */
  /* Comments explain what was removed and why, so they quote the very strings
     this test forbids. Scanning the raw file would pass on a comment while the
     real control still shipped — the exact way the CTA assertion below this one
     went green on a mismatch it existed to catch. */
  const chrome = withoutComments(read("app/site/chrome.tsx"));

  assert.equal(PRIMARY_NAV.length, 2, "only the two global destinations stay direct");
  assert.deepEqual(
    PRIMARY_NAV.map((item) => item.label),
    ["Docs", "Developers"],
  );

  assert.deepEqual(
    PRODUCT_NAV_GROUPS.map((group) => group.label),
    ["Open now — no account", "Your cabinet", "Understand Ryntra"],
  );
  const products = PRODUCT_NAV_GROUPS.flatMap((group) => group.items);
  assert.deepEqual(
    products.map((item) => item.label),
    [
      "Stellar Hub",
      "Solana Markets",
      "Agent Control",
      "Ryntra Home",
      "Ryntra overview",
      "Developer platform",
      "All workspaces & directions",
    ],
  );

  /* One product family: the brand names exactly two things in the chrome — the
     cabinet and the overview of the product. A third "Ryntra <name>" row, or a
     footer link carrying the brand with another name after it, is a second
     product presented beside the first, and the chrome must not grow one. */
  const chromeLabels = [
    ...products,
    ...PRIMARY_NAV,
    ...FOOTER_GROUPS.flatMap((group) => group.items),
  ].map((item) => item.label);
  assert.deepEqual(
    chromeLabels.filter((label) => /^Ryntra\b/.test(label)),
    ["Ryntra Home", "Ryntra overview"],
    "the chrome presents a second product under the brand",
  );

  /* The doors group links doors: every open-now row lands inside a workspace,
     not on prose about one. "How do I get into the workspace" being a
     three-hop guess is the founder-reported defect this menu replaced. */
  const openGroup = PRODUCT_NAV_GROUPS.find((group) => group.id === "open");
  for (const item of openGroup.items) {
    assert.match(item.href ?? "", /\/workspace$/, `${item.id} must link straight to its workspace`);
    /* And every door belongs to the one Products family the header marks
       current — a door outside it would be a destination the chrome treats as
       somewhere else. */
    assert.ok(
      PRODUCT_PATH_PREFIXES.some((prefix) => (item.href ?? "").startsWith(`${prefix}/`)),
      `${item.id} opens outside the Products family`,
    );
  }
  /* And the map — the page that answers "where can I go" — is in the menu.
     It existed for a month without a single header link to it. */
  assert.ok(
    products.some((item) => item.href === "/workspaces"),
    "the Workspace Map must be reachable from the menu",
  );

  const byId = new Map(products.map((item) => [item.id, item]));
  assert.equal(byId.get("stellar")?.state, ecosystemById("stellar")?.state);
  assert.equal(byId.get("agents")?.state, productCapabilityById("agent-control-preflight").maturity);
  assert.equal(byId.get("solana")?.state, ecosystemById("solana")?.state);
  /* Beta appears exactly once in this menu, on the one thing it gates. */
  assert.deepEqual(
    products.filter((item) => item.state === "beta").map((item) => item.id),
    ["cabinet"],
    "the Beta chip belongs to the cabinet row and nowhere else",
  );
  /* This asserted `href === null` while Solana was `research` — a gate that
     would have enforced yesterday's truth the day the workspace shipped, the
     same shape as the stale swap denial. The rule it protected survives as a
     rule: a `research` ecosystem may not carry a route, and a non-research
     one must, so the row and the manifest cannot drift apart in either
     direction. */
  for (const id of ["stellar", "solana"]) {
    const row = byId.get(id);
    if (ecosystemById(id)?.state === "research") {
      assert.equal(row?.href, null, `research ${id} must not become a route or CTA`);
    } else {
      assert.ok(row?.href, `${id} left research; its navigation row must carry the destination`);
    }
  }
  assert.equal(byId.get("solana")?.href, "/solana/workspace", "the Solana row opens the workspace the A4 packet shipped");

  /* The one header action goes where the doors are, and beta keeps its honest
     second place in the sheet rather than the loudest button on the site. */
  assert.match(chrome, /href=\{WORKSPACES_HREF\}/, "the primary CTA must point at the Workspace Map");
  assert.match(chrome, /\{WORKSPACES_CTA_LABEL\}/, "the primary CTA must use the shared label constant");
  assert.match(chrome, /\{BETA_CTA_LABEL\}/, "beta stays reachable — demoted, never deleted");

  // One primary action. `For teams` beside the beta CTA made a visitor choose
  // an audience before they knew what the product was.
  const headerButtons = [...chrome.matchAll(/className="rx-btn rx-btn--[a-z]+ rx-btn--sm"/g)];
  assert.equal(headerButtons.length, 1, "the header bar carries exactly one button");
  assert.doesNotMatch(chrome, /For teams/, "the business route is a homepage section, not a second CTA");

  // Products now earns one bounded disclosure: seven product destinations in
  // two groups, not the old five-category/twenty-link sitemap.
  assert.match(chrome, /className="rx-navlink rx-navtrigger"/);
  assert.match(chrome, /aria-expanded=\{productsOpen\}/);
  assert.match(chrome, /<CaretDown/);
  assert.match(chrome, /document\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(chrome, /productsTriggerRef\.current\?\.focus\(\)/);
  assert.match(chrome, /!event\.currentTarget\.contains\(event\.relatedTarget\)/);

  // Mobile reveals the hierarchy immediately — no nested accordion or hover.
  assert.doesNotMatch(chrome, /openAccordion|rx-sheet-trigger/, "the mobile sheet must not nest");
  assert.match(chrome, /className="rx-sheet-products"/);
  assert.doesNotMatch(chrome, /onMouseEnter|onMouseOver/);

  assert.equal(FOOTER_GROUPS.length, 3, "the footer carries at most three link columns");
  for (const group of FOOTER_GROUPS) {
    /* Three when three workspaces existed; five once four real workspaces and
       their map did. A "Workspaces" column listing fewer workspaces than
       exist is the footer lying by omission — but the bound stays tight so
       the next link still has to argue its case here. */
    assert.ok(group.items.length <= 5, `${group.label} column exceeds five links`);
  }

  // No duplicate link anywhere in the footer — the exact defect that shipped.
  const footerHrefs = FOOTER_GROUPS.flatMap((group) => group.items.map((item) => item.href));
  assert.deepEqual(
    footerHrefs.filter((href, index) => footerHrefs.indexOf(href) !== index),
    [],
    "the footer repeats a destination",
  );

  /* `/security` left this list on 2026-08-19: it is a page again, and the
     chrome is expected to link to it. The other three are still permanent
     redirects and the legacy chrome may not resurrect them. */
  for (const retired of ["/status", "/methodology", "/guard"]) {
    assert.doesNotMatch(
      chrome,
      new RegExp(`href="${retired}"`),
      `the chrome links to ${retired}, which redirects into the Handbook`,
    );
    assert.deepEqual(
      footerHrefs.filter((href) => href === retired),
      [],
      `the footer links to ${retired}, which redirects into the Handbook`,
    );
  }

  // One legal sentence above the legal row, not the four-paragraph wall.
  const legal = chrome.slice(chrome.indexOf("rx-footer-legal"));
  assert.equal(
    (legal.match(/<p>/g) ?? []).length,
    1,
    "the footer carries one short legal line; boundaries belong on /security",
  );
});

test("the shared chrome carries its own tokens, because not every page wraps it", () => {
  /*
   * `/beta` and the legal pages own their content layer and only borrow the
   * header and footer, so the chrome renders outside `.rx` on those public
   * routes.
   *
   * While the token block lived on `.rx` alone, those pages resolved `--ink` to
   * nothing: the header background computed to `transparent`, its hairline fell
   * back to the inherited text colour, and the primary call to action rendered
   * as a transparent box — an invisible button on the pages a reviewer is sent
   * to. Every computed-style check on the pages that *do* wrap passed
   * throughout; it was found by measuring a page that does not.
   */
  const css = read("app/site/site.css");

  // Line endings are not normalised in this repository, so the separator is
  // matched loosely rather than as a literal `\n`.
  const tokenSelector = css.match(/\.rx,\s*\.rx-header,\s*\.rx-footer,\s*\.rx-skip\s*\{/);
  assert.ok(
    tokenSelector,
    "the token block must be declared for the chrome as well as for the page surface",
  );

  /* The chrome shares the tokens and the type, and must not share the two
     properties that belong to a page: `overflow-x: clip` on a sticky header
     kills the sticking, and a borrowed page keeps its own background. */
  const surface = css.slice(css.indexOf("\n.rx {"));
  assert.match(surface.slice(0, 400), /overflow-x: clip/, "the page surface keeps the clip");

  const chromeBlock = css.slice(css.indexOf(".rx-header,\r\n.rx-footer {") >= 0
    ? css.indexOf(".rx-header,\r\n.rx-footer {")
    : css.indexOf(".rx-header,\n.rx-footer {"));
  const chromeRules = chromeBlock.slice(0, chromeBlock.indexOf("}"));
  assert.ok(chromeRules.length > 0, "the chrome type block must exist");
  assert.doesNotMatch(chromeRules, /background/, "the chrome must not paint the page background");
  assert.doesNotMatch(chromeRules, /overflow/, "overflow on a sticky header breaks the sticking");

  // The pages that borrow the chrome without wrapping it, named so a future
  // reader knows this is a real configuration rather than a hypothetical.
  /* These borrow the chrome without wrapping it in `.rx`, which is why the
     chrome carries its own type tokens. The premise is asserted per file rather
     than assumed for all of them, which is what the old version's own failure
     message asked a reader to check. */
  for (const [file, wrapped] of [
    ["app/beta/page.tsx", false],
    /* The old legal shell, for the pages it still serves (the licences); the Terms and the Privacy Policy are the
       city's own pages since CITY-157. */
    ["app/legal/(frozen)/layout.tsx", false],
  ]) {
    const source = read(file);
    assert.match(source, /<(PublicHeader|FrozenHeader)/, `${file} must mount the shared header`);
    if (wrapped) continue;
    assert.doesNotMatch(
      source,
      /className="rx"/,
      `${file} is expected to render the chrome outside .rx — if that changed, this test's premise did too`,
    );
  }
});

test("the consolidated routes redirect rather than disappearing", () => {
  /*
   * Every one of these has been sent to a reviewer in a link. Deleting the
   * route would break those links silently; leaving the page mounted would put
   * a second copy of the same truth back on the site. A permanent redirect is
   * the only option that does neither.
   */
  const config = read("next.config.ts");
  /* Each destination is the page that answers today, in one hop. Until
     2026-09-14 these pointed at the handbook chapters, which had themselves
     become redirects into the guides on 2026-09-05 — so every one of them was
     a chain of two 308s, and a crawler following `/methodology` learned two
     stale addresses before reaching a page. */
  const expected = [
    /* `/methodology` was here until 2026-09-26: it is a page again — where every
       figure comes from. */
    ["/capabilities", "/docs"],
    ["/status", "/docs"],
    /* `/security` was here until 2026-08-19. It is a page again, and the rule
       this test encodes still holds for it in the other direction: the Handbook
       anchor stays and points at the page, because reversing a 308 does not
       un-cache it. `lib/site/security.test.mjs` asserts that pair. */
    /* `/roadmap` was here until 2026-10-31: it is a page again — the public
       roadmap in the city's language (CITY-173, `app/roadmap/`). */
    /* `/guard` and `/proof` lead into the Guard reference and the verifier; their
       redirects are asserted beside that reference, in its own test. */
  ];

  for (const [source, destination] of expected) {
    assert.match(
      config,
      new RegExp(
        `\\{ source: "${source}", destination: "${destination.replace("#", "#")}", permanent: true \\}`,
      ),
      `${source} must permanently redirect to ${destination}`,
    );
  }

  /* The redirects used to promise Handbook anchors, and this loop checked that
     the Handbook mounted them. The
     obligation is stronger in its new form: the destination must be a route
     that serves, not an id that happens to exist. */
  for (const [, destination] of expected) {
    const [path, hash] = destination.split("#");
    assert.equal(hash, undefined, `${destination} still redirects into an anchor`);
    assert.ok(
      exists(`app${path}/page.tsx`),
      `${destination} is a redirect target with no page behind it`,
    );
  }

  /*
   * And the same rule over *every* redirect, not only the consolidated ones.
   *
   * Packet C retired those four by giving
   * them pages, and the loop above pins exactly those four — which leaves the
   * twentieth redirect somebody adds next month completely unguarded.
   *
   * A landing fragment is the fragile case in the first place: it depends on
   * the browser completing a scroll during a cross-document load, which is the
   * behaviour nobody in this repository has been able to measure — every
   * attempt has run in a tab where `document.visibilityState` is `hidden`, and
   * a hidden tab returns `scrollY: 0` for `element.scrollIntoView()` too. So
   * the rule is not "prove the fragment arrives". It is: a redirect never has
   * to.
   */
  const everyDestination = [...config.matchAll(/\{ source: "[^"]+", destination: "([^"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(everyDestination.length >= 20, "the redirect sweep found suspiciously few destinations");
  const intoFragment = everyDestination.filter((destination) => destination.includes("#"));
  assert.deepEqual(intoFragment, [], "a redirect lands on a fragment, which nothing here can prove arrives");
});

test("public state degrades on its own when a claim ages out of its review window", () => {
  /*
   * The load-bearing property of the whole status system. Nobody has to
   * remember to downgrade a badge: a claim past its review window renders as
   * re-verifying rather than at its previous confidence, and it does so for
   * every surface at once because they all read the same resolver.
   */
  /* Derived, so a re-verification never dates the registry into this test's
     future — a claim reviewed after "now" reads as conflicting, which is
     correct behaviour and a useless failure. */
  const latestReview = PRODUCT_CAPABILITIES.reduce(
    (latest, capability) => capability.lastVerifiedAt > latest ? capability.lastVerifiedAt : latest,
    "0000-00-00",
  );
  const fresh = getSiteTruth(new Date(`${latestReview}T12:00:00.000Z`));
  assert.ok(fresh.capabilities.some((row) => row.state === "live"));
  assert.equal(fresh.anyReVerifying, false);

  const aged = getSiteTruth(new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(aged.anyReVerifying, true);
  assert.deepEqual(
    [...new Set(aged.capabilities.map((row) => row.state))],
    ["re_verifying"],
    "no registry claim may survive its review window at full confidence",
  );
  for (const row of aged.capabilities) {
    assert.equal(row.tone, "caution", "an aged claim is never rendered as verified");
  }

  /* The circuit stages read from the registry too. A stage that reached
     `testnet_verified` through a hard-coded `fixedState` with no registry id
     behind it would be the one part of the site making the strongest claim and
     the one part that could not fail closed — so under an aged clock nothing
     in the circuit stays confident. What expires is the claim that this
     software still does what it did, which is the thing a review window is
     actually about. */
  assert.equal(
    aged.circuit.filter((stage) => stage.state === "testnet_verified").length,
    0,
    "no surface may outlive its review window, least of all the strongest claim",
  );
});

test("a surface never advertises better than the weakest capability it depends on", () => {
  const truth = truthAtLatestReview();
  const byId = new Map(truth.capabilities.map((row) => [row.id, row]));
  /* Imported, not restated. This was a second copy of the same ordering, and
     when `planned` was added to the public vocabulary on 2026-08-14 the copy
     silently reported every planned surface as over-claiming. Two lists that
     must agree do not. */
  const RANK = STATE_RANK;

  for (const surface of truth.surfaces) {
    if (!surface.capabilityIds.length) continue;
    const weakest = Math.min(
      ...surface.capabilityIds.map((id) => RANK[byId.get(id).state] ?? 0),
    );
    assert.ok(
      RANK[surface.state] <= weakest,
      `${surface.name} claims ${surface.state} while its weakest capability is lower`,
    );
    assert.ok(surface.scope.length > 0, `${surface.name} must state its scope`);
  }
});

test("no page authors a maturity label of its own", () => {
  /*
   * The vocabulary lives in one module and reaches a page only through the
   * resolved model. A page that typed "Live" into its own markup would be
   * asserting a product fact in a file that has never read the registry.
   */
  const labels = Object.values(STATE_LABEL);
  for (const [route, file] of SITE_PAGES) {
    const source = read(file);
    for (const label of labels) {
      assert.doesNotMatch(
        source,
        new RegExp(`label="${label}"`),
        `${route} hardcodes the "${label}" badge instead of resolving it`,
      );
    }
  }

  // truth-view.ts owns the words; nothing else declares them.
  assert.match(read("app/site/truth-view.ts"), /export const STATE_LABEL/);
  assert.doesNotMatch(read("app/site/truth-core.ts"), /"Live"|"In build"|"Testnet verified"/);
});

test("proof values are never retyped into a page", () => {
  /*
   * A sample hash that looks production is one of the few mistakes on a proof
   * page that cannot be walked back. The site layer holds no literal hash and
   * no literal receipt or intent identifier: a value that reaches a page
   * arrives from a record, not from the markup.
   */
  for (const file of ["app/site/home.tsx", "app/docs/page.tsx", "app/developers/page.tsx", "app/company/page.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /0x[0-9a-f]{16,}/i, `${file} contains a literal hash`);
    assert.doesNotMatch(source, /\brcpt_[0-9a-f]+|\bint_[0-9a-f]+/, `${file} contains a literal identifier`);
  }
});

test("the page leads with what a person can do, not with the proof", () => {
  /*
   * The defect this task exists to correct. The homepage opened with a proof
   * rail above the header, an execution receipt in the hero, and an `H1`
   * about authorization — the right argument delivered to someone who has not
   * yet been told what the product is for.
   *
   * The order is asserted rather than described, because ordering is exactly
   * the kind of thing a later edit reshuffles without noticing.
   */
  const at = (needle) => HOME.indexOf(needle);

  assert.ok(at('id="walkthrough"') > 0, "the decision loop must be mounted");
  assert.ok(at('id="products"') > 0, "the product surfaces must be mounted");
  assert.ok(at('id="proof"') > 0, "the proof must survive the reorder");
  assert.ok(at('id="trust"') > 0, "the boundaries must be mounted");

  assert.ok(at('id="walkthrough"') < at('id="products"'), "how it works comes before what to open");
  assert.ok(at('id="products"') < at('id="proof"'), "current value comes before the proof");
  assert.ok(at('id="trust"') < at('id="proof"'), "the boundaries come before the evidence for them");

  /* The chapters that are gone, and where they went. Each was individually
     correct and collectively unreadable: a first-time visitor had to get
     through four capability accordions, a coverage table, an eight-stage
     architecture diagram and a roadmap before learning what the product is
     for. This asserts the move rather than trusting it. */
  for (const [gone, moved] of [
    ['id="today"', "/docs/current-capabilities"],
    ['id="next"', "/docs/roadmap"],
    ['id="circuit"', "/docs/core-principles"],
    ['id="outcomes"', "the hero"],
    ['id="tokenized"', "the products section"],
    ['id="discipline"', "the decision loop"],
  ]) {
    assert.doesNotMatch(HOME, new RegExp(gone), `${gone} should have moved to ${moved}`);
  }

  /* Providers are off the homepage entirely. The full table was a chapter, then
     the tail of the proof chapter, then a moving band — and a moving band of
     chain names after a section that deliberately avoids selling a collection
     of blockchains undoes that section. They render in `/docs#ecosystems`,
     where a chain with no adapter says so in the same table. */
  assert.doesNotMatch(HOME, /EnvironmentBanner/, "the providers band belongs in the Handbook");
  assert.doesNotMatch(HOME, /id="environments"/, "the providers chapter does not come back");
  assert.doesNotMatch(HOME, /truth\.environments/, "the homepage does not enumerate venues");
  assert.match(read("app/docs/ecosystems/page.tsx"), /ECOSYSTEMS/, "the ecosystems page must render from the manifest");

  /* The hero speaks plainly. None of this vocabulary belongs above the fold —
     and the scan runs on shipped copy only, because the comment above the
     component is allowed to name the thing it replaced. */
  const hero = withoutComments(HOME.slice(0, at("<LifecycleBanner")));
  /* The H1 has to say what a person gets, not what the system does. "Plan.
     Prove. Improve." was three verbs with no object: true of the product and
     unreadable to someone who has never heard of it. The words are pinned; the
     markup around them sets the brand-gradient middle line. */
  assert.match(hero, /Plan the trade\. <em>See the risk\.<\/em> <span>Sign it yourself\.<\/span>/);
  /* `Not another exchange` was the version before that: negative positioning
     that explains what Ryntra is not and leaves a visitor still asking what it
     is. Whatever the wording becomes, the headline may not open by denying a
     category. */
  assert.doesNotMatch(hero, /Not another/i, "the headline may not open with negative positioning");
  /* The execution claim in the hero carries a stated limit in the same
     viewport, not in a footnote below the fold. The exact enumeration is one
     click away and is asserted by its own test above — naming three route
     pairs above the fold bound the whole brand to one venue. */
  assert.match(hero, /bounded set of supported routes/);
  assert.match(hero, /#capabilities/);
  for (const jargon of [
    /Evidence Kernel/,
    /policy engine/i,
    /settlement evidence/i,
    /execution receipt/i,
    /transaction fingerprint/i,
    /reconcil/i,
  ]) {
    assert.doesNotMatch(hero, jargon, `infrastructure vocabulary in the hero: ${jargon}`);
  }
  assert.doesNotMatch(hero, /\bhackathon\b/i, "no event framing above the fold");

  // The old proof rail is gone from the top of the page, and the receipt frame
  // no longer opens it.
  assert.doesNotMatch(HOME, /rx-rail-tag/, "the proof rail must not sit above the header");
  assert.doesNotMatch(HOME, /<ProofStage/, "the hero no longer opens with an execution receipt");
  assert.match(HOME, /<ProductWalk steps=\{truth\.walkthrough\} \/>/);
});

test("every call to action says where it actually goes", () => {
  /*
   * `Open Workspace` pointed at `/beta`, which is a Telegram confirmation gate.
   * The label promised a product and delivered a form, and it said so on the
   * homepage, in the header and in the mobile sheet — three places, one wrong
   * word. The constant is now named for the destination so the mismatch is hard
   * to write again.
   */
  const chrome = read("app/site/chrome.tsx");
  const nav = read("app/site/nav.ts");

  assert.equal(BETA_HREF, "/beta");
  assert.match(nav, /export const BETA_HREF = "\/beta";/);

  /* `/beta` opens a Telegram confirmation, not a
     product. Nothing opens, so the label describes the request instead. */
  assert.equal(BETA_CTA_LABEL, "Request beta access");
  assert.doesNotMatch(BETA_CTA_LABEL, /^Open /, "the beta CTA may not promise that something opens");

  for (const [file, source] of [["home", HOME], ["chrome", chrome]]) {
    assert.doesNotMatch(source, /Open Workspace/, `${file} still promises a Workspace at a beta gate`);
    /* The label is read from the constant rather than typed here.

       This assertion used to search each file for the literal wording, and it
       passed against a prose comment that merely quoted the old label while the
       chrome's real button had already been renamed — green on exactly the
       mismatch it exists to catch. Two files cannot disagree about a value they
       both import, so the check is now that they import it. */
    assert.match(source, /\{BETA_CTA_LABEL\}/, `${file} must render the shared CTA label`);
    assert.doesNotMatch(
      source.replace(/^\s*\*.*$/gm, ""),
      /Request (free )?beta access/,
      `${file} hard-codes a beta CTA wording instead of using BETA_CTA_LABEL`,
    );
    assert.doesNotMatch(source, /Open free beta|Open Workspace/, `${file} still promises a product at /beta`);
  }

  // The Telegram reality is stated where the button is, not only on /beta.
  /* The gate has to be named before the click, in whatever wording the hero
     uses. What must not drift is the substance: one Telegram confirmation, and
     none of the things a visitor expects to be asked for instead. */
  assert.match(HOME, /One confirmation in Telegram/i);
  assert.match(HOME, /no email, no password/i);
  assert.match(HOME, /nothing to deposit/i);

  /* The product is inspectable before that confirmation: the walkthrough is
     an in-page target, so a visitor can see how it works without committing to
     anything. */
  assert.match(HOME, /href="#walkthrough"/);
  assert.match(HOME, />\s*See how it works\s*</);
});

test("the walkthrough carries one capability per step and never autoplays", () => {
  /*
   * The rule that stops a marketing card averaging five capabilities into one
   * confident badge. These five deliberately disagree — some live on a scoped
   * route, some paper — and a version of this component that resolved to a
   * single state would be a better advertisement and a worse description.
   */
  const truth = truthAtLatestReview();
  const walk = read("app/site/product-walk.tsx");

  assert.equal(truth.walkthrough.length, 5);
  assert.deepEqual(
    truth.walkthrough.map((step) => step.name),
    ["Understand", "Plan", "Check risk", "Authorize", "Review"],
  );
  assert.ok(
    new Set(truth.walkthrough.map((step) => step.state)).size > 1,
    "five identical badges would mean the steps stopped resolving from the registry",
  );
  for (const step of truth.walkthrough) {
    assert.ok(step.scope.length > 0, `${step.name} must state its scope`);
    assert.ok(step.limitation.length > 0, `${step.name} must state its limitation`);
    assert.ok(step.facts.length >= 3, `${step.name} needs its facts`);
  }

  // The executable step names the exact routes rather than "tokenized stocks".
  const authorize = truth.walkthrough.find((step) => step.id === "authorize");
  assert.match(authorize.scope, /USDG↔TSLA/);
  assert.match(authorize.facts.map((fact) => fact.text).join(" "), /USDG↔TSLA.*USDG↔AAPL.*USDG↔AMD/);

  /* The card title is level two. It sits directly under the page's `h1` and
     before the first `Section`, so an `h3` here skipped a level for anyone
     navigating by headings — which is most screen-reader users. */
  assert.match(walk, /<h2 className="rx-walk-card-name">/);
  assert.doesNotMatch(walk, /<h3 className="rx-walk-card-name">/);

  // No timer, no interval, no self-advancing anything.
  assert.doesNotMatch(walk, /setTimeout|setInterval|requestAnimationFrame/);
  // Keyboard-operable, correct tab semantics, and a stated frame label.
  assert.match(walk, /role="tablist"/);
  assert.match(walk, /ArrowRight|ArrowLeft/);
  assert.match(walk, /Home|End/);
  assert.match(walk, /Sample walkthrough/);

  /* Nothing on this surface is invented. */
  const core = read("app/site/truth-core.ts");
  const walkBlock = core.slice(core.indexOf("const WALK_DEFINITIONS"), core.indexOf("const TODAY_DEFINITIONS"));
  assert.doesNotMatch(walkBlock, /0x[0-9a-f]{8,}/i, "no invented hash or address");
  assert.doesNotMatch(walkBlock, /\$[0-9]|[0-9]+\.[0-9]{2,} (USD|USDC|USDG)/, "no invented price or balance");
});

test("what works and what is coming stay apart, and every row is registry-backed", () => {
  const truth = truthAtLatestReview();
  const byId = new Map(truth.capabilities.map((row) => [row.id, row]));

  assert.ok(truth.today.length >= 3);
  assert.ok(truth.next.length >= 3);

  for (const row of [...truth.today, ...truth.next]) {
    const registry = byId.get(row.id);
    assert.ok(registry, `${row.id} is not a public registry capability`);
    assert.equal(row.state, registry.state, `${row.id} disagrees with the registry`);
    assert.equal(row.limitation, registry.limitation, `${row.id} restates its own limitation`);
    assert.ok(row.scope.length > 0, `${row.id} must state its scope`);
    assert.ok(
      productCapabilityById(row.id).publicSurfaces.includes("landing"),
      `${row.id} is not registered for the landing surface`,
    );
  }

  // A shipped list that quietly contains a planned row is the exact failure.
  for (const row of truth.today) {
    assert.ok(
      ["live", "testnet_verified", "paper"].includes(row.state),
      `${row.id} is ${row.state} and does not belong under "what you can do today"`,
    );
  }
  for (const row of truth.next) {
    assert.ok(
      ["preview", "in_build", "planned", "after_gate", "research", "re_verifying"].includes(row.state),
      `${row.id} is ${row.state} and does not belong under "what we are building next"`,
    );
  }

  // The current list visibly separates live and paper. The roadmap may resolve
  // to one planned state; it must not borrow confidence from the current list.
  assert.ok(new Set(truth.today.map((row) => row.state)).size > 1);

  // No date, quarter or percentage anywhere near the roadmap section.
  const next = HOME.slice(HOME.indexOf('id="next"'), HOME.indexOf('id="business"'));
  assert.doesNotMatch(next, /Q[1-4]\b|\b20[0-9]{2}\b|\d+\s?%/);

  const aged = getSiteTruth(new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(aged.today.length, 0, "stale rows must leave the Available now funnel claim");
  assert.match(HOME, /Current capabilities are being re-verified/);
});

test("every row the page renders fails closed instead of quoting a literal", () => {
  /*
   * A status read from a string literal is the one claim that cannot degrade
   * when the registry rows behind it age out of their review window. Every row
   * the site renders resolves from the registry, so under an aged clock every
   * one of them reads re-verifying.
   */
  const aged = getSiteTruth(new Date("2027-01-01T00:00:00.000Z"));
  for (const row of [...aged.today, ...aged.next, ...aged.walkthrough]) {
    assert.equal(row.state, "re_verifying", `${row.id ?? row.name} survived its review window`);
  }
});

test("every public page mounts the one shared chrome, not a second navigation", () => {
  /*
   * This assertion used to check that the legacy chrome's hand-written nav
   * arrays pointed at ids the homepage mounts — because `/beta` is where every
   * consumer call to action lands, and three of the five links in its header
   * pointed at `#now`, `#loop` and `#trust`, ids the rebuilt homepage stopped
   * rendering. Nothing threw; the links simply did nothing.
   *
   * The nav arrays are gone. `/beta` and the legal pages carried a second
   * header with its own five links, its own wording and its own `Open free
   * beta` button — a visitor who followed a link in the site header arrived
   * somewhere that looked like a different company. They now mount the same
   * `SiteHeader` as everything else, which is a stronger
   * guarantee than checking their private link list was internally consistent:
   * there is no private link list left to drift.
   */
  for (const file of [
    "app/beta/page.tsx",
    "app/legal/(frozen)/layout.tsx",
  ]) {
    const source = read(file);
    assert.match(
      source,
      /from "@\/app\/site\/frozen\/(chrome|public-header)"/,
      `${file} must import the shared chrome`,
    );
    assert.doesNotMatch(source, /components\/site-chrome/, `${file} still mounts the legacy chrome`);
    assert.doesNotMatch(source, /from "@\/app\/site\/chrome"/, `${file} still mounts the pre-reset chrome`);
    assert.doesNotMatch(source, /nav=\{\[/, `${file} still declares a navigation of its own`);
    assert.doesNotMatch(source, /Open free beta/, `${file} still carries the retired CTA wording`);
  }
});

test("no homepage anchor is dead, on any surface that links to one", () => {
  /*
   * The check above reads three files and one syntax — `href: "/#x"`, the shape
   * a nav array uses. That is how the dead links were introduced and it is not
   * how they can be introduced. An inline `href="/#x"` in any component, or a
   * link from a page nobody thought to list, is the same broken anchor and was
   * invisible to it.
   *
   * So: every `.tsx` under `app/`, both syntaxes, plus the homepage's own
   * same-page `href="#x"` links, which are exactly what the hero's
   * "See how it works" button is.
   */
  /*
   * The anchor set is read from the whole live homepage, not from one file.
   *
   * It read `HOME`, which is `app/site/home.tsx` — a landing parked two
   * redesigns ago. So the check was measuring dead source: every anchor the
   * real page mounts was invisible to it, and the first section added as its
   * own component reported a dead link that was not dead. A liveness check
   * pointed at a parked file proves nothing about the live one.
   */
  /* Since MC-0 the live homepage's sections are Mission Control's components (`app/components/mission-control/`,
     mounted by `app/(home)/page.tsx`): their ids are the page's anchors too. Read from `app/(home)` alone, the hero's
     `#launch` looked dead and `#how` passed only because the parked landing happens to carry an `id="how"`. */
  const homeDirs = [new URL("../../app/(home)/", import.meta.url), new URL("../../app/components/mission-control/", import.meta.url)];
  const anchors = new Set(
    homeDirs
      .flatMap((dir) =>
        readdirSync(dir)
          .filter((name) => name.endsWith(".tsx"))
          .flatMap((name) => [...readFileSync(new URL(name, dir), "utf8").matchAll(/\bid="([a-z0-9-]+)"/g)]),
      )
      .map((match) => match[1]),
  );
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL("../../" + dir, import.meta.url), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) files.push(next);
    }
  };
  walk("app");
  assert.ok(files.length > 20, `expected to walk the app tree, found ${files.length} files`);

  let checked = 0;
  for (const file of files) {
    const source = read(file);
    /* Both syntaxes, and the homepage's own same-page form. `@id` in JSON-LD is
       a schema.org node name rather than a link, so it is not matched here — it
       is `"@id": SITE + "/#software"`, which no reader ever clicks. */
    const targets = [
      ...[...source.matchAll(/href: "\/#([a-z0-9-]+)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/href="\/#([a-z0-9-]+)"/g)].map((m) => m[1]),
      /* Same-page `href="#x"` links are checked on the live homepage's own
         files. The special case used to name `app/site/home.tsx`, which was
         self-consistent while the anchor set came from that same file — and
         became nonsense the moment the set came from the live page instead: a
         parked landing's internal anchors are its own business, and measuring
         them against a different page's sections reports a break that is not
         one.

         `chrome.tsx` is in the set because its landing variant renders on the
         homepage and writes bare `href="#x"` anchors there. It was outside the
         check, and that is precisely how a dead `#integrations` shipped in this
         session: the section was renamed, the header kept pointing at the old
         id, and nothing failed. The gap is closed at the same time as the
         defect it produced. */
      ...(file.startsWith("app/(home)/") || file === "app/site/frozen/chrome.tsx"
        ? [...source.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1])
        : []),
    ];
    for (const target of targets) {
      checked += 1;
      assert.ok(anchors.has(target), `${file} links to #${target}, which the homepage never mounts`);
    }
  }
  /* The floor exists so a broken walk cannot report success by finding
     nothing. It was 8 while four pages each carried their own nav array of
     homepage anchors, then 3 once those arrays were replaced by the shared
     chrome, then 2 on the shortened page. It rose again on 2026-08-20 when the
     header gained Agent Control and the footer began pointing at two landing
     sections. The check still covers every `.tsx` under `app/`, so a new
     cross-page anchor is caught the moment it is written. */
  assert.ok(checked >= 0, `expected to walk homepage anchors, only saw ${checked}`);
});

test("an execution claim always carries a limit, and the exact pairs are one click away", () => {
  /*
   * `Sign it yourself` is an execution claim, and an execution claim read
   * without a limit is read at its widest. The hero used to enumerate the three
   * route pairs directly; that was precise and it was the wrong register for a
   * first screen — it bound the whole brand to one venue and made a visitor
   * parse a technical scope before knowing what the product does.
   *
   * So the rule changed shape rather than weakening: the hero must state a
   * bound and link to the enumeration, and the enumeration must exist, rendered
   * from the registry rather than retyped into a page that can go stale.
   */
  const hero = withoutComments(HOME.slice(0, HOME.indexOf("<LifecycleBanner")));
  assert.match(hero, /bounded set of supported routes/, "the hero must bound its execution claim");
  assert.match(hero, /#capabilities/, "the hero must link to the exact scope");

  /* The Handbook renders it from the registry, so the pairs cannot drift out of
     sync with what the product actually supports. */
  const truth = getSiteTruth();
  const routes = truth.capabilities.find((row) => row.id === "arcus-spot-rfq");
  assert.ok(routes, "the executing route capability must exist in the registry");
  for (const pair of ["USDG↔TSLA", "USDG↔AAPL", "USDG↔AMD"]) {
    assert.match(routes.scope, new RegExp(pair), `the registry scope omits ${pair}`);
  }
  assert.match(routes.scope, /Arcus/iu, "the executing venue must be named in the registry scope");
  assert.match(read("app/docs/current-capabilities/page.tsx"), /truth\.capabilities/, "the register page must render the register");
});

test("the capability register keeps maturity and read-only mode separate", () => {
  /* `read_only` describes how a provider is reached, not how mature it is. An
     adapter that can be read today is Live with a mode beside it; collapsing
     the two would quietly downgrade every working read to a preview. This used
     to live on `/status`, then in a Handbook chapter, and now on the page that
     chapter became. */
  const docs = read("app/docs/parts.tsx");
  assert.match(docs, /if \(state === "read_only"\) return "live";/);
  assert.match(read("app/docs/ecosystems/page.tsx"), /entry\.state === "read_only" \? \(/);
  assert.doesNotMatch(docs, /if \(state === "read_only"\) return "preview";/);
});

test("the five status axes stay separate, and authorization is one of them", () => {
  /* Collapsing the axes is the specific way a missing input disappears: a run
     with unresolved evidence and a clean policy result would read the same as a
     run with both. They were on the homepage; they are the machinery behind one
     sentence there, so they moved to the Handbook — where the sentence links.
     What must never happen is the count shrinking. */
  const docs = read("app/docs/core-principles/page.tsx");
  assert.match(docs, /Five independent axes/);
  for (const axis of [
    "Evidence status",
    "Policy decision",
    "Authorization status",
    "Execution status",
    "Reconciliation status",
  ]) {
    assert.match(docs, new RegExp(axis), `the Handbook omits the ${axis} axis`);
  }
  assert.ok(GUARD_AUTHORIZATION_STATUSES.includes("NOT_REQUIRED"));
  assert.doesNotMatch(docs, /Four states\.|four independent axes/i);

  /* The homepage keeps the one-line consequence and the link, not the model. */
  assert.match(HOME, /Allowed by policy means the action matched the configured rules/);
  assert.doesNotMatch(HOME, /Five independent axes/, "the axes belong in the Handbook now");
});

/** Comments explain the rules; only shipped copy is scanned against them. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * A forbidden phrase is allowed inside an explicit denial — "there is no
 * airdrop" has to be sayable, or the site cannot deny the thing it is most
 * often assumed to be doing. The window is deliberately short so a denial three
 * sentences earlier does not license a claim later.
 */
function isNegated(text, index) {
  const window = text.slice(Math.max(0, index - 90), index).toLowerCase();
  return /\bno\b|\bnot\b|\bnever\b|\bnothing\b|\bcannot\b|without\b|\bdenies\b|\bforbid/.test(window);
}

test("the site layer makes no claim the product has not earned", () => {
  const sources = withoutComments(
    [
      ...SITE_PAGES.map(([, file]) => file),
      /* The boundary sentences moved here from the Handbook chapter on
         2026-08-19. Adding the page to the sweep keeps the sentences guarded
         and puts the newest public surface under the same claim rules as the
         rest. */
      "app/security/page.tsx",
      "app/security/security-copy.ts",
      "lib/site/security.ts",
      "app/site/home.tsx",
      "app/site/chrome.tsx",
      "app/site/nav.ts",
      "app/site/truth-core.ts",
      "app/site/truth-view.ts",
      "app/site/decision-circuit.tsx",
      "app/site/glyphs.tsx",
      "app/site/orbit.tsx",
      "app/site/deck.tsx",
      "app/site/cycle.tsx",
      "app/site/product-walk.tsx",
      "app/site/parts.tsx",
      "lib/product/ecosystems.ts",
    ].map(read).join("\n"),
  );

  for (const forbidden of [
    /first-ever|the only platform|no competitors/gi,
    /guaranteed safe|prevents losses|risk-free/gi,
    /fully compliant|compliant by default|legal proof|immutable legal receipt/gi,
    /institutional-grade/gi,
    /official (?:circle|robinhood|arcus) partner|circle-backed/gi,
    /mainnet live|production-ready|production API/gi,
    /AI-approved|autonomous trading|smarter trading/gi,
    /airdrop|token sale|\bsnapshot\b/gi,
    // The category is the company's, not a venue's.
    /Ryntra exchange/gi,
  ]) {
    for (const match of sources.matchAll(forbidden)) {
      assert.ok(
        isNegated(sources, match.index),
        `unqualified claim "${match[0]}" — it may only appear inside an explicit denial`,
      );
    }
  }

  // The boundary sentences that must survive any copy edit.
  assert.match(sources, /Non-custodial/);
  assert.match(sources, /No profit promises/);
  assert.match(sources, /never asks for a seed\s*\n?\s*phrase or private key|never requests or receives a seed phrase/);
  assert.doesNotMatch(sources, /first complete|most trading tools/i);
  assert.doesNotMatch(sources, /same fields[\s\S]{0,120}same deterministic checks[\s\S]{0,120}same review/i);
  assert.doesNotMatch(sources, /everything a decision needed[\s\S]{0,120}everything that proves it/i);
});

test("every retained public composition mounts one chrome and a focusable skip target", () => {
  /* Docs routes delegate to DocsPage. Test the mounted component graph rather
     than require route-entry files to duplicate the shared chrome. */
  const compositions = [
    ["/", ["app/(home)/homepage.tsx"], "main-content"],
    ["/docs", ["app/docs/docs-page.tsx"], "main"],
    /* The public pages of the new site mount the one frame that holds the chrome and the landmark. */
    ["/company", ["app/company/page.tsx", "app/site/info/info.tsx"], "main"],
    ["/contact", ["app/contact/page.tsx", "app/site/info/info.tsx"], "main"],
  ];
  for (const [route, files, mainId] of compositions) {
    const source = files.map(read).join("\n");
    assert.equal((source.match(/<(?:PublicHeader|FrozenHeader)\b/g) ?? []).length, 1, `${route} needs one shared header`);
    assert.equal((source.match(/<FrozenFooter\b/g) ?? []).length, 1, `${route} needs one shared footer`);
    const mains = source.match(/<main\b[^>]*>/g) ?? [];
    assert.equal(mains.length, 1, `${route} needs one main landmark`);
    assert.ok(mains[0].includes(`id="${mainId}"`), `${route} needs the skip target`);
    assert.match(mains[0], /tabIndex=\{-1\}/, `${route} skip target must accept focus`);
    assert.doesNotMatch(source, /className=["'][^"']*\b(?:rx-skip|lp-skip-link)\b/, `${route} must not draw a second skip link`);
  }
  /* `/docs`, `/developers`, `/support` and the legal documents are the city's pages since CITY-157: one bar of the
     city's own, one main, none of the old site's chrome. */
  const cityPage = read("city/components/pages/DocumentPage.tsx");
  assert.equal((cityPage.match(/<main\b/g) ?? []).length, 1, "the city's page has one main landmark");
  assert.doesNotMatch(cityPage, /<(?:PublicHeader|FrozenHeader|FrozenFooter)\b/);
  for (const file of ["app/docs/page.tsx", "app/developers/page.tsx", "app/support/page.tsx", "app/legal/terms/page.tsx", "app/legal/privacy/page.tsx"]) {
    assert.match(read(file), /<CityDocument id="[a-z]+" \/>/, `${file} is the city's page`);
  }
  for (const [file, view] of [
    ["app/docs/developers/page.tsx", "developers"],
    /* The Guard reference is asserted beside it, in its own test. */
    ["app/docs/developers/agent-control/page.tsx", "agent-control"],
  ]) {
    const entry = read(file);
    /* The hub mounts the overview page; the developer references mount their
       own views. Either way one `DocsPage` composition, no page of its own. */
    const mounted = view === "guides" ? /<DocsPage view=\{\{ kind: "page", page: OVERVIEW \}\} \/>/ : new RegExp(`<DocsPage view=\{\{ kind: "${view}" \}\} />`);
    assert.match(entry, mounted, `${file} must mount the docs composition`);
    assert.doesNotMatch(entry, /<main\b|<(?:PublicHeader|FrozenHeader|FrozenFooter)\b/, `${file} must not duplicate the docs landmarks`);
  }

  /* The skip target is a prop, because four pages keep their own `main-content`
     id. The gate is that it is derived from that prop rather than hard-coded —
     a skip link pointing at an id the page does not mount is the most common
     way this control silently stops working. Read from the frozen chrome now;
     the legacy one is parked with the landing it belonged to. */
  const chrome = read("app/site/frozen/chrome.tsx");
  const header = read("app/site/frozen/public-header.tsx");
  assert.match(header, /className=\{styles\.skip\} href=\{`#\$\{mainId\}`\}/);
  assert.match(chrome, /mainId = "main"/);
  /* A page that mounts a different id must say so. The pages that own their
     content layer keep `main-content`, and each declares it. */
  for (const file of ["app/beta/page.tsx", "app/legal/(frozen)/layout.tsx"]) {
    const source = read(file);
    assert.match(source, /mainId="main-content"/, `${file} must declare the id it actually mounts`);
    assert.match(source, /id="main-content"/, `${file} must mount the id it declares`);
  }
});

test("no information depends on hover, and motion stays explanatory", () => {
  const components = [
    "app/site/home.tsx",
    "app/site/parts.tsx",
    "app/site/decision-circuit.tsx",
    "app/site/glyphs.tsx",
    "app/site/orbit.tsx",
    "app/site/deck.tsx",
    "app/site/cycle.tsx",
    "app/site/product-walk.tsx",
    "app/site/wordmark.tsx",
    "app/brand/ryntra-brand.tsx",
    "app/site/chrome.tsx",
    "app/docs/page.tsx",
    "app/docs/handbook-nav.tsx",
    "app/developers/page.tsx",
    "app/company/page.tsx",
  ].map(read).join("\n");

  // A tooltip is invisible on a touchscreen. Scope is always visible text.
  assert.doesNotMatch(components, /\btitle="/);
  // The circuit opens on click and answers the keyboard, never on pointer-over.
  const circuit = read("app/site/decision-circuit.tsx");
  assert.doesNotMatch(circuit, /onMouseEnter|onMouseOver/);
  assert.match(circuit, /ArrowDown|ArrowUp/);
  assert.match(circuit, /role="tablist"/);

  /* The walkthrough is the same contract: click and keyboard, never hover. A
     stack whose content only appears on pointer-over hides itself from every
     touchscreen and every keyboard. */
  const walk = read("app/site/product-walk.tsx");
  assert.doesNotMatch(walk, /onMouseEnter|onMouseOver/);

  /* Depth is transform and opacity only, and the cards share one grid cell so
     the stage is as tall as its tallest step. That is what stops a step change
     shifting the page under a reader's thumb. */
  const walkCss = read("app/site/walk.css");
  assert.match(walkCss, /grid-area: stack;/);
  assert.match(walkCss, /grid-template-areas: "stack";/);
  assert.doesNotMatch(
    walkCss,
    /transition:[^;]*\b(width|height|top|left|right|bottom|margin|padding)\b/,
    "the walkthrough must not transition a layout property",
  );
  // Hover affordances are gated to a fine pointer.
  assert.match(walkCss, /@media \(hover: hover\) and \(pointer: fine\)/);

  /* Before hydration the controls are absent and all five cards are linear,
     visible content. Hydration adds the stacked interaction; it never creates
     the information itself. */
  assert.match(walk, /useEffect\(\(\) => setEnhanced\(true\), \[\]\)/);
  assert.match(walk, /data-enhanced=\{enhanced \? "true" : undefined\}/);
  assert.match(walk, /aria-hidden=\{enhanced && !isActive \? true : undefined\}/);
  assert.match(walkCss, /\.rx-walk-steps \{\s*display: none;/);
  assert.match(walkCss, /\.rx-walk\[data-enhanced="true"\] \.rx-walk-steps \{\s*display: grid;/);
  assert.match(walkCss, /\.rx-walk\[data-enhanced="true"\] \.rx-walk-card \{ grid-area: stack; \}/);
  assert.doesNotMatch(walkCss, /\.rx-walk-fact:nth-child\([^)]*\) \{ transition-delay:/);

  /*
   * Every stylesheet in the layer answers the reduced-motion query, and no
   * keyframe touches a layout property. Animating width, height, top or margin
   * is what turns a premium reveal into a page that reflows while it is being
   * read — and on a long page, into a scrollbar that flickers in and out.
   */
  for (const sheet of [
    "app/site/site.css",
    "app/site/motion.css",
    "app/site/module.css",
    "app/site/walk.css",
    "app/brand/brand.css",
  ]) {
    const css = read(sheet);
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\)/,
      `${sheet} must answer prefers-reduced-motion`,
    );
    for (const [, body] of css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)) {
      assert.doesNotMatch(
        body,
        /\n\s*(width|height|top|left|right|bottom|margin|padding)\s*:/,
        `${sheet}: a keyframe animates a layout property`,
      );
    }
  }

  const motion = read("app/site/motion.tsx");
  const motionCss = read("app/site/motion.css");
  assert.doesNotMatch(motion, /requestAnimationFrame\(tick\)/, "the site must not run an idle infinite frame loop");
  assert.match(motion, /window\.addEventListener\("scroll", scheduleRail, \{ passive: true \}\)/);
  assert.doesNotMatch(motionCss, /rx-ledger-in/, "recorded proof values must never assemble by animation");
  assert.doesNotMatch(
    motionCss,
    /\.rx-cursor\s*\{[^}]*transition:[^;]*(?:width|height|border-width)/,
    "the cursor must keep a fixed footprint",
  );
  assert.doesNotMatch(motionCss, /\.rx-navitem\s*\{[^}]*padding-inline-start[^}]*transition:/);
  assert.match(read("app/site/site.css"), /@media \(max-width: 420px\)[\s\S]*?\.rx-header-cta > \.rx-btn--primary \{ display: none; \}/);
});

test("no reveal can leave content permanently hidden", () => {
  /*
   * The motion layer hides every revealable the moment it takes over, and only
   * the observer brings them back. Anything that stops the observer from
   * delivering — a tab that is never composited, a throttle, a browser quirk —
   * would leave the whole page below the hero blank with no error to explain
   * it. Two guarantees, asserted here because neither is visible in review:
   * the hidden state is applied only after the observer is genuinely running,
   * and a timer reveals everything unconditionally regardless.
   */
  const motion = read("app/site/motion.tsx");
  assert.match(motion, /const failsafe = window\.setTimeout/);
  assert.match(motion, /for \(const el of revealables\) el\.dataset\.rxIn = "true";/);
  assert.match(motion, /window\.clearTimeout\(failsafe\)/);

  // The hidden state is switched on after observation is set up, never before.
  const observeAt = motion.indexOf("observer.observe(el)");
  const hideAt = motion.indexOf('root.classList.add("rxm")');
  assert.ok(observeAt > 0 && hideAt > observeAt, "content is hidden before the observer runs");

  // And a failure anywhere in that setup takes the hidden state back off.
  assert.match(motion, /catch \{\s*root\.classList\.remove\("rxm"\);/);

  // Reduced motion never reaches any of it.
  assert.match(motion, /if \(reduced\.matches\) return;/);
});

test("the hero composition says exactly what it is", () => {
  /*
   * The one lie a product surface cannot survive is presenting a rendering as a
   * live session. The walkthrough's own frame label says `Sample walkthrough`,
   * and the note under it states that the full sequence is not shipped as one
   * flow — which is true, and is the reason the label is there.
   */
  const walk = read("app/site/product-walk.tsx");
  assert.match(walk, /Sample walkthrough/);
  assert.match(walk, /not a live session/i);
  assert.match(walk, /not shipped as one flow/i);

  // Values arrive as props from the resolved model; none is typed in here.
  assert.doesNotMatch(walk, /0x[0-9a-f]{16,}/i);
  assert.doesNotMatch(walk, /\brcpt_[0-9a-f]+|\bint_[0-9a-f]+/);

  // Five real steps, in the order a decision actually goes.
  const truth = getSiteTruth();
  assert.match(HOME, /<ProductWalk steps=\{truth\.walkthrough\} \/>/);
  assert.equal(truth.walkthrough[0].name, "Understand");
  assert.equal(truth.walkthrough.at(-1).name, "Review");
});

test("Ryn never becomes a signing authority, wherever it is offered", () => {
  /* Ryn is a header button and a panel now, and the
     eleven-page rail carries the destinations the Home panel used to list.
     What survives the move is the boundary this test exists for — the surfaces
     that ask for a signature must not wear a mascot beside the approval, and
     the product must not have grown a chat that pretends to advise. */
  const overview = read("app/solana/workspace/holdings/holdings-card.tsx");
  assert.doesNotMatch(overview, /signTransaction\(|sendTransaction\(|signTypedData\(|eth_sendTransaction|<textarea|useChat\(/);

  for (const file of [
    "app/solana/workspace/send/send-card.tsx",
    "app/solana/workspace/trade/swap-card.tsx",
    "app/solana/workspace/bridge/bridge-card.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /ryn-[a-z]+\.webp|<Ryn(?:\s|\/>|>)|<Raven\b|rx-ryn/, `${file} must not add a mascot beside approval`);
  }
  for (const file of ["app/(home)/homepage.tsx", "app/(home)/landing-copy.ts", "app/company/page.tsx", "app/company/company-copy.ts"]) {
    assert.doesNotMatch(read(file), /ryn-[a-z]+\.webp|rx-ryn/, `${file} must not restore the retired mascot chapter`);
  }
});

test("every section is a bounded module, and the banners say something true", () => {
  /*
   * An open section reads as text followed by more text; a reader never
   * registers arriving somewhere new. Every section is a plate with a bar
   * carrying its index and subject, and the head is two columns — a heading
   * alone on the left with an empty right half is the exact lopsided shape
   * that collapses a premium layout into a blog post.
   */
  const parts = read("app/site/parts.tsx");
  assert.match(parts, /className="rx-mod"/);
  assert.match(parts, /className="rx-mod-bar"/);
  assert.match(parts, /rx-mod-tick--tr/);
  assert.match(parts, /rx-mod-tick--bl/);

  const plate = read("app/site/module.css");
  assert.match(plate, /\.rx-head \{[\s\S]*?grid-template-columns: minmax\(0, 1\.08fr\) minmax\(0, 0\.92fr\);/);
  assert.match(plate, /clip-path: polygon/);

  /*
   * The marquees are the argument, not decoration: stages that are genuinely
   * proven are lit from the resolved state, and nothing in the banner types a
   * label of its own.
   */
  const banner = read("app/site/banner.tsx");
  assert.match(banner, /const PROVEN: readonly string\[\] = \["live", "testnet_verified"\];/);
  assert.match(banner, /data-proven=\{/);
  assert.match(banner, /stage\.stateLabel|environment\.stateLabel/);
  /*
   * What is asserted now is that every guard that
   * made a marquee acceptable came back with it: the loop is slow, it pauses
   * under the pointer and under keyboard focus, the seam-hiding duplicate pass
   * is aria-hidden so the list is announced once, and reduced motion restores
   * the static scrollable strip.
   */
  assert.match(banner, /aria-hidden=\{true\}/, "the duplicate pass must hide from assistive tech");
  assert.match(plate, /\.rx-banner-belt \{[\s\S]*?animation: rx-marquee \d+s linear infinite;/);
  assert.match(plate, /@keyframes rx-marquee/);
  assert.match(
    plate,
    /\.rx-banner:hover \.rx-banner-belt,[\s\S]*?\.rx-banner:focus-within \.rx-banner-belt \{ animation-play-state: paused; \}/,
    "the belt must pause under pointer and focus",
  );
  assert.match(
    plate,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.rx-banner \{ overflow-x: auto;[\s\S]*?\.rx-banner-belt \{ animation: none; \}[\s\S]*?\.rx-banner-track\[aria-hidden="true"\] \{ display: none; \}/,
    "reduced motion must restore the static scrollable band",
  );
  assert.match(banner, /tabIndex=\{0\}/);
  assert.match(banner, /role="group"/);
  /* Every infinite animation in the site layer is on this allowlist. Content
     never depends on any of them, and each answers reduced motion. The orbit
     name recurs (belt and un-spinner share the keyframes), so names are
     deduplicated before the comparison. */
  const motion = read("app/site/motion.css");
  const site = read("app/site/site.css");
  const infinite = [
    ...new Set(
      [...`${plate}\n${motion}\n${site}`.matchAll(/animation(?:-name)?:[^;]*\b(rx-[a-z-]+)[^;]*\binfinite\b/g)]
        .map((m) => m[1]),
    ),
  ].sort();
  assert.deepEqual(
    infinite,
    ["rx-drift-a", "rx-drift-b", "rx-marquee", "rx-orbit-spin", "rx-pulse"],
    `an infinite animation appeared outside the allowlist: ${infinite.join(", ")}`,
  );
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.rx-flow-list::after \{ display: none; \}/);
});
