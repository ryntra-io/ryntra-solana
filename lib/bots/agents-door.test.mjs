// «A wallet's agents» (`/api/bots/agents`, `./agents-door.server.ts`): the book is read only for the wallet the request
// proves. The attacks the old pool door let through — another wallet, this site's `Origin` forged from `curl` — played
// against the door with a book that writes down whom it was read for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Keypair } from "@solana/web3.js";

import { answerAgents } from "./agents-door.server.ts";

const SITE = "https://ryntra.io";
const key = () => Keypair.generate().publicKey.toBase58();
const PERSON = key();
const STRANGER = key();

/**
 * The proof for a read as `requireWalletProof` gives it, over what a request carries: the phone's bearer, the wallet's
 * own signed proof in the browser (`rw`), or a wallet the signed-in account linked (`rwl`), which counts for a read.
 * Nothing else proves a wallet: an `Origin` header proves nothing.
 */
function proveLike() {
  let asked = 0;
  const prove = async (request) => {
    asked += 1;
    const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (bearer) return { ok: true, address: bearer };
    const cookie = request.headers.get("cookie") ?? "";
    const address = /(?:^|; )rw=([^;]+)/.exec(cookie)?.[1] ?? /(?:^|; )rwl=([^;]+)/.exec(cookie)?.[1];
    if (address) return { ok: true, address };
    return { ok: false, response: Response.json({ error: { code: "UNAUTHORIZED", message: "No proven wallet: sign in with the wallet first." } }, { status: 401 }) };
  };
  return { prove, asked: () => asked };
}

/** Each request from its own address: the pool actions' rate (12 a minute an address) is not what these tests hold. */
let caller = 0;
const requestOf = (body, headers = {}) =>
  new Request(`${SITE}/api/bots/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SITE, "x-forwarded-for": `10.8.${Math.floor(++caller / 250)}.${caller % 250}`, ...headers },
    body: JSON.stringify(body),
  });

/** The agent's book, as a test's: it answers for whom it was asked, and writes it down. */
function bookOf() {
  const reads = [];
  const read = async (owner) => (reads.push(owner), { owner, networks: { mainnet: { read: true, mandates: [], pilot: null, cares: [{ key: `c:mainnet:${owner}:1`, pool: key(), status: "working" }] }, devnet: { read: false, mandates: [], pilot: null, cares: [] } } });
  return { read, reads };
}

test("forged Origin: `curl` with this site's Origin and no proof reads nothing", async () => {
  const { prove } = proveLike();
  const { read, reads } = bookOf();
  const answer = await answerAgents(requestOf({ owner: PERSON }, { "sec-fetch-site": "same-origin" }), read, { prove });
  assert.equal(answer.status, 401);
  assert.equal((await answer.json()).error.code, "UNAUTHORIZED");
  assert.deepEqual(reads, []);
});

test("another wallet: a proof of one wallet never reads another's agents — in the browser or with the phone's bearer", async () => {
  const { prove } = proveLike();
  const { read, reads } = bookOf();
  for (const headers of [{ cookie: `rw=${STRANGER}` }, { cookie: `rwl=${STRANGER}` }, { origin: "", authorization: `Bearer ${STRANGER}` }]) {
    const answer = await answerAgents(requestOf({ owner: PERSON }, headers), read, { prove });
    assert.equal(answer.status, 403, JSON.stringify(headers));
    assert.equal((await answer.json()).error.code, "WALLET_MISMATCH");
  }
  assert.deepEqual(reads, []);
});

test("a browser from another site is refused before its body or its proof are read", async () => {
  const { prove, asked } = proveLike();
  const { read, reads } = bookOf();
  const answer = await answerAgents(requestOf({ owner: PERSON }, { origin: "https://elsewhere.example", cookie: `rw=${PERSON}` }), read, { prove });
  assert.equal(answer.status, 403);
  assert.equal((await answer.json()).error.code, "FORBIDDEN_ORIGIN");
  assert.equal(asked(), 0);
  assert.deepEqual(reads, []);
});

test("the wallet's own: signed, linked or the phone's bearer — the book is read for the proven address", async () => {
  const { prove } = proveLike();
  const { read, reads } = bookOf();
  for (const headers of [{ cookie: `rw=${PERSON}` }, { cookie: `rwl=${PERSON}` }, { origin: "", authorization: `Bearer ${PERSON}` }]) {
    const answer = await answerAgents(requestOf({ owner: PERSON }, headers), read, { prove });
    assert.equal(answer.status, 200, JSON.stringify(headers));
    assert.equal((await answer.json()).owner, PERSON);
    assert.equal(answer.headers.get("cache-control")?.includes("no-store"), true, "a wallet's agents are never cached");
  }
  assert.deepEqual(reads, [PERSON, PERSON, PERSON]);
  /* Not an address: refused before the proof. The book silent: 503, not an empty list. */
  assert.equal((await answerAgents(requestOf({ owner: "nobody" }, { cookie: `rw=${PERSON}` }), read, { prove })).status, 400);
  assert.equal((await answerAgents(requestOf({ owner: PERSON }, { cookie: `rw=${PERSON}` }), async () => null, { prove })).status, 503);
  assert.equal((await answerAgents(requestOf({ owner: PERSON }, { cookie: `rw=${PERSON}` }), async () => Promise.reject(new Error("rpc")), { prove })).status, 503);
});

test("the door's real proof is `requireWalletProof` for a read, and the route reads the book only through the door", () => {
  const door = readFileSync(new URL("./agents-door.server.ts", import.meta.url), "utf8");
  assert.match(door, /\(await import\("\.\.\/api\/v1\/proof\.ts"\)\)\.requireWalletProof\(request, "read"\)/);
  assert.match(door, /const agents = await read\(proof\.address\)/, "the book is read for the proven address");
  const route = readFileSync(new URL("../../app/api/bots/agents/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("return answerAgents(request, (owner) => agentsOfOwner(owner));"));
  assert.doesNotMatch(route, /openLiquidityDoor|\.mismatch\(|body\.owner/, "the wallet comes from the proof only");
});
