// Run from repo root:
// node --test --test-isolation=none lib/agent-control/payments/x402-engine.test.mjs
//
// One engine, four axes, and every refusal by name. The five gates that must
// be proved by breaking what they guard are marked GATE-PROVED where they
// appear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PAYMENT_FACILITATORS,
  PAYMENT_METHODS,
  PAYMENT_PROTOCOL,
  PAYMENT_IMPLEMENTATIONS,
  PROVIDER_IMPLEMENTATIONS,
  paymentImplementation,
} from "./implementations.ts";
import {
  X402_ROUTE_REFUSALS,
  X402RouteError,
  buildRoutePreview,
  resolvePaymentRoute,
  routeId,
} from "./x402-engine.ts";
import { AGENT_CONTROL_REGISTRY, resolveRegistryRef } from "../registry.ts";

const BSC = "eip155:56";
const BSC_TESTNET = "eip155:97";
const USDT = `${BSC}/erc20:0x55d398326f99059fF775485246999027B3197955`;
const USD1 = `${BSC}/erc20:0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d`;
const U = `${BSC}/erc20:0xcE24439F2D9C6a2289F741120FE202248B666666`;

/** A policy that permits everything the four implementations could declare. */
function openPolicy(overrides = {}) {
  return {
    id: "test-commerce-policy",
    version: 1,
    allowedImplementations: [...PROVIDER_IMPLEMENTATIONS],
    allowedMethods: [...PAYMENT_METHODS],
    allowedFacilitators: [...PAYMENT_FACILITATORS],
    assetPolicy: [
      { network: BSC, assetRefs: [U, USD1, USDT] },
      { network: BSC_TESTNET, assetRefs: [] },
    ],
    ...overrides,
  };
}

const BINANCE_PERMIT2_USDT = {
  protocol: PAYMENT_PROTOCOL,
  implementation: "BINANCE_B402",
  method: "PERMIT2_EXACT",
  facilitator: "BINANCE",
  network: BSC,
  assetRef: USDT,
};

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof X402RouteError, `expected a route refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode, `expected ${reasonCode}, got ${error.reasonCode}`);
    return error;
  }
  assert.fail(`expected ${reasonCode}, nothing was thrown`);
}

test("there is one protocol and one engine", () => {
  assert.equal(PAYMENT_PROTOCOL, "X402");
  /* Every implementation resolves through the same entry point. An adapter that
     carried its own resolver would be a second engine wearing a data hat. */
  const engine = readFileSync("lib/agent-control/payments/x402-engine.ts", "utf8");
  const implementations = readFileSync("lib/agent-control/payments/implementations.ts", "utf8");
  assert.ok(engine.includes("export function resolvePaymentRoute"));
  assert.ok(
    !/\bif\s*\(\s*\w*\.?id\s*===\s*"(BINANCE_B402|VISTARA_B402|COINBASE_X402|SELF_HOSTED_X402)"/.test(engine),
    "the engine branches on a provider id, so the axes are decorative",
  );
  assert.ok(
    !/\bfunction\s+\w*[Rr]esolve/.test(implementations),
    "an implementation module defines a resolver of its own",
  );
});

test("the four axes are four independent closed vocabularies", () => {
  assert.deepEqual([...PROVIDER_IMPLEMENTATIONS], [
    "BINANCE_B402",
    "VISTARA_B402",
    "COINBASE_X402",
    "SELF_HOSTED_X402",
  ]);
  assert.deepEqual([...PAYMENT_METHODS], [
    "EIP_3009",
    "PERMIT2_EXACT",
    "PERMIT2_UP_TO",
    "VISTARA_RELAYER_EIP712",
  ]);
  assert.deepEqual([...PAYMENT_FACILITATORS], ["BINANCE", "VISTARA", "COINBASE_CDP", "SELF_HOSTED"]);
  /* No value appears on two axes; a shared token is how two facts become one. */
  const all = [...PROVIDER_IMPLEMENTATIONS, ...PAYMENT_METHODS, ...PAYMENT_FACILITATORS];
  assert.equal(new Set(all).size, all.length);
});

/** Source with comments removed, so a prose mention is not read as a value. */
function code(path) {
  return readFileSync(path, "utf8")
    .split("\r\n")
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("the bare string B402 is never an identifier anywhere in the engine", () => {
  /* GATE-PROVED. Two unrelated systems ship under that name on one chain, so a
     helper that accepted it would resolve one of them by coin flip. The check
     runs over code with comments stripped: naming the ambiguity in prose is the
     point, and using it as a value is the defect. */
  for (const path of [
    "lib/agent-control/payments/x402-engine.ts",
    "lib/agent-control/payments/implementations.ts",
    "lib/agent-control/adapters/x402-payments.ts",
  ]) {
    assert.ok(
      !/["'`]\s*[Bb]402\s*["'`]/.test(code(path)),
      `${path} uses the bare string B402 as a value`,
    );
  }
  assert.equal(paymentImplementation("B402"), null);
  assert.equal(paymentImplementation("b402"), null);
});

test("a declared route resolves and names all six identity fields", () => {
  const route = resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, policy: openPolicy() });
  assert.equal(route.protocol, "X402");
  assert.equal(route.implementation, "BINANCE_B402");
  assert.equal(route.method, "PERMIT2_EXACT");
  assert.equal(route.facilitator, "BINANCE");
  assert.equal(route.network, BSC);
  assert.equal(route.assetRef, USDT);
  assert.equal(route.assetSymbol, "USDT");
  /* The provider's own spelling travels with the route rather than replacing it. */
  assert.equal(route.wireValue, "permit2-exact");
  assert.equal(route.trustCeiling, "FACILITATOR_ASSERTION");
  assert.ok(Object.isFrozen(route));
});

test("the route id keeps the two B402s apart", () => {
  const binance = resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, policy: openPolicy() });
  const vistara = resolvePaymentRoute({
    protocol: PAYMENT_PROTOCOL,
    implementation: "VISTARA_B402",
    method: "VISTARA_RELAYER_EIP712",
    facilitator: "VISTARA",
    network: BSC,
    assetRef: USDT,
    policy: openPolicy(),
  });

  /* Same asset, same chain, same protocol — and every fact that matters differs. */
  assert.equal(binance.assetRef, vistara.assetRef);
  assert.equal(binance.network, vistara.network);
  assert.notEqual(routeId(binance), routeId(vistara));
  assert.notEqual(binance.facilitator, vistara.facilitator);
  assert.notEqual(binance.operator, vistara.operator);
  assert.notEqual(binance.trustCeiling, vistara.trustCeiling);
  assert.equal(vistara.trustCeiling, "UNVERIFIED_ASSERTION");
});

test("a method the provider does not support for that asset is refused by name", () => {
  /* GATE-PROVED. Binance's own table gives `eip3009` to U and USD1 and withholds
     it from USDT and USDC, because those two have no native EIP-3009 support.
     Wire the convenient assumption — a method the provider supports somewhere is
     supported everywhere — and watch it fail. */
  throwsWith("PAYMENT_METHOD_NOT_SUPPORTED_FOR_ASSET", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, method: "EIP_3009", policy: openPolicy() }),
  );
  const allowed = resolvePaymentRoute({
    ...BINANCE_PERMIT2_USDT,
    method: "EIP_3009",
    assetRef: USD1,
    policy: openPolicy(),
  });
  assert.equal(allowed.method, "EIP_3009");
  assert.equal(allowed.wireValue, "eip3009");
});

test("an asset absent from this chain's allowlist is refused, and another chain's entry does not satisfy it", () => {
  /* GATE-PROVED. The allowlist is per chain, so the same token listed against a
     different network must not let the route through. */
  throwsWith("ASSET_NOT_ALLOWED_ON_NETWORK", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      policy: openPolicy({ assetPolicy: [{ network: BSC, assetRefs: [U] }] }),
    }),
  );

  /* The sharp case: this exact token *is* on the allowlist, on the wrong chain.
     A lookup that searched the flattened list would pass here. */
  throwsWith("ASSET_NOT_ALLOWED_ON_NETWORK", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      policy: openPolicy({
        assetPolicy: [
          { network: BSC, assetRefs: [] },
          { network: BSC_TESTNET, assetRefs: [USDT] },
        ],
      }),
    }),
  );

  /* A network with no entry at all fails closed one step earlier and says so,
     because "you have allowed nothing here" is a different fact from "you have
     allowed other assets here but not this one". */
  throwsWith("NETWORK_NOT_ALLOWED_BY_POLICY", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      policy: openPolicy({ assetPolicy: [{ network: BSC_TESTNET, assetRefs: [USDT] }] }),
    }),
  );
  throwsWith("NETWORK_NOT_ALLOWED_BY_POLICY", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, policy: openPolicy({ assetPolicy: [] }) }),
  );
});

test("a facilitator the implementation does not declare is refused", () => {
  /* GATE-PROVED. Pointing Binance's implementation at Vistara's facilitator is
     a real integration mistake, not a hypothetical: both are "B402". */
  throwsWith("FACILITATOR_NOT_DECLARED_BY_IMPLEMENTATION", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, facilitator: "VISTARA", policy: openPolicy() }),
  );
  throwsWith("FACILITATOR_NOT_DECLARED_BY_IMPLEMENTATION", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, facilitator: "COINBASE_CDP", policy: openPolicy() }),
  );
});

test("provider capability is checked before owner permission, so the message says which one failed", () => {
  /* A route the provider cannot do and the owner has not allowed must report the
     provider fact: "you may not" is misleading when the answer is "nobody can". */
  throwsWith("PAYMENT_METHOD_NOT_SUPPORTED_FOR_ASSET", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      method: "EIP_3009",
      policy: openPolicy({ allowedMethods: ["PERMIT2_EXACT"] }),
    }),
  );
});

test("each policy axis refuses on its own", () => {
  throwsWith("IMPLEMENTATION_NOT_ALLOWED_BY_POLICY", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      policy: openPolicy({ allowedImplementations: ["COINBASE_X402"] }),
    }),
  );
  throwsWith("PAYMENT_METHOD_NOT_ALLOWED_BY_POLICY", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      policy: openPolicy({ allowedMethods: ["PERMIT2_UP_TO"] }),
    }),
  );
  throwsWith("FACILITATOR_NOT_ALLOWED_BY_POLICY", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      policy: openPolicy({ allowedFacilitators: ["SELF_HOSTED"] }),
    }),
  );
});

test("an unknown protocol, implementation, method or facilitator is refused rather than defaulted", () => {
  throwsWith("PAYMENT_PROTOCOL_UNSUPPORTED", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, protocol: "X403", policy: openPolicy() }),
  );
  throwsWith("IMPLEMENTATION_UNKNOWN", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, implementation: "BINANCE_PAY", policy: openPolicy() }),
  );
  throwsWith("PAYMENT_METHOD_UNKNOWN", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, method: "EIP_2612", policy: openPolicy() }),
  );
  throwsWith("FACILITATOR_UNKNOWN", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, facilitator: "STRIPE", policy: openPolicy() }),
  );
});

test("the network Binance says is live is the one where no asset can be named", () => {
  /* Binance publishes contracts for BSC Mainnet only, and says B402 is live on
     BSC Testnet with mainnet access granted on request. Both halves are
     recorded: testnet is a declared network with no declarable asset. */
  const binance = paymentImplementation("BINANCE_B402");
  assert.ok(binance.networks.includes(BSC_TESTNET));
  assert.equal(binance.assets.filter((asset) => asset.network === BSC_TESTNET).length, 0);
  throwsWith("ASSET_NOT_DECLARED_BY_IMPLEMENTATION", () =>
    resolvePaymentRoute({
      ...BINANCE_PERMIT2_USDT,
      network: BSC_TESTNET,
      assetRef: `${BSC_TESTNET}/erc20:0x55d398326f99059fF775485246999027B3197955`,
      policy: openPolicy({ assetPolicy: [{ network: BSC_TESTNET, assetRefs: [`${BSC_TESTNET}/erc20:0x55d398326f99059fF775485246999027B3197955`] }] }),
    }),
  );
});

test("an implementation whose source publishes no asset table resolves no route at all", () => {
  throwsWith("ASSET_NOT_DECLARED_BY_IMPLEMENTATION", () =>
    resolvePaymentRoute({
      protocol: PAYMENT_PROTOCOL,
      implementation: "COINBASE_X402",
      method: "EIP_3009",
      facilitator: "COINBASE_CDP",
      network: "eip155:8453",
      assetRef: "eip155:8453/erc20:0x0000000000000000000000000000000000000000",
      policy: openPolicy({
        assetPolicy: [
          { network: "eip155:8453", assetRefs: ["eip155:8453/erc20:0x0000000000000000000000000000000000000000"] },
        ],
      }),
    }),
  );
});

test("a self-hosted facilitator with no declared deployment refuses at the network", () => {
  throwsWith("NETWORK_NOT_DECLARED_BY_IMPLEMENTATION", () =>
    resolvePaymentRoute({
      protocol: PAYMENT_PROTOCOL,
      implementation: "SELF_HOSTED_X402",
      method: "EIP_3009",
      facilitator: "SELF_HOSTED",
      network: BSC,
      assetRef: USDT,
      policy: openPolicy(),
    }),
  );
});

test("every implementation resolves through the hash-pinned registry", () => {
  for (const implementation of PAYMENT_IMPLEMENTATIONS) {
    const adapter = resolveRegistryRef(AGENT_CONTROL_REGISTRY, implementation.adapterRef, "ADAPTER");
    assert.equal(adapter.capability, "READ_ONLY", `${implementation.id} claims more than read-only`);
    const action = resolveRegistryRef(AGENT_CONTROL_REGISTRY, implementation.actionRef, "ACTION_SCHEMA");
    assert.equal(action.canonicalClass, "VALUE_TRANSFER");
    assert.equal(action.budget, "REQUIRED");
    assert.match(adapter.contentHash, /^0x[0-9a-f]{64}$/);
  }
});

test("a resolved route carries the registry pin it was produced against", () => {
  const route = resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, policy: openPolicy() });
  assert.match(route.registryPin.registryDigest, /^0x[0-9a-f]{64}$/);
  assert.equal(route.registryPin.registryDigest, AGENT_CONTROL_REGISTRY.digest);
  const refs = route.registryPin.refs.map((entry) => entry.ref);
  assert.ok(refs.includes("adapter:binance-b402@1"));
  assert.ok(refs.includes("action:binance-b402/pay-service-request@1"));
});

test("a preview is a preview and carries no receipt", () => {
  const preview = buildRoutePreview({
    route: resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, policy: openPolicy() }),
    amount: "0.25",
    now: new Date("2026-08-24T00:00:00.000Z"),
  });
  assert.equal(preview.kind, "X402_ROUTE_PREVIEW");
  for (const forbidden of ["receiptId", "settlement", "transactionHash", "outcome", "paymentStatus"]) {
    assert.ok(!(forbidden in preview), `a preview carries ${forbidden}`);
  }
  assert.ok(preview.limitations.length >= 3);
  assert.ok(
    preview.limitations.some((line) => /not a receipt/i.test(line)),
    "a preview must say in its own words that it is not a receipt",
  );
  assert.ok(Object.isFrozen(preview));
});

test("a preview states that nothing was paid and nothing can be", () => {
  const preview = buildRoutePreview({
    route: resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, policy: openPolicy() }),
    amount: "0.25",
    now: new Date("2026-08-24T00:00:00.000Z"),
  });
  assert.equal(preview.execution.status, "UNAVAILABLE");
  assert.equal(preview.execution.reasonCode, "NO_PAYMENT_CREDENTIAL");
});

test("nothing in the engine can reach a facilitator", () => {
  const engine = readFileSync("lib/agent-control/payments/x402-engine.ts", "utf8");
  const implementations = readFileSync("lib/agent-control/payments/implementations.ts", "utf8");
  for (const [name, source] of [["engine", engine], ["implementations", implementations]]) {
    assert.ok(!/\bfetch\s*\(/.test(source), `${name} calls fetch`);
    assert.ok(!/\bXMLHttpRequest\b|\bWebSocket\b/.test(source), `${name} opens a socket`);
    assert.ok(!/from ["']node:(http|https|net|tls)["']/.test(source), `${name} imports a transport`);
    assert.ok(!/process\.env/.test(source), `${name} reads an environment variable`);
    /* No model provider decides anything here. */
    assert.ok(!/openai|anthropic|@ai-sdk/i.test(source), `${name} imports a model provider`);
  }
  /* The one URL each implementation carries is documentation, and documentation
     is not an endpoint: no path under it is a callable API route. */
  for (const implementation of PAYMENT_IMPLEMENTATIONS) {
    assert.ok(!/\/papi\//.test(implementation.source.url), `${implementation.id} stores an API path`);
    assert.ok(!/facilitator\./.test(implementation.source.url), `${implementation.id} stores a facilitator host`);
  }
});

test("every refusal the engine can raise is a declared code", () => {
  assert.equal(new Set(X402_ROUTE_REFUSALS).size, X402_ROUTE_REFUSALS.length);
  const error = throwsWith("FACILITATOR_UNKNOWN", () =>
    resolvePaymentRoute({ ...BINANCE_PERMIT2_USDT, facilitator: "STRIPE", policy: openPolicy() }),
  );
  assert.ok(X402_ROUTE_REFUSALS.includes(error.reasonCode));
});

test("every declaration names its source and the date it was read", () => {
  for (const implementation of PAYMENT_IMPLEMENTATIONS) {
    assert.match(implementation.source.url, /^https:\/\//);
    assert.match(implementation.source.observedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(implementation.limitations.length >= 2, `${implementation.id} states too few limitations`);
    assert.equal(implementation.ryntraReach, "NONE");
  }
});
