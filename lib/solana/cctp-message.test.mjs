import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CCTP_V2_BURN_BODY_FIXED_BYTES,
  CCTP_V2_HEADER_BYTES,
  CCTP_ZERO_BYTES32,
  cctpMessageNonce,
  cctpSpeedOf,
  decodeCctpV2Message,
  isPlaceholderNonce,
} from "./cctp-message.ts";

/**
 * A real CCTP V2 transfer from Solana to Base, read out of the destination
 * transaction's own `receiveMessage` calldata on Base mainnet.
 *
 * Transaction `0x8c031cf27ded22a8835cd0c2f12d8f52bf790847bb177a3359cab990b74bdeb6`,
 * block 50749476. It is the lane the bridge runs — source domain 5, destination
 * domain 6 — which is why it, and not a synthetic vector, is the fixture. Circle
 * publishes no test vectors and its contract-interfaces page still documents V1
 * shapes for the V2 contracts, so a fixture taken from the documentation would
 * pin the decoder to the wrong layout.
 */
const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/cctp-v2-solana-to-base.json", import.meta.url), "utf8"),
);
const LIVE_SOLANA_TO_BASE_MESSAGE = FIXTURE.messageHex;

test("the live Solana to Base message decodes field for field", () => {
  const decoded = decodeCctpV2Message(LIVE_SOLANA_TO_BASE_MESSAGE);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;

  const { header, burn } = decoded.message;
  const want = FIXTURE.expected;
  assert.equal(header.version, want.version);
  assert.equal(header.sourceDomain, want.sourceDomain, "Solana is Circle domain 5");
  assert.equal(header.destinationDomain, want.destinationDomain, "Base is Circle domain 6");
  assert.equal(header.nonce, want.nonce);
  assert.equal(header.sender, want.sender);
  assert.equal(header.recipient, want.recipient);
  assert.equal(header.destinationCaller, want.destinationCaller);
  assert.equal(header.minFinalityThreshold, want.minFinalityThreshold);
  assert.equal(header.finalityThresholdExecuted, want.finalityThresholdExecuted);

  assert.ok(burn);
  if (!burn) return;
  /* The Solana USDC mint as raw bytes. A Solana address is already 32 bytes,
     so unlike an EVM token it is not left-padded — the twelve leading zeroes
     an EVM reader expects are simply absent, and a decoder that assumed them
     would read the wrong token. */
  assert.equal(burn.burnToken, want.burnToken);
  assert.equal(burn.mintRecipient, want.mintRecipient);
  assert.equal(burn.amountRaw, want.amountRaw);
  assert.equal(burn.maxFeeRaw, want.maxFeeRaw);
  assert.equal(burn.feeExecutedRaw, want.feeExecutedRaw, "what Circle took, not what it was allowed to take");
  assert.equal(burn.expirationBlock, want.expirationBlock);
  assert.equal(burn.hookData.length > 2, true);
});

test("the fee actually taken is read, never inferred from the ceiling", () => {
  const decoded = decodeCctpV2Message(LIVE_SOLANA_TO_BASE_MESSAGE);
  assert.equal(decoded.ok, true);
  if (!decoded.ok || !decoded.message.burn) return;
  const { amountRaw, maxFeeRaw, feeExecutedRaw } = decoded.message.burn;
  assert.notEqual(maxFeeRaw, feeExecutedRaw, "the fixture is only useful because these differ");
  assert.equal(
    (BigInt(amountRaw) - BigInt(feeExecutedRaw)).toString(),
    "514488",
    "received equals burned minus the fee that was executed",
  );
});

test("the header and body sizes are the V2 ones", () => {
  assert.equal(CCTP_V2_HEADER_BYTES, 148);
  assert.equal(CCTP_V2_BURN_BODY_FIXED_BYTES, 228);
  const bytes = (LIVE_SOLANA_TO_BASE_MESSAGE.length - 2) / 2;
  assert.equal(bytes, FIXTURE.messageBytes);
  const decoded = decodeCctpV2Message(LIVE_SOLANA_TO_BASE_MESSAGE);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal((decoded.message.header.messageBody.length - 2) / 2, bytes - CCTP_V2_HEADER_BYTES);
});

test("a V1 message is refused by name rather than decoded into a plausible lie", () => {
  /* Same bytes, version rewritten to 0. V1 puts a uint64 nonce at offset 12 and
     ends its header 32 bytes earlier, so every field after the version would be
     read from the wrong place — and would still look like an address. */
  const v1 = "0x00000000" + LIVE_SOLANA_TO_BASE_MESSAGE.slice(10);
  const decoded = decodeCctpV2Message(v1);
  assert.equal(decoded.ok, false);
  if (decoded.ok) return;
  assert.equal(decoded.code, "VERSION_IS_V1");
  assert.match(decoded.reason, /would succeed and be wrong/);
});

test("truncated, non-hex and odd-length inputs each refuse with their own cause", () => {
  assert.equal(decodeCctpV2Message("not hex").ok, false);
  assert.equal(decodeCctpV2Message("0x00010").ok, false);
  const short = decodeCctpV2Message("0x" + "00".repeat(100));
  assert.equal(short.ok, false);
  if (short.ok) return;
  assert.equal(short.code, "HEADER_TOO_SHORT");

  const notHex = decodeCctpV2Message("0xzz");
  assert.equal(notHex.ok, false);
  if (notHex.ok) return;
  assert.equal(notHex.code, "NOT_HEX");
});

test("a body shorter than a burn body refuses instead of reading past its end", () => {
  const header = LIVE_SOLANA_TO_BASE_MESSAGE.slice(2, 2 + 148 * 2);
  const stub = `0x${header}${"00000001"}${"11".repeat(16)}`;
  const decoded = decodeCctpV2Message(stub);
  assert.equal(decoded.ok, false);
  if (decoded.ok) return;
  assert.equal(decoded.code, "BODY_TOO_SHORT");
});

test("a header with no body decodes and reports no burn", () => {
  const header = LIVE_SOLANA_TO_BASE_MESSAGE.slice(2, 2 + 148 * 2);
  const decoded = decodeCctpV2Message(`0x${header}`);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.equal(decoded.message.burn, null);
  assert.equal(decoded.message.header.messageBody, "0x");
});

test("the nonce can be read without decoding the rest, and only from V2 bytes", () => {
  assert.equal(cctpMessageNonce(LIVE_SOLANA_TO_BASE_MESSAGE), FIXTURE.expected.nonce);
  assert.equal(cctpMessageNonce("0x00000000" + LIVE_SOLANA_TO_BASE_MESSAGE.slice(10)), null);
  assert.equal(cctpMessageNonce("0x00"), null);
  assert.equal(cctpMessageNonce("PENDING"), null);
});

test("the all-zero nonce is named, because the chain answers it already used", () => {
  /* `usedNonces[bytes32(0)]` is pre-marked consumed when the transmitter is
     deployed. Without this guard an unreadable message would ask the chain a
     question it answers "already minted", which is the most dangerous possible
     wrong answer for a duplicate-burn boundary. */
  assert.equal(isPlaceholderNonce(CCTP_ZERO_BYTES32), true);
  assert.equal(isPlaceholderNonce("0x" + "0".repeat(64)), true);
  assert.equal(isPlaceholderNonce(FIXTURE.expected.nonce), false);
});

test("speed is decided by Circle's clamp, not by the raw number", () => {
  assert.equal(cctpSpeedOf(1), "FAST", "anything at or below 1000 is a Fast message");
  assert.equal(cctpSpeedOf(1000), "FAST");
  assert.equal(cctpSpeedOf(1001), "STANDARD");
  assert.equal(cctpSpeedOf(2000), "STANDARD");
});
