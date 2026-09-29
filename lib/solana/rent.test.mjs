import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeRentSysvar,
  readRentParameters,
  rentExemptMinimumLamports,
  resetRentParametersCache,
  simulatedAccountStates,
} from "./rent.ts";

/* Measured on mainnet on 2026-09-14 with getMinimumBalanceForRentExemption. */
const LIVE = { lamportsPerByteYear: 5080n, exemptionThreshold: 1, burnPercent: 50 };
/* The parameters the network ran on before, and every older fixture assumes. */
const HISTORICAL = { lamportsPerByteYear: 3480n, exemptionThreshold: 2, burnPercent: 50 };

test("rent: the minimum balance is computed as the runtime computes it", () => {
  assert.equal(rentExemptMinimumLamports(LIVE, 0), 650_240n);
  assert.equal(rentExemptMinimumLamports(LIVE, 165), 1_488_440n);
  /* A Token-2022 account with ImmutableOwner, TransferHook and Pausable — what
     every xStock opens — is 179 bytes; this is the figure Jupiter's estimate
     fell short of. */
  assert.equal(rentExemptMinimumLamports(LIVE, 179), 1_559_560n);
  assert.equal(rentExemptMinimumLamports(LIVE, 179n), 1_559_560n);
  assert.equal(rentExemptMinimumLamports(HISTORICAL, 165), 2_039_280n);
  assert.equal(rentExemptMinimumLamports({ ...LIVE, exemptionThreshold: 1.5 }, 165), 2_232_660n);
  assert.throws(() => rentExemptMinimumLamports(LIVE, -1), RangeError);
});

test("rent: the sysvar decodes from its seventeen bytes and refuses nonsense", () => {
  const bytes = new Uint8Array(17);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 5080n, true);
  view.setFloat64(8, 1, true);
  view.setUint8(16, 50);
  assert.deepEqual(decodeRentSysvar(bytes), LIVE);
  assert.equal(decodeRentSysvar(bytes.subarray(0, 16)), null);
  view.setBigUint64(0, 0n, true);
  assert.equal(decodeRentSysvar(bytes), null);
  view.setBigUint64(0, 5080n, true);
  view.setFloat64(8, Number.NaN, true);
  assert.equal(decodeRentSysvar(bytes), null);
});

test("rent: simulated account states pair with the addresses asked about, absent when unknown", () => {
  const states = simulatedAccountStates(
    ["A", "B", "C", "D"],
    [
      { lamports: 1_559_560n, space: 179n, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: ["", "base64"] },
      null,
      { lamports: 12, data: [Buffer.alloc(165).toString("base64"), "base64"] },
      { lamports: "bad", space: 1 },
    ],
  );
  assert.deepEqual(states.get("A"), { lamports: 1_559_560n, space: 179, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" });
  assert.equal(states.has("B"), false);
  assert.deepEqual(states.get("C"), { lamports: 12n, space: 165, owner: null });
  assert.equal(states.has("D"), false);
  assert.equal(simulatedAccountStates(["A"], null).size, 0);
  assert.equal(simulatedAccountStates(["A", "B"], [{ lamports: 1n, space: 1n }]).size, 0, "a vector of the wrong length pairs nothing");
});

test("rent: the parameters are read once, kept, and served stale when the network blinks", async () => {
  resetRentParametersCache();
  const bytes = new Uint8Array(17);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 5080n, true);
  view.setFloat64(8, 1, true);
  view.setUint8(16, 50);
  let reads = 0;
  let fail = false;
  const handle = {
    endpoints: [{ role: "primary", host: "test", url: "https://test", fromEnv: false }],
    network: "mainnet",
    timeoutMs: 1000,
    retries: 0,
    maxResponseBytes: 1024,
    host: () => "test",
    rpc: {
      getAccountInfo: () => ({
        send: async () => {
          reads += 1;
          if (fail) throw new Error("offline");
          return { value: { data: [Buffer.from(bytes).toString("base64"), "base64"] } };
        },
      }),
    },
  };
  let now = 1_000_000;
  const clock = { now: () => now };
  assert.deepEqual(await readRentParameters(handle, clock), LIVE);
  assert.deepEqual(await readRentParameters(handle, clock), LIVE);
  assert.equal(reads, 1, "a second read inside the window is served from memory");
  now += 11 * 60_000;
  fail = true;
  assert.deepEqual(await readRentParameters(handle, clock), LIVE, "a failed refresh serves the last good parameters");
  assert.equal(reads, 2);
  resetRentParametersCache();
  await assert.rejects(readRentParameters(handle, clock), /offline/);
  resetRentParametersCache();
});
