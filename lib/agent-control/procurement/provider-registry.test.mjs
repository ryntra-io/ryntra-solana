// Run from repo root: node --test lib/agent-control/procurement/provider-registry.test.mjs
//
// The one rule of §5.7: an agent does not pay a URL from a prompt.
//
// The attacks this file encodes are the ones that arrive as text — a host that
// *contains* a registered name, a path that *starts with* a registered one, a
// credential smuggled into the URL. Each of them passes a `includes` or a
// `startsWith` check, which is why the resolver uses neither.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ProviderRegistryError,
  PROVIDER_REGISTRY_REFUSALS,
  buildProviderRegistry,
  registeredServices,
  resolveRegisteredResource,
} from "./provider-registry.ts";
import {
  DEVNET,
  FIXTURE_ORIGIN,
  MAINNET,
  USDC_DEVNET,
  USDC_MAINNET,
  fixtureProvider,
  fixtureRegistry,
} from "./fixtures.ts";
import { splAssetRef } from "./protocol.ts";

/** One provider with a single service, with any field replaceable. */
function provider(serviceOverrides = {}, providerOverrides = {}) {
  const base = fixtureProvider();
  const [first] = base.services;
  return {
    ...base,
    services: [{ ...first, ...serviceOverrides }],
    ...providerOverrides,
  };
}

/* ── Building ─────────────────────────────────────────────────────────────── */

test("the fixture registry builds, and flattens to its services", () => {
  const registry = fixtureRegistry();
  assert.equal(registry.providers.length, 1);
  const flat = registeredServices(registry);
  assert.equal(flat.length, 2);
  assert.deepEqual(
    flat.map((entry) => entry.service.serviceId),
    ["token-facts", "pull-experiment"],
  );
});

test("a declaration that could never be settled refuses at build rather than at a payment", () => {
  const cases = [
    ["SERVICE_FACILITATOR_DOES_NOT_DECLARE_SCHEME", { scheme: "upto", facilitator: "PAYAI" }],
    ["SERVICE_FACILITATOR_DOES_NOT_DECLARE_NETWORK", { network: DEVNET, mint: USDC_DEVNET, assetRef: splAssetRef(DEVNET, USDC_DEVNET), facilitator: "PAYAI" }],
    ["SERVICE_FACILITATOR_UNKNOWN", { facilitator: "SELF_HOSTED" }],
    ["SERVICE_SCHEME_UNKNOWN", { scheme: "invoice" }],
    ["SERVICE_NETWORK_NOT_SOLANA", { network: "eip155:8453" }],
    ["SERVICE_MINT_MALFORMED", { mint: "USDC" }],
    ["SERVICE_MINT_MALFORMED", { assetRef: `${MAINNET}/erc20:${USDC_MAINNET}` }],
    ["SERVICE_DECIMALS_OUT_OF_RANGE", { decimals: 24 }],
    ["SERVICE_PRICE_MALFORMED", { priceBaseUnits: "0.2" }],
    ["SERVICE_PRICE_MALFORMED", { priceBaseUnits: "0" }],
    ["SERVICE_CEILING_BELOW_PRICE", { priceCeilingBaseUnits: "1" }],
    ["SERVICE_TIMEOUT_OUT_OF_RANGE", { maxTimeoutSeconds: 3_600 }],
    ["SERVICE_RESOURCE_NOT_UNDER_ORIGIN", { resource: "https://elsewhere.test/v1/token-facts" }],
    ["SERVICE_RESOURCE_NOT_UNDER_ORIGIN", { resource: `${FIXTURE_ORIGIN}/v1/token-facts?mint=x` }],
  ];
  for (const [reasonCode, overrides] of cases) {
    assert.throws(
      () => buildProviderRegistry({ id: "test-registry", version: 1, providers: [provider(overrides)] }),
      (error) => error instanceof ProviderRegistryError && error.reasonCode === reasonCode,
      `${JSON.stringify(overrides)} did not refuse with ${reasonCode}`,
    );
  }
});

test("a provider is an origin, never a URL with a path or a credential in it", () => {
  const cases = [
    ["PROVIDER_ORIGIN_NOT_HTTPS", { origin: "http://data.example.test" }],
    ["PROVIDER_ORIGIN_CARRIES_PATH", { origin: `${FIXTURE_ORIGIN}/v1` }],
    ["PROVIDER_ORIGIN_CARRIES_CREDENTIAL", { origin: "https://key:secret@data.example.test" }],
  ];
  for (const [reasonCode, providerOverrides] of cases) {
    assert.throws(
      () =>
        buildProviderRegistry({
          id: "test-registry",
          version: 1,
          providers: [provider({ resource: `${providerOverrides.origin}/v1/token-facts` }, providerOverrides)],
        }),
      (error) => error.reasonCode === reasonCode,
      `${JSON.stringify(providerOverrides)} did not refuse with ${reasonCode}`,
    );
  }
});

test("a repeated provider, service or resource refuses", () => {
  const one = fixtureProvider();
  assert.throws(
    () => buildProviderRegistry({ id: "test-registry", version: 1, providers: [one, one] }),
    (error) => error.reasonCode === "PROVIDER_ID_REPEATED",
  );
  const [first] = one.services;
  assert.throws(
    () => buildProviderRegistry({ id: "test-registry", version: 1, providers: [{ ...one, services: [first, first] }] }),
    (error) => error.reasonCode === "SERVICE_ID_REPEATED",
  );
  assert.throws(
    () =>
      buildProviderRegistry({
        id: "test-registry",
        version: 1,
        providers: [{ ...one, services: [first, { ...first, serviceId: "second" }] }],
      }),
    (error) => error.reasonCode === "SERVICE_RESOURCE_REPEATED",
  );
  assert.throws(
    () => buildProviderRegistry({ id: "test-registry", version: 1, providers: [{ ...one, services: [] }] }),
    (error) => error.reasonCode === "PROVIDER_HAS_NO_SERVICE",
  );
});

/* ── Resolving ────────────────────────────────────────────────────────────── */

test("a registered resource resolves, and its query belongs to the caller", () => {
  const registry = fixtureRegistry();
  const resolved = resolveRegisteredResource(registry, `${FIXTURE_ORIGIN}/v1/token-facts?mint=${USDC_MAINNET}`);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.service.serviceId, "token-facts");
  assert.equal(resolved.canonicalResource, `${FIXTURE_ORIGIN}/v1/token-facts`);
});

test("an arbitrary URL from a prompt is refused, and the reason says why", () => {
  const registry = fixtureRegistry();
  const refused = resolveRegisteredResource(registry, "https://pay-me-now.test/v1/anything");
  assert.equal(refused.ok, false);
  assert.equal(refused.reasonCode, "PROVIDER_NOT_REGISTERED");
  assert.match(refused.detail, /never a URL from a prompt/);
});

test("a host that merely contains a registered name is a different host", () => {
  // GATE-PROVED: `data.example.test.evil.test` contains the registered origin
  // as a substring and shares no suffix with it. A `includes` check passes it.
  const registry = fixtureRegistry();
  for (const url of [
    "https://data.example.test.evil.test/v1/token-facts",
    "https://evil.test/data.example.test/v1/token-facts",
    "https://data.example.test:8443/v1/token-facts",
    "https://sub.data.example.test/v1/token-facts",
  ]) {
    const refused = resolveRegisteredResource(registry, url);
    assert.equal(refused.ok, false, `${url} resolved`);
    assert.equal(refused.reasonCode, "PROVIDER_NOT_REGISTERED", url);
  }
});

test("a path that merely starts with a registered one is a different path", () => {
  // GATE-PROVED: a `startsWith` check passes the first two of these.
  const registry = fixtureRegistry();
  for (const [url, reasonCode] of [
    [`${FIXTURE_ORIGIN}/v1/token-facts-premium`, "RESOURCE_NOT_REGISTERED"],
    [`${FIXTURE_ORIGIN}/v1/token-facts/drain`, "RESOURCE_NOT_REGISTERED"],
    [`${FIXTURE_ORIGIN}/v1/other`, "RESOURCE_NOT_REGISTERED"],
  ]) {
    const refused = resolveRegisteredResource(registry, url);
    assert.equal(refused.ok, false, `${url} resolved`);
    assert.equal(refused.reasonCode, reasonCode, url);
  }
});

test("a traversal that normalises back to a registered path is the registered path", () => {
  // The URL parser resolves `..` before the comparison, so `/v1/x/../token-facts`
  // *is* `/v1/token-facts`. Pinned because the opposite — refusing it — would
  // look safer and would mean the comparison was textual rather than parsed.
  const registry = fixtureRegistry();
  const resolved = resolveRegisteredResource(registry, `${FIXTURE_ORIGIN}/v1/x/../token-facts`);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.canonicalResource, `${FIXTURE_ORIGIN}/v1/token-facts`);
});

test("a URL that is not https, is malformed, or carries a credential each refuse by name", () => {
  const registry = fixtureRegistry();
  assert.equal(
    resolveRegisteredResource(registry, "http://data.example.test/v1/token-facts").reasonCode,
    "RESOURCE_URL_NOT_HTTPS",
  );
  assert.equal(resolveRegisteredResource(registry, "not a url").reasonCode, "RESOURCE_URL_MALFORMED");
  assert.equal(resolveRegisteredResource(registry, "").reasonCode, "RESOURCE_URL_MALFORMED");
  assert.equal(
    resolveRegisteredResource(registry, "https://key:secret@data.example.test/v1/token-facts").reasonCode,
    "RESOURCE_URL_CARRIES_CREDENTIAL",
  );
});

test("an empty registry pays nobody", () => {
  const empty = buildProviderRegistry({ id: "empty", version: 1, providers: [] });
  assert.equal(registeredServices(empty).length, 0);
  assert.equal(
    resolveRegisteredResource(empty, `${FIXTURE_ORIGIN}/v1/token-facts`).reasonCode,
    "PROVIDER_NOT_REGISTERED",
  );
});

test("no registry entry can carry a secret", () => {
  // §5.8: an API key is not a spending permission. The only place a credential
  // could hide is the origin or the resource, and both refuse it.
  const source = PROVIDER_REGISTRY_REFUSALS;
  assert.ok(source.includes("PROVIDER_ORIGIN_CARRIES_CREDENTIAL"));
  assert.ok(source.includes("RESOURCE_URL_CARRIES_CREDENTIAL"));
  for (const { service } of registeredServices(fixtureRegistry())) {
    assert.equal(JSON.stringify(service).includes("secret"), false);
  }
});
