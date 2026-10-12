// Run from repo root: node --test app/stellar/stellar.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { STELLAR_DESTINATIONS } from "./destinations.ts";
import { PUBLIC_CAPABILITIES, productCapabilityById } from "../../lib/product/capabilities.ts";
import { STATE_LABEL } from "../site/truth-view.ts";

const repo = (path) => new URL("../../" + path, import.meta.url);
const read = (path) => readFileSync(repo(path), "utf8");
const exists = (path) => existsSync(repo(path));

const PAGE = read("app/stellar/page.tsx");

/**
 * The source with comments removed.
 *
 * Three separate tests in this repository have failed against the paragraph
 * explaining the very defect they guard. A regex over source matches comments,
 * always, so they come off before anything is asserted.
 */
const BODY = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Resolve a public href to the route file that serves it, or `null`.
 *
 * Walks real directories rather than a hand-written list of routes, and steps
 * into a dynamic segment when no literal directory matches — which is how the
 * Passport URL, whose last segment is an encoded `CODE:ISSUER`, resolves to
 * `[asset]`.
 */
function mountedRouteFile(href) {
  const path = href.split(/[#?]/)[0];
  let dir = "app";
  for (const segment of path.split("/").filter(Boolean)) {
    if (exists(`${dir}/${segment}`)) {
      dir = `${dir}/${segment}`;
      continue;
    }
    const dynamic = readdirSync(repo(dir), { withFileTypes: true })
      .find((entry) => entry.isDirectory() && /^\[.*\]$/.test(entry.name));
    if (!dynamic) return null;
    dir = `${dir}/${dynamic.name}`;
  }
  return exists(`${dir}/page.tsx`) ? `${dir}/page.tsx` : null;
}

test("every destination the page offers is a route that is actually mounted", () => {
  const entries = Object.entries(STELLAR_DESTINATIONS);
  assert.ok(entries.length >= 6, "the destination list emptied out");

  for (const [name, href] of entries) {
    assert.match(href, /^\//, `${name}: internal destinations only`);
    assert.ok(mountedRouteFile(href), `${name}: ${href} resolves to no mounted page`);
  }

  /* The gate, proven rather than asserted. These are the two URLs the page's
     brief named, and the reason the page does not use them: `/developers`
     carries no Stellar section, and a receipt is verified by pasting the
     document rather than by id. If the resolver ever returns a file for either,
     it has stopped being able to see a dead link at all. */
  assert.equal(mountedRouteFile("/stellar/receipts/0a1b2c3d"), null);
  assert.equal(mountedRouteFile("/developers/stellar"), null);
});

test("every in-page anchor lands on a section this page actually renders", () => {
  /* The previous site carried a header link to `#how`, an id no section
     rendered. Nothing threw and nothing looked broken; the link simply did
     nothing for every visitor who asked the most basic question a site has. */
  const anchors = [...BODY.matchAll(/href="#([a-z0-9-]+)"/g)].map((match) => match[1]);
  const ids = new Set([...BODY.matchAll(/\bid="([a-z0-9-]+)"/g)].map((match) => match[1]));

  assert.ok(anchors.length > 0, "the page offers no in-page anchor — drop this gate if that is deliberate");
  for (const anchor of anchors) {
    assert.ok(ids.has(anchor), `#${anchor} is linked but no section renders that id`);
  }
});

test("a page built from the site primitives renders inside the site token scope", () => {
  /* Found by measuring the rendered page, because nothing else can see it:
     `--fg`, `--ink` and `--cyan` are declared on `.rx, .rx-header, .rx-footer`,
     so the chrome resolved them and `<main>` did not. An undefined custom
     property does not fall back — the declaration is dropped — so the primary
     call to action computed a transparent background and rendered as plain
     text, and the page lost its background, its drawn grid and every reveal.

     Typecheck, lint, the suite and the build were all green over it. */
  assert.ok(BODY.includes('<div className="rx">'), "the page is not inside the .rx token scope");
  assert.match(BODY, /rx-(section|ledger|btn|pagehero)/, "if the page stops using the site primitives, drop this gate");

  /* Proven by the shape of the defect rather than trusted: a fragment root with
     the chrome inside it is exactly what this page shipped, and it must not
     read as satisfying the rule. */
  const fragmentRoot = /return \(\s*<>\s*<SiteHeader/;
  assert.doesNotMatch(BODY, fragmentRoot, "the chrome sits in a fragment again, outside any token scope");
});

test("every state on the page is the registry's, and none is written into the page", () => {
  /* The failure this prevents is specific and has happened here: four
     surfaces of an earlier hub carried a hard-coded state with no registry
     entry behind them, so they skipped the freshness gate every other claim
     passes through. */
  for (const label of Object.values(STATE_LABEL)) {
    assert.ok(
      !BODY.includes(label),
      `«${label}» is written into the page — states come from publicCapabilityRow, not from prose`,
    );
  }
  assert.match(BODY, /publicCapabilityRow\(/, "the page no longer resolves any state from the registry");
});

test("the page states every registered Stellar capability, and invents none", () => {
  const registered = PUBLIC_CAPABILITIES
    .filter((capability) => capability.id.startsWith("stellar-"))
    .map((capability) => capability.id);

  assert.ok(registered.length >= 6, `only ${registered.length} Stellar capabilities are registered`);

  for (const id of registered) {
    assert.ok(BODY.includes(`"${id}"`), `${id} is registered but never stated on /stellar`);
  }

  const stated = [...BODY.matchAll(/publicCapabilityRow\("([^"]+)"\)/g)].map((match) => match[1]);
  for (const id of stated) {
    assert.ok(registered.includes(id), `${id} is stated on /stellar but is not a registered Stellar capability`);
  }
});

test("the proven transaction on the page is the one the registry holds evidence for", () => {
  const lifecycle = productCapabilityById("stellar-testnet-payment-lifecycle");
  const evidence = lifecycle.evidence.public.find((item) => item.kind === "official_source");
  assert.ok(evidence, "the proven lifecycle carries no public explorer evidence");

  const onPage = BODY.match(/transactionHash: "([0-9a-f]{64})"/);
  assert.ok(onPage, "the page states no transaction hash");
  assert.ok(
    evidence.reference.endsWith(onPage[1]),
    "the hash on /stellar and the hash the registry can prove have drifted apart",
  );
  assert.equal(lifecycle.maturity, "testnet", "the signed lifecycle must never be promoted past testnet here");
});

test("route evidence and policy are stated as unbuilt, beside the work that is built", () => {
  assert.equal(productCapabilityById("stellar-route-evidence").maturity, "planned");
  assert.equal(productCapabilityById("stellar-policy-evaluation").maturity, "planned");

  /* Soroswap must never sit beside a word that reads as shipped. The card says
     what is true instead, and the page says why every receipt currently carries
     a null policy version. */
  assert.match(BODY, /Soroswap[\s\S]{0,600}?Not integrated\./);
  assert.match(BODY, /policyVersion/);

  // The unbuilt stage stays on the lifecycle diagram rather than being removed.
  assert.match(BODY, /id: "policy",[\s\S]{0,160}built: false/);
});

test("no claim on the page exceeds what this product has proven", () => {
  const forbidden = [
    /\bthe (?:first|only)\b/i,
    /\bsafe\b/i,
    /\bguarantee/i,
    /\binstitutional[- ]grade\b/i,
    /\bofficial partner\b/i,
    /\ball-in-one\b/i,
    /\bsuper app\b/i,
    /\bfully (?:audited|compliant)\b/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(BODY, pattern, `forbidden claim shape ${pattern} on /stellar`);
  }

  // Etherfuse is read from public data. Saying otherwise is the one claim a
  // reviewer is most able to check.
  assert.match(BODY, /Etherfuse is demonstrated, not integrated/);
  assert.ok(!/Etherfuse[^.]{0,80}\bAPI\b/i.test(BODY), "an Etherfuse API integration is implied");
});
