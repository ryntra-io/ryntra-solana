import assert from "node:assert/strict";
import test from "node:test";

import {
  readSolanaReceipts,
  readSendReceipts,
  SOLANA_SEND_RECEIPT_VAULT_KEY,
  SOLANA_SEND_RECEIPT_VAULT_LIMIT,
  stageReceiptForVerifier,
  storeBoundSolanaReceipt,
  storeSolanaReceipt,
  storeSendReceipt,
} from "./send-receipt-vault.client.ts";

/**
 * Where a person's own receipts live.
 *
 * This browser, and nowhere else. That boundary is the design, not a
 * limitation to work around: a server-side archive of who paid whom is a
 * database this product has no reason to hold. The consequence has to be said
 * plainly on the surface — clearing site data clears the history — which is
 * why the downloadable signed JSON is the durable copy.
 */

const WALLET = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const OTHER_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** The smallest thing that behaves like `Storage` for these functions. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() {
      return map.size;
    },
    raw: map,
  };
}

let contentHashCounter = 0;

function receipt(id, signature = "3".repeat(88)) {
  /* A distinct hash per call, counted rather than derived from the id. The
     first version padded the id on the right, so `r1` and `r10` both became
     `0xr1000…` and the dedupe below silently ate half the fixtures. */
  contentHashCounter += 1;
  return {
    schema: "ryntra.agent.outcome-receipt",
    receiptId: id,
    contentHash: `0x${String(contentHashCounter).padStart(64, "0")}`,
    facts: { network: "mainnet", signature },
    issuer: { signature: "abc" },
  };
}

test("a stored receipt reads back for its own wallet and no other", () => {
  const storage = fakeStorage();
  assert.equal(storeSendReceipt(storage, WALLET, receipt("a")).ok, true);

  assert.equal(readSendReceipts(storage, WALLET).length, 1);
  assert.deepEqual(readSendReceipts(storage, OTHER_WALLET), []);
});

test("the shared Solana vault accepts the real v2 Outcome Receipt id shape", () => {
  const storage = fakeStorage();
  const artifact = {
    schemaVersion: "2.0.0",
    kind: "OUTCOME_RECEIPT",
    id: "outcome_solana_mainnet_example",
    contentHash: `0x${"a".repeat(64)}`,
  };

  assert.equal(storeSolanaReceipt(storage, WALLET, artifact).ok, true);
  const stored = readSolanaReceipts(storage, WALLET);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].receipt.id, artifact.id);
});

test("a receipt settled by wallet A can never enter wallet B's journal", () => {
  const storage = fakeStorage();
  const artifact = receipt("wallet-bound");

  assert.equal(storeBoundSolanaReceipt(storage, WALLET, OTHER_WALLET, artifact).ok, false);
  assert.deepEqual(readSolanaReceipts(storage, WALLET), []);
  assert.deepEqual(readSolanaReceipts(storage, OTHER_WALLET), []);

  assert.equal(storeBoundSolanaReceipt(storage, WALLET, WALLET, artifact).ok, true);
  assert.equal(readSolanaReceipts(storage, WALLET).length, 1);
  assert.deepEqual(readSolanaReceipts(storage, OTHER_WALLET), []);
});

test("wallet addresses are case-sensitive, because base58 is", () => {
  const storage = fakeStorage();
  storeSendReceipt(storage, WALLET, receipt("a"));
  assert.deepEqual(readSendReceipts(storage, WALLET.toLowerCase()), []);
});

test("the same receipt stored twice appears once", () => {
  const storage = fakeStorage();
  /* The same artifact, not a second one that looks like it — identity here is
     the content hash, which is what a retried settle call returns. */
  const settled = receipt("a");
  storeSendReceipt(storage, WALLET, settled);
  const again = storeSendReceipt(storage, WALLET, settled);
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(readSendReceipts(storage, WALLET).length, 1);
});

test("history keeps the newest entries up to its cap and drops the oldest", () => {
  const storage = fakeStorage();
  for (let index = 0; index < SOLANA_SEND_RECEIPT_VAULT_LIMIT + 5; index += 1) {
    storeSendReceipt(storage, WALLET, receipt(`r${index}`));
  }
  const stored = readSendReceipts(storage, WALLET);
  assert.equal(stored.length, SOLANA_SEND_RECEIPT_VAULT_LIMIT);
  /* Newest first, and the five oldest are gone rather than silently kept. */
  assert.equal(stored[0].receipt.receiptId, `r${SOLANA_SEND_RECEIPT_VAULT_LIMIT + 4}`);
  assert.ok(!stored.some((entry) => entry.receipt.receiptId === "r0"));
});

test("something that is not a receipt is refused rather than stored", () => {
  const storage = fakeStorage();
  for (const value of [null, "text", 42, {}, { receiptId: "a" }]) {
    assert.equal(storeSendReceipt(storage, WALLET, value).ok, false);
  }
  assert.deepEqual(readSendReceipts(storage, WALLET), []);
});

test("malformed or foreign storage reads as empty instead of throwing", () => {
  assert.deepEqual(readSendReceipts(fakeStorage({ [SOLANA_SEND_RECEIPT_VAULT_KEY]: "{" }), WALLET), []);
  assert.deepEqual(readSendReceipts(fakeStorage({ [SOLANA_SEND_RECEIPT_VAULT_KEY]: "[]" }), WALLET), []);
  assert.deepEqual(
    readSendReceipts(fakeStorage({ [SOLANA_SEND_RECEIPT_VAULT_KEY]: '{"v":1}' }), WALLET),
    [],
  );
});

test("a storage that throws on every access is survivable", () => {
  const hostile = {
    getItem() {
      throw new Error("site data is blocked");
    },
    setItem() {
      throw new Error("site data is blocked");
    },
    removeItem() {
      throw new Error("site data is blocked");
    },
  };
  assert.deepEqual(readSendReceipts(hostile, WALLET), []);
  assert.equal(storeSendReceipt(hostile, WALLET, receipt("a")).ok, false);
});

test("nothing signable or secret is written to the vault", () => {
  const storage = fakeStorage();
  storeSendReceipt(storage, WALLET, {
    ...receipt("a"),
    unsignedWireBase64: "AAAA",
    privateKey: "never",
    nested: {
      signedWireBase64: "BBBB",
      transactionBase64: "CCCC",
      signedTransactionBase64: "DDDD",
      reviewedTransactionBase64: "EEEE",
      expectedWireBase64: "FFFF",
      actualWireBase64: "GGGG",
      reviewedWireBase64: "HHHH",
      returnedWireBase64: "IIII",
      evidence: [{ secretKey: "never either", seedPhrase: "twelve words", safeFact: "kept" }],
    },
  });
  const serialized = storage.getItem(SOLANA_SEND_RECEIPT_VAULT_KEY);
  assert.ok(!/privateKey|secretKey|seedPhrase|(?:transaction|Wire)Base64/.test(serialized));
  assert.match(serialized, /safeFact/);
});

test("the verifier handoff is one-time: staged, then gone once read", () => {
  const storage = fakeStorage();
  stageReceiptForVerifier(storage, receipt("a"));
  const staged = storage.raw.size;
  assert.equal(staged, 1);
  /* The verifier removes the staged artifact after reading it; storing again
     replaces rather than accumulates, so a stale artifact cannot be opened by
     someone who arrives at the verifier later. */
  stageReceiptForVerifier(storage, receipt("b"));
  assert.equal(storage.raw.size, 1);
});
