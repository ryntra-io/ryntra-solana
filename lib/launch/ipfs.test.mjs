// SOL-L3 (SOL-L0 finding З19): a launch's picture and metadata on IPFS — the sha256 Ryntra keeps each under is the
// file's IPFS address in other letters; a copy is recorded only when the provider's address is the same bytes'.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { IPFS_BLOCK_BYTES, ipfsCidOfSha256, ipfsGatewayUrl, sha256OfIpfsCid } from "./ipfs.ts";
import { ipfsProvider, pinBytes, readIpfsPins, runIpfsPass, shaOfOurUri } from "./ipfs.server.ts";
import { IMAGE_MAX_BYTES } from "./form.ts";
import { storeLaunchImage, storeLaunchMetadata } from "./metadata.server.ts";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ORIGIN = "https://ryntra.io";
const PROVIDER_ENV = { LAUNCH_IPFS_RPC_URL: "https://rpc.ipfs.example/", LAUNCH_IPFS_RPC_TOKEN: "test-token" };
/* A one-pixel PNG: the smallest picture the form takes. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("the sha256 is the IPFS address of the same bytes (CID v1, raw), both ways", () => {
  /* `ipfs add --cid-version=1 --raw-leaves` of "hello world" — the address IPFS's own docs give. */
  assert.equal(ipfsCidOfSha256(sha("hello world")), "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  assert.equal(sha256OfIpfsCid("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e"), sha("hello world"));
  assert.equal(ipfsCidOfSha256("not-a-sha"), null);
  assert.equal(sha256OfIpfsCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"), null, "a CID v0 is not the raw address");
  assert.equal(ipfsGatewayUrl("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e"), "https://ipfs.io/ipfs/bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
  assert.ok(IMAGE_MAX_BYTES <= IPFS_BLOCK_BYTES, "the largest picture fits one IPFS block, so its address is the raw sha256");
});

test("the provider is the owner's: both settings, https — else nothing is sent", () => {
  assert.equal(ipfsProvider({}), null);
  assert.equal(ipfsProvider({ LAUNCH_IPFS_RPC_URL: "https://rpc.ipfs.example" }), null);
  assert.equal(ipfsProvider({ ...PROVIDER_ENV, LAUNCH_IPFS_RPC_URL: "http://rpc.ipfs.example" }), null, "a token never travels in clear");
  assert.deepEqual(ipfsProvider(PROVIDER_ENV), { url: "https://rpc.ipfs.example", token: "test-token", host: "rpc.ipfs.example" });
});

const kubo = (answer) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = init.body.get("file");
    const bytes = new Uint8Array(await body.arrayBuffer());
    return new Response(`${JSON.stringify({ Name: "file", Hash: answer ?? ipfsCidOfSha256(sha(bytes)), Size: String(bytes.length) })}\n`, { status: 200 });
  };
  return { calls, fetchImpl };
};

test("a pin is the same bytes' address, sent with CID v1 and raw leaves; another address is refused", async () => {
  const provider = ipfsProvider(PROVIDER_ENV);
  const { calls, fetchImpl } = kubo();
  const pinned = await pinBytes(provider, new Uint8Array(PNG), fetchImpl);
  assert.equal(pinned.ok, true);
  assert.equal(pinned.cid, ipfsCidOfSha256(sha(PNG)));
  assert.match(calls[0].url, /^https:\/\/rpc\.ipfs\.example\/api\/v0\/add\?cid-version=1&raw-leaves=true&pin=true/);
  assert.equal(calls[0].init.headers.authorization, "Bearer test-token");
  const wrong = await pinBytes(provider, new Uint8Array(PNG), kubo("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e").fetchImpl);
  assert.deepEqual(wrong, { ok: false, code: "ADDRESS_MISMATCH" });
  const refused = await pinBytes(provider, new Uint8Array(PNG), async () => new Response("no", { status: 401 }));
  assert.deepEqual(refused, { ok: false, code: "PROVIDER_REFUSED" });
  assert.deepEqual(await pinBytes(provider, new Uint8Array(IPFS_BLOCK_BYTES + 1), fetchImpl), { ok: false, code: "TOO_LARGE" });
});

test("a pass pins every confirmed launch's metadata and picture once, and records the address", async () => {
  const store = createMemoryGuardStore();
  const now = "2026-10-20T10:00:00.000Z";
  const image = await storeLaunchImage(store, new Uint8Array(PNG), now);
  const metadata = await storeLaunchMetadata(store, { name: "Stair", symbol: "STAIR", description: "", image: `${ORIGIN}/api/launch/image/${image.image.sha256}`, createdOn: "https://ryntra.io" }, now);
  const token = "Token".padEnd(44, "2");
  await store.collection("launches").set(`solana:mainnet:${token}`, { cluster: "mainnet", state: "LAUNCHED", token, metadataUri: `${ORIGIN}/api/launch/metadata/${metadata.sha256}` });
  await store.collection("launches").set(`solana:mainnet:${"Pend".padEnd(44, "3")}`, { cluster: "mainnet", state: "PENDING", token: "Pend".padEnd(44, "3"), metadataUri: `${ORIGIN}/api/launch/metadata/${"0".repeat(64)}` });
  const deps = { store, cluster: "mainnet", origin: ORIGIN, env: PROVIDER_ENV, now: () => new Date(now) };

  assert.deepEqual(await runIpfsPass({ ...deps, env: {} }, { budgetMs: 5_000 }), { configured: false, launches: 0, pinned: 0, already: 0, failed: [] }, "no provider: nothing sent");

  const { calls, fetchImpl } = kubo();
  const first = await runIpfsPass(deps, { budgetMs: 5_000, fetchImpl });
  assert.deepEqual({ ...first, failed: [...first.failed] }, { configured: true, launches: 1, pinned: 2, already: 0, failed: [] }, "a launch still pending is not pinned");
  assert.equal(calls.length, 2);
  const again = await runIpfsPass(deps, { budgetMs: 5_000, fetchImpl });
  assert.equal(again.pinned, 0);
  assert.equal(again.already, 2, "pinned once, never again");
  const recorded = await readIpfsPins(store, [metadata.sha256, image.image.sha256]);
  assert.equal(recorded.get(metadata.sha256).cid, ipfsCidOfSha256(metadata.sha256));
  assert.equal(recorded.get(image.image.sha256).kind, "image");
  assert.equal(recorded.get(image.image.sha256).via, "rpc.ipfs.example");
});

test("only a URI of ours names a sha256", () => {
  const id = "a".repeat(64);
  assert.equal(shaOfOurUri(`${ORIGIN}/api/launch/metadata/${id}`, ORIGIN, "metadata"), id);
  assert.equal(shaOfOurUri(`https://evil.example/api/launch/metadata/${id}`, ORIGIN, "metadata"), null);
  assert.equal(shaOfOurUri(`${ORIGIN}/api/launch/image/${id}`, ORIGIN, "metadata"), null);
});

test("the hourly pass is scheduled and guarded by the cron secret", () => {
  const crons = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons;
  assert.deepEqual(crons.filter((cron) => cron.path === "/api/cron/launch-ipfs"), [{ path: "/api/cron/launch-ipfs", schedule: "17 * * * *" }]);
  const route = readFileSync(new URL("../../app/api/cron/launch-ipfs/route.ts", import.meta.url), "utf8");
  assert.match(route, /decideBearerAuth\(.*process\.env\.CRON_SECRET\)/);
});
