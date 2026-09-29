import assert from "node:assert/strict";
import test from "node:test";

import {
  SOLANA_CCTP_DIRECTIONS,
  SOLANA_CCTP_EVM_CHAINS,
  SOLANA_CCTP_MAINNET_REGISTRY,
  cctpRegistryDigest,
  solanaCctpChainByDomain,
  solanaCctpDirectionsFor,
  solanaCctpEvmChainOf,
  solanaCctpLane,
  verifySolanaCctpRegistry,
} from "./cctp-registry.ts";

test("the first mainnet CCTP pair is exact native USDC on Solana domain 5 and Base domain 6", () => {
  const registry = SOLANA_CCTP_MAINNET_REGISTRY;
  assert.equal(registry.network, "MAINNET");
  assert.equal(registry.provider, "CIRCLE_CCTP_V2");
  assert.equal(registry.chains.solana.domain, 5);
  assert.equal(registry.chains.solana.chainRef, "solana:mainnet");
  assert.equal(registry.chains.solana.asset.address, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(registry.chains.solana.asset.representation, "NATIVE_USDC");
  assert.equal(registry.chains.base.domain, 6);
  assert.equal(registry.chains.base.chainRef, "eip155:8453");
  assert.equal(registry.chains.base.asset.address, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(registry.chains.base.asset.representation, "NATIVE_USDC");
  /* The Base pair keeps its names and its place at the front: durable claims
     and receipts on production were written under those literals. */
  assert.deepEqual(SOLANA_CCTP_DIRECTIONS.slice(0, 2), ["SOLANA_TO_BASE", "BASE_TO_SOLANA"]);
});

/**
 * Ethereum, added 2026-09-05 by `RYN-SOL-MONEY-FLOWS-001E`.
 *
 * Every number below was read off Circle's own pages that day: domain 0 on the
 * supported-chains table, USDC at `0xA0b8…eB48` on the USDC contract page, and
 * the four V2 contracts at the same addresses Base uses — Circle deploys V2 at
 * identical addresses on every EVM chain, and the test pins that rather than
 * letting a copied address drift on one chain and not the other.
 */
test("Ethereum is native USDC on domain 0 through the same V2 contracts Base uses", () => {
  const { base, ethereum } = SOLANA_CCTP_MAINNET_REGISTRY.chains;
  assert.equal(ethereum.domain, 0);
  assert.equal(ethereum.chainRef, "eip155:1");
  assert.equal(ethereum.asset.address, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(ethereum.asset.assetRef, "eip155:1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(ethereum.asset.representation, "NATIVE_USDC");
  assert.deepEqual(
    ethereum.components.map((entry) => [entry.role, entry.address]),
    base.components.map((entry) => [entry.role, entry.address]),
  );
  assert.deepEqual(SOLANA_CCTP_DIRECTIONS, ["SOLANA_TO_BASE", "BASE_TO_SOLANA", "SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"]);
  assert.deepEqual(SOLANA_CCTP_EVM_CHAINS, ["base", "ethereum"]);
  assert.equal(solanaCctpEvmChainOf("SOLANA_TO_ETHEREUM"), "ethereum");
  assert.equal(solanaCctpEvmChainOf("ETHEREUM_TO_SOLANA"), "ethereum");
  assert.equal(solanaCctpEvmChainOf("BASE_TO_SOLANA"), "base");
  assert.deepEqual(solanaCctpDirectionsFor("ethereum"), { fromSolana: "SOLANA_TO_ETHEREUM", toSolana: "ETHEREUM_TO_SOLANA" });
  assert.deepEqual(solanaCctpDirectionsFor("base"), { fromSolana: "SOLANA_TO_BASE", toSolana: "BASE_TO_SOLANA" });
  /* Domain 0 is falsy. A lookup that treated it as "no domain" would lose Ethereum. */
  assert.equal(solanaCctpChainByDomain(0)?.id, "ethereum");
  assert.equal(solanaCctpChainByDomain(5)?.id, "solana");
  assert.equal(solanaCctpChainByDomain(6)?.id, "base");
  assert.equal(solanaCctpChainByDomain(3), null);
});

test("every deployed component is role-named and sourced from official Circle documentation", () => {
  const { solana, base, ethereum } = SOLANA_CCTP_MAINNET_REGISTRY.chains;
  assert.deepEqual(solana.components.map((entry) => entry.role), [
    "MESSAGE_TRANSMITTER_V2",
    "TOKEN_MESSENGER_MINTER_V2",
  ]);
  for (const evm of [base, ethereum]) {
    assert.deepEqual(evm.components.map((entry) => entry.role), [
      "MESSAGE_TRANSMITTER_V2",
      "TOKEN_MESSENGER_V2",
      "TOKEN_MINTER_V2",
      "MESSAGE_V2",
    ]);
  }
  for (const chain of [solana, base, ethereum]) {
    assert.match(chain.asset.sourceRef, /^https:\/\/developers\.circle\.com\//);
    for (const component of chain.components) {
      assert.match(component.sourceRef, /^https:\/\/developers\.circle\.com\//);
    }
  }
});

test("every lane direction preserves native representation and the current capability facts", () => {
  for (const direction of SOLANA_CCTP_DIRECTIONS) {
    const lane = solanaCctpLane(direction);
    assert.equal(lane.direction, direction);
    assert.notEqual(lane.source.id, lane.destination.id);
    assert.ok(lane.source.id === "solana" || lane.destination.id === "solana", `${direction} does not touch Solana.`);
    assert.equal(lane.source.asset.symbol, "USDC");
    assert.equal(lane.destination.asset.symbol, "USDC");
    assert.equal(lane.source.asset.representation, "NATIVE_USDC");
    assert.equal(lane.destination.asset.representation, "NATIVE_USDC");
    assert.equal(lane.source.capabilities.standardSource, true);
    assert.equal(lane.source.capabilities.fastSource, true);
  }
  assert.equal(solanaCctpLane("SOLANA_TO_ETHEREUM").destination.id, "ethereum");
  assert.equal(solanaCctpLane("ETHEREUM_TO_SOLANA").source.id, "ethereum");
  assert.equal(solanaCctpLane("SOLANA_TO_BASE").destination.id, "base");
});

test("the registry digest is deterministic and unofficial or identity-mutated registries fail closed", () => {
  const digest = cctpRegistryDigest(SOLANA_CCTP_MAINNET_REGISTRY);
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  assert.equal(cctpRegistryDigest(structuredClone(SOLANA_CCTP_MAINNET_REGISTRY)), digest);

  const unofficial = structuredClone(SOLANA_CCTP_MAINNET_REGISTRY);
  unofficial.chains.base.components[0].sourceRef = "https://example.com/contracts";
  assert.equal(verifySolanaCctpRegistry(unofficial).ok, false);

  const wrongDomain = structuredClone(SOLANA_CCTP_MAINNET_REGISTRY);
  wrongDomain.chains.solana.domain = 6;
  assert.equal(verifySolanaCctpRegistry(wrongDomain).ok, false);

  const wrongEthereumDomain = structuredClone(SOLANA_CCTP_MAINNET_REGISTRY);
  wrongEthereumDomain.chains.ethereum.domain = 1;
  assert.equal(verifySolanaCctpRegistry(wrongEthereumDomain).ok, false);

  const wrapped = structuredClone(SOLANA_CCTP_MAINNET_REGISTRY);
  wrapped.chains.base.asset.representation = "WRAPPED_USDC";
  assert.equal(verifySolanaCctpRegistry(wrapped).ok, false);

  const bridgedUsdc = structuredClone(SOLANA_CCTP_MAINNET_REGISTRY);
  bridgedUsdc.chains.ethereum.asset.address = "0x2F21c6499fa53a680120e654a27640Fc8Aa40BeD";
  assert.equal(verifySolanaCctpRegistry(bridgedUsdc).ok, false);
});
