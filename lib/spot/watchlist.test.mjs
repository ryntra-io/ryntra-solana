import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import {
  SPOT_WATCHLIST_LIMIT,
  mergeSpotWatchlist,
  mergeSpotWatchlistRow,
  nextRemovals,
  readSpotWatchlist,
  readSpotWatchlistRow,
  spotWatchlistKey,
  writeSpotWatchlist,
} from "./watchlist.ts";

const ALICE = "7BxQ5vN3mK8pL2yR6tW9zC4xF1hJ7sD3gA5eU8rM91Pk";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const NOW = "2026-09-11T12:00:00.000Z";
const LATER = "2026-09-12T12:00:00.000Z";

test("a watchlist is read empty, written whole, read back in order and versioned", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await readSpotWatchlist(store, ALICE), []);
  const first = await writeSpotWatchlist(store, ALICE, [SOL, USDC], NOW);
  assert.deepEqual(first, { ok: true, mints: [SOL, USDC], version: 0 });
  assert.deepEqual(await readSpotWatchlist(store, ALICE), [SOL, USDC]);
  const second = await writeSpotWatchlist(store, ALICE, [USDC], NOW);
  assert.deepEqual(second, { ok: true, mints: [USDC], version: 1 });
  const raw = await store.collection("spotWatchlists").get(spotWatchlistKey(ALICE));
  assert.equal(raw.version, 1, "the second write advanced the version rather than rewriting version zero");
  assert.equal(raw.wallet, ALICE);
  assert.equal(raw.schemaVersion, "1.1.0");
  assert.deepEqual(raw.removed, [{ mint: SOL, removedAt: NOW }], "what left the list is remembered with its moment");
});

test("a malformed mint or wallet is refused, and duplicates are refused rather than silently collapsed", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await writeSpotWatchlist(store, "nope", [SOL], NOW), { ok: false, reason: "WATCHLIST_INVALID" });
  assert.deepEqual(await writeSpotWatchlist(store, ALICE, [SOL, "not-a-mint"], NOW), { ok: false, reason: "WATCHLIST_INVALID" });
  assert.deepEqual(await writeSpotWatchlist(store, ALICE, [SOL, SOL], NOW), { ok: true, mints: [SOL], version: 0 }, "the same mint twice is one star");
  assert.deepEqual(await readSpotWatchlist(store, "nope"), []);
});

test("the list is capped and the key is the wallet's", async () => {
  const store = createMemoryGuardStore();
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const many = Array.from({ length: SPOT_WATCHLIST_LIMIT + 5 }, (_, index) => `${alphabet[index % alphabet.length]}${alphabet[Math.floor(index / alphabet.length)]}${SOL.slice(2)}`);
  const wrote = await writeSpotWatchlist(store, ALICE, many, NOW);
  assert.ok(wrote.ok);
  assert.equal(wrote.mints.length, SPOT_WATCHLIST_LIMIT);
  assert.equal(wrote.mints[wrote.mints.length - 1], many[many.length - 1], "the newest star survives the cap");
  assert.equal(spotWatchlistKey(ALICE), `mainnet:${ALICE}`);
});

test("a row written before removals were remembered still reads, and a write names the version it read to refuse a lost update", async () => {
  const store = createMemoryGuardStore();
  await store.collection("spotWatchlists").set(spotWatchlistKey(ALICE), {
    schema: "ryntra.spot.watchlist", schemaVersion: "1.0.0", version: 4, network: "mainnet", wallet: ALICE, mints: [SOL], updatedAt: NOW,
  });
  assert.deepEqual(await readSpotWatchlistRow(store, ALICE), { mints: [SOL], version: 4, updatedAt: NOW, removed: [] });
  assert.deepEqual(await writeSpotWatchlist(store, ALICE, [USDC], LATER, { ifVersion: 3 }), { ok: false, reason: "WATCHLIST_CONFLICT" });
  assert.deepEqual(await writeSpotWatchlist(store, ALICE, [USDC], LATER, { ifVersion: 4 }), { ok: true, mints: [USDC], version: 5 });
});

test("removals: what left is remembered newest first, a mint that returns loses its tombstone, the memory is capped", () => {
  const previous = [{ mint: JUP, removedAt: NOW }];
  const next = nextRemovals(previous, [SOL, USDC], [USDC, JUP], LATER);
  assert.deepEqual(next, [{ mint: SOL, removedAt: LATER }], "SOL left and is remembered; JUP came back and is forgotten");
  const many = Array.from({ length: 250 }, (_, index) => ({ mint: `${index.toString().padStart(2, "1")}${SOL.slice(2)}`.slice(0, 44), removedAt: NOW }));
  assert.equal(nextRemovals(many, [], [], LATER).length, 200);
});

test("merge: the server's order first, the device's additions after, the device's removals leave, no duplicates", () => {
  const result = mergeSpotWatchlist(
    { mints: [SOL, USDC, JUP], version: 2, updatedAt: NOW, removed: [] },
    { mints: [USDC, NVDAX, SOL], removed: [JUP], syncedAt: null },
  );
  assert.deepEqual(result, { mints: [SOL, USDC, NVDAX], notKept: [], droppedByServer: [] });
});

test("merge: a mint the server removed after the device last synced does not come back, and is named; on a first sign-in nothing is stale", () => {
  const server = { mints: [SOL], version: 3, updatedAt: LATER, removed: [{ mint: JUP, removedAt: LATER }] };
  const synced = mergeSpotWatchlist(server, { mints: [SOL, JUP], removed: [], syncedAt: NOW });
  assert.deepEqual(synced, { mints: [SOL], notKept: [], droppedByServer: [JUP] });
  const first = mergeSpotWatchlist(server, { mints: [SOL, JUP], removed: [], syncedAt: null });
  assert.deepEqual(first, { mints: [SOL, JUP], notKept: [], droppedByServer: [] }, "a device that never held the server's copy adds its own list");
  const afterwards = mergeSpotWatchlist(server, { mints: [JUP], removed: [], syncedAt: "2026-09-13T00:00:00.000Z" });
  assert.deepEqual(afterwards.mints, [SOL, JUP], "an addition made after the server's removal is a new star");
});

test("merge: past the limit the overflow is returned by name, never silently dropped", () => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const mint = (index) => `${alphabet[index % alphabet.length]}${alphabet[Math.floor(index / alphabet.length)]}${SOL.slice(2)}`;
  const serverMints = Array.from({ length: SPOT_WATCHLIST_LIMIT - 2 }, (_, index) => mint(index));
  const device = [mint(500), mint(501), mint(502), mint(503)];
  const result = mergeSpotWatchlist({ mints: serverMints, version: 1, updatedAt: NOW, removed: [] }, { mints: device, removed: [], syncedAt: null });
  assert.equal(result.mints.length, SPOT_WATCHLIST_LIMIT);
  assert.deepEqual(result.mints.slice(-2), [mint(500), mint(501)]);
  assert.deepEqual(result.notKept, [mint(502), mint(503)]);
});

test("merge into the store: written once, versioned, and a second identical merge changes nothing but the version", async () => {
  const store = createMemoryGuardStore();
  await writeSpotWatchlist(store, ALICE, [SOL, JUP], NOW);
  await writeSpotWatchlist(store, ALICE, [SOL], LATER); // JUP removed on the web at LATER
  const merged = await mergeSpotWatchlistRow(store, ALICE, { mints: [JUP, NVDAX], removed: [], syncedAt: NOW }, "2026-09-13T00:00:00.000Z");
  assert.ok(merged.ok);
  assert.deepEqual(merged.result, { mints: [SOL, NVDAX], notKept: [], droppedByServer: [JUP] });
  assert.equal(merged.version, 2);
  assert.deepEqual(await readSpotWatchlist(store, ALICE), [SOL, NVDAX]);
  assert.deepEqual(await mergeSpotWatchlistRow(store, "nope", { mints: [], removed: [], syncedAt: null }, NOW), { ok: false, reason: "WATCHLIST_INVALID" });
});
