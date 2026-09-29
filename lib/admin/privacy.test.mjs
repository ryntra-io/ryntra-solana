import assert from "node:assert/strict";
import test from "node:test";

import { carriesForbiddenAdminProperty, isForbiddenAdminProperty, stripForbiddenAdminProperties } from "./privacy.ts";

test("forbidden keys are stripped at every depth, inside arrays as well as objects", () => {
  const stripped = stripForbiddenAdminProperties({
    surface: "app",
    steps: [
      { name: "review", wallet_address: "0xabc", amount: "12.5" },
      { name: "sign", signature: "5Kd...", nested: { balance: 10, ok: true } },
    ],
    prompt: "private text",
    telegramId: 1,
    context: { user_agent: "Mozilla", locale: "uk", txHash: "0xdead" },
  });
  assert.deepEqual(stripped, {
    surface: "app",
    steps: [{ name: "review" }, { name: "sign", nested: { ok: true } }],
    context: { locale: "uk" },
  });
  assert.equal(carriesForbiddenAdminProperty(stripped), false);
});

test("the classifier names identifiers, secrets, amounts, hashes, prompts and fingerprints", () => {
  for (const key of [
    "wallet_address", "walletAddress", "walletAddresses", "pnl", "realized_pnl", "portfolio_value", "position_size",
    "token_amount", "trade_size", "tx_hash", "transactionHash", "hash", "receipt_hash", "signature", "txSignature",
    "seed_phrase", "mnemonic", "private_key", "privateKey", "api_secret", "client_secret", "access_token", "bearer",
    "prompt", "raw_prompt", "balance", "usdc_balance", "amount", "amount_in", "input_amount", "query_string",
    "user_agent", "ip", "ip_address", "telegram_id", "telegramId", "telegram_username", "username", "email",
    "first_name", "feedback_body",
  ]) {
    assert.equal(isForbiddenAdminProperty(key), true, key);
  }
  for (const key of ["workspace", "surface", "locale", "outcome", "error_class", "category", "first", "persisted", "reason", "token_mint", "tokens", "count"]) {
    assert.equal(isForbiddenAdminProperty(key), false, key);
  }
});

test("detection reaches into arrays and stops at a bounded depth", () => {
  assert.equal(carriesForbiddenAdminProperty({ a: [{ b: [{ pnl: 1 }] }] }), true);
  assert.equal(carriesForbiddenAdminProperty({ a: [{ b: [{ ok: 1 }] }] }), false);
  let deep = { pnl: 1 };
  for (let i = 0; i < 12; i += 1) deep = { child: deep };
  assert.equal(carriesForbiddenAdminProperty(deep), false, "beyond the depth bound nothing is read, and the strip drops it");
  assert.deepEqual(JSON.stringify(stripForbiddenAdminProperties(deep)).includes("pnl"), false);
});
