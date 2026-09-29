import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { listWalletPresence, recordWalletSeen, recordWalletVerified, walletPresenceKey } from "./wallet-presence.ts";

const ALICE = "G6vA2mF8kQ1sLZ9pVbT4wJ7rN3xC5yH8dE2uK6nM3PcD";
const BOB = "8PkW3nQ7rT2yL5vB9zC4xF6hJ1mK8sD5gA2eR7tY42Wq";

test("a read within thirty minutes is the same session; a later one is a return", async () => {
  const store = createMemoryGuardStore();
  assert.equal(await recordWalletSeen(store, { wallet: ALICE, now: "2026-09-11T10:00:00.000Z" }), "recorded");
  assert.equal(await recordWalletSeen(store, { wallet: ALICE, now: "2026-09-11T10:20:00.000Z" }), "unchanged");
  assert.equal(await recordWalletSeen(store, { wallet: ALICE, now: "2026-09-11T11:00:00.000Z" }), "recorded");
  const listed = await listWalletPresence(store);
  assert.equal(listed.status, "measured");
  assert.equal(listed.rows.length, 1);
  const [row] = listed.rows;
  assert.equal(row.wallet, ALICE);
  assert.equal(row.firstSeenAt, "2026-09-11T10:00:00.000Z");
  assert.equal(row.lastSeenAt, "2026-09-11T11:00:00.000Z");
  assert.equal(row.sessions, 2);
  assert.equal(row.verifications, 0);
  assert.equal(row.firstVerifiedAt, null);
  assert.equal(row.version, 1);
});

test("a proof is a proof, and also a visit", async () => {
  const store = createMemoryGuardStore();
  assert.equal(await recordWalletVerified(store, { wallet: BOB, now: "2026-09-11T10:00:00.000Z" }), "recorded");
  assert.equal(await recordWalletVerified(store, { wallet: BOB, now: "2026-09-12T10:00:00.000Z" }), "recorded");
  const listed = await listWalletPresence(store);
  const [row] = listed.rows;
  assert.equal(row.firstSeenAt, "2026-09-11T10:00:00.000Z");
  assert.equal(row.lastSeenAt, "2026-09-12T10:00:00.000Z");
  assert.equal(row.firstVerifiedAt, "2026-09-11T10:00:00.000Z");
  assert.equal(row.lastVerifiedAt, "2026-09-12T10:00:00.000Z");
  assert.equal(row.verifications, 2);
  assert.equal(row.sessions, 1, "a proof does not open a session of its own");
});

test("the key leads with the wallet and a malformed address is refused, never thrown", async () => {
  const store = createMemoryGuardStore();
  assert.equal(walletPresenceKey(ALICE), `solana:mainnet:${ALICE}:`);
  assert.equal(await recordWalletSeen(store, { wallet: "not-a-wallet", now: "2026-09-11T10:00:00.000Z" }), "refused");
  assert.equal(await recordWalletVerified(store, { wallet: "0x00", now: "2026-09-11T10:00:00.000Z" }), "refused");
  assert.equal((await listWalletPresence(store)).rows.length, 0);
});

test("a store that fails answers unavailable rather than failing the caller", async () => {
  const broken = {
    ...createMemoryGuardStore(),
    versioned() {
      throw new Error("down");
    },
    collection() {
      return { valuesWithPrefix: async () => { throw new Error("down"); } };
    },
  };
  assert.equal(await recordWalletSeen(broken, { wallet: ALICE, now: "2026-09-11T10:00:00.000Z" }), "unavailable");
  assert.deepEqual(await listWalletPresence(broken), { status: "unavailable" });
});

test("a row that does not parse is dropped from the list, not guessed at", async () => {
  const store = createMemoryGuardStore();
  await recordWalletSeen(store, { wallet: ALICE, now: "2026-09-11T10:00:00.000Z" });
  await store.collection("walletPresence").set(walletPresenceKey(BOB), { wallet: BOB, sessions: "many" });
  const listed = await listWalletPresence(store);
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.rows[0].wallet, ALICE);
});
