import assert from "node:assert/strict";
import test from "node:test";

import { creditedToRecipient } from "./observe.ts";

const RECIPIENT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAYER = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const RECIPIENT_USDC_ATA = "7Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5j";
const RECIPIENT_BONK_ATA = "8Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5k";

function observed(overrides = {}) {
  return {
    ok: true,
    transactionSucceeded: true,
    transactionError: null,
    invokedPrograms: [],
    postTokenAccounts: [],
    observedEffects: [],
    observation: {
      balanceDeltas: [],
      lamportBalanceDeltas: [
        { account: PAYER, rawDelta: "-1000005000" },
        { account: RECIPIENT, rawDelta: "1000000000" },
      ],
      blockTime: null,
    },
    ...overrides,
  };
}

test("a SOL request is credited by the recipient's lamport delta", () => {
  const credit = creditedToRecipient(observed(), { recipient: RECIPIENT, mint: null });
  assert.deepEqual(credit, { amountRaw: "1000000000", mint: null });
});

test("a token request is credited by the recipient-owned account of that mint", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: RECIPIENT, tokenProgram: null, amountRaw: "12500000", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [{ account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "12500000" }],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "12500000", mint: USDC });
});

test("money in another token is reported as that token, never as the requested one", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_BONK_ATA, mint: BONK, owner: RECIPIENT, tokenProgram: null, amountRaw: "5", decimals: 5 },
      ],
      observation: {
        balanceDeltas: [{ account: RECIPIENT_BONK_ATA, mint: BONK, rawDelta: "5" }],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "5", mint: BONK });
});

test("a transaction that credited somebody else counts as nothing for this recipient", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: PAYER, tokenProgram: null, amountRaw: "1", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [{ account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "12500000" }],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "0", mint: USDC });
});
