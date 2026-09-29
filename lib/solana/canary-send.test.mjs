import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSendCanaryIntent } from "./canary-send.ts";
import { SOLANA_MAINNET_USDC_MINT } from "./canary-policy.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./send-kinds.ts";

const DESTINATION = "ATvsQx9F1stmRoHhs1e7ipzvRB3gtUcDuy6mTFzv3guu";
const SENDER = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const BUILT_AT = "2026-08-27T16:00:00.000Z";

function plan(overrides = {}) {
  return {
    actionKind: "SPL_TRANSFER_CHECKED",
    network: "mainnet",
    mint: SOLANA_MAINNET_USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    decimals: 6,
    sender: SENDER,
    recipient: DESTINATION,
    senderTokenAccount: SENDER,
    recipientTokenAccount: DESTINATION,
    createsRecipientAccount: false,
    ataRentLamports: null,
    amountRaw: "1000000",
    senderBalanceRaw: "2000000",
    baseFeeLamports: "5000",
    priorityFeeLamports: "0",
    programs: [TOKEN_PROGRAM_ID],
    blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    lastValidBlockHeight: "350000000",
    unsignedWireBase64: "A".repeat(128),
    fingerprint: {
      messageHash: "0x" + "1".repeat(64),
      network: "mainnet",
      feePayer: SENDER,
      blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
      instructionCount: 1,
      transfer: {
        programAddress: TOKEN_PROGRAM_ID,
        source: SENDER,
        mint: SOLANA_MAINNET_USDC_MINT,
        destination: DESTINATION,
        authority: SENDER,
        amountRaw: "1000000",
        decimals: 6,
      },
    },
    builtAt: BUILT_AT,
    ...overrides,
  };
}

test("a mainnet USDC transfer binds principal but stays UNKNOWN until SOL fees are valued", () => {
  const intent = buildSendCanaryIntent({ plan: plan(), humanApproval: "NOT_RECORDED" });
  assert.deepEqual(intent, {
    schema: "ryntra.solana.canary-intent",
    schemaVersion: "1.0.0",
    intentId: "send:0x" + "1".repeat(64),
    revision: 1,
    family: "SEND",
    network: "mainnet",
    destination: DESTINATION,
    mints: [SOLANA_MAINNET_USDC_MINT],
    programs: [TOKEN_PROGRAM_ID],
    principalUsdMicros: "1000000",
    feeReserveUsdMicros: null,
    usdMicros: null,
    valuation: null,
    humanApproval: "NOT_RECORDED",
  });
});

test("ATA creation and Token-2022 remain separate canary families", () => {
  const ata = buildSendCanaryIntent({
    plan: plan({ actionKind: "TOKEN_ATA_CREATE", createsRecipientAccount: true }),
    humanApproval: "RECORDED",
  });
  assert.equal(ata.family, "ATA_CREATE");

  const token2022 = buildSendCanaryIntent({
    plan: plan({
      actionKind: "TOKEN_2022",
      mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      programs: [TOKEN_2022_PROGRAM_ID],
      fingerprint: {
        ...plan().fingerprint,
        messageHash: "0x" + "2".repeat(64),
      },
    }),
    humanApproval: "RECORDED",
  });
  assert.equal(token2022.family, "TOKEN_2022");
  assert.equal(token2022.principalUsdMicros, null);
  assert.equal(token2022.feeReserveUsdMicros, null);
  assert.equal(token2022.usdMicros, null);
  assert.equal(token2022.valuation, null);
});

test("native SOL never borrows the wrapped-SOL quote as an exact canary valuation", () => {
  const system = "11111111111111111111111111111111";
  const native = buildSendCanaryIntent({
    plan: plan({
      actionKind: "NATIVE_SOL",
      mint: system,
      tokenProgram: system,
      decimals: 9,
      programs: [system],
      fingerprint: {
        ...plan().fingerprint,
        messageHash: "0x" + "3".repeat(64),
      },
    }),
    humanApproval: "RECORDED",
  });
  assert.equal(native.family, "SEND");
  assert.equal(native.principalUsdMicros, null);
  assert.equal(native.feeReserveUsdMicros, null);
  assert.equal(native.usdMicros, null);
  assert.equal(native.valuation, null);
});
