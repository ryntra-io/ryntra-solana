// Run from repo root: node --test lib/solana/seeker-genesis.test.mjs
//
// SKR-3 — «Перевірено Seeker» on fixtures: the server reads a proven wallet's
// Seeker Genesis Tokens with Solana Mobile's package, a failed read is 503 and
// never «no Seeker», and the answer is cached.
//
// The chain is `seeker-genesis.fixture.mjs` (the real SGT's extensions, a fixture member number).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getSeekerGenesisTokens, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-mobile/skr-genesis-token";

import {
  SEEKER_FOUND_TTL_MS,
  SEEKER_NONE_TTL_MS,
  checkSeekerGenesis,
  createSeekerCache,
  mainnetSeekerReader,
} from "./seeker-genesis.server.ts";
import { HOLDER_ACCOUNTS, MINTS, NONE_ACCOUNTS, OWNER, SGT_MINT, base64, fixtureRpcResult, parsedAccount } from "./seeker-genesis.fixture.mjs";
import { answerSeekerCheck } from "../api/v1/seeker.ts";
import { API_CONTRACT_VERSION, SeekerCheckResponseSchema } from "../api/v1/contract.ts";
import { FixedWindowLimiter } from "../http-control.ts";

/** One wallet's chain, as two JSON-RPC methods would answer it. */
const CHAIN = { accounts: HOLDER_ACCOUNTS, mints: MINTS };

/** A kit-shaped RPC over `CHAIN` (or a failure), counting what it was asked. */
function fixtureRpc(chain = CHAIN, { failOn = null } = {}) {
  const asked = [];
  const call = (method, answer) => ({
    send: async () => {
      asked.push(method);
      if (failOn === method) throw new Error("HTTP 429 from https://rpc.example/?api-key=SECRET");
      return answer();
    },
  });
  return {
    asked,
    rpc: {
      getTokenAccountsByOwner: (owner, filter) => call("getTokenAccountsByOwner", () => {
        assert.equal(owner, OWNER);
        assert.equal(filter.programId, TOKEN_2022_PROGRAM_ADDRESS);
        return { context: { slot: 443_767_000n }, value: chain.accounts.map((row) => parsedAccount(row)) };
      }),
      getMultipleAccounts: (mints) => call("getMultipleAccounts", () => ({
        context: { slot: 443_767_000n },
        value: mints.map((mint) => {
          const found = chain.mints[mint];
          return found ? { owner: found.owner, data: [base64(found.data), "base64"], executable: false, lamports: 3_000_000n, rentEpoch: 0n, space: BigInt(found.data.length) } : null;
        }),
      })),
    },
  };
}

const readerOver = (rpc) => (owner, signal) => getSeekerGenesisTokens(rpc, owner, { abortSignal: signal });

test("a wallet holding an SGT is verified, with the mint and its member number — look-alikes, a forged member and an empty account are not counted", async () => {
  const { rpc, asked } = fixtureRpc();
  const result = await checkSeekerGenesis(OWNER, { read: readerOver(rpc), cache: createSeekerCache(), now: () => Date.parse("2026-10-22T10:00:00Z") });
  assert.deepEqual(result, {
    status: "ok",
    address: OWNER,
    verified: true,
    tokens: [{ mint: SGT_MINT, memberNumber: "41337" }],
    checkedAt: "2026-10-22T10:00:00.000Z",
  });
  assert.deepEqual(asked, ["getTokenAccountsByOwner", "getMultipleAccounts"]);
});

test("a wallet with no SGT is answered «not verified» — a read that worked, not a failure", async () => {
  const chain = { accounts: NONE_ACCOUNTS, mints: MINTS };
  const result = await checkSeekerGenesis(OWNER, { read: readerOver(fixtureRpc(chain).rpc), cache: createSeekerCache() });
  assert.equal(result.status, "ok");
  assert.equal(result.verified, false);
  assert.deepEqual(result.tokens, []);
});

test("a wallet with no Token-2022 account at all is read once and is not verified", async () => {
  const { rpc, asked } = fixtureRpc({ accounts: [], mints: {} });
  const result = await checkSeekerGenesis(OWNER, { read: readerOver(rpc), cache: createSeekerCache() });
  assert.equal(result.verified, false);
  assert.deepEqual(asked, ["getTokenAccountsByOwner"]);
});

test("an RPC failure on either read is `unavailable`, never «no Seeker», and is not cached", async () => {
  for (const failOn of ["getTokenAccountsByOwner", "getMultipleAccounts"]) {
    const cache = createSeekerCache();
    const failing = fixtureRpc(CHAIN, { failOn });
    assert.deepEqual(await checkSeekerGenesis(OWNER, { read: readerOver(failing.rpc), cache }), { status: "unavailable" }, failOn);
    assert.equal(cache.entries.size, 0, `${failOn}: a failure is not kept`);
    /* The next ask reads again and, with the node back, answers. */
    const back = fixtureRpc();
    const again = await checkSeekerGenesis(OWNER, { read: readerOver(back.rpc), cache });
    assert.equal(again.verified, true, failOn);
  }
});

test("a read that hangs ends at the deadline as `unavailable`", async () => {
  const hanging = (_owner, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const result = await checkSeekerGenesis(OWNER, { read: hanging, cache: createSeekerCache(), deadlineMs: 20 });
  assert.deepEqual(result, { status: "unavailable" });
});

test("the deadline holds for a reader that ignores the signal", async () => {
  const deaf = () => new Promise(() => undefined);
  const result = await checkSeekerGenesis(OWNER, { read: deaf, cache: createSeekerCache(), deadlineMs: 20 });
  assert.deepEqual(result, { status: "unavailable" });
});

test("a found answer is kept an hour, «none» five minutes; then the chain is read again", async () => {
  let clock = Date.parse("2026-10-22T10:00:00Z");
  const now = () => clock;
  const found = fixtureRpc();
  const cache = createSeekerCache();
  await checkSeekerGenesis(OWNER, { read: readerOver(found.rpc), cache, now });
  clock += SEEKER_FOUND_TTL_MS - 1;
  await checkSeekerGenesis(OWNER, { read: readerOver(found.rpc), cache, now });
  assert.equal(found.asked.length, 2, "one read (two methods) inside the hour");
  clock += 2;
  await checkSeekerGenesis(OWNER, { read: readerOver(found.rpc), cache, now });
  assert.equal(found.asked.length, 4, "read again after the hour");

  const none = fixtureRpc({ accounts: [], mints: {} });
  const noneCache = createSeekerCache();
  await checkSeekerGenesis(OWNER, { read: readerOver(none.rpc), cache: noneCache, now });
  clock += SEEKER_NONE_TTL_MS - 1;
  await checkSeekerGenesis(OWNER, { read: readerOver(none.rpc), cache: noneCache, now });
  assert.equal(none.asked.length, 1);
  clock += 2;
  await checkSeekerGenesis(OWNER, { read: readerOver(none.rpc), cache: noneCache, now });
  assert.equal(none.asked.length, 2, "«none» is read again after five minutes");
});

test("asks for one address at once share one read", async () => {
  const { rpc, asked } = fixtureRpc();
  const cache = createSeekerCache();
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => checkSeekerGenesis(OWNER, { read: readerOver(rpc), cache })));
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(asked.filter((method) => method === "getTokenAccountsByOwner").length, 1);
  assert.equal(cache.pending.size, 0);
});

test("not a Solana address is refused before any read", async () => {
  let reads = 0;
  const result = await checkSeekerGenesis("not-an-address", { read: async () => { reads += 1; return []; }, cache: createSeekerCache() });
  assert.deepEqual(result, { status: "invalid" });
  assert.equal(reads, 0);
});

/* ---- the production reader over the real transport (lib/solana/rpc.ts), fetch stubbed */

function stubFetch(handler) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const request = JSON.parse(init.body);
    seen.push({ host: new URL(url).host, method: request.method });
    return handler(new URL(url).host, request);
  };
  return { seen, restore: () => { globalThis.fetch = original; } };
}

const rpcAnswer = (request, result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200, headers: { "content-type": "application/json" } });

function chainAnswer(request) {
  const result = fixtureRpcResult(request, () => HOLDER_ACCOUNTS);
  if (!result) throw new Error(`unexpected ${request.method}`);
  return rpcAnswer(request, result);
}

test("the mainnet reader: the primary refuses `getTokenAccountsByOwner` (403, as publicnode does), the fallback answers — verified", async () => {
  const saved = { primary: process.env.RYNTRA_SOLANA_RPC_MAINNET, fallback: process.env.RYNTRA_SOLANA_RPC_MAINNET_FALLBACK };
  process.env.RYNTRA_SOLANA_RPC_MAINNET = "https://primary.rpc.test/?api-key=SECRET";
  process.env.RYNTRA_SOLANA_RPC_MAINNET_FALLBACK = "https://fallback.rpc.test";
  const net = stubFetch((host, request) => (host === "primary.rpc.test" && request.method === "getTokenAccountsByOwner" ? new Response("Request blocked", { status: 403 }) : chainAnswer(request)));
  try {
    const result = await checkSeekerGenesis(OWNER, { read: mainnetSeekerReader, cache: createSeekerCache() });
    assert.equal(result.status, "ok");
    assert.equal(result.verified, true);
    assert.deepEqual(result.tokens, [{ mint: SGT_MINT, memberNumber: "41337" }]);
    assert.deepEqual(net.seen.map((s) => `${s.host} ${s.method}`), [
      "primary.rpc.test getTokenAccountsByOwner",
      "fallback.rpc.test getTokenAccountsByOwner",
      "primary.rpc.test getMultipleAccounts",
    ]);
  } finally {
    net.restore();
    for (const [name, value] of [["RYNTRA_SOLANA_RPC_MAINNET", saved.primary], ["RYNTRA_SOLANA_RPC_MAINNET_FALLBACK", saved.fallback]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("the mainnet reader: both endpoints refuse — `unavailable`, and the route says UNAVAILABLE (503), not «not verified»", async () => {
  const saved = { primary: process.env.RYNTRA_SOLANA_RPC_MAINNET, fallback: process.env.RYNTRA_SOLANA_RPC_MAINNET_FALLBACK };
  process.env.RYNTRA_SOLANA_RPC_MAINNET = "https://primary.rpc.test";
  process.env.RYNTRA_SOLANA_RPC_MAINNET_FALLBACK = "https://fallback.rpc.test";
  const net = stubFetch(() => new Response("Too Many Requests", { status: 429 }));
  try {
    const cache = createSeekerCache();
    const answer = await answerSeekerCheck(OWNER, {
      check: (address) => checkSeekerGenesis(address, { read: mainnetSeekerReader, cache }),
      limiter: new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 10 }),
    });
    assert.equal(answer.ok, false);
    assert.equal(answer.code, "UNAVAILABLE");
    assert.match(answer.message, /not «no Seeker»/);
    assert.equal(answer.headers["Retry-After"], "30");
    assert.doesNotMatch(answer.message, /rpc\.test|SECRET/);
    assert.equal(cache.entries.size, 0);
  } finally {
    net.restore();
    for (const [name, value] of [["RYNTRA_SOLANA_RPC_MAINNET", saved.primary], ["RYNTRA_SOLANA_RPC_MAINNET_FALLBACK", saved.fallback]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

/* ---- the v1 answer */

test("1.66.0: the answer for the web and the phone fits `SeekerCheckResponseSchema`", async () => {
  /* Added in 1.66.0; a later minor keeps it. */
  assert.ok(API_CONTRACT_VERSION.split(".").map(Number)[1] >= 66, API_CONTRACT_VERSION);
  const { rpc } = fixtureRpc();
  const cache = createSeekerCache();
  const answer = await answerSeekerCheck(OWNER, {
    check: (address) => checkSeekerGenesis(address, { read: readerOver(rpc), cache, now: () => Date.parse("2026-10-22T10:00:00Z") }),
    limiter: new FixedWindowLimiter({ windowMs: 60_000, limit: 20, maxKeys: 10 }),
  });
  assert.equal(answer.ok, true);
  assert.deepEqual(SeekerCheckResponseSchema.parse(answer.body), {
    address: OWNER,
    verified: true,
    tokens: [{ mint: SGT_MINT, memberNumber: "41337" }],
    network: "solana:mainnet",
    checkedAt: "2026-10-22T10:00:00.000Z",
  });
});

test("a client looping past the cache is RATE_LIMITED with Retry-After, and the chain is not read for it", async () => {
  const limiter = new FixedWindowLimiter({ windowMs: 60_000, limit: 2, maxKeys: 10 });
  let reads = 0;
  const check = async (address) => { reads += 1; return { status: "ok", address, verified: false, tokens: [], checkedAt: new Date().toISOString() }; };
  await answerSeekerCheck(OWNER, { check, limiter });
  await answerSeekerCheck(OWNER, { check, limiter });
  const third = await answerSeekerCheck(OWNER, { check, limiter });
  assert.equal(third.ok, false);
  assert.equal(third.code, "RATE_LIMITED");
  assert.ok(Number(third.headers["Retry-After"]) >= 1);
  assert.equal(reads, 2);
});

test("the route proves the wallet (a read) before anything else and takes no address from the request", () => {
  const source = readFileSync(new URL("../../app/api/v1/auth/seeker/route.ts", import.meta.url), "utf8");
  const major = source.indexOf("apiMajorRefusal(request.headers)");
  const proof = source.indexOf('requireWalletProof(request, "read")');
  const answer = source.indexOf("answerSeekerCheck(proof.address)");
  assert.ok(major > 0 && proof > major && answer > proof, "major → proof → answer");
  assert.doesNotMatch(source, /searchParams|request\.json|\.get\("address"\)/);
  assert.match(source, /export async function GET\(/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)\(/);
});
