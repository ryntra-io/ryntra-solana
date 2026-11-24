// The relay is no open RPC with the paid key: on mainnet the ring's transactions and accounts only, and only
// with the page's session token; the limit's rows are written after the checks and swept; the wallet check's report
// names its network. Devnet keeps its open rules, as before.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createMemoryGuardStore } from "../guard/store.ts";
import { FixedWindowLimiter } from "../http-control.ts";
import { reportText } from "./check.ts";
import { LINK_FEE_LAMPORTS } from "./network.ts";
import { RELAY_SESSION_HEADER, RING_PROGRAMS, passInHeaders, strictRelay } from "./relay.ts";
import { relayCall } from "./relay-handler.server.ts";
import { RELAY_COLLECTION, RELAY_QUOTA_STALE_MS, RELAY_SWEEP_EVERY_MS, consumeRelayQuota, noteRelayMinute, relayQuotaKey, sweepRelayQuotas } from "./relay-limit.server.ts";
import { RELAY_SESSION_TTL_MS, issueRelaySession, verifyRelaySession } from "./relay-session.server.ts";
import { COMPUTE_BUDGET_PROGRAM, MAX_ACCOUNTS, SYSTEM_PROGRAM, TOKEN_PROGRAM, answerAllowed, strictCallRefusal, strictRpcCheck, transactionVerdict } from "./relay-strict.ts";
import { base58, topInstructions } from "./relay-tx.ts";

const BUNDLE = fileURLToPath(new URL("../../public/privacy/spr-0.9.0-alpha.mjs", import.meta.url));
const RING = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const REGISTRY = "regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const PAYER = "GQ4fK7a5x3mQ8wPZ9WxG3CwW3Zr9Hn2Gq7mP6w3wq9Zt";
const VAULT = "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const NOW = 1_800_000_000_000;
const IP = "203.0.113.7";

/** A store every instance shares, as the Postgres adapter is: the memory store, declared multi-writer. */
const sharedStore = () => ({ ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" });

/* ---------------- transactions, made by the SDK's own codec ---------------- */

const sdk = existsSync(BUNDLE) ? await import(pathToFileURL(BUNDLE).href) : null;
const noBundle = sdk ? false : "the SDK bundle is not in this checkout";

const ix = (programAddress, data = new Uint8Array([7, 7])) => ({ programAddress, accounts: [{ address: PAYER, role: 3 }, { address: VAULT, role: 1 }], data });
const transfer = (lamports) => sdk.getTransferSolInstruction({ source: { address: PAYER }, destination: VAULT, amount: lamports });

/** A wire transaction of `version` with `instructions`, as the SDK encodes it (signatures zeroed: the relay reads, Helius verifies). */
function wire(version, instructions, config) {
  let message = sdk.pipe(
    sdk.createTransactionMessage({ version }),
    (m) => sdk.setTransactionMessageFeePayer(PAYER, m),
    (m) => sdk.setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, m),
  );
  for (const instruction of instructions) message = sdk.appendTransactionMessageInstruction(instruction, message);
  if (config) message = Object.freeze({ ...message, config: Object.freeze(config) });
  return new Uint8Array(sdk.getTransactionEncoder().encode(sdk.compileTransaction(message)));
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

test("a transaction's programs are read from its bytes in all three shapes, and nothing unsure is read", { skip: noBundle }, () => {
  for (const version of ["legacy", 0, 1]) {
    const bytes = wire(version, [ix(RING, new Uint8Array([1, 2, 3])), transfer(1000n)], version === 1 ? { computeUnitLimit: 400_000, priorityFeeLamports: 5_000n, heapSize: 64 * 1024, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 } : undefined);
    const read = topInstructions(bytes);
    assert.deepEqual(read.map((i) => i.program), [RING, SYSTEM_PROGRAM], String(version));
    assert.deepEqual([...read[0].data], [1, 2, 3]);
    assert.deepEqual([...read[1].data], [2, 0, 0, 0, 232, 3, 0, 0, 0, 0, 0, 0], "the transfer's own bytes");
    assert.equal(topInstructions(bytes.subarray(0, bytes.length - 1)), null, `${version}: a short transaction`);
    assert.equal(topInstructions(Uint8Array.from([...bytes, 0])), null, `${version}: a byte too many`);
  }
  const v1 = wire(1, [ix(RING)]);
  assert.equal(v1[0], 0x81, "version 1: the message first");
  const unknownVersion = Uint8Array.from(v1);
  unknownVersion[0] = 0x82;
  assert.equal(topInstructions(unknownVersion), null, "a version this reader does not know");
  const unknownConfig = Uint8Array.from(v1);
  unknownConfig[4] |= 0x20;
  assert.equal(topInstructions(unknownConfig), null, "a config bit this reader does not know");
  const halfFee = Uint8Array.from(v1);
  halfFee[4] |= 0x01;
  assert.equal(topInstructions(halfFee), null, "a priority fee takes both bits or none");
  const unsigned = Uint8Array.from(v1);
  unsigned[1] = 0;
  assert.equal(topInstructions(unsigned), null, "a transaction without a signature");
  const legacy = wire("legacy", [ix(RING)]);
  const past = Uint8Array.from(legacy);
  // The instruction's program index (after 1 count + 64 signature + 3 header + 1 + 3×32 keys + 32 blockhash + 1 count).
  past[1 + 64 + 3 + 1 + 3 * 32 + 32 + 1] = 9;
  assert.equal(topInstructions(past), null, "a program index past the accounts");
  for (const junk of [new Uint8Array(0), Uint8Array.from([0]), Uint8Array.from([1, 2, 3]), Uint8Array.from([0xff, 0xff, 0xff])]) assert.equal(topInstructions(junk), null, [...junk].join(","));
  assert.equal(base58(new Uint8Array(32)), SYSTEM_PROGRAM);
});

test("on mainnet sendTransaction carries the ring's transactions and a link's fee top-up only", { skip: noBundle }, () => {
  for (const version of ["legacy", 0, 1]) {
    assert.equal(transactionVerdict(wire(version, [ix(RING)])), "ring", `${version}: the pool`);
    assert.equal(transactionVerdict(wire(version, [ix(REGISTRY)])), "ring", `${version}: the registry`);
    // The SDK's own programs beside the ring (the compute budget is not one of them: `relay-rules.test.mjs`).
    assert.equal(transactionVerdict(wire(version, [ix(RING), ix(TOKEN_PROGRAM), ix(SYSTEM_PROGRAM)])), "ring", `${version}: the ring with its helpers`);
    assert.equal(transactionVerdict(wire(version, [ix(RING), ix(JUPITER)])), "foreign", `${version}: the ring with another program beside it`);
    assert.equal(transactionVerdict(wire(version, [ix(JUPITER)])), "foreign", `${version}: another program`);
    assert.equal(transactionVerdict(wire(version, [ix(TOKEN_PROGRAM)])), "foreign", `${version}: a helper alone is no ring transaction`);
  }
  // `flows.ts` `topUp`: one plain transfer of the link's fees, version 0, as every wallet signs.
  assert.equal(transactionVerdict(wire(0, [transfer(LINK_FEE_LAMPORTS)])), "link-fee");
  assert.equal(transactionVerdict(wire(0, [ix(COMPUTE_BUDGET_PROGRAM), transfer(1_000_000n)])), "link-fee");
  assert.equal(transactionVerdict(wire(0, [transfer(LINK_FEE_LAMPORTS + 1n)])), "foreign", "more than a link's fees");
  assert.equal(transactionVerdict(wire(0, [transfer(1000n), transfer(1000n)])), "foreign", "two transfers");
  assert.equal(transactionVerdict(wire(0, [ix(SYSTEM_PROGRAM, new Uint8Array([0, 0, 0, 0]))])), "foreign", "a system call that is no transfer");
  assert.equal(transactionVerdict(Uint8Array.from([1, 2, 3])), "unreadable");

  const send = (bytes, options = { encoding: "base64", preflightCommitment: "confirmed" }) => ({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [b64(bytes), options] });
  assert.equal(strictCallRefusal(send(wire(1, [ix(RING)]))), null);
  assert.equal(strictCallRefusal(send(wire(1, [ix(JUPITER)]))), "foreign", "a transaction with another program — refused");
  assert.equal(strictCallRefusal(send(wire(1, [ix(RING)]), { encoding: "base64", skipPreflight: true })), "preflight", "never without the chain's own simulation");
  assert.equal(strictCallRefusal(send(wire(1, [ix(RING)]), {})), "encoding", "base58 is not read");
  assert.equal(strictCallRefusal({ method: "sendTransaction", params: ["@@@", { encoding: "base64" }] }), "encoding");
});

test("on mainnet reads are the ring's: its programs narrowed, small reads, and nothing the SDK does not ask", () => {
  const ok = (call) => assert.equal(strictCallRefusal(call), null, JSON.stringify(call));
  const no = (call) => assert.notEqual(strictCallRefusal(call), null, JSON.stringify(call));
  ok({ method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] });
  ok({ method: "getSlot" });
  ok({ method: "getBalance", params: [VAULT, { commitment: "confirmed" }] });
  ok({ method: "getSignatureStatuses", params: [["5".repeat(88)]] });
  ok({ method: "getAccountInfo", params: [VAULT, { commitment: "confirmed", encoding: "base64" }] });
  ok({ method: "getMultipleAccounts", params: [[VAULT, PAYER], { encoding: "base64" }] });
  // The SDK's own read of the ring (`getProgramAccounts(PC, { filters: [{ dataSize: 48 }, { memcmp }] })`): its very
  // filters, byte 5 at offset 0 (any other filter is refused: `relay-rules.test.mjs`).
  ok({ method: "getProgramAccounts", params: [RING, { encoding: "base64", filters: [{ dataSize: 48 }, { memcmp: { offset: 0, encoding: "base64", bytes: "BQ==" } }] }] });

  no({ method: "getProgramAccounts", params: [RING, { encoding: "base64" }] });
  no({ method: "getProgramAccounts", params: [RING, { filters: [{ dataSize: 48 }] }] });
  no({ method: "getProgramAccounts", params: [TOKEN_PROGRAM, { filters: [{ memcmp: { offset: 0, bytes: "AQID" } }] }] });
  no({ method: "getAccountInfo", params: [VAULT, { encoding: "jsonParsed" }] });
  no({ method: "getAccountInfo", params: [VAULT] });
  no({ method: "getAccountInfo", params: ["not an address", { encoding: "base64" }] });
  no({ method: "getMultipleAccounts", params: [Array(MAX_ACCOUNTS + 1).fill(VAULT), { encoding: "base64" }] });
  no({ method: "getSignatureStatuses", params: [Array(9).fill("5".repeat(88))] });
  no({ method: "getBalance", params: [] });
  for (const method of ["getTransaction", "simulateTransaction", "requestAirdrop", "getTokenAccountsByOwner", "getBlockHeight"]) no({ method, params: [] });
  assert.equal(strictRpcCheck([{ method: "getSlot" }, { method: "getAccountInfo", params: [VAULT, { encoding: "jsonParsed" }] }]).ok, false, "one refused call refuses the batch");
  assert.equal(strictRpcCheck(Array(9).fill({ method: "getSlot" })).ok, false);
  assert.equal(strictRpcCheck(null).ok, false);
});

test("on mainnet an account read's answer goes back only when every account in it is the ring's", () => {
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));
  const account = (owner) => ({ data: ["", "base64"], executable: false, lamports: 1, owner, rentEpoch: 0, space: 0 });
  const read = { jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [VAULT, { encoding: "base64" }] };
  for (const owner of RING_PROGRAMS) assert.ok(answerAllowed([read], bytes({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: account(owner) } })), owner);
  assert.ok(answerAllowed([read], bytes({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } })), "an account that does not exist reads as none");
  assert.equal(answerAllowed([read], bytes({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: account(TOKEN_PROGRAM) } })), false, "another program's account — refused");
  assert.equal(answerAllowed([read], bytes({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: account(SYSTEM_PROGRAM) } })), false, "a wallet — refused");
  assert.ok(answerAllowed([read], bytes({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "x" } })), "an error carries no account");
  assert.equal(answerAllowed([read], new TextEncoder().encode("not json")), false);

  const many = { jsonrpc: "2.0", id: 2, method: "getMultipleAccounts", params: [[VAULT, PAYER], { encoding: "base64" }] };
  assert.ok(answerAllowed([many], bytes({ jsonrpc: "2.0", id: 2, result: { context: { slot: 1 }, value: [account(RING), null] } })));
  assert.equal(answerAllowed([many], bytes({ jsonrpc: "2.0", id: 2, result: { context: { slot: 1 }, value: [account(RING), account(TOKEN_PROGRAM)] } })), false, "one foreign account refuses the read");

  const slot = { jsonrpc: "2.0", id: 3, method: "getSlot" };
  assert.ok(answerAllowed([slot], new TextEncoder().encode("anything")), "a call that reads no account passes untouched");
  const batch = [slot, read];
  assert.ok(answerAllowed(batch, bytes([{ jsonrpc: "2.0", id: 1, result: { value: account(REGISTRY) } }, { jsonrpc: "2.0", id: 3, result: 5 }])), "matched by id, in any order");
  assert.equal(answerAllowed(batch, bytes([{ jsonrpc: "2.0", id: 1, result: { value: account(TOKEN_PROGRAM) } }, { jsonrpc: "2.0", id: 3, result: 5 }])), false);
  assert.equal(answerAllowed([{ ...slot, id: 1 }, read], bytes([{ jsonrpc: "2.0", id: 1, result: 5 }])), false, "an id twice cannot be matched");
  assert.equal(answerAllowed(batch, bytes([{ jsonrpc: "2.0", id: 99, result: { value: account(RING) } }])), false, "a reply to no call");
});

test("the page's relay session: signed by the server, short-lived, its own address and network only", () => {
  const key = "server-key";
  const { token, ttlMs } = issueRelaySession({ key, network: "mainnet", address: IP, nowMs: NOW });
  assert.equal(ttlMs, RELAY_SESSION_TTL_MS);
  assert.ok(RELAY_SESSION_TTL_MS <= 15 * 60_000, "short-lived");
  assert.doesNotMatch(token, /203\.0\.113\.7|server-key/, "no address and no key in the token");
  const verify = (over) => verifyRelaySession({ token, key, network: "mainnet", address: IP, nowMs: NOW + 1_000, ...over });
  assert.equal(verify({}), "ok");
  assert.equal(verify({ address: "198.51.100.1" }), "forged", "another address");
  assert.equal(verify({ key: "another-key" }), "forged", "another key ends every session");
  assert.equal(verify({ network: "devnet" }), "network");
  assert.equal(verify({ nowMs: NOW + RELAY_SESSION_TTL_MS }), "expired");
  assert.equal(verify({ token: null }), "missing");
  assert.equal(verify({ token: "" }), "missing");
  assert.equal(verify({ token: "rs1.mainnet.1.x.y" }), "malformed");
  const parts = token.split(".");
  assert.equal(verify({ token: [parts[0], parts[1], String(NOW + 9 * 60 * 60_000), ...parts.slice(3)].join(".") }), "forged", "a later time is not the server's");
  assert.notEqual(issueRelaySession({ key, network: "mainnet", address: IP, nowMs: NOW }).token, token, "each session its own");
  assert.equal(passInHeaders(new Headers({ [RELAY_SESSION_HEADER]: token })).get(RELAY_SESSION_HEADER), null, "the token never goes on to Helius");
});

/* ---------------- the relay, as it runs ---------------- */

/** A wallet this browser proved to Ryntra with its own signature, as `readWalletProofFrom` answers. */
const PROVEN = { status: "ok", proof: { sessionId: "s1", chain: "solana", address: PAYER, method: "solana_siws", expiresAt: new Date(NOW + 86_400_000).toISOString(), via: "proof" } };

function stand(network, answers = {}, proof = PROVEN) {
  const store = sharedStore();
  const upstream = [];
  const deps = {
    walletProof: async () => proof,
    fetch: async (url, init) => {
      upstream.push({ url: String(url), init });
      const body = init?.body ? JSON.parse(new TextDecoder().decode(init.body)) : null;
      const reply = typeof answers[body?.method] === "function" ? answers[body.method](body) : (answers[body?.method] ?? { jsonrpc: "2.0", id: body?.id ?? null, result: "fine" });
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    },
    store: () => store,
    limiter: new FixedWindowLimiter({ limit: 300, windowMs: 60_000, maxKeys: 100, now: () => NOW }),
    now: () => NOW,
  };
  const call = (target, init = {}, path = []) => {
    const headers = { "sec-fetch-site": "same-origin", "x-forwarded-for": IP, ...(init.headers ?? {}) };
    const request = new Request(`https://ryntra.io/api/v1/privacy/${network}/${target}${path.length ? `/${path.join("/")}` : ""}`, { method: init.method ?? "GET", headers, body: init.body });
    return relayCall(request, { network, key: "K", target, path }, deps);
  };
  const rpc = (body, headers = {}) => call("rpc", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  // The limit's rows — each carries its own key; the ledger of minutes is no row.
  const rows = async () => (await store.collection(RELAY_COLLECTION).valuesWithPrefix("")).filter((row) => typeof row?.key === "string").length;
  return { call, rpc, upstream, rows, store };
}

const account = (owner) => ({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: { data: ["", "base64"], executable: false, lamports: 1, owner, rentEpoch: 0, space: 0 } } });

test("on mainnet the relay answers nothing without the page's session token, and passes with it", async () => {
  assert.equal(strictRelay("mainnet"), true);
  assert.equal(strictRelay("devnet"), false);
  const relay = stand("mainnet");
  const blockhash = { jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] };

  const bare = await relay.rpc(blockhash);
  assert.equal(bare.status, 401, "no token — refused");
  assert.equal((await relay.call("spr", { method: "POST", body: "ciphertext" }, ["prove", "transfer_2x2"])).status, 401, "the prover too");
  assert.equal((await relay.call("policy")).status, 401, "and the policy");
  assert.equal(relay.upstream.length, 0, "Helius was never asked");
  assert.equal(await relay.rows(), 0, "a refused call writes no row");

  const given = await relay.call("session");
  assert.equal(given.status, 200);
  assert.equal(given.headers.get("cache-control"), "no-store");
  const { token, ttlMs } = await given.json();
  assert.equal(ttlMs, RELAY_SESSION_TTL_MS);
  assert.equal((await relay.call("session", { method: "POST" })).status, 405);
  assert.equal((await relay.call("session", {}, ["x"])).status, 404);
  assert.equal(await relay.rows(), 0, "handing out a session writes no row");

  const passed = await relay.rpc(blockhash, { [RELAY_SESSION_HEADER]: token });
  assert.equal(passed.status, 200, "with the token — it passes");
  assert.deepEqual(await passed.json(), { jsonrpc: "2.0", id: 1, result: "fine" });
  assert.equal(relay.upstream.length, 1);
  assert.equal(new URL(relay.upstream[0].url).host, "mainnet.helius-rpc.com");
  assert.equal(relay.upstream[0].init.headers.get(RELAY_SESSION_HEADER), null, "the token stays here");
  assert.equal(await relay.rows(), 2, "the call is counted once it passed — against the address and the session's wallet");

  assert.equal((await relay.rpc(blockhash, { [RELAY_SESSION_HEADER]: `${token}x` })).status, 401, "a changed token");
  const elsewhere = issueRelaySession({ key: "K", network: "mainnet", address: "198.51.100.1", nowMs: NOW }).token;
  assert.equal((await relay.rpc(blockhash, { [RELAY_SESSION_HEADER]: elsewhere })).status, 401, "a token of another address");
  const otherKey = issueRelaySession({ key: "not-K", network: "mainnet", address: IP, nowMs: NOW }).token;
  assert.equal((await relay.rpc(blockhash, { [RELAY_SESSION_HEADER]: otherKey })).status, 401, "a token the server did not sign");
  assert.equal(relay.upstream.length, 1);
  assert.equal((await relay.call("rpc", { headers: { "sec-fetch-site": "cross-site" } })).status, 403, "another site, as before");
});

test("on mainnet a foreign transaction or a foreign account never comes back from Helius through the relay", { skip: noBundle }, async () => {
  const relay = stand("mainnet", {
    getAccountInfo: (body) => account(body.params[0] === VAULT ? RING : TOKEN_PROGRAM),
  });
  const { token } = await (await relay.call("session")).json();
  const auth = { [RELAY_SESSION_HEADER]: token };
  const send = (bytes) => ({ jsonrpc: "2.0", id: 7, method: "sendTransaction", params: [b64(bytes), { encoding: "base64", preflightCommitment: "confirmed" }] });

  const foreign = await relay.rpc(send(wire(1, [ix(JUPITER)])), auth);
  assert.equal(foreign.status, 200);
  assert.deepEqual((await foreign.json()).error, { code: -32601, message: "Not served here." }, "a transaction with another program — refused");
  assert.equal((await (await relay.rpc(send(wire(0, [ix(RING), ix(JUPITER)])), auth)).json()).error?.code, -32601, "the ring with another program beside it — refused");
  assert.equal(relay.upstream.length, 0, "never sent to Helius");
  assert.equal(await relay.rows(), 0, "and never counted");

  const ring = await relay.rpc(send(wire(1, [ix(RING)])), auth);
  assert.deepEqual(await ring.json(), { jsonrpc: "2.0", id: 7, result: "fine" }, "the ring's transaction passes");
  assert.equal(relay.upstream.length, 1);

  const theirs = await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [PAYER, { encoding: "base64" }] }, auth);
  assert.deepEqual((await theirs.json()).error, { code: -32601, message: "Account not served here." }, "another program's account — refused");
  const ours = await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [VAULT, { encoding: "base64" }] }, auth);
  assert.equal((await ours.json()).result.value.owner, RING, "the ring's account comes back");
  const parsed = await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [VAULT, { encoding: "jsonParsed" }] }, auth);
  assert.equal((await parsed.json()).error?.code, -32601, "only the SDK's own encoding");
});

test("devnet keeps its open rules: no token, any transaction and any account, and no row in the store", { skip: noBundle }, async () => {
  const relay = stand("devnet", { getAccountInfo: account(TOKEN_PROGRAM) });
  const send = { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [b64(wire(1, [ix(JUPITER)])), { encoding: "base64", skipPreflight: true }] };
  assert.deepEqual(await (await relay.rpc(send)).json(), { jsonrpc: "2.0", id: 1, result: "fine" }, "no token asked, the open rules pass it, as before");
  const read = await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [PAYER, { encoding: "jsonParsed" }] });
  assert.equal((await read.json()).result.value.owner, TOKEN_PROGRAM, "any account, as before");
  assert.equal((await (await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getTransaction" })).json()).error.message, "Method not served here.", "the open list stands, as before");
  assert.equal((await relay.rpc({ jsonrpc: "2.0", id: 1, method: "getSlot" }, { [RELAY_SESSION_HEADER]: "garbage" })).status, 200, "a token is not read on devnet");
  assert.equal(relay.upstream.length, 3);
  assert.equal(new URL(relay.upstream[0].url).host, "devnet.helius-rpc.com");
  assert.equal(await relay.rows(), 0, "devnet counts in the instance, as before");
  assert.equal((await relay.call("session")).status, 200, "the page's session is handed out on devnet too; it is just not asked for");
  assert.equal((await relay.call("rpc")).status, 405);
});

/* ---------------- the limit's rows ---------------- */

const W = 60_000;
const minute = (ms) => Math.floor(ms / W) * W;
/** Sweeps until every minute that is over is swept; how many rows went. */
async function sweepAll(store, input) {
  let removed = 0;
  for (let round = 0; round < 10; round += 1) {
    const sweep = await sweepRelayQuotas(store, input);
    removed += sweep.removed;
    if (sweep.caughtUp) return removed;
  }
  throw new Error("the sweep never caught up");
}
const quotaRows = async (store, prefix) => (await store.collection(RELAY_COLLECTION).valuesWithPrefix(prefix)).filter((row) => typeof row?.key === "string");

test("the limit's rows are swept: a minute that is over goes, a live one stays, another network's rows stay", async () => {
  const store = sharedStore();
  const quotas = store.versioned(RELAY_COLLECTION);
  // A row as a counted call leaves it: its minute named in the ledger first.
  const put = async (network, address, windowStartMs) => {
    await noteRelayMinute(store, network, windowStartMs);
    const key = relayQuotaKey(network, address, windowStartMs);
    await quotas.set(key, { version: 0, windowStartMs, used: 3, key });
  };
  const old = minute(NOW - RELAY_QUOTA_STALE_MS - 3 * W);
  await put("mainnet", "old-1", old);
  await put("mainnet", "old-2", old);
  await put("mainnet", "old-3", old + W);
  await put("mainnet", "live", minute(NOW));
  await put("mainnet", "just-over", minute(NOW) - W);
  await put("devnet", "old-devnet", old);

  assert.equal(await sweepAll(store, { network: "mainnet", nowMs: NOW }), 3, "the minutes that are over");
  const left = (await quotaRows(store, "mainnet:")).map((row) => row.key).sort();
  assert.deepEqual(left, [relayQuotaKey("mainnet", "live", minute(NOW)), relayQuotaKey("mainnet", "just-over", minute(NOW) - W)].sort(), "the live minute and the one over by less than the clocks may differ stay");
  assert.equal((await quotaRows(store, "devnet:")).length, 1, "one network's sweep leaves the other's rows");

  // A ceiling of minutes holds: one sweep takes that many minutes, each whole, and the next sweeps take the rest
  // (rows no longer have a ceiling — a minute goes in one step however many it holds).
  const later = NOW + 10 * W;
  for (let i = 0; i < 25; i += 1) await put("mainnet", `crowd-${i}`, minute(NOW) + W);
  const first = await sweepRelayQuotas(store, { network: "mainnet", nowMs: later, windows: 1 });
  assert.equal(first.removed, 1, "the oldest minute only: the just-over row, now long over");
  assert.equal(first.caughtUp, false, "a sweep that hit its ceiling is behind");
  assert.equal(await sweepAll(store, { network: "mainnet", nowMs: later, windows: 1 }), 26, "the live row's minute, then the crowd's whole");
  assert.equal((await quotaRows(store, "mainnet:")).length, 0);

  // Every record carries its own key and names its minute.
  const fresh = sharedStore();
  await consumeRelayQuota(fresh, { network: "mainnet", address: IP, nowMs: NOW });
  await consumeRelayQuota(fresh, { network: "mainnet", address: IP, nowMs: NOW + 1 });
  assert.deepEqual(await quotaRows(fresh, "mainnet:"), [{ version: 1, windowStartMs: minute(NOW), used: 2, key: relayQuotaKey("mainnet", IP, minute(NOW)) }]);
});

test("a new row is the moment to sweep: the table holds the last minutes, not every address ever seen", async () => {
  const store = sharedStore();
  const T0 = minute(NOW);
  for (let i = 0; i < 25; i += 1) assert.equal((await consumeRelayQuota(store, { network: "mainnet", address: `10.0.0.${i}`, nowMs: T0 + 1_000 })).kind, "counted");
  const count = async () => (await quotaRows(store, "mainnet:")).length;
  assert.equal(await count(), 25);
  // Later the same addresses are gone; one new one comes. Its row opens and the minutes that are over are swept.
  const later = T0 + 4 * W + 1_000;
  await consumeRelayQuota(store, { network: "mainnet", address: "10.0.1.1", nowMs: later });
  assert.equal(await count(), 1, "only the new address's row is left");
  // A known address coming back in its minute opens nothing and sweeps nothing: its count goes on.
  const again = await consumeRelayQuota(store, { network: "mainnet", address: "10.0.1.1", nowMs: later + 1 });
  assert.equal(again.decision.remaining, 300 - 2);
  // Within the sweep interval a new row does not sweep again.
  await noteRelayMinute(store, "mainnet", T0 + 3 * W);
  await store.versioned(RELAY_COLLECTION).set(relayQuotaKey("mainnet", "stale", T0 + 3 * W), { version: 0, windowStartMs: T0 + 3 * W, used: 1, key: relayQuotaKey("mainnet", "stale", T0 + 3 * W) });
  await consumeRelayQuota(store, { network: "mainnet", address: "10.0.1.2", nowMs: later + 30_000 });
  assert.equal(await count(), 3, "once per interval");
  await consumeRelayQuota(store, { network: "mainnet", address: "10.0.1.3", nowMs: later + RELAY_SWEEP_EVERY_MS + 1 });
  assert.equal(await count(), 3, "the stale row went, the new one came");
  assert.equal(await store.collection(RELAY_COLLECTION).get(relayQuotaKey("mainnet", "stale", T0 + 3 * W)), undefined);
});

/* ---------------- the wallet check's report ---------------- */

test("the wallet check's report names its network: on mainnet it never says «test network»", () => {
  const report = {
    wallet: "Phantom",
    address: PAYER,
    device: "desktop",
    versions: ["legacy", "0", "1"],
    signMessage: true,
    keys: { sameBytes: "yes", valid: "yes", repeatable: "yes", refused: null },
    v1: { signed: "yes", messageKept: "yes", valid: "yes", landed: null, refused: null },
    registry: "none",
  };
  const at = new Date("2026-11-22T00:00:00Z");
  const main = reportText(report, at, "mainnet");
  assert.doesNotMatch(main, /test network/i);
  assert.match(main, /^Ryntra wallet check · mainnet · 2026-11-22T00:00:00\.000Z/);
  assert.match(main, /v1 landed on mainnet: not sent — the check sends nothing on mainnet/);
  const dev = reportText(report, at, "devnet");
  assert.equal(dev, reportText(report, at), "devnet is the build's network in this process, as before");
  assert.match(dev, /^Ryntra wallet check · test network · /);
  assert.match(dev, /v1 landed on the test network: not sent$/);
  assert.match(reportText({ ...report, v1: { ...report.v1, landed: "SIG" } }, at, "devnet"), /v1 landed on the test network: SIG$/);
});
