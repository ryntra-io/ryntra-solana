// Run from repo root: node --test lib/stellar/stellar.test.mjs
//
// These guard the properties that make a read adapter trustworthy rather than
// merely working: a value can never appear without a source, every failure
// resolves to an honest unavailable instead of a default, an asset is never
// identified by code alone, and nothing here can sign or submit.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { isResolved, resolved, unavailable, unknown, conflicting, mapEvidence, toEnvelope } from "./evidence.ts";
import { parseAsset, formatAsset, withContractId, sameAsset, NATIVE_ASSET, isAccountAddress, isContractAddress } from "./asset.ts";
import { STELLAR_TESTNET, STELLAR_MAINNET, STELLAR_NETWORKS, stellarNetwork, stellarSourceRef } from "./network.ts";
import { stellarRpc, horizonGet, ALLOWED_RPC_METHODS, REFUSED_RPC_METHODS, DEFAULT_LIMITS } from "./client.ts";
import {
  readNetworkPulse,
  readLedgerParameters,
  readIssuerControls,
  readHoldingRequirement,
  readAssetStatistics,
  readContractTokenMetadata,
} from "./reads.ts";
import {
  FIXTURE_RPC_GET_NETWORK,
  FIXTURE_RPC_HEALTH,
  FIXTURE_HORIZON_LEDGERS,
  FIXTURE_HORIZON_ISSUER_ACCOUNT,
  FIXTURE_HORIZON_HOLDER_ACCOUNT,
  FIXTURE_HORIZON_BARE_ACCOUNT,
  FIXTURE_HORIZON_ASSET,
  FIXTURE_NOW,
  USDC_ISSUER,
  USDC_CONTRACT,
  stubFetch,
} from "./fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const USDC = parseAsset(`USDC:${USDC_ISSUER}`).asset;
const opts = (fetchImpl) => ({ fetchImpl, now: FIXTURE_NOW });

// ------------------------------------------------------------- networks --

test("every network carries a complete, self-consistent identity", () => {
  for (const network of STELLAR_NETWORKS) {
    assert.match(network.id, /^stellar:(testnet|mainnet)$/);
    assert.match(network.passphrase, /Network ; September 2015$/);
    assert.match(network.rpcUrl, /^https:\/\//);
    assert.match(network.horizonUrl, /^https:\/\//);
    assert.match(network.explorerBase, /^https:\/\//);
  }
  assert.equal(STELLAR_TESTNET.ephemeral, true, "testnet resets and nothing may depend on its state persisting");
  assert.equal(STELLAR_MAINNET.ephemeral, false);
  assert.notEqual(STELLAR_TESTNET.passphrase, STELLAR_MAINNET.passphrase);
  assert.equal(stellarNetwork("stellar:mainnet"), STELLAR_MAINNET);
  assert.throws(() => stellarNetwork("stellar:nope"), /Unknown Stellar network/);
});

test("a source reference names the network, so two networks cannot be confused later", () => {
  const ref = stellarSourceRef(STELLAR_TESTNET, "horizon", "/accounts/G…");
  assert.equal(ref, "stellar:testnet:horizon:/accounts/G…");
  assert.notEqual(ref, stellarSourceRef(STELLAR_MAINNET, "horizon", "/accounts/G…"));
});

// ------------------------------------------------------------- evidence --

test("freshness is computed from the observation, never asserted by a caller", () => {
  const sources = [{ ref: "r", label: "l" }];
  const fresh = resolved({ data: 1, sources, observedAt: "2026-08-12T23:10:30Z", maxAgeSeconds: 60, now: FIXTURE_NOW });
  assert.equal(fresh.state, "FRESH");
  assert.equal(fresh.ageSeconds, 30);

  const stale = resolved({ data: 1, sources, observedAt: "2026-08-12T23:00:00Z", maxAgeSeconds: 60, now: FIXTURE_NOW });
  assert.equal(stale.state, "STALE");
  assert.equal(stale.ageSeconds, 660);
});

test("a source clock ahead of ours is a skew, not extra freshness", () => {
  /* A negative age would invite arithmetic on it and would read as "fresher
     than possible". It clamps to zero and stays FRESH, which is honest. */
  const ahead = resolved({
    data: 1,
    sources: [{ ref: "r", label: "l" }],
    observedAt: "2026-08-12T23:20:00Z",
    maxAgeSeconds: 60,
    now: FIXTURE_NOW,
  });
  assert.equal(ahead.ageSeconds, 0);
  assert.equal(ahead.state, "FRESH");
});

test("an unresolved value exposes no data and always states a reason", () => {
  for (const evidence of [
    unavailable("endpoint refused", [], FIXTURE_NOW),
    unknown("no source exists", [], FIXTURE_NOW),
    conflicting("two sources disagreed", [{ ref: "a", label: "a" }], FIXTURE_NOW),
  ]) {
    assert.equal(isResolved(evidence), false);
    assert.equal(evidence.data, null);
    assert.ok(evidence.reason.length > 0, "a failure that does not say why is a failure twice");
    assert.ok(evidence.observedAt);
  }
});

test("provenance survives derivation", () => {
  const base = resolved({ data: 10, sources: [{ ref: "r", label: "l" }], observedAt: FIXTURE_NOW, maxAgeSeconds: 60, now: FIXTURE_NOW });
  const derived = mapEvidence(base, (value) => value * 2);
  assert.ok(isResolved(derived));
  assert.equal(derived.data, 20);
  assert.deepEqual(derived.sources, base.sources);
  /* And an unresolved value maps to itself rather than inventing a mapped one. */
  const missing = mapEvidence(unavailable("nope", [], FIXTURE_NOW), (value) => value * 2);
  assert.equal(missing.state, "UNAVAILABLE");
});

test("the wire envelope always carries data, sources, as_of and state", () => {
  const wire = toEnvelope(resolved({ data: { a: 1 }, sources: [{ ref: "r", label: "l" }], observedAt: FIXTURE_NOW, maxAgeSeconds: 60, now: FIXTURE_NOW }));
  assert.deepEqual(Object.keys(wire).sort(), ["as_of", "data", "sources", "state"]);
  const failed = toEnvelope(unavailable("down", [], FIXTURE_NOW));
  assert.equal(failed.data, null);
  assert.ok(failed.reason);
});

// ---------------------------------------------------------------- asset --

test("an asset is never identified by code alone", () => {
  const bare = parseAsset("USDC");
  assert.equal(bare.ok, false);
  assert.match(bare.reason, /names no issuer/);
  assert.match(bare.reason, /CODE:ISSUER/);
});

test("identity round-trips across every accepted form", () => {
  for (const input of ["native", "XLM", `USDC:${USDC_ISSUER}`, `LONGASSET12:${USDC_ISSUER}`, USDC_CONTRACT]) {
    const parsed = parseAsset(input);
    assert.ok(parsed.ok, `${input} should parse`);
    const again = parseAsset(formatAsset(parsed.asset));
    assert.ok(again.ok);
    assert.ok(sameAsset(parsed.asset, again.asset), `${input} must survive a round trip`);
  }
  assert.equal(parseAsset("native").asset.native, true);
  assert.equal(parseAsset("XLM").asset.decimals, 7);
});

test("malformed identities are refused, never repaired", () => {
  for (const input of ["", "   ", "USDC:", ":GABC", "USDC:not-an-address", `TOOLONGASSETCODE:${USDC_ISSUER}`, `US-DC:${USDC_ISSUER}`]) {
    const parsed = parseAsset(input);
    assert.equal(parsed.ok, false, `"${input}" must be refused`);
    assert.ok(parsed.reason.length > 0);
  }
});

test("a bare contract address is the cautious model until something proves otherwise", () => {
  /* SEP41 rather than SAC: a SAC has a classic issuer with freeze and clawback
     powers, and assuming that from an address alone would be a guess about
     who can take the holder's asset. */
  const parsed = parseAsset(USDC_CONTRACT);
  assert.ok(parsed.ok);
  assert.equal(parsed.asset.model, "SEP41");
  assert.equal(parsed.asset.decimals, null, "an unread decimals is null, never a default of 7");
});

test("attaching a contract id keeps it the same asset", () => {
  const sac = withContractId(USDC, USDC_CONTRACT);
  assert.equal(sac.model, "SAC");
  assert.equal(sac.code, "USDC");
  assert.equal(sac.issuer, USDC_ISSUER);
  assert.ok(sameAsset(USDC, sac), "the classic asset and its SAC are one asset reachable two ways");
  assert.throws(() => withContractId(USDC, "not-a-contract"), /not a valid Stellar contract address/);
});

test("address shapes are checked, not assumed", () => {
  assert.ok(isAccountAddress(USDC_ISSUER));
  assert.ok(isContractAddress(USDC_CONTRACT));
  assert.equal(isAccountAddress(USDC_CONTRACT), false);
  assert.equal(isContractAddress(USDC_ISSUER), false);
  assert.equal(isAccountAddress("GABC"), false, "right prefix, wrong length");
  assert.equal(isAccountAddress(`G${"1".repeat(55)}`), false, "1 is not in the base32 alphabet");
});

// --------------------------------------------------------------- client --

test("the client is a read boundary and refuses submission by name", () => {
  for (const method of REFUSED_RPC_METHODS) {
    assert.equal(ALLOWED_RPC_METHODS.includes(method), false, `${method} must never be allowlisted`);
  }
  assert.ok(REFUSED_RPC_METHODS.includes("sendTransaction"));
});

test("a submission attempt is refused before any network call happens", async () => {
  let called = false;
  const answer = await stellarRpc(STELLAR_MAINNET.rpcUrl, "sendTransaction", {}, {
    fetchImpl: (() => { called = true; return Promise.resolve(new Response("{}")); }),
  });
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /never submits/);
  assert.equal(called, false, "the refusal must happen before the request, not after it");
});

test("every transport failure becomes a reason rather than an exception", async () => {
  const cases = [
    { name: "non-200", route: { match: "getNetwork", status: 503, body: {} }, expect: /HTTP 503/ },
    { name: "not JSON", route: { match: "getNetwork", rawBody: "<html>down</html>" }, expect: /not JSON/ },
    { name: "oversized", route: { match: "getNetwork", rawBody: `{"x":"${"a".repeat(400)}"}` }, expect: /over the .* limit/ },
  ];
  for (const testCase of cases) {
    const limits = testCase.name === "oversized" ? { ...DEFAULT_LIMITS, maxBytes: 100 } : DEFAULT_LIMITS;
    const answer = await stellarRpc(STELLAR_MAINNET.rpcUrl, "getNetwork", {}, { fetchImpl: stubFetch([testCase.route]), limits });
    assert.equal(answer.ok, false, `${testCase.name} must fail closed`);
    assert.match(answer.reason, testCase.expect);
  }
});

test("a hanging source is abandoned at the timeout, not waited on", async () => {
  const answer = await stellarRpc(STELLAR_MAINNET.rpcUrl, "getNetwork", {}, {
    fetchImpl: stubFetch([{ match: "getNetwork", hang: true }]),
    limits: { timeoutMs: 25, maxBytes: DEFAULT_LIMITS.maxBytes },
  });
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /did not answer within 25ms/);
});

test("an RPC error payload is a failure, not a result", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } })));
  const answer = await stellarRpc(STELLAR_MAINNET.rpcUrl, "getNetwork", {}, { fetchImpl });
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /method not found/);
});

test("horizon query parameters are encoded, never string-joined", async () => {
  let seen = "";
  const fetchImpl = (async (url) => { seen = String(url); return new Response("{}"); });
  await horizonGet(STELLAR_MAINNET.horizonUrl, "assets", { asset_code: "A B", asset_issuer: USDC_ISSUER }, { fetchImpl });
  assert.match(seen, /asset_code=A\+B|asset_code=A%20B/);
  assert.match(seen, new RegExp(USDC_ISSUER));
});

// ---------------------------------------------------------------- reads --

test("network pulse reports the ledger, the moment it closed, and the endpoint's horizon", async () => {
  const fetchImpl = stubFetch([
    { match: "getNetwork", body: FIXTURE_RPC_GET_NETWORK },
    { match: "getHealth", body: FIXTURE_RPC_HEALTH },
  ]);
  const pulse = await readNetworkPulse(STELLAR_MAINNET, opts(fetchImpl));
  assert.ok(isResolved(pulse));
  assert.equal(pulse.data.ledgerSequence, 63925100);
  assert.equal(pulse.data.protocolVersion, 27);
  assert.equal(pulse.data.status, "healthy");
  /* Without a retention horizon, "not found" and "no longer kept" look
     identical to everything downstream. */
  assert.equal(pulse.data.oldestLedger, 63804196);
  assert.equal(pulse.data.retentionLedgers, 120960);
  assert.equal(pulse.state, "FRESH");
  assert.equal(pulse.sources.length, 2);
});

test("the pulse never asks for the 3 MB ledger response", () => {
  /* A live probe measured `getLatestLedger` at 3.18 MB on mainnet — almost all
     of it `metadataXdr` that nothing here reads — against 207 bytes for
     `getHealth`. The allowlist is what keeps it from creeping back. */
  assert.equal(ALLOWED_RPC_METHODS.includes("getLatestLedger"), false);
  assert.ok(ALLOWED_RPC_METHODS.includes("getHealth"));
});

test("a network answering with another network's passphrase is refused", async () => {
  /* The failure mode this closes returns perfectly valid-looking data from the
     wrong ledger. Nothing downstream could detect it. */
  const fetchImpl = stubFetch([
    { match: "getNetwork", body: { passphrase: "Test SDF Network ; September 2015", protocolVersion: 27 } },
    { match: "getHealth", body: FIXTURE_RPC_HEALTH },
  ]);
  const pulse = await readNetworkPulse(STELLAR_MAINNET, opts(fetchImpl));
  assert.equal(pulse.state, "UNAVAILABLE");
  assert.match(pulse.reason, /identifies as "Test SDF Network/);
  assert.match(pulse.reason, /Refusing to report another network's state/);
});

test("ledger parameters read the base reserve instead of hardcoding it", async () => {
  const params = await readLedgerParameters(STELLAR_MAINNET, opts(stubFetch([{ match: "/ledgers", body: FIXTURE_HORIZON_LEDGERS }])));
  assert.ok(isResolved(params));
  assert.equal(params.data.baseReserveStroops, 5000000);
  assert.equal(params.data.baseReserveXlm, "0.5000000");
  assert.equal(params.data.baseFeeStroops, 100);
});

test("issuer controls expose each power separately", async () => {
  const controls = await readIssuerControls(STELLAR_MAINNET, USDC_ISSUER, opts(stubFetch([{ match: `/accounts/${USDC_ISSUER}`, body: FIXTURE_HORIZON_ISSUER_ACCOUNT }])));
  assert.ok(isResolved(controls));
  assert.equal(controls.data.homeDomain, "circle.com");
  /* The real combination: this issuer can freeze a holding but cannot take it
     back. Collapsing the two into one verdict would lose that. */
  assert.equal(controls.data.authRevocable, true);
  assert.equal(controls.data.clawbackEnabled, false);
  assert.equal(controls.data.authRequired, false);
  assert.equal(controls.data.authImmutable, false);
  assert.equal(controls.data.observedAtLedger, 63923133);
});

test("a partial flag set is unavailable, never a partial answer", async () => {
  /* Rendering "clawback: off" when the truth is "we did not read it" is the
     one failure here a holder would actually act on. */
  const partial = { ...FIXTURE_HORIZON_ISSUER_ACCOUNT, flags: { auth_required: false, auth_revocable: true } };
  const controls = await readIssuerControls(STELLAR_MAINNET, USDC_ISSUER, opts(stubFetch([{ match: "/accounts/", body: partial }])));
  assert.equal(controls.state, "UNAVAILABLE");
  assert.match(controls.reason, /complete issuer flag set/);
});

test("an invalid issuer address is unknown before any request is made", async () => {
  let called = false;
  const controls = await readIssuerControls(STELLAR_MAINNET, "nonsense", {
    fetchImpl: (() => { called = true; return Promise.resolve(new Response("{}")); }),
    now: FIXTURE_NOW,
  });
  assert.equal(controls.state, "UNKNOWN");
  assert.equal(called, false);
});

test("a holding with a trustline reports its authorization and limit", async () => {
  const holding = await readHoldingRequirement(
    STELLAR_MAINNET,
    FIXTURE_HORIZON_HOLDER_ACCOUNT.id,
    USDC,
    opts(stubFetch([{ match: "/accounts/", body: FIXTURE_HORIZON_HOLDER_ACCOUNT }])),
  );
  assert.ok(isResolved(holding));
  assert.equal(holding.data.trustlineRequired, true);
  assert.equal(holding.data.trustlineExists, true);
  assert.equal(holding.data.authorized, true);
  assert.equal(holding.data.balance, "1250.0000000");
  assert.equal(holding.data.additionalSubentries, 0, "the trustline already exists, so it costs nothing more");
});

test("a missing trustline is not the same as a denied one", async () => {
  const holding = await readHoldingRequirement(
    STELLAR_MAINNET,
    FIXTURE_HORIZON_BARE_ACCOUNT.id,
    USDC,
    opts(stubFetch([{ match: "/accounts/", body: FIXTURE_HORIZON_BARE_ACCOUNT }])),
  );
  assert.ok(isResolved(holding));
  assert.equal(holding.data.trustlineExists, false);
  assert.equal(holding.data.authorized, null, "null means no trustline; false would read as the issuer denying one");
  assert.equal(holding.data.balance, null);
  assert.equal(holding.data.additionalSubentries, 1, "receiving this asset would cost one more base reserve");
});

test("the native asset needs no trustline and says so", async () => {
  const holding = await readHoldingRequirement(
    STELLAR_MAINNET,
    FIXTURE_HORIZON_BARE_ACCOUNT.id,
    NATIVE_ASSET,
    opts(stubFetch([{ match: "/accounts/", body: FIXTURE_HORIZON_BARE_ACCOUNT }])),
  );
  assert.ok(isResolved(holding));
  assert.equal(holding.data.trustlineRequired, false);
  assert.equal(holding.data.trustlineExists, true);
  assert.equal(holding.data.additionalSubentries, 0);
});

test("asset statistics count holder addresses, and the SAC comes with them", async () => {
  const stats = await readAssetStatistics(STELLAR_MAINNET, USDC, opts(stubFetch([{ match: "/assets", body: FIXTURE_HORIZON_ASSET }])));
  assert.ok(isResolved(stats));
  assert.equal(stats.data.holderAddresses, 2327568);
  assert.equal(stats.data.contractId, USDC_CONTRACT);
  assert.equal(stats.data.authorizedBalance, "372733860.6374758");
  assert.equal(stats.data.contractHoldings, 50049);
});

test("an asset Horizon has never seen is unknown, not zero holders", async () => {
  const stats = await readAssetStatistics(STELLAR_MAINNET, USDC, opts(stubFetch([{ match: "/assets", body: { _embedded: { records: [] } } }])));
  assert.equal(stats.state, "UNKNOWN");
  assert.match(stats.reason, /no record for USDC/);
});

test("contract token metadata states its boundary instead of guessing", async () => {
  const metadata = await readContractTokenMetadata(STELLAR_MAINNET, USDC_CONTRACT, { now: FIXTURE_NOW });
  assert.equal(metadata.state, "UNKNOWN");
  assert.match(metadata.reason, /XDR ledger-entry read/);
});

// --------------------------------------------------- the read-only shape --

test("no module in this adapter reaches for a signing or submission surface", () => {
  /* The boundary is asserted over the source rather than trusted, because the
     next person to add a file here will not have read this comment. */
  const forbidden = /\b(signTransaction|sendTransaction\s*\(|TransactionBuilder|Keypair|secretKey|signerKey|submitTransaction)\b/;
  const files = readdirSync(HERE).filter((name) => /\.tsx?$/.test(name));
  assert.ok(files.length >= 5, "the adapter's modules must actually be present");
  for (const name of files) {
    const source = readFileSync(resolve(HERE, name), "utf8");
    /* `client.ts` names `sendTransaction` on purpose — to refuse it — so the
       string is allowed there only inside the refusal list. */
    if (name === "client.ts") {
      assert.match(source, /REFUSED_RPC_METHODS/, "client.ts must keep naming what it refuses");
      continue;
    }
    assert.doesNotMatch(source, forbidden, `${name} must not reach for a signing or submission surface`);
  }
});

test("no adapter module imports a wallet, SDK or transaction library", () => {
  const files = readdirSync(HERE).filter((name) => /\.tsx?$/.test(name));
  for (const name of files) {
    const source = readFileSync(resolve(HERE, name), "utf8");
    assert.doesNotMatch(source, /from ["']@stellar\//, `${name} must not import the Stellar SDK — no dependency was added`);
    assert.doesNotMatch(source, /from ["']viem["']|from ["']ethers["']/, `${name} must not import an EVM library`);
  }
});
