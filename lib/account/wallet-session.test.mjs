import assert from "node:assert/strict";
import test from "node:test";

test("a customer wallet session must still belong to the proven link", async () => {
  const { walletSessionBound } = await import("./wallet-session.ts");
  const session = { kind: "customer", method: "solana_siws", walletChain: "solana", walletAddress: "wallet-a", account: { wallets: [{ chain: "solana", address: "wallet-a" }] } };
  assert.equal(walletSessionBound(session), true);
  assert.equal(walletSessionBound({ ...session, walletAddress: "wallet-b" }), false);
  assert.equal(walletSessionBound({ ...session, walletChain: "evm" }), false);
  assert.equal(walletSessionBound({ ...session, account: { wallets: [] } }), false);
  assert.equal(walletSessionBound({ ...session, method: "email_password", walletAddress: null }), true);
  assert.equal(walletSessionBound({ ...session, kind: "admin" }), false);
});
