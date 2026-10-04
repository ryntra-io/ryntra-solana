/**
 * The Base Sepolia adapter, held to the same proof the Solana module carries:
 * resolvable from the shipped registry, exact about what it will accept, and
 * absent by name from every central schema source — read from disk rather
 * than taken on faith.
 *
 * One assertion here is not about mechanism at all. The rail is testnet only,
 * so this file checks that Base mainnet is missing from the declared chains.
 * A chain reference is what a policy matches on, so an extra one is not a
 * cosmetic surplus: it is an execution rail nobody decided to open.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AGENT_CONTROL_REGISTRY, resolveRegistryRef } from "../registry.ts";
import {
  BASE_EVM_ADAPTER_REF,
  BASE_EVM_DEFINITIONS,
  BASE_SEPOLIA_CAIP2,
  ERC20_TRANSFER_ACTION_REF,
  Erc20TransferInputSchema,
  Erc20TransferObservationSchema,
} from "./base-evm.ts";

/** The central set the registry's own suite pins, verbatim so a rename there
 * breaks this file loudly instead of silently narrowing the proof. */
const CENTRAL_SCHEMA_SOURCES = [
  "lib/agent-control/contracts.ts",
  "lib/agent-control/registry.ts",
];

const BASE_EVM_MODULE = "lib/agent-control/adapters/base-evm.ts";

/** This repository has been bitten by CRLF before: a checkout with
 * `autocrlf` on changes the bytes on disk without changing the source, so
 * every read here is normalised before anything is asserted about it. */
function readNormalised(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/* ── the no-central-edit claim, proven on the real third network ─────── */

test("the Base adapter is absent by name from every central schema source", () => {
  /*
   * Two names, because a provider can leak into the centre either way: by its
   * adapter id, or by the chain it runs on. If "base-evm" or "84532" turns up
   * in contracts.ts or registry.ts, this network cost a central edit and the
   * registry's whole claim is dead.
   */
  for (const path of CENTRAL_SCHEMA_SOURCES) {
    /*
     * Separators are stripped, not just case-folded. Lowercasing turns
     * `BASE_EVM` into `base_evm`, which does not match `base-evm` — so a
     * future central edit that leaked the provider in as a symbol rather than
     * as the ref string would have kept this check green while the centre had
     * in fact been edited. `baseEvm`, `BASE_EVM` and `base-evm` all collapse
     * to the same needle here.
     */
    const source = readNormalised(path).toLowerCase().replace(/[^a-z0-9]/g, "");
    assert.ok(
      !source.includes("baseevm"),
      `${path} names base-evm — the network still cost a central edit`,
    );
    assert.ok(
      !source.includes("84532"),
      `${path} names chain 84532 — the network still cost a central edit`,
    );
  }
});

test("the Base module imports nothing central", () => {
  /*
   * The disk check above proves the centre does not know this module. This
   * proves the reverse direction: the module does not reach back into the
   * centre either. An adapter that imported the registry could not be loaded
   * before the registry it is spread into, and the extension point would be a
   * cycle instead of a manifest entry.
   */
  /*
   * Every import specifier, parsed — not two quoted literals matched as
   * substrings. The first draft checked for `"../registry.ts"` exactly, so the
   * same import written with single quotes, spelled through a longer relative
   * path, or split across a concatenation would have sailed past a green test.
   * A gate that only catches the spelling somebody already thought of is not a
   * gate.
   */
  const source = readNormalised(BASE_EVM_MODULE);
  const specifiers = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map(([, value]) => value);

  assert.deepEqual(specifiers, ["zod"], `the adapter imports ${specifiers.join(", ")}`);
  for (const specifier of specifiers) {
    for (const central of ["registry", "contracts"]) {
      assert.ok(
        !specifier.includes(central),
        `the adapter imports ${specifier}, which reaches the central ${central}`,
      );
    }
  }
  /* A dynamic import built from pieces would defeat the parse above, so the
     module is refused the ability to have one at all. */
  assert.ok(!/\bimport\s*\(/.test(source.replace(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g, "")),
    "a computed dynamic import would make the specifier list above incomplete");
});

/* ── the shipped registry ────────────────────────────────────────────── */

test("the shipped registry resolves the Base adapter and its ERC-20 transfer action", () => {
  const adapter = resolveRegistryRef(AGENT_CONTROL_REGISTRY, BASE_EVM_ADAPTER_REF, "ADAPTER");
  assert.equal(adapter.displayName, "Base Sepolia EVM");
  assert.equal(adapter.capability, "READ_ONLY");
  assert.equal(adapter.status, "ALLOWED");
  assert.deepEqual(adapter.chainRefs, [BASE_SEPOLIA_CAIP2]);

  const action = resolveRegistryRef(AGENT_CONTROL_REGISTRY, ERC20_TRANSFER_ACTION_REF, "ACTION_SCHEMA");
  assert.equal(action.displayName, "ERC-20 transfer");
  assert.equal(action.adapterRef, BASE_EVM_ADAPTER_REF);
  assert.equal(action.canonicalClass, "VALUE_TRANSFER", "a verifier ignorant of Base still reads that value moves");
  assert.equal(action.budget, "OPTIONAL");
  assert.equal(action.status, "ALLOWED");
});

test("Base mainnet is not a declared chain of this adapter", () => {
  const adapter = resolveRegistryRef(AGENT_CONTROL_REGISTRY, BASE_EVM_ADAPTER_REF, "ADAPTER");
  assert.ok(
    !adapter.chainRefs.includes("eip155:8453"),
    "the rail is testnet only: declaring Base mainnet here would open an execution rail nobody decided to open",
  );
  assert.equal(BASE_SEPOLIA_CAIP2, "eip155:84532");
});

test("every Base definition landed in the shipped registry, hash-pinned", () => {
  for (const definition of BASE_EVM_DEFINITIONS) {
    const entry = AGENT_CONTROL_REGISTRY.entries.find((candidate) => candidate.ref === definition.ref);
    assert.ok(entry, `${definition.ref} is in the manifest but not in the shipped registry`);
    assert.match(entry.contentHash, /^0x[0-9a-f]{64}$/);
  }
});

/* ── the action's input contract ─────────────────────────────────────── */

const VALID_INPUT = {
  schemaVersion: "1.0.0",
  actionRef: ERC20_TRANSFER_ACTION_REF,
  chainRef: "eip155:84532",
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  from: "0x2e4a1b0f7fcb2b0aef2b4b6dd0b4e0c1b7a2d3f4",
  to: "0x8fD1B0F7Fcb2B0aEF2b4b6dd0b4e0c1b7A2D3F45",
  amountRaw: "1500000",
};

test("a valid ERC-20 transfer input parses and a float amount does not exist as a concept", () => {
  assert.deepEqual(Erc20TransferInputSchema.parse(VALID_INPUT), VALID_INPUT);

  for (const broken of [
    /* A float amount: 256-bit base units do not survive a JS number, and a
       lossy amount is a wrong amount. */
    { ...VALID_INPUT, amountRaw: "1.5" },
    { ...VALID_INPUT, amountRaw: 1500000 },
    { ...VALID_INPUT, amountRaw: "-1" },
    { ...VALID_INPUT, amountRaw: "01" },
    /* A short address is the classic truncation bug, and it must refuse at
       the schema rather than reach a node that would happily reject it later
       with a message about nothing. */
    { ...VALID_INPUT, to: "0x8fD1B0F7Fcb2B0aEF2b4b6dd0b4e0c1b7A2D3F4" },
    { ...VALID_INPUT, from: "2e4a1b0f7fcb2b0aef2b4b6dd0b4e0c1b7a2d3f4" },
    { ...VALID_INPUT, token: "0xZZZZbD53842c5426634e7929541eC2318f3dCF7e" },
    /* The wrong chain is the one refusal the testnet-only rule turns on. */
    { ...VALID_INPUT, chainRef: "eip155:8453" },
    { ...VALID_INPUT, extra: "field" },
  ]) {
    assert.equal(Erc20TransferInputSchema.safeParse(broken).success, false);
  }
});

/* ── the observation contract ────────────────────────────────────────── */

const VALID_OBSERVATION = {
  schemaVersion: "1.0.0",
  actionRef: ERC20_TRANSFER_ACTION_REF,
  chainRef: "eip155:84532",
  transactionHash: "0x9c1f1b1ad2a3f4e5d60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
  blockNumber: "19482310",
  blockTime: "2026-08-22T09:14:31.000+00:00",
  gasUsed: "51234",
  effectiveGasPriceWei: "1000000253",
  status: "SUCCEEDED",
  balanceDeltas: [
    {
      account: "0x2e4a1b0f7fcb2b0aef2b4b6dd0b4e0c1b7a2d3f4",
      token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      rawDelta: "-1500000",
    },
    {
      account: "0x8fD1B0F7Fcb2B0aEF2b4b6dd0b4e0c1b7A2D3F45",
      token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      rawDelta: "1500000",
    },
  ],
  sources: [
    { ref: "eip155:84532:rpc:eth_getTransactionReceipt/0x9c1f1b1a", label: "Base Sepolia JSON-RPC" },
  ],
  observedAt: "2026-08-22T09:15:00.000+00:00",
};

test("a reverted transaction that moved nothing is a legal observation", () => {
  assert.deepEqual(Erc20TransferObservationSchema.parse(VALID_OBSERVATION), VALID_OBSERVATION);

  /* A revert is not the absence of a transaction: it landed, it was paid for,
     and it moved nothing. A schema that could not say that would force the
     most important outcome this product records to be reported as either a
     success or a missing read, and both are lies. */
  const reverted = {
    ...VALID_OBSERVATION,
    status: "REVERTED",
    balanceDeltas: [],
  };
  assert.deepEqual(Erc20TransferObservationSchema.parse(reverted), reverted);

  /* A receipt read on its own carries no block timestamp; resolving one costs
     a second call. "I do not know when" beats an invented time. */
  assert.equal(
    Erc20TransferObservationSchema.safeParse({ ...VALID_OBSERVATION, blockTime: null }).success,
    true,
  );
});

test("an observation without provenance is a claim, not evidence", () => {
  assert.equal(Erc20TransferObservationSchema.safeParse({ ...VALID_OBSERVATION, sources: [] }).success, false);

  for (const broken of [
    { ...VALID_OBSERVATION, transactionHash: "0xdeadbeef" },
    { ...VALID_OBSERVATION, blockNumber: "-1" },
    { ...VALID_OBSERVATION, gasUsed: "51234.5" },
    { ...VALID_OBSERVATION, effectiveGasPriceWei: "1e9" },
    { ...VALID_OBSERVATION, status: "FAILED" },
    { ...VALID_OBSERVATION, blockTime: "yesterday" },
    { ...VALID_OBSERVATION, extra: true },
  ]) {
    assert.equal(Erc20TransferObservationSchema.safeParse(broken).success, false);
  }
});
