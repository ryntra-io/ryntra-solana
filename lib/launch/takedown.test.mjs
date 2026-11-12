import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { checkLaunchImage } from "./image-check.server.ts";
import { isTakenDown, metadataOfUri, readLaunchImage, storeLaunchImage, storeLaunchMetadata } from "./metadata.server.ts";
import { launchKey } from "./record-key.ts";
import { listTakedowns, restoreLaunch, takeDownLaunch } from "./takedown.server.ts";

const ORIGIN = "https://ryntra.io";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function launched(store, token, picture = PNG) {
  const image = await storeLaunchImage(store, picture, "t");
  const metadata = await storeLaunchMetadata(store, { name: "Bad Cat", symbol: "BCAT", description: "join now", image: `${ORIGIN}/api/launch/image/${image.image.sha256}`, website: "https://bad.example", createdOn: "https://ryntra.io" }, "t");
  const metadataUri = `${ORIGIN}/api/launch/metadata/${metadata.sha256}`;
  await store.collection("launches").set(launchKey("mainnet", token), { token, metadataUri });
  return { image: image.image.sha256, metadata: metadata.sha256, metadataUri };
}

test("a token taken down: no picture served, details without description and links; put back, all returns", async () => {
  const store = createMemoryGuardStore();
  const token = "So11111111111111111111111111111111111111112";
  const ids = await launched(store, token);
  const deps = { store, cluster: "mainnet", origin: ORIGIN };
  const down = await takeDownLaunch(deps, { token, reason: "a scam report", by: "telegram:7", at: "2026-10-25T12:00:00.000Z" });
  assert.equal(down.ok, true);
  assert.equal(await readLaunchImage(store, ids.image), null, "the picture is served by nobody");
  const details = await metadataOfUri(store, ids.metadataUri, ORIGIN);
  assert.equal(details.takenDown, true);
  assert.deepEqual([details.metadata.name, details.metadata.description, details.metadata.website], ["Bad Cat", "", undefined], "the name stays, the rest does not");
  assert.deepEqual((await listTakedowns(store)).map((row) => [row.token, row.reason, row.by]), [[token, "a scam report", "telegram:7"]]);
  assert.equal((await restoreLaunch(deps, token, { by: "telegram:8", at: "2026-10-25T13:00:00.000Z" })).ok, true);
  assert.ok(await readLaunchImage(store, ids.image));
  assert.deepEqual((await listTakedowns(store)).map((row) => [row.by, row.restoredBy]), [["telegram:7", "telegram:8"]], "the record stays: who took down, who put back");
  assert.equal((await metadataOfUri(store, ids.metadataUri, ORIGIN)).takenDown, false);
  assert.deepEqual(await takeDownLaunch(deps, { token: "11111111111111111111111111111111", reason: "x", by: "y", at: "z" }), { ok: false, code: "NOT_FOUND" });
});

test("a picture two tokens share stays down while either is taken down", async () => {
  const store = createMemoryGuardStore();
  const deps = { store, cluster: "mainnet", origin: ORIGIN };
  const first = "So11111111111111111111111111111111111111112";
  const second = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  const ids = await launched(store, first);
  await launched(store, second);
  await takeDownLaunch(deps, { token: first, reason: "r", by: "b", at: "2026-10-25T12:00:00.000Z" });
  await takeDownLaunch(deps, { token: second, reason: "r", by: "b", at: "2026-10-25T12:01:00.000Z" });
  await restoreLaunch(deps, second, { by: "b", at: "2026-10-25T12:02:00.000Z" });
  assert.equal(await isTakenDown(store, "image", ids.image), true, "the first token's takedown still holds the shared picture");
  await takeDownLaunch(deps, { token: second, reason: "r", by: "b", at: "2026-10-25T12:03:00.000Z" });
  await restoreLaunch(deps, first, { by: "b", at: "2026-10-25T12:04:00.000Z" });
  assert.equal(await isTakenDown(store, "image", ids.image), true, "restoring the first token leaves the second's hold");
  await restoreLaunch(deps, second, { by: "b", at: "2026-10-25T12:05:00.000Z" });
  assert.equal(await isTakenDown(store, "image", ids.image), false, "no token holds it down");
});

test("the picture's check: flagged categories refuse, a check that could not run is said apart, no key stores unchecked", async () => {
  const image = { base64: Buffer.from(PNG).toString("base64"), contentType: "image/png" };
  const env = { OPENAI_API_KEY: "sk-test", RYNTRA_LAUNCH_IMAGE_CHECK: "openai" };
  const answering = (status, body) => async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/moderations");
    const sent = JSON.parse(init.body);
    assert.equal(sent.model, "omni-moderation-latest");
    assert.match(sent.input[0].image_url.url, /^data:image\/png;base64,/);
    return new Response(JSON.stringify(body), { status });
  };
  assert.deepEqual(await checkLaunchImage(image, { env: {} }), { state: "UNCHECKED" });
  assert.deepEqual(await checkLaunchImage(image, { env: { OPENAI_API_KEY: "sk-test" }, required: true }), { state: "UNCHECKED" }, "a key alone switches nothing on");
  assert.equal((await checkLaunchImage(image, { env: { RYNTRA_LAUNCH_IMAGE_CHECK: "openai" }, required: true })).state, "UNAVAILABLE", "mainnet: no key, no picture");
  assert.deepEqual(await checkLaunchImage(image, { env, fetch: answering(400, { error: { message: "unsupported image" } }) }), { state: "UNREADABLE" }, "a file the model cannot read: another file");
  assert.deepEqual(await checkLaunchImage(image, { env, fetch: answering(200, { results: [{ flagged: false, categories: { sexual: false } }] }) }), { state: "PASSED" });
  assert.deepEqual(await checkLaunchImage(image, { env, fetch: answering(200, { results: [{ flagged: true, categories: { sexual: true, "violence/graphic": true } }] }) }), { state: "REFUSED", categories: ["sexual", "violence/graphic"] });
  assert.equal((await checkLaunchImage(image, { env, fetch: answering(500, {}) })).state, "UNAVAILABLE");
  assert.equal((await checkLaunchImage(image, { env, fetch: answering(200, { results: [] }) })).state, "UNAVAILABLE", "no result is not a pass");
  assert.equal((await checkLaunchImage(image, { env, fetch: async () => { throw new Error("offline"); } })).state, "UNAVAILABLE");
});

test("review 9.11: a launch with early access is taken down too — its record lives apart, its metadata is the same", async () => {
  const store = createMemoryGuardStore();
  const token = "EarLyAcce55Token1111111111111111111111111111";
  const ids = await launched(store, token);
  /* The early access keeps its own record, not a row of `launches`. */
  await store.collection("launches").delete(launchKey("mainnet", token));
  await store.collection("launchEarlyAccess").set(`mainnet:${token}`, { cluster: "mainnet", mint: token, metadataUri: ids.metadataUri });
  const deps = { store, cluster: "mainnet", origin: ORIGIN };
  const down = await takeDownLaunch(deps, { token, reason: "report", by: "owner", at: "2026-11-09T12:00:00Z" });
  assert.equal(down.ok, true, "found through the early access record");
  assert.equal(down.metadata, ids.metadata);
  assert.equal((await metadataOfUri(store, ids.metadataUri, ORIGIN)).takenDown, true);
});
