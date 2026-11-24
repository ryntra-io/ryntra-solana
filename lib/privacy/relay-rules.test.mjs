// The mainnet relay before it opens (the review of #1988), one test per rule:
// 1. the page's session goes to a proven wallet only;
// 2. under `spr`, the SDK's own routes only;
// 3. `sendTransaction` — the SDK's own programs only;
// 4. `getProgramAccounts` — the SDK's own filters only;
// 5. the limit's rows are swept without a full scan;
// 6. a session the relay would not give is not asked again.
// And the review of these rules, one test per finding (`R…`): the body that goes is the body that was read; the limit
// holds for an address's /64, a wallet, one call per body, a proof and a body's size; a wallet's compute budget passes;
// the sweep reads a minute with a limit, keeps its pace while behind and never walks empty minutes; a short session is
// held; a broken answer is a 502; each method's options are the SDK's.
// And the second review (`D…`): a minute that is over goes whole in one step; a call one count refuses spends
// no other count; an indexer query's params are its method's own names, in the SDK's letters.
// And the third (`E…`): a person's parallel calls are each counted once, never refused for contention; a
// prefix delete and a count step touch rate counts only; an indexer query's values are the SDK's.
// Devnet keeps its open rules, as before.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GUARD_COLLECTIONS, RATE_COUNT_COLLECTIONS, createFileGuardStore, createMemoryGuardStore } from "../guard/store.ts";
import { FixedWindowLimiter } from "../http-control.ts";
import { RELAY_SESSION_HEADER, RING_PROGRAMS } from "./relay.ts";
import { relayCall } from "./relay-handler.server.ts";
import { RETRY_AFTER_MS, SESSION_EARLY_MS, UNPROVEN_RETRY_MS, relayKeeper } from "./relay-keeper.ts";
import { RELAY_COLLECTION, RELAY_LIMIT, RELAY_PROVE_LIMIT, RELAY_QUOTA_STALE_MS, RELAY_SWEEP_BEHIND_MS, RELAY_SWEEP_EVERY_MS, RELAY_SWEEP_WINDOWS, consumeRelayQuota, consumeRelayQuotas, noteRelayMinute, relayBuckets, relayMinutePrefix, relayQuotaKey, relayWindowPrefix, sweepRelayQuotas } from "./relay-limit.server.ts";
import { issueRelaySession, verifyRelaySession } from "./relay-session.server.ts";
import { CALL_OPTIONS, COMPUTE_BUDGET_PROGRAM, INDEXER_MAX_LIMIT, INDEXER_MAX_OWNERS, INDEXER_PARAMS, MAX_STRICT_BODY_BYTES, SDK_HELPERS, SDK_INDEXER_METHODS, SDK_PROGRAMS, SDK_PROGRAM_READ, SYSTEM_PROGRAM, TOKEN_PROGRAM, WALLET_HELPERS, sprRouteRefusal, strictCallRefusal, strictIndexerBody, strictRpcCheck, transactionVerdict } from "./relay-strict.ts";

const BUNDLE = fileURLToPath(new URL("../../public/privacy/spr-0.9.0-alpha.mjs", import.meta.url));
const RING = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const REGISTRY = "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ";
const PAYER = "GQ4fK7a5x3mQ8wPZ9WxG3CwW3Zr9Hn2Gq7mP6w3wq9Zt";
const VAULT = "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const NOW = 1_800_000_000_000;
const IP = "203.0.113.7";
/** Each indexer method's params as the SDK's encoders build them. */
const HASH = BLOCKHASH;
const PAGE_TOKEN = `1:5:${"5".repeat(88)}`;
const INDEXER_SAMPLES = {
  getEncryptedUtxosByTags: { tags: [HASH], limit: 100 },
  getShieldedTransactionsByTags: { tags: [HASH], paginationToken: PAGE_TOKEN, filters: { slot: { gte: 1, lt: 9 } } },
  getShieldedTransactionsByNullifiers: { nullifiers: [HASH], minContextSlot: 5 },
  getShieldedTransactionsBySignature: { txSignature: "5".repeat(88) },
  getMerkleProofs: { treeAccount: VAULT, leaves: [HASH] },
  getNonInclusionProofs: { treeAccount: VAULT, leaves: [HASH] },
  getUserRecords: { owners: [PAYER] },
};
/** An indexer query as the SDK sends it (`IW` in the bundle): its id, the method its path names, params one object. */
const indexerQuery = (method, params = INDEXER_SAMPLES[method] ?? {}) => JSON.stringify({ id: "test-account", jsonrpc: "2.0", method, params });

const bundleText = existsSync(BUNDLE) ? readFileSync(BUNDLE, "utf8") : null;
const sdk = bundleText ? await import(pathToFileURL(BUNDLE).href) : null;
const noBundle = sdk ? false : "the SDK bundle is not in this checkout";

/** A store every instance shares, as the Postgres adapter is: the memory store, declared multi-writer. */
const sharedStore = () => ({ ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" });

/** A wallet this browser proved to Ryntra with its own signature, as `readWalletProofFrom` answers. */
const proofOf = (over = {}) => ({ status: "ok", proof: { sessionId: "s1", chain: "solana", address: PAYER, method: "solana_siws", expiresAt: new Date(NOW + 86_400_000).toISOString(), via: "proof", ...over } });

/** The relay as it runs, with Helius and the wallet proof stood in. */
function stand(network, { proof = proofOf(), answers = {}, respond } = {}) {
  const store = sharedStore();
  const upstream = [];
  let proofAsked = 0;
  const deps = {
    fetch: async (url, init) => {
      const text = init?.body ? new TextDecoder().decode(init.body) : null;
      upstream.push({ url: String(url), init, text });
      const custom = respond?.(url, init);
      if (custom) return custom;
      const isRpc = new URL(String(url)).pathname === "/";
      const body = isRpc && text ? JSON.parse(text) : null;
      const reply = isRpc ? (answers[body?.method] ?? { jsonrpc: "2.0", id: body?.id ?? null, result: "fine" }) : { fine: true };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    },
    store: () => store,
    limiter: new FixedWindowLimiter({ limit: 1_000, windowMs: 60_000, maxKeys: 100, now: () => NOW }),
    now: () => NOW,
    walletProof: async () => {
      proofAsked += 1;
      if (proof instanceof Error) throw proof;
      return proof;
    },
  };
  const call = (target, { method = "GET", path = [], search = "", headers = {}, body } = {}) => {
    const request = new Request(`https://ryntra.io/api/v1/privacy/${network}/${target}${path.length ? `/${path.join("/")}` : ""}${search}`, {
      method,
      headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": IP, ...headers },
      body,
    });
    return relayCall(request, { network, key: "K", target, path }, deps);
  };
  const raw = (text, headers = {}) => call("rpc", { method: "POST", body: text, headers: { "content-type": "application/json", ...headers } });
  const rpc = (payload, headers = {}) => raw(JSON.stringify(payload), headers);
  /** The page's session, asked from `ip`; the headers to carry it from there. */
  const session = async (ip = IP) => {
    const answer = await call("session", { headers: { "x-forwarded-for": ip } });
    return answer.ok ? { [RELAY_SESSION_HEADER]: (await answer.json()).token, "x-forwarded-for": ip } : { "x-forwarded-for": ip };
  };
  return { call, rpc, raw, session, upstream, store, proofAsked: () => proofAsked };
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const ix = (programAddress, data = new Uint8Array([7, 7])) => ({ programAddress, accounts: [{ address: PAYER, role: 3 }, { address: VAULT, role: 1 }], data });
const transfer = (lamports) => sdk.getTransferSolInstruction({ source: { address: PAYER }, destination: VAULT, amount: lamports });

/** A wire transaction of `version` with `instructions`, as the SDK encodes it (signatures zeroed: the relay reads, Helius verifies). */
function wire(version, instructions) {
  let message = sdk.pipe(
    sdk.createTransactionMessage({ version }),
    (m) => sdk.setTransactionMessageFeePayer(PAYER, m),
    (m) => sdk.setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, m),
  );
  for (const instruction of instructions) message = sdk.appendTransactionMessageInstruction(instruction, message);
  return new Uint8Array(sdk.getTransactionEncoder().encode(sdk.compileTransaction(message)));
}

/* ---------------- 1. the session goes to a proven wallet only ---------------- */

test("1 · on mainnet the page's session goes only to a wallet the browser proved, names it, and never outlives the proof", async () => {
  // No proof — 401 with the one thing to do; Helius and the store never asked.
  for (const absent of [{ status: "absent" }, proofOf({ via: "link" }), proofOf({ chain: "ethereum" }), proofOf({ expiresAt: new Date(NOW - 1).toISOString() })]) {
    const relay = stand("mainnet", { proof: absent });
    const answer = await relay.call("session");
    assert.equal(answer.status, 401, JSON.stringify(absent));
    assert.deepEqual(await answer.json(), { error: "PROVE_WALLET" });
    assert.equal(answer.headers.get("cache-control"), "no-store");
    assert.equal(relay.upstream.length, 0);
  }
  // A session store that does not answer is no «not proven»: 503, try later.
  for (const down of [{ status: "unavailable" }, new Error("connection refused")]) {
    const answer = await stand("mainnet", { proof: down }).call("session");
    assert.equal(answer.status, 503);
    assert.equal(answer.headers.get("retry-after"), "30");
  }

  // A proven wallet: the token names it, and lives no longer than its proof.
  const soon = stand("mainnet", { proof: proofOf({ expiresAt: new Date(NOW + 120_000).toISOString() }) });
  const given = await (await soon.call("session")).json();
  assert.equal(given.ttlMs, 120_000, "the proof runs out in two minutes: so does the session");
  assert.equal(given.token.split(".")[3], PAYER, "the token names the proven wallet");
  assert.equal(verifyRelaySession({ token: given.token, key: "K", network: "mainnet", address: IP, nowMs: NOW + 120_000, proven: true }), "expired");

  const relay = stand("mainnet");
  const auth = await relay.session();
  assert.ok(auth[RELAY_SESSION_HEADER]);
  assert.equal(relay.proofAsked(), 1);
  const blockhash = { jsonrpc: "2.0", id: 1, method: "getLatestBlockhash" };
  assert.equal((await relay.rpc(blockhash, auth)).status, 200, "the proven wallet's session opens the relay");
  // A token the server signed for no wallet — as devnet hands out — opens nothing on mainnet.
  const walletless = issueRelaySession({ key: "K", network: "mainnet", address: IP, nowMs: NOW }).token;
  assert.equal(verifyRelaySession({ token: walletless, key: "K", network: "mainnet", address: IP, nowMs: NOW, proven: true }), "unproven");
  assert.equal((await relay.rpc(blockhash, { [RELAY_SESSION_HEADER]: walletless })).status, 401);
  assert.equal((await relay.call("spr", { method: "POST", path: ["getUserRecords"], headers: { [RELAY_SESSION_HEADER]: walletless }, body: "{}" })).status, 401, "the indexer too");
  // A wallet swapped into a signed token breaks its signature.
  const parts = auth[RELAY_SESSION_HEADER].split(".");
  parts[3] = VAULT;
  assert.equal((await relay.rpc(blockhash, { [RELAY_SESSION_HEADER]: parts.join(".") })).status, 401, "another wallet's name on this token");
  assert.equal(relay.upstream.length, 1);

  // Devnet hands its session out as before: no proof asked, none needed.
  const devnet = stand("devnet", { proof: { status: "absent" } });
  const open = await devnet.call("session");
  assert.equal(open.status, 200);
  assert.equal((await open.json()).token.split(".")[3], "-");
  assert.equal(devnet.proofAsked(), 0, "devnet never asks for the wallet's proof");
});

/* ---------------- 2. the SDK's own spr routes only ---------------- */

test("2 · on mainnet the prover and the indexer are reached by the SDK's own routes only, each with its method and query", async () => {
  const relay = stand("mainnet");
  const auth = await relay.session();
  const pass = [
    ["POST", ["getUserRecords"], ""],
    ["POST", ["getMerkleProofs"], ""],
    ["GET", ["attestation"], "?nonce=a1b2c3"],
    ["GET", ["health"], ""],
    ["GET", ["proving-keys"], ""],
    ["POST", ["prove", "transfer_ring_2_2"], ""],
    ["POST", ["prove", "merge_ring_8_1", "indexed"], ""],
    ["GET", ["prove", "transfer_confidential_eddsa_4_8", "status"], "?jobId=job_1"],
  ];
  // A proof's body is ciphertext for the enclave; an indexer query is the SDK's JSON-RPC body.
  const bodyOf = (method, path) => (method !== "POST" ? undefined : path[0] === "prove" ? "ciphertext" : indexerQuery(path[0]));
  for (const [method, path, search] of pass) {
    const answer = await relay.call("spr", { method, path, search, headers: auth, body: bodyOf(method, path) });
    assert.equal(answer.status, 200, `${method} ${path.join("/")}${search}`);
    assert.equal(new URL(relay.upstream.at(-1).url).pathname, `/v1/spr/${path.join("/")}`);
  }
  assert.equal(relay.upstream.length, pass.length);
  const counted = (await relay.store.collection(RELAY_COLLECTION).valuesWithPrefix("")).filter((row) => row?.key).length;

  const refuse = [
    ["POST", [], ""],
    ["POST", ["getAsset"], ""],
    ["POST", ["admin", "keys"], ""],
    ["GET", ["getUserRecords"], ""],
    ["POST", ["attestation"], "?nonce=a1"],
    ["GET", ["attestation"], ""],
    ["GET", ["attestation"], "?nonce=a1&nonce=b2"],
    ["GET", ["health"], "?nonce=a1"],
    ["GET", ["prove", "transfer_ring_2_2"], ""],
    ["POST", ["prove", "anything_at_all"], ""],
    ["POST", ["prove", "transfer_ring_2_2", "other"], ""],
    ["POST", ["prove", "transfer_ring_2_2", "indexed", "more"], ""],
    ["GET", ["prove", "transfer_ring_2_2", "status"], ""],
    ["GET", ["prove", "transfer_ring_2_2", "status"], "?jobId=j&nonce=ab"],
  ];
  for (const [method, path, search] of refuse) {
    const answer = await relay.call("spr", { method, path, search, headers: auth, body: method === "POST" ? "ciphertext" : undefined });
    assert.equal(answer.status, 404, `${method} /${path.join("/")}${search}`);
  }
  assert.equal(relay.upstream.length, pass.length, "a route that is not the SDK's never reaches Helius");
  assert.equal((await relay.store.collection(RELAY_COLLECTION).valuesWithPrefix("")).filter((row) => row?.key).length, counted, "nor is it counted");

  // Devnet keeps its open paths, as before.
  const devnet = stand("devnet");
  assert.equal((await devnet.call("spr", { method: "POST", path: ["getAsset"], body: "x" })).status, 200);
});

test("2 · every route the SDK bundle takes is one the relay serves", { skip: noBundle }, () => {
  const circuits = [...new Set([...bundleText.matchAll(/"([a-z0-9_]{3,60})\.key"/g)].map((m) => m[1]))];
  assert.ok(circuits.length >= 100, "the bundle names its proving keys");
  for (const name of circuits) {
    assert.equal(sprRouteRefusal("POST", ["prove", name], ""), null, name);
    assert.equal(sprRouteRefusal("POST", ["prove", name, "indexed"], ""), null, name);
    assert.equal(sprRouteRefusal("GET", ["prove", name, "status"], "?jobId=j1"), null, name);
  }
  // The prover's routes, as the bundle spells them, and the indexer's methods.
  for (const route of ['"/prove"', '"/indexed"', '"/status"', '"/health"', '"/proving-keys"', '"/attestation"']) assert.ok(bundleText.includes(route), route);
  for (const method of SDK_INDEXER_METHODS) assert.ok(bundleText.includes(`"${method}"`), method);
});

/* ---------------- 3. sendTransaction — the SDK's own programs only ---------------- */

test("3 · on mainnet sendTransaction carries only the programs the SDK's own transactions call, and a wallet's compute budget", { skip: noBundle }, async () => {
  // The programs are the bundle's — the ring's two and the four it builds beside them — and the compute budget a wallet
  // may add when it signs (R·MINOR 1): the SDK itself never calls it.
  for (const program of [...RING_PROGRAMS, ...SDK_HELPERS]) assert.ok(bundleText.includes(`"${program}"`), `${program} is the SDK's`);
  assert.deepEqual([...SDK_PROGRAMS].sort(), [...RING_PROGRAMS, ...SDK_HELPERS, ...WALLET_HELPERS].sort());
  assert.deepEqual([...WALLET_HELPERS], [COMPUTE_BUDGET_PROGRAM]);
  assert.equal(bundleText.includes(COMPUTE_BUDGET_PROGRAM), false, "the SDK never calls the compute budget program — only a wallet may");

  for (const version of ["legacy", 0, 1]) {
    assert.equal(transactionVerdict(wire(version, [ix(RING), ix(SYSTEM_PROGRAM), ix(TOKEN_PROGRAM)])), "ring", `${version}: the ring with the SDK's programs`);
    assert.equal(transactionVerdict(wire(version, [ix(COMPUTE_BUDGET_PROGRAM), ix(COMPUTE_BUDGET_PROGRAM), ix(RING)])), "ring", `${version}: the wallet's priority fee and limit beside the ring`);
    assert.equal(transactionVerdict(wire(version, [ix(RING), ix(JUPITER)])), "foreign", `${version}: another program beside the ring`);
    assert.equal(transactionVerdict(wire(version, [ix(REGISTRY), ix(COMPUTE_BUDGET_PROGRAM), ix(JUPITER)])), "foreign", `${version}: beside the registry`);
    assert.equal(transactionVerdict(wire(version, [ix(COMPUTE_BUDGET_PROGRAM), ix(SYSTEM_PROGRAM)])), "foreign", `${version}: helpers without the ring`);
  }
  // A link's own fee top-up stays a plain transfer, which a wallet may give a priority fee.
  assert.equal(transactionVerdict(wire(0, [ix(COMPUTE_BUDGET_PROGRAM), transfer(1_000_000n)])), "link-fee");

  const relay = stand("mainnet");
  const auth = await relay.session();
  const send = (bytes) => ({ jsonrpc: "2.0", id: 7, method: "sendTransaction", params: [b64(bytes), { encoding: "base64" }] });
  const refused = await relay.rpc(send(wire(1, [ix(RING), ix(JUPITER)])), auth);
  assert.deepEqual((await refused.json()).error, { code: -32601, message: "Not served here." });
  assert.equal(relay.upstream.length, 0, "never sent to Helius");
  assert.equal((await (await relay.rpc(send(wire(1, [ix(RING), ix(SYSTEM_PROGRAM)])), auth)).json()).result, "fine");
  assert.equal((await (await relay.rpc(send(wire(1, [ix(COMPUTE_BUDGET_PROGRAM), ix(RING)])), auth)).json()).result, "fine", "a wallet's priority fee is no reason to refuse the person's transaction");

  // Devnet keeps its open rules, as before.
  const devnet = stand("devnet");
  assert.equal((await (await devnet.rpc(send(wire(1, [ix(JUPITER), ix(RING)])))).json()).result, "fine");
});

/* ---------------- 4. getProgramAccounts — the SDK's own filters only ---------------- */

test("4 · on mainnet getProgramAccounts is the SDK's one read, with its very filters", async () => {
  const read = (program, options) => ({ jsonrpc: "2.0", id: 1, method: "getProgramAccounts", params: [program, options] });
  const size = { dataSize: 48 };
  const mark = { memcmp: { offset: 0, encoding: "base64", bytes: "BQ==" } };
  const ok = (call) => assert.equal(strictCallRefusal(call), null, JSON.stringify(call.params));
  const no = (call) => assert.notEqual(strictCallRefusal(call), null, JSON.stringify(call.params));

  ok(read(RING, { commitment: "confirmed", encoding: "base64", filters: [size, mark] }));
  ok(read(RING, { encoding: "base64", filters: [mark, size] }));

  no(read(REGISTRY, { encoding: "base64", filters: [size, mark] }));
  no(read(RING, { encoding: "base64", filters: [size, { memcmp: { offset: 0, encoding: "base64", bytes: "AQID" } }] }));
  no(read(RING, { encoding: "base64", filters: [size, { memcmp: { offset: 8, encoding: "base64", bytes: "BQ==" } }] }));
  no(read(RING, { encoding: "base64", filters: [size, { memcmp: { offset: 0, bytes: "BQ==" } }] }));
  no(read(RING, { encoding: "base64", filters: [{ dataSize: 100 }, mark] }));
  no(read(RING, { encoding: "base64", filters: [size, mark, { dataSize: 48 }] }));
  no(read(RING, { encoding: "base64", filters: [mark] }));
  no(read(RING, { encoding: "base64", filters: [{ dataSize: 48, memcmp: mark.memcmp }, mark] }));
  no(read(RING, { encoding: "base64", filters: [size, mark], dataSlice: { offset: 0, length: 0 } }));
  no(read(RING, { encoding: "jsonParsed", filters: [size, mark] }));
  no(read(RING, { filters: [size, mark] }));
  no(read(RING));

  const relay = stand("mainnet");
  const auth = await relay.session();
  const wide = await relay.rpc(read(RING, { encoding: "base64", filters: [size, { memcmp: { offset: 0, encoding: "base64", bytes: "AQ==" } }] }), auth);
  assert.equal((await wide.json()).error?.code, -32601);
  assert.equal(relay.upstream.length, 0, "another filter never reaches Helius");
  assert.equal((await (await relay.rpc(read(RING, { encoding: "base64", filters: [size, mark] }), auth)).json()).result, "fine");

  // Devnet keeps its open rules, as before.
  assert.equal((await (await stand("devnet").rpc(read(REGISTRY, {}))).json()).result, "fine");
});

test("4 · the relay's one program read is the bundle's own", { skip: noBundle }, () => {
  const call = bundleText.match(/getProgramAccounts\(PC,\{commitment:[^,]+,encoding:"base64",filters:\[\{dataSize:(\d+)n\},\{memcmp:\{offset:(\d+)n,encoding:"base64",bytes:\w+\.decode\(Uint8Array\.of\(ck\.(\w+)\)\)\}\}\]\}\)/);
  assert.ok(call, "the SDK's getProgramAccounts with its filters");
  assert.ok(bundleText.includes(`PC=CB("${SDK_PROGRAM_READ.program}")`), "PC is the ring's pool");
  assert.equal(Number(call[1]), SDK_PROGRAM_READ.dataSize);
  assert.equal(Number(call[2]), SDK_PROGRAM_READ.offset);
  const byte = Number(bundleText.match(new RegExp(`${call[3]}:(\\d+)`))[1]);
  assert.equal(Buffer.from([byte]).toString("base64"), SDK_PROGRAM_READ.bytes);
});

/* ---------------- 5. the limit's rows are swept without a full scan ---------------- */

/**
 * A store that counts what is asked of it: each prefix read with its limit and the rows it gave, each prefix delete with
 * the rows it removed, each row deleted one by one, each ledger read.
 */
function watchedStore() {
  const store = sharedStore();
  const reads = [];
  const deletes = [];
  const singles = [];
  const ledgerReads = [];
  const watch = (inner) => ({
    ...inner,
    valuesWithPrefix: async (prefix, options) => {
      const rows = await inner.valuesWithPrefix(prefix, options);
      if (prefix.includes(":minute:")) ledgerReads.push(prefix);
      else reads.push({ prefix, limit: options?.limit ?? null, rows: rows.length });
      return rows;
    },
    deleteWithPrefix: async (prefix) => {
      const removed = await inner.deleteWithPrefix(prefix);
      deletes.push({ prefix, removed });
      return removed;
    },
    delete: async (key) => {
      singles.push(key);
      return inner.delete(key);
    },
  });
  const watched = { ...store, versioned: (name) => watch(store.versioned(name)), collection: (name) => watch(store.collection(name)) };
  return { store, watched, reads, deletes, singles, ledgerReads };
}

const W = RELAY_LIMIT.windowMs;
const MINUTE = Math.floor(NOW / W) * W;
/** The minutes a network's ledger names. */
const ledgerMinutes = async (store, network = "mainnet") => (await store.collection(RELAY_COLLECTION).valuesWithPrefix(relayMinutePrefix(network))).map((row) => row.minute).sort((a, b) => a - b);
/** A row of `address` in a minute, its minute named in the ledger — as a counted call leaves it. */
async function putRow(store, address, windowStartMs, network = "mainnet") {
  await noteRelayMinute(store, network, windowStartMs);
  const key = relayQuotaKey(network, address, windowStartMs);
  await store.versioned(RELAY_COLLECTION).set(key, { version: 0, windowStartMs, used: 1, key });
}

test("5 · a sweep reads no row and removes only the minutes that are over — never the table", async () => {
  const { store, watched, reads, deletes } = watchedStore();
  for (let i = 0; i < 200; i += 1) await putRow(store, `live-${i}`, MINUTE);
  for (let i = 0; i < 5; i += 1) await putRow(store, `gone-${i}`, MINUTE - 5 * W);

  let removed = 0;
  for (let round = 0; round < 5; round += 1) {
    const sweep = await sweepRelayQuotas(watched, { network: "mainnet", nowMs: NOW });
    removed += sweep.removed;
    if (sweep.caughtUp) break;
  }
  assert.equal(removed, 5);
  const last = Math.floor((NOW - RELAY_QUOTA_STALE_MS - W) / W) * W;
  assert.ok(deletes.length > 0);
  for (const { prefix } of deletes) {
    const named = prefix.match(/^mainnet:(\d+):$/);
    assert.ok(named, `a delete names one minute, never the table: «${prefix}»`);
    assert.ok(Number(named[1]) <= last, `and only a minute that is over: ${prefix}`);
  }
  assert.deepEqual(reads, [], "no count is read at all — only the ledger of minutes");
  assert.equal((await store.collection(RELAY_COLLECTION).valuesWithPrefix(relayWindowPrefix("mainnet", MINUTE))).length, 200, "the live minute stays whole");

  // The next sweep removes nothing: the swept minute left the ledger, the live one is not over yet.
  deletes.length = 0;
  const next = await sweepRelayQuotas(watched, { network: "mainnet", nowMs: NOW + W });
  assert.equal(next.removed, 0);
  assert.deepEqual(deletes, [], "nothing swept is asked again");
});

/* ---------------- 6. a refused session is not asked again ---------------- */

/** The page's keeper against a relay that answers as told; counts what is asked. */
function keeperStand(sessionAnswers) {
  let clock = NOW;
  const asked = [];
  const keeper = relayKeeper({
    sessionUrl: "https://ryntra.io/api/v1/privacy/x/session",
    now: () => clock,
    fetch: async (url) => {
      asked.push(url);
      const next = sessionAnswers.length > 1 ? sessionAnswers.shift() : sessionAnswers[0];
      if (next instanceof Error) throw next;
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
    },
  });
  const sent = [];
  /** One relay call; the relay answers 401 to a token in `refused` (or to none, when `bare` says so). */
  const call = (refused = new Set(), bare = 401) =>
    keeper.call(async (token) => {
      sent.push(token);
      return new Response(null, { status: token === null ? bare : refused.has(token) ? 401 : 200 });
    }, true);
  return { keeper, call, asked, sent, tick: (ms) => (clock += ms) };
}

test("6 · a session the relay would not give is not asked again, and a call is sent again only with a new token", async () => {
  // The relay asks for a proven wallet: asked once, then every call goes without a token and asks nothing.
  const unproven = keeperStand([{ status: 401, body: { error: "PROVE_WALLET" } }]);
  for (let i = 0; i < 10; i += 1) assert.equal((await unproven.call()).status, 401);
  assert.equal(unproven.asked.length, 1, "one ask for ten calls");
  assert.deepEqual(unproven.sent, Array(10).fill(null), "each call sent once, without a token — never again");
  unproven.tick(UNPROVEN_RETRY_MS - 1);
  await unproven.call();
  assert.equal(unproven.asked.length, 1, "still not asked");
  // The page proves the wallet: the next call asks afresh.
  unproven.keeper.forget();
  await unproven.call();
  assert.equal(unproven.asked.length, 2);

  // Any other failure waits its time, then is asked once more.
  const down = keeperStand([{ status: 503 }, new Error("offline"), { status: 200, body: { token: "T1", ttlMs: 600_000 } }]);
  await down.call();
  await down.call();
  assert.equal(down.asked.length, 1);
  down.tick(RETRY_AFTER_MS);
  await down.call();
  assert.equal(down.asked.length, 2, "asked again after its time — and failed again");
  down.tick(RETRY_AFTER_MS);
  assert.equal((await down.call()).status, 200);
  assert.equal(down.asked.length, 3);
  assert.equal(down.sent.at(-1), "T1");

  // A held token the relay refuses: one new ask, the call once more with the new token — and never a third time.
  const stale = keeperStand([{ status: 200, body: { token: "T1", ttlMs: 600_000 } }, { status: 200, body: { token: "T2", ttlMs: 600_000 } }]);
  assert.equal((await stale.call()).status, 200);
  assert.equal((await stale.call(new Set(["T1"]))).status, 200);
  assert.deepEqual(stale.sent, ["T1", "T1", "T2"]);
  assert.equal(stale.asked.length, 2);
  assert.equal((await stale.call(new Set(["T2"]))).status, 401, "the new token refused as well");
  assert.deepEqual(stale.sent.slice(3), ["T2"], "sent with T2 once; the token asked again came back the same — not sent a third time");
  assert.equal(stale.asked.length, 3);

  // Calls that carried the same refused token wait for one new ask together.
  const many = keeperStand([{ status: 200, body: { token: "A", ttlMs: 600_000 } }, { status: 200, body: { token: "B", ttlMs: 600_000 } }]);
  await many.call();
  const answers = await Promise.all(Array.from({ length: 5 }, () => many.call(new Set(["A"]))));
  assert.ok(answers.every((answer) => answer.status === 200));
  assert.equal(many.asked.length, 2, "one new token for five refused calls");

  // A new token that does not come: the call is not sent again, and the refusal is remembered.
  const gone = keeperStand([{ status: 200, body: { token: "A", ttlMs: 600_000 } }, { status: 401 }]);
  await gone.call();
  assert.equal((await gone.call(new Set(["A"]))).status, 401);
  assert.deepEqual(gone.sent, ["A", "A"]);
  await gone.call(new Set(["A"]));
  assert.equal(gone.asked.length, 2, "the failed ask is not repeated by the next call");
  assert.equal(gone.sent.at(-1), null);
});

/* ---------------- the review: the bytes that go are the bytes that were read ---------------- */

test("R·MAJOR 1 · on mainnet Helius gets the call the relay checked, rebuilt — never the bytes as they came", async () => {
  const relay = stand("mainnet");
  const auth = await relay.session();
  const sent = () => relay.upstream.at(-1)?.text;
  const refused = async (answer) => assert.equal((await answer.json()).error?.code, -32601);

  // A key twice: the relay reads the last, and only that call goes — each key once.
  assert.equal((await relay.raw(`{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":[],"method":"getSlot"}`, auth)).status, 200);
  assert.equal(sent(), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }));
  // The reviewer's probe — the token program's accounts, then `getSlot` — is refused outright.
  const before = relay.upstream.length;
  await refused(await relay.raw(`{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["${TOKEN_PROGRAM}",{"encoding":"base64"}],"method":"getSlot"}`, auth));
  // A key in other letters beside the real one, any other key, another version, no id: refused, nothing goes.
  await refused(await relay.raw(`{"jsonrpc":"2.0","id":1,"method":"getSlot","Method":"getProgramAccounts","Params":["${TOKEN_PROGRAM}",{"encoding":"base64"}]}`, auth));
  await refused(await relay.raw(`{"jsonrpc":"2.0","id":1,"method":"getSlot","api-key":"theirs"}`, auth));
  await refused(await relay.raw(`{"jsonrpc":"1.0","id":1,"method":"getSlot"}`, auth));
  await refused(await relay.raw(`{"jsonrpc":"2.0","method":"getSlot"}`, auth));
  assert.equal(relay.upstream.length, before, "none of them reached Helius");

  // `params` twice: the checked ones go, alone.
  await relay.raw(`{"jsonrpc":"2.0","id":2,"method":"getBalance","params":["${VAULT}"],"params":["${PAYER}"]}`, auth);
  assert.equal(sent(), JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getBalance", params: [PAYER] }));
  // An option twice: the one checked goes, alone.
  await relay.raw(`{"jsonrpc":"2.0","id":3,"method":"getAccountInfo","params":["${VAULT}",{"encoding":"jsonParsed","encoding":"base64"}]}`, auth);
  assert.equal(sent(), JSON.stringify({ jsonrpc: "2.0", id: 3, method: "getAccountInfo", params: [VAULT, { encoding: "base64" }] }));
  if (sdk) {
    // A transaction's `params` twice: the ring's transaction goes, with its checked options only.
    const ring = b64(wire(1, [ix(RING)]));
    await relay.raw(`{"jsonrpc":"2.0","id":4,"method":"sendTransaction","params":["AAAA",{"encoding":"base64","skipPreflight":true}],"params":["${ring}",{"encoding":"base64"}]}`, auth);
    assert.equal(sent(), JSON.stringify({ jsonrpc: "2.0", id: 4, method: "sendTransaction", params: [ring, { encoding: "base64" }] }));
  }

  // The indexer too: the method its path names, the SDK's shape, rebuilt.
  const query = (body) => relay.call("spr", { method: "POST", path: ["getUserRecords"], headers: auth, body });
  assert.equal((await query(`{"id":"test-account","jsonrpc":"2.0","method":"getAsset","method":"getUserRecords","params":{"owners":["${PAYER}"]}}`)).status, 200);
  assert.equal(sent(), indexerQuery("getUserRecords"));
  const sentBefore = relay.upstream.length;
  const others = [
    indexerQuery("getMerkleProofs"),
    indexerQuery("getAsset"),
    `{"id":"test-account","jsonrpc":"2.0","method":"getUserRecords","params":{},"extra":1}`,
    `{"id":"test-account","jsonrpc":"2.0","method":"getUserRecords","params":[]}`,
    "ciphertext",
  ];
  for (const body of others) await refused(await query(body));
  assert.equal(relay.upstream.length, sentBefore, "an indexer query of another shape never reaches Helius");

  // Devnet forwards the bytes as they came, as before.
  const devnet = stand("devnet");
  const raw = `{"jsonrpc":"2.0","id":1,"method":"getSlot","method":"getBalance","params":["${VAULT}"]}`;
  await devnet.raw(raw);
  assert.equal(devnet.upstream.at(-1).text, raw);
});

/* ---------------- the review: the limit holds ---------------- */

test("R·MAJOR 2 · on mainnet the limit holds for a wallet, an address's /64, one call per body, proofs and a body's size", async () => {
  const slot = { jsonrpc: "2.0", id: 1, method: "getSlot" };

  // A wallet: two addresses, one wallet — one count for the wallet; a fresh address does not refill its minute.
  const relay = stand("mainnet");
  assert.equal((await relay.rpc(slot, await relay.session("203.0.113.7"))).status, 200);
  assert.equal((await relay.rpc(slot, await relay.session("198.51.100.4"))).status, 200);
  const quotas = relay.store.versioned(RELAY_COLLECTION);
  const walletKey = relayQuotaKey("mainnet", `wallet:${PAYER}`, MINUTE);
  const counted = await quotas.get(walletKey);
  assert.equal(counted?.used, 2, "both addresses count against the one wallet");
  await quotas.set(walletKey, { ...counted, version: counted.version + 1, used: RELAY_LIMIT.limit });
  const sentBefore = relay.upstream.length;
  assert.equal((await relay.rpc(slot, await relay.session("192.0.2.9"))).status, 429, "the wallet's minute is spent");
  assert.equal(relay.upstream.length, sentBefore);

  // An IPv6 address counts by its /64: two addresses of one /64 are one count, and its session holds across it.
  const v6 = stand("mainnet");
  const one = await v6.session("2001:db8:aa:1::1");
  assert.equal((await v6.rpc(slot, one)).status, 200);
  assert.equal((await v6.rpc(slot, { ...one, "x-forwarded-for": "2001:db8:aa:1:ffff:ffff:ffff:fffe" })).status, 200);
  const v6Quotas = v6.store.versioned(RELAY_COLLECTION);
  assert.equal((await v6Quotas.get(relayQuotaKey("mainnet", "address:2001:db8:aa:1::/64", MINUTE)))?.used, 2, "one count for the /64");
  assert.equal((await v6.rpc(slot, await v6.session("2001:db8:aa:2::1"))).status, 200);
  assert.equal((await v6Quotas.get(relayQuotaKey("mainnet", "address:2001:db8:aa:2::/64", MINUTE)))?.used, 1, "another /64 counts on its own");

  // One call per body: a list of two, or the reviewer's eight program reads, is refused; a list of one goes as it came.
  const batch = stand("mainnet");
  const auth = await batch.session();
  const read = (id) => ({ jsonrpc: "2.0", id, method: "getProgramAccounts", params: [RING, { encoding: "base64", filters: [{ dataSize: 48 }, { memcmp: { offset: 0, encoding: "base64", bytes: "BQ==" } }] }] });
  for (const many of [[slot, { ...slot, id: 2 }], Array.from({ length: 8 }, (_, i) => read(i + 1))]) {
    assert.equal((await (await batch.rpc(many, auth)).json()).error?.code, -32601);
  }
  assert.equal(batch.upstream.length, 0, "a batch never reaches Helius");
  assert.equal(strictRpcCheck([slot, slot]).ok, false);
  assert.equal((await batch.rpc([slot], auth)).status, 200);
  assert.equal(batch.upstream.at(-1).text, JSON.stringify([slot]));

  // Proofs: the prover's own ceiling, well below the calls' one; a status is no proof.
  assert.ok(RELAY_PROVE_LIMIT.limit < RELAY_LIMIT.limit);
  const prover = stand("mainnet");
  const proverAuth = await prover.session();
  const prove = (path) => prover.call("spr", { method: "POST", path, headers: proverAuth, body: "ciphertext" });
  for (let i = 0; i < RELAY_PROVE_LIMIT.limit; i += 1) assert.equal((await prove(["prove", "transfer_ring_2_2"])).status, 200);
  assert.equal((await prove(["prove", "transfer_ring_2_2", "indexed"])).status, 429, "the next proof waits for the minute");
  const status = await prover.call("spr", { method: "GET", path: ["prove", "transfer_ring_2_2", "status"], search: "?jobId=j1", headers: proverAuth });
  assert.equal(status.status, 200, "a status still passes");
  assert.equal(prover.upstream.length, RELAY_PROVE_LIMIT.limit + 1);

  // A body's size: an indexer query or an RPC call over 64 KB — 413; a proof's encrypted inputs keep their room.
  const sized = stand("mainnet");
  const sizedAuth = await sized.session();
  const big = indexerQuery("getUserRecords", { owners: Array(4_000).fill(PAYER) });
  assert.ok(big.length > MAX_STRICT_BODY_BYTES);
  assert.equal((await sized.call("spr", { method: "POST", path: ["getUserRecords"], headers: sizedAuth, body: big })).status, 413);
  assert.equal((await sized.raw(JSON.stringify({ ...slot, params: [{ commitment: "x".repeat(MAX_STRICT_BODY_BYTES) }] }), sizedAuth)).status, 413);
  assert.equal(sized.upstream.length, 0);
  assert.equal((await sized.call("spr", { method: "POST", path: ["prove", "merge_8_1"], headers: sizedAuth, body: "c".repeat(1024 * 1024) })).status, 200);

  // Devnet as before: an indexer query of any shape and size up to the old ceiling, batches, counted in the instance.
  const devnet = stand("devnet");
  assert.equal((await devnet.call("spr", { method: "POST", path: ["getUserRecords"], body: big })).status, 200);
  assert.equal((await devnet.rpc([slot, { ...slot, id: 2 }])).status, 200);
  assert.equal((await devnet.store.collection(RELAY_COLLECTION).valuesWithPrefix("")).length, 0);
});

/* ---------------- the review: the minor findings ---------------- */

test("R·MINOR 3 · a sweep keeps its pace while behind, and never walks empty minutes", async () => {
  // While behind — more minutes over than one sweep takes — the next sweep comes after a short pause, not on every row.
  const behind = watchedStore();
  for (let m = 0; m < RELAY_SWEEP_WINDOWS + 10; m += 1) await putRow(behind.store, `old-${m}`, MINUTE - (5 + m) * W);
  const open = (i, at) => consumeRelayQuota(behind.watched, { network: "mainnet", address: `new-${i}`, nowMs: at });
  await open(0, NOW);
  assert.equal(behind.deletes.length, RELAY_SWEEP_WINDOWS, "the first new row sweeps as many minutes as one sweep takes, and is behind");
  for (let i = 1; i <= 20; i += 1) await open(i, NOW + i * 100);
  assert.equal(behind.deletes.length, RELAY_SWEEP_WINDOWS, "twenty new rows in two seconds: no sweep rides on them");
  await open(21, NOW + RELAY_SWEEP_BEHIND_MS);
  assert.equal(behind.deletes.length, RELAY_SWEEP_WINDOWS + 10, "the next sweep comes once the pause is over, and takes the rest");
  assert.ok(RELAY_SWEEP_BEHIND_MS < RELAY_SWEEP_EVERY_MS);

  // After a quiet hour the sweep takes the minutes that hold rows — one here — and reads the ledger once; no empty minute.
  const quiet = watchedStore();
  await putRow(quiet.store, "before-the-quiet", MINUTE);
  const sweep = await sweepRelayQuotas(quiet.watched, { network: "mainnet", nowMs: NOW + 60 * W });
  assert.deepEqual([sweep.removed, sweep.caughtUp], [1, true]);
  assert.deepEqual(quiet.deletes.map((step) => step.prefix), [relayWindowPrefix("mainnet", MINUTE)], "one minute removed, no empty one asked");
  assert.equal(quiet.ledgerReads.length, 1);
  assert.deepEqual(await ledgerMinutes(quiet.store), [], "the swept minute leaves the ledger");

  // Every row's minute is in the ledger: a counted call names its minute before its row exists.
  const fresh = sharedStore();
  await consumeRelayQuota(fresh, { network: "mainnet", address: IP, nowMs: NOW });
  assert.deepEqual(await ledgerMinutes(fresh), [MINUTE]);
});

test("R·MINOR 4 · a session given for less than two minutes is held for half its life, not asked again on every call", async () => {
  const short = keeperStand([{ status: 200, body: { token: "S1", ttlMs: 30_000 } }, { status: 200, body: { token: "S2", ttlMs: 14_000 } }]);
  for (let i = 0; i < 5; i += 1) await short.call();
  assert.equal(short.asked.length, 1, "five calls, one ask: a 30-second token is live");
  short.tick(14_000);
  await short.call();
  assert.equal(short.asked.length, 1, "still live with 16 seconds to go");
  short.tick(1_001);
  await short.call();
  assert.equal(short.asked.length, 2, "past half its life: asked again, once");
  assert.equal(short.sent.at(-1), "S2");

  // A full session keeps its minute: asked again a minute before its end, not before.
  const full = keeperStand([{ status: 200, body: { token: "F1", ttlMs: 600_000 } }, { status: 200, body: { token: "F2", ttlMs: 600_000 } }]);
  await full.call();
  full.tick(600_000 - SESSION_EARLY_MS - 1);
  await full.call();
  assert.equal(full.asked.length, 1);
  full.tick(2);
  await full.call();
  assert.equal(full.asked.length, 2);
});

test("R·MINOR 5 · an answer that breaks off on its way is a 502, never a call that throws", async () => {
  const broken = () => new Response(new ReadableStream({ start: (controller) => controller.error(new Error("connection reset")) }), { status: 200 });
  for (const network of ["mainnet", "devnet"]) {
    const relay = stand(network, { respond: broken });
    const auth = network === "mainnet" ? await relay.session() : {};
    const answer = await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getSlot" }, auth);
    assert.equal(answer.status, 502, network);
    assert.equal(answer.headers.get("cache-control"), "no-store");
  }
});

test("R·MINOR 6 · each method's options are the ones the SDK sends, with the values it sends", () => {
  const ok = (call) => assert.equal(strictCallRefusal(call), null, JSON.stringify(call));
  const no = (call) => assert.notEqual(strictCallRefusal(call), null, JSON.stringify(call));
  // As kit and `flows.ts` send them.
  ok({ method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] });
  ok({ method: "getSlot", params: [{ commitment: "confirmed", minContextSlot: 5 }] });
  ok({ method: "getBalance", params: [VAULT, { commitment: "confirmed" }] });
  ok({ method: "getSignatureStatuses", params: [["5".repeat(88)]] });
  ok({ method: "getAccountInfo", params: [VAULT, { commitment: "confirmed", encoding: "base64" }] });
  ok({ method: "getMultipleAccounts", params: [[VAULT], { commitment: "finalized", encoding: "base64" }] });

  no({ method: "getSignatureStatuses", params: [["5".repeat(88)], { searchTransactionHistory: true }] });
  no({ method: "getBalance", params: [VAULT, { commitment: "confirmed", extra: 1 }] });
  no({ method: "getBalance", params: [VAULT, { commitment: "max" }] });
  no({ method: "getBalance", params: [VAULT, {}, "more"] });
  no({ method: "getBalance", params: { 0: VAULT } });
  no({ method: "getAccountInfo", params: [VAULT, { encoding: "base64", dataSlice: { offset: 0, length: 8 } }] });
  no({ method: "getMultipleAccounts", params: [[VAULT], { encoding: "base64", changedSinceSlot: 1 }] });
  no({ method: "getLatestBlockhash", params: [{ commitment: "confirmed" }, "more"] });
  no({ method: "getSlot", params: [{ minContextSlot: -1 }] });
});

test("R·MINOR 6 · every option the SDK bundle sends is one the relay lets through, and a transaction's are flows.ts's", { skip: noBundle }, () => {
  const calls = [...bundleText.matchAll(/this\.solanaRpc\.(\w+)\(([^)]*)\)\.send/g)];
  assert.ok(calls.length >= 5, "the bundle's own RPC calls");
  for (const [, method, args] of calls) {
    assert.ok(Object.hasOwn(CALL_OPTIONS, method), `${method} is served`);
    for (const [, name] of args.matchAll(/(\w+):/g)) assert.ok(Object.hasOwn(CALL_OPTIONS[method].rules, name), `${method}: ${name}`);
  }
  const send = (options) => ({ method: "sendTransaction", params: [b64(wire(1, [ix(RING)])), options] });
  assert.equal(strictCallRefusal(send({ encoding: "base64", preflightCommitment: "confirmed" })), null, "as flows.ts sends it");
  assert.equal(strictCallRefusal(send({ encoding: "base64", skipPreflight: false })), null);
  assert.equal(strictCallRefusal(send({ encoding: "base64", maxRetries: 50 })), "options", "Helius's retries are not the SDK's");
});

/* ---------------- the second review ---------------- */

const quotaRowsOf = async (store) => (await store.collection(RELAY_COLLECTION).valuesWithPrefix("mainnet:")).filter((row) => typeof row?.key === "string");

test("D·1 · a minute that is over goes whole in one step, however many rows it holds; two instances at once remove each row once", async () => {
  const OLD = MINUTE - 5 * W;
  const crowd = watchedStore();
  for (let i = 0; i < 5_000; i += 1) await putRow(crowd.store, `crowd-${i}`, OLD);
  await putRow(crowd.store, "live", MINUTE);
  const sweep = await sweepRelayQuotas(crowd.watched, { network: "mainnet", nowMs: NOW });
  assert.deepEqual([sweep.removed, sweep.caughtUp], [5_000, true], "five thousand rows of one minute in one sweep — no ceiling of rows");
  assert.deepEqual(crowd.deletes, [{ prefix: relayWindowPrefix("mainnet", OLD), removed: 5_000 }], "one step for the minute");
  assert.deepEqual(crowd.reads, [], "no row read");
  assert.deepEqual(crowd.singles, [`mainnet:minute:${OLD}`], "no count deleted one by one — only the minute's place in the ledger");
  assert.equal((await crowd.store.collection(RELAY_COLLECTION).valuesWithPrefix(relayWindowPrefix("mainnet", MINUTE))).length, 1, "the live minute stays");

  // Two instances sweeping the same minutes at once: each row goes once between them, and the ledger forgets them.
  const shared = sharedStore();
  for (let m = 0; m < 3; m += 1) for (let i = 0; i < 400; i += 1) await putRow(shared, `a-${m}-${i}`, OLD - m * W);
  const [one, two] = await Promise.all([sweepRelayQuotas(shared, { network: "mainnet", nowMs: NOW }), sweepRelayQuotas(shared, { network: "mainnet", nowMs: NOW })]);
  assert.equal(one.removed + two.removed, 1_200, "every row once between them");
  assert.ok(one.caughtUp && two.caughtUp);
  assert.deepEqual(await ledgerMinutes(shared), []);
  assert.equal((await quotaRowsOf(shared)).length, 0);
});

test("D·2 · a call one count refuses spends no other: a spent wallet does not spend its address's minute for everyone behind it", async () => {
  const slot = { jsonrpc: "2.0", id: 1, method: "getSlot" };
  const relay = stand("mainnet");
  const auth = await relay.session();
  assert.equal((await relay.rpc(slot, auth)).status, 200);
  const quotas = relay.store.versioned(RELAY_COLLECTION);
  const addressKey = relayQuotaKey("mainnet", `address:${IP}`, MINUTE);
  const walletKey = relayQuotaKey("mainnet", `wallet:${PAYER}`, MINUTE);
  assert.equal((await quotas.get(addressKey)).used, 1);
  const spent = await quotas.get(walletKey);
  await quotas.set(walletKey, { ...spent, version: spent.version + 1, used: RELAY_LIMIT.limit });
  for (let i = 0; i < 5; i += 1) assert.equal((await relay.rpc(slot, auth)).status, 429);
  assert.equal((await quotas.get(addressKey)).used, 1, "five refused calls left the address's count where it was");
  assert.equal((await quotas.get(walletKey)).used, RELAY_LIMIT.limit);
  // A neighbour behind the same address, with a wallet of their own, still has the address's minute.
  const neighbour = await consumeRelayQuotas(relay.store, { network: "mainnet", nowMs: NOW, buckets: relayBuckets({ address: IP, wallet: VAULT, proof: false }) });
  assert.equal(neighbour.kind, "counted");
  assert.equal(neighbour.decision.allowed, true);
  assert.equal((await quotas.get(addressKey)).used, 2);

  // A proof past the prover's ceiling spends neither the address's nor the wallet's calls.
  const prover = stand("mainnet");
  const proverAuth = await prover.session();
  const prove = () => prover.call("spr", { method: "POST", path: ["prove", "merge_8_1"], headers: proverAuth, body: "ciphertext" });
  assert.equal((await prove()).status, 200);
  const proverQuotas = prover.store.versioned(RELAY_COLLECTION);
  const proveKey = relayQuotaKey("mainnet", `prove:wallet:${PAYER}`, MINUTE);
  const proofs = await proverQuotas.get(proveKey);
  await proverQuotas.set(proveKey, { ...proofs, version: proofs.version + 1, used: RELAY_PROVE_LIMIT.limit });
  for (let i = 0; i < 3; i += 1) assert.equal((await prove()).status, 429);
  for (const subject of [`address:${IP}`, `wallet:${PAYER}`, `prove:address:${IP}`]) {
    assert.equal((await proverQuotas.get(relayQuotaKey("mainnet", subject, MINUTE))).used, 1, `${subject}: only the proof that passed`);
  }

  // A count the store could not make refuses the call — and the counts that were made are taken back.
  const base = sharedStore();
  const broken = relayQuotaKey("mainnet", `wallet:${PAYER}`, MINUTE);
  const flaky = { ...base, versioned: (name) => ({ ...base.versioned(name), countStep: async (key, step) => {
    if (key === broken) throw new Error("connection reset");
    return base.versioned(name).countStep(key, step);
  } }) };
  const answer = await consumeRelayQuotas(flaky, { network: "mainnet", nowMs: NOW, buckets: relayBuckets({ address: IP, wallet: PAYER, proof: false }) });
  assert.deepEqual(answer, { kind: "refused", refusal: "UNAVAILABLE" });
  assert.equal((await base.versioned(RELAY_COLLECTION).get(addressKey)).used, 0, "the address's count was taken back");
});

test("D·3 · an indexer query's params are its method's own names, in the SDK's letters", async () => {
  assert.deepEqual(Object.keys(INDEXER_PARAMS).sort(), [...SDK_INDEXER_METHODS].sort(), "a shape for every method the SDK calls");
  for (const method of SDK_INDEXER_METHODS) assert.ok(strictIndexerBody(method, JSON.parse(indexerQuery(method))), `${method} as the SDK builds it`);
  const query = (method, params) => strictIndexerBody(method, { id: "test-account", jsonrpc: "2.0", method, params });
  // A name in other letters beside the SDK's own or instead of it; a name the method never sends; a name it needs, missing.
  assert.equal(query("getUserRecords", { owners: [PAYER], Owners: [VAULT] }), null);
  assert.equal(query("getUserRecords", { OWNERS: [PAYER] }), null);
  assert.equal(query("getEncryptedUtxosByTags", { tags: [HASH], Limit: 1_000_000 }), null);
  assert.equal(query("getEncryptedUtxosByTags", { tags: [HASH], filters: { Slot: { gte: 1 } } }), null);
  assert.equal(query("getEncryptedUtxosByTags", { tags: [HASH], filters: { slot: { GTE: 1 } } }), null);
  assert.equal(query("getEncryptedUtxosByTags", { tags: [HASH], filters: { slot: { gte: 1 }, owner: PAYER } }), null);
  assert.equal(query("getShieldedTransactionsBySignature", { txSignature: "5".repeat(88), limit: 5 }), null);
  assert.equal(query("getShieldedTransactionsByNullifiers", { nullifiers: [HASH], ringProgramId: RING }), null);
  assert.equal(query("getMerkleProofs", { treeAccount: VAULT }), null);

  // Through the relay: refused as any other shape, and nothing goes to Helius.
  const relay = stand("mainnet");
  const auth = await relay.session();
  const answer = await relay.call("spr", { method: "POST", path: ["getUserRecords"], headers: auth, body: indexerQuery("getUserRecords", { owners: [PAYER], Owners: [VAULT] }) });
  assert.equal((await answer.json()).error?.code, -32601);
  assert.equal(relay.upstream.length, 0);
  // Devnet as before.
  assert.equal((await stand("devnet").call("spr", { method: "POST", path: ["getUserRecords"], body: indexerQuery("getUserRecords", { Owners: [VAULT] }) })).status, 200);
});

test("D·3 · the bundle's indexer encoders name exactly these params", { skip: noBundle }, () => {
  assert.ok(bundleText.includes('jR=["paginationToken","limit","filters","minContextSlot"]'), "the paging names");
  assert.ok(bundleText.includes('wB(Q,"$",["tags","ringProgramId",...jR])'), "by tags");
  assert.ok(bundleText.includes('wB(Q,"$",["nullifiers",...jR])'), "by nullifiers");
  assert.ok(bundleText.includes('wB(Q,"$",["treeAccount","leaves"])'), "the proofs");
  assert.ok(bundleText.includes("{owners:A.map("), "the user records");
  assert.ok(bundleText.includes("{txSignature:k0(Q.txSignature"), "by signature");
  assert.ok(bundleText.includes('Ra=["gt","gte","lt","lte"]'), "a slot range");
  const page = ["paginationToken", "limit", "filters", "minContextSlot"];
  assert.deepEqual(INDEXER_PARAMS.getEncryptedUtxosByTags, { required: ["tags"], optional: ["ringProgramId", ...page] });
  assert.deepEqual(INDEXER_PARAMS.getShieldedTransactionsByNullifiers, { required: ["nullifiers"], optional: page });
  assert.deepEqual(INDEXER_PARAMS.getMerkleProofs, { required: ["treeAccount", "leaves"], optional: [] });
  assert.deepEqual(INDEXER_PARAMS.getUserRecords, { required: ["owners"], optional: [] });
  assert.deepEqual(INDEXER_PARAMS.getShieldedTransactionsBySignature, { required: ["txSignature"], optional: [] });
});

/* ---------------- the third review ---------------- */

test("E·1 · eight calls of one person at once are each counted once — no 503 for contention, none past the limit", async () => {
  // Two instances over one store, as two warm functions over one database; each wave opens a new minute, so the
  // minute's first rows and its place in the ledger are written by the whole wave at once.
  const base = createMemoryGuardStore();
  const one = { ...base, durability: "DURABLE_MULTI_WRITER" };
  const two = { ...base, durability: "DURABLE_MULTI_WRITER" };
  const person = relayBuckets({ address: IP, wallet: PAYER, proof: false });
  const tally = { admitted: 0, shut: 0, refused: 0 };
  const count = (answer) => {
    if (answer.kind !== "counted") tally.refused += 1;
    else if (answer.decision.allowed) tally.admitted += 1;
    else tally.shut += 1;
  };
  for (let wave = 0; wave < 30; wave += 1) {
    const nowMs = MINUTE + wave * W + 1_000;
    const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => consumeRelayQuotas(i % 2 ? one : two, { network: "mainnet", buckets: person, nowMs })));
    answers.forEach(count);
  }
  assert.deepEqual(tally, { admitted: 240, shut: 0, refused: 0 }, "240 calls, 8 at a time: every one counted, none refused");

  // The limit under that load: 400 calls of one person in one minute, 8 at a time — exactly the limit passes.
  const later = MINUTE + 100 * W + 1_000;
  const again = { admitted: 0, shut: 0, refused: 0 };
  for (let wave = 0; wave < 50; wave += 1) {
    const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => consumeRelayQuotas(i % 2 ? one : two, { network: "mainnet", buckets: person, nowMs: later })));
    for (const answer of answers) {
      if (answer.kind !== "counted") again.refused += 1;
      else if (answer.decision.allowed) again.admitted += 1;
      else again.shut += 1;
    }
  }
  assert.deepEqual(again, { admitted: RELAY_LIMIT.limit, shut: 400 - RELAY_LIMIT.limit, refused: 0 });
  const minute = Math.floor(later / W) * W;
  for (const subject of [`address:${IP}`, `wallet:${PAYER}`]) {
    assert.equal((await one.versioned(RELAY_COLLECTION).get(relayQuotaKey("mainnet", subject, minute))).used, RELAY_LIMIT.limit, `${subject}: the count is the calls that passed`);
  }
  // The ledger names each minute once, however many calls opened it at once, and every count left is in a named minute.
  const named = await ledgerMinutes(one);
  assert.equal(new Set(named).size, named.length, "one place per minute");
  const counted = (await one.collection(RELAY_COLLECTION).valuesWithPrefix("mainnet:")).filter((row) => typeof row?.key === "string");
  assert.ok(counted.every((row) => named.includes(row.windowStartMs)), "no count in a minute the ledger does not name");
});

test("E·3 · a prefix delete and a count step touch rate counts only — every other collection refuses them", async () => {
  for (const subject of [createMemoryGuardStore(), null]) {
    const directory = subject ? null : mkdtempSync(join(tmpdir(), "ryntra-relay-rate-"));
    const store = subject ?? createFileGuardStore({ directory });
    try {
      for (const name of GUARD_COLLECTIONS) {
        if (name === RELAY_COLLECTION) continue;
        const rows = store.versioned(name);
        await rows.set(`mainnet:60000:${name}`, { version: 0, windowStartMs: 60_000, used: 1, key: name });
        await assert.rejects(rows.deleteWithPrefix("mainnet:"), TypeError, `${name}: no prefix delete`);
        await assert.rejects(rows.countStep(`mainnet:60000:${name}`, { by: 1, windowStartMs: 60_000, limit: 5 }), TypeError, `${name}: no count step`);
        await assert.rejects(rows.countStep(`mainnet:60000:${name}`, { by: -1, windowStartMs: 60_000 }), TypeError, `${name}: no count step down`);
        assert.deepEqual(await rows.get(`mainnet:60000:${name}`), { version: 0, windowStartMs: 60_000, used: 1, key: name }, `${name}: untouched`);
      }
      assert.deepEqual([...RATE_COUNT_COLLECTIONS], [RELAY_COLLECTION]);
      assert.equal(await store.versioned(RELAY_COLLECTION).countStep("mainnet:60000:x", { by: 1, windowStartMs: 60_000, limit: 5 }), 1);
      assert.equal(await store.versioned(RELAY_COLLECTION).deleteWithPrefix("mainnet:60000:"), 1);
    } finally {
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("E·4 · an indexer query's values are the SDK's: a page of 1 to 1000, slots whole, base58 where the SDK wants it", async () => {
  const query = (method, params) => strictIndexerBody(method, { id: "test-account", jsonrpc: "2.0", method, params });
  const tags = (params) => query("getEncryptedUtxosByTags", { tags: [HASH], ...params });
  // What the SDK's validators allow, passes.
  for (const limit of [1, 100, 1_000]) assert.ok(tags({ limit }), `limit ${limit}`);
  assert.ok(tags({ minContextSlot: 0, filters: { slot: { gt: 0, gte: 1, lt: 2, lte: 3 } }, paginationToken: PAGE_TOKEN, ringProgramId: RING }));
  assert.ok(query("getEncryptedUtxosByTags", { tags: [], ringProgramId: RING }), "no tags, with the ring named — as the SDK allows");
  assert.ok(query("getUserRecords", { owners: Array(100).fill(PAYER) }), "a hundred owners");
  // What they refuse, the relay refuses.
  for (const limit of [0, 1_001, 1.5, -1, "100", null]) assert.equal(tags({ limit }), null, `limit ${JSON.stringify(limit)}`);
  for (const minContextSlot of [-1, 1.5, "5", Number.MAX_SAFE_INTEGER + 2]) assert.equal(tags({ minContextSlot }), null, `minContextSlot ${minContextSlot}`);
  for (const slot of [{ gte: -1 }, { lt: "9" }, { gt: 1.5 }]) assert.equal(tags({ filters: { slot } }), null, `slot ${JSON.stringify(slot)}`);
  for (const paginationToken of ["p1", `2:5:${"5".repeat(88)}`, `1:05:${"5".repeat(88)}`, `1:5:${"0".repeat(88)}`, 5]) assert.equal(tags({ paginationToken }), null, `token ${paginationToken}`);
  assert.equal(query("getEncryptedUtxosByTags", { tags: [] }), null, "no tags and no ring");
  assert.equal(query("getEncryptedUtxosByTags", { tags: ["0a"] }), null, "a tag that is no base58 hash");
  assert.equal(query("getEncryptedUtxosByTags", { tags: HASH }), null, "tags that are no list");
  assert.equal(query("getUserRecords", { owners: [] }), null, "no owners");
  assert.equal(query("getUserRecords", { owners: Array(101).fill(PAYER) }), null, "more than a hundred owners");
  assert.equal(query("getUserRecords", { owners: ["not an address"] }), null);
  assert.equal(query("getShieldedTransactionsBySignature", { txSignature: "5".repeat(40) }), null, "a signature too short");
  assert.equal(query("getMerkleProofs", { treeAccount: 7, leaves: [HASH] }), null);
  assert.equal(query("getNonInclusionProofs", { treeAccount: VAULT, leaves: [HASH, 1] }), null);

  // Through the relay: refused, and nothing goes to Helius; devnet as before.
  const relay = stand("mainnet");
  const auth = await relay.session();
  const big = await relay.call("spr", { method: "POST", path: ["getEncryptedUtxosByTags"], headers: auth, body: indexerQuery("getEncryptedUtxosByTags", { tags: [HASH], limit: 1_000_000 }) });
  assert.equal((await big.json()).error?.code, -32601);
  assert.equal(relay.upstream.length, 0);
  assert.equal((await stand("devnet").call("spr", { method: "POST", path: ["getEncryptedUtxosByTags"], body: indexerQuery("getEncryptedUtxosByTags", { tags: ["0a"], limit: 1_000_000 }) })).status, 200);
});

test("E·4 · the bundle's validators are the bounds the relay keeps", { skip: noBundle }, () => {
  assert.ok(bundleText.includes('"an integer from 1 through 1000"'), "the page size");
  assert.ok(bundleText.includes("A.length<1||A.length>100"), "the owners");
  assert.ok(bundleText.includes("Q.length>112"), "the page token's length");
  assert.ok(bundleText.includes("/^1:(0|[1-9][0-9]{0,19}):([1-9A-HJ-NP-Za-km-z]{64,88})$/"), "the page token's shape");
  assert.equal(INDEXER_MAX_LIMIT, 1_000);
  assert.equal(INDEXER_MAX_OWNERS, 100);
});
