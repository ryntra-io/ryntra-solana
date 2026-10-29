import assert from "node:assert/strict";
import test from "node:test";

import { openingSendAsset, SEND_NATIVE_SOL, SEND_OPENING_USDC } from "./send-asset-preference.client.ts";
import { recentSendRecipients, rememberSendRecipient } from "./send-recipients.client.ts";

const OWNER = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const A = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
const B = "cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN";

function store() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("«Надіслати» opens on USDC when the wallet holds it, never on «? Актив» (B18)", () => {
  assert.equal(openingSendAsset("", [SEND_NATIVE_SOL, SEND_OPENING_USDC, BONK]), SEND_OPENING_USDC);
});

test("the coin last sent wins while the wallet still holds it", () => {
  assert.equal(openingSendAsset(BONK, [SEND_NATIVE_SOL, SEND_OPENING_USDC, BONK]), BONK);
  assert.equal(openingSendAsset(BONK, [SEND_NATIVE_SOL, SEND_OPENING_USDC]), SEND_OPENING_USDC);
});

test("without USDC the wallet's SOL, and nothing the wallet does not hold", () => {
  assert.equal(openingSendAsset("", [SEND_NATIVE_SOL, BONK]), SEND_NATIVE_SOL);
  assert.equal(openingSendAsset("", [BONK]), "");
  assert.equal(openingSendAsset("", []), "");
});

test("recipients are owner-bound, newest first, five at most, no duplicates", () => {
  const storage = store();
  rememberSendRecipient(storage, OWNER, A);
  rememberSendRecipient(storage, OWNER, B);
  rememberSendRecipient(storage, OWNER, A);
  assert.deepEqual(recentSendRecipients(storage, OWNER), [A, B]);
  assert.deepEqual(recentSendRecipients(storage, A), []);
  for (let i = 0; i < 8; i += 1) rememberSendRecipient(storage, OWNER, i % 2 ? A : B);
  assert.ok(recentSendRecipients(storage, OWNER).length <= 5);
});

test("only a real address is kept — never the wallet itself, never junk from storage", () => {
  const storage = store();
  rememberSendRecipient(storage, OWNER, OWNER);
  rememberSendRecipient(storage, OWNER, "not an address");
  assert.deepEqual(recentSendRecipients(storage, OWNER), []);
  storage.setItem(`ryntra.solana.send.recipients:${OWNER}`, JSON.stringify([A, 42, "0xdead", OWNER]));
  assert.deepEqual(recentSendRecipients(storage, OWNER), [A]);
  storage.setItem(`ryntra.solana.send.recipients:${OWNER}`, "{oops");
  assert.deepEqual(recentSendRecipients(storage, OWNER), []);
});

test("blocked storage costs the chips, never the form", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => rememberSendRecipient(blocked, OWNER, A));
  assert.deepEqual(recentSendRecipients(blocked, OWNER), []);
});
