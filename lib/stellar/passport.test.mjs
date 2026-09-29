// Run from repo root: node --test lib/stellar/passport.test.mjs
//
// The Passport's job is to be honest about a mixture of sources, so these guard
// the mixture: that a declaration never renders with the authority of a ledger
// fact, that a failed section degrades alone, that the unknowns list is computed
// rather than remembered, and that no score exists anywhere.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStellarToml, findCurrency, readOrganization, fetchStellarToml } from "./toml.ts";
import { buildAssetPassport } from "./passport.ts";
import { parseAsset } from "./asset.ts";
import { STELLAR_MAINNET } from "./network.ts";
import { isResolved } from "./evidence.ts";
import {
  FIXTURE_HORIZON_ISSUER_ACCOUNT,
  FIXTURE_HORIZON_ASSET,
  FIXTURE_HORIZON_LEDGERS,
  FIXTURE_NOW,
  USDC_ISSUER,
  USDC_CONTRACT,
  stubFetch,
} from "./fixtures.ts";

const USDC = parseAsset(`USDC:${USDC_ISSUER}`).asset;

/** The shape Etherfuse actually serves, trimmed. Recorded 2026-08-13. */
const TOML = `# a comment
[DOCUMENTATION]
ORG_NAME = "Etherfuse"
ORG_URL = "https://etherfuse.com"

[[CURRENCIES]]
code = "USDC"
issuer = "${USDC_ISSUER}"
name = "Test USDC"
desc = "A description with a # inside it"
is_asset_anchored = true
anchor_asset_type = "bond"
anchor_asset = "US Treasury Notes"
status = "live"
attestation_of_reserve = "https://example.test/proof"
redemption_instructions = "Redeem at example.test"

[[CURRENCIES]]
code = "OTHER"
issuer = "GDIEKKIQWMIZ4LD3RP3ABPN7X5KEAEWYMR634BRHB7EULIMEVREWLF3G"
name = "Another asset"
`;

const routes = (extra = []) => [
  ...extra,
  { match: "/.well-known/stellar.toml", rawBody: TOML },
  { match: "/accounts/", body: FIXTURE_HORIZON_ISSUER_ACCOUNT },
  { match: "/ledgers", body: FIXTURE_HORIZON_LEDGERS },
  { match: "/assets", body: FIXTURE_HORIZON_ASSET },
];
const build = (extra = []) => buildAssetPassport(STELLAR_MAINNET, USDC, { fetchImpl: stubFetch(routes(extra)), now: FIXTURE_NOW });

// ----------------------------------------------------------------- toml --

test("the parser reads the SEP-1 subset the document actually uses", () => {
  const parsed = parseStellarToml(TOML);
  assert.ok(parsed.ok);
  assert.equal(parsed.toml.sections.DOCUMENTATION.ORG_NAME, "Etherfuse");
  assert.equal(parsed.toml.arrays.CURRENCIES.length, 2);
  assert.equal(parsed.toml.arrays.CURRENCIES[0].is_asset_anchored, true, "booleans are booleans, not the string \"true\"");
});

test("a hash inside a quoted value is data, not a comment", () => {
  const parsed = parseStellarToml(TOML);
  assert.match(String(parsed.toml.arrays.CURRENCIES[0].desc), /# inside it/);
});

test("a currency is matched by code and issuer together, never by code", () => {
  const parsed = parseStellarToml(TOML);
  assert.ok(findCurrency(parsed.toml, "USDC", USDC_ISSUER));
  /* The same code issued by somebody else must not match. This is the whole
     reason an asset identity is a pair. */
  assert.equal(findCurrency(parsed.toml, "USDC", "GDIEKKIQWMIZ4LD3RP3ABPN7X5KEAEWYMR634BRHB7EULIMEVREWLF3G"), null);
  assert.equal(readOrganization(parsed.toml).name, "Etherfuse");
});

test("the parser refuses structure it does not understand", () => {
  for (const bad of ["a line with no equals sign", 'k = """never closed', "[unclosed section"]) {
    assert.equal(parseStellarToml(bad).ok, false, `"${bad}" must be refused`);
  }
});

test("an unsupported value skips its own key and keeps the rest", () => {
  /* Arrays and inline tables appear in real stellar.toml files for fields this
     Passport never reads. Losing one of those must not cost every field we do
     read — but it must also never invent a value for the one it skipped. */
  const parsed = parseStellarToml('skipped = [1, 2]\nkept = "yes"');
  assert.ok(parsed.ok);
  assert.equal(parsed.toml.root.kept, "yes");
  assert.equal("skipped" in parsed.toml.root, false);
});

test("a domain that is not a domain is refused before any request", async () => {
  let called = false;
  const answer = await fetchStellarToml("not a domain", {
    fetchImpl: (() => { called = true; return Promise.resolve(new Response("")); }),
  });
  assert.equal(answer.ok, false);
  assert.equal(called, false);
});

// -------------------------------------------------------------- passport --

test("the passport composes every section from the adapter", async () => {
  const passport = await build();
  assert.equal(passport.network, "stellar:mainnet");
  for (const key of ["issuerControls", "statistics", "ledgerParameters", "holdingDemand", "declaration"]) {
    assert.ok(isResolved(passport[key]), `${key} should resolve from the fixtures`);
  }
});

test("the identity is completed from the statistics read, not fetched twice", async () => {
  const passport = await build();
  assert.equal(passport.asset.model, "SAC", "discovering a contract id makes it a SAC");
  assert.equal(passport.asset.contractId, USDC_CONTRACT);
  assert.equal(passport.asset.code, "USDC", "and it stays the same asset");
});

test("holding demand is derived from the issuer's flags and the ledger's reserve", async () => {
  const passport = await build();
  assert.ok(isResolved(passport.holdingDemand));
  const demand = passport.holdingDemand.data;
  assert.equal(demand.trustlineRequired, true);
  assert.equal(demand.freezable, true, "the fixture issuer has auth_revocable set");
  assert.equal(demand.clawbackable, false);
  assert.equal(demand.reserveXlm, "0.5000000", "read from the ledger, never hardcoded");
  assert.deepEqual(passport.holdingDemand.sources, passport.issuerControls.sources, "a derivation carries its inputs' provenance");
});

test("a section that fails degrades alone", async () => {
  /* The property that makes a mixed-source page trustworthy: one refusing
     source must not blank the page or, worse, quietly drop a section. */
  const passport = await buildAssetPassport(STELLAR_MAINNET, USDC, {
    fetchImpl: stubFetch([{ match: "/.well-known/stellar.toml", status: 403 }, ...routes()]),
    now: FIXTURE_NOW,
  });
  assert.equal(passport.declaration.state, "UNAVAILABLE");
  assert.match(passport.declaration.reason, /403/);
  assert.ok(isResolved(passport.issuerControls), "the chain sections are unaffected");
  assert.ok(isResolved(passport.statistics));
});

test("an issuer with no home domain is a fact, not a failure", async () => {
  const noDomain = { ...FIXTURE_HORIZON_ISSUER_ACCOUNT, home_domain: undefined };
  const passport = await buildAssetPassport(STELLAR_MAINNET, USDC, {
    fetchImpl: stubFetch([{ match: "/accounts/", body: noDomain }, ...routes()]),
    now: FIXTURE_NOW,
  });
  assert.equal(passport.declaration.state, "UNKNOWN");
  assert.match(passport.declaration.reason, /publishes no home domain/);
});

test("a domain that serves a valid document without declaring the asset says so", async () => {
  const otherOnly = TOML.replace(`code = "USDC"`, `code = "SOMETHINGELSE"`);
  const passport = await buildAssetPassport(STELLAR_MAINNET, USDC, {
    fetchImpl: stubFetch([{ match: "/.well-known/stellar.toml", rawBody: otherOnly }, ...routes()]),
    now: FIXTURE_NOW,
  });
  assert.ok(isResolved(passport.declaration));
  assert.equal(passport.declaration.data.declaresThisAsset, false);
  assert.equal(passport.declaration.data.currency, null);
});

test("the unknowns rail is computed from actual section states", async () => {
  const passport = await build();
  const fields = passport.unknowns.map((item) => item.field);
  /* Exactly the three that are genuinely not built — nothing hand-listed, and
     nothing missing. */
  assert.deepEqual(fields.sort(), ["Liquidity and routes", "Oracle", "Portfolio impact"]);
  for (const item of passport.unknowns) assert.ok(item.reason.length > 20, `${item.field} must explain itself`);

  const degraded = await buildAssetPassport(STELLAR_MAINNET, USDC, {
    fetchImpl: stubFetch([{ match: "/.well-known/stellar.toml", status: 403 }, ...routes()]),
    now: FIXTURE_NOW,
  });
  assert.equal(degraded.unknowns.length, 4, "a section that stops resolving joins the rail without anyone editing it");
  assert.ok(degraded.unknowns.some((item) => item.field === "Issuer declaration"));
});

test("the unbuilt sections state their reason instead of rendering blank", async () => {
  const passport = await build();
  assert.match(passport.oracle.reason, /without a source and a timestamp/);
  assert.match(passport.liquidity.reason, /never produce them/);
  assert.match(passport.portfolioImpact.reason, /connected wallet/);
});

// -------------------------------------------------------- honesty rules --

test("no composite score exists anywhere in the passport or its page", () => {
  /* Comments are stripped first. The rule is about what the code produces, and
     the prose that explains why there is no score would otherwise trip the
     check that enforces it — which it did, on the first run. */
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const path of ["lib/stellar/passport.ts", "app/stellar/workspace/assets/[asset]/page.tsx"]) {
    const code = strip(readFileSync(path, "utf8"));
    assert.doesNotMatch(code, /\bscore\b/i, `${path} must not introduce a score`);
    assert.doesNotMatch(code, /\bsafe(ty)?\s*(rating|level|verdict)\b/i, `${path} must not rate safety`);
    assert.doesNotMatch(code, /\b(rating|grade|rank)\s*[:=]/i, `${path} must not compute a rating`);
  }
});

test("the page labels issuer-declared fields as the issuer's own words", () => {
  const page = readFileSync("app/stellar/workspace/assets/[asset]/page.tsx", "utf8");
  assert.match(page, /the issuer describing\s*\n?\s*itself|issuer describing itself/);
  /* Whitespace-tolerant for the same reason the line above already is: the note
     is one sentence in the source and the formatter is free to wrap it wherever
     it likes. A claims gate that fails on a line break trains the next reader to
     treat a red claims test as noise, which is the one test that must never
     cry wolf. The assertion is unchanged in substance — the standing note has
     to be on the page. */
  assert.match(page, /has not verified any\s+reserve/);
  /* And it must never present a declaration as a checked fact. */
  assert.doesNotMatch(page, /Verified backing|Backed by <\//);
});

test("the page offers no action and never says holders are people", () => {
  const page = readFileSync("app/stellar/workspace/assets/[asset]/page.tsx", "utf8");
  assert.match(page, /Holder addresses/);
  assert.doesNotMatch(page, /\b(people|investors|buyers) (bought|hold|own)\b/i);
  /* Read-only means there is nothing to press: no form, no submit, no connect. */
  assert.doesNotMatch(page, /<form|onSubmit|Connect wallet|useState/);
});

test("a code-only or issuerless identifier cannot render a passport", () => {
  const page = readFileSync("app/stellar/workspace/assets/[asset]/page.tsx", "utf8");
  assert.match(page, /if \(!asset \|\| asset\.native \|\| !asset\.issuer\) notFound\(\);/);
});
