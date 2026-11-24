// The private balance's keys come from the person's wallet only. The pure parts, with the SDK bundle Ryntra
// ships (`public/privacy/`): keys from the signature of the key request, the registry's record against them, the
// block's states, and the guards that keep the signature and the keys out of storage, logs and analytics.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  deviceOf,
  keysCannot,
  keysFromAnswer,
  keysLine,
  keysRequest,
  phaseOf,
  publicOf,
  recordVerdict,
  reportText,
  v1Line,
  walletsThatCan,
} from "./check.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");

// The bundle's Web Crypto checks ask for a secure context, as a browser page has.
globalThis.isSecureContext = true;
const sdk = await import(pathToFileURL(join(REPO, "public/privacy/spr-0.9.0-alpha.mjs")).href);
await sdk.initializePoseidon();
const OFFLINE = { prove: async () => { throw new Error("offline"); }, proveMerge: async () => { throw new Error("offline"); } };

/** A test wallet: an Ed25519 key that signs the exact bytes it is given, as `solana:signMessage` should. */
async function wallet() {
  const signer = await sdk.createKeyPairSignerFromPrivateKeyBytes(crypto.getRandomValues(new Uint8Array(32)));
  return {
    address: signer.address,
    sign: async (bytes) => ({ signedMessage: new Uint8Array(bytes), signature: new Uint8Array(await sdk.signBytes(signer.keyPair.privateKey, bytes)) }),
  };
}

const bytes = (keys) => publicOf(keys);

test("the key request is the SDK's derivation message over the wallet's own address", async () => {
  const a = await wallet();
  const request = keysRequest(sdk, a.address);
  assert.equal(request[0], 0xff, "an off-chain message, never a transaction");
  assert.ok(sdk.isDerivationInput(request), "the SDK reads it as a key request");
  assert.match(new TextDecoder().decode(request), /TSPP\/derive\/v1$/);
  assert.deepEqual([...keysRequest(sdk, a.address)], [...request], "the same address — the same request, every time");
  const b = await wallet();
  assert.notDeepEqual([...keysRequest(sdk, b.address)], [...request], "each address its own request");
});

test("keys from the wallet's signature: the same wallet gives the same keys, and nothing else is accepted", async () => {
  const a = await wallet();
  const request = keysRequest(sdk, a.address);
  const first = keysFromAnswer(sdk, OFFLINE, a.address, request, await a.sign(request));
  const second = keysFromAnswer(sdk, OFFLINE, a.address, request, await a.sign(request));
  assert.ok(first.ok && second.ok);
  assert.equal(recordVerdict(bytes(first.keys), bytes(second.keys)), "mine", "another device, the same wallet — the same keys");
  assert.equal(bytes(first.keys).nullifierPublicKey.length, 32);
  assert.equal(bytes(first.keys).viewingPublicKey.length, 33);

  // A wallet that returns other bytes than it was given has changed the request.
  const answer = await a.sign(request);
  const other = new Uint8Array(request);
  other[other.length - 1] ^= 1;
  assert.deepEqual(keysFromAnswer(sdk, OFFLINE, a.address, request, { ...answer, signedMessage: other }), { ok: false, why: "changed" });
  // A signature over something else — a prefix, plain text, a changed byte — the SDK refuses itself.
  const plain = await a.sign(new TextEncoder().encode("TSPP/derive/v1"));
  assert.deepEqual(keysFromAnswer(sdk, OFFLINE, a.address, request, { signedMessage: null, signature: plain.signature }), { ok: false, why: "changed" });
  const bent = new Uint8Array(answer.signature);
  bent[5] ^= 1;
  assert.deepEqual(keysFromAnswer(sdk, OFFLINE, a.address, request, { signedMessage: null, signature: bent }), { ok: false, why: "changed" });
  // Another wallet's signature does not open this address.
  const b = await wallet();
  const theirs = await b.sign(keysRequest(sdk, b.address));
  assert.deepEqual(keysFromAnswer(sdk, OFFLINE, a.address, request, theirs), { ok: false, why: "changed" });
  // The function keeps no copy of the seed it was handed: the caller's bytes are untouched, its own copy is zeroed.
  assert.ok(answer.signature.some((x) => x !== 0), "the caller zeroes its own signature, not this function");
});

test("the registry's record against the wallet's keys: none, the same keys, or other keys — then nothing is written", async () => {
  const a = await wallet();
  const request = keysRequest(sdk, a.address);
  const { keys } = keysFromAnswer(sdk, OFFLINE, a.address, request, await a.sign(request));
  const mine = publicOf(keys);
  assert.equal(recordVerdict(null, mine), "none");
  assert.equal(recordVerdict(undefined, mine), "none");
  // The indexer answers the viewing key as the SDK's key object; the chain as bytes. Both compare.
  const asIndexer = { nullifierPublicKey: new Uint8Array(mine.nullifierPublicKey), viewingPublicKey: sdk.ViewingKey ? { toBytes: () => new Uint8Array(mine.viewingPublicKey) } : null };
  assert.equal(recordVerdict(asIndexer, mine), "mine");
  assert.equal(recordVerdict({ nullifierPublicKey: mine.nullifierPublicKey, viewingPublicKey: mine.viewingPublicKey }, mine), "mine");
  // Keys of the browser's own: the same address, other keys.
  const viewing = sdk.ViewingKey.generate();
  const nullifier = sdk.NullifierKey.fromSecret(crypto.getRandomValues(new Uint8Array(31)));
  const own = sdk.ShieldedAddress.fromPublicKeys(sdk.ShieldedPublicKey.fromEd25519(sdk.getAddressEncoder().encode(a.address)), nullifier.publicKey(), viewing.publicKey());
  assert.equal(recordVerdict({ nullifierPublicKey: own.nullifierPublicKey, viewingPublicKey: own.viewingPublicKey }, mine), "other", "another app's or older keys are never written over");
  // One key the same, the other not — other.
  assert.equal(recordVerdict({ nullifierPublicKey: mine.nullifierPublicKey, viewingPublicKey: own.viewingPublicKey }, mine), "other");
  assert.equal(recordVerdict({ nullifierPublicKey: own.nullifierPublicKey, viewingPublicKey: mine.viewingPublicKey }, mine), "other");
  // A record with a key missing or empty is not «mine».
  assert.equal(recordVerdict({ nullifierPublicKey: null, viewingPublicKey: mine.viewingPublicKey }, mine), "other");
  assert.equal(recordVerdict({ nullifierPublicKey: new Uint8Array(0), viewingPublicKey: new Uint8Array(0) }, { nullifierPublicKey: new Uint8Array(0), viewingPublicKey: new Uint8Array(0) }), "other");
});

test("a wallet that cannot give the keys is named once: no message signing, a changed request, two different answers", () => {
  const fits = { signMessage: true, sameBytes: "yes", valid: "yes", repeatable: "yes" };
  assert.equal(keysCannot(fits), null);
  assert.equal(keysCannot({ ...fits, signMessage: false }), "no-sign");
  assert.equal(keysCannot({ ...fits, sameBytes: "no" }), "changed");
  assert.equal(keysCannot({ ...fits, valid: "no" }), "changed");
  assert.equal(keysCannot({ ...fits, repeatable: "no" }), "differs");
  assert.equal(keysCannot({ ...fits, repeatable: "unknown", sameBytes: "unknown", valid: "unknown" }), null, "not asked yet is not «cannot»");
  assert.deepEqual(walletsThatCan(), [], "no wallet is named until the owner's check passes one");
  assert.deepEqual(walletsThatCan([" Backpack", "Backpack", "", "Solflare"]), ["Backpack", "Solflare"]);
});

test("the block's states: the registry decides first, keys from the wallet open, nothing is written over other keys", () => {
  const at = (facts) => phaseOf({ open: true, owner: "A", record: "some", inTab: null, sealed: null, cannot: null, ...facts });
  assert.deepEqual(phaseOf({ open: false, owner: "A", record: "some", inTab: "mine", sealed: null, cannot: null }), { phase: "shut", keys: null });
  assert.deepEqual(at({ owner: null }), { phase: "none", keys: null });
  assert.deepEqual(at({ record: "reading" }), { phase: "loading", keys: null });
  assert.deepEqual(at({ record: "failed" }), { phase: "failed", keys: null });
  // Not registered: «Turn on» with the wallet's keys — or, for a wallet that cannot, one honest line.
  assert.deepEqual(at({ record: "none" }), { phase: "off", keys: null });
  assert.deepEqual(at({ record: "none", cannot: "differs" }), { phase: "cannot", keys: null });
  assert.deepEqual(at({ record: "none", sealed: "mine" }), { phase: "off", keys: null }, "older keys with no record never register");
  // Registered: the wallet's keys open it; older sealed keys still open their own balance; other keys — nothing written.
  assert.deepEqual(at({}), { phase: "locked", keys: null });
  assert.deepEqual(at({ inTab: "mine" }), { phase: "ready", keys: "wallet" });
  assert.deepEqual(at({ sealed: "mine" }), { phase: "ready", keys: "copy" });
  assert.deepEqual(at({ inTab: "other", sealed: "mine" }), { phase: "ready", keys: "copy" }, "a key copy of test money still opens it");
  assert.deepEqual(at({ inTab: "other" }), { phase: "elsewhere", keys: null });
  assert.deepEqual(at({ sealed: "other" }), { phase: "locked", keys: null }, "older keys that do not match ask the wallet");
  assert.deepEqual(at({ cannot: "no-sign" }), { phase: "cannot", keys: null });
});

test("the wallet check says one line a check, and its summary carries no secret", async () => {
  const base = {
    wallet: "Backpack",
    address: "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS",
    device: "desktop",
    versions: ["legacy", "0", "1"],
    signMessage: true,
    keys: { sameBytes: "unknown", valid: "unknown", repeatable: "unknown", refused: null },
    v1: { signed: "unknown", messageKept: "unknown", valid: "unknown", landed: null, refused: null },
    registry: "unread",
  };
  assert.deepEqual(keysLine(base), { line: "unasked", why: null });
  assert.deepEqual(keysLine({ ...base, signMessage: false }), { line: "no", why: "no-sign" });
  assert.deepEqual(keysLine({ ...base, keys: { ...base.keys, refused: "User rejected the request." } }), { line: "refused", why: null });
  assert.deepEqual(keysLine({ ...base, keys: { sameBytes: "yes", valid: "yes", repeatable: "no", refused: null } }), { line: "no", why: "differs" });
  assert.deepEqual(keysLine({ ...base, keys: { sameBytes: "yes", valid: "yes", repeatable: "yes", refused: null } }), { line: "yes", why: null });
  assert.deepEqual(keysLine({ ...base, keys: { sameBytes: "unknown", valid: "yes", repeatable: "yes", refused: null } }), { line: "yes", why: null }, "a wallet that does not echo the bytes but signs them right fits");
  assert.deepEqual(v1Line({ ...base, versions: ["legacy", "0"] }), { line: "unasked", why: "not-declared" });
  assert.deepEqual(v1Line({ ...base, v1: { signed: "yes", messageKept: "yes", valid: "yes", landed: null, refused: null } }), { line: "yes", why: null });
  assert.deepEqual(v1Line({ ...base, v1: { signed: "yes", messageKept: "no", valid: "yes", landed: null, refused: null } }), { line: "no", why: "changed" });
  assert.deepEqual(v1Line({ ...base, v1: { ...base.v1, refused: "Reached end of buffer" } }), { line: "refused", why: null });

  const report = { ...base, device: "phone", keys: { sameBytes: "yes", valid: "yes", repeatable: "no", refused: null }, registry: "other" };
  const text = reportText(report, new Date("2026-11-19T00:00:00Z"));
  assert.match(text, /^Ryntra wallet check · test network · 2026-11-19T00:00:00\.000Z/);
  assert.match(text, /wallet: Backpack · phone/);
  assert.match(text, /1\. key request: no — two signatures differ/);
  assert.match(text, /2\. v1 transaction: not checked/);
  assert.match(text, /3\. already registered: turned on with other keys .* Ryntra writes nothing/);
  assert.match(text, /keys from the wallet's signature: no/);
  assert.doesNotMatch(text, /mainnet/i);
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "phone");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 15; Seeker)"), "phone");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
});

test("the wallet's signature and keys never reach storage, a log or analytics; no address is registered with keys of the browser's own", () => {
  const store = read("lib/privacy/usePrivate.ts");
  const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  for (const path of ["lib/privacy/usePrivate.ts", "lib/privacy/check.ts", "lib/privacy/wallet.client.ts", "lib/privacy/vault.client.ts", "terminal/portfolio/private/PrivateBalance.tsx", "terminal/portfolio/private/WalletCheckScreen.tsx"]) {
    const source = code(path);
    assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|@vercel\/analytics|track\(/, `${path}: no log, plain storage or analytics`);
  }
  // Nothing new is made: no random keys, and the only sealed keys are an older key copy the person brings back.
  assert.doesNotMatch(code("lib/privacy/usePrivate.ts"), /makeSecrets|ViewingKey\.generate|getRandomValues\(new Uint8Array\(31\)\)/);
  const sealsKeys = [...code("lib/privacy/usePrivate.ts").matchAll(/seal\(keysId\(/g)].length;
  assert.equal(sealsKeys, 1, "keys are sealed in one place — an older key copy opened again");
  const restore = store.slice(store.indexOf("restore: async"), store.indexOf("keyCopy: async"));
  assert.match(restore, /seal\(keysId\(NETWORK, owner\)/);
  assert.match(code("lib/privacy/vault.client.ts"), /StoredKeys = Readonly<\{ viewing: number\[\]; nullifier: number\[\]; from: 'own' \}>/, "keys from the wallet have no sealed form");
  // Turn on: keys from two equal signatures, the registry read before anything is written, then the registration.
  const on = store.slice(store.indexOf("turnOn: async"), store.indexOf("unlock: async"));
  assert.ok(on.indexOf("keysTwice(") < on.indexOf("readRecord(") && on.indexOf("readRecord(") < on.indexOf("enable("), "keys, then the registry, then the write");
  assert.match(on, /if \(verdict === 'other'\) return settle/);
  assert.match(on, /if \(verdict === 'none'\) \{/, "only an address with no record is registered");
  const twice = store.slice(store.indexOf("async function keysTwice("), store.indexOf("/** Runs one step"));
  assert.match(twice, /sameBytes\(first\.signature, second\.signature\) === 'yes'/);
  assert.match(twice, /first\.signature\.fill\(0\)/);
  assert.match(twice, /second\.signature\.fill\(0\)/);
  // Open: one signature, compared with the record; other keys are dropped, nothing is written.
  const open = store.slice(store.indexOf("unlock: async"), store.indexOf("restore: async"));
  assert.match(open, /answer\.signature\.fill\(0\)/);
  assert.doesNotMatch(open, /enable\(|seal\(/, "opening writes nothing");
  // The tab's keys live in a module variable, not in the store the screens read.
  const state = store.slice(store.indexOf("type State = Readonly<{"), store.indexOf("type Actions = Readonly<{"));
  assert.doesNotMatch(state, /seed|secret|nullifier|viewing|WalletKeys|KeysAnswer/, "the screens' state holds no key and no key request's signature");
  assert.match(code("lib/privacy/vault.client.ts"), /let inTab: Readonly<\{ id: string; keys: unknown \}> \| null = null;/);
});
