import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCKHASH_WINDOW_MS,
  blocksNewSend,
  decideResume,
  forgetPendingSend,
  readLatestPendingSend,
  readPendingSend,
  rememberPendingSend,
  SOLANA_SEND_PENDING_KEY,
  SOLANA_SEND_PENDING_LIMIT,
} from "./send-pending.client.ts";

/**
 * The record that stands between a person and sending the same money twice.
 *
 * Send held the signature of an approved transfer in React state alone, so a
 * reload between the wallet approving and `../settle` answering left a live
 * mainnet transfer that nothing could name. These tests pin the two properties
 * that make the fix worth having: the record survives, and it never leaks from
 * the wallet that signed it to another one on the same device.
 */

const WALLET_A = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";
const WALLET_B = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const SIG_A =
  "ynoLJfquZGRs3S7XUuir8NVPcsPutnJC2EmeyjdZYZ5SHYnvm5HNkSsxKWR5ZoVdVBreYq7caMGynZKmcCKCXST";
const SIG_B =
  "3y2ZChH8i1jUN7LUyLR6oemFsJqcC73sJXTLVvzybqQ7KzT4PyySqWE3h65KbEQfh8o9tFu8qgB77Z8vaZp7t26";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    /* Test-only window into what was actually written. */
    raw: () => map.get(SOLANA_SEND_PENDING_KEY) ?? null,
  };
}

function pending(wallet, signature) {
  return { wallet, signature, network: "mainnet", signedAt: "2026-09-03T15:00:00.000Z" };
}

test("a signed transfer survives the reload that used to lose it", () => {
  const storage = memoryStorage();
  assert.equal(rememberPendingSend(storage, pending(WALLET_A, SIG_A)), true);

  /* A different storage object over the same bytes is what a reload is. */
  const afterReload = memoryStorage({ [SOLANA_SEND_PENDING_KEY]: storage.raw() });
  assert.deepEqual(readPendingSend(afterReload, WALLET_A), pending(WALLET_A, SIG_A));
});

test("one wallet never inherits another wallet's unfinished transfer", () => {
  const storage = memoryStorage();
  rememberPendingSend(storage, pending(WALLET_A, SIG_A));
  assert.equal(readPendingSend(storage, WALLET_B), null);

  rememberPendingSend(storage, pending(WALLET_B, SIG_B));
  assert.equal(readPendingSend(storage, WALLET_A).signature, SIG_A);
  assert.equal(readPendingSend(storage, WALLET_B).signature, SIG_B);

  /* Forgetting one leaves the other, because they are different people's money. */
  forgetPendingSend(storage, WALLET_A);
  assert.equal(readPendingSend(storage, WALLET_A), null);
  assert.equal(readPendingSend(storage, WALLET_B).signature, SIG_B);
});

test("a second signature from one wallet replaces the first rather than queueing", () => {
  const storage = memoryStorage();
  rememberPendingSend(storage, pending(WALLET_A, SIG_A));
  rememberPendingSend(storage, pending(WALLET_A, SIG_B));

  assert.equal(readPendingSend(storage, WALLET_A).signature, SIG_B);
  assert.equal(JSON.parse(storage.raw()).length, 1, "one wallet holds one open transfer, not a queue");
});

test("what comes back out of storage is validated, because storage is untrusted input", () => {
  /* Malformed JSON, a non-array, a record with a signature that is not one:
     every shape must read as nothing pending rather than propagate into a
     recovery request. */
  for (const raw of [
    "{not json",
    '"a string"',
    "{}",
    '[{"wallet":"' + WALLET_A + '","signature":"not-a-signature","network":"mainnet","signedAt":"2026-09-03T15:00:00.000Z"}]',
    '[{"wallet":"nope","signature":"' + SIG_A + '","network":"mainnet","signedAt":"2026-09-03T15:00:00.000Z"}]',
    '[{"wallet":"' + WALLET_A + '","signature":"' + SIG_A + '","network":"ethereum","signedAt":"2026-09-03T15:00:00.000Z"}]',
    '[{"wallet":"' + WALLET_A + '","signature":"' + SIG_A + '","network":"mainnet","signedAt":"whenever"}]',
  ]) {
    const storage = memoryStorage({ [SOLANA_SEND_PENDING_KEY]: raw });
    assert.equal(readPendingSend(storage, WALLET_A), null, `accepted a bad record: ${raw}`);
  }
});

test("a refusing store degrades to no pending transfer rather than to a broken page", () => {
  const blocked = {
    getItem() {
      throw new Error("The user agent denied access to site data.");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {},
  };

  assert.equal(readPendingSend(blocked, WALLET_A), null);
  assert.equal(rememberPendingSend(blocked, pending(WALLET_A, SIG_A)), false);
  assert.equal(forgetPendingSend(blocked, WALLET_A), false);
});

test("a record that is not a pending send is refused before it is written", () => {
  const storage = memoryStorage();
  assert.equal(rememberPendingSend(storage, { ...pending(WALLET_A, SIG_A), signature: "" }), false);
  assert.equal(storage.raw(), null, "a refused record must not create an entry");
});

test("the device keeps a bounded number of wallets", () => {
  const storage = memoryStorage();
  /* Distinct valid wallets, generated from a fixed alphabet so the test does
     not depend on any real account. */
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  for (let index = 0; index < SOLANA_SEND_PENDING_LIMIT + 4; index += 1) {
    const wallet = alphabet[index % alphabet.length].repeat(44);
    rememberPendingSend(storage, pending(wallet, SIG_A));
  }
  assert.equal(JSON.parse(storage.raw()).length, SOLANA_SEND_PENDING_LIMIT);
});

/**
 * The decision that can cost a person a duplicate transfer.
 *
 * It lived inside a React effect, where reaching it meant connecting a wallet
 * and signing something. Every branch is here instead, and the asymmetry is
 * the point: being wrong about "landed" shows a stale line, while being wrong
 * about "gone" deletes the warning that stops a second send.
 */

const LIVE = 5_000;
const STALE = BLOCKHASH_WINDOW_MS + 1_000;

test("an operator that saw the bytes ends the wait, either way", () => {
  assert.deepEqual(decideResume({ read: { seen: true, err: null, hasAttempt: true }, ageMs: LIVE }), {
    show: "LANDED",
    forget: true,
    keepPolling: false,
  });
  assert.deepEqual(
    decideResume({ read: { seen: true, err: '{"InstructionError":[0,{"Custom":1}]}', hasAttempt: true }, ageMs: LIVE }),
    { show: "FAILED", forget: true, keepPolling: false },
  );
});

test("a route that did not answer is never treated as an outcome", () => {
  const decision = decideResume({ read: null, ageMs: STALE });
  assert.equal(decision.forget, false, "a silent route must not delete the record");
  assert.equal(decision.show, "UNKNOWN");
  assert.equal(decision.keepPolling, true);
});

test("not seen is not gone while the bytes could still land", () => {
  /* The production read that produced this rule: a real signature answered
     seen:false from both operators, which is the same answer a two-second-old
     transaction gives while it propagates. */
  const decision = decideResume({ read: { seen: false, err: null, hasAttempt: false }, ageMs: LIVE });
  assert.equal(decision.forget, false, "bytes inside the blockhash window may still land");
  assert.equal(decision.show, "UNKNOWN");
  assert.equal(decision.keepPolling, true);
});

test("bytes the submit boundary claimed are never forgotten on silence alone", () => {
  /* An attempt record means bytes crossed the boundary. However old they are,
     the outcome is missing rather than absent. */
  const decision = decideResume({ read: { seen: false, err: null, hasAttempt: true }, ageMs: STALE });
  assert.equal(decision.forget, false);
  assert.equal(decision.keepPolling, true);
});

test("unseen, unclaimed and past the window is the one safe forget", () => {
  const decision = decideResume({ read: { seen: false, err: null, hasAttempt: false }, ageMs: STALE });
  assert.deepEqual(decision, { show: null, forget: true, keepPolling: false });
});

test("an unusable age never becomes a reason to forget", () => {
  /* Date.parse on a corrupted timestamp yields NaN, and NaN > anything is
     false — but the rule is stated rather than left to that coincidence. */
  for (const ageMs of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const decision = decideResume({ read: { seen: false, err: null, hasAttempt: false }, ageMs });
    assert.equal(decision.forget, false, `age ${ageMs} must not authorize forgetting`);
  }
});

test("an open earlier transfer holds back a new signature; an answered one does not", () => {
  /* The states where the outcome is still open. Signing during one of these
     would replace the stored record and drop the transfer the card is warning
     about, so the button must be shut, not merely labelled. */
  for (const show of ["CHECKING", "UNKNOWN"]) {
    assert.equal(blocksNewSend(show), true, `${show} must hold back a new signature`);
  }
  /* And an answer holds nothing back. A person whose transfer landed or failed
     is free to send the next one immediately. */
  for (const show of ["LANDED", "FAILED", null]) {
    assert.equal(blocksNewSend(show), false, `${show} must not hold anything back`);
  }
});

test("an unclassified state is treated as open rather than as permission", () => {
  /* The default exists so that a state added later fails closed. The cost of
     withholding a transfer is a delay; the cost of admitting one is a duplicate
     payment. */
  assert.equal(blocksNewSend("SOMETHING_ADDED_LATER"), true);
});

test("an unfinished transfer is findable with no wallet connected", () => {
  /* The case the feature exists for. Reloading drops the connection, so asking
     "what did the connected wallet leave unfinished" has no answer at exactly
     the moment it matters — which is how the first version of this shipped and
     showed nothing after a real reload. */
  const storage = memoryStorage();
  assert.equal(readLatestPendingSend(storage), null, "an empty device has nothing open");

  rememberPendingSend(storage, pending(WALLET_A, SIG_A));
  const afterReload = memoryStorage({ [SOLANA_SEND_PENDING_KEY]: storage.raw() });
  assert.equal(readLatestPendingSend(afterReload).signature, SIG_A);

  /* Newest first, so a second account signing later is the one still open. */
  rememberPendingSend(storage, pending(WALLET_B, SIG_B));
  assert.equal(readLatestPendingSend(storage).signature, SIG_B);
  assert.equal(readLatestPendingSend(storage).wallet, WALLET_B);
});
