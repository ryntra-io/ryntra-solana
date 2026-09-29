import assert from "node:assert/strict";
import test from "node:test";

import {
  CCTP_DIRECTIONS,
  CCTP_EVM_CHAINS,
  CCTP_EVM_SOURCE_DIRECTIONS,
  CCTP_SOLANA_SOURCE_DIRECTIONS,
  cctpChainDomain,
  cctpChainLabel,
  cctpChainOfDomain,
  cctpChainRef,
  cctpDestinationChain,
  cctpDestinationProgram,
  cctpDirectionOf,
  cctpEvmChain,
  cctpLaneFacts,
  cctpProgramRef,
  cctpReverseDirection,
  cctpSourceChain,
  cctpSourceProgram,
  cctpUsdcAddress,
  isCctpDirection,
  isChainAddress,
  isChainTransactionId,
  isEvmChain,
  isEvmSourceDirection,
  isSolanaSourceDirection,
} from "./cctp-direction.ts";

/**
 * The property this whole module exists for.
 *
 * Before it, direction was a value in the registry and an assumption everywhere
 * else: the plan asked Circle for one lane, the burn route refused anything
 * that was not that literal, and the attestation route hard-coded a destination
 * domain. Each of those looked like shared code. The tests below are the ones
 * that would have failed then — and, since 2026-09-05, the ones that would fail
 * if Ethereum had been bolted on as a second copy of the Base assumptions.
 */

test("every lane exists and each is the exact reverse of another", function () {
  assert.deepEqual([...CCTP_DIRECTIONS], ["SOLANA_TO_BASE", "BASE_TO_SOLANA", "SOLANA_TO_ETHEREUM", "ETHEREUM_TO_SOLANA"]);
  assert.deepEqual([...CCTP_EVM_CHAINS], ["base", "ethereum"]);
  assert.deepEqual([...CCTP_SOLANA_SOURCE_DIRECTIONS], ["SOLANA_TO_BASE", "SOLANA_TO_ETHEREUM"]);
  assert.deepEqual([...CCTP_EVM_SOURCE_DIRECTIONS], ["BASE_TO_SOLANA", "ETHEREUM_TO_SOLANA"]);
  for (const direction of CCTP_DIRECTIONS) {
    const lane = cctpLaneFacts(direction);
    const reverse = cctpLaneFacts(cctpReverseDirection(direction));
    assert.equal(lane.source.chain, reverse.destination.chain);
    assert.equal(lane.destination.chain, reverse.source.chain);
    assert.equal(lane.source.domain, reverse.destination.domain);
    assert.notEqual(lane.source.domain, lane.destination.domain);
    assert.equal(cctpReverseDirection(cctpReverseDirection(direction)), direction);
    /* Every lane has exactly one Solana end and one EVM end. */
    assert.ok((lane.source.chain === "solana") !== (lane.destination.chain === "solana"), `${direction} is not Solana on exactly one side.`);
    assert.equal(lane.evmChain, lane.source.chain === "solana" ? lane.destination.chain : lane.source.chain);
    assert.equal(cctpEvmChain(direction), lane.evmChain);
    assert.equal(isSolanaSourceDirection(direction), lane.source.chain === "solana");
    assert.equal(isEvmSourceDirection(direction), lane.source.chain !== "solana");
  }
  assert.equal(cctpReverseDirection("SOLANA_TO_ETHEREUM"), "ETHEREUM_TO_SOLANA");
  assert.equal(cctpReverseDirection("SOLANA_TO_BASE"), "BASE_TO_SOLANA");
});

test("a direction is only ever derived from two named chains, never inferred", function () {
  assert.equal(cctpDirectionOf("solana", "base"), "SOLANA_TO_BASE");
  assert.equal(cctpDirectionOf("base", "solana"), "BASE_TO_SOLANA");
  assert.equal(cctpDirectionOf("solana", "ethereum"), "SOLANA_TO_ETHEREUM");
  assert.equal(cctpDirectionOf("ethereum", "solana"), "ETHEREUM_TO_SOLANA");
  /* A chain to itself is not a lane, and neither is EVM to EVM: this product
     bridges to and from Solana only. Answering `null` is what stops a caller
     treating a nonsense pair as the default direction. */
  assert.equal(cctpDirectionOf("solana", "solana"), null);
  assert.equal(cctpDirectionOf("base", "base"), null);
  assert.equal(cctpDirectionOf("base", "ethereum"), null);
  assert.equal(cctpDirectionOf("ethereum", "base"), null);
  assert.equal(isCctpDirection("SOLANA_TO_BASE"), true);
  assert.equal(isCctpDirection("SOLANA_TO_ETHEREUM"), true);
  assert.equal(isCctpDirection("solana_to_base"), false);
  assert.equal(isCctpDirection("SOLANA_TO_ROBINHOOD"), false);
  assert.equal(isCctpDirection(undefined), false);
  assert.equal(isEvmChain("base"), true);
  assert.equal(isEvmChain("ethereum"), true);
  assert.equal(isEvmChain("solana"), false);
  assert.equal(isEvmChain("robinhood-chain"), false);
});

/**
 * The asymmetry that a mirror-image model would have hidden.
 *
 * CCTP credits a *token account* on Solana and an address on an EVM chain, and
 * only an ERC-20 source needs a standing permission. A lane model that
 * pretended the two sides were the same would have produced a burn naming a
 * wallet the destination programme could never pay into.
 */
test("the two chains are not mirror images, and the lane facts say which is which", function () {
  for (const direction of CCTP_SOLANA_SOURCE_DIRECTIONS) {
    const forward = cctpLaneFacts(direction);
    assert.equal(forward.source.requiresTokenApproval, false);
    assert.equal(forward.destination.recipientKind, "OWNER_ADDRESS");
  }
  for (const direction of CCTP_EVM_SOURCE_DIRECTIONS) {
    const reverse = cctpLaneFacts(direction);
    assert.equal(reverse.source.requiresTokenApproval, true);
    assert.equal(reverse.destination.recipientKind, "ASSOCIATED_TOKEN_ACCOUNT");
  }
});

test("an address is only valid for the chain it belongs to", function () {
  const solana = "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj";
  const base = "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401";
  assert.equal(isChainAddress("solana", solana), true);
  assert.equal(isChainAddress("solana", base), false);
  assert.equal(isChainAddress("base", base), true);
  assert.equal(isChainAddress("base", solana), false);
  assert.equal(isChainAddress("ethereum", base), true);
  assert.equal(isChainAddress("ethereum", solana), false);
  assert.equal(isChainAddress("base", null), false);
});

test("a transaction identifier is only valid for the chain it came from", function () {
  const signature = "4TX1LSCt597YZVzTzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  const hash = `0x${"ab".repeat(32)}`;
  assert.equal(isChainTransactionId("solana", signature), true);
  assert.equal(isChainTransactionId("solana", hash), false);
  assert.equal(isChainTransactionId("base", hash), true);
  assert.equal(isChainTransactionId("base", signature), false);
  assert.equal(isChainTransactionId("ethereum", hash), true);
  assert.equal(isChainTransactionId("ethereum", signature), false);
});

test("the source programme is the one that burns on that chain, and they differ by name", function () {
  /* Solana calls it the token messenger *minter*; the EVM chains split the
     same job. Asking for "the source programme" without naming the chain is
     how a plausible wrong address gets into an instruction. */
  assert.match(cctpSourceProgram("SOLANA_TO_BASE"), /^CCTPV2vPZJS2/);
  assert.match(cctpSourceProgram("SOLANA_TO_ETHEREUM"), /^CCTPV2vPZJS2/);
  assert.match(cctpSourceProgram("BASE_TO_SOLANA"), /^0x28b5a0e9/i);
  assert.match(cctpSourceProgram("ETHEREUM_TO_SOLANA"), /^0x28b5a0e9/i);
  assert.match(cctpDestinationProgram("SOLANA_TO_BASE"), /^0x81D40F21/i);
  assert.match(cctpDestinationProgram("SOLANA_TO_ETHEREUM"), /^0x81D40F21/i);
  assert.match(cctpDestinationProgram("BASE_TO_SOLANA"), /^CCTPV2Sm4A/);
  assert.match(cctpDestinationProgram("ETHEREUM_TO_SOLANA"), /^CCTPV2Sm4A/);
});

test("a programme reference names its chain, so two namespaces never compare equal", function () {
  assert.equal(cctpProgramRef("solana", "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"), "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
  assert.equal(cctpProgramRef("base", "0xabc"), "eip155:8453:0xabc");
  /* The same contract bytes at the same address on two chains are two
     different contracts, and the reference has to say so. */
  assert.equal(cctpProgramRef("ethereum", "0xabc"), "eip155:1:0xabc");
  assert.notEqual(cctpProgramRef("ethereum", "0xabc"), cctpProgramRef("base", "0xabc"));
});

test("domains, chain references and assets come from the registry rather than being written twice", function () {
  assert.equal(cctpChainDomain("solana"), 5);
  assert.equal(cctpChainDomain("base"), 6);
  assert.equal(cctpChainDomain("ethereum"), 0);
  assert.equal(cctpChainRef("base"), "eip155:8453");
  assert.equal(cctpChainRef("ethereum"), "eip155:1");
  assert.equal(cctpChainRef("solana"), "solana:mainnet");
  assert.equal(cctpChainLabel("ethereum"), "Ethereum");
  assert.equal(cctpChainLabel("base"), "Base");
  assert.equal(cctpUsdcAddress("solana"), "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(cctpUsdcAddress("base"), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(cctpUsdcAddress("ethereum"), "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(cctpSourceChain("BASE_TO_SOLANA"), "base");
  assert.equal(cctpDestinationChain("BASE_TO_SOLANA"), "solana");
  assert.equal(cctpSourceChain("ETHEREUM_TO_SOLANA"), "ethereum");
  assert.equal(cctpDestinationChain("SOLANA_TO_ETHEREUM"), "ethereum");
  /* Domain 0 is Ethereum and it is falsy; a lookup that lost it would route
     an Ethereum message to "no chain". */
  assert.equal(cctpChainOfDomain(0), "ethereum");
  assert.equal(cctpChainOfDomain(5), "solana");
  assert.equal(cctpChainOfDomain(6), "base");
  assert.equal(cctpChainOfDomain(3), null);
});
