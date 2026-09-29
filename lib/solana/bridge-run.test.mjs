import assert from "node:assert/strict";
import test from "node:test";

import { clearBridgeRun, readBridgeRun, saveBridgeRun } from "./bridge-run.client.ts";

function storage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    size: () => map.size,
  };
}

const DIGEST = `0x${"a".repeat(64)}`;
const AT = new Date("2026-09-02T12:00:00.000Z");

const run = (overrides = {}) => ({
  intentDigest: DIGEST,
  bundle: { plan: { owner: "4MS4RQ", unsignedWireBase64: "AQAB" }, rpc: { host: "example" } },
  reviewProof: { status: "SIGNED", digest: `0x${"b".repeat(64)}` },
  burnSignature: `4TX1LSCt597YZVzT${"z".repeat(48)}`,
  mintTransactionHash: null,
  usdcBeforeRaw: "1000",
  ...overrides,
});

test("a transfer survives a closed tab, which is the whole point", () => {
  /* The claim on the server knows where the money is. What did not survive was
     the issuer-signed Review the receipt has to be bound to — so a burn
     followed by a closed tab produced a transfer that completed on both chains
     and could never be receipted. */
  const store = storage();
  assert.equal(saveBridgeRun(store, run(), AT), true);
  const read = readBridgeRun(store, AT);
  assert.ok(read);
  assert.equal(read.intentDigest, DIGEST);
  assert.equal(read.burnSignature, run().burnSignature);
  assert.deepEqual(read.bundle, run().bundle);
  assert.equal(read.savedAt, AT.toISOString());
});

test("nothing signable is written, whatever the caller passes", () => {
  const store = storage();
  saveBridgeRun(
    store,
    run({
      bundle: {
        plan: { unsignedWireBase64: "AQAB" },
        signedTransactionBase64: "SHOULD-NOT-PERSIST",
        nested: { secretKey: "SHOULD-NOT-PERSIST", privateKey: "SHOULD-NOT-PERSIST", keep: "yes" },
      },
    }),
    AT,
  );
  const raw = store.getItem("ryntra.solana.bridge-run.v1");
  assert.equal(raw.includes("SHOULD-NOT-PERSIST"), false, "a signable value reached browser storage");
  const read = readBridgeRun(store, AT);
  assert.equal(read.bundle.nested.keep, "yes", "everything else survives");
  assert.equal(read.bundle.plan.unsignedWireBase64, "AQAB", "the reviewed unsigned bytes are public and kept");
});

test("a run older than a week stops resurfacing", () => {
  const store = storage();
  saveBridgeRun(store, run(), AT);
  const later = new Date(AT.getTime() + 8 * 24 * 60 * 60 * 1000);
  assert.equal(readBridgeRun(store, later), null);
  const within = new Date(AT.getTime() + 6 * 24 * 60 * 60 * 1000);
  assert.ok(readBridgeRun(store, within));
});

test("a record that will not parse is absent rather than half-read", () => {
  const store = storage();
  store.setItem("ryntra.solana.bridge-run.v1", "{not json");
  assert.equal(readBridgeRun(store, AT), null);
  store.setItem("ryntra.solana.bridge-run.v1", JSON.stringify({ intentDigest: "nope" }));
  assert.equal(readBridgeRun(store, AT), null);
});

test("blocked storage loses the convenience, never the transfer", () => {
  /* A browser with site data blocked can still bridge. It simply cannot resume
     a closed tab, and throwing here would turn a lost convenience into a lost
     transfer. */
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(saveBridgeRun(blocked, run(), AT), false);
  assert.equal(readBridgeRun(blocked, AT), null);
  assert.doesNotThrow(() => clearBridgeRun(blocked));
});

test("it is forgotten once, and only once the receipt exists", () => {
  const store = storage();
  saveBridgeRun(store, run(), AT);
  assert.ok(readBridgeRun(store, AT));
  clearBridgeRun(store);
  assert.equal(readBridgeRun(store, AT), null);
});
