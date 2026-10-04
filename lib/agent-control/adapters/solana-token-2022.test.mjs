/**
 * The Solana adapter, proven the way Release B promised a second network
 * would be: resolvable from the shipped registry, fail-closed on every
 * refusal, and — the load-bearing one — absent by name from every central
 * schema source, read from disk rather than taken on faith.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AGENT_CONTROL_REGISTRY,
  RegistryResolutionError,
  buildRegistry,
  registryPin,
  resolveRegistryRef,
} from "../registry.ts";
import {
  SOLANA_TOKEN_2022_ADAPTER_REF,
  SOLANA_TOKEN_2022_DEFINITIONS,
  SPL_TRANSFER_ACTION_REF,
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SplTransferInputSchema,
  SplTransferObservationSchema,
} from "./solana-token-2022.ts";

/** The central set the registry's own suite pins. Kept verbatim here so a
 * rename there breaks this file loudly instead of silently narrowing the
 * proof. */
const CENTRAL_SCHEMA_SOURCES = [
  "lib/agent-control/contracts.ts",
  "lib/agent-control/registry.ts",
];

function throwsWith(reasonCode, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof RegistryResolutionError, `expected a registry refusal, got ${error}`);
    assert.equal(error.reasonCode, reasonCode);
    return;
  }
  assert.fail(`expected ${reasonCode}, nothing was thrown`);
}

/* ── the multi-chain claim, proven on the real second network ────────── */

test("the Solana adapter is absent by name from every central schema source", () => {
  /*
   * The fixture-provider test proves the mechanism; this proves the real
   * network used it. If "solana" appears in contracts.ts or registry.ts,
   * the second network cost a central edit and the claim is dead.
   */
  for (const path of CENTRAL_SCHEMA_SOURCES) {
    const source = readFileSync(path, "utf8").toLowerCase();
    assert.ok(
      !source.includes("solana"),
      `${path} names solana — the second network still cost a central edit`,
    );
  }
});

test("the shipped registry resolves the Solana adapter and its transfer action", () => {
  const adapter = resolveRegistryRef(AGENT_CONTROL_REGISTRY, SOLANA_TOKEN_2022_ADAPTER_REF, "ADAPTER");
  assert.equal(adapter.displayName, "Solana Token-2022");
  assert.equal(adapter.capability, "READ_ONLY");
  assert.deepEqual(adapter.chainRefs, [
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  ]);

  const action = resolveRegistryRef(AGENT_CONTROL_REGISTRY, SPL_TRANSFER_ACTION_REF, "ACTION_SCHEMA");
  assert.equal(action.canonicalClass, "VALUE_TRANSFER", "a verifier ignorant of Solana still reads that value moves");
  assert.equal(action.budget, "OPTIONAL");
  assert.equal(action.adapterRef, SOLANA_TOKEN_2022_ADAPTER_REF);

  const native = resolveRegistryRef(AGENT_CONTROL_REGISTRY, NATIVE_SOL_TRANSFER_ACTION_REF, "ACTION_SCHEMA");
  assert.equal(native.canonicalClass, "VALUE_TRANSFER");
  assert.equal(native.adapterRef, SOLANA_TOKEN_2022_ADAPTER_REF);
});

test("an artifact can pin the Solana entries like any others", () => {
  const pin = registryPin(AGENT_CONTROL_REGISTRY, [SOLANA_TOKEN_2022_ADAPTER_REF, SPL_TRANSFER_ACTION_REF]);
  assert.equal(pin.registryDigest, AGENT_CONTROL_REGISTRY.digest);
  assert.equal(pin.refs.length, 2);
  for (const ref of pin.refs) assert.match(ref.contentHash, /^0x[0-9a-f]{64}$/);
});

/* ── fail-closed, exercised per refusal on the Solana refs ───────────── */

test("an unregistered Solana version refuses as unknown, not as a fallback", () => {
  throwsWith("REGISTRY_REF_UNKNOWN", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, "adapter:solana-token-2022@2", "ADAPTER"));
});

test("kind confusion on the Solana refs is malformed by prefix, never a wrong answer", () => {
  throwsWith("REGISTRY_REF_MALFORMED", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, SPL_TRANSFER_ACTION_REF, "ADAPTER"));
  throwsWith("REGISTRY_REF_MALFORMED", () =>
    resolveRegistryRef(AGENT_CONTROL_REGISTRY, SOLANA_TOKEN_2022_ADAPTER_REF, "ACTION_SCHEMA"));
});

test("a retired Solana entry cannot back a new artifact", () => {
  const retired = buildRegistry(
    SOLANA_TOKEN_2022_DEFINITIONS.map((definition) =>
      definition.kind === "ADAPTER" ? { ...definition, status: "RETIRED" } : definition,
    ),
  );
  throwsWith("REGISTRY_REF_RETIRED", () =>
    resolveRegistryRef(retired, SOLANA_TOKEN_2022_ADAPTER_REF, "ADAPTER"));
});

test("a tampered Solana entry fails its own hash pin", () => {
  const tampered = {
    ...AGENT_CONTROL_REGISTRY,
    entries: AGENT_CONTROL_REGISTRY.entries.map((entry) =>
      entry.ref === SOLANA_TOKEN_2022_ADAPTER_REF
        ? { ...entry, displayName: "Solana Token-2022 (edited after pinning)" }
        : entry,
    ),
  };
  throwsWith("REGISTRY_ENTRY_HASH_MISMATCH", () =>
    resolveRegistryRef(tampered, SOLANA_TOKEN_2022_ADAPTER_REF, "ADAPTER"));
});

/* ── the action's input contract ─────────────────────────────────────── */

const VALID_INPUT = {
  schemaVersion: "1.0.0",
  actionRef: SPL_TRANSFER_ACTION_REF,
  network: "devnet",
  mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  sender: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
  recipient: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar",
  amountRaw: "500000000",
};

test("a valid transfer input parses and a float amount does not exist as a concept", () => {
  assert.deepEqual(SplTransferInputSchema.parse(VALID_INPUT), VALID_INPUT);

  for (const broken of [
    { ...VALID_INPUT, amountRaw: "1.5" },
    { ...VALID_INPUT, amountRaw: "0" },
    { ...VALID_INPUT, amountRaw: "-1" },
    { ...VALID_INPUT, amountRaw: "01" },
    { ...VALID_INPUT, amountRaw: 500000000 },
    { ...VALID_INPUT, mint: "not-base58-0OIl" },
    { ...VALID_INPUT, recipient: VALID_INPUT.sender },
    { ...VALID_INPUT, network: "testnet" },
    { ...VALID_INPUT, extra: "field" },
  ]) {
    assert.equal(SplTransferInputSchema.safeParse(broken).success, false);
  }
});

/* ── the observation contract ────────────────────────────────────────── */

const VALID_OBSERVATION = {
  schemaVersion: "1.0.0",
  actionRef: SPL_TRANSFER_ACTION_REF,
  network: "devnet",
  signature:
    "5j1JU7ucezPvVarKAJ2wZ9WGRwQK9BeDvuxAVGKSk4gzVaqqLL3zpFDbNWnHhSKn9bhZZAPtwZK9oJrDgk9mo3Kr",
  slot: "439859154",
  blockTime: "2026-08-17T13:34:03.000+00:00",
  feeLamports: "5000",
  balanceDeltas: [
    {
      account: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      rawDelta: "-500000000",
    },
    {
      account: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      rawDelta: "500000000",
    },
  ],
  lamportBalanceDeltas: [],
  sources: [
    { ref: "solana:devnet:rpc:getTransaction/5j1JU7uc", label: "Solana devnet JSON-RPC (api.devnet.solana.com)" },
  ],
  observedAt: "2026-08-17T13:35:00.000+00:00",
};

test("a valid observation parses; one without provenance is a claim, not evidence", () => {
  assert.deepEqual(SplTransferObservationSchema.parse(VALID_OBSERVATION), VALID_OBSERVATION);

  /* Zero balance deltas used to be refused here, and a devnet lifecycle run —
     since cancelled when the product went mainnet-first, though its findings
     stand — showed why that was wrong: a transaction that landed and failed
     moved nothing, and the honest observation of it is one with an empty
     movement list and a source that says where that was read. Requiring a
     movement made the most important outcome this product records
     unrepresentable. Provenance stays required — an observation with no
     source is somebody's word for it. */
  assert.equal(
    SplTransferObservationSchema.safeParse({ ...VALID_OBSERVATION, balanceDeltas: [] }).success,
    true,
  );

  for (const broken of [
    { ...VALID_OBSERVATION, sources: [] },
    { ...VALID_OBSERVATION, signature: "too-short" },
    { ...VALID_OBSERVATION, slot: "-1" },
    { ...VALID_OBSERVATION, feeLamports: "1.2" },
    { ...VALID_OBSERVATION, blockTime: "yesterday" },
    { ...VALID_OBSERVATION, extra: true },
  ]) {
    assert.equal(SplTransferObservationSchema.safeParse(broken).success, false);
  }
});

/* ── manifest discipline ─────────────────────────────────────────────── */

test("every manifest definition landed in the shipped registry, hash-pinned", () => {
  for (const definition of SOLANA_TOKEN_2022_DEFINITIONS) {
    const entry = AGENT_CONTROL_REGISTRY.entries.find((candidate) => candidate.ref === definition.ref);
    assert.ok(entry, `${definition.ref} is in the manifest but not in the shipped registry`);
    assert.match(entry.contentHash, /^0x[0-9a-f]{64}$/);
  }
});
