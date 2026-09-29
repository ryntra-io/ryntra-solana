import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { addInternalWallet, internalWalletsFromEnv, listInternalWallets, removeInternalWallet, resolveInternalWallets } from "./internal-wallets.ts";

const OWNER = "7BxQeV1WQx5Kf9L7jAGZLZmN2nRy3P6d8Qx4RhT9y1Pk";
const PHONE = "G6vA2mF8kQ1sLZ9pVbT4wJ7rN3xC5yH8dE2uK6nM3PcD";
const NOW = "2026-09-11T12:00:00.000Z";

test("the deployment's list is read as addresses, and only addresses", () => {
  assert.deepEqual(internalWalletsFromEnv({}), []);
  assert.deepEqual(internalWalletsFromEnv({ RYNTRA_INTERNAL_WALLETS: `${OWNER}, ${PHONE}` }), [OWNER, PHONE]);
  assert.deepEqual(internalWalletsFromEnv({ RYNTRA_INTERNAL_WALLETS: `${OWNER}\n${OWNER};0xdeadbeef not-an-address` }), [OWNER], "duplicates and junk drop out");
});

test("the owner adds, lists and removes; the second add keeps the first label", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await addInternalWallet(store, { wallet: OWNER, label: "founder", now: NOW }), { ok: true, created: true });
  assert.deepEqual(await addInternalWallet(store, { wallet: OWNER, label: "renamed", now: "2026-09-12T00:00:00.000Z" }), { ok: true, created: false });
  assert.deepEqual(await addInternalWallet(store, { wallet: "junk", label: "x", now: NOW }), { ok: false, reason: "INVALID" });
  assert.deepEqual(await addInternalWallet(store, { wallet: PHONE, label: "   ", now: NOW }), { ok: false, reason: "INVALID" }, "a label is required");
  const listed = await listInternalWallets(store);
  assert.equal(listed.status, "measured");
  assert.deepEqual(listed.rows, [{ wallet: OWNER, label: "founder", addedAt: NOW }]);
  assert.equal(await removeInternalWallet(store, OWNER), true);
  assert.equal(await removeInternalWallet(store, "junk"), false);
  assert.deepEqual((await listInternalWallets(store)).rows, []);
});

test("the resolved set is the union of the deployment's list and the owner's", async () => {
  const store = createMemoryGuardStore();
  await addInternalWallet(store, { wallet: PHONE, label: "phone", now: NOW });
  const resolved = await resolveInternalWallets(store, { RYNTRA_INTERNAL_WALLETS: OWNER });
  assert.equal(resolved.store, "measured");
  assert.deepEqual([...resolved.wallets].sort(), [OWNER, PHONE].sort());
});

test("a store that fails still yields the deployment's list", async () => {
  const broken = {
    ...createMemoryGuardStore(),
    collection() {
      return { valuesWithPrefix: async () => { throw new Error("down"); } };
    },
  };
  const resolved = await resolveInternalWallets(broken, { RYNTRA_INTERNAL_WALLETS: OWNER });
  assert.equal(resolved.store, "unavailable");
  assert.deepEqual([...resolved.wallets], [OWNER]);
});
